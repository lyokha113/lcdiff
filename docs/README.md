# Documentation Map

This directory holds the `LDiff` design, architecture, and validation docs.

## Files

- `ARCHITECTURE.md`: application shape and boundary rules.
- `GLOSSARY.md`: shared terms.
- `LDIFF_IMPLEMENTATION_PLAN.md`: implementation plan.
- `LDIFF_COMPLETION_AUDIT.md`: proof evidence for the implemented product.
- `OPERATIONS_MACOS.md`: macOS build, sign, notarize, and packaging operations.
- `PLATFORM_VALIDATION.md`: cross-platform validation notes.

## Current State

`LDiff` is implemented: Rust `ldiff-core` + `ldiff-cli`, a Tauri v2 desktop
shell, and a JVM decompiler sidecar. See `../README.md` for the build and
platform-validation commands and `LDIFF_COMPLETION_AUDIT.md` for proof evidence.
