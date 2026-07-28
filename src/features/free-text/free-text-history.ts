export interface FreeTextHistoryEntry {
  id: string;
  left: string;
  right: string;
  createdAt: number;
}

export type FreeTextResultInput = Omit<FreeTextHistoryEntry, "id">;

export const FREE_TEXT_HISTORY_STORAGE_KEY = "lcdiff.freeTextHistory.v1";
export const FREE_TEXT_HISTORY_LIMIT = 20;

function save(entries: FreeTextHistoryEntry[]): void {
  try {
    localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Temporary history must never block comparison.
  }
}

function isEntry(value: unknown): value is FreeTextHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.left === "string"
    && typeof entry.right === "string"
    && typeof entry.createdAt === "number"
    && Number.isFinite(entry.createdAt);
}

export function loadFreeTextHistory(): FreeTextHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter(isEntry)
      .sort((left, right) => right.createdAt - left.createdAt)
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .slice(0, FREE_TEXT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function recordFreeTextResult(input: FreeTextResultInput): FreeTextHistoryEntry[] {
  const entry = {
    ...input,
    id: `free-text:${input.createdAt}:${input.left.length}:${input.right.length}`,
  };
  const next = [entry, ...loadFreeTextHistory().filter((candidate) => candidate.id !== entry.id)]
    .slice(0, FREE_TEXT_HISTORY_LIMIT);
  save(next);
  return next;
}

export function clearFreeTextHistory(): void {
  try {
    localStorage.removeItem(FREE_TEXT_HISTORY_STORAGE_KEY);
  } catch {
    // In-memory clearing still succeeds.
  }
}
