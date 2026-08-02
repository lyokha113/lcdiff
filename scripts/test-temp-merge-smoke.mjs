#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const environment = { ...process.env };
delete environment.RUSTC_WRAPPER;

const result = spawnSync(
  "cargo",
  [
    "test",
    "-p",
    "lcdiff-desktop",
    "temp_merge_three_source_smoke_preserves_selected_and_skipped_target_bytes",
    "--lib",
  ],
  {
    cwd: new URL("..", import.meta.url),
    env: environment,
    stdio: "inherit",
  },
);

assert.equal(result.status, 0, "temporary merge three-source smoke failed");
