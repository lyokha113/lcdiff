# LCDiff JVM Sidecar

Build:

```bash
mvn -f sidecar/pom.xml package
```

The shaded artifact is `sidecar/target/lcdiff-sidecar-0.3.2.jar`. It uses the
same `[u32 big-endian length][JSON]` framing as
`lcdiff-core::sidecar_protocol`.

Actions:

- `ping`
- `decompile` with optional
  `engine: "cfr" | "jdCore" | "jdCoreV0" | "vineflower"`; missing `engine`
  defaults to `"vineflower"`
- `disassemble`
- `cancel` acknowledgement

The production app defaults to Vineflower and bundles a Java 17 jlink runtime
because current decompiler dependencies require Java 17.

Build the runtime with a Java 17+ `jlink` executable:

```bash
LCDIFF_JLINK="$(mise where java@temurin-17.0.18+8)/bin/jlink" \
  scripts/assemble-sidecar-resources.sh
LCDIFF_JAVA=src-tauri/resources/jre/bin/java \
  scripts/test-sidecar-smoke.sh
```
