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

function setup(overrides = {}) {
  const props = {
    history,
    now: NOW,
    onPickMode: vi.fn(),
    onOpenEntry: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<SplashScreen {...props} />);
  return props;
}

describe("SplashScreen", () => {
  it("renders both mode buttons", () => {
    setup();
    expect(screen.getByRole("button", { name: /decompile/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
  });

  it("calls onPickMode with the mode when a button is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /decompile/i }));
    expect(props.onPickMode).toHaveBeenCalledWith("single");
    await userEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(props.onPickMode).toHaveBeenCalledWith("compare");
  });

  it("renders a compare entry with both paths", () => {
    setup();
    expect(screen.getByText(/a\.jar/)).toBeInTheDocument();
    expect(screen.getByText(/b\.jar/)).toBeInTheDocument();
  });

  it("renders a single entry path", () => {
    setup();
    expect(screen.getByText(/commons\.jar/)).toBeInTheDocument();
  });

  it("calls onOpenEntry with the entry when a row is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByText(/commons\.jar/));
    expect(props.onOpenEntry).toHaveBeenCalledWith(history[1]);
  });

  it("shows an empty state when there is no history", () => {
    setup({ history: [] });
    expect(screen.getByText(/no recent sessions yet/i)).toBeInTheDocument();
  });

  it("calls onClear when Clear is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(props.onClear).toHaveBeenCalled();
  });
});
