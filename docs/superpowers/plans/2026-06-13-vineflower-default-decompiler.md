# Vineflower Default Decompiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vineflower the default Java source decompiler across the desktop UI, Rust app state, and JVM sidecar protocol fallback while keeping CFR selectable and tested.

**Architecture:** Keep decompiler selection explicit and side-effect free. Add one frontend default constant and one Rust default constant, then wire startup state to those constants. Treat the JVM sidecar as a separate process boundary with its own missing-engine default because it can receive protocol requests outside the desktop UI path.

**Tech Stack:** React 19 + TypeScript + Vitest, Tauri v2 Rust desktop host, `lcdiff-core` sidecar protocol types, Java sidecar using CFR/Vineflower/ASM, Node-based sidecar smoke script.

---

## File Structure

- Modify `src/lib/types.ts`: add `DEFAULT_ENGINE` as the frontend contract constant.
- Modify `src/lib/types.test.ts`: assert the frontend default engine is `vineflower`.
- Modify `src/App.tsx`: initialize React engine state from `DEFAULT_ENGINE`.
- Modify `src/components/ConfigDrawer.test.tsx`: use the default engine constant in the drawer fixture and assert both engines remain selectable.
- Modify `crates/lcdiff-core/src/sidecar_protocol.rs`: add `DEFAULT_DECOMPILE_ENGINE` as the Rust protocol/application default.
- Modify `src-tauri/src/main.rs`: initialize `AppState.engine` from `DEFAULT_DECOMPILE_ENGINE` and add an app-state default regression test.
- Modify `sidecar/src/main/java/dev/lcdiff/sidecar/SidecarMain.java`: make missing `engine` on `decompile` default to `vineflower`.
- Modify `scripts/test-sidecar-smoke.mjs`: assert missing-engine decompile does not return CFR output and keep explicit CFR coverage.
- Modify `README.md`: state Vineflower is the default decompiler and CFR remains available.
- Modify `sidecar/README.md`: document missing-engine sidecar behavior.
- Modify `docs/ARCHITECTURE.md`: record Vineflower as the default sidecar source engine.

---

### Task 1: Frontend Default Contract

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/types.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/ConfigDrawer.test.tsx`

- [ ] **Step 1: Write the failing frontend default test**

In `src/lib/types.test.ts`, replace the imports and test body with:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE, type ComparePair } from "@/lib/types";

describe("types", () => {
  it("ComparePair shape compiles and is usable", () => {
    const pair: ComparePair = { path: "a", status: "different" };
    expect(pair.status).toBe("different");
  });

  it("defaults source decompilation to Vineflower", () => {
    expect(DEFAULT_ENGINE).toBe("vineflower");
  });
});
```

- [ ] **Step 2: Run the focused frontend default test and verify it fails**

Run:

```bash
rtk npm test -- src/lib/types.test.ts
```

Expected: FAIL because `@/lib/types` does not export `DEFAULT_ENGINE`.

- [ ] **Step 3: Add the frontend default constant**

In `src/lib/types.ts`, add the constant immediately after the `Engine` type:

```ts
export type Engine = "cfr" | "vineflower";
export const DEFAULT_ENGINE: Engine = "vineflower";
export type Mode = "single" | "compare";
```

- [ ] **Step 4: Wire App startup state to the frontend default**

In `src/App.tsx`, update the type import list to include `DEFAULT_ENGINE`:

```ts
  ArchiveDiff,
  ArchiveSummary,
  CodeEditor,
  CommitResult,
  ComparePair,
  DecorationRef,
  DEFAULT_ENGINE,
  DiffCodeEditor,
  Engine,
```

Then replace the engine state initializer:

```ts
  const [treeFilter, setTreeFilter] = useState<TreeFilter>("diff");
  const [engine, setEngine] = useState<Engine>(DEFAULT_ENGINE);
  const [query, setQuery] = useState("");
```

- [ ] **Step 5: Keep ConfigDrawer test fixtures aligned with the default**

