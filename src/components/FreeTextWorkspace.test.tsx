import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { FREE_TEXT_HISTORY_STORAGE_KEY } from "@/lib/free-text-history";
import { FreeTextWorkspace } from "./FreeTextWorkspace";

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
  DiffEditor: ({ original, modified }: { original?: string; modified?: string }) => (
    <div data-testid="diff-editor">
      <pre data-testid="diff-original">{original}</pre>
      <pre data-testid="diff-modified">{modified}</pre>
    </div>
  ),
}));

function renderWorkspace() {
  return render(
    <FreeTextWorkspace
      preferences={DEFAULT_UI_PREFERENCES}
      effectiveColorPattern="dark"
      ignoreTrimWhitespace={false}
      onMessage={vi.fn()}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
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

    expect(screen.getByRole("button", { name: /4 chars vs 5 chars/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear free text history" }));

    expect(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: /4 chars vs 5 chars/ })).not.toBeInTheDocument();
    expect(screen.getByText("Confirm a comparison to create a temporary diff result.")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /3 chars vs 11 chars/ }));

    expect(screen.getByTestId("diff-original")).toHaveTextContent("old");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("first right");
  });
});
