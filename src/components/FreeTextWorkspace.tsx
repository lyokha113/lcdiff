import Editor, { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  clearFreeTextHistory,
  loadFreeTextHistory,
  recordFreeTextResult,
  type FreeTextHistoryEntry,
} from "@/lib/free-text-history";
import {
  editorFontFamilyForCss,
  type EffectiveColorPattern,
  type UiPreferences,
} from "@/lib/preferences";

interface FreeTextWorkspaceProps {
  preferences: UiPreferences;
  effectiveColorPattern: EffectiveColorPattern;
  ignoreTrimWhitespace: boolean;
  onMessage: (message: string) => void;
}

export function FreeTextWorkspace({
  preferences,
  effectiveColorPattern,
  ignoreTrimWhitespace,
  onMessage,
}: FreeTextWorkspaceProps) {
  const [draftLeft, setDraftLeft] = useState("");
  const [draftRight, setDraftRight] = useState("");
  const [history, setHistory] = useState<FreeTextHistoryEntry[]>(() => loadFreeTextHistory());
  const [activeResultId, setActiveResultId] = useState<string | undefined>(() => history[0]?.id);

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
            onChange={(value) => setDraftLeft(value ?? "")}
          />
        </div>
        <div className="free-text-draft-pane">
          <Editor
            height="100%"
            language="plaintext"
            value={draftRight}
            theme={monacoTheme}
            options={{ ...editorOptions, ariaLabel: "Right free text input" }}
            onChange={(value) => setDraftRight(value ?? "")}
          />
        </div>
      </section>

      <div className="free-text-actions">
        <Button onClick={confirmDiff}>Compare free text</Button>
        <Button variant="outline" onClick={clearHistory} disabled={history.length === 0}>
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
              onClick={() => setActiveResultId(entry.id)}
            >
              <span>{entry.title}</span>
              <small>{entry.summary}</small>
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
