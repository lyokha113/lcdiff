import Editor, { DiffEditor, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import { ArrowLeft, ArrowRight, Binary, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ComparePair, EntryPreview, Mode, Side, ViewMode } from "@/lib/types";

export function pairHasClass(pair?: ComparePair) {
  return pair?.left?.kind === "class" || pair?.right?.kind === "class";
}

interface DiffViewProps {
  mode: Mode;
  selected?: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  viewMode: ViewMode;
  ignoreTrimWhitespace: boolean;
  onCopy: (from: Side, to: Side) => void;
  onShowSource: () => void;
  onShowBytecode: () => void;
  onEditorMount: OnMount;
  onDiffMount: DiffOnMount;
  editable: boolean;
  editValue: string;
  onEditChange: (value: string | undefined) => void;
  onEditBlur: (content: string) => void;
}

export function DiffView({
  mode, selected, preview, viewMode, ignoreTrimWhitespace,
  onCopy, onShowSource, onShowBytecode, onEditorMount, onDiffMount,
  editable, editValue, onEditChange, onEditBlur,
}: DiffViewProps) {
  return (
    <div className="editor-panel">
      <div className="copy-actions">
        <div className="copy-cluster">
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
            <TooltipContent><p>Copy right entry to left</p></TooltipContent>
          </Tooltip>
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
            <TooltipContent><p>Copy left entry to right</p></TooltipContent>
          </Tooltip>
        </div>
        <div className="view-toggle" role="group" aria-label="Diff view mode">
          <Button variant={viewMode === "source" ? "secondary" : "ghost"} size="sm"
            aria-label="Show source" aria-pressed={viewMode === "source"}
            disabled={!selected} onClick={onShowSource}>
            <Code /> Source
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant={viewMode === "bytecode" ? "secondary" : "ghost"} size="sm"
                  aria-label="Show bytecode" aria-pressed={viewMode === "bytecode"}
                  disabled={!pairHasClass(selected)} onClick={onShowBytecode}>
                  <Binary /> Bytecode
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Open ASM bytecode for class entries; useful for metadata-only differences.</p></TooltipContent>
          </Tooltip>
        </div>
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
            options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true, automaticLayout: true, ignoreTrimWhitespace }}
            onMount={onDiffMount}
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
