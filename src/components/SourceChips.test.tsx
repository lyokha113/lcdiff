import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SourceChips } from "@/components/SourceChips";
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
    onBrowseFolder: vi.fn(), onSave: vi.fn(),
    ...overrides,
  };
  render(<SourceChips {...props} />);
  return props;
}

describe("SourceChips", () => {
  it("shows the loaded archive filename on its chip", () => {
    setup();
    expect(screen.getByText(/app.jar/)).toBeInTheDocument();
  });
  it("opens a repick popover when a chip is clicked", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /change left source/i }));
    expect(screen.getByRole("button", { name: /Browse file/i })).toBeInTheDocument();
  });
  it("disables Save staged in single mode", async () => {
    setup({ mode: "single" });
    await userEvent.click(screen.getByRole("button", { name: /change left source/i }));
    expect(screen.getByLabelText("Save staged")).toBeDisabled();
  });
});
