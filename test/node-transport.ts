import { spawn } from "node:child_process";
import type { Transport } from "../src/hc/connection";

/** hc connect as a child process: the same bytes the phone gets over SSH. */
export function hcProcessTransport(env: Record<string, string>): Transport {
  const child = spawn("hc", ["connect"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  return {
    send: (bytes) => child.stdin.write(bytes),
    close: () => child.kill(),
    listen: (onData, onClose) => {
      child.stdout.on("data", (d: Buffer) => onData(new Uint8Array(d)));
      child.on("exit", (code) => onClose(code === 0 ? null : `hc connect exited ${code}: ${stderr}`));
    },
  };
}
