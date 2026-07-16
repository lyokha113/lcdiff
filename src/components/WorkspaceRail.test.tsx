import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceRail } from "@/components/WorkspaceRail";

function setup(mode: "single" | "compare" | "text" = "compare") {
  const props = {
    mode,
    searchOpen: false,
    drawerOpen: false,
    onChangeMode: vi.fn(),
    onToggleSearch: vi.fn(),
    onToggleDrawer: vi.fn(),
  };
  render(<WorkspaceRail {...props} />);
  return props;
}

describe("WorkspaceRail", () => {
  it("exposes the three modes as persistent navigation", () => {
    setup();
    expect(screen.getByRole("navigation", { name: "Workspace modes and tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View mode" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Compare mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Text mode" })).toHaveAttribute("aria-pressed", "false");
  });

  it("changes mode and opens global tools", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "View mode" }));
    await user.click(screen.getByRole("button", { name: "Toggle search" }));
    await user.click(screen.getByRole("button", { name: "Preferences" }));
    expect(props.onChangeMode).toHaveBeenCalledWith("single");
    expect(props.onToggleSearch).toHaveBeenCalled();
    expect(props.onToggleDrawer).toHaveBeenCalled();
  });

  it("removes search from Text mode", () => {
    setup("text");
    expect(screen.queryByRole("button", { name: "Toggle search" })).not.toBeInTheDocument();
  });
});
