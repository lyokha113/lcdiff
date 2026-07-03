import type { ViewEntryTab, ViewSource, ViewWorkspaceState } from "./types";

function evictLeastRecentlyFocused(tabs: ViewEntryTab[], cap: number): ViewEntryTab[] {
  if (tabs.length <= cap) return tabs;
  let lru = tabs[0];
  for (const tab of tabs) {
    if (tab.lastFocus < lru.lastFocus) lru = tab;
  }
  return tabs.filter((tab) => tab.entryPath !== lru.entryPath);
}

export function openViewSource(state: ViewWorkspaceState, source: ViewSource): ViewWorkspaceState {
  const idx = state.sources.findIndex((candidate) => candidate.sourceId === source.sourceId);
  const sources = state.sources.slice();
  if (idx === -1) sources.push(source);
  else sources[idx] = { ...source, entryTabs: sources[idx].entryTabs };
  return {
    ...state,
    sources,
    activeSourceId: source.sourceId,
    activeEntryPath: undefined,
  };
}

export function upsertViewEntryTab(
  state: ViewWorkspaceState,
  sourceId: string,
  tab: ViewEntryTab,
  cap: number,
): ViewWorkspaceState {
  return {
    ...state,
    activeSourceId: sourceId,
    activeEntryPath: tab.entryPath,
    sources: state.sources.map((source) => {
      if (source.sourceId !== sourceId) return source;
      const idx = source.entryTabs.findIndex((candidate) => candidate.entryPath === tab.entryPath);
      const tabs = source.entryTabs.slice();
      if (idx === -1) tabs.push(tab);
      else tabs[idx] = tab;
      return { ...source, entryTabs: evictLeastRecentlyFocused(tabs, cap) };
    }),
  };
}

export function focusViewEntryTab(
  state: ViewWorkspaceState,
  sourceId: string,
  entryPath: string,
  lastFocus: number,
): ViewWorkspaceState {
  return {
    ...state,
    activeSourceId: sourceId,
    activeEntryPath: entryPath,
    sources: state.sources.map((source) => {
      if (source.sourceId !== sourceId) return source;
      return {
        ...source,
        entryTabs: source.entryTabs.map((tab) =>
          tab.entryPath === entryPath ? { ...tab, lastFocus } : tab,
        ),
      };
    }),
  };
}

export function closeViewSource(state: ViewWorkspaceState, sourceId: string): ViewWorkspaceState {
  const index = state.sources.findIndex((source) => source.sourceId === sourceId);
  if (index === -1) return state;
  const sources = state.sources.filter((source) => source.sourceId !== sourceId);
  if (state.activeSourceId !== sourceId) return { ...state, sources };
  const next = sources[index] ?? sources[index - 1];
  return {
    sources,
    activeSourceId: next?.sourceId,
    activeEntryPath: undefined,
  };
}
