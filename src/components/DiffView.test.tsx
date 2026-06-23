import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DiffView } from "@/components/DiffView";
import { DEFAULT_UI_PREFERENCES, type EffectiveColorPattern, type UiPreferences } from "@/lib/preferences";
import type { ComparePair, Mode } from "@/lib/types";

const editorMock = vi.hoisted(() => vi.fn(() => <div data-testid="editor" />));
const diffEditorMock = vi.hoisted(() => vi.fn(() => <div data-testid="diff-editor" />));

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: editorMock,
  DiffEditor: diffEditorMock,
}));

const classPair: ComparePair = {
  path: "A.class",
  status: "different",
  left: { path: "A.class", kind: "class" },
  right: { path: "A.class", kind: "class" },
};

function renderDiffView(
  mode: Mode,
  preferences: UiPreferences,
  effectiveColorPattern: EffectiveColorPattern = "dark",
  overrides: Partial<{
    editable: boolean;
    editValue: string;
    fileMerge: boolean;
    hunkMerge: boolean;
    ignoreTrimWhitespace: boolean;
  }> = {},
) {
  const props = {
    mode,
    selected: classPair,
    preview: {},
    preferences,
    effectiveColorPattern,
    ignoreTrimWhitespace: true,
    onCopy: vi.fn(),
    onEditorMount: vi.fn(),
    onDiffMount: vi.fn(),
    editable: false,
    editValue: "",
    onEditChange: vi.fn(),
    onEditBlur: vi.fn(),
    fileMerge: false,
    hunkMerge: false,
    onDiffEditEither: vi.fn(),
    onTakeAll: vi.fn(),
    onMoveHunk: vi.fn(),
    ...overrides,
  };

  render(
    <TooltipProvider>
      <DiffView {...props} />
    </TooltipProvider>,
  );

  return props;
}

beforeEach(() => {
  editorMock.mockClear();
  diffEditorMock.mockClear();
});

describe("DiffView", () => {
  it("passes editor preferences to the single editor Monaco instance", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "Menlo",
        fontSize: 16,
      },
    };

    renderDiffView("single", preferences, "light");

    expect(editorMock).toHaveBeenCalledTimes(1);
    expect(editorMock.mock.calls[0]?.[0]).toMatchObject({
      theme: "light",
      options: {
        fontFamily: "Menlo",
        fontSize: 16,
      },
    });
  });

  it("passes editor preferences to the diff Monaco instance", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "Cascadia Code",
        fontSize: 15,
      },
    };

    renderDiffView("compare", preferences, "dark");

    expect(diffEditorMock).toHaveBeenCalledTimes(1);
    expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
      theme: "vs-dark",
      options: {
        fontFamily: "Cascadia Code",
        fontSize: 15,
      },
    });
  });

  it("renders the diff editor in compare mode", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES);
    expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Diff view mode" })).not.toBeInTheDocument();
  });

  it("hides compare-only actions in View mode", () => {
    renderDiffView("single", DEFAULT_UI_PREFERENCES);
    expect(screen.queryByLabelText("Copy file to left")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy file to right")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy to left")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy to right")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into right pane" })).not.toBeInTheDocument();
  });

  it("orders actions by their target editor pane without visible target labels", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES, "light", { hunkMerge: true });
    const leftActions = screen.getByRole("group", { name: "Actions into left pane" });
    const rightActions = screen.getByRole("group", { name: "Actions into right pane" });

    expect(within(leftActions).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Copy file ←",
      "Take all ←",
      "Move hunk ←",
    ]);
    expect(within(rightActions).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Move hunk →",
      "Take all →",
      "Copy file →",
    ]);
    expect(screen.queryByText("Left Target")).not.toBeInTheDocument();
    expect(screen.queryByText("Right Target")).not.toBeInTheDocument();
  });

  it("dispatches every action in the direction shown by its arrow", () => {
    const props = renderDiffView("compare", DEFAULT_UI_PREFERENCES, "light", { hunkMerge: true });

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
