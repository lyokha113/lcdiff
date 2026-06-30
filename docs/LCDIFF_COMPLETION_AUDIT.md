# LCDiff SPEC Completion Audit

Source: `SPEC.md` (repository root) Draft SPEC v0.1.

This audit separates implemented local behavior from platform and release gates
that require external runners, display servers, or signing credentials.
External pass/fail criteria are captured in `docs/PLATFORM_VALIDATION.md`.

## Implemented Locally

| SPEC area | Evidence |
| --- | --- |
| Open JAR/ZIP/folder | Shared validated path pipeline for `.jar`, `.zip`, and directory sources, explicit `validate_path(raw)` desktop preflight with per-panel inline errors, path input, native file picker, native folder picker, OS file drop, quoted and shell-escaped pasted path handling, home-relative path resolution with Windows `USERPROFILE` and `HOMEDRIVE`/`HOMEPATH` fallbacks |
| Source model | Lazy ZIP index/read, recursive folder index/read without following symlinks, normalized-to-raw ZIP path mapping, duplicate normalized-path rejection, encrypted-entry rejection with explicit domain error, CRC and size diff for archive entries and folder files, strict signed metadata detection (`.SF` + signature block + manifest digest), multi-release metadata with regression proof, Zip64 footer/local-extra detection including a forced-small Zip64 regression fixture |
| Viewers | Read-only Monaco source/text viewer with directory preview short-circuit, extension-based language selection, binary size/SHA-256/CRC details plus hex fallback, ASM bytecode tab with class-only UI affordance and backend guard; Monaco is self-hosted from the bundled `monaco-editor` package with local Vite web workers (`src/lib/monaco.ts`, `loader.config({ monaco })`) so viewers render offline with no jsDelivr CDN dependency |
| Compare | Aligned path rows, Monaco side-by-side diff, `ignoreTrimWhitespace` toggle, all/differences/only-left/only-right filters, on-demand metadata-only class status |
| Merge | Original class/file byte copy with directory-copy rejection, staged batch, duplicate staged target replacement, one target per batch, pending row badges, arrow buttons and shadcn context menu, per-row unstage, explicit clear/save, same-directory temp archive rewrite, folder target temp-file replacement, fsync, directory/timestamp preservation regression, Zip64 large-entry writer guard, atomic replacement, optional archive `.bak` or folder `<folder>.bak` backup with regression proof, failed-backup pre-replace regression proving target untouched and temp cleanup, signed-JAR confirmation through shadcn Dialog with per-session file suppression, source/target changed-on-disk rejection, writable-target preflight |
| Dirty state | Desktop state-machine tests prove target lock, dirty file-switch rejection, clear unlock, signed-confirmation enforcement, and Linux Wayland runtime drop-hint detection; window close asks before discarding staged copies; frontend invariant verifier ensures Single-mode file drops target the visible left panel, archive-open clears stale preview/search state, Single-mode search only targets the visible left archive, search-result clicks reveal hidden tree rows before selection and highlight line matches in Monaco, Single-mode disables merge copy and staged-save actions, staged changes block switching into Single mode, stale async source/bytecode preview results and stale T2 search completions and stale deep-search events are ignored, invalidating search actions clear the deep-search busy state, Tauri-only drag/drop, close, and event-listener effects do not crash browser preview, and Linux Wayland sessions surface a subtle Browse/path-input fallback hint |
| Desktop concurrency | ZIP open/diff/read/search/save and sidecar preview/disassemble adapters run through async Tauri commands with blocking work offloaded from the IPC thread; deep search already runs on a dedicated background worker |
| JVM sidecar | Long-lived bundled Java 17 runtime, async warm start, CFR, Vineflower, ASM, framed JSON with typed abstract decompile options, 30-second watchdog, kill/retry once, degraded fallback |
| Search | Monaco current-diff find plus contextual Files-index search with typed grouped path/text/constant-pool/source results; backend search can return multiple hit kinds per entry and deep source search still streams/cancels. |
| UI design | Editorial startup prioritizes Compare, then the workspace uses five stable zones: grouped command bar, explicit source rail, Files/open-diff navigator, dominant tree/Monaco canvas, and persistent status bar. Search and preferences are bounded contextual surfaces; search is closed by default and closes after result inspection. Curated themes, role-based fonts, density/radius/motion controls, editor display controls, and grouped results remain available. |
| Frontend stack | React shell uses shadcn/ui source components (`Button`, `Input`, `Select`, `Checkbox`, `Badge`, `ContextMenu`, `Resizable`, `Dialog`, `Tooltip`) with Tailwind v4, GSAP startup motion, self-hosted Geist/JetBrains Mono fonts, `components.json`, `@` alias, and `cn()` helper. The frontend invariant verifier checks shadcn/Tailwind composition; Playwright render verification fails on browser errors, exercises compare/open/search/merge/save flows, and checks `1280x800`, `1024x640`, and `720x520` for horizontal overflow and a visible workspace canvas. |
| Cache/prefetch | 128 MB canonical-path, archive-metadata, options, action-mode, and pinned-engine-version keyed LRU cache shared by interactive, deep-search, and separate low-priority same-directory sibling-prefetch JVM workers |
| Packaging code | Active Tauri bundle config with app icon/resources, per-arch release workflow with optional macOS Developer ID signing/notarization and Windows Authenticode signing steps, macOS `.app` plus DMG packaged from the final signed/notarized app when available, Linux AppImage/deb/rpm, Arch AUR package source, Windows NSIS/MSI, Linux XWayland launch fallback helper, Linux display-matrix validation runner, Windows platform validation runner, macOS distribution validation runner, macOS inside-out signing helper with default WebView/JVM entitlements, deterministic signed-app output, notarytool/stapler helper, and macOS DMG packaging helper |

