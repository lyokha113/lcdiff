#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import { chromium } from "playwright";

const port = Number(process.env.LDIFF_FRONTEND_RENDER_PORT ?? 5174);
const url = `http://127.0.0.1:${port}`;

async function disableAnimations(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `,
  });
}

async function assertViewportFits(page, width, height, label) {
  await page.setViewportSize({ width, height });
  const metrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  if (metrics.bodyWidth > metrics.viewportWidth + 1) {
    throw new Error(`${label} has horizontal overflow: body=${metrics.bodyWidth}, viewport=${metrics.viewportWidth}`);
  }

  const canvas = page.getByRole("region", { name: "Workspace canvas" });
  await canvas.waitFor({ timeout: 5_000 });
  const box = await canvas.boundingBox();
  if (!box || box.height < 120 || box.y >= height) {
    throw new Error(`${label} hides the workspace canvas at ${width}x${height}`);
  }
}

function waitForServer() {
  const deadline = Date.now() + 20_000;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`frontend server did not start at ${url}`));
        } else {
          setTimeout(poll, 250);
        }
      });
      request.setTimeout(1_000, () => {
        request.destroy();
      });
    };
    poll();
  });
}

const server = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const serverOutput = [];
server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

try {
  await waitForServer();
  var browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const messages = [];
  page.on("console", (message) => {
    if (!["debug", "info"].includes(message.type())) {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error.stack || error.message}`);
  });
  await page.addInitScript(() => {
    const openedAt = Date.now();
    localStorage.setItem("ldiff.history", JSON.stringify([
      { id: "render-1", mode: "compare", paths: ["/fixtures/left.jar", "/fixtures/right.jar"], openedAt },
      { id: "render-2", mode: "single", paths: ["/fixtures/view.jar"], openedAt: openedAt - 60_000 },
      { id: "render-3", mode: "single", paths: ["/fixtures/third.jar"], openedAt: openedAt - 120_000 },
      { id: "render-4", mode: "single", paths: ["/fixtures/fourth.jar"], openedAt: openedAt - 180_000 },
      { id: "render-5", mode: "single", paths: ["/fixtures/fifth.jar"], openedAt: openedAt - 240_000 },
      { id: "render-6", mode: "single", paths: ["/fixtures/sixth.jar"], openedAt: openedAt - 300_000 },
    ]));
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await disableAnimations(page);
  await page.getByRole("main", { name: "Start LDiff" }).waitFor({ timeout: 5_000 });
  await page.locator(".launch-card--recent").waitFor({ timeout: 5_000 });
  if (await page.getByRole("button", { name: /reopen/i }).count() !== 5) {
    throw new Error("startup did not render exactly five collapsed history rows");
  }
  await page.getByRole("button", { name: "View all history" }).click();
  if (await page.getByRole("button", { name: /reopen/i }).count() !== 6) {
    throw new Error("startup history did not expand to the stored list");
  }
  await page.getByRole("button", { name: "Compare two sources" }).click();
  await page.locator("text=Open a JAR, ZIP, or folder on each side.").waitFor({ timeout: 5_000 });
  if (await page.locator(".source-slot__identity").count() !== 0) {
    throw new Error("source rail still renders visual Left/Right identity labels");
  }
  const commandKey = process.platform === "darwin" ? "Meta" : "Control";
  const searchInput = page.getByPlaceholder("Search paths, text, constants");
  await searchInput.waitFor({ state: "detached", timeout: 5_000 });
  await page.keyboard.press(`${commandKey}+F`);
  await searchInput.waitFor({ timeout: 5_000 });
  await page.keyboard.press(`${commandKey}+F`);
  await searchInput.waitFor({ state: "detached", timeout: 5_000 });
  await page.keyboard.press(`${commandKey}+Comma`);
  const preferencesDrawer = page.getByRole("dialog", { name: "Preferences" });
  await preferencesDrawer.waitFor({ timeout: 5_000 });
  const preferencesBody = preferencesDrawer.locator(":scope > .preferences-body");
  await preferencesBody.waitFor({ timeout: 5_000 });
  const preferencesHeaderBox = await preferencesDrawer.locator(":scope > .preferences-header").boundingBox();
  const preferencesBodyBox = await preferencesBody.boundingBox();
  if (!preferencesHeaderBox || !preferencesBodyBox || preferencesHeaderBox.height > 90) {
    throw new Error("preferences header is missing or still vertically stretched");
  }
  if (preferencesBodyBox.y > preferencesHeaderBox.y + preferencesHeaderBox.height + 24) {
    throw new Error("preferences body is separated from its header by an excessive gap");
  }
  await page.keyboard.press(`${commandKey}+Comma`);
  await preferencesDrawer.waitFor({ state: "detached", timeout: 5_000 });
  await page.keyboard.down(commandKey);
  await page.keyboard.press("/");
  await page.keyboard.up(commandKey);
  const shortcutsDialog = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
  await shortcutsDialog.waitFor({ timeout: 5_000 });
  await shortcutsDialog.getByRole("heading", { name: "Keyboard Shortcuts" }).waitFor({ timeout: 5_000 });
  await shortcutsDialog.getByText("Open Left Directory", { exact: true }).waitFor({ timeout: 5_000 });
  await shortcutsDialog.getByText("Open Right File", { exact: true }).waitFor({ timeout: 5_000 });
  const openRightFileRow = shortcutsDialog.locator("li", { hasText: "Open Right File" });
  await openRightFileRow.waitFor({ timeout: 5_000 });
  await openRightFileRow.getByText("Compare only", { exact: true }).waitFor({ timeout: 5_000 });
  await shortcutsDialog.getByText("Open Right Directory", { exact: true }).waitFor({ timeout: 5_000 });
  const openRightDirectoryRow = shortcutsDialog.locator("li", { hasText: "Open Right Directory" });
  await openRightDirectoryRow.waitFor({ timeout: 5_000 });
  await openRightDirectoryRow.getByText("Compare only", { exact: true }).waitFor({ timeout: 5_000 });
  await page.setViewportSize({ width: 720, height: 420 });
  const shortcutsDialogBox = await shortcutsDialog.boundingBox();
  if (!shortcutsDialogBox) {
    throw new Error("keyboard shortcuts dialog did not expose a bounding box at 720x420 viewport");
  }
  if (shortcutsDialogBox.y < 0 || shortcutsDialogBox.y + shortcutsDialogBox.height > 420) {
    throw new Error(
      `keyboard shortcuts dialog overflowed 420px viewport height: y=${shortcutsDialogBox.y}, height=${shortcutsDialogBox.height}, bottom=${shortcutsDialogBox.y + shortcutsDialogBox.height}`,
    );
  }
  await page.keyboard.press("Escape");
  await shortcutsDialog.waitFor({ state: "detached", timeout: 5_000 });
  for (const viewport of [
    { width: 1280, height: 800, label: "desktop" },
    { width: 1024, height: 640, label: "compact desktop" },
    { width: 720, height: 520, label: "narrow compact" },
  ]) {
    await assertViewportFits(page, viewport.width, viewport.height, viewport.label);
  }
  const buttonCount = await page.locator("button").count();
  const bodyText = await page.locator("body").innerText();

  if (messages.length > 0) {
    throw new Error(`browser console/page errors:\n${messages.join("\n")}`);
  }
  if (!bodyText.includes("Open a JAR, ZIP, or folder on each side.")) {
    throw new Error("frontend shell did not render initial open message");
  }
  if (buttonCount < 10) {
    throw new Error(`frontend shell rendered too few buttons: ${buttonCount}`);
  }

  const viewPage = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await viewPage.goto(url, { waitUntil: "domcontentloaded" });
  await disableAnimations(viewPage);
  await viewPage.getByRole("button", { name: "Open one source" }).click();
  await viewPage.getByRole("region", { name: "Workspace canvas" }).waitFor({ timeout: 5_000 });
  if (
    await viewPage.getByRole("group", { name: "Actions into left pane" }).count() !== 0 ||
    await viewPage.getByRole("group", { name: "Actions into right pane" }).count() !== 0
  ) {
    throw new Error("View mode exposes compare-only actions");
  }
  await viewPage.close();

  var mockedPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mockMessages = [];
  mockedPage.on("console", (message) => {
    if (!["debug", "info"].includes(message.type())) {
      mockMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  mockedPage.on("pageerror", (error) => {
    // Monaco throws a benign CancellationError ("Canceled") when its editors are
    // torn down between selections; it is not a real page failure.
    if (error.message === "Canceled" || error.name === "Canceled") return;
    mockMessages.push(`pageerror: ${error.stack || error.message}`);
  });
  await mockedPage.addInitScript(() => {
    const opened = {};
    const searchCalls = [];
    window.__LDIFF_RENDER_SEARCH_CALLS__ = searchCalls;
    const archives = {
      "/fixtures/left.jar": {
        path: "/fixtures/left.jar",
        metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
        entries: [
          { path: "com/example/App.class", kind: "class", uncompressedSize: 64 },
          { path: "com/example/Meta.class", kind: "class", uncompressedSize: 66 },
          { path: "assets/blob.bin", kind: "binary", uncompressedSize: 4 },
          { path: "config.txt", kind: "text", uncompressedSize: 8 },
          { path: "left-only.txt", kind: "text", uncompressedSize: 4 },
        ],
      },
      "/fixtures/right.jar": {
        path: "/fixtures/right.jar",
        metadata: { sourceKind: "archive", signed: true, multiRelease: false, zip64: false },
        entries: [
          { path: "com/example/App.class", kind: "class", uncompressedSize: 65 },
          { path: "com/example/Meta.class", kind: "class", uncompressedSize: 67 },
          { path: "assets/blob.bin", kind: "binary", uncompressedSize: 4 },
          { path: "config.txt", kind: "text", uncompressedSize: 9 },
          { path: "right-only.txt", kind: "text", uncompressedSize: 5 },
        ],
      },
    };
    const pairs = [
      {
        path: "com/example/App.class",
        status: "different",
        left: { path: "com/example/App.class", kind: "class" },
        right: { path: "com/example/App.class", kind: "class" },
      },
      {
        path: "com/example/Meta.class",
        status: "different",
        left: { path: "com/example/Meta.class", kind: "class" },
        right: { path: "com/example/Meta.class", kind: "class" },
      },
      {
        path: "assets/blob.bin",
        status: "different",
        left: { path: "assets/blob.bin", kind: "binary" },
        right: { path: "assets/blob.bin", kind: "binary" },
      },
      {
        path: "config.txt",
        status: "different",
        left: { path: "config.txt", kind: "text" },
        right: { path: "config.txt", kind: "text" },
      },
      {
        path: "left-only.txt",
        status: "onlyLeft",
        left: { path: "left-only.txt", kind: "text" },
      },
      {
        path: "right-only.txt",
        status: "onlyRight",
        right: { path: "right-only.txt", kind: "text" },
      },
    ];
    let nextCallback = 1;
    let commitCount = 0;
    const callbacks = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event, id) => callbacks.delete(id),
    };
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      callbacks,
      transformCallback(callback) {
        const id = nextCallback++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      runCallback(id, payload) {
        callbacks.get(id)?.(payload);
      },
      async invoke(cmd, args) {
        if (cmd === "plugin:event|listen") return nextCallback++;
        if (cmd === "plugin:event|unlisten") return undefined;
        if (cmd === "platform_hints") return {};
        if (cmd === "validate_path") {
          if (args.raw === "/fixtures/not-a-zip.jar") {
            throw new Error("not a valid zip/jar");
          }
          return args.raw;
        }
        if (cmd === "open_archive") {
          opened[args.side] = archives[args.path];
          return archives[args.path];
        }
        if (cmd === "compute_diff") {
          return opened.left && opened.right ? { pairs } : { pairs: [] };
        }
        if (cmd === "read_entry") {
          if (args.entryPath === "assets/blob.bin") {
            return {
              path: args.entryPath,
              kind: "binary",
              language: "plaintext",
              details:
                args.side === "left"
                  ? "Binary · 4 bytes · SHA-256 left-sha · CRC32 11111111"
                  : "Binary · 4 bytes · SHA-256 right-sha · CRC32 22222222",
              content:
                args.side === "left"
                  ? "00000000  de ad be ef\n"
                  : "00000000  fe ed fa ce\n",
            };
          }
          if (args.entryPath.endsWith(".class")) {
            const source =
              args.entryPath === "com/example/Meta.class"
                ? "class MetaSameSource {}"
                : `class ${args.side === "left" ? "Left" : "Right"}App {}`;
            return {
              path: args.entryPath,
              kind: "class",
              language: "java",
              content: source,
            };
          }
          if (args.entryPath.endsWith(".txt")) {
            return {
              path: args.entryPath,
              kind: "text",
              language: "plaintext",
              content: `${args.side} text content for ${args.entryPath}\nneedle line`,
            };
          }
          throw new Error(`unexpected read_entry fixture: ${JSON.stringify(args)}`);
        }
        if (cmd === "disassemble") {
          return `${args.side.toUpperCase()} ASM BYTECODE for ${args.entryPath}`;
        }
        if (cmd === "search") {
          searchCalls.push({
            side: args.side,
            query: args.query,
            options: args.options,
          });
          return args.side === "right" ? [{ entryPath: "right-only.txt", kind: "path" }] : [];
        }
        if (cmd === "stage_copy") return undefined;
        if (cmd === "unstage") return undefined;
        if (cmd === "clear_staged") return undefined;
        if (cmd === "commit_merge") {
          if (args.targetSide !== "right" || args.confirmSigned !== true) {
            throw new Error(`signed save was not confirmed: ${JSON.stringify(args)}`);
          }
          commitCount += 1;
          if (commitCount === 1 && args.backup !== false) {
            throw new Error(`first save should keep backup disabled by default: ${JSON.stringify(args)}`);
          }
          if (commitCount === 2 && args.backup !== true) {
            throw new Error(`second save should pass backup=true after checkbox toggle: ${JSON.stringify(args)}`);
          }
          return {
            rewrittenPath: "/fixtures/right.jar",
            signatureInvalidated: true,
            copiedEntries: commitCount,
          };
        }
        if (cmd === "prefetch_siblings") return undefined;
        throw new Error(`unexpected mock command: ${cmd}`);
      },
    };
  });
  await mockedPage.goto(url, { waitUntil: "domcontentloaded" });
  await disableAnimations(mockedPage);
  await mockedPage.getByRole("main", { name: "Start LDiff" }).waitFor({ timeout: 5_000 });
  await mockedPage.getByRole("button", { name: "Compare two sources" }).click();

  // Helpers for the new chip-based source UI. The path Input only renders while
  // the chip's Popover is open, so open the chip, act, then close (Escape).
  const archiveInput = () => mockedPage.getByPlaceholder("~/path/to/archive.jar or folder");
  const leftSourceTrigger = mockedPage.getByRole("button", { name: "Change left source", exact: true });
  const rightSourceTrigger = mockedPage.getByRole("button", { name: "Change right source", exact: true });
  async function openLeftPopover() {
    await leftSourceTrigger.click();
    await archiveInput().waitFor({ timeout: 5_000 });
  }
  async function openRightPopover() {
    await rightSourceTrigger.click();
    await archiveInput().waitFor({ timeout: 5_000 });
  }
  async function closePopover(trigger) {
    await mockedPage.keyboard.press("Escape");
    await mockedPage.waitForFunction(
      (element) => element.getAttribute("aria-expanded") === "false",
      await trigger.elementHandle(),
      { timeout: 5_000 },
    );
    await archiveInput().waitFor({ state: "detached", timeout: 5_000 });
  }

  // Tree and diff now live on separate workspace tabs; opening an entry switches
  // to the Diff tab and hides the tree, so return to the Files tab before any
  // tree-row interaction.
  async function showFilesTab() {
    await mockedPage.getByRole("tab", { name: /Files/ }).click();
    if (await mockedPage.getByRole("group", { name: "Diff view mode" }).count()) {
      throw new Error("Files tab still rendered the Source/Bytecode switch");
    }
  }

  // Bad-path error shows inside the open left Popover as <small class="path-error">.
  await openLeftPopover();
  await archiveInput().fill("/fixtures/not-a-zip.jar");
  await archiveInput().press("Enter");
  await mockedPage.locator("small.path-error", { hasText: "not a valid zip/jar" }).waitFor({ timeout: 5_000 });
  // Recover: fixing the path detaches the error.
  await archiveInput().fill("/fixtures/left.jar");
  await archiveInput().press("Enter");
  await mockedPage.locator("small.path-error", { hasText: "not a valid zip/jar" }).waitFor({ state: "detached", timeout: 5_000 });
  await closePopover(leftSourceTrigger);

  // Open the right side.
  await openRightPopover();
  await archiveInput().fill("/fixtures/right.jar");
  await archiveInput().press("Enter");
  await closePopover(rightSourceTrigger);

  // Tree filter in the workspace tab strip: Identical hides non-identical rows.
  await mockedPage.getByRole("combobox", { name: "Tree filter" }).click();
  await mockedPage.getByRole("option", { name: "Identical" }).click();
  await mockedPage.locator(".tree-file", { hasText: "right-only.txt" }).waitFor({ state: "detached", timeout: 5_000 });
  if (await mockedPage.locator(".tree-file", { hasText: "left-only.txt" }).count()) {
    throw new Error("Identical filter still showed left-only row");
  }
  // Restore the differences view for the subsequent search assertions.
  await mockedPage.getByRole("combobox", { name: "Tree filter" }).click();
  await mockedPage.getByRole("option", { name: "Differences" }).click();

  // Submit via the SearchBar Search button (MenuBar toggle is now "Toggle search").
  await mockedPage.getByRole("button", { name: "Toggle search" }).click();
  await mockedPage.getByPlaceholder("Search paths, text, constants").fill("right-only");
  await mockedPage.getByRole("button", { name: "Search files" }).waitFor({ timeout: 5_000 });
  await mockedPage.getByRole("button", { name: "Search files", exact: true }).click();
  await mockedPage.locator("text=Search matched 1 entries.").waitFor({ timeout: 5_000 });
  const searchCalls = await mockedPage.evaluate(() => window.__LDIFF_RENDER_SEARCH_CALLS__);
  const expectedSearchOptions = { includePath: true, includeText: true, includeConstants: true };
  for (const side of ["left", "right"]) {
    const call = searchCalls.find((candidate) => candidate.side === side);
    if (!call) {
      throw new Error(`Search files did not search ${side}: ${JSON.stringify(searchCalls)}`);
    }
    if (call.query !== "right-only" || JSON.stringify(call.options) !== JSON.stringify(expectedSearchOptions)) {
      throw new Error(`Unexpected ${side} search call: ${JSON.stringify(call)}`);
    }
  }
  await mockedPage.locator(".search-result-row", { hasText: "right-only.txt" }).click();
  await mockedPage.locator("text=right text content for right-only.txt").waitFor({ timeout: 5_000 });

  await showFilesTab();
  await mockedPage.getByRole("combobox", { name: "Tree filter" }).click();
  await mockedPage.getByRole("option", { name: "Differences" }).click();
  await mockedPage.getByRole("button", { name: "Toggle search" }).click();
  await mockedPage.getByText("Clear results", { exact: true }).waitFor({ timeout: 5_000 });
  await mockedPage.getByRole("button", { name: "Clear results" }).click();

  // Metadata-only detection: identical decompiled source -> differentMetadataOnly badge.
  await showFilesTab();
  const metadataRow = mockedPage.locator(".tree-file", { hasText: "Meta.class" });
  await metadataRow.waitFor({ timeout: 5_000 });
  await metadataRow.click({ force: true });
  await mockedPage.locator("text=class MetaSameSource").first().waitFor({ timeout: 10_000 });
  await showFilesTab();
  await mockedPage.locator(".tree-file.differentMetadataOnly", { hasText: "Meta.class" }).waitFor({ timeout: 10_000 });

  await showFilesTab();
  const configRow = mockedPage.locator(".tree-file", { hasText: "config.txt" });
  await configRow.waitFor({ timeout: 5_000 });
  await configRow.click();
  const appRow = mockedPage.locator(".tree-file", { hasText: "App.class" });
  const leftPaneActions = mockedPage.getByRole("group", { name: "Actions into left pane" });
  const rightPaneActions = mockedPage.getByRole("group", { name: "Actions into right pane" });
  await leftPaneActions.waitFor({ timeout: 5_000 });
  await rightPaneActions.waitFor({ timeout: 5_000 });
  const leftActionLabels = await leftPaneActions.getByRole("button").allTextContents();
  const rightActionLabels = await rightPaneActions.getByRole("button").allTextContents();
  if (JSON.stringify(leftActionLabels) !== JSON.stringify(["Copy file ←", "Take all ←", "Move hunk ←"])) {
    throw new Error(`Unexpected left-pane action order: ${JSON.stringify(leftActionLabels)}`);
  }
  if (JSON.stringify(rightActionLabels) !== JSON.stringify(["Move hunk →", "Take all →", "Copy file →"])) {
    throw new Error(`Unexpected right-pane action order: ${JSON.stringify(rightActionLabels)}`);
  }
  await mockedPage.getByRole("group", { name: "Diff view mode" }).waitFor({ timeout: 5_000 });
  const populatedCompareText = await mockedPage.locator("body").innerText();
  if (populatedCompareText.includes("Left Target") || populatedCompareText.includes("Right Target")) {
    throw new Error("Diff toolbar rendered obsolete target labels");
  }

  // Compact-width regression: a populated Diff keeps a usable tab-scroll lane
  // beside the fixed Source/Bytecode switch instead of collapsing to zero.
  await assertViewportFits(mockedPage, 720, 520, "populated compact diff");
  const compactTabScroll = mockedPage.locator(".workspace-tabs-scroll");
  const compactViewSwitch = mockedPage.getByRole("group", { name: "Diff view mode" });
  const [tabScrollBox, viewSwitchBox, tabScrollMinWidth] = await Promise.all([
    compactTabScroll.boundingBox(),
    compactViewSwitch.boundingBox(),
    compactTabScroll.evaluate((element) => getComputedStyle(element).minWidth),
  ]);
  if (tabScrollMinWidth !== "48px") {
    throw new Error(`Compact Diff tab scroll minimum is ${tabScrollMinWidth}; expected 48px`);
  }
  if (!tabScrollBox || tabScrollBox.width < 48) {
    throw new Error(`Compact Diff tab scroll collapsed: ${JSON.stringify(tabScrollBox)}`);
  }
  if (!viewSwitchBox || viewSwitchBox.width <= 0) {
    throw new Error("Compact Diff view switch is not visible");
  }
  const verticalOverlap = Math.min(
    tabScrollBox.y + tabScrollBox.height,
    viewSwitchBox.y + viewSwitchBox.height,
  ) - Math.max(tabScrollBox.y, viewSwitchBox.y);
  if (verticalOverlap <= 0) {
    throw new Error("Compact Diff tab scroll and view switch do not coexist in the same strip");
  }
  const geometryTolerance = 1;
  const tabScrollRight = tabScrollBox.x + tabScrollBox.width;
  if (tabScrollRight > viewSwitchBox.x + geometryTolerance) {
    throw new Error(
      `Compact Diff tab scroll overlays view switch: tabsRight=${tabScrollRight}, switchLeft=${viewSwitchBox.x}`,
    );
  }

  const mergeActions = mockedPage.locator(".merge-actions");
  const [mergeActionsBox, leftPaneActionsBox, rightPaneActionsBox] = await Promise.all([
    mergeActions.boundingBox(),
    leftPaneActions.boundingBox(),
    rightPaneActions.boundingBox(),
  ]);
  if (!mergeActionsBox || !leftPaneActionsBox || !rightPaneActionsBox) {
    throw new Error("Compact Diff pane-action geometry is unavailable");
  }
  const mergeLeft = mergeActionsBox.x;
  const mergeRight = mergeActionsBox.x + mergeActionsBox.width;
  const mergeMidpoint = mergeActionsBox.x + mergeActionsBox.width / 2;
  const leftActionsRight = leftPaneActionsBox.x + leftPaneActionsBox.width;
  const rightActionsRight = rightPaneActionsBox.x + rightPaneActionsBox.width;
  if (
    leftPaneActionsBox.x < mergeLeft - geometryTolerance ||
    leftActionsRight > mergeMidpoint + geometryTolerance
  ) {
    throw new Error(
      `Compact left-pane actions crossed their half: group=${JSON.stringify(leftPaneActionsBox)}, midpoint=${mergeMidpoint}`,
    );
  }
  if (
    rightPaneActionsBox.x < mergeMidpoint - geometryTolerance ||
    rightActionsRight > mergeRight + geometryTolerance
  ) {
    throw new Error(
      `Compact right-pane actions crossed their half: group=${JSON.stringify(rightPaneActionsBox)}, midpoint=${mergeMidpoint}`,
    );
  }
  await mockedPage.setViewportSize({ width: 1280, height: 720 });

  await showFilesTab();
  await appRow.waitFor({ timeout: 5_000 });
  await appRow.click();

  // Bytecode view (LEFT/RIGHT ASM) then source view (LeftApp/RightApp).
  await mockedPage.getByRole("button", { name: "Show bytecode", exact: true }).click();
  await mockedPage.locator("text=LEFT ASM BYTECODE for com/example/App.class").waitFor({ timeout: 5_000 });
  await mockedPage.locator("text=RIGHT ASM BYTECODE for com/example/App.class").waitFor({ timeout: 5_000 });
  await mockedPage.getByRole("button", { name: "Show source", exact: true }).click();
  await mockedPage.locator("text=class LeftApp").waitFor({ timeout: 5_000 });
  await mockedPage.locator("text=class RightApp").waitFor({ timeout: 5_000 });

  // Copy-to-right staging: MenuBar badge "1 → right" + row badge "pending → right".
  const copyRightButton = mockedPage.getByRole("button", { name: "Copy file to right", exact: true });
  await copyRightButton.waitFor({ timeout: 5_000 });
  await copyRightButton.click();
  await mockedPage.locator(".command-bar").locator("text=→ right").waitFor({ timeout: 10_000 });
  await showFilesTab();
  await mockedPage.locator("text=copy → right").waitFor({ timeout: 10_000 });

  // Unstage via context menu: badges disappear.
  await showFilesTab();
  await appRow.click({ button: "right" });
  const unstageMenuItem = mockedPage.getByRole("menuitem", { name: "Unstage" });
  await unstageMenuItem.waitFor({ timeout: 5_000 });
  await unstageMenuItem.evaluate((element) => element.click());
  await mockedPage.locator("text=Unstaged com/example/App.class.").waitFor({ timeout: 5_000 });
  if (await mockedPage.locator(".command-bar").locator("text=→ right").count()) {
    throw new Error("MenuBar staged badge still present after unstage");
  }
  await mockedPage.locator("text=copy → right").waitFor({ state: "detached", timeout: 5_000 });

  // Re-stage. The copy button is enabled only once the pair is selected, so a
  // plain (non-forced) click auto-waits for that precondition.
  await showFilesTab();
  await appRow.click();
  await copyRightButton.click();
  await mockedPage.locator(".command-bar").locator("text=→ right").waitFor({ timeout: 10_000 });
  await showFilesTab();
  await mockedPage.locator("text=copy → right").waitFor({ timeout: 10_000 });

  // Binary preview details + hex dump.
  await showFilesTab();
  const binaryRow = mockedPage.locator(".tree-file", { hasText: "blob.bin" });
  await binaryRow.click();
  await mockedPage.locator("text=LEFT: Binary · 4 bytes · SHA-256 left-sha · CRC32 11111111").waitFor({ timeout: 5_000 });
  await mockedPage.locator("text=RIGHT: Binary · 4 bytes · SHA-256 right-sha · CRC32 22222222").waitFor({ timeout: 5_000 });
  await mockedPage.locator("text=00000000  de ad be ef").waitFor({ timeout: 5_000 });
  await mockedPage.locator("text=00000000  fe ed fa ce").waitFor({ timeout: 5_000 });

  // Single-mode switch guard: blocked while staged.
  await mockedPage.getByRole("combobox", { name: "Mode" }).click();
  await mockedPage.getByRole("option", { name: "View" }).click();
  await mockedPage.locator("text=Save or clear unsaved changes before switching to Single mode.").waitFor({ timeout: 5_000 });

  // Clear staged (MenuBar icon button): badges gone.
  await mockedPage.getByRole("button", { name: "Clear staged", exact: true }).click();
  await mockedPage.locator("text=Cleared unsaved changes.").waitFor({ timeout: 5_000 });
  if (await mockedPage.locator(".command-bar").locator("text=→ right").count()) {
    throw new Error("MenuBar staged badge still present after clear staged");
  }
  await mockedPage.locator("text=copy → right").waitFor({ state: "detached", timeout: 5_000 });

  // Now the switch to Single succeeds; SourceChips renders only the left chip.
  await mockedPage.getByRole("combobox", { name: "Mode" }).click();
  await mockedPage.getByRole("option", { name: "View" }).click();
  await mockedPage.getByRole("button", { name: "Change left source", exact: true }).waitFor({ timeout: 5_000 });
  if (
    await mockedPage.getByRole("group", { name: "Actions into left pane" }).count() ||
    await mockedPage.getByRole("group", { name: "Actions into right pane" }).count()
  ) {
    throw new Error("Single mode still rendered compare-only actions");
  }
  if (await mockedPage.getByRole("button", { name: "Change right source", exact: true }).count()) {
    throw new Error("Single mode still rendered the right source chip");
  }
  if (await mockedPage.getByRole("combobox", { name: "Tree filter" }).count()) {
    throw new Error("Single mode still rendered the compare-only tree filter");
  }

  // Back to Compare: right chip returns.
  await mockedPage.getByRole("combobox", { name: "Mode" }).click();
  await mockedPage.getByRole("option", { name: "Compare" }).click();
  await mockedPage.getByRole("button", { name: "Change right source", exact: true }).waitFor({ timeout: 5_000 });
  await mockedPage.getByRole("combobox", { name: "Tree filter" }).waitFor({ timeout: 5_000 });

  // Stage + signed-save (backup=false by default).
  const menuBarSaveStaged = mockedPage.getByRole("button", { name: /^Save to archive/ });
  const compareAppRow = mockedPage.locator(".tree-file.different", { hasText: "App.class" });
  // Selecting an entry and waiting for the copy button to enable is the precondition
  // for staging; a save reloads the archive and resets the selection, so re-select
  // and confirm the copy button is enabled before each stage.
  async function selectAppAndStageRight() {
    await showFilesTab();
    await compareAppRow.waitFor({ state: "visible", timeout: 5_000 });
    await compareAppRow.click({ force: true });
    await copyRightButton.click(); // auto-waits for enabled (selection committed)
    await mockedPage.locator(".command-bar").locator("text=→ right").waitFor({ timeout: 10_000 });
  }
  await selectAppAndStageRight();
  // Save via the MenuBar Save staged button (Popovers closed -> single match).
  await menuBarSaveStaged.waitFor({ state: "visible", timeout: 5_000 });
  await menuBarSaveStaged.click();
  await mockedPage.getByRole("heading", { name: "Signed JAR warning" }).waitFor({ timeout: 5_000 });
  await mockedPage.locator("text=Modifying it will invalidate the signature").waitFor({ timeout: 5_000 });
  const suppressSignedWarningCheckbox = mockedPage.getByLabel("Do not ask again for this file this session");
  await suppressSignedWarningCheckbox.waitFor({ timeout: 5_000 });
  await suppressSignedWarningCheckbox.evaluate((element) => element.click());
  await mockedPage.getByRole("button", { name: "Save anyway" }).click();
  await mockedPage.locator("text=Saved 1 entries to /fixtures/right.jar (signed archive is now invalid)").waitFor({ timeout: 5_000 });
  // The signed-save Dialog leaves the page briefly inert while Radix tears it down;
  // wait for it to fully detach before interacting with the tree again.
  await mockedPage.getByRole("heading", { name: "Signed JAR warning" }).waitFor({ state: "detached", timeout: 5_000 });

  // Re-stage + toggle backup in Preferences > Save + save (backup=true,
  // no second signed prompt thanks to session suppression).
  await selectAppAndStageRight();
  await mockedPage.getByRole("button", { name: "Preferences", exact: true }).click();
  await mockedPage.getByRole("button", { name: "Save", exact: true }).click();
  const backupCheckbox = mockedPage.getByLabel("Keep one overwritten .bak on save");
  await backupCheckbox.waitFor({ timeout: 5_000 });
  await backupCheckbox.evaluate((element) => element.click());
  await menuBarSaveStaged.waitFor({ state: "visible", timeout: 5_000 });
  await menuBarSaveStaged.click();
  await mockedPage.locator("text=Saved 2 entries to /fixtures/right.jar (signed archive is now invalid)").waitFor({ timeout: 5_000 });
  if (await mockedPage.getByRole("heading", { name: "Signed JAR warning" }).count()) {
    throw new Error("signed warning Dialog reappeared after session suppression");
  }

  if (mockMessages.length > 0) {
    throw new Error(`mocked browser console/page errors:\n${mockMessages.join("\n")}`);
  }
  await browser.close();
  console.log("frontend render passed");
} catch (error) {
  console.error(String(error));
  console.error(serverOutput.join(""));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
}
