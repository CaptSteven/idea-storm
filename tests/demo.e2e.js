import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createDemoServer } from "../scripts/serve-demo.js";

const root = resolve(new URL("../", import.meta.url).pathname);
const resultsDir = join(root, "test-results");
await mkdir(resultsDir, { recursive: true });

const server = createDemoServer();
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chromium", headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#sopOutput img").first().waitFor();
  assert.match(await page.locator("body").innerText(), /客服退款处理 SOP/);
  assert.equal(await page.locator("#sopOutput img").count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0)), true);

  await page.locator("#optimizeButton").click();
  await page.locator("#statusMessage.success").waitFor();
  assert.match(await page.locator("#sopOutput").innerText(), /优化版/);
  await page.locator("#titleInput").fill("退款复核与提交 SOP");
  await page.locator("#titleInput").press("Tab");
  assert.match(await page.locator("#documentTitle").innerText(), /退款复核与提交 SOP/);
  await page.screenshot({ path: join(resultsDir, "demo-desktop.png"), fullPage: true });

  await page.locator("#resetDemo").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator("#sopOutput img").count(), 3);
  await page.screenshot({ path: join(resultsDir, "demo-mobile.png"), fullPage: true });

  assert.deepEqual(errors, []);
  console.log("Demo browser verification passed for desktop and mobile viewports.");
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
