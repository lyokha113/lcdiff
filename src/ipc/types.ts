export type Side = "left" | "right";
export type EntryKind = "directory" | "class" | "text" | "archive" | "binary";
export type Engine = "cfr" | "jdCore" | "jdCoreV0" | "vineflower";
export type ArchiveSourceKind = "archive" | "directory" | "file";
export type PairStatus = "onlyLeft" | "onlyRight" | "identical" | "different";
export type SearchHitKind = "path" | "text" | "constantPool" | "source";

export interface ArchiveEntry {
  path: string;
  kind: EntryKind;
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
}

export interface ArchiveMetadata {
  sourceKind: ArchiveSourceKind;
  signed: boolean;
  multiRelease: boolean;
  zip64: boolean;
}

export interface ArchiveSummary {
  path: string;
  metadata: ArchiveMetadata;
  entries: ArchiveEntry[];
}

export interface ComparePair {
  path: string;
  left: ArchiveEntry | null;
  right: ArchiveEntry | null;
  status: PairStatus;
}

export interface ArchiveDiff {
  pairs: ComparePair[];
}

export interface ViewSourceSummary {
  id: string;
  path: string;
  name: string;
  kind: ArchiveSourceKind;
  signed: boolean;
  entryCount: number;
}

export interface EntryPreview {
  path: string;
  kind: EntryKind;
  language: string;
  details: string | null;
  content: string;
}

export interface CommitResult {
  rewrittenPath: string;
  backupPath: string | null;
  signatureInvalidated: boolean;
  copiedEntries: number;
}

export interface PlatformHints {
  os: string;
  sessionType: string | null;
  wayland: boolean;
  dropHint: string | null;
}

export interface SearchOptions {
  includePath: boolean;
  includeText: boolean;
  includeConstants: boolean;
}

export interface SearchHit {
  entryPath: string;
  kind: SearchHitKind;
  line?: number;
  preview?: string;
}

export interface SystemFont {
  family: string;
  monospaceLikely: boolean;
  localNames: string[];
  fontFile: string | null;
}

export interface SearchProgress {
  searchId: number;
  completed: number;
  total: number;
  entryPath: string;
}

export interface DeepSearchMatch {
  searchId: number;
  side: Side;
  hit: SearchHit;
}

export interface OsOpenPathsPayload {
  paths: string[];
}

export interface AppActionPayload {
  actionId: string;
}
