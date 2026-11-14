// check.mjs as agents run it: `node check.mjs` in a home written from the
// shipped definition, then broken in the ways agents break things.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { DEFAULT_FILES } from "../src/definition/defaults.generated";

const homes: string[] = [];
afterAll(() => homes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function home(changes: Record<string, string | null> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hm-home-"));
  homes.push(dir);
  const files: Record<string, string | null> = { ...DEFAULT_FILES, ...changes };
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function check(dir: string, ...args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync("node", [join(dir, "check.mjs"), ...args], { encoding: "utf8" }) };
  } catch (e: any) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
}

test("the shipped definition passes", () => {
  const r = check(home());
  expect(r).toMatchObject({ code: 0 });
  expect(r.out).toMatch(/^ok: \d+ mods, 1 layout/);
});

test("a syntax error in a mod's module names the file and line", () => {
  const r = check(home({
    "mods/prs/main.js": 'import { View, div } from "herdr-ui";\nimport { rows } from "./rows.js";\nexport default class P extends View { render() { return div().children(rows()); } }',
    "mods/prs/rows.js": "export function rows() {\n  return [\n}\n",
  }));
  expect(r.code).toBe(1);
  expect(r.out).toContain("mods/prs/rows.js:3:");
});

// QuickJS-ng reports the enclosing function's line for errors it raises itself
// (a missing variable, a property of null); a `throw` reports its own line.
test("a render that fails names the function it failed in", () => {
  const r = check(home({ "mods/prs/main.js": 'import { View } from "herdr-ui";\nexport default class P extends View {\n  render() {\n    return undefinedThing.x;\n  }\n}' }));
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/mods\/prs\/main\.js:3: undefinedThing is not defined/);
});

test("a layout naming a missing mod, and bad settings", () => {
  const layout = JSON.parse(DEFAULT_FILES["layouts/main.json"]);
  layout.root.children[0].screen.content.mod = "nope";
  const r = check(home({ "layouts/main.json": JSON.stringify(layout), "settings.json": '{ "layout": "main", "zoom": 2 }' }));
  expect(r.code).toBe(1);
  expect(r.out).toContain('layouts/main.json: root.children[0].screen.content.mod: no mod named "nope" in mods/');
  expect(r.out).toContain('settings.json: unknown field "zoom"');
});

test("only the mods named are loaded", () => {
  const r = check(home({ "mods/broken/main.js": "oops(" }), "spaces");
  expect(r.code).toBe(0);
  expect(r.out).toContain("ok: 1 mod,");
});
