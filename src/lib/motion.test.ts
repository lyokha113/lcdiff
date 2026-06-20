import { describe, expect, it } from "vitest";
import { shouldAnimateUi } from "./motion";

describe("shouldAnimateUi", () => {
  it("disables motion for the saved reduced preference", () => {
    expect(shouldAnimateUi("reduced", false)).toBe(false);
  });

  it("disables motion for an operating-system reduced-motion request", () => {
    expect(shouldAnimateUi("full", true)).toBe(false);
  });

  it("allows motion when both settings allow it", () => {
    expect(shouldAnimateUi("full", false)).toBe(true);
  });
});
