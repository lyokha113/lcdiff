import { describe, expect, it } from "vitest";
import {
  classifyFocusTarget,
  matchShortcut,
  parseShortcut,
  shortcutMatches,
  type KeyboardLikeEvent,
} from "@/lib/shortcuts";

function event(overrides: Partial<KeyboardLikeEvent>): KeyboardLikeEvent {
  return {
    key: "o",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: undefined,
    ...overrides,
  };
}

describe("shortcuts", () => {
  it("parses CmdOrCtrl shortcuts", () => {
    expect(parseShortcut("CmdOrCtrl+Shift+O")).toEqual({
      key: "o",
      cmdOrCtrl: true,
      ctrl: false,
      shift: true,
      alt: false,
    });
  });

  it("parses explicit Ctrl shortcuts", () => {
    expect(parseShortcut("Control+Shift+Tab")).toEqual({
      key: "tab",
      cmdOrCtrl: false,
      ctrl: true,
      shift: true,
      alt: false,
    });
  });

  it("matches CmdOrCtrl to Meta on macOS", () => {
    const shortcut = parseShortcut("CmdOrCtrl+O");
    expect(shortcutMatches(event({ key: "o", metaKey: true }), shortcut, "darwin")).toBe(true);
    expect(shortcutMatches(event({ key: "o", metaKey: true, altKey: true }), parseShortcut("CmdOrCtrl+Alt+O"), "darwin")).toBe(
      true,
    );
    expect(shortcutMatches(event({ key: "o", ctrlKey: true }), shortcut, "darwin")).toBe(false);
  });

  it("matches CmdOrCtrl to Ctrl outside macOS", () => {
    const shortcut = parseShortcut("CmdOrCtrl+O");
    expect(shortcutMatches(event({ key: "o", ctrlKey: true }), shortcut, "linux")).toBe(true);
    expect(shortcutMatches(event({ key: "/", ctrlKey: true }), parseShortcut("CmdOrCtrl+/"), "linux")).toBe(true);
    expect(shortcutMatches(event({ key: "o", metaKey: true }), shortcut, "linux")).toBe(false);
  });

  it("matches explicit Ctrl without Meta on every platform", () => {
    const shortcut = parseShortcut("Ctrl+Tab");
    expect(shortcutMatches(event({ key: "Tab", ctrlKey: true }), shortcut, "darwin")).toBe(true);
    expect(shortcutMatches(event({ key: "Tab", ctrlKey: true }), shortcut, "linux")).toBe(true);
    expect(shortcutMatches(event({ key: "Tab", ctrlKey: true, metaKey: true }), shortcut, "darwin")).toBe(false);
    expect(shortcutMatches(event({ key: "Tab", metaKey: true }), shortcut, "darwin")).toBe(false);
  });

  it("matches bracket merge shortcuts", () => {
    expect(shortcutMatches(event({ key: "[", altKey: true }), parseShortcut("Alt+["), "darwin")).toBe(true);
    expect(shortcutMatches(event({ key: "]", altKey: true, shiftKey: true }), parseShortcut("Alt+Shift+]"), "linux")).toBe(true);
  });

  it("matches shifted bracket shortcuts from browser key values", () => {
    expect(shortcutMatches(event({ key: "{", altKey: true, shiftKey: true }), parseShortcut("Alt+Shift+["), "darwin")).toBe(true);
    expect(shortcutMatches(event({ key: "}", altKey: true, shiftKey: true }), parseShortcut("Alt+Shift+]"), "linux")).toBe(true);
  });

  it("rejects platform modifiers when shortcut does not include CmdOrCtrl", () => {
    const shortcut = parseShortcut("Alt+[");
    expect(shortcutMatches(event({ key: "[", altKey: true, metaKey: true }), shortcut, "darwin")).toBe(false);
    expect(shortcutMatches(event({ key: "[", altKey: true, ctrlKey: true }), shortcut, "linux")).toBe(false);
  });

  it("requires exact shift and alt modifiers", () => {
    expect(shortcutMatches(event({ key: "o", metaKey: true, shiftKey: false }), parseShortcut("CmdOrCtrl+Shift+O"), "darwin")).toBe(false);
    expect(shortcutMatches(event({ key: "o", metaKey: true, altKey: true }), parseShortcut("CmdOrCtrl+O"), "darwin")).toBe(false);
  });

  it("matches named keys case-insensitively", () => {
    expect(shortcutMatches(event({ key: "Backspace" }), parseShortcut("Backspace"), "linux")).toBe(true);
    expect(shortcutMatches(event({ key: "Enter" }), parseShortcut("Enter"), "linux")).toBe(true);
    expect(shortcutMatches(event({ key: "Tab" }), parseShortcut("Tab"), "linux")).toBe(true);
  });

  it("throws for malformed shortcut definitions", () => {
    expect(() => parseShortcut("Cmd+F")).toThrow();
    expect(() => parseShortcut("CmdOrCtrl+Ctrl+F")).toThrow();
    expect(() => parseShortcut("CmdOrCtrl+F+G")).toThrow();
  });

  it("resolves the first matching action", () => {
    const action = matchShortcut(
      event({ key: "f", metaKey: true }),
      [
        { actionId: "search.toggle", shortcut: "CmdOrCtrl+F" },
        { actionId: "file.save", shortcut: "CmdOrCtrl+S" },
      ],
      "darwin",
    );
    expect(action).toBe("search.toggle");
  });
});

describe("focus classification", () => {
  it("classifies text inputs as editable", () => {
    const input = document.createElement("input");
    expect(classifyFocusTarget(input)).toBe("editable");
  });

  it("classifies contenteditable nodes as editable", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(classifyFocusTarget(div)).toBe("editable");
  });

  it("classifies empty contenteditable nodes as editable", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "");
    expect(classifyFocusTarget(div)).toBe("editable");
  });

  it("classifies contenteditable descendants as editable", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "plaintext-only");
    const child = document.createElement("span");
    div.appendChild(child);
    expect(classifyFocusTarget(child)).toBe("editable");
  });

  it("classifies inherited contenteditable state as editable", () => {
    const child = document.createElement("span");
    Object.defineProperty(child, "isContentEditable", {
      configurable: true,
      value: true,
    });
    expect(classifyFocusTarget(child)).toBe("editable");
  });

  it("classifies Monaco editor descendants as editable", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "monaco-editor";
    const child = document.createElement("span");
    wrapper.appendChild(child);
    expect(classifyFocusTarget(child)).toBe("editable");
  });

  it("classifies buttons as non-editable", () => {
    expect(classifyFocusTarget(document.createElement("button"))).toBe("none");
  });

  it("classifies textareas as editable", () => {
    expect(classifyFocusTarget(document.createElement("textarea"))).toBe("editable");
  });

  it("classifies non-text inputs as non-editable", () => {
    for (const type of ["checkbox", "radio", "range"]) {
      const input = document.createElement("input");
      input.type = type;
      expect(classifyFocusTarget(input)).toBe("none");
    }
  });
});
