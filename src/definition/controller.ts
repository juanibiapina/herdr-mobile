// The app's definition: cached on the phone, synced from the definition
// machine while the app is in front, errors written back as .error files.
import { File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { fleet } from "../fleet-store";
import type { Target } from "../hc/fleet";
import { getSettings, onSettings } from "../settings";
import { DEFAULT_FILES } from "./defaults.generated";
import { DEFAULT_SETTINGS, isDefinitionPath } from "./definition";
import { remoteOf } from "./remote";
import { DefinitionStore, type DefinitionView, type Saved } from "./store";
import { DefinitionSync } from "./sync";

export const SHIPPED_DEFINITION = Object.fromEntries(Object.entries(DEFAULT_FILES).filter(([p]) => isDefinitionPath(p)));

const cache = new File(Paths.document, "definition.json");

function loadSaved(): Saved {
  try {
    if (cache.exists) return JSON.parse(cache.textSync());
  } catch {}
  return { files: SHIPPED_DEFINITION, good: { settings: DEFAULT_SETTINGS, layouts: {}, mods: {} } };
}

export const definition = new DefinitionStore(loadSaved());

export type SyncStatus = {
  /** The definition machine's name in Machines, or null when there's none. */
  machine: string | null;
  state: "none" | "offline" | "starting" | "synced" | "failed";
  error: string | null;
  home: string | null;
  syncedAt: number | null;
};

let status: SyncStatus = { machine: null, state: "none", error: null, home: null, syncedAt: null };
const statusListeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore((l) => (statusListeners.add(l), () => statusListeners.delete(l)), () => status);
}

export function useDefinition(): DefinitionView {
  return useSyncExternalStore((l) => definition.subscribe(l), () => definition.current);
}

let sync: DefinitionSync | null = null;
let syncedCore: string | null = null;
let started = false;

const POLL_MS = 3000;

type Poller = { timer?: ReturnType<typeof setInterval>; appState?: { remove(): void } };
const poller: Poller = ((globalThis as { __herdrDefinitionPoller?: Poller }).__herdrDefinitionPoller ??= {});

/** The definition machine's link: the one chosen in Settings, else the first. */
export function definitionLink(): string | null {
  const links = fleet.snapshot().links;
  const chosen = getSettings().definitionMachine;
  if (chosen && links.some((l) => l.config.id === chosen)) return chosen;
  return links[0]?.config.id ?? null;
}

/** The definition machine as a place to run things, when connected. */
export function definitionTarget(): Target | null {
  const id = definitionLink();
  const link = fleet.snapshot().links.find((l) => l.config.id === id);
  if (!link?.core || link.state !== "connected") return null;
  return fleet.targets().find((t) => t.coreId === link.core!.id && !t.on) ?? null;
}

function machineName(): string | null {
  const id = definitionLink();
  const link = fleet.snapshot().links.find((l) => l.config.id === id);
  return link ? (link.core?.name ?? link.config.name) : null;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      cache.write(JSON.stringify(definition.saved()));
    } catch {}
  }, 500);
}

let writing = false;
async function writeErrors() {
  if (writing || !sync || status.state !== "synced") return;
  writing = true;
  try {
    for (const [key, text] of Object.entries(definition.pendingErrors())) {
      await sync.writeError(key, text);
      definition.markWritten(key, text);
    }
  } catch {
  } finally {
    writing = false;
  }
}

async function begin(target: Target) {
  const s = new DefinitionSync(remoteOf(fleet, target));
  sync = s;
  syncedCore = target.coreId;
  setStatus({ state: "starting", error: null, machine: machineName() });
  try {
    const files = await s.start(DEFAULT_FILES);
    if (sync !== s) return;
    definition.replace(Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== null)));
    definition.forgetWritten(await s.listErrors());
    save();
    setStatus({ state: "synced", home: s.path, syncedAt: Date.now() });
    void writeErrors();
  } catch (e) {
    if (sync !== s) return;
    sync = null;
    syncedCore = null;
    setStatus({ state: "failed", error: e instanceof Error ? e.message : String(e) });
  }
}

