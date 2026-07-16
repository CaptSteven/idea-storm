import http from "node:http";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 2;
export const MAX_STEPS = 80;
export const MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 45_000;

export function createSopServer(options = {}) {
  const config = {
    aiBaseUrl: options.aiBaseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1",
    aiModel: options.aiModel || process.env.AI_MODEL || "gpt-4.1-mini",
    aiApiKey: options.aiApiKey ?? process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY ?? "",
    aiMock: options.aiMock ?? process.env.AI_MOCK === "true",
    timeoutMs: Number(options.timeoutMs || process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    fetchImpl: options.fetchImpl || fetch,
  };

  return http.createServer(async (req, res) => {
    const originAllowed = setCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      if (!originAllowed) return sendError(res, 403, "origin_not_allowed", "Origin is not allowed.");
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          schemaVersion: SCHEMA_VERSION,
          model: config.aiModel,
          mock: config.aiMock,
          keyConfigured: Boolean(config.aiApiKey),
        });
      }

      if (req.method === "POST" && url.pathname === "/api/generate-sop") {
        if (!originAllowed) throw httpError(403, "origin_not_allowed", "Origin is not allowed.");
        const payload = await readJson(req);
        const normalizedPayload = validatePayload(payload);
        const sop = config.aiMock
          ? buildMockSop(normalizedPayload)
          : await generateSopWithAi(normalizedPayload, config);
        return sendJson(res, 200, { ok: true, schemaVersion: SCHEMA_VERSION, sop });
      }

      throw httpError(404, "not_found", "Not found.");
    } catch (error) {
      const status = Number(error.statusCode || 500);
      const code = error.code || (status >= 500 ? "internal_error" : "bad_request");
      sendError(res, status, code, error.publicMessage || error.message || "Internal server error.");
    }
  });
}

