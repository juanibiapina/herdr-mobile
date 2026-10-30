// Every machine the phone knows, each over its own connection, merged into one
// list of sessions. A terminal that one machine reaches directly and another
// reaches through `hc machine add` (as `mini/t3`) appears once, keyed by the
// owning core's id; the direct connection wins.
import { fromBase64, utf8Decode } from "./bytes";
import { HcConnection, type Transport } from "./connection";
import type { CoreInfo, HcEvent, ListResult, MachineView, Terminal } from "./types";

export type MachineConfig = {
  id: string;
  /** What the phone calls it; also the SSH host unless `host` differs. */
  name: string;
  host: string;
  port: number;
  user: string;
};

export type LinkView = {
  config: MachineConfig;
  state: "connecting" | "connected" | "offline";
  error?: string;
  core?: CoreInfo;
  version?: string;
  /** Machines that core added itself, as it sees them. */
  machines: MachineView[];
};

export type Session = {
  /** Owning core id + its own address: the same terminal from any route. */
  key: string;
  /** The session that started this one, when there is one. */
  parentKey: string | null;
  /** The machine that runs it. */
  machine: string;
  terminal: Terminal;
  /** Which link reaches it, and the address to use there. */
  linkId: string;
  address: string;
};

/** A place a session can start: a machine the phone reaches, directly or through another. */
export type Target = {
  /** The owning core's id. */
  coreId: string;
  label: string;
  linkId: string;
  /** The name the link's core uses for it, when reached through another machine. */
  on?: string;
};

export type RunSpec = {
  cwd?: string;
  /** Program and arguments, or a template name and its task. Omit with `line` for the machine's shell. */
  argv?: string[];
  /** A shell line instead of argv. */
  line?: string;
  name?: string;
  keep?: boolean;
  labels?: Record<string, string>;
};

export type ExecOutput = { code: number | null; stdout: string; stderr: string };

export type Transition = { session: Session; kind: "blocked" | "turn" | "error" | "exited" };

export type OpenTransport = (config: MachineConfig) => Promise<Transport>;

class Link {
  state: LinkView["state"] = "connecting";
  error?: string;
  conn?: HcConnection;
  terminals = new Map<string, Terminal>();
  machines: MachineView[] = [];
  private retryMs = 2000;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private refreshing = false;

  constructor(
    readonly config: MachineConfig,
    private open: OpenTransport,
    private changed: () => void,
    private event: (link: Link, e: HcEvent, before: Terminal | undefined) => void,
  ) {}

  view(): LinkView {
    return {
      config: this.config,
      state: this.state,
      error: this.error,
      core: this.conn?.hello.core,
      version: this.conn?.hello.version,
      machines: this.machines,
    };
  }

