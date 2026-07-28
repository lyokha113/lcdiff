import { describe, expect, it } from "vitest";
import {
  beginStagingOperation,
  fileStagingKey,
  invalidateStagingOperations,
  isCurrentStagingOperation,
  stagingEntryPath,
  viewStagingKey,
} from "./staging";

describe("staging ownership", () => {
  it("keeps View keys bare and file keys side-prefixed", () => {
    expect(viewStagingKey("config.json")).toBe("config.json");
    expect(fileStagingKey("left", "config.json")).toBe("left:config.json");
    expect(fileStagingKey("right", "config.json")).toBe("right:config.json");
    expect(stagingEntryPath("left:config.json")).toBe("config.json");
    expect(stagingEntryPath("config.json")).toBe("config.json");
  });

  it("invalidates stale async staging completions", () => {
    const owner = { current: 0 };
    const first = beginStagingOperation(owner);
    const second = beginStagingOperation(owner);

    expect(isCurrentStagingOperation(owner, first)).toBe(false);
    expect(isCurrentStagingOperation(owner, second)).toBe(true);

    invalidateStagingOperations(owner);
    expect(isCurrentStagingOperation(owner, second)).toBe(false);
  });
});
