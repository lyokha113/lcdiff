import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DiffView } from "@/components/DiffView";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
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
    preferences: DEFAULT_UI_PREFERENCES,
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
    expect(screen.queryByRole("group", { name: "Diff view mode" })).not.toBeInTheDocument();
  });
  it("hides compare-only actions in View mode", () => {
    setup({ mode: "single", hunkMerge: true });
    expect(screen.queryByLabelText("Copy file to left")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy file to right")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy to left")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy to right")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into right pane" })).not.toBeInTheDocument();
  });

  it("orders actions by their target editor pane without visible target labels", () => {
    setup({ hunkMerge: true });
    const leftActions = screen.getByRole("group", { name: "Actions into left pane" });
    const rightActions = screen.getByRole("group", { name: "Actions into right pane" });

    expect(within(leftActions).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Copy file ←", "Take all ←", "Move hunk ←",
    ]);
    expect(within(rightActions).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Move hunk →", "Take all →", "Copy file →",
    ]);
    expect(screen.queryByText("Left Target")).not.toBeInTheDocument();
    expect(screen.queryByText("Right Target")).not.toBeInTheDocument();
  });

  it("dispatches every action in the direction shown by its arrow", () => {
    const props = setup({ hunkMerge: true });

    fireEvent.click(screen.getByRole("button", { name: "Copy file to left" }));
    fireEvent.click(screen.getByRole("button", { name: "Take all into left" }));
    fireEvent.click(screen.getByRole("button", { name: "Move hunk into left" }));
    fireEvent.click(screen.getByRole("button", { name: "Move hunk into right" }));
    fireEvent.click(screen.getByRole("button", { name: "Take all into right" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy file to right" }));

    expect(props.onCopy.mock.calls).toEqual([["right", "left"], ["left", "right"]]);
    expect(props.onTakeAll.mock.calls).toEqual([["left"], ["right"]]);
    expect(props.onMoveHunk.mock.calls).toEqual([["left"], ["right"]]);
  });
});
