import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { TerminalMode } from "./terminal/TerminalView";

export type Settings = {
  fontSize: number;
  defaultMode: TerminalMode;
  notifyBlocked: boolean;
  notifyTurn: boolean;
  notifyExit: boolean;
  /** Keep a foreground service so connections and notifications live while the app is closed. */
  background: boolean;
  /** Label new sessions so the Herdr desktop app shows them. */
  showInHerdr: boolean;
  /** How the bottom bar takes input: keys straight to the terminal, or a message hc pastes. */
  inputMode: "direct" | "message";
  /** Direct typing: "literal" sends exactly the keys pressed (no autocorrect); "standard" keeps swipe and suggestions. */
  directKeyboard: "literal" | "standard";
};

const DEFAULTS: Settings = {
  fontSize: 12,
  defaultMode: "fit",
  notifyBlocked: true,
  notifyTurn: true,
  notifyExit: true,
  background: true,
  showInHerdr: true,
  inputMode: "direct",
  directKeyboard: "literal",
};
const KEY = "settings.v1";

let current: Settings = DEFAULTS;
const listeners = new Set<() => void>();

export async function loadSettings() {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw) current = { ...DEFAULTS, ...JSON.parse(raw) };
  listeners.forEach((l) => l());
}

export function getSettings(): Settings {
  return current;
}

export async function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  listeners.forEach((l) => l());
  await AsyncStorage.setItem(KEY, JSON.stringify(current));
}

export function onSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(onSettings, getSettings);
}
