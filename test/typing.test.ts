import { expect, test } from "vitest";
import { typedText, withCtrl } from "../src/terminal/typing";

test("new text types as itself", () => {
  expect(typedText("", "ls")).toBe("ls");
  expect(typedText("ls", "ls -la")).toBe(" -la");
});

test("removed text types backspaces", () => {
  expect(typedText("ls -la", "ls")).toBe("\x7f\x7f\x7f\x7f");
});

test("an autocorrected word erases back to where it changed, then retypes", () => {
  expect(typedText("git stauts", "git status")).toBe("\x7f\x7f\x7ftus");
});

test("an emoji erases with one backspace", () => {
  expect(typedText("hi 👋", "hi ")).toBe("\x7f");
});

test("a newline types Enter", () => {
  expect(typedText("ls", "ls\n")).toBe("\r");
});

test("ctrl turns letters and a few symbols into control characters", () => {
  expect(withCtrl("c")).toBe("\x03");
  expect(withCtrl("C")).toBe("\x03");
  expect(withCtrl("[")).toBe("\x1b");
  expect(withCtrl(" ")).toBe("\x00");
  expect(withCtrl("1")).toBeNull();
  expect(withCtrl("ab")).toBeNull();
});
