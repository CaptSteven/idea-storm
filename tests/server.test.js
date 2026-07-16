import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSopServer, MAX_BODY_BYTES } from "../server.js";

const sample = {
  schemaVersion: 2,
  meta: {
    title: "退款处理",
    audience: "客服",
    version: "v1.0",
    sourceUrl: "https://example.com/orders?token=secret#detail",
  },
  steps: [{
    sourceStepId: "step-1",
    kind: "click",
    title: "打开订单",
    description: "点击订单。",
    check: "确认详情页打开。",
    url: "https://example.com/orders/42?token=secret",
  }],
};

let server;
let baseUrl;

before(async () => {
  server = createSopServer({ aiMock: true, aiApiKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("health reports schema and mock mode", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    schemaVersion: 2,
    model: "gpt-4.1-mini",
    mock: true,
    keyConfigured: false,
  });
});

test("mock generation preserves source step IDs and strips URL secrets", async () => {
  const response = await fetch(`${baseUrl}/api/generate-sop`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "chrome-extension://test-extension" },
    body: JSON.stringify(sample),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "chrome-extension://test-extension");
  const data = await response.json();
  assert.equal(data.sop.steps[0].sourceStepId, "step-1");
  assert.doesNotMatch(JSON.stringify(data), /token=secret/);
});

test("invalid origins and malformed payloads return structured errors", async () => {
  const forbidden = await fetch(`${baseUrl}/api/generate-sop`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify(sample),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "origin_not_allowed");

  const invalid = await fetch(`${baseUrl}/api/generate-sop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_json");
});

test("oversized bodies receive a 413 response", async () => {
  const response = await fetch(`${baseUrl}/api/generate-sop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "x".repeat(MAX_BODY_BYTES + 1),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "body_too_large");
});

test("AI timeouts and upstream failures do not expose provider bodies", async (t) => {
  await t.test("timeout", async () => {
    const timeoutServer = createSopServer({
      aiApiKey: "test-key",
      timeoutMs: 20,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    });
    await new Promise((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${timeoutServer.address().port}`;
    const response = await fetch(`${url}/api/generate-sop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
    });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, "ai_timeout");
    await new Promise((resolve) => timeoutServer.close(resolve));
  });

  await t.test("upstream body is hidden", async () => {
    const upstreamServer = createSopServer({
      aiApiKey: "test-key",
      fetchImpl: async () => new Response("provider-internal-secret", { status: 500 }),
    });
    await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${upstreamServer.address().port}`;
    const response = await fetch(`${url}/api/generate-sop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
    });
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.doesNotMatch(body, /provider-internal-secret/);
    await new Promise((resolve) => upstreamServer.close(resolve));
  });
});
