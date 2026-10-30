// What went wrong reaching a machine, and what to do about it.
import type { MachineConfig } from "../hc/fleet";

export function explainError(raw: string | undefined, m: MachineConfig): string | undefined {
  if (!raw) return raw;
  const r = raw.toLowerCase();
  if (r.includes("host_key_changed")) return `${m.host} presents a different host key than before. If you reinstalled it, trust the new key.`;
  if (r.includes("auth fail") || r.includes("auth cancel") || r.includes("publickey"))
    return `${m.user}@${m.host} refused this phone's key. Add the key below to ~/.ssh/authorized_keys there.`;
  if (r.includes("unknownhost") || r.includes("unable to resolve") || r.includes("no address associated"))
    return `Can't find "${m.host}". Is Tailscale on? Its 100.x address works when the name doesn't.`;
  if (r.includes("connection refused")) return `${m.host} refused the connection on port ${m.port}. Is SSH running there?`;
  if (r.includes("timeout") || r.includes("timed out") || r.includes("network is unreachable") || r.includes("no route"))
    return `${m.host} doesn't answer. Is it on, and is Tailscale connected on both ends?`;
  if (r.includes("herdr-core is not installed") || r.includes("exited 127"))
    return `herdr-core isn't installed on ${m.host} (looked on PATH and in ~/.local/bin).`;
  if (r.includes("did not answer")) return `SSH connected, but herdr-core on ${m.host} didn't answer.`;
  return raw;
}
