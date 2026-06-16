import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { labelForSearchContext } from "@/lib/search";
import type { SearchContext } from "@/lib/types";

interface SearchBarProps {
  open: boolean;
  context: SearchContext;
  query: string;
  includeSource: boolean;
  searching: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onCancel: () => void;
  onClear: () => void;
  onIncludeSourceChange: (value: boolean) => void;
}

export function SearchBar({
  open,
  context,
  query,
  includeSource,
  searching,
  onQueryChange,
  onSearch,
  onCancel,
  onClear,
  onIncludeSourceChange,
}: SearchBarProps) {
  if (!open) return null;

  const filesContext = context === "files";
  const placeholder = filesContext ? "Search paths, text, constants" : "Find in current diff";
  const clearLabel = filesContext ? "Clear results" : "Clear find";

  return (
    <div className="search-bar" data-context={context}>
      <span className="search-context-label">{labelForSearchContext(context)}</span>
      <Input
        className="search-input"
        value={query}
        placeholder={placeholder}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
      />
      {filesContext ? (
        <>
          <label className="check-label search-inline-check">
            <Checkbox
              aria-label="Include decompiled source search"
              checked={includeSource}
              onCheckedChange={(checked) => onIncludeSourceChange(checked === true)}
            />
            Decompiled source
          </label>
          <Button aria-label="Search files" disabled={searching} onClick={onSearch}>
            <Search /> Search files
          </Button>
          {searching && (
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
          )}
        </>
      ) : (
        <Button aria-label="Find" onClick={onSearch}><Search /> Find</Button>
      )}
      <Button variant="ghost" aria-label={clearLabel} onClick={onClear}><X /> {clearLabel}</Button>
    </div>
  );
}
