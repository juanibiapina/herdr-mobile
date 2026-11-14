// The mod engine, both builds: the C core the phone runs
// (modules/mod-engine/cpp, built for this computer and driven through me_cli)
// and the WebAssembly one Node uses (src/mods/engine-wasm.ts). Same cases, same results.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { wasmEngine } from "../src/mods/engine-wasm";

const cpp = join(__dirname, "../modules/mod-engine/cpp");
const dir = mkdtempSync(join(tmpdir(), "mod-engine-"));
const cli = join(dir, "me_cli");

beforeAll(() => {
  execFileSync("cc", ["-O1", "-DNDEBUG", "-D_GNU_SOURCE", "-o", cli, join(cpp, "me_cli.c"), join(cpp, "mod_engine.c"), join(cpp, "quickjs/quickjs-amalgam.c"), "-lm", "-lpthread"]);
}, 240_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The smallest runtime: __dispatch calls a named function with parsed args,
// host calls go to the outbox as promises that "resolve" settles.
const RUNTIME = `
let outbox = [], next = 1, waiting = new Map(), fns = {};
export function host(name, args) {
  const id = next++;
  outbox.push({ id, name, args });
  return new Promise((resolve) => waiting.set(id, resolve));
}
export function expose(f) { Object.assign(fns, f); }
globalThis.__dispatch = (name, args) => {
  if (name === "resolve") { const [id, v] = JSON.parse(args); waiting.get(id)(v); waiting.delete(id); return "null"; }
  return JSON.stringify(fns[name](...JSON.parse(args)) ?? null);
};
globalThis.__drain = () => { const o = JSON.stringify(outbox); outbox = []; return o; };
`;

type Result = { ok: boolean; value?: any; error?: { message: string; name?: string; file?: string; line?: number; stack?: string }; outbox: any[]; jobErrors: any[] };

type Run = (files: Record<string, string>, entry: string, calls?: [string, unknown[]][], memoryLimit?: number) => Promise<Result[]>;

const native: Run = async (files, entry, calls = [], memoryLimit) => {
  const path = join(dir, `files-${Math.random()}.json`);
  writeFileSync(path, JSON.stringify({ runtime: RUNTIME, ...files }));
  const env = memoryLimit ? { ME_MEMORY_LIMIT: String(memoryLimit) } : {};
  const out = execFileSync(cli, [path, entry, ...calls.flatMap(([n, a]) => [n, JSON.stringify(a)])], { encoding: "utf8", env: { ...process.env, ...env } });
  return out.trim().split("\n").map((l) => JSON.parse(l));
};

const wasm: Run = async (files, entry, calls = [], memoryLimit) => {
  const engine = await wasmEngine({ memoryLimit });
  const out: Result[] = [await engine.load({ runtime: RUNTIME, ...files }, entry)] as Result[];
  for (const [n, a] of calls) out.push((await engine.call(n, a)) as Result);
  await engine.dispose();
  return out;
};

describe.each([
  ["native C core", native],
  ["WebAssembly", wasm],
] as const)("%s", (_name, run) => {
test("loads modules with relative imports and calls into them", async () => {
  const [load, call] = await run(
    {
      "main.js": `import { expose } from "runtime"; import { double } from "./lib/math.js"; expose({ twice: (n) => double(n) });`,
      "lib/math.js": `import { one } from "./one.js"; export const double = (n) => n * 2 * one;`,
      "lib/one.js": `export const one = 1;`,
    },
    "main.js",
    [["twice", [21]]],
  );
  expect(load.ok).toBe(true);
  expect(call).toMatchObject({ ok: true, value: 42 });
});

test("a syntax error names its file and line", async () => {
  const [load] = await run({ "main.js": `import "./bad.js";`, "bad.js": "export default class {\n render() {\n return div(\n }\n}" }, "main.js");
  expect(load.ok).toBe(false);
  expect(load.error).toMatchObject({ name: "SyntaxError", file: "bad.js", line: 4 });
});

test("a missing import says which", async () => {
  const [load] = await run({ "main.js": `import "./nope.js";` }, "main.js");
  expect(load.error?.message).toContain("nope.js");
});

test("a thrown error in a call carries its stack", async () => {
  const [, call] = await run({ "main.js": `import { expose } from "runtime";\nexpose({ boom() {\n throw new Error("kaboom");\n } });` }, "main.js", [["boom", []]]);
  expect(call.ok).toBe(false);
  expect(call.error?.message).toBe("kaboom");
  expect(call.error?.stack).toContain("main.js:3");
});

test("host calls leave through the outbox and come back as resolved promises", async () => {
  const [, ask, resolve, read] = await run(
    { "main.js": `import { expose, host } from "runtime"; let got = null; expose({ ask() { host("exec", ["uptime"]).then((v) => { got = v; }); }, read: () => got });` },
    "main.js",
    [["ask", []], ["resolve", [1, "up 3 days"]], ["read", []]],
  );
  expect(ask.outbox).toEqual([{ id: 1, name: "exec", args: ["uptime"] }]);
  expect(resolve.ok).toBe(true);
  expect(read.value).toBe("up 3 days");
});

test("a runaway loop is stopped after its budget and the engine stays usable", async () => {
  const start = Date.now();
  const [, spin, after] = await run({ "main.js": `import { expose } from "runtime"; expose({ spin() { for (;;) {} }, ping: () => "pong" });` }, "main.js", [["spin", []], ["ping", []]]);
  const took = Date.now() - start;
  expect(spin.ok).toBe(false);
  expect(spin.error?.message).toContain("interrupted");
  expect(took).toBeLessThan(2000);
  expect(after.value).toBe("pong");
});

test("a mod that allocates without end hits the memory limit", async () => {
  const [, grow, after] = await run(
    { "main.js": `import { expose } from "runtime"; const keep = []; expose({ grow() { for (;;) keep.push(new Array(10000).fill(1)); }, ping: () => "pong" });` },
    "main.js",
    [["grow", []], ["ping", []]],
    8 << 20,
  );
  expect(grow.ok).toBe(false);
  expect(grow.error?.message).toMatch(/out of memory|interrupted/);
  expect(after.value).toBe("pong");
});

test("a rejected promise in a job is reported without failing the call", async () => {
  const [, call] = await run({ "main.js": `import { expose } from "runtime"; expose({ later() { Promise.resolve().then(() => { throw new Error("async"); }); return 1; } });` }, "main.js", [["later", []]]);
  expect(call.ok).toBe(true);
  expect(call.value).toBe(1);
});
});
