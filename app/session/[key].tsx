import * as Clipboard from "expo-clipboard";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fleet, useFleet } from "../../src/fleet-store";
import { utf8Encode } from "../../src/hc/bytes";
import { HcError } from "../../src/hc/connection";
import { setViewingSession } from "../../src/notifications";
import { updateSettings, useSettings } from "../../src/settings";
import { keyBytes } from "../../src/terminal/keys";
import { TerminalView, type TerminalHandle, type TerminalMode } from "../../src/terminal/TerminalView";
import { AgentList } from "../../src/ui/AgentList";
import { SessionActions } from "../../src/ui/SessionActions";
import { SessionStrip } from "../../src/ui/SessionStrip";
import { Sheet } from "../../src/ui/Sheet";
import { sessionOrder, sessionTitle, statusColor, waitingOnYou } from "../../src/ui/session-display";
import { useKeyboardHeight } from "../../src/ui/keyboard";
import { colors } from "../../src/ui/theme";

const KEYS: { label: string; key: string }[] = [
  { label: "esc", key: "esc" },
  { label: "tab", key: "tab" },
  { label: "↑", key: "up" },
  { label: "↓", key: "down" },
  { label: "←", key: "left" },
  { label: "→", key: "right" },
  { label: "⏎", key: "enter" },
  { label: "^C", key: "ctrl+c" },
  { label: "paste", key: "paste" },
  { label: "⇧tab", key: "shift+tab" },
  { label: "^D", key: "ctrl+d" },
  { label: "^R", key: "ctrl+r" },
  { label: "^L", key: "ctrl+l" },
  { label: "^Z", key: "ctrl+z" },
  { label: "1", key: "1" },
  { label: "2", key: "2" },
  { label: "3", key: "3" },
  { label: "y", key: "y" },
  { label: "n", key: "n" },
  { label: "home", key: "home" },
  { label: "end", key: "end" },
  { label: "PgUp", key: "pageup" },
  { label: "PgDn", key: "pagedown" },
];

