(function attachSopFlowShared(root) {
  const SCHEMA_VERSION = 2;
  const MAX_STEPS = 80;
  const DEFAULT_SETTINGS = Object.freeze({
    screenshotsEnabled: true,
    autoRedact: true,
    backendUrl: "http://127.0.0.1:8787",
  });

  const SENSITIVE_PATTERN =
    /(pass(word)?|pwd|secret|token|otp|验证码|密码|口令|邮箱|email|电话|手机|mobile|phone|身份证|证件|银行卡|卡号|account|账号)/i;

  function createId() {
    return globalThis.crypto?.randomUUID?.() ||
      `sopflow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return `${url.origin}${url.pathname}`;
    } catch {
      return "";
    }
  }

  function hostnameFromUrl(value) {
    try {
      return new URL(String(value || "")).hostname;
    } catch {
      return "未知页面";
    }
  }

  function normalizeLocalBackendUrl(value) {
    let url;
    try {
      url = new URL(String(value || DEFAULT_SETTINGS.backendUrl));
    } catch {
      throw new Error("AI 后端地址无效。");
    }
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
      throw new Error("AI 后端必须使用本机 HTTP 地址。");
    }
    url.search = "";
    url.hash = "";
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.origin}${path}`;
  }

  function cleanText(value, limit = 500) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function isSensitiveElement(element) {
    if (!element?.getAttribute) return false;
    const type = cleanText(element.getAttribute("type"), 40).toLowerCase();
    const autocomplete = cleanText(element.getAttribute("autocomplete"), 80);
    const signal = [
      type,
      autocomplete,
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
    ].join(" ");
    return type === "password" ||
      /^(?:current-password|new-password|one-time-code|cc-)/i.test(autocomplete) ||
      SENSITIVE_PATTERN.test(signal);
  }

  function describeInputValue(element) {
    const tag = element?.tagName?.toLowerCase?.() || "input";
    const type = cleanText(element?.getAttribute?.("type"), 40).toLowerCase();
    if (isSensitiveElement(element)) return "[已脱敏]";
    if (tag === "select") {
      return cleanText(element.selectedOptions?.[0]?.textContent || element.value, 80) || "[已选择]";
    }
    if (type === "checkbox" || type === "radio") {
      return element.checked ? "已选中" : "未选中";
    }
    return "[已输入]";
  }

  function normalizeStep(step, index = 0) {
    return {
      id: cleanText(step?.id, 100) || createId(),
      order: index,
      kind: cleanText(step?.kind, 40) || "action",
      time: cleanText(step?.time, 20) || "00:00",
      url: sanitizeUrl(step?.url),
      selector: cleanText(step?.selector, 240),
      target: cleanText(step?.target, 120) || "页面",
      title: cleanText(step?.title, 120) || `步骤 ${index + 1}`,
      description: cleanText(step?.description, 800),
      check: cleanText(step?.check, 300) || "确认该步骤已完成。",
      risk: cleanText(step?.risk, 300),
      screenshotId: cleanText(step?.screenshotId, 100) || null,
      screenshotError: cleanText(step?.screenshotError, 200),
    };
  }

  function normalizeSession(session) {
    const steps = Array.isArray(session?.steps)
      ? session.steps.slice(0, MAX_STEPS).map(normalizeStep)
      : [];
    const now = new Date().toISOString();
    const sourceUrl = sanitizeUrl(session?.sourceUrl || session?.url || steps[0]?.url);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: cleanText(session?.id, 100) || createId(),
      status: session?.status === "recording" || (!session?.endedAt && session?.startedAt)
        ? "recording"
        : "complete",
      title: cleanText(session?.title, 160) || "网页操作 SOP",
      audience: cleanText(session?.audience, 160) || "新员工、运营人员、外包执行团队",
      version: cleanText(session?.version, 40) || "v0.1",
      sourceUrl,
      sourceHost: hostnameFromUrl(sourceUrl),
      startedAt: session?.startedAt || now,
      endedAt: session?.endedAt || null,
      createdAt: session?.createdAt || session?.startedAt || now,
      updatedAt: session?.updatedAt || now,
      steps,
      aiSop: session?.aiSop && typeof session.aiSop === "object" ? session.aiSop : null,
    };
  }

  function stripAiResultForChangedSteps(session) {
    if (!session.aiSop) return session;
    const validIds = new Set(session.steps.map((step) => step.id));
    const aiSteps = Array.isArray(session.aiSop.steps)
      ? session.aiSop.steps.filter((step) => validIds.has(step.sourceStepId))
      : [];
    return {
      ...session,
      aiSop: { ...session.aiSop, steps: aiSteps },
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  root.SOPFlowShared = {
    SCHEMA_VERSION,
    MAX_STEPS,
    DEFAULT_SETTINGS,
    createId,
    sanitizeUrl,
    hostnameFromUrl,
    normalizeLocalBackendUrl,
    cleanText,
    isSensitiveElement,
    describeInputValue,
    normalizeStep,
    normalizeSession,
    stripAiResultForChangedSteps,
    escapeHtml,
  };
})(globalThis);