In `src/components/ConfigDrawer.test.tsx`, update the imports:

```ts
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { DEFAULT_ENGINE } from "@/lib/types";
```

Update the fixture default:

```ts
    open: true, mode: "compare" as const, searchScope: "both" as const, searching: false,
    engine: DEFAULT_ENGINE,
    ignoreTrimWhitespace: true, backupEnabled: false,
```

Add this test inside the existing `describe("ConfigDrawer", () => { ... })` block:

```ts
  it("keeps Vineflower and CFR selectable", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Decompiler engine"));
    expect(screen.getByText("Vineflower")).toBeInTheDocument();
    expect(screen.getByText("CFR")).toBeInTheDocument();
    await userEvent.click(screen.getByText("CFR"));
    expect(props.onEngineChange).toHaveBeenCalledWith("cfr");
  });
```

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
rtk npm test -- src/lib/types.test.ts src/components/ConfigDrawer.test.tsx
```

Expected: PASS. Vitest may print the existing `--localstorage-file was provided without a valid path` warning and still exit 0.

- [ ] **Step 7: Commit frontend default contract**

Run:

```bash
rtk git add src/lib/types.ts src/lib/types.test.ts src/App.tsx src/components/ConfigDrawer.test.tsx
rtk git commit -m "feat(ui): default decompiler to vineflower"
```

---

### Task 2: Rust App-State Default Contract

**Files:**
- Modify: `crates/lcdiff-core/src/sidecar_protocol.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write the failing Rust app-state test**

In `src-tauri/src/main.rs`, inside `#[cfg(test)] mod tests`, add this test after the imports and before `staged_target_lock_blocks_switching_target_and_archive`:

```rust
    #[test]
    fn app_state_defaults_to_vineflower() {
        let state = AppState::default();

        assert_eq!(state.engine, DecompileEngine::Vineflower);
    }
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
rtk cargo test -p lcdiff-desktop app_state_defaults_to_vineflower
```

Expected: FAIL with an assertion showing `left: Cfr` and `right: Vineflower`.

- [ ] **Step 3: Add the Rust default constant**

In `crates/lcdiff-core/src/sidecar_protocol.rs`, add the constant immediately after `DecompileEngine`:

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DecompileEngine {
    Cfr,
    Vineflower,
}

