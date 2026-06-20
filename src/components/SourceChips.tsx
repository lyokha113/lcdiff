import { ArrowLeftRight, FileText, Folder, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || path;
}

export function SourceChips({
  mode, archives, paths, pathErrors, onPathChange, onOpenPath, onBrowse, onBrowseFolder,
}: SourceChipsProps) {
  const renderSlot = (side: Side) => {
    const archive = archives[side];
    const sideLabel = side === "left" ? "Left" : "Right";

    return (
      <section className={`source-slot source-slot--${side}`} aria-label={`${sideLabel} source`} key={side}>
        <div className="source-slot__identity">
          <span className="source-slot__side">{sideLabel}</span>
          {archive && <span className="source-slot__kind">{archive.metadata.sourceKind}</span>}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="source-slot__trigger" aria-label={`Change ${side} source`}>
              <span className="source-slot__icon">{archive ? <Package /> : <Plus />}</span>
              <span className="source-slot__text">
                <span className="source-slot__name">{archive ? basename(archive.path) : "Choose a source"}</span>
                <span className="source-slot__path">{archive?.path ?? "JAR, ZIP, folder, or text file"}</span>
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="source-picker">
            <div className="repick">
              <div className="repick-head">
                <strong>{sideLabel} source</strong>
                {archive && <span className="repick-kind">{archive.metadata.sourceKind}</span>}
              </div>
              <Input
                value={paths[side]}
                placeholder="~/path/to/archive.jar or folder"
                aria-label={`${sideLabel} source path`}
                onChange={(event) => onPathChange(side, event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") onOpenPath(side, paths[side]); }}
              />
              <div className="repick-actions">
                <Button variant="outline" onClick={() => onBrowse(side)}><FileText /> Browse file</Button>
                <Button variant="outline" onClick={() => onBrowseFolder(side)}><Folder /> Browse folder</Button>
              </div>
              {pathErrors[side] && <small className="path-error" role="alert">{pathErrors[side]}</small>}
            </div>
          </PopoverContent>
        </Popover>
      </section>
    );
  };

  return (
    <div className="source-rail" data-mode={mode}>
      {renderSlot("left")}
      {mode === "compare" && (
        <span className="source-rail__bridge" aria-hidden="true"><ArrowLeftRight /></span>
      )}
      {mode === "compare" && renderSlot("right")}
    </div>
  );
}
