import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fleet, useFleet } from "../src/fleet-store";
import type { RunSpec, Target } from "../src/hc/fleet";
import { herdrLabels } from "../src/herdr-app";
import { getSettings } from "../src/settings";
import { Button } from "../src/ui/Button";
import { useKeyboardHeight } from "../src/ui/keyboard";
import { AGENTS, lastTarget, rememberStart, useFolderBrowser, useLaunchers } from "../src/ui/new-session";
import { shortPath } from "../src/ui/session-display";
import { TextField } from "../src/ui/TextField";
import { colors, fonts, radius, space } from "../src/ui/theme";

type Kind = { type: "shell" } | { type: "agent"; cmd: string } | { type: "template"; name: string } | { type: "custom" };

export default function NewSession() {
  const params = useLocalSearchParams<{ coreId?: string; cwd?: string }>();
  const { sessions } = useFleet();
  const targets = fleet.targets();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  const [coreId, setCoreId] = useState<string | null>(params.coreId ?? null);
  const target: Target | undefined = targets.find((t) => t.coreId === coreId) ?? targets[0];
  const folder = useFolderBrowser(target, sessions, params);
  const { agents, templates } = useLaunchers(target);
  const [kind, setKind] = useState<Kind>({ type: "shell" });
  const [line, setLine] = useState("");
  const [task, setTask] = useState("");
  const [name, setName] = useState("");
  const [keep, setKeep] = useState(false);
  const [more, setMore] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (coreId) return;
    lastTarget().then((id) => id && setCoreId((c) => c ?? id));
  }, [coreId]);

  const resolved = folder.resolved;
  const agent = kind.type === "agent" ? AGENTS.find((a) => a.cmd === kind.cmd) : undefined;
  const takesTask = kind.type === "template" || !!agent?.task;
  const nameOk = !name || /^[a-z0-9_.-]{1,32}$/.test(name);
  const ready = !!target && !!resolved && nameOk && (kind.type !== "custom" || !!line.trim());

  const spec = useMemo((): RunSpec => {
    const t = task.trim();
    const base: RunSpec = { cwd: resolved ?? undefined, name: name || undefined, keep: keep || undefined };
    switch (kind.type) {
      case "shell":
        return base;
      case "custom":
        return { ...base, line: line.trim() };
      case "agent":
        return { ...base, argv: [kind.cmd, ...(t && agent?.task ? agent.task(t) : [])] };
      case "template":
        return { ...base, argv: t ? [kind.name, t] : [kind.name] };
    }
  }, [kind, task, resolved, name, keep, line, agent]);

  const start = async () => {
    if (!target || !resolved) return;
    setStarting(true);
    try {
      const labels = getSettings().showInHerdr ? await herdrLabels(fleet, target, resolved) : undefined;
      const key = await fleet.run(target, { ...spec, labels });
      await rememberStart(target.coreId, resolved);
      router.replace({ pathname: "/session/[key]", params: { key } });
    } catch (e) {
      setStarting(false);
      Alert.alert("Could not start it", e instanceof Error ? e.message : String(e));
    }
  };

  if (targets.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.muted}>No machine is connected right now.</Text>
      </View>
    );
  }

  const hidden = folder.dirs.filter((d) => d.startsWith(".")).length;
  const shownDirs = folder.dirs.filter((d) => showHidden || !d.startsWith("."));

  return (
    <View style={[styles.screen, { paddingBottom: keyboard }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {targets.length > 1 && (
          <>
            <Text style={styles.section}>Machine</Text>
            <View style={styles.chips}>
              {targets.map((t) => (
                <Chip key={t.coreId} label={t.on ? `${t.label} (via another machine)` : t.label} active={t.coreId === target?.coreId} onPress={() => setCoreId(t.coreId)} />
              ))}
            </View>
          </>
        )}

        <Text style={styles.section}>Folder</Text>
        <View style={styles.pathRow}>
          <TextField
            style={[styles.flex, styles.mono]}
            value={folder.path}
            onChangeText={folder.setPath}
            onSubmitEditing={() => folder.browse(folder.path)}
            placeholder="~/workspace/project"
            returnKeyType="go"
          />
          <Button variant="secondary" title="Go" loading={folder.browsing} onPress={() => folder.browse(folder.path)} />
        </View>
        {folder.recent.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {folder.recent.map((r) => (
              <Chip key={r} label={shortPath(r)} active={r === resolved} onPress={() => folder.browse(r)} mono />
            ))}
          </ScrollView>
        )}
        <View style={styles.browser}>
          {folder.error && <Text style={styles.error}>{folder.error}</Text>}
          <ScrollView style={styles.dirList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {resolved && resolved !== "/" && <DirRow label=".." onPress={folder.up} />}
            {shownDirs.map((d) => (
              <DirRow key={d} label={d} onPress={() => folder.open(d)} />
            ))}
            {resolved && folder.dirs.length === 0 && !folder.browsing && <Text style={[styles.muted, styles.pad]}>No folders here.</Text>}
            {hidden > 0 && (
              <Pressable style={styles.dir} onPress={() => setShowHidden((h) => !h)} accessibilityRole="button">
                <Text style={styles.link}>{showHidden ? "Hide hidden folders" : `Show ${hidden} hidden folder${hidden === 1 ? "" : "s"}`}</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>

        <Text style={styles.section}>Run</Text>
        <View style={styles.chips}>
          <Chip label="Shell" active={kind.type === "shell"} onPress={() => setKind({ type: "shell" })} />
          {AGENTS.filter((a) => agents.includes(a.cmd)).map((a) => (
            <Chip key={a.cmd} label={a.label} active={kind.type === "agent" && kind.cmd === a.cmd} onPress={() => setKind({ type: "agent", cmd: a.cmd })} />
          ))}
          {templates.map((t) => (
            <Chip key={t.name} label={`◆ ${t.name}`} active={kind.type === "template" && kind.name === t.name} onPress={() => setKind({ type: "template", name: t.name })} />
          ))}
          <Chip label="Command…" active={kind.type === "custom"} onPress={() => setKind({ type: "custom" })} />
        </View>
        {kind.type === "template" && <Text style={styles.muted}>{templates.find((t) => t.name === kind.name)?.description}</Text>}
        {kind.type === "custom" && <TextField style={styles.mono} value={line} onChangeText={setLine} placeholder="npm run dev" />}
        {takesTask && (
          <TextField
            style={styles.task}
            value={task}
            onChangeText={setTask}
            placeholder="First task (optional)"
            autoCapitalize="sentences"
            autoCorrect
            multiline
            textAlignVertical="top"
          />
        )}

        <Pressable onPress={() => setMore((m) => !m)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: more }}>
          <Text style={styles.section}>{more ? "▾" : "▸"} More options</Text>
        </Pressable>
        {more && (
          <>
            <TextField invalid={!nameOk} value={name} onChangeText={(v) => setName(v.toLowerCase())} placeholder="Name (optional): a-z 0-9 - _ ." />
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={styles.label}>Keep it alive</Text>
                <Text style={styles.muted}>If its program is lost, a shell takes its place</Text>
              </View>
              <Switch value={keep} onValueChange={setKeep} />
            </View>
          </>
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: keyboard ? space.md : Math.max(insets.bottom, space.md) }]}>
        <Button title={`Start on ${target?.label ?? ""}`} disabled={!ready} loading={starting} onPress={() => void start()} />
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, mono }: { label: string; active: boolean; onPress: () => void; mono?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive, mono && styles.mono]}>{label}</Text>
    </Pressable>
  );
}

function DirRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.dir, pressed && { backgroundColor: colors.surfaceHigh }]} onPress={onPress}>
      <Text style={styles.dirIcon}>{label === ".." ? "↑" : "▸"}</Text>
      <Text style={styles.dirText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: space.lg, gap: space.md - 2, paddingBottom: 32 },
  section: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: space.md - 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: space.sm, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextActive: { color: colors.onAccent, fontWeight: "700" },
  mono: { fontFamily: fonts.mono },
  pathRow: { flexDirection: "row", gap: space.sm },
  flex: { flex: 1 },
  task: { minHeight: 90 },
  browser: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" },
  link: { color: colors.accent, fontSize: 14 },
  dirList: { maxHeight: 260 },
  dir: { flexDirection: "row", alignItems: "center", gap: space.md - 2, paddingHorizontal: space.md, paddingVertical: space.md - 2 },
  dirIcon: { color: colors.muted, width: 14 },
  dirText: { color: colors.text, fontSize: 15, flex: 1 },
  error: { color: colors.blocked, fontSize: 13, padding: space.md },
  muted: { color: colors.muted, fontSize: 13 },
  pad: { padding: space.md },
  label: { color: colors.text, fontSize: 15 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm - 2 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
