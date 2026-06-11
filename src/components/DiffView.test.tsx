import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DiffView } from "@/components/DiffView";
import type { ComparePair } from "@/lib/types";

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: () => <div data-testid="editor" />,
  DiffEditor: () => <div data-testid="diff-editor" />,
}));

const classPair: ComparePair = {
  path: "A.class", status: "different",
  left: { path: "A.class", kind: "class" }, right: { path: "A.class", kind: "class" },
};

function setup(overrides = {}) {
  const props = {
    mode: "compare" as const, selected: classPair, preview: {},
    ignoreTrimWhitespace: true,
    onCopy: vi.fn(),
    onEditorMount: vi.fn(), onDiffMount: vi.fn(),
    editable: false, editValue: "", onEditChange: vi.fn(), onEditBlur: vi.fn(),
    fileMerge: false, hunkMerge: false, onDiffEditEither: vi.fn(), onTakeAll: vi.fn(), onMoveHunk: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><DiffView {...props} /></TooltipProvider>);
  return props;
}

describe("DiffView", () => {
  it("renders the diff editor in compare mode", () => {
    setup();
    expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
  });
  it("disables copy buttons in single mode", () => {
    setup({ mode: "single" });
    expect(screen.getByLabelText("Copy to left")).toBeDisabled();
    expect(screen.getByLabelText("Copy to right")).toBeDisabled();
  });
});
