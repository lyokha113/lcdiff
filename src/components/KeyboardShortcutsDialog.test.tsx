import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";

function renderDialog(platform: "darwin" | "windows" = "darwin", onOpenChange = vi.fn()) {
  render(<KeyboardShortcutsDialog open onOpenChange={onOpenChange} platform={platform} />);
  return { onOpenChange };
}

describe("KeyboardShortcutsDialog", () => {
  it("renders the title and action groups in registry order", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Available app-level keyboard shortcuts.")).toBeInTheDocument();

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "File",
      "Edit",
      "Search",
      "View",
      "Workspace",
      "Merge",
      "Help",
    ]);
  });

  it("shows the compare-only note and macOS aria label for Open Right Directory", () => {
    renderDialog("darwin");

    const row = screen.getByText("Open Right Directory").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Compare only")).toBeInTheDocument();
    expect(within(row!).getByRole("group", { name: "Command Option Shift O" })).toBeInTheDocument();
  });

  it("shows the Windows aria label for Open Left Directory", () => {
    renderDialog("windows");

    const row = screen.getByText("Open Left Directory").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByRole("group", { name: "Ctrl Alt O" })).toBeInTheDocument();
  });

  it("closes through the built-in dialog close button", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
