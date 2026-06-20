import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { DEFAULT_ENGINE } from "@/lib/types";

Object.assign(window.HTMLElement.prototype, {
  hasPointerCapture: vi.fn(() => false),
  scrollIntoView: vi.fn(),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
});

function setup(overrides = {}) {
  const props = {
    open: true,
    mode: "compare" as const,
    engine: DEFAULT_ENGINE,
    backupEnabled: false,
    ignoreTrimWhitespace: true,
    preferences: DEFAULT_UI_PREFERENCES,
    onPreferencesChange: vi.fn(),
    onEngineChange: vi.fn(),
    onIgnoreWhitespaceChange: vi.fn(),
    onBackupEnabledChange: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><ConfigDrawer {...props} /></TooltipProvider>);
  return props;
}

describe("ConfigDrawer", () => {
  it("renders nothing actionable when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Appearance")).not.toBeInTheDocument();
  });

  it("shows Appearance with Light and Dark theme sections by default", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Preference categories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Light themes")).toBeInTheDocument();
    expect(screen.getByText("Dark themes")).toBeInTheDocument();
    expect(screen.getByText("LDiff Graphite")).toBeInTheDocument();
  });

  it("switches to Typography and changes editor font size", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Typography" }));
    await userEvent.click(screen.getByLabelText("Editor font size"));
    const options = screen.getByRole("listbox");
    await userEvent.click(within(options).getByText("15"));
    expect(props.onPreferencesChange).toHaveBeenCalledWith(expect.objectContaining({
      typography: expect.objectContaining({ editorScale: 15 }),
    }));
  });

  it("keeps Vineflower and CFR selectable in Decompiler", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Decompiler" }));
    await userEvent.click(screen.getByLabelText("Decompiler engine"));
    const engineOptions = screen.getByRole("listbox");
    expect(within(engineOptions).getByText("Vineflower")).toBeInTheDocument();
    expect(within(engineOptions).getByText("CFR")).toBeInTheDocument();
    await userEvent.click(within(engineOptions).getByText("CFR"));
    expect(props.onEngineChange).toHaveBeenCalledWith("cfr");
  });

  it("shows backup toggle only in compare mode", async () => {
    setup({ mode: "single" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByText(/Keep one overwritten .bak on save/)).not.toBeInTheDocument();
  });
});
