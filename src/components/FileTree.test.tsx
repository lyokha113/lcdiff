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
  render(<FileTree {...props} />);
  return props;
}

describe("FileTree", () => {
  it("renders folders and files; diff folders auto-expand to show files", () => {
    setup();
    expect(screen.getByText("com")).toBeInTheDocument();
    expect(screen.getByText("App.class")).toBeInTheDocument();
    expect(screen.getByText("top.txt")).toBeInTheDocument();
  });
  it("collapsing a folder hides its files", async () => {
    setup();
    await userEvent.click(screen.getByText("com"));
    expect(screen.queryByText("App.class")).not.toBeInTheDocument();
  });
  it("clicking a file calls onInspect with its pair", async () => {
    const props = setup();
    await userEvent.click(screen.getByText("top.txt"));
    expect(props.onInspect).toHaveBeenCalledWith(pairs[1]);
  });
  it("shows the status glyph for a file", () => {
    setup();
    expect(screen.getByLabelText("left only")).toBeInTheDocument();
    expect(screen.getByLabelText("modified")).toBeInTheDocument();
  });
  it("renders a nested archive entry as an expandable row that fetches on click", () => {
    const pairs: ComparePair[] = [
      { path: "lib/inner.jar", status: "different", left: { path: "lib/inner.jar", kind: "archive" }, right: { path: "lib/inner.jar", kind: "archive" } },
    ];
    const onExpandArchive = vi.fn();
    render(
      <FileTree
        visiblePairs={pairs}
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
    const row = screen.getByText("inner.jar").closest("button")!;
    fireEvent.click(row);
    expect(onExpandArchive).toHaveBeenCalledWith("lib/inner.jar");
  });

  it("applies the tree filter to nested archive children", () => {
    const pairs: ComparePair[] = [
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
        visiblePairs={pairs}
        stagedEntries={{}}
        mode="compare"
        treeFilter="differences"
        nestedPairs={nestedPairs}
        onInspect={() => {}}
        onSelect={() => {}}
        onCopy={() => {}}
        onUnstage={() => {}}
        onExpandArchive={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("inner.jar").closest("button")!);
    expect(screen.getByText("Changed.class")).toBeInTheDocument();
    expect(screen.queryByText("Same.class")).not.toBeInTheDocument();
  });
});
