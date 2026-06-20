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
  onClose: () => void;
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
  onClose,
  onIncludeSourceChange,
}: SearchBarProps) {
  if (!open) return null;

  const filesContext = context === "files";
  const placeholder = filesContext ? "Search paths, text, constants" : "Find in current diff";
  const clearLabel = filesContext ? "Clear results" : "Clear find";
  const surfaceLabel = filesContext ? "Search files" : "Find in current diff";

  return (
    <section className="search-surface__bar" role="search" aria-label={surfaceLabel} data-context={context}>
      <header className="search-surface__header">
        <span className="search-surface__context">{labelForSearchContext(context)}</span>
        <span className="search-surface__hint">
          {filesContext ? "Across loaded sources" : "Inside the active document"}
        </span>
        <Button variant="ghost" size="icon" aria-label="Close search" onClick={onClose}><X /></Button>
      </header>
      <div className="search-surface__controls">
        <label className="search-field">
          <Search aria-hidden="true" />
          <Input
            className="search-input"
            value={query}
            placeholder={placeholder}
            aria-label={surfaceLabel}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }}
          />
        </label>
        {filesContext && (
          <label className="check-label search-inline-check">
            <Checkbox
              aria-label="Include decompiled source search"
              checked={includeSource}
              onCheckedChange={(checked) => onIncludeSourceChange(checked === true)}
            />
            Decompiled source
          </label>
        )}
        <Button aria-label={filesContext ? "Search files" : "Find"} disabled={filesContext && searching} onClick={onSearch}>
          <Search /> {filesContext ? "Search" : "Find"}
        </Button>
        {filesContext && searching && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button variant="ghost" aria-label={clearLabel} onClick={onClear}>{clearLabel}</Button>
      </div>
    </section>
  );
}
