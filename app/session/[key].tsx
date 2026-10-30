import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fleet, useFleet } from "../../src/fleet-store";
import { utf8Encode } from "../../src/hc/bytes";
import { HcError } from "../../src/hc/connection";
import { setViewingSession } from "../../src/notifications";
import { useSettings } from "../../src/settings";
import { TerminalView, type TerminalHandle, type TerminalMode } from "../../src/terminal/TerminalView";
import { AgentList } from "../../src/ui/AgentList";
import { SessionActions } from "../../src/ui/SessionActions";
import { SessionStrip } from "../../src/ui/SessionStrip";
import { Sheet } from "../../src/ui/Sheet";
import { sessionOrder, sessionTitle, statusColor, waitingOnYou } from "../../src/ui/session-display";
import { useKeyboardHeight } from "../../src/ui/keyboard";
import { colors } from "../../src/ui/theme";

const KEYS: { label: string; keys: string[] }[] = [
  { label: "esc", keys: ["esc"] },
  { label: "⏎", keys: ["enter"] },
  { label: "↑", keys: ["up"] },
  { label: "↓", keys: ["down"] },
  { label: "←", keys: ["left"] },
  { label: "→", keys: ["right"] },
  { label: "tab", keys: ["tab"] },
  { label: "⇧tab", keys: ["shift+tab"] },
  { label: "^C", keys: ["ctrl+c"] },
  { label: "^D", keys: ["ctrl+d"] },
  { label: "^R", keys: ["ctrl+r"] },
  { label: "1", keys: ["1"] },
  { label: "2", keys: ["2"] },
  { label: "3", keys: ["3"] },
  { label: "y", keys: ["y"] },
  { label: "n", keys: ["n"] },
  { label: "PgUp", keys: ["pageup"] },
  { label: "PgDn", keys: ["pagedown"] },
];

