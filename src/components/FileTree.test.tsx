import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "@/components/FileTree";
import type { ComparePair } from "@/lib/types";

const pairs: ComparePair[] = [
  { path: "A.class", status: "different", left: { path: "A.class", kind: "class" }, right: { path: "A.class", kind: "class" } },
  { path: "B.txt", status: "onlyLeft", left: { path: "B.txt", kind: "text" } },
];

function setup(overrides = {}) {
  const props = {
    visiblePairs: pairs, selected: undefined, stagedEntries: {}, mode: "compare" as const,
    onInspect: vi.fn(), onSelect: vi.fn(), onCopy: vi.fn(), onUnstage: vi.fn(),
    ...overrides,
  };
  render(<FileTree {...props} />);
  return props;
}

describe("FileTree", () => {
  it("renders a row per visible pair with its status badge", () => {
    setup();
    expect(screen.getByText("different")).toBeInTheDocument();
    expect(screen.getByText("onlyLeft")).toBeInTheDocument();
  });
  it("calls onInspect when a row is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(props.onInspect).toHaveBeenCalledWith(pairs[0]);
  });
});
