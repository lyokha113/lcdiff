import Editor, { DiffEditor, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ComparePair, EntryPreview, Mode, Side } from "@/lib/types";

export function pairHasClass(pair?: ComparePair) {
  return pair?.left?.kind === "class" || pair?.right?.kind === "class";
}

interface DiffViewProps {
  mode: Mode;
  selected?: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
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
  mode, selected, preview, ignoreTrimWhitespace,
  onCopy, onEditorMount, onDiffMount,
  editable, editValue, onEditChange, onEditBlur,
  fileMerge, hunkMerge, onDiffEditEither, onTakeAll, onMoveHunk,
}: DiffViewProps) {
  return (
    <div className="editor-panel">
      <div className="copy-actions">
        {/* Far left: copy the whole entry/file onto the LEFT pane. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="icon" aria-label="Copy to left"
                disabled={mode === "single" || !selected?.right || selected.right.kind === "directory"}
                onClick={() => onCopy("right", "left")}>
                <ArrowLeft />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent><p>{fileMerge ? "Copy the entire right file onto the left (saved bytes on disk, ignores unsaved edits)" : "Copy right entry to left"}</p></TooltipContent>
        </Tooltip>

        {/* Center: per-hunk merge. Left-target group, divider, right-target group. */}
        {hunkMerge && (
          <div className="hunk-cluster" role="group" aria-label="Merge hunks">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Take all into left" onClick={() => onTakeAll("left")}>← Take all</Button>
              </TooltipTrigger>
              <TooltipContent><p>Replace the left pane with the right pane's current content (includes unsaved edits)</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Move hunk into left" onClick={() => onMoveHunk("left")}>← Move hunk</Button>
              </TooltipTrigger>
              <TooltipContent><p>Move the change at the cursor into the left pane and remove it from the right</p></TooltipContent>
            </Tooltip>
            <span className="hunk-divider" aria-hidden="true" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Move hunk into right" onClick={() => onMoveHunk("right")}>Move hunk →</Button>
              </TooltipTrigger>
              <TooltipContent><p>Move the change at the cursor into the right pane and remove it from the left</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Take all into right" onClick={() => onTakeAll("right")}>Take all →</Button>
              </TooltipTrigger>
              <TooltipContent><p>Replace the right pane with the left pane's current content (includes unsaved edits)</p></TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Far right: copy the whole entry/file onto the RIGHT pane. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="icon" aria-label="Copy to right"
                disabled={mode === "single" || !selected?.left || selected.left.kind === "directory"}
                onClick={() => onCopy("left", "right")}>
                <ArrowRight />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent><p>{fileMerge ? "Copy the entire left file onto the right (saved bytes on disk, ignores unsaved edits)" : "Copy left entry to right"}</p></TooltipContent>
        </Tooltip>
      </div>
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
            theme="vs-dark"
            options={{
              readOnly: !hunkMerge,
              originalEditable: hunkMerge,
              renderMarginRevertIcon: hunkMerge,
              minimap: { enabled: false },
              renderSideBySide: true,
              useInlineViewWhenSpaceIsLimited: false,
              automaticLayout: true,
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
            theme="vs-dark"
            options={{ readOnly: !editable, minimap: { enabled: false }, automaticLayout: true }}
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
