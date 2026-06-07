import { describe, expect, it } from "vitest";
import type { ComparePair } from "@/lib/types";

describe("types", () => {
  it("ComparePair shape compiles and is usable", () => {
    const pair: ComparePair = { path: "a", status: "different" };
    expect(pair.status).toBe("different");
  });
});
