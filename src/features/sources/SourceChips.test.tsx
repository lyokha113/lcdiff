import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SourceChips } from "./SourceChips";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ArchiveSummary } from "@/lib/types";

const leftArchive: ArchiveSummary = {
  path: "/x/app.jar",
  metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
  entries: [],
};

function setup(overrides: Partial<ComponentProps<typeof SourceChips>> = {}) {
  const props: ComponentProps<typeof SourceChips> = {
    mode: "compare" as const, archives: { left: leftArchive }, paths: { left: "", right: "" },
    pathErrors: {}, onPathChange: vi.fn(), onOpenPath: vi.fn(), onBrowse: vi.fn(),
    onBrowseFolder: vi.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <SourceChips {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe("SourceChips", () => {
  it("labels the picker as File/Folder in View mode and removes the right slot", () => {
    setup({ mode: "single" });
    expect(screen.getByRole("region", { name: "File/Folder" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Right File/Folder" })).not.toBeInTheDocument();
  });

  it("uses side-specific File/Folder labels in Compare mode", () => {
    setup();
    expect(screen.getByRole("region", { name: "Left File/Folder" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Right File/Folder" })).toBeInTheDocument();
  });

  it("keeps semantic side regions without standalone side labels", () => {
    setup();
    expect(screen.getByRole("region", { name: "Left File/Folder" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Right File/Folder" })).toBeInTheDocument();
    expect(document.querySelector(".source-slot__side")).not.toBeInTheDocument();
    expect(document.querySelector(".source-slot__identity")).not.toBeInTheDocument();
  });

  it("shows the loaded archive filename on its chip", () => {
    setup();
    expect(screen.getByText("app.jar", { exact: true })).toBeInTheDocument();
  });
  it("opens a repick popover when a chip is clicked", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /change left source/i }));
    expect(screen.getByText("Left File/Folder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse file/i })).toBeInTheDocument();
  });
  it("browses for a file from the popover", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /change left source/i }));
    await userEvent.click(screen.getByRole("button", { name: /Browse file/i }));
    expect(props.onBrowse).toHaveBeenCalledWith("left");
  });

  it("offers a temporary target only from the empty side of one loaded archive", async () => {
    const user = userEvent.setup();
    const props = setup({ onCreateTempTarget: vi.fn() });

    await user.click(screen.getByRole("button", { name: /change right source/i }));
    await user.click(screen.getByRole("button", { name: "Create temp target..." }));

    expect(props.onCreateTempTarget).toHaveBeenCalledWith("left");
  });

  it("labels temp roles and blocks target replacement controls", async () => {
    const user = userEvent.setup();
    setup({
      archives: { left: leftArchive, right: { ...leftArchive, path: "/tmp/working.jar" } },
      tempSession: {
        id: "temp-1", targetSide: "right", workingName: "working.jar", entryCount: 4,
        appliedSourceCount: 2, exportedPath: null,
      },
    });

    expect(screen.getByText("SOURCE - REPLACEABLE")).toBeInTheDocument();
    expect(screen.getByText("TEMP TARGET - SESSION ONLY")).toBeInTheDocument();
    expect(screen.getByText("working.jar · 4 entries · 2 sources applied")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /change right source/i }));
    expect(screen.getByRole("textbox", { name: "Right File/Folder path" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Browse file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Browse folder" })).toBeDisabled();
  });

  it("does not offer a new temporary target while a controller operation is busy", async () => {
    const user = userEvent.setup();
    setup({ onCreateTempTarget: vi.fn(), tempBusy: true });

    await user.click(screen.getByRole("button", { name: /change right source/i }));
    expect(screen.queryByRole("button", { name: "Create temp target..." })).not.toBeInTheDocument();
  });

});
