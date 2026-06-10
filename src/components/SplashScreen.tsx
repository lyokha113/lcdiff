import { FileSearch, GitCompareArrows } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import type { HistoryEntry, Mode } from "@/lib/history";

interface SplashScreenProps {
  history: HistoryEntry[];
  now: number;
  onPickMode: (mode: Mode) => void;
  onOpenEntry: (entry: HistoryEntry) => void;
  onClear: () => void;
}

function EntryPaths({ entry }: { entry: HistoryEntry }) {
  if (entry.mode === "compare") {
    return (
      <span className="splash-history-pair">
        <span className="splash-history-line" title={entry.paths[0]}>{entry.paths[0]}</span>
        <span className="splash-history-arrow" aria-hidden="true">↔</span>
        <span className="splash-history-line" title={entry.paths[1]}>{entry.paths[1]}</span>
      </span>
    );
  }
  return <span className="splash-history-line" title={entry.paths[0]}>{entry.paths[0]}</span>;
}

export function SplashScreen({
  history,
  now,
  onPickMode,
  onOpenEntry,
  onClear,
}: SplashScreenProps) {
  return (
    <div className="splash">
      <div className="splash-brand">
        <h1>LDIFF</h1>
        <span className="tagline">Inspect, compare &amp; merge JAR / ZIP / folders</span>
      </div>

      <div className="splash-modes">
        <button type="button" className="splash-mode" onClick={() => onPickMode("single")}>
          <FileSearch aria-hidden="true" />
          <span className="splash-mode-title">Decompile</span>
          <span className="splash-mode-desc">Open one archive, view read-only</span>
        </button>
        <button type="button" className="splash-mode" onClick={() => onPickMode("compare")}>
          <GitCompareArrows aria-hidden="true" />
          <span className="splash-mode-title">Compare / Merge</span>
          <span className="splash-mode-desc">Diff two sides, stage merges</span>
        </button>
      </div>

      <div className="splash-recent">
        <div className="splash-recent-head">
          <span className="zone-label">Recent sessions</span>
          {history.length > 0 && (
            <Button variant="outline" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="splash-empty">No recent sessions yet.</p>
        ) : (
          <ul className="splash-history">
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="splash-history-row"
                  onClick={() => onOpenEntry(entry)}
                >
                  <Badge variant={entry.mode === "compare" ? "default" : "secondary"}>
                    {entry.mode === "compare" ? "CMP" : "VIEW"}
                  </Badge>
                  <span className="splash-history-path"><EntryPaths entry={entry} /></span>
                  <span className="splash-history-time">{timeAgo(entry.openedAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
