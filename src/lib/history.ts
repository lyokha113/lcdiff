export type Mode = "single" | "compare" | "text";

export interface HistoryEntry {
  id: string;
  mode: Mode;
  paths: string[];
  openedAt: number;
}

export const HISTORY_LIMIT = 20;

const STORAGE_KEY = "lcdiff.history";

export function entryKey(mode: Mode, paths: string[]): string {
  // JSON-encode so paths containing spaces can't collide across sessions.
  return JSON.stringify([mode, paths]);
}

export function loadHistory(): HistoryEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        e &&
        typeof e.id === "string" &&
        (e.mode === "single" || e.mode === "compare" || e.mode === "text") &&
        Array.isArray(e.paths) &&
        typeof e.openedAt === "number",
    );
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function recordSession(
  mode: Mode,
  paths: string[],
  openedAt: number,
): HistoryEntry[] {
  const key = entryKey(mode, paths);
  const entry: HistoryEntry = { id: key, mode, paths, openedAt };
  const next = [entry, ...loadHistory().filter((e) => e.id !== key)].slice(
    0,
    HISTORY_LIMIT,
  );
  save(next);
  return next;
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
