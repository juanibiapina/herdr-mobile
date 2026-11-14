// Keeps the phone's copy of the definition in step with the definition
// machine's home (~/.config/herdr-mobile, or $XDG_CONFIG_HOME/herdr-mobile).
// herdr-core has no file events, so the caller polls: every few seconds while
// the app is in front. Each poll lists checksums and reads only what changed.
import { toBase64 } from "../hc/bytes";
import { isDefinitionPath } from "./definition";
import { planInstall, type Installed } from "./install";
import type { Remote } from "./remote";

/** path → its text, or null when it's gone. Binary files are data: URIs. */
export type Changes = Record<string, string | null>;

const HOME = 'printf %s "${XDG_CONFIG_HOME:-$HOME/.config}/herdr-mobile"';

// Lists the definition: what desktop's watcher would count (files.rs watched()).
// -L follows symlinks, so a home linked from dotfiles (GNU Stow) counts.
const LIST = 'cd "$1" 2>/dev/null || exit 0; find -L layouts mods settings.json -type f ! -path "*/.*" ! -name "*.error" -exec cksum {} + 2>/dev/null; true';

// Lists the whole home, for installing.
const LIST_ALL = 'cd "$1" 2>/dev/null || exit 0; find -L . -type f ! -path "*/.*" ! -name "*.error" -exec cksum {} + 2>/dev/null; true';

const BINARY = /\.(png|jpe?g|gif|webp)$/i;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export function parseListing(out: string): Record<string, string> {
  const sums: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^(\d+) (\d+) (.+)$/);
    if (m) sums[m[3].replace(/^\.\//, "")] = `${m[1]} ${m[2]}`;
  }
  return sums;
}

export class DefinitionSync {
  private home: string | null = null;
  private sums: Record<string, string> = {};
  private busy = false;

  constructor(private remote: Remote) {}

  /** The home's absolute path, once started. */
  get path(): string | null {
    return this.home;
  }

  /** Finds the home, installs the shipped files, and returns every definition file. */
  async start(shipped: Record<string, string>): Promise<Changes> {
    const h = await this.remote.exec(["sh", "-c", HOME]);
    if (h.code !== 0 || !h.stdout) throw new Error(`cannot find the home: ${h.stderr}`);
    this.home = h.stdout;
    await this.install(shipped);
    this.sums = {};
    return (await this.poll()) ?? {};
  }

  /** What changed since the last poll, or null when nothing did (or a poll is running). */
  async poll(): Promise<Changes | null> {
    if (!this.home || this.busy) return null;
    this.busy = true;
    try {
      const out = await this.remote.exec(["sh", "-c", LIST, "list", this.home]);
      const now = parseListing(out.stdout);
      const changes: Changes = {};
      for (const p of Object.keys(this.sums)) if (!(p in now)) changes[p] = null;
      const changed = Object.keys(now).filter((p) => now[p] !== this.sums[p] && isDefinitionPath(p));
      await Promise.all(
        changed.map(async (p) => {
          try {
            changes[p] = await this.readFile(p);
          } catch {
            // Gone between the listing and the read, or unreadable: the next poll sees it.
            delete now[p];
          }
        }),
      );
      this.sums = now;
      return Object.keys(changes).length ? changes : null;
    } finally {
      this.busy = false;
    }
  }

  /** A file in the home: text, or a data: URI for images. */
  async readFile(path: string): Promise<string> {
    const full = `${this.home}/${path}`;
    const ext = path.split(".").pop()!.toLowerCase();
    if (BINARY.test(path)) return `data:${MIME[ext]};base64,${toBase64(await this.remote.readBytes(full))}`;
    return this.remote.read(full);
  }

  /** The .error files there now, as error keys (mods/prs.error → "mods/prs"). */
  async listErrors(): Promise<string[]> {
    if (!this.home) return [];
    const r = await this.remote.exec(["sh", "-c", 'cd "$1" 2>/dev/null && find . -name "*.error" -type f; true', "list", this.home]);
    return r.stdout.split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, "").replace(/\.error$/, ""));
  }

  /** Writes a file in the home. */
  async writeFile(path: string, text: string) {
    if (!this.home) throw new Error("the definition machine is not connected");
    await this.remote.write(`${this.home}/${path}`, text);
  }

  /** Moves a file or folder in the home. */
  async move(from: string, to: string) {
    if (!this.home) throw new Error("the definition machine is not connected");
    const r = await this.remote.exec(["mv", `${this.home}/${from}`, `${this.home}/${to}`]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || `cannot move ${from}`);
  }

  /** Writes <key>.error (settings.error, layouts/main.error, mods/prs.error), or removes it. */
  async writeError(key: string, message: string | null) {
    if (!this.home) return;
    const path = `${this.home}/${key}.error`;
    if (message === null) await this.remote.exec(["rm", "-f", path]);
    else await this.remote.write(path, message.endsWith("\n") ? message : `${message}\n`);
  }

  private async install(shipped: Record<string, string>) {
    const home = this.home!;
    const out = await this.remote.exec(["sh", "-c", LIST_ALL, "list", home]);
    const remote = parseListing(out.stdout);
    let installed: Installed = { files: {} };
    try {
      installed = JSON.parse(await this.remote.read(`${home}/installed.json`));
    } catch {}
    const plan = planInstall(shipped, remote, installed);
    if (!plan.write.length && !plan.rescue.length && !plan.remove.length && JSON.stringify(installed) === JSON.stringify(plan.installed)) return;
    for (const [from, to] of plan.rescue) {
      const r = await this.remote.exec(["mv", `${home}/${from}`, `${home}/${to}`]);
      if (r.code !== 0) throw new Error(`cannot move ${from} aside: ${r.stderr}`);
    }
    for (const p of plan.write) await this.remote.write(`${home}/${p}`, shipped[p]);
    if (plan.remove.length) await this.remote.exec(["rm", "-f", ...plan.remove.map((p) => `${home}/${p}`)]);
    await this.remote.write(`${home}/installed.json`, JSON.stringify(plan.installed, null, 2) + "\n");
  }
}
