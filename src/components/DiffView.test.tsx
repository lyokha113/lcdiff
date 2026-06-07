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
    viewMode: "source" as const, ignoreTrimWhitespace: true,
    onCopy: vi.fn(), onShowSource: vi.fn(), onShowBytecode: vi.fn(),
    onEditorMount: vi.fn(), onDiffMount: vi.fn(),
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
  it("marks Bytecode toggle disabled when selection has no class entry", () => {
    setup({ selected: { path: "x.txt", status: "different", left: { path: "x.txt", kind: "text" } } });
    expect(screen.getByLabelText("Show bytecode")).toBeDisabled();
  });
});