function check() {
  const target = definitionTarget();
  if (!target) {
    if (sync) {
      sync = null;
      syncedCore = null;
    }
    setStatus({ state: definitionLink() ? "offline" : "none", machine: machineName() });
    return;
  }
  if (!sync || syncedCore !== target.coreId) void begin(target);
}

async function poll() {
  if (AppState.currentState !== "active") return;
  check();
  const s = sync;
  if (!s || status.state !== "synced") return;
  try {
    const changes = await s.poll();
    if (changes && sync === s) {
      definition.apply(changes);
      save();
    }
    setStatus({ syncedAt: Date.now() });
  } catch {}
}

function schedule(active: boolean) {
  clearInterval(poller.timer);
  poller.timer = undefined;
  if (!active) return;
  void poll();
  poller.timer = setInterval(() => void poll(), POLL_MS);
}

/** Starts syncing; call once at app start. Polls every few seconds, only while the app is in front. */
export function startDefinition() {
  if (started) return;
  started = true;
  definition.subscribe(() => void writeErrors());
  fleet.subscribe(() => check());
  onSettings(() => check());
  poller.appState?.remove();
  poller.appState = AppState.addEventListener("change", (state) => schedule(state === "active"));
  schedule(AppState.currentState === "active");
  check();
}

function need(): DefinitionSync {
  if (!sync || status.state !== "synced") throw new Error("the definition machine is not connected");
  return sync;
}

/** Commands about the definition (src/commands.ts). */
export const definitionCommands = {
  async switchLayout(name: string) {
    const s = need();
    if (!definition.current.layouts[name] && !definition.file(`layouts/${name}.json`)) throw new Error(`no layouts/${name}.json`);
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(definition.file("settings.json") ?? "{}");
    } catch {}
    await s.writeFile("settings.json", JSON.stringify({ ...settings, layout: name }, null, 2) + "\n");
    await poll();
  },
  async cloneLayout(name: string, as?: string) {
    const s = need();
    const text = definition.file(`layouts/${name}.json`);
    if (text === undefined) throw new Error(`no layouts/${name}.json`);
    const to = as ?? `${name}-copy`;
    if (definition.file(`layouts/${to}.json`) !== undefined) throw new Error(`layouts/${to}.json already exists`);
    await s.writeFile(`layouts/${to}.json`, text);
    await poll();
    await definitionCommands.switchLayout(to);
    return to;
  },
  async cloneMod(name: string, as?: string) {
    const s = need();
    const mod = definition.current.mods[name];
    if (!mod) throw new Error(`no mod named ${name}`);
    const to = as ?? `${name}-copy`;
    if (definition.current.mods[to]) throw new Error(`mods/${to} already exists`);
    for (const [p, text] of Object.entries(mod.files)) await s.writeFile(`mods/${to}/${p}`, text.split(`mods/${name}/`).join(`mods/${to}/`));
    await poll();
    return to;
  },
  /** Puts a shipped layout back as shipped. Without a name, the escape hatch: back to the shipped main layout, shown. */
  async resetLayout(name?: string) {
    const s = need();
    const which = name ?? "main";
    const shipped = DEFAULT_FILES[`layouts/${which}.json`];
    if (shipped === undefined) throw new Error(`${which} is not a shipped layout`);
    const now = definition.file(`layouts/${which}.json`);
    if (now !== undefined && now !== shipped) await s.move(`layouts/${which}.json`, `layouts/${which}.json.old-${Date.now()}`);
    if (now !== shipped) await s.writeFile(`layouts/${which}.json`, shipped);
    await poll();
    if (!name && definition.current.settings.layout !== "main") await definitionCommands.switchLayout("main");
  },
  async reload() {
    sync = null;
    syncedCore = null;
    check();
  },
};

/** What to paste into an agent so it learns what it can change. */
export function agentPrompt(machine: string | null): string {
  const m = machine ?? "<definition machine>";
  return `Read ~/.config/herdr-mobile/AGENTS.md on ${m} (from another machine: \`hc file read --on ${m} ~/.config/herdr-mobile/AGENTS.md\`), then tell me what you can change in Herdr Mobile.`;
}

