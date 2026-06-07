# jdiff JVM Sidecar

Build:

```bash
rtk mvn -f sidecar/pom.xml package
```

The shaded artifact is `sidecar/target/jdiff-sidecar-0.1.0.jar`. It uses the
same `[u32 big-endian length][JSON]` framing as
`jdiff-core::sidecar_protocol`.

Actions:

- `ping`
- `decompile` with `engine: "cfr" | "vineflower"`
- `disassemble`
- `cancel` acknowledgement

The production app bundles a Java 17 jlink runtime because current Vineflower
requires Java 17. The source remains Java 8 compatible so CFR, ping, and ASM can
also be smoke-tested on older development runtimes.

Build the runtime with a Java 17+ `jlink` executable:

```bash
JDIFF_JLINK="$(mise where java@temurin-17.0.18+8)/bin/jlink" \
  rtk scripts/assemble-sidecar-resources.sh
JDIFF_JAVA=src-tauri/resources/jre/bin/java \
  rtk scripts/test-sidecar-smoke.sh
```
