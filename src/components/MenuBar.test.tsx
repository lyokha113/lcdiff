import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MenuBar } from "@/components/MenuBar";

function setup(overrides = {}) {
  const props = {
    mode: "compare" as const, stagedTarget: undefined as "left" | "right" | undefined,
    pendingOps: [] as Array<{ key: string; path: string; side: "left" | "right"; kind: "copy" | "edit" }>,
    searchOpen: true, drawerOpen: false, canRefresh: true,
    onChangeMode: vi.fn(), onSave: vi.fn(), onRefresh: vi.fn(), onClearStaged: vi.fn(),
    onToggleSearch: vi.fn(), onToggleDrawer: vi.fn(), onUnstageOne: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><MenuBar {...props} /></TooltipProvider>);
  return props;
}

describe("MenuBar", () => {
  it("shows save-to-archive label and lists pending ops", () => {
    setup({
      stagedTarget: "right",
      pendingOps: [
        { key: "right:config.xml", path: "config.xml", side: "right", kind: "edit" },
        { key: "right:Main.class", path: "Main.class", side: "right", kind: "copy" },
      ],
    });
    expect(screen.getByRole("button", { name: /save to archive \(2\)/i })).toBeInTheDocument();
    expect(screen.getByText(/2 unsaved/i)).toBeInTheDocument();
  });

  it("hides the unsaved badge when nothing is staged", () => {
    setup({ stagedTarget: undefined, pendingOps: [] });
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
  });
  it("toggles the drawer", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Settings"));
    expect(props.onToggleDrawer).toHaveBeenCalled();
  });
  it("refreshes sources", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Refresh sources"));
    expect(props.onRefresh).toHaveBeenCalled();
  });
  it("disables refresh when no source is loaded", () => {
    setup({ canRefresh: false });
    expect(screen.getByLabelText("Refresh sources")).toBeDisabled();
  });
  it("lists pending paths and unstages a row", async () => {
    const props = setup({
      stagedTarget: "right",
      pendingOps: [
        { key: "right:config.xml", path: "config.xml", side: "right", kind: "edit" },
        { key: "right:Main.class", path: "Main.class", side: "right", kind: "copy" },
      ],
    });
    await userEvent.click(screen.getByLabelText("Show pending changes"));
    expect(await screen.findByText("config.xml")).toBeInTheDocument();
    expect(screen.getByText("Main.class")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Unstage config.xml"));
    expect(props.onUnstageOne).toHaveBeenCalledWith("right:config.xml");
  });
});
