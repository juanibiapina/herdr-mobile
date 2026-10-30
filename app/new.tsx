import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fleet, useFleet } from "../src/fleet-store";
import type { RunSpec, Target } from "../src/hc/fleet";
import { shortPath } from "../src/ui/session-display";
import { useKeyboardHeight } from "../src/ui/keyboard";
import { colors } from "../src/ui/theme";

// Interactive agents this app knows how to hand a first task to.
const AGENTS: { cmd: string; label: string; task?: (t: string) => string[] }[] = [
  { cmd: "claude", label: "Claude Code", task: (t) => [t] },
  { cmd: "pi", label: "pi", task: (t) => [t] },
  { cmd: "codex", label: "Codex", task: (t) => [t] },
  { cmd: "opencode", label: "opencode", task: (t) => ["--prompt", t] },
  { cmd: "gemini", label: "Gemini", task: (t) => ["-i", t] },
  { cmd: "amp", label: "Amp" },
  { cmd: "aider", label: "aider" },
  { cmd: "goose", label: "goose" },
];

type Kind = { type: "shell" } | { type: "agent"; cmd: string } | { type: "template"; name: string } | { type: "custom" };

const RECENT = "recent-folders.v1";
const LAST_TARGET = "last-target.v1";

// Resolves the path (with ~) and lists its folders, in one round trip.
const BROWSE =
  'p="$1"; case "$p" in "~") p="$HOME";; "~/"*) p="$HOME/${p#\\~/}";; esac; ' +
  'cd -- "$p" 2>/dev/null || { echo "no such folder: $1" >&2; exit 1; }; pwd; ' +
  'for d in .[!.]*/ *; do [ -d "$d" ] && echo "${d%/}"; done 2>/dev/null; true';

async function recentFolders(): Promise<Record<string, string[]>> {
  return JSON.parse((await AsyncStorage.getItem(RECENT)) ?? "{}");
}

