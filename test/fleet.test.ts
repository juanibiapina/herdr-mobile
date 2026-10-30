// Two scratch cores on this box: A has added B as a machine (like a laptop
// that added a server). The phone must show B's terminals once, from either route.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { utf8Decode } from "../src/hc/bytes";
import { Fleet, type MachineConfig, type Transition } from "../src/hc/fleet";
import { hcProcessTransport } from "./node-transport";

const scratch = mkdtempSync(join(tmpdir(), "hm-fleet-"));
const base = {
  XDG_STATE_HOME: join(scratch, "state"),
  XDG_RUNTIME_DIR: join(scratch, "run"),
  XDG_CONFIG_HOME: join(scratch, "config"),
};
const envFor = (session: string) => ({ ...process.env, ...base, HC_SESSION: session });
const hc = (session: string, ...args: string[]) => execFileSync("hc", args, { env: envFor(session), encoding: "utf8" });

const A: MachineConfig = { id: "a", name: "a", host: "hma", port: 22, user: "me" };
const B: MachineConfig = { id: "b", name: "b", host: "hmb", port: 22, user: "me" };
const open = async (c: MachineConfig) => hcProcessTransport({ ...base, HC_SESSION: c.host });
const fleets: Fleet[] = [];

function until<T>(check: () => T | undefined | false, ms = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const v = check();
      if (v) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error("timed out"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

let bAddress: string;

beforeAll(() => {
  mkdirSync(base.XDG_RUNTIME_DIR, { recursive: true });
  hc("hmb", "server", "start");
  hc("hma", "machine", "add", "--name", "b", "--session", "hmb", "--via", "sh -c");
  const run = JSON.parse(hc("hmb", "run", "--bg", "--json", "--name", "worker", "cat"));
  bAddress = run.terminal?.address ?? run.address;
}, 30_000);

afterAll(() => {
  for (const f of fleets) f.stop();
  for (const s of ["hma", "hmb"]) {
    try {
      hc(s, "server", "stop");
    } catch {}
  }
  rmSync(scratch, { recursive: true, force: true });
});

test("a machine reached only through another shows its terminals", async () => {
  const fleet = new Fleet(open);
  fleets.push(fleet);
  fleet.setMachines([A]);
  const s = await until(() => fleet.snapshot().sessions.find((x) => x.terminal.name === "worker"));
  expect(s.address).toBe(`b/${bAddress}`);

  let screen = "";
  const route = fleet.route(s.key)!;
  const stream = await route.conn.attach(
    { terminal: route.address, cols: 80, rows: 24 },
    { onData: (b) => (screen += utf8Decode(b)), onClose: () => {} },
  );
  await route.conn.call("terminal.send", { terminal: route.address, text: "via-a" });
  await until(() => screen.includes("via-a"));
  stream.close();
}, 30_000);

test("a terminal reached two ways is listed once, by its direct route", async () => {
  const fleet = new Fleet(open);
  fleets.push(fleet);
  const transitions: Transition[] = [];
  fleet.onTransition((t) => transitions.push(t));
  fleet.setMachines([A, B]);
  await until(() => fleet.snapshot().links.every((l) => l.state === "connected"));
  await until(() => fleet.snapshot().sessions.some((x) => x.terminal.name === "worker"));
  // Let A's relayed copy arrive too before counting.
  await until(() => fleet.snapshot().links.find((l) => l.config.id === "a")!.machines.length > 0);

  const workers = fleet.snapshot().sessions.filter((x) => x.terminal.name === "worker");
  expect(workers).toHaveLength(1);
  expect(workers[0].linkId).toBe("b");
  expect(workers[0].address).toBe(bAddress);

  hc("hmb", "kill", bAddress);
  await until(() => transitions.find((t) => t.kind === "exited"));
  expect(transitions.filter((t) => t.kind === "exited")).toHaveLength(1);
}, 30_000);

test("starts sessions anywhere it reaches, nests children, and keeps finished ones", async () => {
  const fleet = new Fleet(open);
  fleets.push(fleet);
  fleet.setMachines([A]);
  await until(() => fleet.snapshot().links[0].state === "connected" && fleet.targets().length === 2 && fleet.targets());

  const b = fleet.targets().find((x) => x.on === "b")!;
  expect(b).toBeTruthy();
  const out = await fleet.exec(b, ["sh", "-c", "echo $HC_SESSION"]);
  expect(out.stdout.trim()).toBe("hmb");

  const key = await fleet.run(b, { argv: ["cat"], name: "started-from-phone", cwd: "/tmp" });
  const s = await until(() => fleet.snapshot().sessions.find((x) => x.key === key));
  expect(s.terminal.name).toBe("started-from-phone");
  expect(s.terminal.cwd).toBe("/tmp");

  const route = fleet.route(key)!;
  const child = await route.conn.call("terminal.run", { argv: ["cat"], on: "b", parent: s.address.split("/")[1] });
  const childLocal = child.address.split("/").pop();
  const c = await until(() => fleet.snapshot().sessions.find((x) => x.key.endsWith(":" + childLocal)));
  expect(c.parentKey).toBe(key);

  await route.conn.call("terminal.kill", { terminal: route.address });
  const done = await until(() => fleet.snapshot().sessions.find((x) => x.key === key && x.terminal.state === "finished"));
  expect(done).toBeTruthy();

  // A fresh connection still shows it until it is removed.
  const again = new Fleet(open);
  fleets.push(again);
  again.setMachines([A]);
  await until(() => again.snapshot().sessions.find((x) => x.key === key && x.terminal.state === "finished"));
  await again.route(key)!.conn.call("terminal.rm", { terminal: again.route(key)!.address });
  await until(() => !again.snapshot().sessions.some((x) => x.key === key));
}, 40_000);