export default function SessionScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { sessions } = useFleet();
  const settings = useSettings();
  const route = fleet.route(key);
  const session = route?.session;
  const t = session?.terminal;
  const live = t?.state === "live";
  const [view, setView] = useState<TerminalMode>(settings.defaultMode);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const message = settings.inputMode === "message";
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
    setCtrl(false);
    resetMirror();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const terminal = useRef<TerminalHandle>(null);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  useEffect(() => {
    setViewingSession(key);
    return () => setViewingSession(null);
  }, [key]);

  const fail = (e: unknown) => Alert.alert("Could not reach it", e instanceof Error ? e.message : String(e));

  // Raw bytes on the attach stream: instant, and hc's "someone is typing" hold
  // doesn't apply to them. Named keys through hc only when not attached yet.
  const pressKey = (name: string) => {
    resetMirror();
    terminal.current?.scrollToBottom();
    if (name === "paste") return void paste();
    if (ctrl && name.length === 1) {
      setCtrl(false);
      name = `ctrl+${name}`;
    }
    const bytes = utf8Encode(keyBytes(name, terminal.current?.appCursor() ?? false));
    if (!terminal.current?.write(bytes) && route) {
      route.conn.call("terminal.keys", { terminal: route.address, keys: [name] }).catch(fail);
    }
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

  // Direct typing: a hidden field takes the keyboard; what changes in it goes to
  // the terminal as bytes (new text as typed, removed text as backspaces).
  const typeRaw = (chars: string) => {
    if (!chars) return;
    let out = chars.replace(/\n/g, "\r");
    if (ctrl && out.length === 1 && /[a-z@\[\]\\^_ ]/i.test(out)) {
      const c = out.toLowerCase().charCodeAt(0);
      out = String.fromCharCode(c === 0x20 ? 0 : c & 0x1f);
      setCtrl(false);
    }
    const bytes = utf8Encode(out);
    terminal.current?.scrollToBottom();
    if (!terminal.current?.write(bytes) && route) {
      const names = [...out].map((c) => ({ " ": "space", "\x7f": "backspace", "\r": "enter" })[c] ?? c);
      route.conn.call("terminal.keys", { terminal: route.address, keys: names }).catch(fail);
    }
  };

  // The clipboard as one paste: wrapped when the program asked for bracketed paste,
  // so a multi-line paste doesn't run line by line.
  const paste = async () => {
    const text = (await Clipboard.getStringAsync()).replace(/\r?\n/g, "\r");
    if (!text) return;
    const wrapped = terminal.current?.bracketedPaste() ? `\x1b[200~${text}\x1b[201~` : text;
    if (!terminal.current?.write(utf8Encode(wrapped)) && route) {
      route.conn.call("terminal.send", { terminal: route.address, text }).catch(fail);
    }
  };

  const capture = useRef<TextInput>(null);
  const mirror = useRef("");
  const resetMirror = () => {
    mirror.current = "";
    capture.current?.clear();
  };

  const onCaptureChange = (next: string) => {
    const prev = mirror.current;
    mirror.current = next;
    let common = 0;
    while (common < prev.length && common < next.length && prev[common] === next[common]) common++;
    const erase = prev.length - common;
    if (erase > 0) typeRaw("\x7f".repeat(erase));
    const added = next.slice(common);
    if (added) typeRaw(added);
    // Enter arrives as a newline (the field is multiline so the keyboard stays
    // open): the line went to the terminal, so start the mirror over.
    if (added.includes("\n")) resetMirror();
  };

  // Android keeps a hidden field focused after the keyboard is dismissed; blur
  // first so focusing opens the keyboard again.
  const openKeyboard = () => {
    if (message) return;
    const input = capture.current;
    if (!input) return;
    if (input.isFocused()) {
      input.blur();
      setTimeout(() => input.focus(), 60);
    } else input.focus();
  };

  const setMode = (next: "direct" | "message") => {
    resetMirror();
    setCtrl(false);
    void updateSettings({ inputMode: next });
    if (next === "direct") setTimeout(openKeyboard, 80);
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
                onPress={() => setView((m) => (m === "fit" ? "full" : "fit"))}
              >
                <Text style={styles.headerButton}>{view === "fit" ? "Full" : "Fit"}</Text>
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
          mode={view}
          fontSize={settings.fontSize}
          onTap={openKeyboard}
        />
      ) : (
        <View style={styles.gone}>
          <Text style={styles.muted}>This session is not reachable right now.</Text>
        </View>
      )}
      {live && (
        <>
          <ScrollView horizontal style={styles.keybar} contentContainerStyle={styles.keybarContent} keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
            <KeyButton label={message ? "⌨" : "✉"} onPress={() => setMode(message ? "direct" : "message")} />
            {!message && keyboard === 0 && <KeyButton label="keyboard" onPress={openKeyboard} />}
            <KeyButton label="ctrl" active={ctrl} onPress={() => setCtrl((c) => !c)} />
            {KEYS.map((k) => (
              <KeyButton key={k.label} label={k.label} onPress={() => pressKey(k.key)} />
            ))}
          </ScrollView>
          {message ? (
            <View style={[styles.composer, { paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 8) }]}>
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
                <Text style={styles.sendText}>{sending ? "…" : "Send"}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ height: keyboard ? 0 : Math.max(insets.bottom, 4) }}>
              <TextInput
                key={settings.directKeyboard}
                ref={capture}
                style={styles.capture}
                keyboardType={settings.directKeyboard === "literal" ? "visible-password" : "default"}
                defaultValue=""
                onChangeText={onCaptureChange}
                onKeyPress={(e) => e.nativeEvent.key === "Backspace" && mirror.current === "" && typeRaw("\x7f")}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                importantForAutofill="no"
                caretHidden
              />
            </View>
          )}
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
  capture: { position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, color: "transparent" },
  send: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 16, height: 36, justifyContent: "center" },
  sendText: { color: "#0d1117", fontWeight: "700" },
});
