import { ArrowLeftRight, FileText, Folder, Package } from "lucide-react";
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
  onSave: (side: Side) => void;
}

function basename(path: string) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function SourceChips({
  mode, archives, paths, pathErrors, onPathChange, onOpenPath, onBrowse, onBrowseFolder, onSave,
}: SourceChipsProps) {
  const sides: Side[] = mode === "compare" ? ["left", "right"] : ["left"];
  return (
    <div className="source-chips">
      {sides.map((side, index) => {
        const archive = archives[side];
        return (
          <span className="chip-wrap" key={side}>
            {index === 1 && <ArrowLeftRight className="chip-sep" aria-hidden="true" />}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="source-chip" aria-label={`Change ${side} source`}>
                  <Package /> {archive ? basename(archive.path) : `${side.toUpperCase()} — no source`}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="repick">
                  <strong>{side.toUpperCase()}</strong>
                  <Input
                    value={paths[side]}
                    placeholder="~/path/to/archive.jar or folder"
                    onChange={(e) => onPathChange(side, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onOpenPath(side, paths[side]); }}
                  />
                  <div className="repick-actions">
                    <Button variant="outline" onClick={() => onBrowse(side)}><FileText /> Browse file</Button>
                    <Button variant="outline" onClick={() => onBrowseFolder(side)}><Folder /> Browse folder</Button>
                    <Button variant="secondary" aria-label="Save staged"
                      disabled={mode === "single"} onClick={() => onSave(side)}>Save staged</Button>
                  </div>
                  <small>{archive ? `${archive.metadata.sourceKind}: ${archive.path}` : "No source loaded"}</small>
                  {pathErrors[side] && <small className="path-error">{pathErrors[side]}</small>}
                </div>
              </PopoverContent>
            </Popover>
          </span>
        );
      })}
    </div>
  );
}
