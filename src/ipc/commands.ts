import { invoke } from "@tauri-apps/api/core";
import type {
  ArchiveDiff,
  ArchiveSummary,
  CommitResult,
  Engine,
  EntryPreview,
  PlatformHints,
  SearchHit,
  SearchOptions,
  Side,
  SystemFont,
  ViewSourceSummary,
} from "@/ipc/types";

export function validatePath(raw: string): Promise<string> {
  return invoke("validate_path", { raw });
}

export function platformHints(): Promise<PlatformHints> {
  return invoke("platform_hints");
}

export function listSystemFonts(): Promise<SystemFont[]> {
  return invoke("list_system_fonts");
}

export function openArchive(path: string, side: Side): Promise<ArchiveSummary> {
  return invoke("open_archive", { path, side });
}

export function computeDiff(): Promise<ArchiveDiff> {
  return invoke("compute_diff");
}

export function computeNestedDiff(nestedPath: string): Promise<ArchiveDiff> {
  return invoke("compute_nested_diff", { nestedPath });
}

export function openViewSource(path: string): Promise<ViewSourceSummary> {
  return invoke("open_view_source", { path });
}

export function listViewSources(): Promise<ViewSourceSummary[]> {
  return invoke("list_view_sources");
}

export function readEntry(side: Side, entryPath: string): Promise<EntryPreview> {
  return invoke("read_entry", { side, entryPath });
}

export function readViewEntry(sourceId: string, entryPath: string): Promise<EntryPreview> {
  return invoke("read_view_entry", { sourceId, entryPath });
}

export function computeViewNestedEntries(
  sourceId: string,
  nestedPath: string,
): Promise<ArchiveDiff> {
  return invoke("compute_view_nested_entries", { sourceId, nestedPath });
}

export function closeViewSource(sourceId: string): Promise<void> {
  return invoke("close_view_source", { sourceId });
}

export function setEngine(engine: Engine): Promise<void> {
  return invoke("set_engine", { engine });
}

export function disassemble(side: Side, entryPath: string): Promise<string> {
  return invoke("disassemble", { side, entryPath });
}

export function disassembleViewEntry(sourceId: string, entryPath: string): Promise<string> {
  return invoke("disassemble_view_entry", { sourceId, entryPath });
}

export function stageCopy(from: Side, to: Side, entryPath: string): Promise<void> {
  return invoke("stage_copy", { from, to, entryPath });
}

export function stageWrite(side: Side, entryPath: string, content: string): Promise<void> {
  return invoke("stage_write", { side, entryPath, content });
}

export function stageViewWrite(
  sourceId: string,
  entryPath: string,
  content: string,
): Promise<void> {
  return invoke("stage_view_write", { sourceId, entryPath, content });
}

export function unstageViewWrite(sourceId: string, entryPath: string): Promise<void> {
  return invoke("unstage_view_write", { sourceId, entryPath });
}

export function commitView(sourceId: string, backup: boolean): Promise<CommitResult> {
  return invoke("commit_view", { sourceId, backup });
}

export function commitMerge(
  targetSide: Side,
  backup: boolean,
  confirmSigned: boolean,
): Promise<CommitResult> {
  return invoke("commit_merge", { targetSide, backup, confirmSigned });
}

export function clearStaged(): Promise<void> {
  return invoke("clear_staged");
}

export function unstage(entryPath: string, side?: Side): Promise<void> {
  return invoke("unstage", { entryPath, side });
}

export function search(
  side: Side,
  query: string,
  options: SearchOptions,
): Promise<SearchHit[]> {
  return invoke("search", { side, query, options });
}

export function searchViewSource(
  sourceId: string,
  query: string,
  options: SearchOptions,
): Promise<SearchHit[]> {
  return invoke("search_view_source", { sourceId, query, options });
}

export function deepSearch(side: Side, query: string, searchId: number): Promise<SearchHit[]> {
  return invoke("deep_search", { side, query, searchId });
}

export function deepSearchViewSource(
  sourceId: string,
  query: string,
  searchId: number,
): Promise<SearchHit[]> {
  return invoke("deep_search_view_source", { sourceId, query, searchId });
}

export function cancelDeepSearch(): Promise<void> {
  return invoke("cancel_deep_search");
}

export function prefetchSiblings(side: Side, entryPath: string): Promise<void> {
  return invoke("prefetch_siblings", { side, entryPath });
}

export function pendingOpenPaths(): Promise<string[]> {
  return invoke("pending_open_paths");
}
