// Placing sessions in the Herdr desktop app. Herdr shows a terminal when it
// carries herdr.space and herdr.tab labels with ids local to its machine; it
// keeps each machine's spaces in that core's "herdr-app" document, and makes a
// new space or tab for an id it doesn't know. (herdr-app's AGENTS.md)
import type { Fleet, Target } from "./hc/fleet";

type Space = { id: string; folder?: string };

const newId = (prefix: string) =>
  prefix + Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

async function spaces(fleet: Fleet, target: Target): Promise<Space[]> {
  try {
    const doc = await fleet.doc<{ spaces?: Space[] }>(target, "herdr-app");
    return doc?.spaces ?? [];
  } catch {
    return [];
  }
}

/** Labels that put a session in a new tab: in the space for its folder, or a new space. */
export async function herdrLabels(fleet: Fleet, target: Target, cwd: string): Promise<Record<string, string>> {
  const within = (s: Space) => !!s.folder && (cwd === s.folder || cwd.startsWith(s.folder.replace(/\/$/, "") + "/"));
  const space = (await spaces(fleet, target)).filter(within).sort((a, b) => b.folder!.length - a.folder!.length)[0];
  return { "herdr.space": space?.id ?? newId("sp"), "herdr.tab": newId("tb") };
}
