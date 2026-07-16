import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.openai.com/v1";
const AI_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const AI_API_KEY = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "";
const AI_MOCK = process.env.AI_MOCK === "true";
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        model: AI_MODEL,
        mock: AI_MOCK,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-sop") {
      const payload = await readJson(req);
      const result = AI_MOCK ? buildMockSop(payload) : await generateSopWithAi(payload);
      sendJson(res, 200, { ok: true, sop: result });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SOPFlow AI server listening on http://127.0.0.1:${PORT}`);
});

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(text));
      } catch {
        const error = new Error("Invalid JSON request body.");
        error.statusCode = 400;
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

async function generateSopWithAi(payload) {
  if (!AI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY or AI_API_KEY.");
    error.statusCode = 500;
    throw error;
  }

  validatePayload(payload);

  const response = await fetch(`${AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是资深运营流程专家。把浏览器操作记录整理成清晰、可执行、可培训的 SOP。只输出 JSON，不要输出 Markdown。",
        },
        {
          role: "user",
          content: buildPrompt(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`AI request failed: ${response.status} ${body.slice(0, 500)}`);
    error.statusCode = 502;
    throw error;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("AI response did not include message content.");
    error.statusCode = 502;
    throw error;
  }

  return normalizeSop(JSON.parse(content), payload);
}

function buildPrompt(payload) {
  const meta = payload.meta || {};
  const steps = sanitizeSteps(payload.steps || []);

  return JSON.stringify(
    {
      task:
        "根据网页操作记录生成 SOP JSON。保留真实步骤顺序，不要编造未出现的系统功能。语言使用简体中文，表达专业、简洁、可交给新人执行。",
      required_schema: {
        title: "string",
        purpose: "string",
        audience: "string",
        prerequisites: ["string"],
        steps: [
          {
            title: "string",
            description: "string",
            check: "string",
            risk: "string",
          },
        ],
        exceptions: ["string"],
        qualityChecks: ["string"],
        maintenanceRules: ["string"],
      },
      input: {
        title: meta.title,
        audience: meta.audience,
        version: meta.version,
        sourceUrl: meta.sourceUrl,
        steps,
      },
    },
    null,
    2,
  );
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    const error = new Error("Payload must be an object.");
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    const error = new Error("Payload requires at least one step.");
    error.statusCode = 400;
    throw error;
  }
}

function sanitizeSteps(steps) {
  return steps.slice(0, 80).map((step, index) => ({
    index: index + 1,
    kind: String(step.kind || ""),
    title: String(step.title || "").slice(0, 120),
    description: String(step.description || "").slice(0, 500),
    check: String(step.check || "").slice(0, 240),
    target: String(step.target || "").slice(0, 160),
    selector: String(step.selector || "").slice(0, 240),
    url: String(step.url || "").slice(0, 500),
    time: String(step.time || ""),
  }));
}

function normalizeSop(raw, payload) {
  const fallback = buildMockSop(payload);
  const steps = Array.isArray(raw.steps) ? raw.steps : fallback.steps;

  return {
    title: stringOr(raw.title, fallback.title),
    purpose: stringOr(raw.purpose, fallback.purpose),
    audience: stringOr(raw.audience, fallback.audience),
    prerequisites: stringArrayOr(raw.prerequisites, fallback.prerequisites),
    steps: steps.map((step, index) => ({
      title: stringOr(step.title, fallback.steps[index]?.title || `步骤 ${index + 1}`),
      description: stringOr(step.description, fallback.steps[index]?.description || ""),
      check: stringOr(step.check, fallback.steps[index]?.check || "确认该步骤已完成。"),
      risk: stringOr(step.risk, fallback.steps[index]?.risk || "无特殊风险。"),
    })),
    exceptions: stringArrayOr(raw.exceptions, fallback.exceptions),
    qualityChecks: stringArrayOr(raw.qualityChecks, fallback.qualityChecks),
    maintenanceRules: stringArrayOr(raw.maintenanceRules, fallback.maintenanceRules),
  };
}

function buildMockSop(payload) {
  validatePayload(payload);
  const meta = payload.meta || {};
  const steps = sanitizeSteps(payload.steps);

  return {
    title: `${meta.title || "网页操作"} - AI 优化版`,
    purpose: "将已记录的网页操作整理为可复用、可培训、可检查的标准作业流程。",
    audience: meta.audience || "新员工、运营人员、外包执行团队",
    prerequisites: [
      "确认已登录目标系统，且账号权限满足该流程要求。",
      "准备好执行流程所需的业务资料、客户信息或订单信息。",
      "确认当前页面与截图对应的业务系统一致。",
    ],
    steps: steps.map((step, index) => ({
      title: step.title || `步骤 ${index + 1}`,
      description:
        step.description ||
        `按照记录在页面中操作目标元素：${step.target || "未命名控件"}。`,
      check: step.check || "确认页面反馈符合预期，并且关键字段已经保存。",
      risk: "如果页面内容与截图不一致，不要继续批量处理，应先确认业务规则或系统版本是否变化。",
    })),
    exceptions: [
      "页面无法打开、权限不足或数据缺失时，停止执行并联系负责人确认。",
      "操作后没有出现预期反馈时，不要重复提交，先刷新或检查系统日志。",
    ],
    qualityChecks: [
      "抽查关键步骤截图与说明是否一致。",
      "确认每一步都有可判断的检查标准。",
      "确认流程没有依赖个人经验或口头说明。",
    ],
    maintenanceRules: [
      "业务规则、页面结构或权限配置变化后，需要重新记录相关步骤。",
      "每次更新 SOP 后应保留版本号和更新时间。",
    ],
  };
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArrayOr(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item) => String(item || "").trim()).filter(Boolean);
  return items.length ? items : fallback;
}
