export type Side = "left" | "right";
export type StagedKind = "copy" | "edit";
export interface StagedEntry {
  side: Side;
  kind: StagedKind;
}
export type PairStatus = "onlyLeft" | "onlyRight" | "identical" | "different" | "differentMetadataOnly";
export type EntryKind = "directory" | "class" | "text" | "archive" | "binary";
export type Engine = "cfr" | "jdCore" | "jdCoreV0" | "vineflower";
export const DEFAULT_ENGINE: Engine = "vineflower";
export type Mode = "single" | "compare" | "text";
export type TreeFilter = "all" | "diff" | "same";
export type ContentFilter = "all" | "diff";
export type SearchTier = "T2" | "T3";
export type SearchHitKind = "path" | "text" | "constantPool" | "source";
export type SearchContext = "files" | "diff";
export type ViewMode = "source" | "bytecode";

export interface ViewEntryTab {
  entryPath: string;
  preview: EntryPreview;
  viewMode: ViewMode;
  lastFocus: number;
}

export interface ViewSourceSummary {
  id: string;
  path: string;
  name: string;
  kind: "archive" | "directory" | "file";
  signed?: boolean;
  entryCount: number;
}

export interface ViewSource extends ViewSourceSummary {
  nestedPairs: Record<string, ComparePair[]>;
  entryTabs: ViewEntryTab[];
}

export interface ViewWorkspaceState {
  sources: ViewSource[];
  activeSourceId?: string;
  activeEntryPath?: string;
}

export interface ArchiveSummary {
  path: string;
  metadata: { sourceKind: "archive" | "directory" | "file" | "text"; signed: boolean; multiRelease: boolean; zip64: boolean };
  entries: Array<{ path: string; kind: EntryKind; uncompressedSize: number }>;
}

export interface ComparePair {
  path: string;
  status: PairStatus;
  left?: { path: string; kind: EntryKind } | null;
  right?: { path: string; kind: EntryKind } | null;
}

export interface ArchiveDiff {
  pairs: ComparePair[];
}

export interface EntryPreview {
  path: string;
  kind: EntryKind;
  language: string;
  details?: string | null;
  content: string;
}

export interface DiffTab {
  path: string;
  pair: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  viewMode: ViewMode;
  lastFocus: number;
}

export interface CompareWorkspaceState {
  selected?: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  openTabs: DiffTab[];
  activeTab: "files" | string;
  editBuffer: string;
  viewMode: ViewMode;
}

export interface CommitResult {
  rewrittenPath: string;
  backupPath?: string;
  signatureInvalidated: boolean;
  copiedEntries: number;
}

export interface BackendSearchOptions {
  includePath: boolean;
  includeText: boolean;
  includeConstants: boolean;
}

export interface BackendSearchHit {
  entryPath: string;
  kind: SearchHitKind;
  line?: number;
  preview?: string;
}

export interface SearchResult {
  side: Side;
  path: string;
  tier: SearchTier;
  kind: SearchHitKind;
  line?: number;
  preview?: string;
}

export interface PlatformHints {
  dropHint?: string;
}