function setCorsHeaders(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = !origin ||
    origin.startsWith("chrome-extension://") ||
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return allowed;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = message;
  return error;
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(httpError(413, "body_too_large", "Request body is too large."));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(httpError(400, "invalid_json", "Invalid JSON request body."));
      }
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw httpError(400, "invalid_payload", "Payload must be an object.");
  }
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    throw httpError(400, "unsupported_schema", `schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    throw httpError(400, "missing_steps", "Payload requires at least one step.");
  }
  if (payload.steps.length > MAX_STEPS) {
    throw httpError(400, "too_many_steps", `Payload supports at most ${MAX_STEPS} steps.`);
  }

  const seenIds = new Set();
  const steps = payload.steps.map((step, index) => {
    const sourceStepId = cleanText(step?.sourceStepId, 100);
    if (!sourceStepId || seenIds.has(sourceStepId)) {
      throw httpError(400, "invalid_step_id", `Step ${index + 1} requires a unique sourceStepId.`);
    }
    seenIds.add(sourceStepId);
    return {
      sourceStepId,
      kind: cleanText(step.kind, 40),
      title: cleanText(step.title, 120) || `步骤 ${index + 1}`,
      description: cleanText(step.description, 800),
      check: cleanText(step.check, 300),
      risk: cleanText(step.risk, 300),
      target: cleanText(step.target, 160),
      url: sanitizeUrl(step.url),
      time: cleanText(step.time, 20),
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      title: cleanText(payload.meta?.title, 160),
      audience: cleanText(payload.meta?.audience, 160),
      version: cleanText(payload.meta?.version, 40),
      sourceUrl: sanitizeUrl(payload.meta?.sourceUrl),
    },
    steps,
  };
}

async function generateSopWithAi(payload, config) {
  if (!config.aiApiKey) {
    throw httpError(503, "missing_api_key", "Missing OPENAI_API_KEY or AI_API_KEY.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await config.fetchImpl(`${config.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.aiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是资深运营流程专家。根据记录生成专业、简洁、可执行的简体中文 SOP。只输出符合要求的 JSON，不编造未出现的系统功能。",
          },
          { role: "user", content: buildPrompt(payload) },
        ],
      }),
    });
    if (!response.ok) {
      throw httpError(502, "upstream_error", `AI provider request failed with status ${response.status}.`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw httpError(502, "invalid_ai_response", "AI response did not include message content.");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw httpError(502, "invalid_ai_json", "AI response was not valid JSON.");
    }
    return normalizeSop(parsed, payload);
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError(504, "ai_timeout", "AI request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildPrompt(payload) {
  return JSON.stringify({
    task: "按照真实步骤顺序生成 SOP。每个输出步骤必须保留对应 sourceStepId。",
    required_schema: {
      title: "string",
      purpose: "string",
      audience: "string",
      prerequisites: ["string"],
      steps: [{ sourceStepId: "string", title: "string", description: "string", check: "string", risk: "string" }],
      exceptions: ["string"],
      qualityChecks: ["string"],
      maintenanceRules: ["string"],
    },
    input: payload,
  }, null, 2);
}

export function normalizeSop(raw, payload) {
  const fallback = buildMockSop(payload);
  const rawSteps = Array.isArray(raw?.steps) ? raw.steps : [];
  const byId = new Map(rawSteps.map((step) => [cleanText(step?.sourceStepId, 100), step]));
  return {
    title: stringOr(raw?.title, fallback.title, 160),
    purpose: stringOr(raw?.purpose, fallback.purpose, 800),
    audience: stringOr(raw?.audience, fallback.audience, 160),
    prerequisites: stringArrayOr(raw?.prerequisites, fallback.prerequisites),
    steps: payload.steps.map((source, index) => {
      const step = byId.get(source.sourceStepId) || rawSteps[index] || {};
      return {
        sourceStepId: source.sourceStepId,
        title: stringOr(step.title, source.title, 120),
        description: stringOr(step.description, source.description, 800),
        check: stringOr(step.check, source.check || "确认该步骤已完成。", 300),
        risk: stringOr(step.risk, source.risk || "页面状态异常时停止操作并确认。", 300),
      };
    }),
    exceptions: stringArrayOr(raw?.exceptions, fallback.exceptions),
    qualityChecks: stringArrayOr(raw?.qualityChecks, fallback.qualityChecks),
    maintenanceRules: stringArrayOr(raw?.maintenanceRules, fallback.maintenanceRules),
  };
}

export function buildMockSop(payload) {
  return {
    title: `${payload.meta.title || "网页操作"} - 优化版`,
    purpose: "将已记录的网页操作整理为可复用、可培训、可检查的标准作业流程。",
    audience: payload.meta.audience || "新员工、运营人员、外包执行团队",
    prerequisites: [
      "确认已登录目标系统，账号权限满足流程要求。",
      "准备好执行流程所需的业务资料。",
    ],
    steps: payload.steps.map((step) => ({
      sourceStepId: step.sourceStepId,
      title: step.title,
      description: step.description || `按照记录操作“${step.target || "页面控件"}”。`,
      check: step.check || "确认页面反馈符合预期。",
      risk: step.risk || "页面内容与记录不一致时暂停操作并确认业务规则。",
    })),
    exceptions: [
      "页面无法打开、权限不足或数据缺失时停止执行并联系负责人。",
      "提交后没有预期反馈时不要重复提交，先检查页面状态。",
    ],
    qualityChecks: ["确认每一步都有可判断的检查标准。", "抽查截图与步骤说明是否一致。"],
    maintenanceRules: ["页面结构或业务规则变化后重新记录受影响步骤。"],
  };
}

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function stringOr(value, fallback, limit) {
  const text = cleanText(value, limit);
  return text || fallback;
}

function stringArrayOr(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 20);
  return items.length ? items : fallback;
}

export async function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 8787);
  const host = options.host || "127.0.0.1";
  const server = createSopServer(options);
  await new Promise((resolve) => server.listen(port, host, resolve));
  console.log(`SOPFlow AI server listening on http://${host}:${server.address().port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
