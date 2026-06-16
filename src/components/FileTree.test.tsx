import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "@/components/FileTree";
import type { ComparePair } from "@/lib/types";

const pairs: ComparePair[] = [
  { path: "com/example/App.class", status: "different", left: { path: "com/example/App.class", kind: "class" }, right: { path: "com/example/App.class", kind: "class" } },
  { path: "top.txt", status: "onlyLeft", left: { path: "top.txt", kind: "text" } },
];

function setup(overrides = {}) {
  const props = {
    visiblePairs: pairs, selected: undefined, stagedEntries: {}, mode: "compare" as const,
    treeFilter: "all" as const, nestedPairs: {}, onExpandArchive: vi.fn(),
    onInspect: vi.fn(), onSelect: vi.fn(), onCopy: vi.fn(), onUnstage: vi.fn(),
    ...overrides,
  };
  const utils = render(<FileTree {...props} />);
  return { ...utils, props };
}

describe("FileTree", () => {
  it("renders folders and files; diff folders auto-expand to show files", () => {
    setup();
    // Paired entries (folders, two-sided files) render once per side in two-pane mode.
    expect(screen.getAllByText("com").length).toBe(2);
    expect(screen.getAllByText("App.class").length).toBe(2);
    // A left-only file renders only on the left, with a gap on the right.
    expect(screen.getAllByText("top.txt").length).toBe(1);
  });
  it("renders a chevron spacer in file cells so file icons align with folder icons", () => {
    const { container } = setup();

    const fileRows = container.querySelectorAll("button.tree-file");
    expect(fileRows.length).toBeGreaterThan(0);
    for (const row of fileRows) {
      const populatedCells = row.querySelectorAll(".tree-cell:not(.tree-gap)");
      expect(populatedCells.length).toBeGreaterThan(0);
      for (const cell of populatedCells) {
        expect(cell.querySelector(".tree-file-chevron-spacer")).toBeInTheDocument();
      }
    }
  });
  it("collapsing a folder hides its files", async () => {
    setup();
    await userEvent.click(screen.getAllByText("com")[0].closest("button")!);
    expect(screen.queryByText("App.class")).not.toBeInTheDocument();
  });
  it("clicking a file calls onInspect with its pair", async () => {
    const { props } = setup();
    await userEvent.click(screen.getByText("top.txt"));
    expect(props.onInspect).toHaveBeenCalledWith(pairs[1]);
  });
  it("shows the status glyph for a file", () => {
    setup();
    expect(screen.getByLabelText("left only")).toBeInTheDocument();
    expect(screen.getByLabelText("modified")).toBeInTheDocument();
  });
  it("renders a gap on the missing side for one-sided entries", () => {
    const onlyPairs: ComparePair[] = [
      { path: "leftish.txt", status: "onlyLeft", left: { path: "leftish.txt", kind: "text" } },
      { path: "rightish.txt", status: "onlyRight", right: { path: "rightish.txt", kind: "text" } },
    ];
    const { container } = setup({ visiblePairs: onlyPairs });
    expect(screen.getAllByText("leftish.txt").length).toBe(1);
    expect(screen.getAllByText("rightish.txt").length).toBe(1);
    expect(container.querySelectorAll(".tree-gap").length).toBe(2);
  });
  it("shows a single column with no header in single mode", () => {
    const { container } = setup({ mode: "single" });
    expect(container.querySelector(".tree-header")).toBeNull();
    expect(screen.getAllByText("App.class").length).toBe(1);
  });
  it("renders a nested archive entry as an expandable row that fetches on click", () => {
    const archivePairs: ComparePair[] = [
      { path: "lib/inner.jar", status: "different", left: { path: "lib/inner.jar", kind: "archive" }, right: { path: "lib/inner.jar", kind: "archive" } },
    ];
    const onExpandArchive = vi.fn();
    render(
      <FileTree
        visiblePairs={archivePairs}
        stagedEntries={{}}
        mode="compare"
        treeFilter="all"
        nestedPairs={{}}
        onInspect={() => {}}
        onSelect={() => {}}
        onCopy={() => {}}
        onUnstage={() => {}}
        onExpandArchive={onExpandArchive}
      />,
    );
    const row = screen.getAllByText("inner.jar")[0].closest("button")!;
    fireEvent.click(row);
    expect(onExpandArchive).toHaveBeenCalledWith("lib/inner.jar");
  });

  it("applies the tree filter to nested archive children", () => {
    const archivePairs: ComparePair[] = [
      { path: "lib/inner.jar", status: "different", left: { path: "lib/inner.jar", kind: "archive" }, right: { path: "lib/inner.jar", kind: "archive" } },
    ];
    const nestedPairs = {
      "lib/inner.jar": [
        { path: "Changed.class", status: "different" as const, left: { path: "Changed.class", kind: "class" as const }, right: { path: "Changed.class", kind: "class" as const } },
        { path: "Same.class", status: "identical" as const, left: { path: "Same.class", kind: "class" as const }, right: { path: "Same.class", kind: "class" as const } },
      ],
    };
    render(
      <FileTree
        visiblePairs={archivePairs}
        stagedEntries={{}}
        mode="compare"
        treeFilter="diff"
        nestedPairs={nestedPairs}
        onInspect={() => {}}
        onSelect={() => {}}
        onCopy={() => {}}
        onUnstage={() => {}}
        onExpandArchive={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByText("inner.jar")[0].closest("button")!);
    expect(screen.getAllByText("Changed.class").length).toBe(2);
    expect(screen.queryByText("Same.class")).not.toBeInTheDocument();
  });
});
