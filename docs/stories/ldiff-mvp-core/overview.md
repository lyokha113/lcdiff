# Overview

## Current Behavior

The repository contains Harness documentation only. There is no application
implementation.

## Target Behavior

Provide a tested Rust core for validated archive opening, lazy reads, tree-level
diff, constant-pool search, staged merge, and atomic save. Add a CLI adapter so
the core can be exercised before the desktop shell is complete.

## Affected Users

- Desktop users comparing and merging JAR/ZIP files.
- Future frontend and sidecar implementers consuming the Rust API.

## Affected Product Docs

- `docs/product/ldiff-product-contract.md`

## Non-Goals

- Shipping signed platform installers.
- Bundling CFR, Vineflower, or a jlink JRE in this story.
- Implementing the React/Tauri desktop UI in this story.

