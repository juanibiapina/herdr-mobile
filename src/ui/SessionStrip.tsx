// Every live session as a chip across the top of the terminal: tap to switch.
// Agents waiting on you are filled in their status color.
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Session } from "../hc/fleet";
import { sessionTitle, statusColor, waitingOnYou } from "./session-display";
import { colors } from "./theme";

export function SessionStrip({ sessions, current, onSelect }: { sessions: Session[]; current: string; onSelect: (key: string) => void }) {
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, number>());
  const machines = new Set(sessions.map((s) => s.machine));

  useEffect(() => {
    const x = positions.current.get(current);
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [current]);

  return (
    <View style={styles.wrap}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {sessions.map((s) => {
          const active = s.key === current;
          const waiting = waitingOnYou(s);
          const color = statusColor(s.terminal.status?.state);
          return (
            <Pressable
              key={s.key}
              onLayout={(e) => {
                positions.current.set(s.key, e.nativeEvent.layout.x);
                if (active) scroll.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 24), animated: false });
              }}
              onPress={() => !active && onSelect(s.key)}
              style={[
                styles.chip,
                waiting && { borderColor: color, backgroundColor: color + "26" },
                active && styles.active,
              ]}
            >
              <View style={[styles.dot, { backgroundColor: color }, !s.terminal.status && styles.hollow]} />
              <Text style={[styles.text, active && styles.activeText]} numberOfLines={1}>
                {sessionTitle(s)}
              </Text>
              {machines.size > 1 && <Text style={styles.machine}>{s.machine}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  content: { paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 200,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  active: { borderColor: colors.accent, borderWidth: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hollow: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.idle },
  text: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  activeText: { color: colors.text, fontWeight: "700" },
  machine: { color: colors.muted, fontSize: 11 },
});
