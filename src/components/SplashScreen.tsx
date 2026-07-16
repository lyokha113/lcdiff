import { useState } from "react";
import { ArrowUpRight, Clock3, FileSearch, FileText, GitCompareArrows, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import type { HistoryEntry, Mode } from "@/lib/history";

interface SplashScreenProps {
  history: HistoryEntry[];
  now: number;
  onPickMode: (mode: Mode) => void;
  onOpenEntry: (entry: HistoryEntry) => void;
  onClear: () => void;
  motion: "standard" | "reduced";
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || path;
}

export function SplashScreen({
  history,
  now,
  onPickMode,
  onOpenEntry,
  onClear,
  motion,
}: SplashScreenProps) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const visibleHistory = historyExpanded ? history : history.slice(0, 5);

  return (
    <main className="launch" aria-label="Start LCDiff" data-motion={motion}>
      <header className="launch__identity">
        <span className="launch__wordmark">LCDiff</span>
        <span className="launch__descriptor">Archive diff and merge</span>
      </header>

      <section className="launch__hero" aria-labelledby="launch-title">
        <div className="launch__copy">
          <p className="launch__kicker">Precision for compiled archives</p>
          <h1 id="launch-title">
            {["See every change.", "Move only what", "belongs."].map((line) => (
              <span className="launch__headline-line" key={line}>
                {line.split(" ").map((word) => (
                  <span className="launch__headline-word" key={`${line}-${word}`}>{word}&nbsp;</span>
                ))}
              </span>
            ))}
          </h1>
          <p className="launch__intro">
            Compare archives and folders, inspect source, stage exact changes, and save deliberately.
          </p>
        </div>

        <div className="launch__actions">
          <div className="launch__grid">
            <button
              type="button"
              className="launch-card launch-card--text"
              onClick={() => onPickMode("text")}
              aria-label="Open Text mode"
            >
              <span className="launch-card__icon"><FileText aria-hidden="true" /></span>
              <span className="launch-card__content">
                <span className="launch-card__title">Text</span>
                <span className="launch-card__description">
                  Paste or type drafts, then confirm when you want a diff result.
                </span>
              </span>
              <ArrowUpRight className="launch-card__arrow" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="launch-card launch-card--view"
              onClick={() => onPickMode("single")}
              aria-label="Open View mode"
            >
              <span className="launch-card__icon"><FileSearch aria-hidden="true" /></span>
              <span className="launch-card__content">
                <span className="launch-card__title">View</span>
                <span className="launch-card__description">Open one JAR, ZIP, folder, or text file for source inspection.</span>
              </span>
              <ArrowUpRight className="launch-card__arrow" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="launch-card launch-card--compare"
              onClick={() => onPickMode("compare")}
              aria-label="Open Compare mode"
            >
              <span className="launch-card__icon"><GitCompareArrows aria-hidden="true" /></span>
              <span className="launch-card__content">
                <span className="launch-card__title">Compare</span>
                <span className="launch-card__description">
                  Open two sources, inspect differences, stage changes, and save deliberately.
                </span>
              </span>
              <ArrowUpRight className="launch-card__arrow" aria-hidden="true" />
            </button>
          </div>

          <nav className="launch-card launch-card--recent" aria-label="Recent sessions">
            <div className="launch-recent__header">
              <span><Clock3 aria-hidden="true" /> Recent work</span>
              <div className="launch-recent__actions">
                {history.length > 5 && (
                  <Button variant="ghost" size="sm" onClick={() => setHistoryExpanded((expanded) => !expanded)}>
                    {historyExpanded ? "Show less history" : "View all history"}
                  </Button>
                )}
                {history.length > 0 && (
                  <Button variant="ghost" size="icon" onClick={onClear} aria-label="Clear recent sessions">
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
            {history.length === 0 ? (
              <p className="launch-recent__empty">History appears after you open a source.</p>
            ) : (
              <ul className="launch-history">
                {visibleHistory.map((entry) => {
                  const pathLabel = entry.paths.join(" ↔ ");
                  return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-label={`Reopen ${entry.mode === "compare" ? "comparison" : "view"} ${entry.paths.join(" and ")}`}
                      onClick={() => onOpenEntry(entry)}
                    >
                      <span className="launch-history__mode">
                        {entry.mode === "compare" ? "Compare" : entry.mode === "text" ? "Text" : "View"}
                      </span>
                      <span className="launch-history__sources">
                        <span className="launch-history__name">{entry.paths.map(basename).join(" ↔ ")}</span>
                        <span className="launch-history__path" title={pathLabel}>{pathLabel}</span>
                      </span>
                      <span className="launch-history__time">{timeAgo(entry.openedAt, now)}</span>
                      <ArrowUpRight aria-hidden="true" />
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
          </nav>
        </div>
      </section>

      <footer className="launch__footer">
        <span>Local-first. No archive bytes leave your machine.</span>
        <span>JAR · ZIP · folders · text</span>
      </footer>
    </main>
  );
}
