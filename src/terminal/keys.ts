// Bytes for the key bar, written straight to the terminal. Arrows follow the
// program's cursor-key mode (DECCKM), which xterm reports from the page.

export type KeyName =
  | "esc" | "enter" | "tab" | "shift+tab" | "backspace"
  | "up" | "down" | "left" | "right" | "home" | "end" | "pageup" | "pagedown"
  | "ctrl+c" | "ctrl+d" | "ctrl+r" | "ctrl+z" | "ctrl+l";

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
