import type { Session } from "../hc/fleet";
import { colors } from "./theme";

export function statusColor(state: string | undefined): string {
  switch (state) {
    case "working":
      return colors.working;
    case "blocked":
      return colors.blocked;
    case "error":
      return colors.error;
    case "done":
    case "idle":
      return colors.done;
    default:
      return colors.idle;
  }
}

/** What a person would call it: its name, the agent's own title, or the program. */
export function sessionTitle(s: Session): string {
  const t = s.terminal;
  return t.name || t.status?.title || t.title || t.foreground?.name || t.argv[0] || t.address;
}

export function sessionDetail(s: Session): string {
  const t = s.terminal;
  if (t.state === "finished") return `exited${t.exit_code != null ? ` (${t.exit_code})` : ""}`;
  const parts = [t.status?.state, t.status?.msg || (t.status ? undefined : t.foreground?.name)].filter(Boolean);
  return parts.join(" · ") || "running";
}

export function folderOf(s: Session): string {
  return s.terminal.foreground?.cwd || s.terminal.cwd;
}

/** /home/me/x and /Users/me/x both read as ~/x. */
export function shortPath(path: string): string {
  return path.replace(/^\/(home|Users)\/[^/]+/, "~");
}

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export type Section = { id: string; title: string; color: string; sessions: Session[] };

/** The program's own name for itself (claude, pi), else what runs in it. */
export function appName(s: Session): string {
  const t = s.terminal;
  return t.status?.app || t.template || t.foreground?.name || t.argv[0] || "shell";
}

/** The folder's last part: the project. */
export function projectName(s: Session): string {
  const path = folderOf(s).replace(/\/+$/, "");
  return shortPath(path) === "~" ? "~" : path.slice(path.lastIndexOf("/") + 1) || "/";
}

/** What it is doing: the agent's title, the terminal's title, or its name. */
export function taskName(s: Session): string {
  const t = s.terminal;
  const title = t.status?.title || t.title || t.name || "";
  return title === projectName(s) ? "" : title;
}

/**
 * Live sessions by state, the way Herdr's Agents panel shows them: what needs
 * you, what waits for your next message, what works, then plain terminals.
 */
export function sections(sessions: Session[]): Section[] {
  const live = sessions.filter((s) => s.terminal.state === "live");
  const recent = (a: Session, b: Session) => (b.terminal.status_ms ?? b.terminal.created_ms) - (a.terminal.status_ms ?? a.terminal.created_ms);
  const by = (states: string[]) => live.filter((s) => states.includes(s.terminal.status?.state ?? "")).sort(recent);
  const known = ["blocked", "error", "idle", "done", "working"];
  return [
    { id: "blocked", title: "Needs you", color: colors.blocked, sessions: by(["blocked", "error"]) },
    { id: "idle", title: "Idle", color: colors.done, sessions: by(["idle", "done"]) },
    { id: "working", title: "Working", color: colors.working, sessions: by(["working"]) },
    {
      id: "other",
      title: "Terminals",
      color: colors.muted,
      sessions: live.filter((s) => !known.includes(s.terminal.status?.state ?? "")).sort((a, b) => b.terminal.created_ms - a.terminal.created_ms),
    },
  ].filter((x) => x.sessions.length > 0);
}

export const needsYou = (s: Session) => s.terminal.state === "live" && (s.terminal.status?.state === "blocked" || s.terminal.status?.state === "error");

/** An agent that is not working: blocked on you, failed, or done and waiting for your next message. */
export const waitingOnYou = (s: Session) =>
  s.terminal.state === "live" && ["blocked", "error", "idle", "done"].includes(s.terminal.status?.state ?? "");

/** Live sessions in the order the list shows them, for switching between them. */
export function sessionOrder(sessions: Session[]): Session[] {
  return sections(sessions).flatMap((x) => x.sessions);
}

export function matches(s: Session, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = s.terminal;
  return [sessionTitle(s), s.machine, folderOf(s), t.argv.join(" "), t.status?.msg, t.status?.app, t.foreground?.name]
    .filter(Boolean)
    .some((v) => v!.toLowerCase().includes(q));
}
