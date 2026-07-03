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

function charLabel(count: number): string {
  if (count === 0) return "empty";
  if (count === 1) return "1 char";
  return `${count} chars`;
}

function buildEntry(input: FreeTextResultInput): FreeTextHistoryEntry {
  const leftLabel = charLabel(input.left.length);
  const rightLabel = charLabel(input.right.length);

  return {
    id: `free-text:${input.createdAt}:${input.left.length}:${input.right.length}`,
    left: input.left,
    right: input.right,
    createdAt: input.createdAt,
    title: `${leftLabel[0].toUpperCase()}${leftLabel.slice(1)} vs ${rightLabel}`,
    summary: `Left ${leftLabel}, right ${rightLabel}`,
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
  localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
}

export function loadFreeTextHistory(): FreeTextHistoryEntry[] {
  const raw = localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY);
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
      normalized.push(entry);
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
  localStorage.removeItem(FREE_TEXT_HISTORY_STORAGE_KEY);
}
