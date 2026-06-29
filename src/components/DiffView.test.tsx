import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DiffView } from "@/components/DiffView";
import { DEFAULT_UI_PREFERENCES, type EffectiveColorPattern, type UiPreferences } from "@/lib/preferences";
import type { ComparePair, Mode } from "@/lib/types";

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

// Task 6 must move diffNavigator into DiffViewProps; keep this helper tied to
// the current component props while documenting the future contract under test.
type FutureDiffViewTestProps = React.ComponentProps<typeof DiffView> & {
  diffNavigator: DiffNavigatorTestProps;
};

type RenderDiffViewOverrides = Partial<
  Pick<
    FutureDiffViewTestProps,
    | "editable"
    | "editValue"
    | "fileMerge"
    | "hunkMerge"
    | "ignoreTrimWhitespace"
    | "diffNavigator"
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
    diffNavigator: {
      current: 0,
      total: 0,
      canGoPrevious: false,
      canGoNext: false,
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    },
    ...overrides,
  } satisfies FutureDiffViewTestProps;

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
});