pub const DEFAULT_DECOMPILE_ENGINE: DecompileEngine = DecompileEngine::Vineflower;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SidecarAction {
```

- [ ] **Step 4: Wire AppState startup to the Rust default**

In `src-tauri/src/main.rs`, update the `lcdiff_core` import to include `DEFAULT_DECOMPILE_ENGINE`:

```rust
    Archive, ArchiveDiff, ArchiveEntry, ArchiveMetadata, ArchiveSourceKind, CommitOptions,
    CommitResult, DEFAULT_DECOMPILE_ENGINE, DecompileEngine, EntryKind, MergePlan,
    NestedArchiveCache, compare, edit, search_constant_pool, validate_path as validate_archive_path,
```

Then update `AppState::new`:

```rust
            left_plan: MergePlan::new(),
            right_plan: MergePlan::new(),
            engine: DEFAULT_DECOMPILE_ENGINE,
            sidecar: Arc::new(Mutex::new(sidecar)),
```

- [ ] **Step 5: Run the focused Rust test**

Run:

```bash
rtk cargo test -p lcdiff-desktop app_state_defaults_to_vineflower
```

Expected: PASS.

- [ ] **Step 6: Run protocol/core compile coverage**

Run:

```bash
rtk cargo test -p lcdiff-core sidecar_protocol
```

Expected: PASS or `0 passed` with successful compile if no tests match the filter. The important check is that `lcdiff-core` exports the new constant cleanly.

- [ ] **Step 7: Commit Rust default contract**

Run:

```bash
rtk git add crates/lcdiff-core/src/sidecar_protocol.rs src-tauri/src/main.rs
rtk git commit -m "feat(desktop): default app state to vineflower"
```

---

### Task 3: JVM Sidecar Missing-Engine Default

**Files:**
- Modify: `sidecar/src/main/java/dev/lcdiff/sidecar/SidecarMain.java`
- Modify: `scripts/test-sidecar-smoke.mjs`

- [ ] **Step 1: Write the failing sidecar smoke assertion**

In `scripts/test-sidecar-smoke.mjs`, replace the current explicit Vineflower block:

```js
  assertIncludes(
    await request(child, pending, {
      id: "v1",
      action: "decompile",
      engine: "vineflower",
      classpath: [archive],
      entry: "demo/Hello.class",
    }),
    "hello-lcdiff",
  );
```

with this missing-engine default block:

```js
  const defaultDecompiler = await request(child, pending, {
    id: "default-vineflower",
    action: "decompile",
    classpath: [archive],
    entry: "demo/Hello.class",
  });
  assertIncludes(defaultDecompiler, "hello-lcdiff");
  assertNotIncludes(defaultDecompiler, "Decompiled with CFR");
```

Add this helper after `assertIncludes`:

```js
function assertNotIncludes(response, unexpected) {
  assertOk(response);
  if (response.source?.includes(unexpected)) throw new Error(JSON.stringify(response));
}
```

- [ ] **Step 2: Run the sidecar smoke and verify it fails**

Run with system Java to avoid a wrong-platform bundled JRE blocking the contract test:

```bash
rtk env LCDIFF_JAVA="$(command -v java)" scripts/test-sidecar-smoke.sh
```

Expected: FAIL before the Java sidecar default is changed, because missing-engine decompile currently runs CFR and includes `Decompiled with CFR`.

- [ ] **Step 3: Change the JVM sidecar missing-engine default**

In `sidecar/src/main/java/dev/lcdiff/sidecar/SidecarMain.java`, replace:

```java
        String engine = request.path("engine").asText("cfr");
```

with:

```java
        String engine = request.path("engine").asText("vineflower");
```

- [ ] **Step 4: Run the sidecar smoke**

Run:

```bash
rtk env LCDIFF_JAVA="$(command -v java)" scripts/test-sidecar-smoke.sh
```

Expected: PASS with:

```text
sidecar smoke passed: ping, CFR, inner/anonymous classes, ASM, Vineflower, malformed fallback
```

- [ ] **Step 5: Commit sidecar default contract**

Run:

```bash
rtk git add sidecar/src/main/java/dev/lcdiff/sidecar/SidecarMain.java scripts/test-sidecar-smoke.mjs
rtk git commit -m "feat(sidecar): default missing engine to vineflower"
```

---

### Task 4: Product Documentation

**Files:**
- Modify: `README.md`
- Modify: `sidecar/README.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update README user-facing decompile contract**

In `README.md`, replace the Decompile bullet near the top:

```md
- **Decompile** — CFR / Vineflower source and ASM bytecode through an isolated
  JVM sidecar that may degrade independently when the JVM is absent.
```

with:

```md
- **Decompile** — Vineflower source by default, CFR as an alternate engine, and
  ASM bytecode through an isolated JVM sidecar that may degrade independently
  when the JVM is absent.
```

- [ ] **Step 2: Update README developer architecture wording**

In `README.md`, replace:

```md
JVM decompiler sidecar  (CFR / Vineflower / ASM, jlink Java 17)
```

with:

```md
JVM decompiler sidecar  (Vineflower default / CFR / ASM, jlink Java 17)
```

Also replace:

```md
- **JVM decompiler sidecar** — CFR / Vineflower / ASM over framed stdio with a
  versioned LRU cache and a bundled Java 17 jlink JRE.
```

with:

```md
- **JVM decompiler sidecar** — Vineflower source by default, CFR source as an
  alternate engine, and ASM bytecode over framed stdio with a versioned LRU
  cache and a bundled Java 17 jlink JRE.
```

- [ ] **Step 3: Update sidecar README protocol contract**

In `sidecar/README.md`, replace:

```md
- `decompile` with `engine: "cfr" | "vineflower"`
```

with:

```md
- `decompile` with optional `engine: "cfr" | "vineflower"`; missing `engine`
  defaults to `"vineflower"`
```

Replace:

```md
The production app bundles a Java 17 jlink runtime because current Vineflower
requires Java 17. The source remains Java 8 compatible so CFR, ping, and ASM can
also be smoke-tested on older development runtimes.
```

with:

```md
The production app defaults to Vineflower and bundles a Java 17 jlink runtime
because current Vineflower requires Java 17. The sidecar source remains Java 8
compatible so explicit CFR, ping, and ASM can also be smoke-tested on older
development runtimes.
```

- [ ] **Step 4: Update architecture wording**

In `docs/ARCHITECTURE.md`, replace:

```md
        -> bundled JVM service: CFR, Vineflower, ASM Textifier
```

with:

```md
        -> bundled JVM service: Vineflower default, CFR alternate, ASM Textifier
```

Replace:

```md
The Java sidecar
implements CFR decompile, a reflective Vineflower adapter, and ASM Textifier.
```

with:

```md
The Java sidecar implements Vineflower decompile by default, CFR as an explicit
alternate source engine, and ASM Textifier for bytecode.
```

- [ ] **Step 5: Run docs verification**

Run:

```bash
rtk npm run verify:docs
```

Expected: PASS.

- [ ] **Step 6: Commit docs**

Run:

```bash
rtk git add README.md sidecar/README.md docs/ARCHITECTURE.md
rtk git commit -m "docs: document vineflower as default decompiler"
```

---

### Task 5: Final Verification

**Files:**
- No source edits in this task.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
rtk npm test -- src/lib/types.test.ts src/components/ConfigDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run focused Rust tests**

Run:

```bash
rtk cargo test -p lcdiff-desktop app_state_defaults_to_vineflower
```

Expected: PASS.

- [ ] **Step 3: Run sidecar smoke with system Java**

Run:

```bash
rtk env LCDIFF_JAVA="$(command -v java)" scripts/test-sidecar-smoke.sh
```

Expected: PASS. If this fails because Maven has not built the sidecar jar, run:

```bash
rtk mvn -f sidecar/pom.xml package
rtk env LCDIFF_JAVA="$(command -v java)" scripts/test-sidecar-smoke.sh
```

- [ ] **Step 4: Run full frontend unit tests**

Run:

```bash
rtk npm test
```

Expected: PASS.

- [ ] **Step 5: Run frontend render verification**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: PASS.

- [ ] **Step 6: Run docs verification**

Run:

```bash
rtk npm run verify:docs
```

Expected: PASS.

- [ ] **Step 7: Check whitespace and worktree**

Run:

```bash
rtk git diff --check HEAD
rtk git status --short --branch
```

Expected: `git diff --check HEAD` exits 0. `git status --short --branch` shows the implementation commits and may still show the existing untracked `AGENTS.md`; do not stage `AGENTS.md` unless the user explicitly asks.

---

## Self-Review

Spec coverage:

- Vineflower default in React startup state: Task 1.
- Vineflower default in Rust app state for preview, deep search, and prefetch: Task 2.
- Missing-engine sidecar default: Task 3.
- CFR remains selectable and smoke-tested: Tasks 1 and 3.
- No automatic Vineflower-to-CFR fallback: no task adds fallback; Task 3 only changes missing-engine default.
- Decompiled output remains read-only and merge bytes are untouched: no merge/write paths are modified.
- Docs capture default contract: Task 4.
- Verification coverage: Task 5.

Placeholder scan:

- The plan contains no open placeholders, postponed-work markers, or vague instructions.

Type consistency:

- Frontend constant name is `DEFAULT_ENGINE` and has type `Engine`.
- Rust constant name is `DEFAULT_DECOMPILE_ENGINE` and has type `DecompileEngine`.
- Sidecar protocol engine strings remain `"cfr"` and `"vineflower"`.
