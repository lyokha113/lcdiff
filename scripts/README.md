# Scripts

Build, sign, package, and verification scripts for LDiff.

## Verification

Wired into `package.json` (`npm run verify:*`, `npm run verify:all`):

- `verify-docs.mjs` — documentation invariants.
- `verify-frontend-invariants.mjs` — frontend structural invariants.
- `verify-frontend-render.mjs` — frontend render checks.
- `verify-packaging-scripts.mjs` — packaging-script invariants.

Platform verifiers (run on the relevant host):

- `verify-macos-distribution.sh` — macOS distribution checks.
- `verify-windows-platform.ps1` — Windows platform checks.
- `verify-linux-display-matrix.sh` — Linux Wayland/X11 display matrix.

## Sidecar

- `assemble-sidecar-resources.sh` — stage JVM sidecar resources.
- `build-jlink-runtime.sh` — build the bundled Java runtime via `jlink`.
- `test-sidecar-smoke.sh` / `test-sidecar-smoke.mjs` — sidecar smoke test.

## Packaging & Signing

- `package-macos-dmg.sh` — build the final-app DMG.
- `sign-macos-bundle.sh` — sign the macOS `.app`.
- `notarize-macos-app.sh` — notarize the macOS app.
- `sign-windows-bundles.ps1` — Authenticode-sign Windows bundles.
- `launch-linux-xwayland.sh` — XWayland fallback launcher.

## Misc

- `screenshot-redesign.mjs` — capture app screenshots.
