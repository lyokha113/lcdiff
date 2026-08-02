import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MergeConflictDialog } from "./MergeConflictDialog";

const preview = {
  conflicts: ["b.txt", "a.txt"],
  newEntries: ["new.txt"],
};

function setup(overrides = {}) {
  const props = {
    open: true,
    preview,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    busy: false,
    ...overrides,
  };
  render(<MergeConflictDialog {...props} />);
  return props;
}

describe("MergeConflictDialog", () => {
  it("requires a decision for every conflict but not informational new entries", () => {
    setup();

    expect(screen.getByText("new.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage merge decisions" })).toBeDisabled();
  });

  it("overwrites every conflict with a deterministically sorted submission", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Overwrite all" }));
    await user.click(screen.getByRole("button", { name: "Stage merge decisions" }));

    expect(props.onSubmit).toHaveBeenCalledWith([
      { entryPath: "a.txt", action: "overwrite" },
      { entryPath: "b.txt", action: "overwrite" },
    ]);
  });

  it("supports per-entry choices and Skip all", async () => {
    const user = userEvent.setup();
    const props = setup();

    const a = screen.getByRole("group", { name: "a.txt conflict" });
    await user.click(within(a).getByRole("button", { name: "Overwrite" }));
    expect(screen.getByRole("button", { name: "Stage merge decisions" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Skip all" }));
    await user.click(screen.getByRole("button", { name: "Stage merge decisions" }));

    expect(props.onSubmit).toHaveBeenCalledWith([
      { entryPath: "a.txt", action: "skip" },
      { entryPath: "b.txt", action: "skip" },
    ]);
  });

  it("disables conflict controls while the controller is busy", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: "Overwrite all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stage merge decisions" })).toBeDisabled();
  });
});
