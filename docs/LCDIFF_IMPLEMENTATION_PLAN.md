# LCDiff Implementation Plan

Source: `/Users/lyo/Downloads/SPEC.md` Draft SPEC v0.1.

## Architecture Rule

Rust owns archive bytes and destructive actions. React emits intents. Decompiled
source is read-only. The JVM sidecar can fail independently without disabling
text, binary, diff, search, or merge.

## Delivery Phases

| Phase | Scope | Status | Proof |
| --- | --- | --- | --- |
| P1 Core archive safety | Path validation, lazy index/read, normalized-to-raw path mapping, duplicate normalized-path rejection, encrypted-entry rejection, CRC diff, constant-pool search, strict signed metadata, multi-release metadata, Zip64 detection/write guard, class/file stage with directory rejection, source/target change rejection, atomic save with directory/timestamp preservation, writable preflight, single overwritten backup | implemented | Rust tests and CLI smoke |
| P2 Desktop compare/merge shell | Async Tauri IPC adapters for long operations, React shadcn/ui Tailwind panels, path preflight with inline errors, picker, OS drop, Monaco diff with whitespace toggle, detected text languages, binary size/SHA-256/CRC details plus hex fallback, pending badges, arrow/context-menu stage, per-row unstage, clear/save | implemented locally | Rust desktop state-machine tests, frontend build, macOS dev startup |
| P3 JVM sidecar | CFR, Vineflower, ASM bytecode, typed abstract decompile options boundary, async warm start, 30-second watchdog, one retry, canonical-path, metadata, options, mode, and engine-version keyed 128 MB LRU cache, Java 17 jlink assembly | implemented locally | Java 17 bundled-runtime smoke covers ping, CFR, Vineflower, ASM |
| P4 Search/polish | T1 Monaco find, T2 path/text/constant-pool search without binary inflation, T3 cached deep source search on a dedicated background worker with left/right/both scope, tagged clickable streaming results including match kind and line, progress/cancel with sidecar preemption, bytecode tab, tree filters, dirty-close guard, dark Monaco theme, on-demand metadata-only class status, separate low-priority prefetch worker | implemented locally | frontend build, Tauri debug build, macOS empty-shell screenshot |
| P5 Distribution | Windows atomic replace implementation, active Tauri bundle config, per-arch local build with optional macOS signing/notarization plus Windows Authenticode signing, macOS `.app` and final-app DMG packaging, local packaging-script invariant verifier, ad-hoc inside-out signing with deterministic signed-app output, notarization script, and Linux XWayland fallback launcher added; Wayland matrix and real signing/notarization pending | in progress | local signed `.app` startup uses bundled JRE/JAR; `npm run verify:packaging-scripts` |

## Immediate Next Story: Release Hardening

Use `docs/PLATFORM_VALIDATION.md` as the pass/fail checklist for all external
runner work.

1. Run Windows atomic-replace integration tests.
2. Run GNOME, KDE, and Sway Wayland/X11 drop matrix, including
   `scripts/launch-linux-xwayland.sh` fallback coverage.
3. Add real Developer ID certificate and notary credentials as repository
   secrets, then run the conditional release signing/notarization workflow.
4. Add real Windows Authenticode certificate secrets, then run the conditional
   release signing workflow on a Windows runner.
5. Validate prefetch latency with large archives and tune the visible-neighbor
   limit if needed.

## Known Platform Work

- Windows save uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`;
  it still needs a Windows runner integration test.
- Linux file-drop must be re-tested on GNOME, KDE, and Sway Wayland/X11,
  including the XWayland launcher fallback.
- macOS bundled JRE signing is implemented inside-out and covered by local
  script invariants; real Developer ID notarization still needs credentials.
