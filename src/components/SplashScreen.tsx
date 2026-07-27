import { useState } from "react";
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

function modeLabel(mode: Mode) {
  if (mode === "compare") return "Compare";
  if (mode === "text") return "Text";
  return "View";
}

function reopenLabel(entry: HistoryEntry) {
  if (entry.mode === "compare") {
    const [left = "", right = ""] = entry.paths;
    return `Reopen Compare, Left ${left}, Right ${right}`;
  }
  return `Reopen ${modeLabel(entry.mode)} ${entry.paths.join(" and ")}`;
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

      <section className="launch__content" aria-labelledby="launch-title">
        <div className="launch__copy">
          <p className="launch__kicker">Local archive workspace</p>
          <h1 id="launch-title">
            {history.length > 0
              ? "Continue where you left off."
              : "Start a precise inspection."}
          </h1>
          <p className="launch__intro">
            Reopen recent work, or choose a focused task for JARs, ZIPs, folders, and text.
          </p>
        </div>

        <div className="launch__desk">
          <nav className="launch-recent" aria-label="Recent sessions">
            <div className="launch-recent__header">
              <div>
                <span className="launch-recent__eyebrow">Recent work</span>
                <strong>{history.length} {history.length === 1 ? "session" : "sessions"}</strong>
              </div>
              <div className="launch-recent__actions">
                {history.length > 5 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setHistoryExpanded((expanded) => !expanded)}
                  >
                    {historyExpanded ? "Show less history" : "View all history"}
                  </Button>
                )}
                {history.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={onClear}>
                    Clear history
                  </Button>
                )}
              </div>
            </div>

            {history.length === 0 ? (
              <div className="launch-recent__empty">
                <strong>No recent sessions yet.</strong>
                <span>History appears after you open a source.</span>
              </div>
            ) : (
              <ul className="launch-history">
                {visibleHistory.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-label={reopenLabel(entry)}
                      onClick={() => onOpenEntry(entry)}
                    >
                      <span
                        className="launch-history__mode"
                        data-mode={entry.mode}
                      >
                        {modeLabel(entry.mode)}
                      </span>
                      <span className="launch-history__sources">
                        {entry.paths.map((path, index) => (
                          <span
                            className="launch-history__source"
                            data-side={
                              entry.mode === "compare"
                                ? index === 0 ? "left" : "right"
                                : "single"
                            }
                            title={path}
                            key={`${entry.id}-${index}`}
                          >
                            <span className="launch-history__name">{basename(path)}</span>
                            <span className="launch-history__path">{path}</span>
                          </span>
                        ))}
                      </span>
                      <span className="launch-history__meta">
                        <time dateTime={new Date(entry.openedAt).toISOString()}>
                          {timeAgo(entry.openedAt, now)}
                        </time>
                        <span aria-hidden="true">Reopen</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <section className="launch-new-task" aria-label="Start a new task">
            <span className="launch-new-task__eyebrow">New task</span>
            {([
              ["compare", "Compare", "Open two sources"],
              ["single", "View", "Inspect one source"],
              ["text", "Text", "Compare two drafts"],
            ] as const).map(([mode, title, description]) => (
              <button
                type="button"
                className="launch-mode"
                onClick={() => onPickMode(mode)}
                aria-label={`Open ${title} mode`}
                key={mode}
              >
                <span className="launch-mode__index" aria-hidden="true">
                  {mode === "compare" ? "01" : mode === "single" ? "02" : "03"}
                </span>
                <span className="launch-mode__copy">
                  <strong className="launch-card__title">{title}</strong>
                  <span>{description}</span>
                </span>
                <span className="launch-mode__arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </section>
        </div>
      </section>

      <footer className="launch__footer">
        <span>Local-first. No archive bytes leave your machine.</span>
        <span>JAR · ZIP · folders · text</span>
      </footer>
    </main>
  );
}
