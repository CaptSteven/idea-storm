import assert from "node:assert/strict";
import test from "node:test";

await import("../extension/shared.js");
const shared = globalThis.SOPFlowShared;

function element(attributes = {}, properties = {}) {
  return {
    tagName: "INPUT",
    checked: false,
    getAttribute(name) { return attributes[name] ?? null; },
    ...properties,
  };
}

test("sanitizeUrl removes query strings, hashes, and credentials", () => {
  assert.equal(
    shared.sanitizeUrl("https://user:secret@example.com/orders?id=42#payment"),
    "https://example.com/orders",
  );
  assert.equal(shared.sanitizeUrl("not a url"), "");
});

test("local AI backend URLs reject remote hosts", () => {
  assert.equal(shared.normalizeLocalBackendUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(shared.normalizeLocalBackendUrl("http://127.0.0.1:9000/api/?key=secret"), "http://127.0.0.1:9000/api");
  assert.throws(() => shared.normalizeLocalBackendUrl("https://api.example.com"), /本机 HTTP/);
});

test("sensitive field detection uses type, autocomplete, and labels", () => {
  assert.equal(shared.isSensitiveElement(element({ type: "password" })), true);
  assert.equal(shared.isSensitiveElement(element({ autocomplete: "one-time-code" })), true);
  assert.equal(shared.isSensitiveElement(element({ placeholder: "请输入银行卡号" })), true);
  assert.equal(shared.isSensitiveElement(element({ name: "project-title" })), false);
});

test("input descriptions never include raw text values", () => {
  const textInput = element({ type: "text", value: "should-not-leak" }, { value: "should-not-leak" });
  const password = element({ type: "password" }, { value: "secret" });
  assert.equal(shared.describeInputValue(textInput), "[已输入]");
  assert.equal(shared.describeInputValue(password), "[已脱敏]");
  assert.doesNotMatch(shared.describeInputValue(textInput), /should-not-leak/);
});

test("normalizeSession enforces schema v2, URL privacy, and the step cap", () => {
  const session = shared.normalizeSession({
    id: "session-1",
    sourceUrl: "https://example.com/path?token=secret#hash",
    steps: Array.from({ length: 100 }, (_, index) => ({
      id: `step-${index}`,
      url: `https://example.com/path?value=${index}`,
      title: `Step ${index}`,
    })),
  });
  assert.equal(session.schemaVersion, 2);
  assert.equal(session.steps.length, 80);
  assert.equal(session.sourceUrl, "https://example.com/path");
  assert.equal(session.steps[0].url, "https://example.com/path");
  assert.deepEqual(session.steps.map((step) => step.order), Array.from({ length: 80 }, (_, index) => index));
});

test("stripAiResultForChangedSteps removes results for deleted source steps", () => {
  const session = {
    steps: [{ id: "kept" }],
    aiSop: { steps: [{ sourceStepId: "kept" }, { sourceStepId: "deleted" }] },
  };
  assert.deepEqual(shared.stripAiResultForChangedSteps(session).aiSop.steps, [{ sourceStepId: "kept" }]);
});
