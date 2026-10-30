import Constants from "expo-constants";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { updateSettings, useSettings, type Settings } from "../src/settings";
import { colors } from "../src/ui/theme";

export default function SettingsScreen() {
  const s = useSettings();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Terminal</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Text size</Text>
          <View style={styles.stepper}>
            <Step label="A−" onPress={() => void updateSettings({ fontSize: Math.max(8, s.fontSize - 1) })} />
            <Text style={styles.value}>{s.fontSize}</Text>
            <Step label="A+" onPress={() => void updateSettings({ fontSize: Math.min(22, s.fontSize + 1) })} />
          </View>
        </View>
        <View style={[styles.row, styles.border]}>
          <View style={styles.flex}>
            <Text style={styles.label}>Open sessions at</Text>
            <Text style={styles.hint}>
              {s.defaultMode === "fit"
                ? "Phone size: the terminal reflows to fit the phone, and your desktop sees that size until you use it there again."
                : "Full size: watch at your desktop's size, scaled down; pinch to zoom."}
            </Text>
          </View>
          <View style={styles.segment}>
            <Seg label="Phone" active={s.defaultMode === "fit"} onPress={() => void updateSettings({ defaultMode: "fit" })} />
            <Seg label="Full" active={s.defaultMode === "full"} onPress={() => void updateSettings({ defaultMode: "full" })} />
          </View>
        </View>
      </View>

      <Text style={styles.section}>Herdr desktop app</Text>
      <View style={styles.card}>
        <Toggle
          k="showInHerdr"
          label="Show new sessions there"
          hint="Sessions you start here get a tab in Herdr, in the space for their folder."
          s={s}
        />
      </View>

      <Text style={styles.section}>Notify me when an agent</Text>
      <View style={styles.card}>
        <Toggle k="notifyBlocked" label="Needs me" hint="It is blocked on a question or permission, or reports an error" s={s} />
        <Toggle k="notifyTurn" label="Finishes a turn" hint="It stops working and waits for you" s={s} border />
        <Toggle k="notifyExit" label="Exits" hint="Its program ends" s={s} border />
      </View>

      <Text style={styles.section}>Background</Text>
      <View style={styles.card}>
        <Toggle
          k="background"
          label="Keep watching when closed"
          hint="A quiet notification keeps the app connected, so you hear about your agents with the app in the background."
          s={s}
        />
      </View>

      <Text style={styles.footer}>Herdr Mobile {Constants.expoConfig?.version} · a client for herdr-core</Text>
    </ScrollView>
  );
}

function Toggle({ k, label, hint, s, border }: { k: keyof Settings; label: string; hint: string; s: Settings; border?: boolean }) {
  return (
    <View style={[styles.row, border && styles.border]}>
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch value={!!s[k]} onValueChange={(v) => void updateSettings({ [k]: v })} />
    </View>
  );
}

function Step({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.step} onPress={onPress}>
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

function Seg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.seg, active && styles.segActive]} onPress={onPress}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  section: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  flex: { flex: 1 },
  label: { color: colors.text, fontSize: 16 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 2 },
  value: { color: colors.text, fontSize: 16, minWidth: 28, textAlign: "center", fontVariant: ["tabular-nums"] },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" },
  step: { backgroundColor: colors.surfaceHigh, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  stepText: { color: colors.text, fontSize: 15 },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceHigh, borderRadius: 8, padding: 2 },
  seg: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  segActive: { backgroundColor: colors.accent },
  segText: { color: colors.text, fontSize: 14 },
  segTextActive: { color: "#0d1117", fontWeight: "700" },
  footer: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 32 },
});
