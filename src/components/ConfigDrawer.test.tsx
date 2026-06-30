import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { FALLBACK_SYSTEM_FONTS } from "@/lib/system-fonts";

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
    preferences: DEFAULT_UI_PREFERENCES,
    systemFonts: FALLBACK_SYSTEM_FONTS,
    fontStatus: "ready" as const,
    onLoadSystemFonts: vi.fn(),
    onPreferencesChange: vi.fn(),
    onClose: vi.fn(),
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

  it("closes from the panel header", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Close preferences" }));

    expect(props.onClose).toHaveBeenCalled();
  });

  it("keeps the compact header separate from the scrollable preferences body", () => {
    setup();

    const dialog = screen.getByRole("dialog", { name: "Preferences" });
    expect(dialog.querySelector(":scope > .preferences-header")).toBeInTheDocument();
    const body = dialog.querySelector(":scope > .preferences-body");
    expect(body).toBeInTheDocument();
    expect(body?.querySelector(".preferences-nav")).toBeInTheDocument();
    expect(body?.querySelector(".preferences-content")).toBeInTheDocument();
  });

  it("requests system fonts when Preferences opens in the idle state", () => {
    const props = setup({ fontStatus: "idle" });

    expect(props.onLoadSystemFonts).toHaveBeenCalledTimes(1);
  });

  it("renders only Appearance, Editor, and Misc as top-level sections", () => {
    setup();

    const nav = screen.getByRole("navigation", { name: "Preference categories" });
    expect(within(nav).getByRole("button", { name: "Appearance" })).toHaveAttribute("aria-pressed", "true");
    expect(within(nav).getByRole("button", { name: "Editor" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Misc" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Typography" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Decompiler" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("changes Appearance color pattern", async () => {
    const props = setup();

    const appearancePanel = screen.getByRole("region", { name: "Appearance preferences" });
    expect(appearancePanel.querySelector(".appearance-pattern-grid")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(props.onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_UI_PREFERENCES,
      appearance: { colorPattern: "light" },
    });
  });

  it("marks Appearance controls for overflow-safe layout", () => {
    setup();

    const appearancePanel = screen.getByRole("region", { name: "Appearance preferences" });
    expect(appearancePanel.querySelector(".appearance-pattern-grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System" })).toHaveClass("preference-choice");
  });

  it("marks Editor controls for overflow-safe layout", async () => {
    setup({
      systemFonts: [
        { family: "A Very Long Installed Developer Font Family Name That Should Not Overflow", monospaceLikely: true },
        ...FALLBACK_SYSTEM_FONTS,
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(screen.getByLabelText("Editor font family")).toHaveClass("editor-font-select-trigger");
    expect(screen.getByText("Monaco minimap")).toBeInTheDocument();
    expect(screen.getByText("Monaco minimap").closest("label")).toHaveClass("editor-minimap-toggle");
  });

  it("marks Misc controls for overflow-safe layout", async () => {
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    const segmented = screen.getByRole("group", { name: "Misc preference panels" });
    expect(segmented).toHaveClass("segmented-control");
    expect(within(segmented).getByRole("button", { name: "Decompiler" })).toHaveClass("segmented-control__button");
  });

  it("changes editor font size from the Editor section", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Editor" }));
    await userEvent.click(screen.getByLabelText("Editor font size"));
    await userEvent.click(within(screen.getByRole("listbox")).getByText("16"));

    expect(props.onPreferencesChange).toHaveBeenCalledWith(expect.objectContaining({
      editor: expect.objectContaining({ fontSize: 16 }),
    }));
  });

  it("shows fallback state when native font enumeration fails", async () => {
    setup({ fontStatus: "fallback" });

    await userEvent.click(screen.getByRole("button", { name: "Editor" }));

    expect(screen.getByText("Using bundled fallback fonts")).toBeInTheDocument();
  });

  it("does not retry system font loading when Editor opens in fallback state", async () => {
    const props = setup({ fontStatus: "fallback" });

    await userEvent.click(screen.getByRole("button", { name: "Editor" }));

    expect(screen.getByLabelText("Editor font family")).toBeInTheDocument();
    expect(props.onLoadSystemFonts).not.toHaveBeenCalled();
  });

  it("renders Misc segmented controls and keeps Save visible in single mode", async () => {
    setup({ mode: "single" });

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));

    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Decompiler" }));
    expect(screen.getByLabelText("Decompiler engine")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Appearance" }));
    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    expect(screen.getByRole("button", { name: "Decompiler" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Decompiler engine")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Keep one overwritten .bak on save")).toBeInTheDocument();
  });
});
