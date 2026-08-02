import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TempMergeConflictAction, TempMergeConflictPreview, TempMergeDecision } from "@/ipc/types";

interface MergeConflictDialogProps {
  open: boolean;
  preview: TempMergeConflictPreview;
  onOpenChange: (open: boolean) => void;
  onSubmit: (decisions: TempMergeDecision[]) => void;
  busy?: boolean;
}

export function MergeConflictDialog({
  open,
  preview,
  onOpenChange,
  onSubmit,
  busy = false,
}: MergeConflictDialogProps) {
  const [decisions, setDecisions] = useState<Record<string, TempMergeConflictAction>>({});
  const conflicts = [...preview.conflicts].sort();
  const hasNewEntries = preview.newEntries.length > 0;

  useEffect(() => {
    setDecisions({});
  }, [open, preview]);

  const resolved = conflicts.every((path) => decisions[path] !== undefined);
  const disabled = busy || !resolved;

  function decide(path: string, action: TempMergeConflictAction) {
    if (busy) return;
    setDecisions((current) => ({ ...current, [path]: action }));
  }

  function decideAll(action: TempMergeConflictAction) {
    if (busy) return;
    setDecisions(Object.fromEntries(conflicts.map((path) => [path, action])));
  }

  function submit() {
    if (disabled) return;
    onSubmit(conflicts.map((entryPath) => ({ entryPath, action: decisions[entryPath] })));
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen || !busy) onOpenChange(nextOpen); }}>
      <DialogContent className={`temp-merge-dialog temp-merge-conflicts ${hasNewEntries ? "temp-merge-conflicts--with-new" : "temp-merge-conflicts--without-new"}`} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Resolve merge conflicts</DialogTitle>
          <DialogDescription>
            Choose whether each source entry overwrites the temporary target or is skipped.
          </DialogDescription>
        </DialogHeader>
        {hasNewEntries && (
          <section className="temp-merge-conflicts__new" aria-label="New entries">
            <strong>New entries will be added</strong>
            <ul>{preview.newEntries.map((path) => <li key={path}>{path}</li>)}</ul>
          </section>
        )}
        <div className="temp-merge-conflicts__bulk" role="group" aria-label="Conflict bulk actions">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => decideAll("overwrite")}>Overwrite all</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => decideAll("skip")}>Skip all</Button>
        </div>
        <div className="temp-merge-conflicts__list">
          {conflicts.map((path) => (
            <div className="temp-merge-conflicts__item" key={path} role="group" aria-label={`${path} conflict`}>
              <code>{path}</code>
              <div className="temp-merge-conflicts__choices">
                {(["overwrite", "skip"] as const).map((action) => (
                  <Button
                    key={action}
                    variant={decisions[path] === action ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={decisions[path] === action}
                    disabled={busy}
                    onClick={() => decide(path, action)}
                  >
                    {action === "overwrite" ? "Overwrite" : "Skip"}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={disabled} onClick={submit}>Stage merge decisions</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
