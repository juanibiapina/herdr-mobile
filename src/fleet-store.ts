// The app's one Fleet, its saved machines, and hooks to read it.
import { useSyncExternalStore } from "react";
import { Fleet, type MachineConfig } from "./hc/fleet";
import { openSshTransport } from "./ssh/ssh-transport";
import { loadMachines, saveMachines } from "./storage";

export const fleet = new Fleet(openSshTransport);

let machines: MachineConfig[] = [];
let loaded = false;
const listeners = new Set<() => void>();

export async function startFleet() {
  if (loaded) return;
  machines = await loadMachines();
  loaded = true;
  fleet.setMachines(machines);
  listeners.forEach((l) => l());
}

export async function setMachines(next: MachineConfig[]) {
  machines = next;
  await saveMachines(next);
  fleet.setMachines(next);
  listeners.forEach((l) => l());
}

export function useFleet() {
  return useSyncExternalStore(
    (l) => fleet.subscribe(l),
    () => fleet.snapshot(),
  );
}

export function useMachines(): { machines: MachineConfig[]; loaded: boolean } {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (loaded ? machines : null),
  );
  return { machines: state ?? [], loaded: state !== null };
}
