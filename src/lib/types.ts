import type { DiffOnMount, OnMount } from "@monaco-editor/react";

export type Side = "left" | "right";
export type PairStatus = "onlyLeft" | "onlyRight" | "identical" | "different" | "differentMetadataOnly";
export type EntryKind = "directory" | "class" | "text" | "binary";
export type Engine = "cfr" | "vineflower";
export type Mode = "single" | "compare";
export type SearchScope = Side | "both";
export type TreeFilter = "all" | "differences" | "onlyLeft" | "onlyRight";
export type SearchTier = "T2" | "T3";
export type CodeEditor = Parameters<OnMount>[0];
export type DiffCodeEditor = Parameters<DiffOnMount>[0];
export type MonacoApi = Parameters<OnMount>[1];
export type DecorationRef = { current: string[] };
export type ViewMode = "source" | "bytecode";

export interface ArchiveSummary {
  path: string;
  metadata: { sourceKind: "archive" | "directory"; signed: boolean; multiRelease: boolean; zip64: boolean };
  entries: Array<{ path: string; kind: EntryKind; uncompressedSize: number }>;
}

export interface ComparePair {
  path: string;
  status: PairStatus;
  left?: { path: string; kind: EntryKind };
  right?: { path: string; kind: EntryKind };
}

export interface ArchiveDiff {
  pairs: ComparePair[];
}

export interface EntryPreview {
  path: string;
  kind: EntryKind;
  language: string;
  details?: string;
  content: string;
}

export interface CommitResult {
  rewrittenPath: string;
  backupPath?: string;
  signatureInvalidated: boolean;
  copiedEntries: number;
}

export interface SearchResult {
  side: Side;
  path: string;
  tier: SearchTier;
  matchKind: string;
  line?: number;
}

export interface SearchHit {
  path: string;
  matchKind: string;
  line?: number;
}

export interface PlatformHints {
  dropHint?: string;
}