  async connect() {
    clearTimeout(this.timer);
    if (this.stopped || (this.conn && !this.conn.isClosed)) return;
    this.state = "connecting";
    this.error = undefined;
    this.changed();
    try {
      const conn = await HcConnection.open(await this.open(this.config));
      if (this.stopped) return conn.close();
      this.conn = conn;
      conn.onClose((reason) => this.lost(reason));
      // Subscribe before reading, so nothing falls between the two.
      const sub = await conn.subscribe(
        {},
        {
          onEvent: (e) => this.apply(e),
          onMissed: (_seq, terminals) => {
            this.reset(terminals);
            void this.refreshMachines();
          },
        },
      );
      this.reset(sub.terminals);
      await this.refreshMachines();
      this.state = "connected";
      this.retryMs = 2000;
      this.changed();
    } catch (e) {
      this.lost(e instanceof Error ? e.message : String(e));
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.conn?.close();
  }

  /**
   * After the phone sleeps, a line can look open while the network under it is
   * gone; SSH keepalives would notice only after ~45 s. Ask the core directly,
   * and start over at once when it doesn't answer.
   */
  async probe(timeoutMs = 4000) {
    const conn = this.conn;
    if (!conn || this.state !== "connected") return void this.connect();
    try {
      await conn.call("server.status", {}, timeoutMs);
    } catch {
      if (this.conn !== conn) return;
      this.retryMs = 500;
      conn.close();
    }
  }

  private lost(reason: string) {
    this.conn = undefined;
    this.terminals.clear();
    this.state = "offline";
    this.error = reason;
    this.changed();
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  private reset(terminals: Terminal[]) {
    this.terminals = new Map(terminals.map((t) => [t.address, t]));
    this.changed();
  }

  private async refreshMachines() {
    if (!this.conn || this.refreshing) return;
    this.refreshing = true;
    try {
      const list = await this.conn.call<ListResult>("terminal.list", { all: true });
      this.machines = list.machines ?? [];
      // Finished terminals are not in the event snapshot; keep them until removed.
      for (const t of list.terminals) {
        if (t.state === "finished" && !this.terminals.has(t.address)) this.terminals.set(t.address, t);
      }
      this.changed();
    } catch {
      // The next missed snapshot or reconnect tries again.
    } finally {
      this.refreshing = false;
    }
  }

  private apply(e: HcEvent) {
    if (e.type === "doc" || !e.terminal) return;
    const addr = e.terminal;
    const before = this.terminals.get(addr);
    const set = (patch: Partial<Terminal>) => before && this.terminals.set(addr, { ...before, ...patch });
    const d = e.data ?? {};
    switch (e.type) {
      case "created":
      case "restarted":
        this.terminals.set(addr, d);
        if (addr.includes("/") && !this.machines.some((m) => addr.startsWith(m.name + "/"))) {
          void this.refreshMachines();
        }
        break;
      case "removed":
        this.terminals.delete(addr);
        break;
      case "lost":
        set({ ...d, pid: null, foreground: null });
        break;
      case "finished":
        set({ ...d, state: "finished", foreground: null });
        break;
      case "status":
        set({ status: d.status, status_ms: Date.now() });
        break;
      case "turn":
        set({ turn: d.turn });
        break;
      case "title":
        set({ title: d.title });
        break;
      case "labels":
        if (d.record) this.terminals.set(addr, d.record);
        else set({ labels: d.labels });
        break;
      case "size":
        set({ cols: d.cols, rows: d.rows });
        break;
      case "foreground":
        set({ foreground: d });
        break;
      case "keep":
        set({ keep: d.keep });
        break;
    }
    this.event(this, e, before);
    this.changed();
  }
}

export class Fleet {
  private links = new Map<string, Link>();
  private listeners = new Set<() => void>();
  private transitionListeners = new Set<(t: Transition) => void>();
  private cached: { links: LinkView[]; sessions: Session[] } | null = null;

  constructor(private open: OpenTransport) {}

  /** Connect to exactly these machines, keeping links that did not change. */
  setMachines(configs: MachineConfig[]) {
    const wanted = new Map(configs.map((c) => [c.id, c]));
    for (const [id, link] of this.links) {
      const c = wanted.get(id);
      if (!c || JSON.stringify(c) !== JSON.stringify(link.config)) {
        link.stop();
        this.links.delete(id);
      }
    }
    for (const c of configs) {
      if (this.links.has(c.id)) continue;
      const link = new Link(c, this.open, () => this.changed(), (l, e, before) => this.transition(l, e, before));
      this.links.set(c.id, link);
      void link.connect();
    }
    this.changed();
  }

  /** Retry offline machines now. */
  reconnect() {
    for (const link of this.links.values()) void link.connect();
  }

  /** Check every line (e.g. when the app returns to the foreground) and reconnect dead ones. */
  probe() {
    for (const link of this.links.values()) void link.probe();
  }

  stop() {
    for (const link of this.links.values()) link.stop();
    this.links.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onTransition(listener: (t: Transition) => void): () => void {
    this.transitionListeners.add(listener);
    return () => this.transitionListeners.delete(listener);
  }

  snapshot(): { links: LinkView[]; sessions: Session[] } {
    if (this.cached) return this.cached;
    const sessions = new Map<string, Session>();
    for (const link of this.links.values()) {
      if (!link.conn) continue;
      for (const t of link.terminals.values()) {
        const s = this.session(link, t);
        const prev = sessions.get(s.key);
        if (!prev || (prev.address.includes("/") && !s.address.includes("/"))) sessions.set(s.key, s);
      }
    }
    this.cached = { links: [...this.links.values()].map((l) => l.view()), sessions: [...sessions.values()] };
    return this.cached;
  }

  /** The connection and address to reach a session, preferring a direct link. */
  route(key: string): { conn: HcConnection; address: string; session: Session } | null {
    const session = this.snapshot().sessions.find((s) => s.key === key);
    const conn = session && this.links.get(session.linkId)?.conn;
    return session && conn ? { conn, address: session.address, session } : null;
  }

  private session(link: Link, t: Terminal): Session {
    const core = link.conn!.hello.core;
    const slash = t.address.indexOf("/");
    if (slash < 0) {
      return {
        key: `${core.id}:${t.address}`,
        parentKey: t.parent ? this.keyFor(link, core.id, t.parent) : null,
        machine: core.name,
        terminal: t,
        linkId: link.config.id,
        address: t.address,
      };
    }
    const name = t.address.slice(0, slash);
    const via = link.machines.find((m) => m.name === name);
    const owner = via?.id ?? core.id;
    return {
      key: via ? `${via.id}:${t.address.slice(slash + 1)}` : `${core.id}:${t.address}`,
      parentKey: t.parent ? this.keyFor(link, owner, t.parent) : null,
      machine: via?.host || name,
      terminal: t,
      linkId: link.config.id,
      address: t.address,
    };
  }

  /** A parent address as the owning core wrote it (`t3`), or as this link sees it (`b/t3`). */
  private keyFor(link: Link, ownerId: string, address: string): string {
    const slash = address.indexOf("/");
    if (slash < 0) return `${ownerId}:${address}`;
    const via = link.machines.find((m) => m.name === address.slice(0, slash));
    return `${via?.id ?? ownerId}:${address.slice(slash + 1)}`;
  }

  /** Every machine a session can start on, each once, preferring a direct line. */
  targets(): Target[] {
    const out = new Map<string, Target>();
    for (const link of this.links.values()) {
      const core = link.conn?.hello.core;
      if (!core) continue;
      out.set(core.id, { coreId: core.id, label: core.name, linkId: link.config.id });
    }
    for (const link of this.links.values()) {
      if (!link.conn) continue;
      for (const m of link.machines) {
        if (m.state !== "connected" || out.has(m.id)) continue;
        out.set(m.id, { coreId: m.id, label: m.host || m.name, linkId: link.config.id, on: m.name });
      }
    }
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Start a session; resolves to its key once the core has it. */
  async run(target: Target, spec: RunSpec): Promise<string> {
    const conn = this.links.get(target.linkId)?.conn;
    if (!conn) throw new Error(`${target.label} is not connected`);
    const result = await conn.call<Terminal>("terminal.run", { ...spec, on: target.on, no_parent: true });
    const local = result.address.includes("/") ? result.address.slice(result.address.indexOf("/") + 1) : result.address;
    return `${target.coreId}:${local}`;
  }

  /** Run a short command on a machine, without a terminal. */
  async exec(target: Target, argv: string[], cwd?: string): Promise<ExecOutput> {
    const conn = this.links.get(target.linkId)?.conn;
    if (!conn) throw new Error(`${target.label} is not connected`);
    const r = await conn.call<{ code: number | null; stdout: string; stderr: string }>(
      "machine.exec",
      { argv, cwd, on: target.on, timeout: 15 },
      30_000,
    );
    return { code: r.code, stdout: utf8Decode(fromBase64(r.stdout ?? "")), stderr: utf8Decode(fromBase64(r.stderr ?? "")) };
  }

  /** Read an API document (such as the Herdr app's layout) on a machine. */
  async doc<T>(target: Target, name: string): Promise<T | null> {
    const conn = this.links.get(target.linkId)?.conn;
    if (!conn) throw new Error(`${target.label} is not connected`);
    const r = await conn.call<{ value: T | null }>("doc.get", { name, on: target.on });
    return r.value;
  }

  /** The place a session runs, to start more there or read its documents. */
  targetOf(key: string): Target | undefined {
    return this.targets().find((t) => key.startsWith(t.coreId + ":"));
  }

  /** Templates a direct link offers; machines reached through another have none here. */
  async templates(target: Target): Promise<{ name: string; description?: string; command?: string }[]> {
    if (target.on) return [];
    const conn = this.links.get(target.linkId)?.conn;
    if (!conn) return [];
    const r = await conn.call<{ templates: { name: string; description?: string; command?: string; error?: string }[] }>("templates.list");
    return r.templates.filter((t) => !t.error);
  }

  private transition(link: Link, e: HcEvent, before: Terminal | undefined) {
    const t = link.terminals.get(e.terminal!);
    if (!t || !before || !link.conn) return;
    let kind: Transition["kind"] | null = null;
    if (e.type === "status" && t.status?.state !== before.status?.state) {
      if (t.status?.state === "blocked") kind = "blocked";
      else if (t.status?.state === "error") kind = "error";
    } else if (e.type === "turn" && e.data?.state !== "blocked") {
      kind = "turn";
    } else if (e.type === "finished") {
      kind = "exited";
    }
    if (!kind) return;
    const session = this.session(link, t);
    // A relayed copy of a terminal some link reaches directly stays quiet.
    if (session.address.includes("/") && this.directlyReached(session.key)) return;
    for (const l of this.transitionListeners) l({ session, kind });
  }

  private directlyReached(key: string): boolean {
    for (const link of this.links.values()) {
      const core = link.conn?.hello.core;
      if (core && key.startsWith(core.id + ":")) return true;
    }
    return false;
  }

  private changed() {
    this.cached = null;
    for (const l of this.listeners) l();
  }
}
