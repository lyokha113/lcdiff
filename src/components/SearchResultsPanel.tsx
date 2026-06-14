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

export function SearchResultsPanel({ results, grouping, onInspect }: SearchResultsPanelProps) {
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
