import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { Mode } from "@/lib/types";

const steps: Array<{ target: string; topic: string; title: string; body: string; modes?: Mode[] }> = [
  { target: "workspace-modes", topic: "Navigate", title: "Choose the right workspace", body: "View inspects one or many sources. Compare diffs and merges two sources. Text compares pasted or typed snippets." },
  { target: "source-open", topic: "Open", title: "Load files and folders", body: "Use Browse, paste a direct path, drag files into LCDiff, or open them from the OS. On Wayland, Browse and path input are the reliable choices.", modes: ["single", "compare"] },
  { target: "workspace-tabs", topic: "Filter", title: "Navigate files and open tabs", body: "Filter Compare results by difference status, expand nested archives, and return to Files without closing inspected entries.", modes: ["single", "compare"] },
  { target: "workspace-canvas", topic: "Inspect", title: "Read the useful representation", body: "Select an entry to open a tab. Class files support source and bytecode; text, metadata, and hex views appear when appropriate." },
  { target: "search", topic: "Find", title: "Search at the right scope", body: "Press Cmd/Ctrl+F. Search paths and text from Files, or find inside the active diff. Decompiled-source search is slower and cancellable.", modes: ["single", "compare"] },
  { target: "merge-save", topic: "Merge", title: "Stage before writing", body: "In Compare, copy entries or text hunks toward the intended side. Decompiled Java stays read-only; LCDiff stages original entry bytes.", modes: ["compare"] },
  { target: "merge-save", topic: "Save", title: "Review before commit", body: "Open Pending changes, unstage mistakes, then Save. Signed archives require confirmation; optional backups live in Preferences.", modes: ["compare"] },
  { target: "status", topic: "Verify", title: "Watch operation state", body: "The status bar reports loading, search, updater state, and the number of pending changes so unfinished work stays visible." },
  { target: "preferences", topic: "Configure", title: "Tune and revisit", body: "Preferences controls appearance, editor fonts, search, decompiler, save, and updates. Replay this tour there whenever needed." },
  { target: "workspace-tools", topic: "Shortcuts", title: "Keep common actions close", body: "Use Cmd/Ctrl+O to open, Cmd/Ctrl+S to save, Cmd/Ctrl+/ for the full shortcut list, and the rail for Search and Preferences." },
];

export const ONBOARDING_KEY = "lcdiff.onboarding.v1";
export const onboardingKeyForMode = (mode: Mode) => `${ONBOARDING_KEY}.${mode}`;

interface OnboardingTourProps {
  mode: Mode;
  step: number;
  onStep: (step: number) => void;
  onClose: () => void;
}

export function OnboardingTour({ mode, step, onStep, onClose }: OnboardingTourProps) {
  const nextButton = useRef<HTMLButtonElement>(null);
  const visibleSteps = steps.filter(({ modes }) => !modes || modes.includes(mode));
  const current = visibleSteps[step] ?? visibleSteps[0];
  const isLastStep = step === visibleSteps.length - 1;

  useEffect(() => {
    if (step >= visibleSteps.length) {
      onStep(0);
      return;
    }
    const element = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    element?.setAttribute("data-tour-active", "true");
    nextButton.current?.focus();
    return () => element?.removeAttribute("data-tour-active");
  }, [current.target, onStep, step, visibleSteps.length]);

  const finish = () => {
    localStorage.setItem(onboardingKeyForMode(mode), "seen");
    onClose();
  };
  return (
    <aside className="onboarding-tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body">
      <header><span>Quick tour · {current.topic}</span><small>{step + 1} / {visibleSteps.length}</small></header>
      <h2 id="tour-title">{current.title}</h2>
      <p id="tour-body">{current.body}</p>
      <footer>
        <Button type="button" variant="ghost" size="sm" onClick={finish}>Skip</Button>
        <span>
          {step > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => onStep(step - 1)}>Back</Button>}
          <Button ref={nextButton} type="button" size="sm" onClick={() => isLastStep ? finish() : onStep(step + 1)}>
            {isLastStep ? "Finish" : "Next"}
          </Button>
        </span>
      </footer>
    </aside>
  );
}
