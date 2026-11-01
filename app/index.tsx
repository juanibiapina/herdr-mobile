import { Link, Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fleet, useFleet, useMachines } from "../src/fleet-store";
import type { Session } from "../src/hc/fleet";
import { AgentList } from "../src/ui/AgentList";
import { Button } from "../src/ui/Button";
import { Dot } from "../src/ui/Dot";
import { explainError, linkColor } from "../src/ui/machine-display";
import { SessionActions } from "../src/ui/SessionActions";
import { matches } from "../src/ui/session-display";
import { TextField } from "../src/ui/TextField";
import { colors, radius, space } from "../src/ui/theme";
import { applyUpdate, useUpdates } from "../src/updates";

export default function Agents() {
  const { links, sessions } = useFleet();
  const { machines, loaded } = useMachines();
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<Session | null>(null);
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = useUpdates();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const visible = sessions.filter((s) => matches(s, query));
  const anyLive = visible.some((s) => s.terminal.state === "live");
  const down = links.filter((l) => l.state !== "connected");
  const connected = links.some((l) => l.state === "connected");

  const open = (s: Session) => router.push({ pathname: "/session/[key]", params: { key: s.key } });

  const clearFinished = (finished: Session[]) =>
    Alert.alert(`Remove ${finished.length} finished sessions?`, "Their output is forgotten.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          for (const s of finished) {
            const r = fleet.route(s.key);
            r?.conn.call("terminal.rm", { terminal: r.address }).catch(() => {});
          }
        },
      },
    ]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel="Settings">
                <Text style={styles.headerIcon}>⚙</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => fleet.reconnect()} tintColor={colors.muted} />}
        keyboardShouldPersistTaps="handled"
      >
        {loaded && machines.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No machines yet</Text>
            <Text style={styles.emptyText}>Add a machine that runs herdr-core to see its agents here.</Text>
            <Button title="Add a machine" onPress={() => router.push("/machines")} style={styles.emptyButton} />
          </View>
        )}

        {isUpdatePending && (
          <Pressable style={[styles.banner, styles.update]} onPress={() => void applyUpdate()} accessibilityRole="button">
            <Text style={styles.bannerText}>A new version is ready</Text>
            <Text style={styles.updateAction}>Restart</Text>
          </Pressable>
        )}

        {down.length > 0 && (
          <Link href="/machines" asChild>
            <Pressable style={styles.banner} accessibilityRole="button">
              <Dot color={down.some((l) => l.state !== "connecting") ? colors.blocked : linkColor("connecting")} />
              <Text style={styles.bannerText} numberOfLines={2}>
                {down.length > 1
                  ? `${down.length} machines are not connected`
                  : `${down[0].config.name}: ${down[0].state === "connecting" ? "connecting…" : explainError(down[0].error, down[0].config) || "offline"}`}
              </Text>
            </Pressable>
          </Link>
        )}

        {sessions.length > 6 && <TextField style={styles.search} value={query} onChangeText={setQuery} placeholder="Search" />}

        <AgentList sessions={visible} onSelect={open} onLongPress={setMenu} onClearFinished={clearFinished} />

        {machines.length > 0 && connected && !anyLive && !query && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing running</Text>
            <Text style={styles.emptyText}>Start a shell or an agent on one of your machines.</Text>
          </View>
        )}
        {query && visible.length === 0 && <Text style={[styles.emptyText, styles.noMatch]}>Nothing matches “{query}”.</Text>}
      </ScrollView>

      {connected && <Button title="＋ New session" onPress={() => router.push("/new")} style={[styles.fab, { bottom: insets.bottom + 20 }]} />}
      <SessionActions session={menu} onClose={() => setMenu(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.md, paddingTop: space.lg },
  headerIcon: { color: colors.text, fontSize: 22 },
  search: { marginBottom: 14 },
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md - 2 },
  bannerText: { color: colors.text, fontSize: 14, flex: 1 },
  update: { backgroundColor: colors.accent + "22", borderColor: colors.accent, borderWidth: 1 },
  updateAction: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  empty: { alignItems: "center", marginTop: 60, gap: space.md - 2, paddingHorizontal: space.xl },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  emptyButton: { marginTop: space.sm },
  noMatch: { marginTop: space.xl },
  fab: { position: "absolute", right: 20, borderRadius: radius.full, paddingHorizontal: 20, boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)" },
});
