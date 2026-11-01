import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useFleet } from "../src/fleet-store";
import { updateSettings, useSettings, type Settings } from "../src/settings";
import { Row, Section } from "../src/ui/Group";
import { colors, radius, space } from "../src/ui/theme";
import { applyUpdate, currentUpdate, fetchUpdate, updatesEnabled } from "../src/updates";

export default function SettingsScreen() {
  const s = useSettings();
  const { links } = useFleet();
  const up = links.filter((l) => l.state === "connected").length;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section>
        <Row
          label="Machines"
          hint={links.length === 0 ? "None yet" : `${up} of ${links.length} connected · this phone's SSH key`}
          onPress={() => router.push("/machines")}
        />
      </Section>

      <Section title="Terminal">
        <Row label="Text size">
          <View style={styles.stepper}>
            <Small label="A−" onPress={() => void updateSettings({ fontSize: Math.max(8, s.fontSize - 1) })} />
            <Text style={styles.value}>{s.fontSize}</Text>
            <Small label="A+" onPress={() => void updateSettings({ fontSize: Math.min(22, s.fontSize + 1) })} />
          </View>
        </Row>
        <Row
          label="Open sessions at"
          hint={
            s.defaultMode === "fit"
              ? "Phone size: the terminal reflows to fit the phone, and your desktop sees that size until you use it there again."
              : "Full size: watch at your desktop's size, scaled down; pinch to zoom."
          }
        >
          <Segmented value={s.defaultMode} options={[["fit", "Phone"], ["full", "Full"]]} onChange={(v) => void updateSettings({ defaultMode: v })} />
        </Row>
      </Section>

      <Section title="Typing">
        <Row
          label="Keyboard"
          hint={
            s.directKeyboard === "literal"
              ? "Literal: sends exactly the keys you press. The keyboard can't autocorrect commands."
              : "Standard: swipe typing and suggestions, but the keyboard may correct words as you type."
          }
        >
          <Segmented value={s.directKeyboard} options={[["literal", "Literal"], ["standard", "Standard"]]} onChange={(v) => void updateSettings({ directKeyboard: v })} />
        </Row>
      </Section>

      <Section title="Herdr desktop app">
        <Toggle k="showInHerdr" label="Show new sessions there" hint="Sessions you start here get a tab in Herdr, in the space for their folder." s={s} />
      </Section>

      <Section title="Notify me when an agent">
        <Toggle k="notifyBlocked" label="Needs me" hint="It is blocked on a question or permission, or reports an error" s={s} />
        <Toggle k="notifyTurn" label="Finishes a turn" hint="It stops working and waits for you" s={s} />
        <Toggle k="notifyExit" label="Exits" hint="Its program ends" s={s} />
      </Section>

      <Section title="Background">
        <Toggle
          k="background"
          label="Keep watching when closed"
          hint="A quiet notification keeps the app connected, so you hear about your agents with the app in the background."
          s={s}
        />
      </Section>

      <Section title="App">
        <Row label={`Herdr Mobile ${Constants.expoConfig?.version ?? ""}`} hint={currentUpdate()}>
          {updatesEnabled && <UpdateButton />}
        </Row>
      </Section>
    </ScrollView>
  );
}

function Toggle({ k, label, hint, s }: { k: keyof Settings; label: string; hint: string; s: Settings }) {
  return (
    <Row label={label} hint={hint}>
      <Switch value={!!s[k]} onValueChange={(v) => void updateSettings({ [k]: v })} />
    </Row>
  );
}

function UpdateButton() {
  const [state, setState] = useState<"idle" | "checking" | "ready" | "latest" | "failed">("idle");
  const label = { idle: "Check for updates", checking: "Checking…", ready: "Restart to update", latest: "Up to date", failed: "Couldn't check" }[state];
  const onPress = async () => {
    if (state === "ready") return void applyUpdate();
    setState("checking");
    try {
      setState((await fetchUpdate()) ? "ready" : "latest");
    } catch {
      setState("failed");
    }
  };
  return <Small label={label} active={state === "ready"} onPress={() => void onPress()} disabled={state === "checking"} />;
}

function Small({ label, onPress, active, disabled }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.small, active && styles.active, pressed && styles.pressed]} onPress={onPress} disabled={disabled}>
      <Text style={[styles.smallText, active && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {options.map(([v, label]) => (
        <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: v === value }} style={[styles.seg, v === value && styles.active]} onPress={() => onChange(v)}>
          <Text style={[styles.smallText, v === value && styles.activeText]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 48, gap: space.xl },
  value: { color: colors.text, fontSize: 16, minWidth: 28, textAlign: "center", fontVariant: ["tabular-nums"] },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  small: { backgroundColor: colors.surfaceHigh, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm - 2 },
  smallText: { color: colors.text, fontSize: 14 },
  pressed: { opacity: 0.7 },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceHigh, borderRadius: radius.sm + 2, padding: 2 },
  seg: { paddingHorizontal: space.md, paddingVertical: space.sm - 2, borderRadius: radius.sm },
  active: { backgroundColor: colors.accent },
  activeText: { color: colors.onAccent, fontWeight: "700" },
});
