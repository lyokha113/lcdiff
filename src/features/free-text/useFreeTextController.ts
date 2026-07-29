import { useState } from "react";
import type { Side } from "@/lib/types";
import {
  clearFreeTextHistory,
  loadFreeTextHistory,
  recordFreeTextResult,
  type FreeTextHistoryEntry,
} from "./free-text-history";

export interface FreeTextController {
  draftLeft: string;
  draftRight: string;
  history: FreeTextHistoryEntry[];
  activeResultId: string | undefined;
  setDraft: (side: Side, content: string) => void;
  setDrafts: (left: string, right: string) => void;
  clearDrafts: () => void;
  confirmDiff: () => void;
  clearHistory: () => void;
  selectResult: (id: string) => void;
}

export function useFreeTextController(
  onMessage: (message: string) => void,
): FreeTextController {
  const [draftLeft, setDraftLeft] = useState("");
  const [draftRight, setDraftRight] = useState("");
  const [history, setHistory] = useState<FreeTextHistoryEntry[]>(() => loadFreeTextHistory());
  const [activeResultId, setActiveResultId] = useState<string | undefined>(() => history[0]?.id);

  function setDraft(side: Side, content: string) {
    if (side === "left") setDraftLeft(content);
    else setDraftRight(content);
  }

  function setDrafts(left: string, right: string) {
    setDraftLeft(left);
    setDraftRight(right);
  }

  function clearDrafts() {
    setDraftLeft("");
    setDraftRight("");
  }

  function confirmDiff() {
    const next = recordFreeTextResult({
      left: draftLeft,
      right: draftRight,
      createdAt: Date.now(),
    });
    setHistory(next);
    setActiveResultId(next[0]?.id);
    onMessage("Free text diff result saved to temporary history.");
  }

  function clearHistory() {
    clearFreeTextHistory();
    setHistory([]);
    setActiveResultId(undefined);
    onMessage("Free text history cleared.");
  }

  function selectResult(id: string) {
    setActiveResultId(id);
  }

  return {
    draftLeft,
    draftRight,
    history,
    activeResultId,
    setDraft,
    setDrafts,
    clearDrafts,
    confirmDiff,
    clearHistory,
    selectResult,
  };
}
