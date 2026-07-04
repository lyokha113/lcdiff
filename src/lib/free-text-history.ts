export interface FreeTextHistoryEntry {
  id: string;
  left: string;
  right: string;
  createdAt: number;
  title: string;
  summary: string;
}

export interface FreeTextResultInput {
  left: string;
  right: string;
  createdAt: number;
}

export const FREE_TEXT_HISTORY_STORAGE_KEY = "lcdiff.freeTextHistory.v1";
export const FREE_TEXT_HISTORY_LIMIT = 20;

const NAME_PREFIXES = [
  "Amber",
  "Blue",
  "Copper",
  "Grey",
  "Ivory",
  "Jade",
  "Silver",
  "Violet",
] as const;

const NAME_NOUNS = [
  "Atlas",
  "Beacon",
  "Draft",
  "Field",
  "Harbor",
  "Ledger",
  "Signal",
  "Trace",
] as const;

function charLabel(count: number): string {
  if (count === 0) return "empty";
  if (count === 1) return "1 char";
  return `${count} chars`;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomName(input: FreeTextResultInput): string {
  const seed = hashText(`${input.createdAt}\n${input.left}\n${input.right}`);
  const prefix = NAME_PREFIXES[seed % NAME_PREFIXES.length];
  const noun = NAME_NOUNS[Math.floor(seed / NAME_PREFIXES.length) % NAME_NOUNS.length];
  return `${prefix} ${noun}`;
}

function textSizeLabel(totalLength: number): string {
  if (totalLength < 120) return "Short text";
  if (totalLength < 900) return "Mid text";
  return "Long text";
}

function buildEntry(input: FreeTextResultInput): FreeTextHistoryEntry {
  const leftLabel = charLabel(input.left.length);
  const rightLabel = charLabel(input.right.length);
  const sizeLabel = textSizeLabel(input.left.length + input.right.length);

  return {
    id: `free-text:${input.createdAt}:${input.left.length}:${input.right.length}`,
    left: input.left,
    right: input.right,
    createdAt: input.createdAt,
    title: randomName(input),
    summary: `${sizeLabel} / ${leftLabel} left -> ${rightLabel} right`,
  };
}

function nextFreeTextId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) return baseId;

  let suffix = 1;
  while (existingIds.has(`${baseId}:${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}:${suffix}`;
}

function isEntry(value: unknown): value is FreeTextHistoryEntry {
  if (!value || typeof value !== "object") return false;

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.left === "string" &&
    typeof entry.right === "string" &&
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt) &&
    typeof entry.title === "string" &&
    typeof entry.summary === "string"
  );
}

function saveFreeTextHistory(entries: FreeTextHistoryEntry[]): void {
  try {
    localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort persistence: quota and platform storage failures must not
    // block the confirm flow.
  }
}

export function loadFreeTextHistory(): FreeTextHistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validEntries = parsed.filter(isEntry);
    validEntries.sort((left, right) => right.createdAt - left.createdAt);

    const seenIds = new Set<string>();
    const normalized: FreeTextHistoryEntry[] = [];
    for (const entry of validEntries) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      const rebuilt = buildEntry(entry);
      normalized.push({ ...entry, title: rebuilt.title, summary: rebuilt.summary });
      if (normalized.length === FREE_TEXT_HISTORY_LIMIT) break;
    }

    return normalized;
  } catch {
    return [];
  }
}

export function recordFreeTextResult(input: FreeTextResultInput): FreeTextHistoryEntry[] {
  const entry = buildEntry(input);
  const existing = loadFreeTextHistory();
  const existingIds = new Set(existing.map((candidate) => candidate.id));
  const id = nextFreeTextId(entry.id, existingIds);
  const next = [{ ...entry, id }, ...existing].slice(0, FREE_TEXT_HISTORY_LIMIT);
  saveFreeTextHistory(next);
  return next;
}

export function clearFreeTextHistory(): void {
  try {
    localStorage.removeItem(FREE_TEXT_HISTORY_STORAGE_KEY);
  } catch {
    // Best-effort persistence: storage failures must not block clearing the
    // in-memory workspace state.
  }
}
