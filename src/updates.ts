// Over-the-air updates (EAS Update). The app checks on launch and when it
// returns to the foreground; a downloaded update applies on restart.
import * as Updates from "expo-updates";
import { AppState } from "react-native";

export const updatesEnabled = Updates.isEnabled;

/** Which code is running: the one built into the APK, or a published update. */
export function currentUpdate(): string {
  if (!Updates.isEnabled) return "updates off (development build)";
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return "built in";
  const when = Updates.createdAt ? Updates.createdAt.toISOString().slice(0, 16).replace("T", " ") : "";
  return `update ${Updates.updateId.slice(0, 8)}${when ? ` · ${when} UTC` : ""}`;
}

/** Download a newer update if there is one; resolves true when one is ready to apply. */
export async function fetchUpdate(): Promise<boolean> {
  if (!Updates.isEnabled) return false;
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return false;
  const result = await Updates.fetchUpdateAsync();
  return result.isNew;
}

export const applyUpdate = () => Updates.reloadAsync();

/** Check again whenever the app comes back to the foreground. */
export function startUpdateChecks() {
  if (!Updates.isEnabled) return;
  AppState.addEventListener("change", (s) => {
    if (s === "active") fetchUpdate().catch(() => {});
  });
}

export const useUpdates = Updates.useUpdates;
