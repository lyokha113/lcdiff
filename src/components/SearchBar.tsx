import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { TreeFilter } from "@/lib/types";

interface SearchBarProps {
  open: boolean;
  query: string;
  treeFilter: TreeFilter;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onFilterChange: (filter: TreeFilter) => void;
}

export function SearchBar({ open, query, treeFilter, onQueryChange, onSearch, onFilterChange }: SearchBarProps) {
  if (!open) return null;
  return (
    <div className="search-bar">
      <Input
        className="search-input"
        value={query}
        placeholder="Search paths, text, constants"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
      />
      <Button aria-label="Search" onClick={onSearch}><Search /> Search</Button>
      <Select value={treeFilter} onValueChange={(v) => onFilterChange(v as TreeFilter)}>
        <SelectTrigger aria-label="Tree filter"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="all">Show all</SelectItem>
          <SelectItem value="diff">Differences</SelectItem>
          <SelectItem value="same">Identical</SelectItem>
        </SelectGroup></SelectContent>
      </Select>
    </div>
  );
}
