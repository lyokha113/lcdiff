import { spawn } from "node:child_process";
import http from "node:http";
import { chromium } from "playwright";

const port = Number(process.env.PORT ?? 5182);
const url = `http://127.0.0.1:${port}`;

function waitForServer() {
  const deadline = Date.now() + 20_000;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, (r) => { r.resume(); resolve(); });
      req.on("error", () => (Date.now() > deadline ? reject(new Error("no server")) : setTimeout(poll, 250)));
      req.setTimeout(1000, () => req.destroy());
    };
    poll();
  });
}

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });

  const mock = () => {
    const archives = {
      "/demo/service-1.4.0.jar": {
        path: "/demo/service-1.4.0.jar",
        metadata: { sourceKind: "archive", signed: true, multiRelease: true, zip64: false },
        entries: [],
      },
      "/demo/service-1.5.0.jar": {
        path: "/demo/service-1.5.0.jar",
        metadata: { sourceKind: "archive", signed: true, multiRelease: false, zip64: false },
        entries: [],
      },
    };
    const opened = {};
    const pairs = [
      { path: "com/acme/gateway/PaymentRouter.class", status: "different", left: { path: "x", kind: "class" }, right: { path: "x", kind: "class" } },
      { path: "com/acme/gateway/RetryPolicy.class", status: "different", left: { path: "x", kind: "class" }, right: { path: "x", kind: "class" } },
      { path: "com/acme/model/Invoice.class", status: "identical", left: { path: "x", kind: "class" }, right: { path: "x", kind: "class" } },
      { path: "com/acme/model/Ledger.class", status: "differentMetadataOnly", left: { path: "x", kind: "class" }, right: { path: "x", kind: "class" } },
      { path: "com/acme/legacy/SoapClient.class", status: "onlyLeft", left: { path: "x", kind: "class" } },
      { path: "com/acme/grpc/StreamHandler.class", status: "onlyRight", right: { path: "x", kind: "class" } },
      { path: "META-INF/MANIFEST.MF", status: "different", left: { path: "x", kind: "text" }, right: { path: "x", kind: "text" } },
      { path: "config/application.yaml", status: "onlyRight", right: { path: "x", kind: "text" } },
    ];
    const left = `package com.acme.gateway;

public final class PaymentRouter {
    private final RetryPolicy retry;

    public Route resolve(Payment payment) {
        if (payment.amount() > THRESHOLD) {
            return Route.MANUAL_REVIEW;
        }
        return retry.guard(() -> dispatch(payment));
    }
}`;
    const right = left.replace("Route.MANUAL_REVIEW", "Route.RISK_QUEUE").replace("THRESHOLD", "HIGH_VALUE_LIMIT");
    let nextCb = 1;
    const callbacks = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_e, id) => callbacks.delete(id) };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      callbacks,
      transformCallback(cb) { const id = nextCb++; callbacks.set(id, cb); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      runCallback(id, p) { callbacks.get(id)?.(p); },
      async invoke(cmd, args) {
        if (cmd === "plugin:event|listen") return nextCb++;
        if (cmd === "plugin:event|unlisten") return undefined;
        if (cmd === "platform_hints") return {};
        if (cmd === "validate_path") return args.raw;
        if (cmd === "open_archive") { opened[args.side] = archives[args.path]; return archives[args.path]; }
        if (cmd === "compute_diff") return opened.left && opened.right ? { pairs } : { pairs: [] };
        if (cmd === "set_engine") return undefined;
        if (cmd === "prefetch_siblings") return undefined;
        if (cmd === "read_entry") return { path: args.entryPath, kind: "class", language: "java", content: args.side === "left" ? left : right };
        throw new Error(`unexpected ${cmd}`);
      },
    };
  };

  // empty state
  const p1 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p1.addInitScript(mock);
  await p1.goto(url, { waitUntil: "domcontentloaded" });
  await p1.locator("h1", { hasText: "LDiff" }).waitFor({ timeout: 8000 });
  await p1.waitForTimeout(500);
  await p1.screenshot({ path: "/tmp/ldiff-empty.png" });

  // loaded compare state
  await p1.getByPlaceholder("~/path/to/archive.jar or folder").nth(0).fill("/demo/service-1.4.0.jar");
  await p1.getByRole("button", { name: "Open" }).nth(0).click();
  await p1.getByPlaceholder("~/path/to/archive.jar or folder").nth(1).fill("/demo/service-1.5.0.jar");
  await p1.getByRole("button", { name: "Open" }).nth(1).click();
  await p1.locator(".tree-row", { hasText: "PaymentRouter.class" }).waitFor({ timeout: 8000 });
  await p1.locator(".tree-row", { hasText: "PaymentRouter.class" }).click();
  await p1.locator("text=class PaymentRouter").first().waitFor({ timeout: 12000 });
  await p1.waitForTimeout(900);
  await p1.screenshot({ path: "/tmp/ldiff-loaded.png" });

  await browser.close();
  console.log("screenshots written");
} finally {
  server.kill("SIGTERM");
}
