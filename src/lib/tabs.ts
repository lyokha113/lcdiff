import type { ComparePair, EntryPreview, Side, ViewMode } from "@/lib/types";

export interface DiffTab {
  path: string;
  pair: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  viewMode: ViewMode;
  lastFocus: number;
}

export function upsertTab(tabs: DiffTab[], next: DiffTab): DiffTab[] {
  const idx = tabs.findIndex((t) => t.path === next.path);
  if (idx === -1) return [...tabs, next];
  const copy = tabs.slice();
  copy[idx] = next;
  return copy;
}

export function evictLru(tabs: DiffTab[], cap: number): DiffTab[] {
  if (tabs.length <= cap) return tabs;
  let lru = tabs[0];
  for (const t of tabs) if (t.lastFocus < lru.lastFocus) lru = t;
  return tabs.filter((t) => t.path !== lru.path);
}

export function pickNeighbor(tabs: DiffTab[], closingPath: string): "files" | string {
  const idx = tabs.findIndex((t) => t.path === closingPath);
  if (idx === -1) return "files";
  const remaining = tabs.filter((t) => t.path !== closingPath);
  if (remaining.length === 0) return "files";
  return (remaining[idx] ?? remaining[remaining.length - 1]).path;
}
