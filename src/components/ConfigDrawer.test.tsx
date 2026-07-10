import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { FALLBACK_SYSTEM_FONTS } from "@/lib/system-fonts";
import type { AppUpdateState } from "@/lib/update-client";

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
    updateState: {
      status: "idle" as const,
      releaseUrl: "https://github.com/lyokha113/lcdiff/releases/latest",
      fallbackUrl: "https://github.com/lyokha113/lcdiff/releases/latest",
    },
    onLoadSystemFonts: vi.fn(),
    onPreferencesChange: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onDownloadAndInstallUpdate: vi.fn(),
    onRestartToUpdate: vi.fn(),
    onOpenUpdateFallback: vi.fn(),
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
    expect(within(nav).queryByRole("button", { name: "Updates" })).not.toBeInTheDocument();
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

  it("explains Appearance options with short hover hints", async () => {
    const user = userEvent.setup();
    setup();

    await user.hover(screen.getByRole("button", { name: "System" }));
    expect(await screen.findAllByText("Follow macOS appearance.")).not.toHaveLength(0);
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

  it("explains Editor font with a short hover hint", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Editor" }));
    const fontControl = screen.getByLabelText("Editor font family").closest(".preference-tooltip-control");
    expect(fontControl).toBeInTheDocument();
    await user.hover(fontControl as Element);
    expect(await screen.findAllByText("Font used by Monaco editors.")).not.toHaveLength(0);
  });

  it("explains Editor toggles with short hover hints", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Editor" }));
    await user.hover(screen.getByText("Monaco minimap"));
    expect(await screen.findAllByText("Show a mini file map.")).not.toHaveLength(0);
  });

  it("marks Misc controls for overflow-safe layout", async () => {
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    const segmented = screen.getByRole("group", { name: "Misc preference panels" });
    expect(segmented).toHaveClass("segmented-control");
    expect(within(segmented).getByRole("button", { name: "Decompiler" })).toHaveClass("segmented-control__button");
  });

  it("explains Include source with a short hover hint", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Misc" }));
    const includeSourceLabel = screen.getByText("Include source by default");
    await user.hover(includeSourceLabel);

    expect(await screen.findAllByText("Search decompiled Java too. Slower.")).not.toHaveLength(0);
  });

  it("explains Search result grouping with a short hover hint", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Misc" }));

    await user.hover(screen.getByLabelText("Result grouping help"));
    expect(await screen.findAllByText("Kind = match type. Side = left/right.")).not.toHaveLength(0);
  });

  it("explains Decompiler and Save options with short hover hints", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Misc" }));
    await user.hover(screen.getByRole("button", { name: "Decompiler" }));
    expect(await screen.findAllByText("Class preview defaults.")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Decompiler" }));
    const engineControl = screen.getByLabelText("Decompiler engine").closest(".preference-tooltip-control");
    expect(engineControl).toBeInTheDocument();
    await user.hover(engineControl as Element);
    expect(await screen.findAllByText("Java source preview engine.")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.hover(screen.getByText("Keep one overwritten .bak on save"));
    expect(await screen.findAllByText("Keep one .bak before overwrite.")).not.toHaveLength(0);

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
    expect(screen.getByRole("button", { name: "Updates" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Decompiler" }));
    expect(screen.getByLabelText("Decompiler engine")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Appearance" }));
    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    expect(screen.getByRole("button", { name: "Decompiler" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Decompiler engine")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Keep one overwritten .bak on save")).toBeInTheDocument();
  });

  it("renders update controls inside Misc for an available update", async () => {
    const props = setup({
      updateState: {
        status: "available",
        releaseUrl: "https://github.com/lyokha113/lcdiff/releases/latest",
        currentVersion: "0.3.2",
        latestVersion: "0.3.3",
        message: "LCDiff v0.3.3 is available.",
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    await userEvent.click(screen.getByRole("button", { name: "Updates" }));

    expect(screen.getByText("Current version: 0.3.2")).toBeInTheDocument();
    expect(screen.getByText("Latest version: 0.3.3")).toBeInTheDocument();
    expect(screen.getByText("LCDiff v0.3.3 is available.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await userEvent.click(screen.getByRole("button", { name: "Download and install" }));
    await userEvent.click(screen.getByRole("button", { name: "Open release page" }));

    expect(props.onCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(props.onDownloadAndInstallUpdate).toHaveBeenCalledTimes(1);
    expect(props.onOpenUpdateFallback).toHaveBeenCalledTimes(1);
  });

  it("renders downloading update state inside Misc", async () => {
    const updateState: AppUpdateState = {
      status: "downloading",
      releaseUrl: "https://github.com/lyokha113/lcdiff/releases/latest",
      currentVersion: "0.3.2",
      latestVersion: "0.3.3",
      message: "Downloading LCDiff v0.3.3.",
    };

    setup({ updateState });

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    await userEvent.click(screen.getByRole("button", { name: "Updates" }));

    expect(screen.getByRole("button", { name: "Downloading..." })).toBeDisabled();
  });

  it("renders release-page fallback for error update state inside Misc", async () => {
    const updateState: AppUpdateState = {
      status: "error",
      releaseUrl: "https://github.com/lyokha113/lcdiff/releases/latest",
      currentVersion: "0.3.2",
      message: "Could not install the update.",
    };

    const props = setup({ updateState });

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    await userEvent.click(screen.getByRole("button", { name: "Updates" }));
    await userEvent.click(screen.getByRole("button", { name: "Open release page" }));

    expect(props.onOpenUpdateFallback).toHaveBeenCalledTimes(1);
  });

  it("toggles automatic update checks while preserving Misc defaults", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));
    await userEvent.click(screen.getByRole("button", { name: "Updates" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Automatically check for updates" }));

    expect(props.onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_UI_PREFERENCES,
      misc: {
        ...DEFAULT_UI_PREFERENCES.misc,
        updates: {
          autoCheck: false,
        },
      },
    });
  });
});
