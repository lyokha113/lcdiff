import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SplashScreen } from "@/components/SplashScreen";
import type { HistoryEntry } from "@/lib/history";

const NOW = 1_000_000_000_000;

const history: HistoryEntry[] = [
  { id: "k1", mode: "compare", paths: ["a.jar", "b.jar"], openedAt: NOW - 60_000 },
  { id: "k2", mode: "single", paths: ["~/libs/commons.jar"], openedAt: NOW - 60_000 },
];

const sixHistoryEntries: HistoryEntry[] = [
  { id: "k1", mode: "compare", paths: ["/work/a.jar", "/work/b.jar"], openedAt: NOW - 60_000 },
  { id: "k2", mode: "single", paths: ["/work/commons.jar"], openedAt: NOW - 120_000 },
  { id: "k3", mode: "compare", paths: ["/work/c.jar", "/work/d.jar"], openedAt: NOW - 180_000 },
  { id: "k4", mode: "single", paths: ["/work/e.jar"], openedAt: NOW - 240_000 },
  { id: "k5", mode: "single", paths: ["/work/f.jar"], openedAt: NOW - 300_000 },
  { id: "k6", mode: "compare", paths: ["/work/g.jar", "/work/h.jar"], openedAt: NOW - 360_000 },
];

function setup(overrides = {}) {
  const props = {
    history,
    now: NOW,
    onPickMode: vi.fn(),
    onOpenEntry: vi.fn(),
    onClear: vi.fn(),
    motion: "standard" as const,
    ...overrides,
  };
  render(<SplashScreen {...props} />);
  return props;
}

describe("SplashScreen", () => {
  it("presents a task-first startup hierarchy", () => {
    setup();
    expect(screen.getByRole("main", { name: "Start LCDiff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare two sources" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open one source" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare free text" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Recent sessions" })).toBeInTheDocument();
  });

  it("renders both mode buttons", () => {
    setup();
    expect(screen.getByRole("button", { name: "Open one source" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare two sources" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare free text" })).toBeInTheDocument();
  });

  it("calls onPickMode with the mode when a button is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Open one source" }));
    expect(props.onPickMode).toHaveBeenCalledWith("single");
    await userEvent.click(screen.getByRole("button", { name: "Compare two sources" }));
    expect(props.onPickMode).toHaveBeenCalledWith("compare");
    await userEvent.click(screen.getByRole("button", { name: "Compare free text" }));
    expect(props.onPickMode).toHaveBeenCalledWith("text");
  });

  it("renders a compare entry with both paths", () => {
    setup();
    expect(screen.getByText("a.jar ↔ b.jar", { selector: ".launch-history__name" })).toBeInTheDocument();
    expect(screen.getByTitle("a.jar ↔ b.jar")).toBeInTheDocument();
  });

  it("renders a single entry path", () => {
    setup();
    expect(screen.getByText("commons.jar", { selector: ".launch-history__name" })).toBeInTheDocument();
    expect(screen.getByTitle("~/libs/commons.jar")).toBeInTheDocument();
  });

  it("calls onOpenEntry with the entry when a row is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /reopen view.*commons\.jar/i }));
    expect(props.onOpenEntry).toHaveBeenCalledWith(history[1]);
  });

  it("shows an empty state when there is no history", () => {
    setup({ history: [] });
    expect(screen.getByText("History appears after you open a source.")).toBeInTheDocument();
  });

  it("shows five recent sessions and expands to the stored list", async () => {
    setup({ history: sixHistoryEntries });
    expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "View all history" }));
    expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Show less history" })).toBeInTheDocument();
  });

  it("presents basenames separately from source paths", () => {
    setup();
    expect(screen.getByText("a.jar ↔ b.jar", { selector: ".launch-history__name" })).toBeInTheDocument();
    expect(screen.getByTitle("a.jar ↔ b.jar")).toHaveClass("launch-history__path");
  });

  it("calls onClear when Clear is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(props.onClear).toHaveBeenCalled();
  });
});
