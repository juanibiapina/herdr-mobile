// One connection to a herdr-core: JSON-RPC on channel 0, event and attach
// streams on their own channels. The bytes travel over any Transport (SSH on
// the phone, a child process in tests).
import { utf8Decode, utf8Encode } from "./bytes";
import { CLOSE, CREDIT, DATA, encodeFrame, FrameDecoder, RESIZE, resizePayload, u32, type Frame } from "./frames";
import type { AttachResult, HcEvent, HelloResult, SubscribeResult, Terminal } from "./types";

export interface Transport {
  send(bytes: Uint8Array): void;
  close(): void;
  listen(onData: (bytes: Uint8Array) => void, onClose: (reason: string | null) => void): void;
}

export class HcError extends Error {
  constructor(
    message: string,
    readonly kind?: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type ChannelHandler = { frame: (f: Frame) => void; gone: (reason: string) => void };

export type EventHandlers = {
  onEvent: (e: HcEvent) => void;
  onMissed: (seq: number, terminals: Terminal[]) => void;
};

export type Subscription = { seq: number; terminals: Terminal[]; close: () => void };

export type AttachHandlers = {
  /** The first paint can arrive before attach() returns, so the stream comes along. */
  onData: (bytes: Uint8Array, stream: AttachStream) => void;
  /** The stream ended: the program exited, the terminal was lost, or the line dropped. */
  onClose: (reason: { reason?: string; exit_code?: number | null } | null) => void;
};

export type AttachStream = {
  terminal: Terminal;
  write: (bytes: Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  /** Tell the core the viewer has drawn this many bytes, so it sends more. */
  ack: (bytes: number) => void;
  close: () => void;
};

const CALL_TIMEOUT_MS = 60_000;

export class HcConnection {
  private decoder = new FrameDecoder();
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private channels = new Map<number, ChannelHandler>();
  private early = new Map<number, Frame[]>(); // frames that beat their call's reply
  private closeListeners: ((reason: string) => void)[] = [];
  private closed: string | null = null;

  private constructor(
    private transport: Transport,
    readonly hello: HelloResult,
  ) {}

  /** Handshake in plain mode, then switch the connection to framed mode. */
  static open(transport: Transport, timeoutMs = 20_000): Promise<HcConnection> {
    return new Promise((resolve, reject) => {
      let line = new Uint8Array();
      let conn: HcConnection | null = null;
      const timer = setTimeout(() => {
        transport.close();
        reject(new HcError("herdr-core did not answer", "timeout"));
      }, timeoutMs);

      transport.listen(
        (bytes) => {
          if (conn) return conn.receive(bytes);
          const joined = new Uint8Array(line.length + bytes.length);
          joined.set(line);
          joined.set(bytes, line.length);
          const nl = joined.indexOf(10);
          if (nl < 0) {
            line = joined;
            return;
          }
          clearTimeout(timer);
          let reply: any;
          try {
            reply = JSON.parse(utf8Decode(joined.subarray(0, nl)));
          } catch {
            transport.close();
            return reject(new HcError(`not herdr-core: ${utf8Decode(joined.subarray(0, nl)).slice(0, 200)}`, "protocol"));
          }
          if (reply.error) {
            transport.close();
            return reject(new HcError(reply.error.message, reply.error.data?.kind, reply.error.data?.hint));
          }
          conn = new HcConnection(transport, reply.result);
          resolve(conn);
          const rest = joined.subarray(nl + 1);
          if (rest.length) conn.receive(rest);
        },
        (reason) => {
          clearTimeout(timer);
          if (conn) conn.gone(reason ?? "disconnected");
          else reject(new HcError(reason ?? "connection closed during handshake", "disconnected"));
        },
      );

      const hello = { jsonrpc: "2.0", id: 0, method: "hello", params: { framed: true, generation: 1 } };
      transport.send(utf8Encode(JSON.stringify(hello) + "\n"));
    });
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  onClose(listener: (reason: string) => void): void {
    if (this.closed !== null) listener(this.closed);
    else this.closeListeners.push(listener);
  }

  close(): void {
    this.transport.close();
    this.gone("closed");
  }

  call<T = any>(method: string, params: object = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
    if (this.closed !== null) return Promise.reject(new HcError(this.closed, "disconnected"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HcError(`${method} timed out`, "timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sendJson({ jsonrpc: "2.0", id, method, params });
    });
  }

  async subscribe(params: object, handlers: EventHandlers): Promise<Subscription> {
    const result = await this.call<SubscribeResult>("events.subscribe", params);
    const channel = result.channel!;
    let carry = "";
    this.register(channel, {
      frame: (f) => {
        if (f.kind === DATA) {
          const lines = (carry + utf8Decode(f.payload)).split("\n");
          carry = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            if (msg.method === "event") handlers.onEvent(msg.params);
            else if (msg.method === "missed") handlers.onMissed(msg.params.seq, msg.params.terminals);
          }
          this.send(channel, CREDIT, u32(f.payload.length));
        }
      },
      gone: () => {},
    });
    return {
      seq: result.seq,
      terminals: result.terminals,
      close: () => this.closeChannel(channel),
    };
  }

  async attach(
    params: { terminal: string; cols: number; rows: number; observe?: boolean; history?: number; resumed?: boolean },
    handlers: AttachHandlers,
  ): Promise<AttachStream> {
    const result = await this.call<AttachResult>("terminal.attach", params);
    const channel = result.channel;
    let ended = false;
    const end = (reason: AttachHandlers["onClose"] extends (r: infer R) => void ? R : never) => {
      if (ended) return;
      ended = true;
      this.channels.delete(channel);
      handlers.onClose(reason);
    };
    const stream: AttachStream = {
      terminal: result.terminal,
      write: (bytes) => !ended && this.send(channel, DATA, bytes),
      resize: (cols, rows) => !ended && this.send(channel, RESIZE, resizePayload(cols, rows)),
      ack: (n) => !ended && n > 0 && this.send(channel, CREDIT, u32(n)),
      close: () => {
        if (ended) return;
        this.send(channel, CLOSE);
        end(null);
      },
    };
    this.register(channel, {
      frame: (f) => {
        if (f.kind === DATA) handlers.onData(f.payload, stream);
        else if (f.kind === CLOSE) {
          let reason = null;
          try {
            reason = f.payload.length ? JSON.parse(utf8Decode(f.payload)) : null;
          } catch {}
          end(reason);
        }
      },
      gone: (reason) => end({ reason }),
    });
    return stream;
  }

  private register(channel: number, handler: ChannelHandler) {
    this.channels.set(channel, handler);
    const early = this.early.get(channel);
    if (early) {
      this.early.delete(channel);
      for (const f of early) handler.frame(f);
    }
  }

  private closeChannel(channel: number) {
    if (!this.channels.delete(channel)) return;
    if (this.closed === null) this.send(channel, CLOSE);
  }

  private receive(bytes: Uint8Array) {
    for (const f of this.decoder.push(bytes)) {
      if (f.channel === 0) {
        if (f.kind === DATA) this.reply(JSON.parse(utf8Decode(f.payload)));
        continue;
      }
      const handler = this.channels.get(f.channel);
      if (handler) handler.frame(f);
      else {
        const list = this.early.get(f.channel) ?? [];
        list.push(f);
        this.early.set(f.channel, list);
      }
    }
  }

  private reply(msg: any) {
    if (msg.id === undefined || msg.id === null) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new HcError(msg.error.message, msg.error.data?.kind, msg.error.data?.hint));
    else p.resolve(msg.result);
  }

  private gone(reason: string) {
    if (this.closed !== null) return;
    this.closed = reason;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new HcError(reason, "disconnected"));
    }
    this.pending.clear();
    for (const h of [...this.channels.values()]) h.gone(reason);
    this.channels.clear();
    for (const l of this.closeListeners) l(reason);
    this.closeListeners = [];
  }

  private sendJson(msg: object) {
    this.send(0, DATA, utf8Encode(JSON.stringify(msg)));
  }

  private send(channel: number, kind: number, payload?: Uint8Array) {
    if (this.closed !== null) return;
    this.transport.send(encodeFrame(channel, kind, payload));
  }
}
