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
import type { TempMergeController, TempMergeOperation } from "./temp-merge-types";

function errorMessage(error: unknown): string {
  return String(error);
}

export function useTempMergeController(): TempMergeController {
  const [session, setSession] = useState<TempMergeController["session"]>();
  const [createOpen, setCreateOpenState] = useState(false);
  const [conflictReview, setConflictReview] = useState<TempMergeController["conflictReview"]>();
  const [busy, setBusy] = useState<TempMergeController["busy"]>();
  const [error, setError] = useState<string>();
  const [retryOperation, setRetryOperation] = useState<TempMergeController["retryOperation"]>();
  const busyRef = useRef<TempMergeOperation | undefined>(undefined);
  const requestRef = useRef(0);

  const begin = useCallback((operation: TempMergeOperation) => {
    if (busyRef.current || (retryOperation && retryOperation !== operation)) return;
    busyRef.current = operation;
    const request = ++requestRef.current;
    setBusy(operation);
    setError(undefined);
    return request;
  }, [retryOperation]);

  const finish = useCallback((request: number) => {
    if (request !== requestRef.current) return false;
    busyRef.current = undefined;
    setBusy(undefined);
    return true;
  }, []);

  const setCreateOpen = useCallback((open: boolean) => {
    if (open && retryOperation) return;
    setCreateOpenState(open);
  }, [retryOperation]);

  const create = useCallback(async (sourceSide: Side, creation: TempTargetCreation) => {
    const request = begin("create");
    if (!request) return;
    try {
      const next = await createTempTarget(sourceSide, creation);
      if (request !== requestRef.current) return;
      setSession(next);
      setConflictReview(undefined);
      setCreateOpenState(false);
      setRetryOperation(undefined);
    } catch (failure) {
      if (request === requestRef.current) {
        setError(errorMessage(failure));
        setRetryOperation("create");
      }
    } finally {
      finish(request);
    }
  }, [begin, finish]);

  const previewMergeAll = useCallback(async (sourceSide: Side) => {
    const request = begin("previewMergeAll");
    if (!request) return;
    try {
      const preview = await previewMergeAllConflicts(sourceSide);
      if (request !== requestRef.current) return;
      setConflictReview(preview);
      setRetryOperation(undefined);
    } catch (failure) {
      if (request === requestRef.current) {
        setError(errorMessage(failure));
        setRetryOperation("previewMergeAll");
      }
    } finally {
      finish(request);
    }
  }, [begin, finish]);

  const stageMergeAll = useCallback(async (sourceSide: Side, decisions: TempMergeDecision[]) => {
    const request = begin("stageMergeAll");
    if (!request) return;
    try {
      await stageTempMergeAll(sourceSide, decisions);
      if (request !== requestRef.current) return;
      setConflictReview(undefined);
      setRetryOperation(undefined);
    } catch (failure) {
      if (request === requestRef.current) {
        setError(errorMessage(failure));
        setRetryOperation("stageMergeAll");
      }
    } finally {
      finish(request);
    }
  }, [begin, finish]);

  const apply = useCallback(async () => {
    const request = begin("apply");
    if (!request) return;
    try {
      const next = await applyTempMerge();
      if (request !== requestRef.current) return;
      setSession(next);
      setConflictReview(undefined);
      setRetryOperation(undefined);
    } catch (failure) {
      if (request === requestRef.current) {
        setSession(undefined);
        setConflictReview(undefined);
        setError(errorMessage(failure));
        setRetryOperation("apply");
      }
    } finally {
      finish(request);
    }
  }, [begin, finish]);

  const saveAs = useCallback(async (path: string) => {
    const request = begin("saveAs");
    if (!request) return;
    try {
      const next = await saveTempTargetAs(path);
      if (request !== requestRef.current) return;
      setSession(next);
      setRetryOperation(undefined);
    } catch (failure) {
      if (request === requestRef.current) {
        setError(errorMessage(failure));
        setRetryOperation("saveAs");
      }
    } finally {
      finish(request);
    }
  }, [begin, finish]);

  const discard = useCallback(async () => {
    const request = begin("discard");
    if (!request) return;
    try {
      const outcome = await discardTempTarget();
      if (request !== requestRef.current) return;
      if (outcome.kind === "discarded") {
        setSession(undefined);
        setConflictReview(undefined);
        setRetryOperation(undefined);
        return;
      }
      setSession(undefined);
      setConflictReview(undefined);
      setError(outcome.message);
      setRetryOperation("discard");
    } catch (failure) {
      if (request === requestRef.current) {
        setError(errorMessage(failure));
        setRetryOperation("discard");
      }
    } finally {
      finish(request);
    }
  }, [begin, finish]);

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
