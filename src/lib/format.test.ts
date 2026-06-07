import { describe, expect, it } from "vitest";
import { timeAgo } from "@/lib/format";

const NOW = 1_000_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  it("shows 'just now' under a minute", () => {
    expect(timeAgo(NOW - 30 * SEC, NOW)).toBe("just now");
  });

  it("shows minutes", () => {
    expect(timeAgo(NOW - 5 * MIN, NOW)).toBe("5m ago");
  });

  it("shows hours", () => {
    expect(timeAgo(NOW - 2 * HOUR, NOW)).toBe("2h ago");
  });

  it("shows days under a week", () => {
    expect(timeAgo(NOW - 3 * DAY, NOW)).toBe("3d ago");
  });

  it("falls back to a date string for a week or more", () => {
    const label = timeAgo(NOW - 10 * DAY, NOW);
    expect(label).not.toMatch(/ago|just now/);
    expect(label.length).toBeGreaterThan(0);
  });

  it("treats future timestamps as 'just now'", () => {
    expect(timeAgo(NOW + 5 * MIN, NOW)).toBe("just now");
  });
});
