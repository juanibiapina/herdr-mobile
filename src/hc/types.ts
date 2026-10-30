// The parts of the herdr-core API (hc schema) this app reads.

export type Status = {
  state: string; // idle, working, done, blocked, error
  app?: string;
  msg?: string;
  title?: string;
  kind?: string | null;
  progress?: number | null;
};

export type Foreground = { pid?: number; name?: string; argv?: string[]; cwd?: string } | null;

export type Terminal = {
  address: string;
  name?: string | null;
  argv: string[];
  cwd: string;
  state: "live" | "finished" | string;
  created_ms: number;
  finished_ms?: number | null;
  title?: string;
  status?: Status | null;
  status_ms?: number | null;
  foreground?: Foreground;
  labels: Record<string, string>;
  cols: number;
  rows: number;
  parent?: string | null;
  template?: string | null;
  reason?: string | null;
  exit_code?: number | null;
  turn?: number;
  keep?: boolean;
  pid?: number | null;
};

export type CoreInfo = { id: string; name: string };

export type HelloResult = {
  generation: number;
  version: string;
  core: CoreInfo;
  framed: boolean;
  methods: string[];
  features: string[];
};

export type MachineView = {
  name: string;
  id: string;
  host: string;
  state: string; // connecting, connected, needs_login, unreachable
  temporary?: boolean;
};

export type ListResult = { terminals: Terminal[]; hidden_finished: number; machines: MachineView[] };

export type HcEvent = {
  seq: number;
  type: string;
  terminal?: string;
  machine?: string;
  data: any;
};

export type SubscribeResult = { seq: number; channel?: number | null; terminals: Terminal[] };

export type AttachResult = { channel: number; terminal: Terminal };
