import { ActivityIndicator, View } from "react-native";
import type { Session } from "../hc/fleet";
import { statusColor } from "./session-display";
import { colors } from "./theme";

export function Dot({ color, hollow, size = 8 }: { color: string; hollow?: boolean; size?: number }) {
  const ring = Math.max(1.5, size / 5);
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, ...(hollow ? { borderWidth: ring, borderColor: color } : { backgroundColor: color }) }}
    />
  );
}

/**
 * A session's state at a glance: a filled red dot when it needs you, a ring in
 * its status color when it waits, a spinner (or amber dot) while it works, and
 * a grey ring for plain terminals.
 */
export function StatusDot({ session, size = 10, spin }: { session: Session; size?: number; spin?: boolean }) {
  const state = session.terminal.status?.state;
  if (!state || session.terminal.state !== "live") return <Dot color={colors.border} hollow size={size} />;
  if (state === "working") return spin ? <ActivityIndicator size="small" color={colors.working} /> : <Dot color={colors.working} size={size} />;
  if (state === "blocked" || state === "error") return <Dot color={statusColor(state)} size={size} />;
  return <Dot color={statusColor(state)} hollow size={size} />;
}
