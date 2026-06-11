import type { PairStatus } from "@/lib/types";

export interface StatusPresentation {
  glyph: string;
  label: string;
  className: string;
}

const MAP: Record<PairStatus, StatusPresentation> = {
  different: { glyph: "M", label: "modified", className: "status-different" },
  differentMetadataOnly: { glyph: "M̃", label: "meta only", className: "status-meta" },
  onlyLeft: { glyph: "+", label: "left only", className: "status-onlyLeft" },
  onlyRight: { glyph: "−", label: "right only", className: "status-onlyRight" },
  identical: { glyph: "≡", label: "identical", className: "status-identical" },
};

export function statusPresentation(status: PairStatus): StatusPresentation {
  return MAP[status];
}
