// Direct typing: the keyboard types into a hidden field, and what changes in
// it becomes bytes for the terminal. No React Native imports, so tests run in Node.

/**
 * What the field's change from prev to next types: one backspace per removed
 * character (counting an emoji as one), then the new text, with newlines as Enter.
 */
export function typedText(prev: string, next: string): string {
  const a = Array.from(prev);
  const b = Array.from(next);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return "\x7f".repeat(a.length - common) + b.slice(common).join("").replace(/\n/g, "\r");
}

/** The control character for a key typed with ctrl held, or null when ctrl does not apply to it. */
export function withCtrl(ch: string): string | null {
  if (ch.length !== 1 || !/[a-z@\[\]\\^_ ]/i.test(ch)) return null;
  const c = ch.toLowerCase().charCodeAt(0);
  return String.fromCharCode(c === 0x20 ? 0 : c & 0x1f);
}
