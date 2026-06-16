import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ResultGrouping } from "@/lib/preferences";
import { groupSearchResults, labelForSearchKind, searchResultKey } from "@/lib/search";
import type { SearchResult } from "@/lib/types";

interface SearchResultsPanelProps {
  results: SearchResult[];
  grouping: ResultGrouping;
  onInspect: (result: SearchResult) => void;
}

const MERGED_KIND_ORDER: SearchResult["kind"][] = ["path", "text", "constantPool", "source"];
const INSPECT_PRIORITY: SearchResult["kind"][] = ["source", "text", "constantPool", "path"];

interface MergedSearchResult {
  id: string;
  side: SearchResult["side"];
  path: string;
  kinds: SearchResult["kind"][];
  inspectResult: SearchResult;
}

function selectInspectResult(matches: SearchResult[]): SearchResult {
  for (const kind of INSPECT_PRIORITY) {
    const match = matches.find((result) => result.kind === kind);
    if (match) {
      return match;
    }
  }
  return matches[0];
}

function mergeResultsByFile(results: SearchResult[]): MergedSearchResult[] {
  const byFile = new Map<string, SearchResult[]>();
  for (const result of results) {
    const key = `${result.side}:${result.path}`;
    byFile.set(key, [...(byFile.get(key) ?? []), result]);
  }

  return Array.from(byFile.entries()).map(([id, matches]) => {
    const inspectResult = selectInspectResult(matches);
    return {
      id,
      side: inspectResult.side,
      path: inspectResult.path,
      kinds: MERGED_KIND_ORDER.filter((kind) => matches.some((result) => result.kind === kind)),
      inspectResult,
    };
  });
}

export function SearchResultsPanel({ results, grouping, onInspect }: SearchResultsPanelProps) {
  if (results.some((result) => result.kind === "source")) {
    const mergedResults = mergeResultsByFile(results);
    return (
      <section className="search-results-panel" aria-label="Search results">
        <div
          className="search-result-group"
          role="group"
          aria-label="Files search results"
        >
          <div className="search-result-group-header">
            <span>Files</span>
            <Badge variant="secondary">{mergedResults.length}</Badge>
          </div>
          <div className="search-result-rows">
            {mergedResults.map((result) => (
              <Button
                key={result.id}
                type="button"
                variant="outline"
                size="sm"
                className="search-result-row"
                onClick={() => onInspect(result.inspectResult)}
              >
                <Badge variant="outline">{result.side.toUpperCase()}</Badge>
                {result.kinds.map((kind) => {
                  const kindLabel = labelForSearchKind(kind);
                  return (
                    <Badge
                      key={kind}
                      variant="secondary"
                      aria-label={`${kindLabel} result kind`}
                      title={kindLabel}
                    >
                      {kindLabel}
                    </Badge>
                  );
                })}
                <span className="search-result-path">{result.path}</span>
                {result.inspectResult.line !== undefined && <span className="search-result-line">:{result.inspectResult.line}</span>}
                {result.inspectResult.preview && <span className="search-result-preview">{result.inspectResult.preview}</span>}
              </Button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const groups = groupSearchResults(results, grouping);

  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="search-results-panel" aria-label="Search results">
      {groups.map((group) => (
        <div
          key={group.id}
          className="search-result-group"
          role="group"
          aria-label={`${group.label} search results`}
        >
          <div className="search-result-group-header">
            <span>{group.label}</span>
            <Badge variant="secondary">{group.results.length}</Badge>
          </div>
          <div className="search-result-rows">
            {group.results.map((result) => {
              const kindLabel = labelForSearchKind(result.kind);

              return (
                <Button
                  key={searchResultKey(result)}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="search-result-row"
                  onClick={() => onInspect(result)}
                >
                  <Badge variant="outline">{result.side.toUpperCase()}</Badge>
                  <Badge
                    variant="secondary"
                    aria-label={`${kindLabel} result kind`}
                    title={kindLabel}
                  >
                    {kindLabel}
                  </Badge>
                  <span className="search-result-path">{result.path}</span>
                  {result.line !== undefined && <span className="search-result-line">:{result.line}</span>}
                  {result.preview && <span className="search-result-preview">{result.preview}</span>}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
