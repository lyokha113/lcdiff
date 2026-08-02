import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MenuBar } from "./MenuBar";

const tempSession = {
  id: "temp-1",
  targetSide: "right" as const,
  workingName: "working.jar",
  entryCount: 4,
  appliedSourceCount: 1,
  exportedPath: null,
};

function setup(overrides = {}) {
  const props = {
    mode: "compare" as const, stagedTarget: undefined as "left" | "right" | undefined,
    pendingOps: [] as Array<{ key: string; path: string; side: "left" | "right"; kind: "copy" | "edit" }>,
    canRefresh: true,
    onSave: vi.fn(), onRefresh: vi.fn(), onClearStaged: vi.fn(), onUnstageOne: vi.fn(),
    onApplyTemp: vi.fn(), onSaveTempAs: vi.fn(), onDiscardTemp: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><MenuBar {...props} /></TooltipProvider>);
  return props;
}

describe("MenuBar", () => {
  it("groups commands by workspace intent", () => {
    setup();
    expect(screen.getByRole("banner", { name: "Workspace commands" })).toBeInTheDocument();
    expect(screen.getByText("Compare")).toBeInTheDocument();
    expect(screen.getByText("Archive workbench")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Save changes" })).toBeInTheDocument();
  });

  it("shows View staging controls without a compare-side target", () => {
    setup({
      mode: "single",
      stagedTarget: "right",
      pendingOps: [{ key: "right:Main.class", path: "Main.class", side: "right", kind: "copy" }],
    });

    expect(screen.getByRole("group", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save to archive/i })).toBeEnabled();
    expect(screen.getByText("1 unsaved")).toBeInTheDocument();
    expect(screen.queryByText(/→ right/)).not.toBeInTheDocument();
  });

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

  it("replaces archive-save controls with temp Apply, Save As, and Discard actions", async () => {
    const props = setup({
      tempSession,
      stagedTarget: "right",
      pendingOps: [{ key: "config.xml", path: "config.xml", side: "right", kind: "copy" }],
    });

    expect(screen.queryByRole("button", { name: /Save to archive/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply to temp (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Save temp as" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard temp" }));

    expect(props.onApplyTemp).toHaveBeenCalledOnce();
    expect(props.onSaveTempAs).toHaveBeenCalledOnce();
    expect(props.onDiscardTemp).toHaveBeenCalledOnce();
  });

  it("projects only the matching retry action during temp recovery", () => {
    setup({
      tempSession: undefined,
      tempBusy: true,
      tempRetryOperation: "saveAs",
      stagedTarget: "right",
      pendingOps: [{ key: "config.xml", path: "config.xml", side: "right", kind: "copy" }],
    });

    expect(screen.getByRole("button", { name: "Retry Save As" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Apply to temp/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save temp as" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard temp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save to archive/i })).not.toBeInTheDocument();
  });
});
