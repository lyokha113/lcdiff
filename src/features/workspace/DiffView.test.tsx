import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DiffView } from "./DiffView";
import { DEFAULT_UI_PREFERENCES, type EffectiveColorPattern, type UiPreferences } from "@/features/preferences/preferences";
import type { ComparePair, ContentFilter, Mode } from "@/lib/types";

const editorMock = vi.hoisted(() => vi.fn((_props: unknown) => <div data-testid="editor" />));
const diffEditorMock = vi.hoisted(() => vi.fn((_props: unknown) => <div data-testid="diff-editor" />));

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

type DiffNavigatorTestProps = {
  current: number;
  total: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

type RenderDiffViewOverrides = Partial<
  Pick<
    React.ComponentProps<typeof DiffView>,
    | "contentFilter"
    | "diffEditableSides"
    | "editable"
    | "editValue"
    | "fileMerge"
    | "hunkMerge"
    | "ignoreTrimWhitespace"
    | "diffNavigator"
    | "onContentFilterChange"
    | "onDiffEditEither"
    | "preview"
    | "tempSession"
    | "tempBusy"
    | "onCopyToTemp"
    | "onMergeAllToTemp"
  >
>;

function renderDiffView(
  mode: Mode,
  preferences: UiPreferences,
  effectiveColorPattern: EffectiveColorPattern = "dark",
  overrides: RenderDiffViewOverrides = {},
) {
  const props = {
    mode,
    selected: classPair,
    preview: {},
    preferences,
    effectiveColorPattern,
    ignoreTrimWhitespace: true,
    contentFilter: "all" as ContentFilter,
    onContentFilterChange: vi.fn(),
    onCopy: vi.fn(),
    onEditorMount: vi.fn(),
    onDiffMount: vi.fn(),
    editable: false,
    editValue: "",
    onEditChange: vi.fn(),
    onEditBlur: vi.fn(),
    fileMerge: false,
    diffEditableSides: { left: false, right: false },
    hunkMerge: false,
    onDiffEditEither: vi.fn(),
    onTakeAll: vi.fn(),
    onMoveHunk: vi.fn(),
    tempSession: undefined,
    tempBusy: false,
    onCopyToTemp: vi.fn(),
    onMergeAllToTemp: vi.fn(),
    diffNavigator: {
      current: 0,
      total: 0,
      canGoPrevious: false,
      canGoNext: false,
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    },
    ...overrides,
  } satisfies React.ComponentProps<typeof DiffView>;

  render(
    <TooltipProvider>
      <DiffView {...props} />
    </TooltipProvider>,
  );

  return props;
}

function diffOptions() {
  return (
    diffEditorMock.mock.calls.at(-1)?.[0] as
      | { options?: Record<string, unknown> }
      | undefined
  )?.options;
}

beforeEach(() => {
  editorMock.mockClear();
  diffEditorMock.mockClear();
});

describe("DiffView", () => {
  it("renders a controlled content line filter in Compare mode", async () => {
    const user = userEvent.setup();
    const props = renderDiffView("compare", DEFAULT_UI_PREFERENCES);

    const filter = screen.getByRole("group", { name: "Content line filter" });
    expect(within(filter).getByRole("button", { name: "Show all content lines" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(filter).getByRole("button", { name: "Show differences only" }))
      .toHaveAttribute("aria-pressed", "false");

    await user.click(within(filter).getByRole("button", { name: "Show differences only" }));
    expect(props.onContentFilterChange).toHaveBeenCalledWith("diff");
  });

  it("maps Differences to Monaco hidden unchanged regions with three context lines", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
      contentFilter: "diff",
    });

    expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
      options: {
        hideUnchangedRegions: {
          enabled: true,
          contextLineCount: 3,
        },
      },
    });
  });

  it("keeps unchanged regions visible for All", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES);

    expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
      options: {
        hideUnchangedRegions: {
          enabled: false,
        },
      },
    });
  });

  it("hides the content line filter and unchanged-region filtering outside Compare", () => {
    renderDiffView("text", DEFAULT_UI_PREFERENCES, "dark", {
      contentFilter: "diff",
    });

    expect(screen.queryByRole("group", { name: "Content line filter" }))
      .not.toBeInTheDocument();
    expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
      options: {
        hideUnchangedRegions: {
          enabled: false,
        },
      },
    });
  });

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
        fontFamily: "\"LCDiff Editor Font Menlo\", \"Menlo\", ui-monospace, monospace",
        fontSize: 16,
        fontLigatures: true,
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
        fontFamily: "\"LCDiff Editor Font Cascadia Code\", \"Cascadia Code\", ui-monospace, monospace",
        fontSize: 15,
        fontLigatures: true,
      },
    });
  });

  it("quotes installed font family names before passing them to Monaco", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "Fira Code",
      },
    };

    renderDiffView("single", preferences, "dark");

    expect(editorMock.mock.calls[0]?.[0]).toMatchObject({
      options: {
        fontFamily: "\"LCDiff Editor Font Fira Code\", \"Fira Code\", ui-monospace, monospace",
        fontLigatures: true,
      },
    });
  });

  it("passes explicit Monaco minimap options when enabled", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        minimap: "on",
      },
    };

    renderDiffView("compare", preferences);

    expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
      options: {
        minimap: {
          enabled: true,
          side: "right",
          size: "proportional",
          showSlider: "mouseover",
        },
      },
    });
  });

  it("renders the diff editor in compare mode", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES);
    expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Diff view mode" })).not.toBeInTheDocument();
  });

  it("keeps a missing right pane read-only while allowing the existing left text to be edited", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
      preview: {
        left: {
          path: "left-only.json",
          kind: "text",
          language: "json",
          content: "{\"left\":true}",
        },
      },
      diffEditableSides: { left: true, right: false },
    });

    expect(diffOptions()).toMatchObject({
      originalEditable: true,
      readOnly: true,
      renderMarginRevertIcon: false,
    });
  });

  it("keeps a missing left pane read-only while allowing the existing right text to be edited", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
      preview: {
        right: {
          path: "right-only.json",
          kind: "text",
          language: "json",
          content: "{\"right\":true}",
        },
      },
      diffEditableSides: { left: false, right: true },
    });

    expect(diffOptions()).toMatchObject({
      originalEditable: false,
      readOnly: false,
      renderMarginRevertIcon: false,
    });
  });

  it("forwards model edits only from the independently editable diff side", () => {
    const onDiffEditEither = vi.fn();
    renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
      diffEditableSides: { left: true, right: false },
      onDiffEditEither,
    });

    let onLeftChange: ((event: { isFlush: boolean }) => void) | undefined;
    let onRightChange: ((event: { isFlush: boolean }) => void) | undefined;
    const originalEditor = {
      getValue: () => "changed left",
      onDidChangeModelContent: vi.fn((handler) => {
        onLeftChange = handler;
        return { dispose: vi.fn() };
      }),
    };
    const modifiedEditor = {
      getValue: () => "changed right",
      onDidChangeModelContent: vi.fn((handler) => {
        onRightChange = handler;
        return { dispose: vi.fn() };
      }),
    };
    const onMount = (
      diffEditorMock.mock.calls.at(-1)?.[0] as
        | { onMount?: (editor: unknown, monaco: unknown) => void }
        | undefined
    )?.onMount;

    onMount?.({
      getOriginalEditor: () => originalEditor,
      getModifiedEditor: () => modifiedEditor,
      onDidDispose: vi.fn(),
    }, {});
    onLeftChange?.({ isFlush: false });
    onRightChange?.({ isFlush: false });

    expect(onDiffEditEither).toHaveBeenCalledTimes(1);
    expect(onDiffEditEither).toHaveBeenCalledWith("left", "changed left");
  });

  it("renders the compact diff navigator in compare mode", async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();

    renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
      diffNavigator: {
        current: 3,
        total: 12,
        canGoPrevious: true,
        canGoNext: true,
        onPrevious,
        onNext,
      },
    });

    const navigator = screen.getByRole("group", { name: "Diff block navigation" });
    expect(within(navigator).getByText("3/12")).toBeInTheDocument();

    await user.click(within(navigator).getByRole("button", { name: "Previous diff block" }));
    await user.click(within(navigator).getByRole("button", { name: "Next diff block" }));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables the diff navigator when no diff blocks exist", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES);

    const navigator = screen.getByRole("group", { name: "Diff block navigation" });
    expect(within(navigator).getByText("0/0")).toBeInTheDocument();
    expect(within(navigator).getByRole("button", { name: "Previous diff block" })).toBeDisabled();
    expect(within(navigator).getByRole("button", { name: "Next diff block" })).toBeDisabled();
  });

  it("hides the diff navigator in single mode", () => {
    // This asserts the final Task 6 behavior once DiffView consumes diffNavigator.
    renderDiffView("single", DEFAULT_UI_PREFERENCES, "dark", {
      diffNavigator: {
        current: 3,
        total: 12,
        canGoPrevious: true,
        canGoNext: true,
        onPrevious: vi.fn(),
        onNext: vi.fn(),
      },
    });

    expect(screen.queryByRole("group", { name: "Diff block navigation" })).not.toBeInTheDocument();
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

  it("offers copy-selected and merge-all actions toward an active temp target", async () => {
    const user = userEvent.setup();
    const props = renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
      tempSession: {
        id: "temp-1", targetSide: "right", workingName: "working.jar", entryCount: 1,
        appliedSourceCount: 0, exportedPath: null,
      },
    });

    await user.click(screen.getByRole("button", { name: "Copy selected -> temp" }));
    await user.click(screen.getByRole("button", { name: "Merge all -> temp" }));

    expect(props.onCopyToTemp).toHaveBeenCalledWith("left");
    expect(props.onMergeAllToTemp).toHaveBeenCalledWith("left");
  });

  it("disables temporary merge controls while the controller is busy", () => {
    renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
      tempBusy: true,
      tempSession: {
        id: "temp-1", targetSide: "left", workingName: "working.jar", entryCount: 1,
        appliedSourceCount: 0, exportedPath: null,
      },
    });

    expect(screen.getByRole("button", { name: "Copy selected -> temp" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge all -> temp" })).toBeDisabled();
  });
});
