import { HcSsh } from "../../modules/hc-ssh";
import type { Transport } from "../hc/connection";
import { fromBase64, toBase64 } from "../hc/bytes";
import type { MachineConfig } from "../hc/fleet";
import { hostKeys } from "../storage";

// The line hc itself runs on a machine it adds (crates/herdr-core/src/machines.rs),
// plus Homebrew's folder, which a non-interactive macOS login may leave off PATH.
const HC_CONNECT =
  "sh -c 'p=$(command -v herdr-core) || { for d in $HOME/.local/bin /opt/homebrew/bin /usr/local/bin; do [ -x $d/herdr-core ] && p=$d/herdr-core && break; done; }; " +
  '[ -x "$p" ] || { echo "herdr-core is not installed on this machine" >&2; exit 127; }; exec "$p" connect\'';

type Handlers = { data: (b: Uint8Array) => void; close: (reason: string | null) => void };
const handlers = new Map<string, Handlers>();
const early = new Map<string, Uint8Array[]>();

HcSsh.addListener("onData", ({ id, data }) => {
  const bytes = fromBase64(data);
  const h = handlers.get(id);
  if (h) h.data(bytes);
  else early.set(id, [...(early.get(id) ?? []), bytes]);
});
HcSsh.addListener("onClose", ({ id, reason }) => {
  const h = handlers.get(id);
  handlers.delete(id);
  early.delete(id);
  h?.close(reason);
});

let counter = 0;

/** Opens SSH to the machine and runs hc connect there. */
export async function openSshTransport(config: MachineConfig): Promise<Transport> {
  const id = `${config.id}-${++counter}`;
  const hostId = `${config.host}:${config.port}`;
  const known = await hostKeys.get(hostId);
  const { hostKey } = await HcSsh.open(id, config.host, config.port, config.user, HC_CONNECT, known);
  if (!known && hostKey) await hostKeys.set(hostId, hostKey);
  return {
    send: (bytes) => HcSsh.write(id, toBase64(bytes)),
    close: () => HcSsh.close(id),
    listen: (onData, onClose) => {
      handlers.set(id, { data: onData, close: onClose });
      for (const b of early.get(id) ?? []) onData(b);
      early.delete(id);
    },
  };
}

export const phonePublicKey = () => HcSsh.publicKey();
