import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { fleet, startFleet } from "../src/fleet-store";
import { startBackgroundWatching } from "../src/background";
import { startNotifications } from "../src/notifications";
import { loadSettings } from "../src/settings";
import { startUpdateChecks } from "../src/updates";
import { colors } from "../src/ui/theme";

export default function Layout() {
  useEffect(() => {
    void loadSettings();
    void startFleet();
    void startNotifications();
    startBackgroundWatching();
    startUpdateChecks();
    const sub = AppState.addEventListener("change", (s) => s === "active" && fleet.reconnect());
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Agents" }} />
        <Stack.Screen name="machines" options={{ title: "Machines" }} />
        <Stack.Screen name="session/[key]" options={{ title: "" }} />
        <Stack.Screen name="new" options={{ title: "New session", presentation: "modal" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
