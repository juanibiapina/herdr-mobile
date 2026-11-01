import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fleet, useFleet } from "../../src/fleet-store";
import { setViewingSession } from "../../src/notifications";
import { useSettings } from "../../src/settings";
import { TerminalInput, type TerminalInputHandle } from "../../src/terminal/TerminalInput";
import { TerminalView, type TerminalHandle, type TerminalMode } from "../../src/terminal/TerminalView";
import { AgentList } from "../../src/ui/AgentList";
import { SessionActions } from "../../src/ui/SessionActions";
import { SessionStrip } from "../../src/ui/SessionStrip";
import { Sheet, SheetAction } from "../../src/ui/Sheet";
import { useKeyboardHeight } from "../../src/ui/keyboard";
import { sessionDetail, sessionOrder, sessionTitle, waitingOnYou } from "../../src/ui/session-display";
import { colors, radius, space } from "../../src/ui/theme";

export default function SessionScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { sessions } = useFleet();
  const settings = useSettings();
  const route = fleet.route(key);
  const session = route?.session;
  const t = session?.terminal;
  const live = t?.state === "live";
  const [view, setView] = useState<TerminalMode>(settings.defaultMode);
  const [actions, setActions] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const terminal = useRef<TerminalHandle>(null);
  const input = useRef<TerminalInputHandle>(null);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  const order = sessionOrder(sessions);
  // The current one stays in the strip even after it finishes.
  const strip = session && !order.some((x) => x.key === key) ? [session, ...order] : order;
  const waiting = order.filter((x) => waitingOnYou(x) && x.key !== key);

  useEffect(() => {
    setViewingSession(key);
    return () => setViewingSession(null);
  }, [key]);

  const switchTo = (next: string) => {
    setSwitcher(false);
    if (next !== key) router.setParams({ key: next });
  };

  // The next session waiting on you, after this one in list order.
  const nextWaiting = () => {
    const at = order.findIndex((x) => x.key === key);
    const next = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))].find(waitingOnYou);
    if (next) switchTo(next.key);
  };

  const blocked = t?.status?.state === "blocked";

  return (
    <View style={[styles.screen, { paddingBottom: keyboard }]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable onPress={() => setSwitcher(true)} hitSlop={8} style={styles.title} accessibilityRole="button" accessibilityLabel="Switch session">
              <Text style={styles.titleText} numberOfLines={1}>
                {session ? sessionTitle(session) : "Session"} <Text style={styles.chevron}>▾</Text>
              </Text>
              {session && (
                <Text style={[styles.subtitle, blocked && { color: colors.blocked }]} numberOfLines={1}>
                  {session.machine} · {sessionDetail(session)}
                </Text>
              )}
            </Pressable>
          ),
          headerRight: () => (
            <View style={styles.headerRight}>
              {waiting.length > 0 && (
                <Pressable hitSlop={8} onPress={nextWaiting} style={styles.waiting} accessibilityRole="button">
                  <Text style={styles.waitingText}>{waiting.length} waiting ›</Text>
                </Pressable>
              )}
              <Pressable hitSlop={10} onPress={() => setActions(true)} disabled={!session} accessibilityRole="button" accessibilityLabel="Session actions">
                <Text style={styles.menu}>⋯</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      {strip.length > 1 && <SessionStrip sessions={strip} current={key} onSelect={switchTo} />}
      {t && route ? (
        <TerminalView
          ref={terminal}
          conn={route.conn}
          address={route.address}
          cols={t.cols}
          rows={t.rows}
          pid={t.pid}
          mode={view}
          fontSize={settings.fontSize}
          onTap={() => input.current?.openKeyboard()}
        />
      ) : (
        <View style={styles.gone}>
          <Text style={styles.muted}>This session is not reachable right now.</Text>
        </View>
      )}
      {live && route ? (
        <TerminalInput ref={input} sessionKey={key} route={route} terminal={terminal} keyboardHeight={keyboard} />
      ) : (
        <View style={{ height: Math.max(insets.bottom, space.sm) }} />
      )}
      <SessionActions session={actions ? session ?? null : null} onClose={() => setActions(false)}>
        <SheetAction
          label={view === "fit" ? "Show at desktop size" : "Fit to phone"}
          detail={view === "fit" ? "Watch at its own size, scaled down; pinch to zoom" : "Reflow it to the phone's width"}
          onPress={() => {
            setActions(false);
            setView((m) => (m === "fit" ? "full" : "fit"));
          }}
        />
      </SessionActions>
      <Sheet visible={switcher} onClose={() => setSwitcher(false)}>
        <ScrollView style={styles.switcher}>
          <AgentList sessions={sessions} current={key} onSelect={(x) => switchTo(x.key)} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { maxWidth: 210 },
  titleText: { color: colors.text, fontSize: 17, fontWeight: "700" },
  chevron: { color: colors.muted, fontSize: 13 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: space.lg },
  waiting: { backgroundColor: colors.done + "26", borderColor: colors.done, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space.md - 2, paddingVertical: space.xs },
  waitingText: { color: colors.done, fontSize: 13, fontWeight: "700" },
  menu: { color: colors.text, fontSize: 24, lineHeight: 26 },
  switcher: { maxHeight: 520 },
  gone: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.muted },
});
