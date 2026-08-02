import {
  applyTempMerge,
  createTempTarget,
  discardTempTarget,
  previewMergeAllConflicts,
  saveTempTargetAs,
  stageTempMergeAll,
} from "@/ipc/commands";
import { useCallback, useRef, useState } from "react";
import type { Side, TempMergeDecision, TempTargetCreation } from "@/ipc/types";
import type {
  TempMergeController,
  TempMergeOperation,
  TempMergeRecoveryOperation,
} from "./temp-merge-types";

function errorMessage(error: unknown): string {
  return String(error);
}

function isRecoveryError(operation: TempMergeRecoveryOperation, error: string): boolean {
  if (operation === "apply") return error.includes("retry Apply");
  return error.includes("retry Save As");
}

export function useTempMergeController(): TempMergeController {
  const [session, setSession] = useState<TempMergeController["session"]>();
  const [createOpen, setCreateOpenState] = useState(false);
  const [conflictReview, setConflictReview] = useState<TempMergeController["conflictReview"]>();
  const [busy, setBusy] = useState<TempMergeController["busy"]>();
  const [error, setError] = useState<string>();
  const [retryOperation, setRetryOperation] = useState<TempMergeController["retryOperation"]>();
  const activeOperationRef = useRef<TempMergeOperation | undefined>(undefined);
  const recoveryOperationRef = useRef<TempMergeRecoveryOperation | undefined>(undefined);

  const begin = useCallback((operation: TempMergeOperation) => {
    if (
      activeOperationRef.current
      || (recoveryOperationRef.current && recoveryOperationRef.current !== operation)
    ) return false;
    activeOperationRef.current = operation;
    setBusy(operation);
    setError(undefined);
    return true;
  }, []);

  const isActive = useCallback((operation: TempMergeOperation) => (
    activeOperationRef.current === operation
  ), []);

  const finish = useCallback((operation: TempMergeOperation) => {
    if (!isActive(operation)) return;
    activeOperationRef.current = undefined;
    setBusy(recoveryOperationRef.current);
  }, [isActive]);

  const beginRecovery = useCallback((operation: TempMergeRecoveryOperation) => {
    recoveryOperationRef.current = operation;
    setBusy(operation);
    setRetryOperation(operation);
  }, []);

  const finishRecovery = useCallback(() => {
    recoveryOperationRef.current = undefined;
    setRetryOperation(undefined);
  }, []);

  const setCreateOpen = useCallback((open: boolean) => {
    if (open && recoveryOperationRef.current) return;
    setCreateOpenState(open);
  }, []);

  const create = useCallback(async (sourceSide: Side, creation: TempTargetCreation) => {
    if (!begin("create")) return;
    try {
      const next = await createTempTarget(sourceSide, creation);
      if (!isActive("create")) return;
      setSession(next);
      setConflictReview(undefined);
      setCreateOpenState(false);
      finishRecovery();
    } catch (failure) {
      if (isActive("create")) setError(errorMessage(failure));
    } finally {
      finish("create");
    }
  }, [begin, finish, finishRecovery, isActive]);

  const previewMergeAll = useCallback(async (sourceSide: Side) => {
    if (!begin("previewMergeAll")) return;
    try {
      const preview = await previewMergeAllConflicts(sourceSide);
      if (!isActive("previewMergeAll")) return;
      setConflictReview(preview);
    } catch (failure) {
      if (isActive("previewMergeAll")) setError(errorMessage(failure));
    } finally {
      finish("previewMergeAll");
    }
  }, [begin, finish, isActive]);

  const stageMergeAll = useCallback(async (sourceSide: Side, decisions: TempMergeDecision[]) => {
    if (!begin("stageMergeAll")) return;
    try {
      await stageTempMergeAll(sourceSide, decisions);
      if (!isActive("stageMergeAll")) return;
      setConflictReview(undefined);
    } catch (failure) {
      if (isActive("stageMergeAll")) setError(errorMessage(failure));
    } finally {
      finish("stageMergeAll");
    }
  }, [begin, finish, isActive]);

  const apply = useCallback(async () => {
    if (!begin("apply")) return;
    try {
      const next = await applyTempMerge();
      if (!isActive("apply")) return;
      setSession(next);
      setConflictReview(undefined);
      finishRecovery();
    } catch (failure) {
      if (!isActive("apply")) return;
      const message = errorMessage(failure);
      if (isRecoveryError("apply", message)) {
        setSession(undefined);
        setConflictReview(undefined);
        beginRecovery("apply");
      }
      setError(message);
    } finally {
      finish("apply");
    }
  }, [begin, beginRecovery, finish, finishRecovery, isActive]);

  const saveAs = useCallback(async (path: string) => {
    if (!begin("saveAs")) return;
    try {
      const next = await saveTempTargetAs(path);
      if (!isActive("saveAs")) return;
      setSession(next);
      finishRecovery();
    } catch (failure) {
      if (!isActive("saveAs")) return;
      const message = errorMessage(failure);
      if (isRecoveryError("saveAs", message)) {
        setSession(undefined);
        setConflictReview(undefined);
        beginRecovery("saveAs");
      }
      setError(message);
    } finally {
      finish("saveAs");
    }
  }, [begin, beginRecovery, finish, finishRecovery, isActive]);

  const discard = useCallback(async () => {
    if (!begin("discard")) return;
    try {
      const outcome = await discardTempTarget();
      if (!isActive("discard")) return;
      if (outcome.kind === "discarded") {
        setSession(undefined);
        setConflictReview(undefined);
        finishRecovery();
        return;
      }
      setSession(undefined);
      setConflictReview(undefined);
      setError(outcome.message);
      beginRecovery("discard");
    } catch (failure) {
      if (isActive("discard")) setError(errorMessage(failure));
    } finally {
      finish("discard");
    }
  }, [begin, beginRecovery, finish, finishRecovery, isActive]);

  return {
    session,
    createOpen,
    conflictReview,
    busy,
    error,
    retryOperation,
    setCreateOpen,
    create,
    previewMergeAll,
    stageMergeAll,
    apply,
    saveAs,
    discard,
  };
}
