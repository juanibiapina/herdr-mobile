// Sessions by state, like Herdr's Agents panel: one row per session with its
// project, task, age, and its status dot. Finished sessions, when asked for,
// sit in a collapsed group at the end.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Session } from "../hc/fleet";
import { StatusDot } from "./Dot";
import { ago, appName, projectName, sections, sessionTitle, taskName } from "./session-display";
import { colors, fonts, radius, space } from "./theme";

type Props = {
  sessions: Session[];
  current?: string;
  onSelect: (s: Session) => void;
  onLongPress?: (s: Session) => void;
  /** Shows finished sessions in a collapsed group, with a Clear action that calls this. */
  onClearFinished?: (finished: Session[]) => void;
};

export function AgentList({ sessions, current, onSelect, onLongPress, onClearFinished }: Props) {
  const [open, setOpen] = useState(false);
  const machines = new Set(sessions.map((s) => s.machine));
  const finished = onClearFinished
    ? sessions.filter((s) => s.terminal.state === "finished").sort((a, b) => (b.terminal.finished_ms ?? 0) - (a.terminal.finished_ms ?? 0))
    : [];
  const row = (s: Session) => (
    <AgentRow
      key={s.key}
      session={s}
      active={s.key === current}
      showMachine={machines.size > 1}
      onPress={() => onSelect(s)}
      onLongPress={onLongPress && (() => onLongPress(s))}
    />
  );
  return (
    <View>
      {sections(sessions).map((sec) => (
        <View key={sec.id} style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Text style={{ color: sec.color }}>{sec.title}</Text>
            <Text style={styles.count}> {sec.sessions.length}</Text>
          </Text>
          {sec.sessions.map(row)}
        </View>
      ))}
      {finished.length > 0 && (
        <View style={styles.section}>
          <View style={styles.finishedHead}>
            <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8} style={styles.flex} accessibilityRole="button" accessibilityState={{ expanded: open }}>
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>
                {open ? "▾" : "▸"} Finished <Text style={styles.count}>{finished.length}</Text>
              </Text>
            </Pressable>
            {open && (
              <Pressable onPress={() => onClearFinished?.(finished)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            )}
          </View>
          {open && finished.map(row)}
        </View>
      )}
    </View>
  );
}

function AgentRow({ session, active, showMachine, onPress, onLongPress }: { session: Session; active: boolean; showMachine: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = session.terminal;
  const live = t.state === "live";
  const hasStatus = !!t.status;
  // Agents read as "project · task"; plain terminals as "name · folder".
  const primary = hasStatus ? projectName(session) : sessionTitle(session);
  const secondary = hasStatus ? taskName(session) : projectName(session);
  const task = secondary === primary ? "" : secondary;
  const sub = live ? t.status?.msg : `exited${t.exit_code != null ? ` ${t.exit_code}` : ""}`;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, !live && styles.dim, active && styles.rowActive, pressed && styles.rowPressed]}
    >
      <View style={styles.app}>
        <Text style={styles.appText} numberOfLines={1}>
          {appName(session).slice(0, 6)}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.line} numberOfLines={1}>
          <Text style={styles.project}>{primary}</Text>
          {task ? <Text style={styles.task}> · {task}</Text> : null}
        </Text>
        {(sub || showMachine) && (
          <Text style={[styles.sub, t.status?.state === "blocked" && live && { color: colors.blocked }]} numberOfLines={1}>
            {[showMachine ? session.machine : null, sub].filter(Boolean).join(" · ")}
          </Text>
        )}
      </View>
      <Text style={styles.age}>{ago(live ? t.status_ms ?? t.created_ms : t.finished_ms)}</Text>
      <View style={styles.indicator}>
        <StatusDot session={session} size={12} spin />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 14 },
  sectionTitle: { fontFamily: fonts.mono, fontSize: 15, fontWeight: "700", marginBottom: space.sm - 2, marginLeft: space.xs },
  finishedHead: { flexDirection: "row", alignItems: "center" },
  clear: { color: colors.blocked, fontSize: 14, marginBottom: space.sm - 2 },
  count: { color: colors.muted, fontWeight: "400" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md - 2, paddingHorizontal: space.md - 2, paddingVertical: space.md - 2, borderRadius: radius.md },
  dim: { opacity: 0.6 },
  rowActive: { backgroundColor: colors.surfaceHigh },
  rowPressed: { backgroundColor: colors.surface },
  app: { width: 44, height: 24, borderRadius: radius.sm, backgroundColor: colors.appBg, alignItems: "center", justifyContent: "center" },
  appText: { color: colors.app, fontSize: 11, fontWeight: "700", fontFamily: fonts.mono },
  flex: { flex: 1 },
  line: { fontFamily: fonts.mono, fontSize: 15 },
  project: { color: colors.text, fontWeight: "700" },
  task: { color: colors.muted },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  age: { color: colors.muted, fontSize: 12, fontFamily: fonts.mono },
  indicator: { width: 22, alignItems: "center" },
});
