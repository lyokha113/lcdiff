import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { DEFAULT_ENGINE } from "@/lib/types";

Object.assign(window.HTMLElement.prototype, {
  hasPointerCapture: vi.fn(() => false),
  scrollIntoView: vi.fn(),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
});

function setup(overrides = {}) {
  const props = {
    open: true, mode: "compare" as const, searchScope: "both" as const, searching: false,
    engine: DEFAULT_ENGINE,
    ignoreTrimWhitespace: true, backupEnabled: false,
    viewMode: "source" as const, canShowSource: true, canShowBytecode: true,
    onScopeChange: vi.fn(), onDeepSearch: vi.fn(), onCancelDeepSearch: vi.fn(), onClearSearch: vi.fn(),
    onEngineChange: vi.fn(), onIgnoreWhitespaceChange: vi.fn(), onBackupEnabledChange: vi.fn(),
    onShowSource: vi.fn(), onShowBytecode: vi.fn(),
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
  it("keeps Vineflower and CFR selectable", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Decompiler engine"));
    const engineOptions = screen.getByRole("listbox");
    expect(within(engineOptions).getByText("Vineflower")).toBeInTheDocument();
    expect(within(engineOptions).getByText("CFR")).toBeInTheDocument();
    await userEvent.click(within(engineOptions).getByText("CFR"));
    expect(props.onEngineChange).toHaveBeenCalledWith("cfr");
  });

  // View toggle moved here from the diff toolbar.
  it("marks Bytecode toggle disabled when no class entry is selected", () => {
    setup({ canShowBytecode: false });
    expect(screen.getByLabelText("Show bytecode")).toBeDisabled();
  });
  it("Source pressed and Bytecode unpressed when viewMode=source", () => {
    setup();
    expect(screen.getByLabelText("Show source").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Show bytecode").getAttribute("aria-pressed")).toBe("false");
  });
  it("Bytecode pressed when viewMode=bytecode", () => {
    setup({ viewMode: "bytecode" });
    expect(screen.getByLabelText("Show bytecode").getAttribute("aria-pressed")).toBe("true");
  });
  it("clicking Source fires onShowSource", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Show source"));
    expect(props.onShowSource).toHaveBeenCalledTimes(1);
  });
});
