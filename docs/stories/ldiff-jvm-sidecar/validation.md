# Validation

## Proof Strategy

Build the shaded sidecar, compile a deterministic Java fixture, and exercise
the framed protocol as an external process.

## Commands

```text
mvn -f sidecar/pom.xml clean package -DskipTests
scripts/test-sidecar-smoke.sh
```

## Acceptance Evidence

- Bundled Java 17: `ping`, CFR decompile, Vineflower decompile, and ASM
  disassemble passed.
- Rust sidecar frame round-trip test passed.
- Rust tests cover cache hit storage, archive metadata cache invalidation,
  canonical archive-path and abstract-options cache partitioning, LRU refresh
  on hit, shared worker cache, and process kill after watchdog timeout.
- `npm run tauri -- build --debug` copied runtime, sidecar JAR, and legal
  archive into `target/debug/resources`.
- Ad-hoc signed macOS `.app` started its warm JVM from
  `Contents/Resources/resources/jre/bin/java` with the bundled sidecar JAR.
