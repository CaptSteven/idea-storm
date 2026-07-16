import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createDemoServer } from "../scripts/serve-demo.js";
import { createSopServer } from "../server.js";

const root = resolve(new URL("../", import.meta.url).pathname);
const extensionPath = join(root, "extension");
const resultsDir = join(root, "test-results");
await mkdir(resultsDir, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "sopflow-playwright-"));
const downloadDir = await mkdtemp(join(tmpdir(), "sopflow-downloads-"));
const demoServer = createDemoServer();
const aiServer = createSopServer({ aiMock: true, aiApiKey: "" });

const listen = (server) => new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const close = (server) => new Promise((resolveClose) => server.close(resolveClose));

let context;
try {
  await Promise.all([listen(demoServer), listen(aiServer)]);
  const demoUrl = `http://127.0.0.1:${demoServer.address().port}`;
  const aiUrl = `http://127.0.0.1:${aiServer.address().port}`;

  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
    downloadsPath: downloadDir,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(serviceWorker.url()).host;

  const target = await context.newPage();
  await target.goto(`${demoUrl}/tests/fixtures/recording.html?customer=secret#start`);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await target.bringToFront();
  await popup.reload();
  await popup.locator("#screenshotsEnabled").uncheck();
  await popup.locator("#startButton").click();
  await assertEventually(async () => (await popup.locator("#statusLabel").textContent())?.includes("正在记录"));

  await target.locator("#orderPassword").fill("super-secret-value");
  await target.locator("#orderPassword").press("Tab");
  await target.locator("#openOrder").click();
  await target.locator("#result").getByText("订单已打开").waitFor();
  await target.waitForTimeout(900);

  const dashboardPromise = context.waitForEvent("page");
  await popup.locator("#stopButton").click();
  const dashboard = await dashboardPromise;
  await dashboard.waitForLoadState("domcontentloaded");
  await dashboard.locator("#editorWorkspace").waitFor({ state: "visible" });

  const storedSessions = await dashboard.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: "SOPFLOW_LIST_SESSIONS" });
    return response.sessions;
  });
  const serialized = JSON.stringify(storedSessions);
  assert.doesNotMatch(serialized, /super-secret-value|customer=secret|order=42|#start|#details/);
  assert.match(serialized, /\[已脱敏\]/);

  await dashboard.locator("#titleInput").fill("客服退款处理 SOP");
  await dashboard.locator("#backendUrlInput").fill(aiUrl);
  await dashboard.locator("#backendUrlInput").press("Tab");
  await dashboard.locator("#aiButton").click();
  await dashboard.locator("#aiStatus.success").waitFor();
  assert.match(await dashboard.locator("#sopOutput").textContent(), /客服退款处理 SOP/);
  assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await dashboard.screenshot({ path: join(resultsDir, "extension-dashboard-desktop.png"), fullPage: true });

  const jsonDownloadPromise = dashboard.waitForEvent("download");
  await dashboard.locator("#downloadJson").click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = join(downloadDir, "sopflow-export.json");
  await jsonDownload.saveAs(jsonPath);
  const exported = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(exported.schemaVersion, 2);
  assert.ok(exported.session.steps.length >= 3);
  assert.doesNotMatch(JSON.stringify(exported), /super-secret-value|customer=secret|order=42/);

  const htmlDownloadPromise = dashboard.waitForEvent("download");
  await dashboard.locator("#downloadHtml").click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlPath = join(downloadDir, "sopflow-export.html");
  await htmlDownload.saveAs(htmlPath);
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /STANDARD OPERATING PROCEDURE/);

  await dashboard.setViewportSize({ width: 390, height: 844 });
  await dashboard.reload({ waitUntil: "domcontentloaded" });
  await dashboard.locator("#editorWorkspace").waitFor({ state: "visible" });
  assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await dashboard.screenshot({ path: join(resultsDir, "extension-dashboard-mobile.png"), fullPage: true });

  console.log(`Extension E2E passed with ${storedSessions[0].steps.length} recorded steps.`);
} finally {
  if (context) await context.close();
  await Promise.allSettled([close(demoServer), close(aiServer)]);
  await Promise.allSettled([
    rm(userDataDir, { recursive: true, force: true }),
    rm(downloadDir, { recursive: true, force: true }),
  ]);
}

async function assertEventually(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.fail(`Condition was not met within ${timeoutMs} ms.`);
}
