#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import { chromium } from "playwright";

const port = Number(process.env.LDIFF_FRONTEND_RENDER_PORT ?? 5174);
const url = `http://127.0.0.1:${port}`;

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
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: "LDiff" }).waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Compare \/ Merge/ }).click();
  await page.locator("text=Open a JAR, ZIP, or folder on each side.").waitFor({ timeout: 5_000 });
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

  var mockedPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mockMessages = [];
  mockedPage.on("console", (message) => {
    if (!["debug", "info"].includes(message.type())) {
      mockMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  mockedPage.on("pageerror", (error) => {
    mockMessages.push(`pageerror: ${error.stack || error.message}`);
  });
  await mockedPage.addInitScript(() => {
    const opened = {};
    const archives = {
      "/fixtures/left.jar": {
        path: "/fixtures/left.jar",
        metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
        entries: [
          { path: "com/example/App.class", kind: "class", uncompressedSize: 64 },
          { path: "com/example/Meta.class", kind: "class", uncompressedSize: 66 },
          { path: "assets/blob.bin", kind: "binary", uncompressedSize: 4 },
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
          return [{ path: "right-only.txt", matchKind: "path" }];
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
  await mockedPage.locator("h1", { hasText: "LDiff" }).waitFor({ timeout: 5_000 });
  await mockedPage.getByRole("button", { name: /Compare \/ Merge/ }).click();

  // Helpers for the new chip-based source UI. The path Input only renders while
  // the chip's Popover is open, so open the chip, act, then close (Escape).
  const archiveInput = () => mockedPage.getByPlaceholder("~/path/to/archive.jar or folder");
  async function openLeftPopover() {
    await mockedPage.getByRole("button", { name: "Change left source", exact: true }).click();
    await archiveInput().waitFor({ timeout: 5_000 });
  }
  async function openRightPopover() {
    await mockedPage.getByRole("button", { name: "Change right source", exact: true }).click();
    await archiveInput().waitFor({ timeout: 5_000 });
  }
  async function closePopover() {
    await mockedPage.keyboard.press("Escape");
    await archiveInput().waitFor({ state: "detached", timeout: 5_000 });
  }

  // Tree and diff now live on separate workspace tabs; opening an entry switches
  // to the Diff tab and hides the tree, so return to the Files tab before any
  // tree-row interaction.
  async function showFilesTab() {
    await mockedPage.getByRole("tab", { name: /Files/ }).click();
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
  await closePopover();

  // Open the right side.
  await openRightPopover();
  await archiveInput().fill("/fixtures/right.jar");
  await archiveInput().press("Enter");
  await closePopover();

  // Tree filter (in the always-visible SearchBar): Only right hides left-only.
  await mockedPage.getByRole("combobox", { name: "Tree filter" }).click();
  await mockedPage.getByRole("option", { name: "Only right" }).click();
  await mockedPage.locator(".tree-file", { hasText: "right-only.txt" }).waitFor({ timeout: 5_000 });
  if (await mockedPage.locator(".tree-file", { hasText: "left-only.txt" }).count()) {
    throw new Error("Only right filter still showed left-only row");
  }

  // Search scope lives in the config drawer (closed by default) — open it.
  await mockedPage.getByRole("button", { name: "Settings", exact: true }).click();
  await mockedPage.getByRole("combobox", { name: "Search scope" }).click();
  await mockedPage.getByRole("option", { name: "Search right" }).click();
  // Submit via the SearchBar Search button (MenuBar toggle is now "Toggle search").
  await mockedPage.getByPlaceholder("Search paths, text, constants").fill("right-only");
  await mockedPage.getByRole("button", { name: "Search", exact: true }).click();
  await mockedPage.locator("text=Search matched 1 entries.").waitFor({ timeout: 5_000 });
  await mockedPage.getByRole("button", { name: "right-only.txt · path · T2 · RIGHT" }).click();
  await mockedPage.locator("text=right text content for right-only.txt").waitFor({ timeout: 5_000 });

  await mockedPage.getByRole("combobox", { name: "Tree filter" }).click();
  await mockedPage.getByRole("option", { name: "Differences only" }).click();
  await mockedPage.getByRole("button", { name: "Clear search" }).click();

  // Metadata-only detection: identical decompiled source -> differentMetadataOnly badge.
  await showFilesTab();
  const metadataRow = mockedPage.locator(".tree-file", { hasText: "Meta.class" });
  await metadataRow.waitFor({ timeout: 5_000 });
  await metadataRow.click({ force: true });
  await mockedPage.locator("text=class MetaSameSource").first().waitFor({ timeout: 10_000 });
  await showFilesTab();
  await mockedPage.locator(".tree-file.differentMetadataOnly", { hasText: "Meta.class" }).waitFor({ timeout: 10_000 });

  await showFilesTab();
  const appRow = mockedPage.locator(".tree-file", { hasText: "App.class" });
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
  const copyRightButton = mockedPage.getByRole("button", { name: "Copy to right", exact: true });
  await copyRightButton.waitFor({ timeout: 5_000 });
  await copyRightButton.click();
  await mockedPage.locator(".menu-bar").locator("text=→ right").waitFor({ timeout: 10_000 });
  await showFilesTab();
  await mockedPage.locator("text=pending → right").waitFor({ timeout: 10_000 });

  // Unstage via context menu: badges disappear.
  await showFilesTab();
  await appRow.click({ button: "right" });
  const unstageMenuItem = mockedPage.getByRole("menuitem", { name: "Unstage" });
  await unstageMenuItem.waitFor({ timeout: 5_000 });
  await unstageMenuItem.evaluate((element) => element.click());
  await mockedPage.locator("text=Unstaged com/example/App.class.").waitFor({ timeout: 5_000 });
  if (await mockedPage.locator(".menu-bar").locator("text=→ right").count()) {
    throw new Error("MenuBar staged badge still present after unstage");
  }
  await mockedPage.locator("text=pending → right").waitFor({ state: "detached", timeout: 5_000 });

  // Re-stage. The copy button is enabled only once the pair is selected, so a
  // plain (non-forced) click auto-waits for that precondition.
  await showFilesTab();
  await appRow.click();
  await copyRightButton.click();
  await mockedPage.locator(".menu-bar").locator("text=→ right").waitFor({ timeout: 10_000 });
  await showFilesTab();
  await mockedPage.locator("text=pending → right").waitFor({ timeout: 10_000 });

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
  await mockedPage.getByRole("option", { name: "Single" }).click();
  await mockedPage.locator("text=Save or clear staged copies before switching to Single mode.").waitFor({ timeout: 5_000 });

  // Clear staged (MenuBar icon button): badges gone.
  await mockedPage.getByRole("button", { name: "Clear staged", exact: true }).click();
  await mockedPage.locator("text=Cleared staged copies.").waitFor({ timeout: 5_000 });
  if (await mockedPage.locator(".menu-bar").locator("text=→ right").count()) {
    throw new Error("MenuBar staged badge still present after clear staged");
  }
  await mockedPage.locator("text=pending → right").waitFor({ state: "detached", timeout: 5_000 });

  // Now the switch to Single succeeds; SourceChips renders only the left chip.
  await mockedPage.getByRole("combobox", { name: "Mode" }).click();
  await mockedPage.getByRole("option", { name: "Single" }).click();
  await mockedPage.getByRole("button", { name: "Change left source", exact: true }).waitFor({ timeout: 5_000 });
  if (await mockedPage.getByRole("button", { name: "Change right source", exact: true }).count()) {
    throw new Error("Single mode still rendered the right source chip");
  }

  // Back to Compare: right chip returns.
  await mockedPage.getByRole("combobox", { name: "Mode" }).click();
  await mockedPage.getByRole("option", { name: "Compare" }).click();
  await mockedPage.getByRole("button", { name: "Change right source", exact: true }).waitFor({ timeout: 5_000 });

  // Stage + signed-save (backup=false by default).
  const menuBarSaveStaged = mockedPage.getByRole("button", { name: "Save staged", exact: true });
  const compareAppRow = mockedPage.locator(".tree-file.different", { hasText: "App.class" });
  // Selecting an entry and waiting for the copy button to enable is the precondition
  // for staging; a save reloads the archive and resets the selection, so re-select
  // and confirm the copy button is enabled before each stage.
  async function selectAppAndStageRight() {
    await showFilesTab();
    await compareAppRow.waitFor({ state: "visible", timeout: 5_000 });
    await compareAppRow.click({ force: true });
    await copyRightButton.click(); // auto-waits for enabled (selection committed)
    await mockedPage.locator(".menu-bar").locator("text=→ right").waitFor({ timeout: 10_000 });
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

  // Re-stage + toggle backup (in config drawer, still open) + save (backup=true,
  // no second signed prompt thanks to session suppression).
  await selectAppAndStageRight();
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
