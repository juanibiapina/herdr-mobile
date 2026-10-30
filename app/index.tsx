import { Link, Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fleet, useFleet, useMachines } from "../src/fleet-store";
import type { Session } from "../src/hc/fleet";
import { AgentList } from "../src/ui/AgentList";
import { SessionActions } from "../src/ui/SessionActions";
import { ago, matches, sessionTitle } from "../src/ui/session-display";
import { explainError } from "../src/ui/connection-error";
import { colors } from "../src/ui/theme";
import { applyUpdate, useUpdates } from "../src/updates";

export default function Agents() {
  const { links, sessions } = useFleet();
  const { machines, loaded } = useMachines();
  const [query, setQuery] = useState("");
  const [showFinished, setShowFinished] = useState(false);
  const [menu, setMenu] = useState<Session | null>(null);
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = useUpdates();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const visible = sessions.filter((s) => matches(s, query));
  const live = visible.filter((s) => s.terminal.state === "live");
  const finished = visible.filter((s) => s.terminal.state === "finished").sort((a, b) => (b.terminal.finished_ms ?? 0) - (a.terminal.finished_ms ?? 0));
  const offline = links.filter((l) => l.state !== "connected");
  const connected = links.some((l) => l.state === "connected");

  const open = (s: Session) => router.push({ pathname: "/session/[key]", params: { key: s.key } });

  const clearFinished = () =>
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
            <View style={styles.headerRight}>
              <Link href="/machines" asChild>
                <Pressable hitSlop={10}>
                  <Text style={styles.headerButton}>Machines</Text>
                </Pressable>
              </Link>
              <Link href="/settings" asChild>
                <Pressable hitSlop={10}>
                  <Text style={styles.headerIcon}>⚙</Text>
                </Pressable>
              </Link>
            </View>
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
            <Text style={[styles.muted, styles.centerText]}>Add a machine that runs herdr-core to see its agents here.</Text>
            <Link href="/machines" asChild>
              <Pressable style={styles.primary}>
                <Text style={styles.primaryText}>Add a machine</Text>
              </Pressable>
            </Link>
          </View>
        )}

        {isUpdatePending && (
          <Pressable style={styles.update} onPress={() => void applyUpdate()}>
            <Text style={styles.updateText}>A new version is ready</Text>
            <Text style={styles.updateAction}>Restart</Text>
          </Pressable>
        )}

        {offline.map((l) => (
          <Link key={l.config.id} href="/machines" asChild>
            <Pressable style={styles.banner}>
              <View style={[styles.bannerDot, { backgroundColor: l.state === "connecting" ? colors.working : colors.blocked }]} />
              <Text style={styles.bannerText} numberOfLines={2}>
                {l.config.name}: {l.state === "connecting" ? "connecting…" : explainError(l.error, l.config) || "offline"}
              </Text>
            </Pressable>
          </Link>
        ))}

        {sessions.length > 6 && (
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}

        <AgentList sessions={live} onSelect={open} onLongPress={setMenu} />

        {machines.length > 0 && connected && live.length === 0 && !query && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing running</Text>
            <Text style={[styles.muted, styles.centerText]}>Start a shell or an agent on one of your machines.</Text>
          </View>
        )}
        {query && visible.length === 0 && <Text style={[styles.muted, styles.centerText, { marginTop: 24 }]}>Nothing matches “{query}”.</Text>}

        {finished.length > 0 && (
          <View style={styles.finished}>
            <View style={styles.finishedHead}>
              <Pressable onPress={() => setShowFinished((v) => !v)} hitSlop={8} style={styles.flex}>
                <Text style={styles.finishedTitle}>
                  {showFinished ? "▾" : "▸"} Finished <Text style={styles.count}>{finished.length}</Text>
                </Text>
              </Pressable>
              {showFinished && (
                <Pressable onPress={clearFinished} hitSlop={8}>
                  <Text style={styles.clear}>Clear</Text>
                </Pressable>
              )}
            </View>
            {showFinished &&
              finished.map((s) => (
                <Pressable key={s.key} style={({ pressed }) => [styles.finishedRow, pressed && { backgroundColor: colors.surface }]} onPress={() => open(s)} onLongPress={() => setMenu(s)}>
                  <Text style={styles.finishedName} numberOfLines={1}>
                    {sessionTitle(s)} <Text style={styles.count}>· {s.machine} · exited{s.terminal.exit_code != null ? ` ${s.terminal.exit_code}` : ""}</Text>
                  </Text>
                  <Text style={styles.count}>{ago(s.terminal.finished_ms)}</Text>
                </Pressable>
              ))}
          </View>
        )}
      </ScrollView>

      {connected && (
        <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={() => router.push("/new")}>
          <Text style={styles.fabText}>＋ New session</Text>
        </Pressable>
      )}
      <SessionActions session={menu} onClose={() => setMenu(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingTop: 16 },
  flex: { flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 20 },
  headerButton: { color: colors.accent, fontSize: 16 },
  headerIcon: { color: colors.text, fontSize: 22 },
  search: { color: colors.text, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, marginBottom: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  count: { color: colors.muted, fontWeight: "400" },
  finished: { marginTop: 4 },
  finishedHead: { flexDirection: "row", alignItems: "center", marginBottom: 6, marginLeft: 4 },
  finishedTitle: { color: colors.muted, fontFamily: "monospace", fontSize: 15, fontWeight: "700" },
  clear: { color: colors.blocked, fontSize: 14 },
  finishedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10 },
  finishedName: { flex: 1, color: colors.muted, fontFamily: "monospace", fontSize: 14 },
  update: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.accent + "22", borderColor: colors.accent, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  updateText: { color: colors.text, fontSize: 14 },
  updateAction: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: 10, padding: 10, marginBottom: 10 },
  bannerDot: { width: 8, height: 8, borderRadius: 4 },
  bannerText: { color: colors.text, fontSize: 13, flex: 1 },
  empty: { alignItems: "center", marginTop: 60, gap: 10, paddingHorizontal: 24 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 14 },
  centerText: { textAlign: "center" },
  primary: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, marginTop: 8 },
  primaryText: { color: "#0d1117", fontWeight: "700", fontSize: 15 },
  fab: { position: "absolute", right: 20, backgroundColor: colors.accent, borderRadius: 28, paddingHorizontal: 20, paddingVertical: 14, elevation: 6 },
  fabText: { color: "#0d1117", fontWeight: "800", fontSize: 16 },
});
