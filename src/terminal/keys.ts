// Bytes for the key bar, written straight to the terminal. Arrows follow the
// program's cursor-key mode (DECCKM), which xterm reports from the page.

export type KeyName =
  | "esc" | "enter" | "tab" | "shift+tab" | "backspace"
  | "up" | "down" | "left" | "right" | "home" | "end" | "pageup" | "pagedown"
  | "ctrl+c" | "ctrl+d" | "ctrl+r" | "ctrl+z" | "ctrl+l";

/** The key bar, in order. "paste" is the clipboard; single characters type themselves. */
export const KEY_BAR: { label: string; key: string }[] = [
  { label: "esc", key: "esc" },
  { label: "tab", key: "tab" },
  { label: "⇧tab", key: "shift+tab" },
  { label: "←", key: "left" },
  { label: "↓", key: "down" },
  { label: "↑", key: "up" },
  { label: "→", key: "right" },
  { label: "⏎", key: "enter" },
  { label: "^C", key: "ctrl+c" },
  { label: "paste", key: "paste" },
  { label: "1", key: "1" },
  { label: "2", key: "2" },
  { label: "3", key: "3" },
];

const ARROWS: Record<string, string> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" };

export function keyBytes(key: KeyName | string, appCursor: boolean): string {
  if (key in ARROWS) return (appCursor ? "\x1bO" : "\x1b[") + ARROWS[key];
  switch (key) {
    case "esc":
      return "\x1b";
    case "enter":
      return "\r";
    case "tab":
      return "\t";
    case "shift+tab":
      return "\x1b[Z";
    case "backspace":
      return "\x7f";
    case "pageup":
      return "\x1b[5~";
    case "pagedown":
      return "\x1b[6~";
  }
  const ctrl = /^ctrl\+([a-z])$/.exec(key);
  if (ctrl) return String.fromCharCode(ctrl[1].charCodeAt(0) - 96);
  return key; // a printable key, like "1" or "y"
}
