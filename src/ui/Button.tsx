import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, space } from "./theme";

type Variant = "primary" | "secondary" | "danger";

const fill: Record<Variant, string> = { primary: colors.accent, secondary: colors.surfaceHigh, danger: colors.surfaceHigh };
const ink: Record<Variant, string> = { primary: colors.onAccent, secondary: colors.text, danger: colors.blocked };

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = !!(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.base, { backgroundColor: fill[variant] }, pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={ink[variant]} />
      ) : (
        <Text style={[styles.text, { color: ink[variant] }, variant === "primary" && styles.strong]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 44, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  text: { fontSize: 15 },
  strong: { fontWeight: "700" },
});
