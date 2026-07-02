import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SourceChips } from "@/components/SourceChips";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ArchiveSummary } from "@/lib/types";

const leftArchive: ArchiveSummary = {
  path: "/x/app.jar",
  metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
  entries: [],
};

function setup(overrides = {}) {
  const props = {
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

});
