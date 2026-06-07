# Design

## Application Flow

```text
class preview -> Tauri SidecarClient -> lazy JVM spawn
  -> [u32 big-endian length][JSON] -> Java sidecar
  -> CFR | Vineflower | ASM -> framed response
```

Tauri retries once after an I/O/protocol failure. Engine errors are returned
without an infinite retry loop. Text, binary, diff, and merge remain usable if
the sidecar artifact or Java executable is absent.

Interactive preview, deep search, and sibling prefetch use separate JVM
workers. They share a canonical-path and archive-metadata keyed 128 MB LRU
cache so background work cannot hold the interactive worker lock or mix
responses from different archives with matching file metadata.

The protocol exposes typed abstract decompile options even though the MVP UI
uses defaults. Cache keys include those options, action mode, and pinned CFR,
Vineflower, or ASM version so future flag wiring cannot reuse stale output.

## Alternatives Considered

1. Start one JVM per click. Rejected because cold-start cost harms navigation.
2. JNI in process. Rejected because failure isolation is worse.
