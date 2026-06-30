#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const forbidden = [`L${"Diff"}`, `L${"DIFF"}`, `l${"diff"}`];
const result = spawnSync(
  "git",
  [
    "grep",
    "-I",
    "-l",
    "-E",
    forbidden.join("|"),
    "--",
    ":(exclude)package-lock.json",
  ],
  { encoding: "utf8" },
);

if (result.status !== 0 && result.status !== 1) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}

const output = result.stdout.trim();

if (output) {
  console.error("Old LCDiff branding remains in:");
  console.error(output);
  process.exit(1);
}