## Deliberately Deferred

These items are marked optional, nice-to-have, post-MVP, or phase 2 in the SPEC:

- GraalVM native-image sidecar experiment.
- Rename/move detection, paranoid SHA-256 verification, recent-files dropdown,
  environment-variable path expansion, persistent disk cache, and Flatpak.
- Per-engine advanced decompiler options UI. The typed abstract options
  boundary and cache partitioning exist; translating user-selected flags into
  CFR and Vineflower settings remains deferred.

## External Verification Gates

| Gate | Current state |
| --- | --- |
| Windows atomic replace | `MoveFileExW(MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH)` is implemented; `scripts\verify-windows-platform.ps1` now provides the Windows runner for cargo tests, verifiers, sidecar smoke, and NSIS/MSI build; still requires execution on Windows using `docs/PLATFORM_VALIDATION.md` |
| Linux display matrix | GNOME/KDE/Sway Wayland and X11 OS file-drop matrix requires those environments; XWayland fallback launcher syntax is verified locally; `scripts/verify-linux-display-matrix.sh` now records per-compositor/session Browse, path-input, OS-drop, and optional XWayland results as Markdown evidence; pass criteria are in `docs/PLATFORM_VALIDATION.md` |
| macOS distribution | Ad-hoc inside-out signing with default WebView/JVM entitlements, deterministic signed-app output, signed/final app xattr cleanup, target-specific JLINK/app/JRE Mach-O architecture guards, post-DMG strict codesign verification, mounted-DMG `LCDiff.app` verification, notarytool/stapler script syntax, conditional release-workflow wiring, bundled-JRE startup, and `scripts/verify-macos-distribution.sh` handoff with `platform-validation/macos-distribution-*.md` reporting, including `platform-validation/macos-distribution-aarch64-apple-darwin-20260605T133311Z.md` are verified locally; x86_64 local validation now fails fast when only an arm64 JLINK is present and requires `LCDIFF_JLINK_X86_64_APPLE_DARWIN`; real Developer ID signing and notarization require credentials and `docs/PLATFORM_VALIDATION.md` |
| Visual screenshot QA | Playwright headless verification mocks Tauri IPC to exercise path validation, Compare open/select/copy, pending changes, context unstage, tree filters, contextual search, metadata-only status, dirty mode switching, View mode, signed-save suppression, backup propagation, bytecode, binary fallback, and signed-save confirmation. It also proves the redesigned shell has no horizontal overflow and retains a visible workspace canvas at desktop, compact-desktop, and narrow-compact viewports. In-app Browser QA supplies current rendered screenshot and interaction evidence for the startup and workspace surfaces. |

The Playwright render verifier boots the Vite shell and uses browser IPC mocks to exercise path-input validation error and clear-on-success, assert the pending target plus pending row badge, unstage through the row context menu, verify tree-filter row visibility, click a scoped T2 search result, verify on-demand metadata-only class status, verify dirty mode-switch blocking, clear staged changes and switch into Single mode without Monaco lifecycle errors, verify signed-save session suppression, prove backup checkbox IPC propagation, render the Bytecode tab through `disassemble`, render binary fallback SHA/CRC details plus hex preview, and require the signed-JAR warning Dialog before a confirmed Save anyway commits.

## Local Verification

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npm run verify:all
scripts/test-sidecar-smoke.sh
npm run tauri -- build --debug --bundles app
```
