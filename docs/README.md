# Documentation Map

This directory holds the `LCDiff` design, architecture, and validation docs.

## Files

- `ARCHITECTURE.md`: application shape and boundary rules.
- `GLOSSARY.md`: shared terms.
- `LCDIFF_COMPLETION_AUDIT.md`: proof evidence for the implemented product.
- `OPERATIONS_MACOS.md`: macOS build, sign, notarize, and packaging operations.
- `PLATFORM_VALIDATION.md`: cross-platform validation notes.
- `RELEASING.md`: release build and publication runbook.

## Current State

`LCDiff` is implemented: Rust `lcdiff-core`, a Tauri v2 desktop
shell, and a JVM decompiler sidecar. See `../README.md` for the build and
platform-validation commands and `LCDIFF_COMPLETION_AUDIT.md` for proof evidence.