export default function SessionScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { sessions } = useFleet();
  const settings = useSettings();
  const route = fleet.route(key);
  const session = route?.session;
  const t = session?.terminal;
  const live = t?.state === "live";
  const [mode, setMode] = useState<TerminalMode>(settings.defaultMode);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [actions, setActions] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const order = sessionOrder(sessions);
  // The current one stays in the strip even after it finishes.
  const strip = session && !order.some((x) => x.key === key) ? [session, ...order] : order;
  const waiting = order.filter((x) => waitingOnYou(x) && x.key !== key);

  const switchTo = (next: string) => {
    setSwitcher(false);
    if (next !== key) router.setParams({ key: next });
  };

  // Next session waiting on you, after this one in list order.
  const nextWaiting = () => {
    const at = order.findIndex((x) => x.key === key);
    const after = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))];
    const next = after.find(waitingOnYou);
    if (next) switchTo(next.key);
  };

  useEffect(() => {
    setText("");
    setTyping(false);
    setCtrl(false);
  }, [key]);
  const terminal = useRef<TerminalHandle>(null);
  const raw = useRef<TextInput>(null);
  const rawText = useRef("");
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  useEffect(() => {
    setViewingSession(key);
    return () => setViewingSession(null);
  }, [key]);

  const fail = (e: unknown) => Alert.alert("Could not reach it", e instanceof Error ? e.message : String(e));

  const pressKeys = (keys: string[]) => {
    if (!route) return;
    route.conn.call("terminal.keys", { terminal: route.address, keys }).catch(fail);
  };

  const send = async (force = false) => {
    if (!route || !text.trim()) return;
    setSending(true);
    try {
      await route.conn.call("terminal.send", { terminal: route.address, text, force });
      setText("");
    } catch (e) {
      if (!force && e instanceof HcError && /block/i.test(`${e.kind} ${e.message}`)) {
        Alert.alert("It is waiting on a question", "Typing now may answer its dialog.", [
          { text: "Cancel", style: "cancel" },
          { text: "Send anyway", onPress: () => void send(true) },
        ]);
      } else fail(e);
    } finally {
      setSending(false);
    }
  };

  // Direct typing: every change goes to the terminal as bytes.
  const typeRaw = (chars: string) => {
    if (!chars) return;
    let bytes: Uint8Array;
    if (ctrl && chars.length === 1) {
      const c = chars.toLowerCase().charCodeAt(0);
      bytes = new Uint8Array([c >= 0x60 && c < 0x80 ? c & 0x1f : c]);
      setCtrl(false);
    } else {
      bytes = utf8Encode(chars.replace(/\n/g, "\r"));
    }
    if (!terminal.current?.write(bytes)) {
      // Not attached for typing yet: press them as named keys instead.
      const names = [...chars].map((c) => ({ " ": "space", "\x7f": "backspace", "\r": "enter", "\n": "enter" })[c] ?? c);
      if (route) route.conn.call("terminal.keys", { terminal: route.address, keys: names }).catch(fail);
    }
  };

  // The field keeps what was typed; send only what changed since last time.
  const onRawChange = (next: string) => {
    const prev = rawText.current;
    rawText.current = next;
    let common = 0;
    while (common < prev.length && common < next.length && prev[common] === next[common]) common++;
    const erase = prev.length - common;
    if (erase > 0) typeRaw("\x7f".repeat(erase));
    const added = next.slice(common);
    if (added) typeRaw(added);
  };

  const onRawSubmit = () => {
    typeRaw("\r");
    rawText.current = "";
    raw.current?.clear();
  };

  const toggleTyping = () => {
    rawText.current = "";
    setTyping((on) => {
      if (!on) setMode("fit");
      return !on;
    });
    setCtrl(false);
  };

  return (
    <View style={[styles.screen, { paddingBottom: keyboard }]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable onPress={() => setSwitcher(true)} hitSlop={8} style={styles.titleButton}>
              <Text style={styles.titleText} numberOfLines={1}>
                {session ? sessionTitle(session) : "Session"}
              </Text>
              <Text style={styles.titleChevron}>▾</Text>
            </Pressable>
          ),
          headerRight: () => (
            <View style={styles.headerRight}>
              {waiting.length > 0 && (
                <Pressable hitSlop={8} onPress={nextWaiting} style={styles.waitingButton}>
                  <Text style={styles.waitingText}>{waiting.length} waiting ›</Text>
                </Pressable>
              )}
              <Pressable
                hitSlop={10}
                onPress={() => {
                  setMode((m) => (m === "fit" ? "full" : "fit"));
                  setTyping(false);
                }}
              >
                <Text style={styles.headerButton}>{mode === "fit" ? "Full" : "Fit"}</Text>
              </Pressable>
              <Pressable hitSlop={10} onPress={() => setActions(true)} disabled={!session}>
                <Text style={styles.headerMenu}>⋯</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      {strip.length > 1 && <SessionStrip sessions={strip} current={key} onSelect={switchTo} />}
      {session && (
        <Pressable style={styles.status} onPress={() => setActions(true)}>
          <View style={[styles.dot, { backgroundColor: statusColor(t?.status?.state) }, !t?.status && styles.dotHollow]} />
          <Text style={[styles.statusText, t?.status?.state === "blocked" && { color: colors.blocked }]} numberOfLines={2}>
            {session.machine} ·{" "}
            {!live ? "finished" : t?.status ? [t.status.state, t.status.msg].filter(Boolean).join(" · ") : t?.foreground?.name ?? "running"}
          </Text>
        </Pressable>
      )}
      {t ? (
        <TerminalView
          ref={terminal}
          conn={route?.conn ?? null}
          address={route!.address}
          cols={t.cols}
          rows={t.rows}
          pid={t.pid}
          mode={mode}
          fontSize={settings.fontSize}
        />
      ) : (
        <View style={styles.gone}>
          <Text style={styles.muted}>This session is not reachable right now.</Text>
        </View>
      )}
      {live && (
        <>
          <ScrollView horizontal style={styles.keybar} contentContainerStyle={styles.keybarContent} keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
            <KeyButton label={typing ? "✉ Message" : "⌨ Type"} active={typing} onPress={toggleTyping} />
            {typing && <KeyButton label="ctrl" active={ctrl} onPress={() => setCtrl((c) => !c)} />}
            {KEYS.map((k) => (
              <KeyButton key={k.label} label={k.label} onPress={() => pressKeys(k.keys)} />
            ))}
          </ScrollView>
          <View style={[styles.composer, { paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 8) }]}>
            {typing ? (
              <TextInput
                key="raw"
                ref={raw}
                style={[styles.input, styles.rawInput]}
                autoFocus
                onChangeText={onRawChange}
                onKeyPress={(e) => e.nativeEvent.key === "Backspace" && rawText.current === "" && typeRaw("\x7f")}
                onSubmitEditing={onRawSubmit}
                submitBehavior="submit"
                placeholder={ctrl ? "ctrl + next key" : "Keys go straight to the terminal"}
                placeholderTextColor={ctrl ? colors.working : colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                keyboardType="visible-password"
              />
            ) : (
              <>
                <TextInput
                  key="message"
                  style={styles.input}
                  value={text}
                  onChangeText={setText}
                  placeholder="Message"
                  placeholderTextColor={colors.muted}
                  multiline
                />
                <Pressable style={[styles.send, (!text.trim() || sending) && { opacity: 0.4 }]} disabled={!text.trim() || sending} onPress={() => void send()}>
                  <Text style={styles.sendText}>Send</Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      )}
      {!live && t && <View style={{ height: Math.max(insets.bottom, 8) }} />}
      <SessionActions session={actions ? session ?? null : null} onClose={() => setActions(false)} />
      <Sheet visible={switcher} onClose={() => setSwitcher(false)}>
        <ScrollView style={styles.switcher}>
          <AgentList sessions={sessions} current={key} onSelect={(x) => switchTo(x.key)} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

function KeyButton({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.key, active && styles.keyActive, pressed && styles.keyPressed]} onPress={onPress}>
      <Text style={[styles.keyText, active && styles.keyTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  titleButton: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 170 },
  titleText: { color: colors.text, fontSize: 18, fontWeight: "700", flexShrink: 1 },
  titleChevron: { color: colors.muted, fontSize: 14 },
  waitingButton: { backgroundColor: colors.done + "26", borderColor: colors.done, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  waitingText: { color: colors.done, fontSize: 13, fontWeight: "700" },
  switcher: { maxHeight: 520 },
  headerButton: { color: colors.accent, fontSize: 15 },
  headerMenu: { color: colors.text, fontSize: 24, lineHeight: 26 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotHollow: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.idle },
  statusText: { color: colors.muted, fontSize: 13, flex: 1 },
  gone: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.muted },
  keybar: { flexGrow: 0, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  keybarContent: { paddingHorizontal: 6, paddingVertical: 6, gap: 6 },
  key: { minWidth: 40, paddingHorizontal: 10, height: 34, borderRadius: 6, backgroundColor: colors.surfaceHigh, alignItems: "center", justifyContent: "center" },
  keyActive: { backgroundColor: colors.accent },
  keyPressed: { backgroundColor: colors.border },
  keyText: { color: colors.text, fontSize: 15, fontFamily: "monospace" },
  keyTextActive: { color: "#0d1117", fontWeight: "700" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 8, paddingTop: 8, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 120, color: colors.text, backgroundColor: colors.bg, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15 },
  rawInput: { fontFamily: "monospace" },
  send: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 16, height: 36, justifyContent: "center" },
  sendText: { color: "#0d1117", fontWeight: "700" },
});
