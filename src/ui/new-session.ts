// What the New session screen needs from a machine: its folders to browse,
// the folders you used there before, and the agents and templates it has.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { fleet } from "../fleet-store";
import type { Session, Target } from "../hc/fleet";

/** Interactive agents this app knows how to hand a first task to. */
export const AGENTS: { cmd: string; label: string; task?: (t: string) => string[] }[] = [
  { cmd: "claude", label: "Claude Code", task: (t) => [t] },
  { cmd: "pi", label: "pi", task: (t) => [t] },
  { cmd: "codex", label: "Codex", task: (t) => [t] },
  { cmd: "opencode", label: "opencode", task: (t) => ["--prompt", t] },
  { cmd: "gemini", label: "Gemini", task: (t) => ["-i", t] },
  { cmd: "amp", label: "Amp" },
  { cmd: "aider", label: "aider" },
  { cmd: "goose", label: "goose" },
];

const RECENT = "recent-folders.v1";
const LAST_TARGET = "last-target.v1";

// Resolves the path (with ~) and lists its folders, in one round trip.
const BROWSE =
  'p="$1"; case "$p" in "~") p="$HOME";; "~/"*) p="$HOME/${p#\\~/}";; esac; ' +
  'cd -- "$p" 2>/dev/null || { echo "no such folder: $1" >&2; exit 1; }; pwd; ' +
  'for d in .[!.]*/ *; do [ -d "$d" ] && echo "${d%/}"; done 2>/dev/null; true';

async function recentFolders(): Promise<Record<string, string[]>> {
  return JSON.parse((await AsyncStorage.getItem(RECENT)) ?? "{}");
}

export async function lastTarget(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_TARGET);
}

/** Remembers a folder you started something in, first among that machine's recent folders. */
export async function rememberStart(coreId: string, folder: string) {
  const all = await recentFolders();
  all[coreId] = [folder, ...(all[coreId] ?? []).filter((p) => p !== folder)].slice(0, 8);
  await AsyncStorage.multiSet([
    [RECENT, JSON.stringify(all)],
    [LAST_TARGET, coreId],
  ]);
}

export type FolderBrowser = {
  /** What the path field shows; edit it and call browse(path). */
  path: string;
  setPath: (p: string) => void;
  /** The folder being shown, as the machine resolved it. */
  resolved: string | null;
  dirs: string[];
  error: string | null;
  browsing: boolean;
  recent: string[];
  browse: (to: string) => void;
  up: () => void;
  open: (dir: string) => void;
};

/**
 * Browses a machine's folders. Starts at the given folder, else the most
 * recent one there (saved, or of its sessions), else ~.
 */
export function useFolderBrowser(target: Target | undefined, sessions: Session[], start?: { coreId?: string; cwd?: string }): FolderBrowser {
  const [path, setPath] = useState(start?.cwd ?? "");
  const [resolved, setResolved] = useState<string | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const request = useRef(0);

  const browse = useCallback(
    async (to: string) => {
      if (!target) return;
      const id = ++request.current;
      setBrowsing(true);
      setError(null);
      try {
        const out = await fleet.exec(target, ["sh", "-c", BROWSE, "_", to.trim() || "~"]);
        if (out.code !== 0) throw new Error(out.stderr.trim() || "could not open that folder");
        if (id !== request.current) return;
        const [where, ...rest] = out.stdout.split("\n").filter(Boolean);
        setResolved(where);
        setPath(where);
        setDirs(rest.sort((a, b) => a.localeCompare(b)));
      } catch (e) {
        if (id === request.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === request.current) setBrowsing(false);
      }
    },
    [target],
  );

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    (async () => {
      const fromSessions = sessions
        .filter((s) => s.key.startsWith(target.coreId + ":"))
        .sort((a, b) => b.terminal.created_ms - a.terminal.created_ms)
        .map((s) => s.terminal.foreground?.cwd || s.terminal.cwd);
      const saved = (await recentFolders())[target.coreId] ?? [];
      if (cancelled) return;
      const all = [...new Set([...saved, ...fromSessions])].slice(0, 8);
      setRecent(all);
      const first = start?.cwd && start.coreId === target.coreId ? start.cwd : all[0] ?? "~";
      setPath(first);
      void browse(first);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.coreId]);

  return {
    path,
    setPath,
    resolved,
    dirs,
    error,
    browsing,
    recent,
    browse: (to) => void browse(to),
    up: () => resolved && void browse(resolved.replace(/\/[^/]+\/?$/, "") || "/"),
    open: (dir) => resolved && void browse(`${resolved === "/" ? "" : resolved}/${dir}`),
  };
}

/** The agents from AGENTS installed on a machine, and its templates. */
export function useLaunchers(target: Target | undefined): { agents: string[]; templates: { name: string; description?: string }[] } {
  const [agents, setAgents] = useState<string[]>([]);
  const [templates, setTemplates] = useState<{ name: string; description?: string }[]>([]);
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const probe = `for c in ${AGENTS.map((a) => a.cmd).join(" ")}; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done; true`;
    fleet.exec(target, ["sh", "-c", probe]).then(
      (out) => !cancelled && setAgents(out.stdout.split("\n").filter(Boolean)),
      () => !cancelled && setAgents([]),
    );
    fleet.templates(target).then(
      (list) => !cancelled && setTemplates(list),
      () => !cancelled && setTemplates([]),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.coreId]);
  return { agents, templates };
}
