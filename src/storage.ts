import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MachineConfig } from "./hc/fleet";

const MACHINES = "machines.v1";
const HOST_KEYS = "host-keys.v1";

export async function loadMachines(): Promise<MachineConfig[]> {
  const raw = await AsyncStorage.getItem(MACHINES);
  return raw ? JSON.parse(raw) : [];
}

export async function saveMachines(machines: MachineConfig[]): Promise<void> {
  await AsyncStorage.setItem(MACHINES, JSON.stringify(machines));
}

/** Host keys seen on first connect, by host:port. */
export const hostKeys = {
  async all(): Promise<Record<string, string>> {
    const raw = await AsyncStorage.getItem(HOST_KEYS);
    return raw ? JSON.parse(raw) : {};
  },
  async get(hostPort: string): Promise<string | null> {
    return (await hostKeys.all())[hostPort] ?? null;
  },
  async set(hostPort: string, key: string): Promise<void> {
    await AsyncStorage.setItem(HOST_KEYS, JSON.stringify({ ...(await hostKeys.all()), [hostPort]: key }));
  },
  async forget(hostPort: string): Promise<void> {
    const all = await hostKeys.all();
    delete all[hostPort];
    await AsyncStorage.setItem(HOST_KEYS, JSON.stringify(all));
  },
};
