import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchResultsPanel } from "@/components/SearchResultsPanel";
import type { SearchResult } from "@/lib/types";

const results: SearchResult[] = [
  { side: "left", path: "pkg/App.class", kind: "path", tier: "T2" },
  { side: "left", path: "pkg/App.class", kind: "constantPool", tier: "T2", preview: "Needle" },
  { side: "right", path: "config/app.properties", kind: "text", tier: "T2", line: 4, preview: "needle=value" },
];

const sourceResult: SearchResult = {
  side: "left",
  path: "pkg/App.class",
  kind: "source",
  tier: "T3",
  line: 22,
  preview: "List<String> values",
};

describe("SearchResultsPanel", () => {
  it("renders grouped result rows", () => {
    render(<SearchResultsPanel results={results} grouping="kind" onInspect={vi.fn()} />);

    const pathGroup = screen.getByRole("group", { name: "Path search results" });
    const constantsGroup = screen.getByRole("group", { name: "Constants search results" });
    const textGroup = screen.getByRole("group", { name: "Text search results" });

    expect(within(pathGroup).getAllByText("Path")).toHaveLength(2);
    expect(within(constantsGroup).getAllByText("Constants")).toHaveLength(2);
    expect(within(textGroup).getAllByText("Text")).toHaveLength(2);
    expect(screen.getAllByText("pkg/App.class")).toHaveLength(2);
    expect(screen.getByText("config/app.properties")).toBeInTheDocument();
    expect(screen.getByText(":4")).toBeInTheDocument();
    expect(screen.getByText("needle=value")).toBeInTheDocument();
  });

  it("renders side grouped result rows", () => {
    render(<SearchResultsPanel results={results} grouping="side" onInspect={vi.fn()} />);

    const leftGroup = screen.getByRole("group", { name: "Left search results" });
    const rightGroup = screen.getByRole("group", { name: "Right search results" });

    expect(within(leftGroup).getAllByRole("button")).toHaveLength(2);
    expect(within(rightGroup).getAllByRole("button")).toHaveLength(1);
    expect(within(leftGroup).getAllByText("LEFT")).toHaveLength(2);
    expect(within(rightGroup).getByText("RIGHT")).toBeInTheDocument();
  });

  it("calls onInspect with the clicked result", async () => {
    const onInspect = vi.fn();
    render(<SearchResultsPanel results={results} grouping="kind" onInspect={onInspect} />);

    await userEvent.click(
      within(screen.getByRole("group", { name: "Text search results" })).getByRole("button"),
    );

    expect(onInspect).toHaveBeenCalledWith(results[2]);
  });

  it("merges hits for the same file when source results are present", () => {
    render(<SearchResultsPanel results={[...results, sourceResult]} grouping="kind" onInspect={vi.fn()} />);

    const fileGroup = screen.getByRole("group", { name: "Files search results" });
    const appRow = within(fileGroup).getByRole("button", { name: /pkg\/App\.class/ });

    expect(screen.queryByRole("group", { name: "Constants search results" })).not.toBeInTheDocument();
    expect(within(fileGroup).getAllByRole("button")).toHaveLength(2);
    expect(screen.getAllByText("pkg/App.class")).toHaveLength(1);
    expect(within(appRow).getByText("Path")).toBeInTheDocument();
    expect(within(appRow).getByText("Constants")).toBeInTheDocument();
    expect(within(appRow).getByText("Source")).toBeInTheDocument();
    expect(within(appRow).getByText(":22")).toBeInTheDocument();
    expect(within(appRow).getByText("List<String> values")).toBeInTheDocument();
  });

  it("opens the source hit when a merged source row is clicked", async () => {
    const onInspect = vi.fn();
    render(<SearchResultsPanel results={[...results, sourceResult]} grouping="kind" onInspect={onInspect} />);

    await userEvent.click(screen.getByRole("button", { name: /pkg\/App\.class/ }));

    expect(onInspect).toHaveBeenCalledWith(sourceResult);
  });

  it("renders nothing for empty results", () => {
    const { container } = render(<SearchResultsPanel results={[]} grouping="kind" onInspect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
