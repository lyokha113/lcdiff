import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { FREE_TEXT_HISTORY_STORAGE_KEY } from "@/lib/free-text-history";
import { FreeTextWorkspace } from "./FreeTextWorkspace";

const monacoMockState = vi.hoisted(() => ({
  diffOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, onChange, options }: {
    value?: string;
    onChange?: (value: string | undefined) => void;
    options?: { ariaLabel?: string };
  }) => (
    <textarea
      aria-label={options?.ariaLabel}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  DiffEditor: ({ original, modified, options }: {
    original?: string;
    modified?: string;
    options?: Record<string, unknown>;
  }) => {
    monacoMockState.diffOptions = options;
    return (
      <div data-testid="diff-editor">
        <pre data-testid="diff-original">{original}</pre>
        <pre data-testid="diff-modified">{modified}</pre>
      </div>
    );
  },
}));

function renderWorkspace(overrides: Partial<ComponentProps<typeof FreeTextWorkspace>> = {}) {
  return render(
    <FreeTextWorkspace
      preferences={DEFAULT_UI_PREFERENCES}
      effectiveColorPattern="dark"
      ignoreTrimWhitespace={false}
      onMessage={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  monacoMockState.diffOptions = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Free text workspace", () => {
  it("does not render a diff result until user confirms", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByLabelText("Left free text input"), "left draft");
    await user.type(screen.getByLabelText("Right free text input"), "right draft");

    expect(screen.queryByTestId("diff-original")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Compare free text" }));

    expect(screen.getByTestId("diff-original")).toHaveTextContent("left draft");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("right draft");
  });

  it("keeps confirmed Free text result stable while draft changes", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByLabelText("Left free text input"), "first");
    await user.type(screen.getByLabelText("Right free text input"), "second");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));
    await user.clear(screen.getByLabelText("Left free text input"));
    await user.type(screen.getByLabelText("Left free text input"), "changed");

    expect(screen.getByTestId("diff-original")).toHaveTextContent("first");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("second");
  });

  it("persists confirmed Free text results across remount and clears history", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWorkspace();

    await user.type(screen.getByLabelText("Left free text input"), "left");
    await user.type(screen.getByLabelText("Right free text input"), "right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));

    expect(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY)).toContain("left");

    unmount();
    renderWorkspace();

    expect(screen.getByRole("button", { name: /characters/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear free text history" }));

    expect(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: /characters/ })).not.toBeInTheDocument();
    expect(screen.getByText("Confirm a comparison to create a temporary diff result.")).toBeInTheDocument();
  });

  it("keeps Free text clear UI-successful when persistence removal fails", async () => {
    const user = userEvent.setup();
    const removeItemSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    renderWorkspace();

    await user.type(screen.getByLabelText("Left free text input"), "left");
    await user.type(screen.getByLabelText("Right free text input"), "right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));
    await user.click(screen.getByRole("button", { name: "Clear free text history" }));

    expect(screen.queryByRole("button", { name: /characters/ })).not.toBeInTheDocument();
    expect(screen.getByText("Confirm a comparison to create a temporary diff result.")).toBeInTheDocument();

    removeItemSpy.mockRestore();
  });

  it("selects an older Free text history entry and shows its confirmed snapshot", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByLabelText("Left free text input"), "old");
    await user.type(screen.getByLabelText("Right free text input"), "first right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));
    await user.clear(screen.getByLabelText("Left free text input"));
    await user.clear(screen.getByLabelText("Right free text input"));
    await user.type(screen.getByLabelText("Left free text input"), "newer left");
    await user.type(screen.getByLabelText("Right free text input"), "newer right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));

    const historyButtons = screen.getAllByRole("button", { name: /characters/ });
    await user.click(historyButtons[1]);

    expect(screen.getByTestId("diff-original")).toHaveTextContent("old");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("first right");
  });

  it("passes accessible read-only options to the Free text result diff", async () => {
    const user = userEvent.setup();
    renderWorkspace({ ignoreTrimWhitespace: true });

    await user.type(screen.getByLabelText("Left free text input"), "left");
    await user.type(screen.getByLabelText("Right free text input"), "right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));

    expect(monacoMockState.diffOptions).toMatchObject({
      readOnly: true,
      ignoreTrimWhitespace: true,
      originalAriaLabel: "Left confirmed free text result",
      modifiedAriaLabel: "Right confirmed free text result",
    });
  });
});
