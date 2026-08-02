import type {
  Side,
  TempMergeConflictPreview,
  TempMergeDecision,
  TempMergeSessionSummary,
  TempTargetCreation,
} from "@/ipc/types";

export type TempMergeOperation =
  | "create"
  | "previewMergeAll"
  | "stageMergeAll"
  | "apply"
  | "saveAs"
  | "discard";

export type TempMergeRecoveryOperation = "apply" | "saveAs" | "discard";

export interface TempMergeController {
  session: TempMergeSessionSummary | undefined;
  createOpen: boolean;
  conflictReview: TempMergeConflictPreview | undefined;
  busy: TempMergeOperation | undefined;
  error: string | undefined;
  retryOperation: TempMergeRecoveryOperation | undefined;
  setCreateOpen(open: boolean): void;
  create(sourceSide: Side, creation: TempTargetCreation): Promise<void>;
  previewMergeAll(sourceSide: Side): Promise<void>;
  stageMergeAll(sourceSide: Side, decisions: TempMergeDecision[]): Promise<void>;
  apply(): Promise<void>;
  saveAs(path: string): Promise<void>;
  discard(): Promise<void>;
}
