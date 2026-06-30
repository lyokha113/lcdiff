import type { PlatformName } from "@/lib/shortcuts";

const MAC_TOKEN_LABELS: Record<string, string> = {
  cmdorctrl: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  backspace: "⌫",
};

const NON_MAC_TOKEN_LABELS: Record<string, string> = {
  cmdorctrl: "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

export function formatShortcutTokens(shortcut: string, platform: PlatformName): string[] {
  return shortcut.split("+").map((part) => {
    const token = part.trim();
    const lowerToken = token.toLowerCase();
    const labels = platform === "darwin" ? MAC_TOKEN_LABELS : NON_MAC_TOKEN_LABELS;
    const mapped = labels[lowerToken];

    if (mapped) {
      return mapped;
    }

    return token.length === 1 ? token.toUpperCase() : token;
  });
}
