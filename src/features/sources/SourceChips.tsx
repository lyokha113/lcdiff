import { ArrowLeftRight, FileText, Folder, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TempMergeSessionSummary } from "@/ipc/types";
import type { ArchiveSummary, Mode, Side } from "@/lib/types";

interface SourceChipsProps {
  mode: Mode;
  archives: Partial<Record<Side, ArchiveSummary>>;
  paths: Record<Side, string>;
  pathErrors: Partial<Record<Side, string>>;
  onPathChange: (side: Side, value: string) => void;
  onOpenPath: (side: Side, path: string) => void;
  onBrowse: (side: Side) => void;
  onBrowseFolder: (side: Side) => void;
  tempSession?: TempMergeSessionSummary;
  tempBusy?: boolean;
  onCreateTempTarget?: (sourceSide: Side) => void;
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || path;
}

function pickerLabel(mode: Mode, side: Side) {
  if (mode === "single") return "File/Folder";
  return side === "left" ? "Left File/Folder" : "Right File/Folder";
}

export function SourceChips({
  mode, archives, paths, pathErrors, onPathChange, onOpenPath, onBrowse, onBrowseFolder,
  tempSession, tempBusy = false, onCreateTempTarget,
}: SourceChipsProps) {
  const hasExactlyOneSource = Boolean(archives.left) !== Boolean(archives.right);
  const loadedSourceSide: Side | undefined = archives.left ? "left" : archives.right ? "right" : undefined;

  const renderSlot = (side: Side) => {
    const archive = archives[side];
    const slotLabel = pickerLabel(mode, side);
    const isTempTarget = tempSession?.targetSide === side;
    const isReplaceableSource = tempSession !== undefined && !isTempTarget;
    const canCreateTempTarget =
      mode === "compare" &&
      hasExactlyOneSource &&
      !archive &&
      !tempSession &&
      !tempBusy &&
      loadedSourceSide !== undefined &&
      archives[loadedSourceSide]?.metadata.sourceKind === "archive" &&
      onCreateTempTarget !== undefined;

    return (
      <section className={`source-slot source-slot--${side}`} aria-label={slotLabel} key={side}>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="source-slot__trigger" aria-label={`Change ${side} source`}>
              <span className="source-slot__icon">{archive?.metadata.sourceKind === "text" ? <FileText /> : archive ? <Package /> : <Plus />}</span>
              <span className="source-slot__text">
                <span className="source-slot__name">{archive ? basename(archive.path) : "Choose a source"}</span>
                <span className="source-slot__path">{archive?.metadata.sourceKind === "text" ? "Paste or type directly in the diff editor" : archive?.path ?? "JAR, ZIP, folder, or text file"}</span>
                {isReplaceableSource && <span className="source-slot__role">SOURCE - REPLACEABLE</span>}
                {isTempTarget && (
                  <span className="source-slot__role">
                    TEMP TARGET - SESSION ONLY
                    <span className="source-slot__summary">
                      {tempSession.workingName} · {tempSession.entryCount} entries · {tempSession.appliedSourceCount} sources applied
                    </span>
                  </span>
                )}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="source-picker">
            <div className="repick">
              <div className="repick-head">
                <strong>{slotLabel}</strong>
                {archive && <span className="repick-kind">{archive.metadata.sourceKind}</span>}
              </div>
              <Input
                value={paths[side]}
                placeholder="~/path/to/archive.jar or folder"
                aria-label={`${slotLabel} path`}
                disabled={isTempTarget}
                onChange={(event) => onPathChange(side, event.target.value)}
                onKeyDown={(event) => { if (!isTempTarget && event.key === "Enter") onOpenPath(side, paths[side]); }}
              />
              <div className="repick-actions">
                <Button variant="outline" disabled={isTempTarget} onClick={() => onBrowse(side)}><FileText /> Browse file</Button>
                <Button variant="outline" disabled={isTempTarget} onClick={() => onBrowseFolder(side)}><Folder /> Browse folder</Button>
              </div>
              {canCreateTempTarget && (
                <Button variant="outline" onClick={() => onCreateTempTarget(loadedSourceSide)}>
                  Create temp target...
                </Button>
              )}
              {pathErrors[side] && <small className="path-error" role="alert">{pathErrors[side]}</small>}
            </div>
          </PopoverContent>
        </Popover>
      </section>
    );
  };

  return (
    <div className="source-rail" data-mode={mode} data-tour="source-open">
      {renderSlot("left")}
      {mode === "compare" && (
        <span className="source-rail__bridge" aria-hidden="true"><ArrowLeftRight /></span>
      )}
      {mode === "compare" && renderSlot("right")}
    </div>
  );
}
