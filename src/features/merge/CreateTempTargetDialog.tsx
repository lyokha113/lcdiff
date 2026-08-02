import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TempTargetCreation } from "@/ipc/types";

interface CreateTempTargetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (creation: TempTargetCreation) => void;
  busy?: boolean;
}

type CreationKind = TempTargetCreation["kind"] | "";

export function CreateTempTargetDialog({
  open,
  onOpenChange,
  onSubmit,
  busy = false,
}: CreateTempTargetDialogProps) {
  const [kind, setKind] = useState<CreationKind>("");
  const [extension, setExtension] = useState("");
  const canSubmit = !busy && kind !== "" && (kind !== "empty" || extension !== "");

  function submit() {
    if (!canSubmit) return;
    onSubmit(kind === "empty" ? { kind, extension } : { kind: "copyCurrent" });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen || !busy) onOpenChange(nextOpen); }}>
      <DialogContent className="temp-merge-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Create temporary merge target</DialogTitle>
          <DialogDescription>
            The temporary target stays in this session only. Your source archive is never modified.
          </DialogDescription>
        </DialogHeader>
        <div className="temp-merge-dialog__fields">
          <label className="temp-merge-dialog__field">
            <span>Target type</span>
            <Select value={kind} onValueChange={(value) => setKind(value as CreationKind)} disabled={busy}>
              <SelectTrigger aria-label="Temporary target type" className="w-full">
                <SelectValue placeholder="Choose a target type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="empty">Empty archive</SelectItem>
                <SelectItem value="copyCurrent">Copy current source</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {kind === "empty" && (
            <label className="temp-merge-dialog__field">
              <span>Archive extension</span>
              <Select value={extension} onValueChange={setExtension} disabled={busy}>
                <SelectTrigger aria-label="Archive extension" className="w-full">
                  <SelectValue placeholder="Choose an extension" />
                </SelectTrigger>
                <SelectContent>
                  {(["jar", "zip", "war", "ear"] as const).map((value) => (
                    <SelectItem key={value} value={value}>.{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={submit}>Create temp target</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
