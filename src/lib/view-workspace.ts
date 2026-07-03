import type { ViewEntryTab, ViewSource, ViewWorkspaceState } from "./types";

function evictLeastRecentlyFocused(tabs: ViewEntryTab[], cap: number): ViewEntryTab[] {
  if (cap <= 0) return [];
  if (tabs.length <= cap) return tabs;
  const nextTabs = tabs.slice();
  while (nextTabs.length > cap) {
    let lruIndex = 0;
    for (let index = 1; index < nextTabs.length; index += 1) {
      if (nextTabs[index].lastFocus < nextTabs[lruIndex].lastFocus) lruIndex = index;
    }
    nextTabs.splice(lruIndex, 1);
  }
  return nextTabs;
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
  const sourceExists = state.sources.some((source) => source.sourceId === sourceId);
  if (!sourceExists) return state;

  let activeEntryPath: string | undefined = tab.entryPath;
  const sources = state.sources.map((source) => {
    if (source.sourceId !== sourceId) return source;
    const idx = source.entryTabs.findIndex((candidate) => candidate.entryPath === tab.entryPath);
    const tabs = source.entryTabs.slice();
    if (idx === -1) tabs.push(tab);
    else tabs[idx] = tab;
    const entryTabs = evictLeastRecentlyFocused(tabs, cap);
    if (!entryTabs.some((candidate) => candidate.entryPath === tab.entryPath)) {
      activeEntryPath = undefined;
    }
    return { ...source, entryTabs };
  });
  return {
    ...state,
    activeSourceId: sourceId,
    activeEntryPath,
    sources,
  };
}

export function focusViewEntryTab(
  state: ViewWorkspaceState,
  sourceId: string,
  entryPath: string,
  lastFocus: number,
): ViewWorkspaceState {
  if (!state.sources.some((source) => source.sourceId === sourceId)) return state;

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
    ...state,
    sources,
    activeSourceId: next?.sourceId,
    activeEntryPath: undefined,
  };
}
