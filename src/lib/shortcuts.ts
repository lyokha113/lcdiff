export type PlatformName = "darwin" | "linux" | "windows" | "unknown";

export interface KeyboardLikeEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target?: EventTarget | null;
}

export interface ShortcutBinding<ActionId extends string = string> {
  actionId: ActionId;
  shortcut: string | ParsedShortcut;
}

export interface ParsedShortcut {
  key: string;
  cmdOrCtrl: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type FocusKind = "none" | "editable";

const NON_EDITABLE_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const SHIFTED_KEY_ALIASES: Record<string, string> = {
  "{": "[",
  "}": "]",
};

const UNSUPPORTED_MODIFIER_TOKENS = new Set(["cmd", "command", "meta"]);

export function parseShortcut(shortcut: string): ParsedShortcut {
  const parsed: ParsedShortcut = {
    key: "",
    cmdOrCtrl: false,
    ctrl: false,
    shift: false,
    alt: false,
  };

  for (const rawPart of shortcut.split("+")) {
    const part = rawPart.trim();
    const modifier = part.toLowerCase();

    if (!part) {
      throw new Error(`Shortcut "${shortcut}" contains an empty token`);
    }

    if (modifier === "cmdorctrl") {
      parsed.cmdOrCtrl = true;
      continue;
    }

    if (modifier === "ctrl" || modifier === "control") {
      parsed.ctrl = true;
      continue;
    }

    if (modifier === "shift") {
      parsed.shift = true;
      continue;
    }

    if (modifier === "alt" || modifier === "option") {
      parsed.alt = true;
      continue;
    }

    if (UNSUPPORTED_MODIFIER_TOKENS.has(modifier)) {
      throw new Error(`Shortcut "${shortcut}" uses unsupported modifier "${part}"`);
    }

    if (parsed.key) {
      throw new Error(`Shortcut "${shortcut}" must include exactly one key`);
    }

    parsed.key = normalizeKey(part);
  }

  if (!parsed.key) {
    throw new Error(`Shortcut "${shortcut}" must include a key`);
  }

  if (parsed.cmdOrCtrl && parsed.ctrl) {
    throw new Error(`Shortcut "${shortcut}" cannot combine CmdOrCtrl with explicit Ctrl`);
  }

  return parsed;
}

export function shortcutMatches(event: KeyboardLikeEvent, shortcut: ParsedShortcut, platform: PlatformName): boolean {
  if (normalizeEventKey(event.key, event.shiftKey) !== shortcut.key) {
    return false;
  }

  if (event.shiftKey !== shortcut.shift || event.altKey !== shortcut.alt) {
    return false;
  }

  if (shortcut.ctrl) {
    return event.ctrlKey && !event.metaKey;
  }

  if (!shortcut.cmdOrCtrl) {
    return !event.ctrlKey && !event.metaKey;
  }

  if (platform === "darwin") {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

export function matchShortcut<ActionId extends string = string>(
  event: KeyboardLikeEvent,
  bindings: Array<ShortcutBinding<ActionId>>,
  platform: PlatformName = currentPlatform(),
): ActionId | undefined {
  for (const binding of bindings) {
    const shortcut = typeof binding.shortcut === "string" ? parseShortcut(binding.shortcut) : binding.shortcut;
    if (shortcutMatches(event, shortcut, platform)) {
      return binding.actionId;
    }
  }

  return undefined;
}

export function classifyFocusTarget(target: EventTarget | null | undefined): FocusKind {
  const element = targetElement(target);
  if (!element) {
    return "none";
  }

  if (element.closest(".monaco-editor")) {
    return "editable";
  }

  if (isContentEditableElement(element)) {
    return "editable";
  }

  if (element instanceof HTMLTextAreaElement) {
    return "editable";
  }

  if (element instanceof HTMLInputElement) {
    return NON_EDITABLE_INPUT_TYPES.has(element.type) ? "none" : "editable";
  }

  return "none";
}

export function currentPlatform(): PlatformName {
  const userAgentPlatform = typeof navigator === "undefined" ? "" : navigator.platform.toLowerCase();

  if (userAgentPlatform.includes("mac")) {
    return "darwin";
  }

  if (userAgentPlatform.includes("win")) {
    return "windows";
  }

  if (userAgentPlatform.includes("linux")) {
    return "linux";
  }

  return "unknown";
}

function normalizeKey(key: string): string {
  if (key === " " || key.toLowerCase() === "spacebar") {
    return "space";
  }

  return key.toLowerCase();
}

function normalizeEventKey(key: string, shiftKey: boolean): string {
  const normalized = normalizeKey(key);
  if (shiftKey && SHIFTED_KEY_ALIASES[normalized]) {
    return SHIFTED_KEY_ALIASES[normalized];
  }

  return normalized;
}

function isContentEditableElement(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current instanceof HTMLElement && current.isContentEditable) {
      return true;
    }

    const contentEditable = current.getAttribute("contenteditable");
    if (contentEditable === null) {
      continue;
    }

    const normalized = contentEditable.trim().toLowerCase();
    if (normalized === "false") {
      return false;
    }

    if (normalized === "" || normalized === "true" || normalized === "plaintext-only") {
      return true;
    }
  }

  return false;
}

function targetElement(target: EventTarget | null | undefined): Element | null {
  if (!target) {
    return null;
  }

  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}
