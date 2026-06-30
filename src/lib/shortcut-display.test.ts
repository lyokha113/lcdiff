import { describe, expect, it } from "vitest";
import { formatShortcutTokens } from "@/lib/shortcut-display";

describe("formatShortcutTokens", () => {
  it("formats macOS CmdOrCtrl, Alt, Shift, and named keys", () => {
    expect(formatShortcutTokens("CmdOrCtrl+Alt+Shift+O", "darwin")).toEqual(["⌘", "⌥", "⇧", "O"]);
  });

  it("formats macOS Ctrl and Tab", () => {
    expect(formatShortcutTokens("Ctrl+Tab", "darwin")).toEqual(["⌃", "Tab"]);
  });

  it("formats non-mac CmdOrCtrl, Alt, and single-character keys", () => {
    expect(formatShortcutTokens("CmdOrCtrl+Alt+O", "linux")).toEqual(["Ctrl", "Alt", "O"]);
    expect(formatShortcutTokens("CmdOrCtrl+Alt+O", "windows")).toEqual(["Ctrl", "Alt", "O"]);
  });

  it("formats non-mac Ctrl, Shift, and named keys", () => {
    expect(formatShortcutTokens("Ctrl+Shift+Tab", "linux")).toEqual(["Ctrl", "Shift", "Tab"]);
    expect(formatShortcutTokens("Ctrl+Shift+Tab", "windows")).toEqual(["Ctrl", "Shift", "Tab"]);
  });

  it("formats macOS CmdOrCtrl, Shift, and Backspace", () => {
    expect(formatShortcutTokens("CmdOrCtrl+Shift+Backspace", "darwin")).toEqual(["⌘", "⇧", "⌫"]);
  });

  it("formats non-mac CmdOrCtrl with Enter", () => {
    expect(formatShortcutTokens("CmdOrCtrl+Enter", "linux")).toEqual(["Ctrl", "Enter"]);
    expect(formatShortcutTokens("CmdOrCtrl+Enter", "windows")).toEqual(["Ctrl", "Enter"]);
  });
});
