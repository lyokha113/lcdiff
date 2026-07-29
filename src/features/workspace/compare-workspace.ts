import type { CompareWorkspaceState } from "@/lib/types";

export type { CompareWorkspaceState } from "@/lib/types";

export const emptyCompareWorkspace = (): CompareWorkspaceState => ({
  preview: {},
  openTabs: [],
  activeTab: "files",
  editBuffer: "",
  viewMode: "source",
});

export function focusCompareWorkspaceTab(
  state: CompareWorkspaceState,
  path: string,
  lastFocus: number,
): CompareWorkspaceState {
  const tab = state.openTabs.find((candidate) => candidate.path === path);
  if (!tab) return state;
  return {
    ...state,
    selected: tab.pair,
    preview: tab.preview,
    activeTab: path,
    editBuffer: tab.preview.left?.content ?? "",
    viewMode: tab.viewMode,
    openTabs: state.openTabs.map((candidate) =>
      candidate.path === path ? { ...candidate, lastFocus } : candidate,
    ),
  };
}
