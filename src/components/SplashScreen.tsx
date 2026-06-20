import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowUpRight, Clock3, FileSearch, GitCompareArrows, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import type { HistoryEntry, Mode } from "@/lib/history";
import { motionDuration, motionEase, shouldAnimateUi } from "@/lib/motion";

gsap.registerPlugin(useGSAP);

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
      <span className="launch-history__pair">
        <span className="launch-history__path" title={entry.paths[0]}>{entry.paths[0]}</span>
        <span className="launch-history__arrow" aria-hidden="true">to</span>
        <span className="launch-history__path" title={entry.paths[1]}>{entry.paths[1]}</span>
      </span>
    );
  }
  return <span className="launch-history__path" title={entry.paths[0]}>{entry.paths[0]}</span>;
}

export function SplashScreen({
  history,
  now,
  onPickMode,
  onOpenEntry,
  onClear,
}: SplashScreenProps) {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!shouldAnimateUi("full", reduceMotion)) return;

    const timeline = gsap.timeline({ defaults: { ease: motionEase } });
    timeline
      .from(".launch__identity", { y: -10, opacity: 0, duration: motionDuration.base })
      .from(".launch__headline-word", {
        yPercent: 36,
        opacity: 0.08,
        stagger: 0.045,
        duration: motionDuration.slow,
      }, "-=0.18")
      .from(".launch__intro", { y: 12, opacity: 0, duration: motionDuration.base }, "-=0.35")
      .from(".launch-card", {
        scale: 0.8,
        opacity: 0,
        transformOrigin: "50% 55%",
        stagger: 0.08,
        duration: motionDuration.slow,
      }, "-=0.25");
  }, { scope: rootRef });

  return (
    <main className="launch" aria-label="Start LDiff" ref={rootRef}>
      <header className="launch__identity">
        <span className="launch__wordmark">LDiff</span>
        <span className="launch__descriptor">Archive diff and merge</span>
        <span className="launch__edition">Desktop workspace</span>
      </header>

      <section className="launch__hero" aria-labelledby="launch-title">
        <div className="launch__copy">
          <p className="launch__kicker">Precision for compiled archives</p>
          <h1 id="launch-title">
            {"See every change. Move only what belongs.".split(" ").map((word, index) => (
              <span className="launch__headline-word" key={`${word}-${index}`}>{word}&nbsp;</span>
            ))}
          </h1>
          <p className="launch__intro">
            Compare archives and folders, inspect source, stage exact changes, and save deliberately.
          </p>
        </div>

        <div className="launch__grid">
          <button
            type="button"
            className="launch-card launch-card--compare"
            onClick={() => onPickMode("compare")}
            aria-label="Compare two sources"
          >
            <span className="launch-card__icon"><GitCompareArrows aria-hidden="true" /></span>
            <span className="launch-card__content">
              <span className="launch-card__title">Compare / Merge</span>
              <span className="launch-card__description">
                Open two JARs, ZIPs, folders, or text files. Inspect differences and stage exact changes.
              </span>
            </span>
            <ArrowUpRight className="launch-card__arrow" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="launch-card launch-card--view"
            onClick={() => onPickMode("single")}
            aria-label="Open one source"
          >
            <span className="launch-card__icon"><FileSearch aria-hidden="true" /></span>
            <span className="launch-card__content">
              <span className="launch-card__title">Decompile</span>
              <span className="launch-card__description">Browse one source without merge controls.</span>
            </span>
            <ArrowUpRight className="launch-card__arrow" aria-hidden="true" />
          </button>

          <nav className="launch-card launch-card--recent" aria-label="Recent sessions">
            <div className="launch-recent__header">
              <span><Clock3 aria-hidden="true" /> Recent work</span>
              {history.length > 0 && (
                <Button variant="ghost" size="icon" onClick={onClear} aria-label="Clear recent sessions">
                  <Trash2 />
                </Button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="launch-recent__empty">No recent sessions yet. Start with a comparison.</p>
            ) : (
              <ul className="launch-history">
                {history.slice(0, 4).map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => onOpenEntry(entry)}>
                      <span className="launch-history__mode">
                        {entry.mode === "compare" ? "Compare" : "View"}
                      </span>
                      <EntryPaths entry={entry} />
                      <span className="launch-history__time">{timeAgo(entry.openedAt, now)}</span>
                    </button>
                  </li>
                ))}
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
