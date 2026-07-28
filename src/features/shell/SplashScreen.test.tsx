import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SplashScreen } from "./SplashScreen";
import type { HistoryEntry } from "./history";

const NOW = 1_000_000_000_000;

const history: HistoryEntry[] = [
  {
    id: "k1",
    mode: "compare",
    paths: ["/work/releases/a.jar", "/work/fixes/b.jar"],
    openedAt: NOW - 60_000,
  },
  {
    id: "k2",
    mode: "single",
    paths: ["~/libs/commons.jar"],
    openedAt: NOW - 60_000,
  },
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
  it("presents recent work before secondary new-task actions", () => {
    setup();
    const recent = screen.getByRole("navigation", { name: "Recent sessions" });
    const newTask = screen.getByRole("region", { name: "Start a new task" });

    expect(recent.parentElement).toHaveClass("launch__desk");
    expect(recent.parentElement?.firstElementChild).toBe(recent);
    expect(recent.nextElementSibling).toBe(newTask);
    expect(screen.getByRole("button", { name: "Open Compare mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open View mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Text mode" })).toBeInTheDocument();
    expect(screen.queryByText("Desktop workspace")).not.toBeInTheDocument();
  });

  it("renders the three mode buttons", () => {
    setup();
    expect(screen.getByRole("button", { name: "Open View mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Compare mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Text mode" })).toBeInTheDocument();
    expect(screen.getByText("Text", { selector: ".launch-card__title" })).toBeInTheDocument();
    expect(screen.getByText("View", { selector: ".launch-card__title" })).toBeInTheDocument();
    expect(screen.getByText("Compare", { selector: ".launch-card__title" })).toBeInTheDocument();
  });

  it("calls onPickMode with the mode when a button is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Open View mode" }));
    expect(props.onPickMode).toHaveBeenCalledWith("single");
    await userEvent.click(screen.getByRole("button", { name: "Open Compare mode" }));
    expect(props.onPickMode).toHaveBeenCalledWith("compare");
    await userEvent.click(screen.getByRole("button", { name: "Open Text mode" }));
    expect(props.onPickMode).toHaveBeenCalledWith("text");
  });

  it("renders compare sources as distinct left and right values", () => {
    setup();
    const left = document.querySelector('.launch-history__source[data-side="left"]');
    const right = document.querySelector('.launch-history__source[data-side="right"]');
    expect(left).toHaveTextContent("a.jar");
    expect(left).toHaveTextContent("/work/releases/a.jar");
    expect(left).toHaveAttribute("title", "/work/releases/a.jar");
    expect(right).toHaveTextContent("b.jar");
    expect(right).toHaveTextContent("/work/fixes/b.jar");
    expect(right).toHaveAttribute("title", "/work/fixes/b.jar");
  });

  it("presents a single basename separately from its full path", () => {
    setup();
    const source = document.querySelector('.launch-history__source[data-side="single"]');
    expect(source).toHaveTextContent("commons.jar");
    expect(source).toHaveTextContent("~/libs/commons.jar");
    expect(source).toHaveAttribute("title", "~/libs/commons.jar");
  });

  it("calls onOpenEntry with the entry when a row is clicked", async () => {
    const props = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Reopen View ~/libs/commons.jar" }),
    );
    expect(props.onOpenEntry).toHaveBeenCalledWith(history[1]);
  });

  it("shows an empty state when there is no history", () => {
    setup({ history: [] });
    expect(screen.getByText("History appears after you open a source.")).toBeInTheDocument();
  });

  it("shows five recent sessions, expands, and collapses the stored list", async () => {
    setup({ history: sixHistoryEntries });
    expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "View all history" }));
    expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: "Show less history" }));
    expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(5);
  });

  it("includes compare sides and full source paths in a row accessible name", () => {
    setup();
    expect(
      screen.getByRole("button", {
        name: "Reopen Compare, Left /work/releases/a.jar, Right /work/fixes/b.jar",
      }),
    ).toBeInTheDocument();
  });

  it("includes full source paths in a text row accessible name", () => {
    setup({
      history: [{
        id: "text-1",
        mode: "text",
        paths: ["/drafts/left.txt", "/drafts/right.txt"],
        openedAt: NOW - 60_000,
      }],
    });
    expect(
      screen.getByRole("button", { name: "Reopen Text /drafts/left.txt and /drafts/right.txt" }),
    ).toBeInTheDocument();
  });

  it("calls onClear when Clear is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(props.onClear).toHaveBeenCalled();
  });
});
