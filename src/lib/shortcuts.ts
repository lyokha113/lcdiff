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

export function parseShortcut(shortcut: string): ParsedShortcut {
  const parsed: ParsedShortcut = {
    key: "",
    cmdOrCtrl: false,
    shift: false,
    alt: false,
  };

  for (const rawPart of shortcut.split("+")) {
    const part = rawPart.trim();
    const modifier = part.toLowerCase();

    if (modifier === "cmdorctrl") {
      parsed.cmdOrCtrl = true;
    } else if (modifier === "shift") {
      parsed.shift = true;
    } else if (modifier === "alt" || modifier === "option") {
      parsed.alt = true;
    } else if (part.length > 0) {
      parsed.key = normalizeKey(part);
    }
  }

  if (!parsed.key) {
    throw new Error(`Shortcut "${shortcut}" must include a key`);
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

  if (!shortcut.cmdOrCtrl) {
    return !event.metaKey && !event.ctrlKey;
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