export default function NewSession() {
  const params = useLocalSearchParams<{ coreId?: string; cwd?: string }>();
  const { sessions } = useFleet();
  const targets = fleet.targets();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  const [coreId, setCoreId] = useState<string | null>(params.coreId ?? null);
  const target: Target | undefined = targets.find((t) => t.coreId === coreId) ?? targets[0];
  const [path, setPath] = useState(params.cwd ?? "");
  const [resolved, setResolved] = useState<string | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [templates, setTemplates] = useState<{ name: string; description?: string }[]>([]);
  const [kind, setKind] = useState<Kind>({ type: "shell" });
  const [line, setLine] = useState("");
  const [task, setTask] = useState("");
  const [name, setName] = useState("");
  const [keep, setKeep] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (coreId) return;
    AsyncStorage.getItem(LAST_TARGET).then((id) => id && setCoreId((c) => c ?? id));
  }, [coreId]);

  // Per machine: recent folders, installed agents, templates, then browse.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    (async () => {
      const fromSessions = sessions
        .filter((s) => s.key.startsWith(target.coreId + ":"))
        .sort((a, b) => b.terminal.created_ms - a.terminal.created_ms)
        .map((s) => s.terminal.foreground?.cwd || s.terminal.cwd);
      const saved = (await recentFolders())[target.coreId] ?? [];
      const all = [...new Set([...saved, ...fromSessions])].slice(0, 8);
      if (cancelled) return;
      setRecent(all);
      const start = params.cwd && params.coreId === target.coreId ? params.cwd : all[0] ?? "~";
      setPath(start);
      void browse(start);
      try {
        const out = await fleet.exec(target, [
          "sh",
          "-c",
          `for c in ${AGENTS.map((a) => a.cmd).join(" ")}; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done; true`,
        ]);
        if (!cancelled) setAgents(out.stdout.split("\n").filter(Boolean));
      } catch {
        if (!cancelled) setAgents([]);
      }
      try {
        const list = await fleet.templates(target);
        if (!cancelled) setTemplates(list);
      } catch {
        if (!cancelled) setTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.coreId]);

  const browse = async (to: string) => {
    if (!target) return;
    setBrowsing(true);
    setBrowseError(null);
    try {
      const out = await fleet.exec(target, ["sh", "-c", BROWSE, "_", to.trim() || "~"]);
      if (out.code !== 0) throw new Error(out.stderr.trim() || "could not open that folder");
      const [where, ...rest] = out.stdout.split("\n").filter(Boolean);
      setResolved(where);
      setPath(where);
      setDirs(rest.sort((a, b) => a.localeCompare(b)));
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
  };

  const agent = kind.type === "agent" ? AGENTS.find((a) => a.cmd === kind.cmd) : undefined;
  const takesTask = kind.type === "template" || !!agent?.task;
  const nameOk = !name || /^[a-z0-9_.-]{1,32}$/.test(name);
  const ready = !!target && !!resolved && nameOk && (kind.type !== "custom" || line.trim()) && !starting;

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
      const key = await fleet.run(target, spec);
      const all = await recentFolders();
      all[target.coreId] = [resolved, ...(all[target.coreId] ?? []).filter((p) => p !== resolved)].slice(0, 8);
      await AsyncStorage.multiSet([
        [RECENT, JSON.stringify(all)],
        [LAST_TARGET, target.coreId],
      ]);
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

  const shownDirs = dirs.filter((d) => showHidden || !d.startsWith("."));

  return (
    <View style={[styles.screen, { paddingBottom: keyboard }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Machine</Text>
        <View style={styles.chips}>
          {targets.map((t) => (
            <Chip key={t.coreId} label={t.on ? `${t.label} (via another machine)` : t.label} active={t.coreId === target?.coreId} onPress={() => setCoreId(t.coreId)} />
          ))}
        </View>

        <Text style={styles.section}>Folder</Text>
        <View style={styles.pathRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={path}
            onChangeText={setPath}
            onSubmitEditing={() => void browse(path)}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="~/workspace/project"
            placeholderTextColor={colors.muted}
            returnKeyType="go"
          />
          <Pressable style={styles.smallButton} onPress={() => void browse(path)}>
            <Text style={styles.smallButtonText}>Go</Text>
          </Pressable>
        </View>
        {recent.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {recent.map((r) => (
              <Chip key={r} label={shortPath(r)} active={r === resolved} onPress={() => void browse(r)} mono />
            ))}
          </ScrollView>
        )}
        <View style={styles.browser}>
          <View style={styles.browserHead}>
            <Text style={styles.browserPath} numberOfLines={1}>
              {resolved ? shortPath(resolved) : "…"}
            </Text>
            {browsing && <ActivityIndicator size="small" color={colors.muted} />}
            <Pressable onPress={() => setShowHidden((h) => !h)} hitSlop={8}>
              <Text style={styles.link}>{showHidden ? "Hide hidden" : "Show hidden"}</Text>
            </Pressable>
          </View>
          {browseError && <Text style={styles.error}>{browseError}</Text>}
          {resolved && resolved !== "/" && (
            <DirRow label=".." onPress={() => void browse(resolved.replace(/\/[^/]+\/?$/, "") || "/")} />
          )}
          <ScrollView style={styles.dirList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {shownDirs.map((d) => (
              <DirRow key={d} label={d} onPress={() => void browse(`${resolved === "/" ? "" : resolved}/${d}`)} />
            ))}
            {resolved && shownDirs.length === 0 && !browsing && <Text style={[styles.muted, styles.pad]}>No folders here.</Text>}
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
        {kind.type === "custom" && (
          <TextInput
            style={[styles.input, styles.mono]}
            value={line}
            onChangeText={setLine}
            placeholder="npm run dev"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
        {takesTask && (
          <TextInput
            style={[styles.input, styles.task]}
            value={task}
            onChangeText={setTask}
            placeholder="First task (optional)"
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
          />
        )}

        <Text style={styles.section}>Options</Text>
        <TextInput
          style={[styles.input, !nameOk && { borderColor: colors.blocked }]}
          value={name}
          onChangeText={(v) => setName(v.toLowerCase())}
          placeholder="Name (optional): a-z 0-9 - _ ."
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={styles.label}>Keep it alive</Text>
            <Text style={styles.muted}>If its program is lost, a shell takes its place</Text>
          </View>
          <Switch value={keep} onValueChange={setKeep} />
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: keyboard ? 12 : Math.max(insets.bottom, 12) }]}>
        <Pressable style={[styles.primary, !ready && { opacity: 0.4 }]} disabled={!ready} onPress={() => void start()}>
          {starting ? <ActivityIndicator color="#0d1117" /> : <Text style={styles.primaryText}>Start on {target?.label}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, mono }: { label: string; active: boolean; onPress: () => void; mono?: boolean }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive, mono && styles.mono]}>{label}</Text>
    </Pressable>
  );
}

function DirRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.dir, pressed && { backgroundColor: colors.surfaceHigh }]} onPress={onPress}>
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
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  section: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextActive: { color: "#0d1117", fontWeight: "700" },
  mono: { fontFamily: "monospace" },
  pathRow: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  task: { minHeight: 90 },
  smallButton: { backgroundColor: colors.surfaceHigh, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  smallButtonText: { color: colors.text, fontSize: 15 },
  browser: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" },
  browserHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  browserPath: { flex: 1, color: colors.text, fontFamily: "monospace", fontSize: 13 },
  link: { color: colors.accent, fontSize: 13 },
  dirList: { maxHeight: 240 },
  dir: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  dirIcon: { color: colors.muted, width: 14 },
  dirText: { color: colors.text, fontSize: 15, flex: 1 },
  error: { color: colors.blocked, fontSize: 13, padding: 12 },
  muted: { color: colors.muted, fontSize: 13 },
  pad: { padding: 12 },
  label: { color: colors.text, fontSize: 15 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  footer: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  primary: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "#0d1117", fontWeight: "700", fontSize: 16 },
});
