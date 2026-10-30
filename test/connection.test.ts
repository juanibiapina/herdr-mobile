// Talks to a real herdr-core in a scratch session and scratch state, so it
// never sees or touches the user's terminals.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { utf8Decode } from "../src/hc/bytes";
import { HcConnection } from "../src/hc/connection";
import type { HcEvent } from "../src/hc/types";
import { hcProcessTransport } from "./node-transport";

const scratch = mkdtempSync(join(tmpdir(), "hm-"));
const env = {
  HC_SESSION: "hmtest",
  XDG_STATE_HOME: join(scratch, "state"),
  XDG_RUNTIME_DIR: join(scratch, "run"),
  XDG_CONFIG_HOME: join(scratch, "config"),
};
let conn: HcConnection;

beforeAll(async () => {
  execFileSync("mkdir", ["-p", env.XDG_RUNTIME_DIR], {});
  conn = await HcConnection.open(hcProcessTransport(env));
});

afterAll(() => {
  conn?.close();
  try {
    execFileSync("hc", ["server", "stop"], { env: { ...process.env, ...env } });
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
});

function until<T>(check: () => T | undefined, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error("timed out"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

test("handshake reports the core", () => {
  expect(conn.hello.framed).toBe(true);
  expect(conn.hello.core.id).toMatch(/\w+/);
  expect(conn.hello.methods).toContain("terminal.attach");
});

test("events, attach, typing and exit work end to end", async () => {
  const events: HcEvent[] = [];
  const sub = await conn.subscribe({}, { onEvent: (e) => events.push(e), onMissed: () => {} });

  const run = await conn.call("terminal.run", { argv: ["cat"], name: "hm-cat", no_parent: true });
  const address: string = run.terminal?.address ?? run.address;
  expect(address).toMatch(/^t\d+$/);
  await until(() => events.find((e) => e.type === "created" && e.terminal === address));

  let screen = "";
  let closed: any = undefined;
  const stream = await conn.attach(
    { terminal: address, cols: 80, rows: 24 },
    {
      onData: (b, s) => {
        screen += utf8Decode(b);
        s.ack(b.length);
      },
      onClose: (r) => (closed = r ?? "none"),
    },
  );

  await conn.call("terminal.send", { terminal: address, text: "hello-from-phone" });
  await until(() => (screen.includes("hello-from-phone") ? true : undefined));

  stream.write(new Uint8Array([0x61, 0x62, 0x0d])); // "ab" + enter, typed raw
  await until(() => (screen.split("ab").length > 2 ? true : undefined));

  await conn.call("terminal.keys", { terminal: address, keys: ["ctrl+d"] });
  await until(() => closed);
  expect(closed.reason).toBe("exited");
  await until(() => events.find((e) => e.type === "finished" && e.terminal === address));
  sub.close();
}, 30_000);
