import Editor, { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { Side } from "@/lib/types";
import type { FreeTextHistoryEntry } from "./free-text-history";
import {
  editorFontFamilyForCss,
  type EffectiveColorPattern,
  type UiPreferences,
} from "@/features/preferences/preferences";

export interface FreeTextWorkspaceProps {
  preferences: UiPreferences;
  effectiveColorPattern: EffectiveColorPattern;
  ignoreTrimWhitespace: boolean;
  draftLeft: string;
  draftRight: string;
  history: FreeTextHistoryEntry[];
  activeResultId: string | undefined;
  onDraftChange: (side: Side, content: string) => void;
  onClearDrafts: () => void;
  onConfirmDiff: () => void;
  onClearHistory: () => void;
  onSelectResult: (id: string) => void;
}

export function FreeTextWorkspace({
  preferences,
  effectiveColorPattern,
  ignoreTrimWhitespace,
  draftLeft,
  draftRight,
  history,
  activeResultId,
  onDraftChange,
  onClearDrafts,
  onConfirmDiff,
  onClearHistory,
  onSelectResult,
}: FreeTextWorkspaceProps) {
  const activeResult = history.find((entry) => entry.id === activeResultId);
  const monacoTheme = effectiveColorPattern === "light" ? "light" : "vs-dark";
  const editorOptions = useMemo<editor.IEditorConstructionOptions>(() => ({
    fontFamily: editorFontFamilyForCss(preferences.editor.fontFamily),
    fontSize: preferences.editor.fontSize,
    fontLigatures: true,
    minimap: preferences.editor.minimap === "on"
      ? { enabled: true, side: "right", size: "proportional", showSlider: "mouseover" }
      : { enabled: false },
    wordWrap: preferences.editor.wordWrap,
    lineNumbers: preferences.editor.lineNumbers,
    automaticLayout: true,
  }), [
    preferences.editor.fontFamily,
    preferences.editor.fontSize,
    preferences.editor.lineNumbers,
    preferences.editor.minimap,
    preferences.editor.wordWrap,
  ]);

  function formatHistoryTime(createdAt: number) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(createdAt));
  }

  return (
    <div className="free-text-workspace">
      <section className="free-text-drafts" aria-label="Free text inputs">
        <div className="free-text-draft-pane">
          <Editor
            height="100%"
            language="plaintext"
            value={draftLeft}
            theme={monacoTheme}
            options={{ ...editorOptions, ariaLabel: "Left free text input" }}
            onChange={(value) => onDraftChange("left", value ?? "")}
          />
        </div>
        <div className="free-text-draft-pane">
          <Editor
            height="100%"
            language="plaintext"
            value={draftRight}
            theme={monacoTheme}
            options={{ ...editorOptions, ariaLabel: "Right free text input" }}
            onChange={(value) => onDraftChange("right", value ?? "")}
          />
        </div>
      </section>

      <div className="free-text-actions">
        <Button onClick={onConfirmDiff}>Compare free text</Button>
        <Button
          variant="outline"
          disabled={!draftLeft && !draftRight}
          onClick={() => {
            if (
              (draftLeft || draftRight)
              && !globalThis.confirm("Clear both free text drafts?")
            ) return;
            onClearDrafts();
          }}
        >
          Clear drafts
        </Button>
        <Button variant="outline" onClick={onClearHistory} disabled={history.length === 0}>
          Clear free text history
        </Button>
      </div>

      <section className="free-text-results" aria-label="Free text results">
        <nav className="free-text-history" aria-label="Free text temporary history">
          {history.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`free-text-history__item${entry.id === activeResultId ? " active" : ""}`}
              aria-pressed={entry.id === activeResultId}
              onClick={() => onSelectResult(entry.id)}
            >
              <span className="free-text-history__marker" aria-hidden="true" />
              <span className="free-text-history__content">
                <span className="free-text-history__time-row">
                  <time dateTime={new Date(entry.createdAt).toISOString()}>{formatHistoryTime(entry.createdAt)}</time>
                  <span>Free text</span>
                </span>
                <span className="free-text-history__summary">
                  {entry.left.length + entry.right.length} characters
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="free-text-result-panel">
          {activeResult ? (
            <DiffEditor
              height="100%"
              language="plaintext"
              original={activeResult.left}
              modified={activeResult.right}
              theme={monacoTheme}
              options={{
                ...editorOptions,
                readOnly: true,
                domReadOnly: true,
                originalEditable: false,
                renderSideBySide: true,
                useInlineViewWhenSpaceIsLimited: false,
                ignoreTrimWhitespace,
                originalAriaLabel: "Left confirmed free text result",
                modifiedAriaLabel: "Right confirmed free text result",
              }}
            />
          ) : (
            <div className="free-text-empty" role="status">
              Confirm a comparison to create a temporary diff result.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
