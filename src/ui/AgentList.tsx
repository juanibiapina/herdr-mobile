// Sessions by state, like Herdr's Agents panel: one row per session with its
// project, task, age, and a spinner while it works or a ring while it waits.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Session } from "../hc/fleet";
import { ago, appName, projectName, sections, sessionTitle, statusColor, taskName } from "./session-display";
import { colors } from "./theme";

type Props = {
  sessions: Session[];
  current?: string;
  onSelect: (s: Session) => void;
  onLongPress?: (s: Session) => void;
};

export function AgentList({ sessions, current, onSelect, onLongPress }: Props) {
  const machines = new Set(sessions.map((s) => s.machine));
  return (
    <View>
      {sections(sessions).map((sec) => (
        <View key={sec.id} style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Text style={{ color: sec.color }}>{sec.title}</Text>
            <Text style={styles.count}> {sec.sessions.length}</Text>
          </Text>
          {sec.sessions.map((s) => (
            <AgentRow
              key={s.key}
              session={s}
              active={s.key === current}
              showMachine={machines.size > 1}
              onPress={() => onSelect(s)}
              onLongPress={onLongPress && (() => onLongPress(s))}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function AgentRow({ session, active, showMachine, onPress, onLongPress }: { session: Session; active: boolean; showMachine: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = session.terminal;
  const state = t.status?.state;
  const hasStatus = !!t.status;
  // Agents read as "project · task"; plain terminals as "name · folder".
  const primary = hasStatus ? projectName(session) : sessionTitle(session);
  const secondaryRaw = hasStatus ? taskName(session) : projectName(session);
  const task = secondaryRaw === primary ? "" : secondaryRaw;
  const quiet = state === "working" || !hasStatus;
  const msg = t.status?.msg;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.rowPressed]}
    >
      <View style={styles.app}>
        <Text style={styles.appText} numberOfLines={1}>
          {appName(session).slice(0, 6)}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.line} numberOfLines={1}>
          <Text style={[styles.project, !quiet && styles.projectWaiting]}>{primary}</Text>
          {task ? <Text style={styles.task}> · {task}</Text> : null}
        </Text>
        {(msg || showMachine) && (
          <Text style={[styles.sub, state === "blocked" && { color: colors.blocked }]} numberOfLines={1}>
            {[showMachine ? session.machine : null, msg].filter(Boolean).join(" · ")}
          </Text>
        )}
      </View>
      <Text style={styles.age}>{ago(t.status_ms ?? t.created_ms)}</Text>
      <View style={styles.indicator}>
        {state === "working" ? (
          <ActivityIndicator size="small" color={colors.working} />
        ) : (
          <View style={[styles.ring, { borderColor: hasStatus ? statusColor(state) : colors.border }, state === "blocked" && { backgroundColor: colors.blocked }]} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 14 },
  sectionTitle: { fontFamily: "monospace", fontSize: 15, fontWeight: "700", marginBottom: 6, marginLeft: 4 },
  count: { color: colors.muted, fontWeight: "400" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10 },
  rowActive: { backgroundColor: colors.surfaceHigh },
  rowPressed: { backgroundColor: colors.surface },
  app: { width: 44, height: 24, borderRadius: 6, backgroundColor: "#d2774f22", alignItems: "center", justifyContent: "center" },
  appText: { color: "#e08a5f", fontSize: 11, fontWeight: "700", fontFamily: "monospace" },
  body: { flex: 1 },
  line: { fontFamily: "monospace", fontSize: 15 },
  project: { color: colors.text, fontWeight: "700" },
  projectWaiting: { color: colors.text },
  task: { color: colors.muted },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  age: { color: colors.muted, fontSize: 12, fontFamily: "monospace" },
  indicator: { width: 22, alignItems: "center" },
  ring: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5 },
});
