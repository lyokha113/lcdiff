import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE, type ComparePair } from "@/lib/types";

describe("types", () => {
  it("ComparePair shape compiles and is usable", () => {
    const pair: ComparePair = { path: "a", status: "different" };
    expect(pair.status).toBe("different");
  });

  it("defaults source decompilation to Vineflower", () => {
    expect(DEFAULT_ENGINE).toBe("vineflower");
  });
});
