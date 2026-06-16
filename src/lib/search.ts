import type { ResultGrouping } from "@/lib/preferences";
import type { SearchContext, SearchHitKind, SearchResult, Side } from "@/lib/types";

export interface SearchResultGroup {
  id: string;
  label: string;
  results: SearchResult[];
}

const SEARCH_KIND_LABELS: Record<SearchHitKind, string> = {
  path: "Path",
  constantPool: "Constants",
  text: "Text",
  source: "Source",
};

const SEARCH_CONTEXT_LABELS: Record<SearchContext, string> = {
  files: "Files index",
  diff: "Current diff",
};

const SIDE_LABELS: Record<Side, string> = {
  left: "Left",
  right: "Right",
};

const SEARCH_KIND_ORDER: SearchHitKind[] = ["path", "constantPool", "text", "source"];
const SIDE_ORDER: Side[] = ["left", "right"];

export function searchResultKey(result: SearchResult): string {
  return `${result.side}:${result.path}:${result.kind}:${result.line ?? "entry"}`;
}

export function labelForSearchKind(kind: SearchHitKind): string {
  return SEARCH_KIND_LABELS[kind];
}

export function labelForSearchContext(context: SearchContext): string {
  return SEARCH_CONTEXT_LABELS[context];
}

export function searchContextForActiveTab(activeTab: string): SearchContext {
  return activeTab === "files" ? "files" : "diff";
}

export function groupSearchResults(results: SearchResult[], grouping: ResultGrouping): SearchResultGroup[] {
  if (grouping === "side") {
    return SIDE_ORDER.map((side) => ({
      id: side,
      label: SIDE_LABELS[side],
      results: results.filter((result) => result.side === side),
    })).filter((group) => group.results.length > 0);
  }

  return SEARCH_KIND_ORDER.map((kind) => ({
    id: kind,
    label: labelForSearchKind(kind),
    results: results.filter((result) => result.kind === kind),
  })).filter((group) => group.results.length > 0);
}
