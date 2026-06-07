import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigDrawer } from "@/components/ConfigDrawer";

function setup(overrides = {}) {
  const props = {
    open: true, mode: "compare" as const, searchScope: "both" as const, searching: false,
    treeFilter: "differences" as const, engine: "cfr" as const,
    ignoreTrimWhitespace: true, backupEnabled: false,
    onScopeChange: vi.fn(), onDeepSearch: vi.fn(), onCancelDeepSearch: vi.fn(), onClearSearch: vi.fn(),
    onFilterChange: vi.fn(), onEngineChange: vi.fn(), onIgnoreWsChange: vi.fn(), onBackupChange: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><ConfigDrawer {...props} /></TooltipProvider>);
  return props;
}

describe("ConfigDrawer", () => {
  it("renders nothing actionable when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Deep search")).not.toBeInTheDocument();
  });
  it("shows backup toggle only in compare mode", () => {
    setup({ mode: "single" });
    expect(screen.queryByText(/Keep one overwritten .bak on save/)).not.toBeInTheDocument();
  });
  it("fires onDeepSearch", async () => {
    const props = setup();
    await userEvent.click(screen.getByText("Deep search"));
    expect(props.onDeepSearch).toHaveBeenCalled();
  });
});
