import { ArrowLeftRight, FileText, Folder, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

export function SourceChips({
  mode, archives, paths, pathErrors, onPathChange, onOpenPath, onBrowse, onBrowseFolder,
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="source-chip" aria-label={`Change ${side} source`}>
                      <Package />
                      <span className="source-chip-path">
                        {archive ? archive.path : `${side.toUpperCase()} — no source`}
                      </span>
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="source-chip-tip">{archive ? archive.path : `${side.toUpperCase()} — no source loaded`}</p>
                </TooltipContent>
              </Tooltip>
              <PopoverContent>
                <div className="repick">
                  <div className="repick-head">
                    <strong>{side.toUpperCase()}</strong>
                    {archive && <span className="repick-kind">{archive.metadata.sourceKind}</span>}
                  </div>
                  <Input
                    value={paths[side]}
                    placeholder="~/path/to/archive.jar or folder"
                    onChange={(e) => onPathChange(side, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onOpenPath(side, paths[side]); }}
                  />
                  <div className="repick-actions">
                    <Button variant="outline" onClick={() => onBrowse(side)}><FileText /> Browse file</Button>
                    <Button variant="outline" onClick={() => onBrowseFolder(side)}><Folder /> Browse folder</Button>
                  </div>
                  <small>{archive ? archive.path : "No source loaded"}</small>
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
