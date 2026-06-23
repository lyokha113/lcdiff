import Editor, { DiffEditor, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EffectiveColorPattern, UiPreferences } from "@/lib/preferences";
import type { ComparePair, EntryPreview, Mode, Side } from "@/lib/types";

export function pairHasClass(pair?: ComparePair) {
  return pair?.left?.kind === "class" || pair?.right?.kind === "class";
}

interface DiffViewProps {
  mode: Mode;
  selected?: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  preferences: UiPreferences;
  effectiveColorPattern: EffectiveColorPattern;
  ignoreTrimWhitespace: boolean;
  onCopy: (from: Side, to: Side) => void;
  onEditorMount: OnMount;
  onDiffMount: DiffOnMount;
  editable: boolean;
  editValue: string;
  onEditChange: (value: string | undefined) => void;
  onEditBlur: (content: string) => void;
  fileMerge: boolean;
  hunkMerge: boolean;
  onDiffEditEither: (side: Side, content: string) => void;
  onTakeAll: (target: Side) => void;
  onMoveHunk: (target: Side) => void;
}

export function DiffView({
  mode, selected, preview, preferences, effectiveColorPattern, ignoreTrimWhitespace,
  onCopy, onEditorMount, onDiffMount,
  editable, editValue, onEditChange, onEditBlur,
  fileMerge, hunkMerge, onDiffEditEither, onTakeAll, onMoveHunk,
}: DiffViewProps) {
  const monacoTheme = effectiveColorPattern === "light" ? "light" : "vs-dark";
  const editorOptions = {
    fontFamily: preferences.editor.fontFamily,
    fontSize: preferences.editor.fontSize,
    minimap: { enabled: preferences.editor.minimap === "on" },
    wordWrap: preferences.editor.wordWrap,
    lineNumbers: preferences.editor.lineNumbers,
    automaticLayout: true,
  } as const;

  const renderCopyButton = (target: Side) => {
    const source: Side = target === "left" ? "right" : "left";
    const arrow = target === "left" ? "←" : "→";
    const sourceEntry = selected?.[source];
    const tooltip = fileMerge
      ? `Copy the entire ${source} file onto the ${target} (saved bytes on disk, ignores unsaved edits)`
      : `Copy ${source} entry to ${target}`;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Copy file to ${target}`}
              disabled={!sourceEntry || sourceEntry.kind === "directory"}
              onClick={() => onCopy(source, target)}
            >
              Copy file {arrow}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent><p>{tooltip}</p></TooltipContent>
      </Tooltip>
    );
  };

  const renderTakeAllButton = (target: Side) => {
    const source = target === "left" ? "right" : "left";
    const arrow = target === "left" ? "←" : "→";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" aria-label={`Take all into ${target}`} onClick={() => onTakeAll(target)}>
            Take all {arrow}
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>Replace the {target} pane with the {source} pane's current content (includes unsaved edits)</p></TooltipContent>
      </Tooltip>
    );
  };

  const renderMoveHunkButton = (target: Side) => {
    const source = target === "left" ? "right" : "left";
    const arrow = target === "left" ? "←" : "→";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" aria-label={`Move hunk into ${target}`} onClick={() => onMoveHunk(target)}>
            Move hunk {arrow}
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>Move the change at the cursor into the {target} pane and remove it from the {source}</p></TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="editor-panel">
      {mode === "compare" && (
        <div className="merge-actions">
          <div className="pane-actions pane-actions-left" role="group" aria-label="Actions into left pane">
            {renderCopyButton("left")}
            {hunkMerge && renderTakeAllButton("left")}
            {hunkMerge && renderMoveHunkButton("left")}
          </div>
          <div className="pane-actions pane-actions-right" role="group" aria-label="Actions into right pane">
            {hunkMerge && renderMoveHunkButton("right")}
            {hunkMerge && renderTakeAllButton("right")}
            {renderCopyButton("right")}
          </div>
        </div>
      )}
      <div className="editors">
        {(preview.left?.details || preview.right?.details) && (
          <p className="preview-details">
            {preview.left?.details && `LEFT: ${preview.left.details}`}
            {preview.left?.details && preview.right?.details && " · "}
            {preview.right?.details && `RIGHT: ${preview.right.details}`}
          </p>
        )}
        {mode === "compare" ? (
          <DiffEditor
            height="100%"
            language={preview.left?.language ?? preview.right?.language ?? "plaintext"}
            original={preview.left?.content ?? ""}
            modified={preview.right?.content ?? ""}
            theme={monacoTheme}
            options={{
              ...editorOptions,
              readOnly: !hunkMerge,
              originalEditable: hunkMerge,
              renderMarginRevertIcon: hunkMerge,
              renderSideBySide: true,
              useInlineViewWhenSpaceIsLimited: false,
              ignoreTrimWhitespace,
            }}
            onMount={(editor, monaco) => {
              onDiffMount(editor, monaco);
              if (hunkMerge) {
                const orig = editor.getOriginalEditor();
                const mod = editor.getModifiedEditor();
                const d1 = orig.onDidBlurEditorText(() => onDiffEditEither("left", orig.getValue()));
                const d2 = mod.onDidBlurEditorText(() => onDiffEditEither("right", mod.getValue()));
                editor.onDidDispose(() => { d1.dispose(); d2.dispose(); });
              }
            }}
          />
        ) : (
          <Editor
            height="100%"
            language={preview.left?.language ?? "plaintext"}
            value={editable ? editValue : (preview.left?.content ?? "")}
            theme={monacoTheme}
            options={{ ...editorOptions, readOnly: !editable }}
            onChange={(value) => editable && onEditChange(value)}
            onMount={(editor, monaco) => {
              onEditorMount(editor, monaco);
              editor.onDidBlurEditorText(() => editable && onEditBlur(editor.getValue()));
            }}
          />
        )}
      </div>
    </div>
  );
}
