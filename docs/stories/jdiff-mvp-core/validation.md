# Validation

## Proof Strategy

Use deterministic temporary ZIP/JAR fixtures to validate archive semantics.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Path normalization, type detection, class constant-pool parsing |
| Integration | Open, encrypted-entry rejection, lazy read, diff, stage copy, atomic save, backup |
| E2E | CLI smoke workflow |
| Platform | Unix atomic replacement covered locally; Windows pending |
| Performance | Diff uses indexed CRC32 and size only |
| Logs/Audit | Not applicable to the core |

## Commands

```text
rtk cargo fmt --check
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk cargo test --workspace
```

## Acceptance Evidence

- `rtk cargo fmt --all -- --check`
- `rtk cargo test --workspace`: 52 workspace tests passed, including encrypted
  entry rejection, quoted and shell-escaped pasted path validation, backslash
  path read, desktop and CLI empty-query search rejection, CLI text and class
  constant-pool search, binary payload exclusion, duplicate staged target
  replacement, failed-backup pre-atomic-replace target-untouched and temp
  cleanup regression, directory preview short-circuit, non-class bytecode-view
  rejection, same-directory sibling prefetch, T3 per-entry decompile-error
  skip, and automated CLI integration smoke.
- `rtk cargo clippy --workspace --all-targets -- -D warnings`
- `rtk npm run build`
- `rtk npm run tauri -- dev`: macOS local shell started; stopped manually after
  startup smoke.
- Automated CLI smoke: list, diff, read, search, copy with `--backup`, rewritten
  target bytes, and overwritten `.bak` bytes.
