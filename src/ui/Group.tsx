// Grouped rows on one surface, like a settings list: a titled section whose
// children are divided by hairlines.
import { Children, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, space } from "./theme";

export function Section({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children);
  return (
    <View style={style}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.card}>
        {items.map((child, i) => (
          <View key={i} style={i > 0 && styles.divider}>
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

/** A label with an optional hint, something on the left, and controls on the right. Tappable rows get a chevron. */
export function Row({
  label,
  hint,
  left,
  onPress,
  children,
}: {
  label: string;
  hint?: ReactNode;
  left?: ReactNode;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      {left}
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
      {onPress && !children ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      {body}
    </Pressable>
  );
}

/** Free content inside a Section, padded like a Row. */
export function Cell({ children }: { children: ReactNode }) {
  return <View style={styles.cell}>{children}</View>;
}

const styles = StyleSheet.create({
  title: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: space.sm, marginLeft: space.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden" },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, minHeight: 52 },
  pressed: { backgroundColor: colors.surfaceHigh },
  flex: { flex: 1 },
  label: { color: colors.text, fontSize: 16 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 2 },
  chevron: { color: colors.muted, fontSize: 22 },
  cell: { padding: space.lg, gap: space.sm },
});
