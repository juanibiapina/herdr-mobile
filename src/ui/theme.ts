import { Platform } from "react-native";

export const colors = {
  bg: "#0d1117",
  surface: "#161b22",
  surfaceHigh: "#21262d",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  accent: "#58a6ff",
  onAccent: "#0d1117",
  working: "#d29922",
  blocked: "#f85149",
  done: "#3fb950",
  idle: "#8b949e",
  error: "#f85149",
  app: "#e08a5f",
  appBg: "#d2774f22",
  backdrop: "rgba(0,0,0,0.5)",
};

export const fonts = {
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { sm: 6, md: 10, lg: 16, full: 999 } as const;
