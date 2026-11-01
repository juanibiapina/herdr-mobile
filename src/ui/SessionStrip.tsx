// Every live session as a chip across the top of the terminal: tap to switch.
// Agents waiting on you are tinted in their status color.
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Session } from "../hc/fleet";
import { StatusDot } from "./Dot";
import { sessionTitle, statusColor, waitingOnYou } from "./session-display";
import { colors, radius, space } from "./theme";

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
          const color = statusColor(s.terminal.status?.state);
          return (
            <Pressable
              key={s.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onLayout={(e) => {
                positions.current.set(s.key, e.nativeEvent.layout.x);
                if (active) scroll.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 24), animated: false });
              }}
              onPress={() => !active && onSelect(s.key)}
              style={[styles.chip, waitingOnYou(s) && { borderColor: color, backgroundColor: color + "26" }, active && styles.active]}
            >
              <StatusDot session={s} size={8} />
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
  content: { paddingHorizontal: space.sm, paddingVertical: space.sm - 2, gap: space.sm - 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: space.sm - 2, maxWidth: 200, paddingHorizontal: space.md - 2, height: 32, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  active: { borderColor: colors.accent, borderWidth: 2 },
  text: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  activeText: { color: colors.text, fontWeight: "700" },
  machine: { color: colors.muted, fontSize: 11 },
});
