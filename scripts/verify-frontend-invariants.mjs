#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const componentsJson = readFileSync("components.json", "utf8");
const tsconfig = readFileSync("tsconfig.json", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const viteConfig = readFileSync("vite.config.ts", "utf8");

// Combined frontend source: App.tsx + every component (markup may live in either).
const componentDir = "src/components";
const componentFiles = readdirSync(componentDir, { recursive: true })
  .filter((f) => typeof f === "string" && f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((f) => readFileSync(`${componentDir}/${f}`, "utf8"));
const frontend = [app, ...componentFiles].join("\n");

const failures = [];

if (!app.includes("useRef")) {
  failures.push("src/App.tsx: async preview guards must use a request id ref");
}

if (!app.includes("const previewRequestId = useRef(0);")) {
  failures.push("src/App.tsx: missing preview request id ref");
}

if (!app.includes("const searchStreamId = useRef(0);")) {
  failures.push("src/App.tsx: missing search stream id ref");
}

for (const marker of [
  '"tailwindcss"',
  '"@tailwindcss/vite"',
  '"shadcn"',
  '"radix-ui"',
  '"class-variance-authority"',
  '"tailwind-merge"',
  '"react-resizable-panels"',
]) {
  if (!packageJson.includes(marker)) {
    failures.push(`package.json: shadcn/Tailwind dependency missing ${marker}`);
  }
}
if (
  !componentsJson.includes('"style": "radix-nova"') ||
  !componentsJson.includes('"ui": "@/components/ui"') ||
  !componentsJson.includes('"css": "src/styles.css"')
) {
  failures.push("components.json: shadcn radix-nova config must target src/styles.css and @/components/ui");
}
if (!tsconfig.includes('"@/*": ["./src/*"]')) {
  failures.push("tsconfig.json: @ alias must resolve to src for shadcn imports");
}
if (!viteConfig.includes('tailwindcss()') || !viteConfig.includes('"@": "/src"')) {
  failures.push("vite.config.ts: Vite must load Tailwind v4 plugin and @ alias");
}
for (const marker of [
  '@import "tailwindcss";',
  '@import "shadcn/tailwind.css";',
  "@theme inline",
]) {
  if (!styles.includes(marker)) {
    failures.push(`src/styles.css: missing Tailwind/shadcn marker ${marker}`);
  }
}
for (const marker of [
  'import { Button } from "@/components/ui/button";',
  'import { Input } from "@/components/ui/input";',
  'import { Badge } from "@/components/ui/badge";',
  'import { Checkbox } from "@/components/ui/checkbox";',
  'from "@/components/ui/context-menu";',
  'from "@/components/ui/dialog";',
  'from "@/components/ui/select";',
  'from "@/components/ui/tooltip";',
]) {
  if (!frontend.includes(marker)) {
    failures.push(`frontend: must compose UI through shadcn component ${marker}`);
  }
}

for (const marker of [
  "ContextMenuTrigger asChild",
  "ContextMenuContent",
  "ContextMenuItem",
  'role="tablist"',
  'role="tabpanel"',
  'className="workspace-tab',
  "TooltipProvider",
  "TooltipTrigger asChild",
  "TooltipContent",
  "Dialog open={signedSavePrompt !== undefined}",
  "DialogTitle>Signed JAR warning",
  "Do not ask again for this file this session",
]) {
  if (!frontend.includes(marker)) {
    failures.push(`frontend: missing shadcn composition marker ${marker}`);
  }
}

if (
  !app.includes('const [activeTab, setActiveTab] = useState<WorkspaceTab>("tree");') ||
  !app.includes('type WorkspaceTab = "tree" | "diff";')
) {
  failures.push("src/App.tsx: tree and diff must live on separate workspace tabs via activeTab state");
}
if (!app.includes('setActiveTab("diff")')) {
  failures.push("src/App.tsx: opening an entry must switch the workspace to the Diff tab");
}
if (!app.includes('setActiveTab("tree")')) {
  failures.push("src/App.tsx: opening an archive must reset the workspace to the Files tab");
}

if (app.includes("interface ContextMenuState") || app.includes('className="context-menu"')) {
  failures.push("src/App.tsx: tree row context menu must use shadcn ContextMenu instead of custom overlay state");
}

if (app.includes("window.confirm(")) {
  failures.push("src/App.tsx: signed save confirmation must use shadcn Dialog instead of window.confirm");
}

const saveBody = app.match(/async function save\(targetSide: Side, signedConfirmed = false\) {([\s\S]*?)\n  function confirmSignedSave/)?.[1] ?? "";
if (
  !saveBody.includes("signed && !signedConfirmed && !signedWarningSuppressions[signedPath]") ||
  !saveBody.includes("setSignedSavePrompt(targetSide);") ||
  !saveBody.includes("confirmSigned: signed")
) {
  failures.push("src/App.tsx: signed save must pause for controlled Dialog confirmation before commit");
}

const signedConfirmBody = app.match(/function confirmSignedSave\(\) {([\s\S]*?)\n  async function clearStaged/)?.[1] ?? "";
if (
  !signedConfirmBody.includes("setSignedWarningSuppressions") ||
  !signedConfirmBody.includes("setSignedSavePrompt(undefined);") ||
  !signedConfirmBody.includes("void save(targetSide, true);")
) {
  failures.push("src/App.tsx: signed save Dialog must support session suppression and resume confirmed save");
}

if (!app.includes('function isTauriRuntime()') || !app.includes('"__TAURI_INTERNALS__" in window')) {
  failures.push("src/App.tsx: browser/dev preview must detect whether Tauri internals exist");
}

const dropHelper =
  /function\s+dropSideForPosition\s*\(\s*mode:\s*Mode,\s*x:\s*number,\s*width:\s*number\s*\):\s*Side\s*{[\s\S]*?if\s*\(\s*mode\s*===\s*"single"\s*\)\s*return\s*"left";[\s\S]*?x\s*<\s*width\s*\/\s*2\s*\?\s*"left"\s*:\s*"right";[\s\S]*?}/;
if (!dropHelper.test(app)) {
  failures.push("src/App.tsx: file-drop side selection must force Single mode drops to left");
}

if (!app.includes("dropSideForPosition(mode, event.payload.position.x, window.innerWidth)")) {
  failures.push("src/App.tsx: drag/drop handler must use dropSideForPosition");
}

const dragDropEffectBody = app.match(/useEffect\(\(\) => {\n    if \(!isTauriRuntime\(\)\) return;([\s\S]*?)\n  }, \[mode, openPath\]\);/)?.[1] ?? "";
if (!dragDropEffectBody.includes("getCurrentWindow()") || !dragDropEffectBody.includes(".onDragDropEvent(")) {
  failures.push("src/App.tsx: drag/drop effect must be guarded for non-Tauri browser preview");
}

if (!app.includes("}, [mode, openPath]);")) {
  failures.push("src/App.tsx: drag/drop effect must refresh when mode changes");
}

if (
  !app.includes('invoke<PlatformHints>("platform_hints")') ||
  !app.includes("setDropHint(hints.dropHint ?? \"\")") ||
  !app.includes('className="platform-hint"')
) {
  failures.push("src/App.tsx: Linux Wayland sessions must surface a subtle Browse/path-input drop fallback hint");
}

const closeEffectBody = app.match(/useEffect\(\(\) => {\n    if \(!stagedTarget \|\| !isTauriRuntime\(\)\) return;([\s\S]*?)\n  }, \[stagedTarget\]\);/)?.[1] ?? "";
if (!closeEffectBody.includes("getCurrentWindow()") || !closeEffectBody.includes(".onCloseRequested(")) {
  failures.push("src/App.tsx: close-request effect must be guarded for non-Tauri browser preview");
}

const openPathBody = app.match(/const openPath = useCallback\(async \(side: Side, path: string\) => {([\s\S]*?)\n  }, \[refreshDiff\]\);/)?.[1] ?? "";
if (!openPathBody.includes("previewRequestId.current += 1;")) {
  failures.push("src/App.tsx: archive open must invalidate pending preview requests");
}
if (!openPathBody.includes("searchStreamId.current += 1;")) {
  failures.push("src/App.tsx: archive open must invalidate pending search events");
}
if (!openPathBody.includes("setSearching(false);")) {
  failures.push("src/App.tsx: archive open must clear deep-search busy state");
}
for (const marker of [
  "setSelected(undefined);",
  "setPreview({});",
  "setSearchPaths(undefined);",
  "setSearchResults([]);",
]) {
  if (!openPathBody.includes(marker)) {
    failures.push(`src/App.tsx: successful archive open must clear stale view state with ${marker}`);
  }
}

const inspectBody = app.match(/async function inspect\(pair: ComparePair\) {([\s\S]*?)\n  async function showBytecode/)?.[1] ?? "";
if (
  !inspectBody.includes("const requestId = previewRequestId.current + 1;") ||
  !inspectBody.includes("previewRequestId.current = requestId;") ||
  !inspectBody.includes("if (previewRequestId.current !== requestId) return;")
) {
  failures.push("src/App.tsx: source preview must ignore stale async inspect results");
}

const bytecodeBody = app.match(/async function showBytecode\(\) {([\s\S]*?)\n  async function changeEngine/)?.[1] ?? "";
if (
  !bytecodeBody.includes("const pair = selected;") ||
  !bytecodeBody.includes("const requestId = previewRequestId.current + 1;") ||
  !bytecodeBody.includes("previewRequestId.current = requestId;") ||
  !bytecodeBody.includes("if (previewRequestId.current !== requestId) return;")
) {
  failures.push("src/App.tsx: bytecode preview must ignore stale async disassemble results");
}

const searchSidesBody = app.match(/function searchSides\(\): Side\[] {([\s\S]*?)\n  }/)?.[1] ?? "";
if (!searchSidesBody.includes('if (mode === "single") return ["left"];')) {
  failures.push("src/App.tsx: Single mode search must only target the visible left archive");
}

const searchListenerBody = app.match(/listen<\{ searchId: number; completed: number; total: number; entryPath: string \}>\("search-progress"([\s\S]*?)\n    return \(\) =>/)?.[1] ?? "";
if (
  !searchListenerBody.includes("event.payload.searchId !== searchStreamId.current") ||
  !searchListenerBody.includes('listen<{ searchId: number; side: Side; hit: SearchHit }>("search-result"')
) {
  failures.push("src/App.tsx: streamed deep-search events must ignore stale search ids");
}
if (!app.includes('useEffect(() => {\n    if (!isTauriRuntime()) return;\n    let unlistenProgress')) {
  failures.push("src/App.tsx: streamed deep-search listener effect must be guarded for browser preview");
}

const deepSearchBody = app.match(/async function runDeepSearch\(\) {([\s\S]*?)\n  async function cancelDeepSearch/)?.[1] ?? "";
if (
  !deepSearchBody.includes("const searchId = searchStreamId.current + 1;") ||
  !deepSearchBody.includes("searchStreamId.current = searchId;") ||
  !deepSearchBody.includes("deep_search\", { side, query, searchId }") ||
  !deepSearchBody.includes("if (searchStreamId.current !== searchId) return;")
) {
  failures.push("src/App.tsx: deep search requests and completions must be guarded by search id");
}

const runSearchBody = app.match(/async function runSearch\(\) {([\s\S]*?)\n  async function runDeepSearch/)?.[1] ?? "";
if (
  !runSearchBody.includes("const searchId = searchStreamId.current + 1;") ||
  !runSearchBody.includes("searchStreamId.current = searchId;") ||
  !runSearchBody.includes("setSearching(false);") ||
  !runSearchBody.includes("if (searchStreamId.current !== searchId) return;")
) {
  failures.push("src/App.tsx: T2 search must ignore stale completions and clear busy state");
}

const cancelSearchBody = app.match(/async function cancelDeepSearch\(\) {([\s\S]*?)\n  function searchSides/)?.[1] ?? "";
if (
  !cancelSearchBody.includes("searchStreamId.current += 1;") ||
  !cancelSearchBody.includes("setSearching(false);") ||
  !cancelSearchBody.includes('await invoke("cancel_deep_search");')
) {
  failures.push("src/App.tsx: cancel deep search must invalidate events and clear busy state");
}

const clearSearchBody = app.match(/function clearSearch\(\) {([\s\S]*?)\n  function inspectSearchResult/)?.[1] ?? "";
if (
  !clearSearchBody.includes("searchStreamId.current += 1;") ||
  !clearSearchBody.includes("setSearching(false);")
) {
  failures.push("src/App.tsx: clear search must invalidate events and clear busy state");
}

if (!app.includes("function pairPassesTreeFilter(pair: ComparePair, filter: TreeFilter)")) {
  failures.push("src/App.tsx: tree filter logic must be shared with search-result navigation");
}

const visiblePairsBody = app.match(/const visiblePairs = useMemo\(([\s\S]*?)\n  \);/)?.[1] ?? "";
if (!visiblePairsBody.includes("pairPassesTreeFilter(pair, treeFilter)")) {
  failures.push("src/App.tsx: visible pairs must use the shared tree-filter predicate");
}

const inspectSearchResultBody = app.match(/function inspectSearchResult\(result: SearchResult\) {([\s\S]*?)\n  }/)?.[1] ?? "";
if (
  !inspectSearchResultBody.includes("setSelectedSearchResult(result);") ||
  !inspectSearchResultBody.includes("if (!pairPassesTreeFilter(pair, treeFilter)) setTreeFilter(\"all\");") ||
  !inspectSearchResultBody.includes("void inspect(pair);")
) {
  failures.push("src/App.tsx: search-result click must reveal hidden rows before selecting them");
}

if (
  !app.includes("function applySearchLineHighlight(") ||
  !app.includes("className: \"search-line-highlight\"") ||
  !app.includes("editor.revealLineInCenter(lineNumber);") ||
  !app.includes("const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResult>();")
) {
  failures.push("src/App.tsx: search-result line matches must be highlighted in Monaco");
}

if (
  !app.includes("diffEditorRef.current = editor;") ||
  !app.includes("editorRef.current = editor;") ||
  !app.includes("activeSearchResult?.side === \"left\"") ||
  !app.includes("activeSearchResult?.side === \"right\"")
) {
  failures.push("src/App.tsx: search-result line highlighting must target the selected editor side");
}

if (!frontend.includes('disabled={mode === "single"}')) {
  failures.push("frontend: search scope selector must be disabled in Single mode");
}

const copyActionGuards = frontend.match(/mode === "single"/g)?.length ?? 0;
if (copyActionGuards < 5) {
  failures.push("frontend: Single mode must disable search scope and all merge copy actions");
}

if (!frontend.includes('disabled={mode === "single"}')) {
  failures.push('frontend: Save staged control must be disabled in Single mode');
}
if (!/aria-label=\{`Save to archive/.test(frontend) || !/onSave\(stagedTarget\)/.test(frontend)) {
  failures.push('frontend: Save-to-archive control must carry an aria-label and trigger save for the staged target');
}

if (!frontend.includes('{mode === "compare" &&') || !frontend.includes('Keep one overwritten .bak on save')) {
  failures.push('frontend: backup-on-save toggle must render only in Compare mode');
}

const changeModeBody = app.match(/function changeMode\(next: Mode\) {([\s\S]*?)\n  }/)?.[1] ?? "";
if (
  !changeModeBody.includes('next === "single" && stagedTarget') ||
  !changeModeBody.includes("Save or clear staged copies before switching to Single mode.") ||
  !changeModeBody.includes("diffEditorRef.current?.setModel(null);") ||
  !changeModeBody.includes("setMode(next);")
) {
  failures.push("src/App.tsx: dirty staged changes must block switching to Single mode and reset Monaco DiffEditor before unmount");
}

if (!frontend.includes('onValueChange={(value) => onChangeMode(value as Mode)}') &&
    !frontend.includes('onValueChange={(value) => changeMode(value as Mode)}')) {
  failures.push('frontend: mode selector must use guarded changeMode');
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`frontend invariant failed: ${failure}`);
  }
  process.exit(1);
}

console.log("frontend invariants passed");
