const params = new URLSearchParams(location.search);
const sessionId = params.get("session");

const state = {
  session: null,
  steps: [],
  aiSop: null,
};

const els = {
  documentTitle: document.querySelector("#documentTitle"),
  titleInput: document.querySelector("#titleInput"),
  audienceInput: document.querySelector("#audienceInput"),
  versionInput: document.querySelector("#versionInput"),
  stepCount: document.querySelector("#stepCount"),
  stepsEditor: document.querySelector("#stepsEditor"),
  sopOutput: document.querySelector("#sopOutput"),
  backendUrlInput: document.querySelector("#backendUrlInput"),
  aiButton: document.querySelector("#aiButton"),
  aiStatus: document.querySelector("#aiStatus"),
  copyMarkdown: document.querySelector("#copyMarkdown"),
  downloadHtml: document.querySelector("#downloadHtml"),
  downloadJson: document.querySelector("#downloadJson"),
  stepEditorTemplate: document.querySelector("#stepEditorTemplate"),
};

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const getMeta = () => ({
  title: els.titleInput.value.trim() || "未命名 SOP",
  audience: els.audienceInput.value.trim() || "未指定",
  version: els.versionInput.value.trim() || "v0.1",
  sourceUrl: state.session?.url || "",
  updatedAt: new Date().toLocaleString("zh-CN"),
});

const getBackendUrl = () =>
  (els.backendUrlInput.value.trim() || "http://127.0.0.1:8787").replace(/\/$/, "");

const loadSession = async () => {
  if (!sessionId) {
    renderMissing("缺少 session 参数。");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "SOPFLOW_GET_SESSION",
    sessionId,
  });

  if (!response.ok || !response.session) {
    renderMissing("没有找到这次记录。");
    return;
  }

  state.session = response.session;
  state.steps = response.session.steps || [];
  els.titleInput.value = response.session.title || "网页操作 SOP";
  els.backendUrlInput.value = localStorage.getItem("sopflow_backend_url") || els.backendUrlInput.value;
  render();
};

const renderMissing = (message) => {
  els.documentTitle.textContent = "无法加载 SOP";
  els.sopOutput.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
};

const render = () => {
  const meta = getMeta();
  els.documentTitle.textContent = meta.title;
  els.stepCount.textContent = `${state.steps.length} 步`;
  renderEditors();
  renderSop();
};

const renderEditors = () => {
  els.stepsEditor.innerHTML = "";

  if (state.steps.length === 0) {
    els.stepsEditor.innerHTML = `<div class="empty">还没有记录到步骤。</div>`;
    return;
  }

  state.steps.forEach((step, index) => {
    const node = els.stepEditorTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = step.id;
    const image = node.querySelector(".step-shot");
    image.src = step.image || "";
    image.alt = `${step.title || `步骤 ${index + 1}`} 截图`;
    node.querySelector(".step-title").value = step.title || `步骤 ${index + 1}`;
    node.querySelector(".step-description").value = step.description || "";
    node.querySelector(".step-check").value = step.check || "";
    els.stepsEditor.appendChild(node);
  });
};

const renderSop = () => {
  const meta = getMeta();
  const aiSop = state.aiSop;
  const title = aiSop?.title || meta.title;
  const purpose = aiSop?.purpose || "将已记录的网页操作整理为可复用、可培训、可检查的标准作业流程。";
  const prerequisites = aiSop?.prerequisites || [
    "确认已登录目标系统，账号权限、业务资料和待处理对象已经准备完毕。",
  ];
  const exceptions = aiSop?.exceptions || [
    "如果当前页面、字段、权限或系统反馈与截图不一致，应暂停执行并交由负责人确认。",
  ];
  const qualityChecks = aiSop?.qualityChecks || [];
  const maintenanceRules = aiSop?.maintenanceRules || [
    "当业务规则或系统界面变化后，应重新记录关键流程并更新该 SOP。",
  ];

  if (state.steps.length === 0) {
    els.sopOutput.innerHTML = `<div class="empty">停止记录后会在这里生成 SOP。</div>`;
    return;
  }

  els.sopOutput.innerHTML = `
    <header>
      <p class="eyebrow">Standard Operating Procedure</p>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(purpose)}</p>
    </header>
    <section class="summary">
      <div class="summary-box"><span>适用对象</span><strong>${escapeHtml(aiSop?.audience || meta.audience)}</strong></div>
      <div class="summary-box"><span>版本</span><strong>${escapeHtml(meta.version)}</strong></div>
      <div class="summary-box"><span>步骤数量</span><strong>${state.steps.length} 步</strong></div>
      <div class="summary-box"><span>来源页面</span><strong>${escapeHtml(new URL(meta.sourceUrl || location.href).hostname)}</strong></div>
    </section>
    <section>
      <h3>执行前检查</h3>
      <ul>${prerequisites.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
    ${state.steps
      .map((step, index) => {
        const aiStep = aiSop?.steps?.[index] || {};
        return `
          <section class="sop-step">
            ${step.image ? `<img src="${step.image}" alt="${escapeHtml(step.title)} 截图" />` : `<div class="empty">无截图</div>`}
            <div>
              <h3>${index + 1}. ${escapeHtml(aiStep.title || step.title || `步骤 ${index + 1}`)}</h3>
              <p><strong>时间点：</strong>${escapeHtml(step.time || "00:00")}</p>
              <p><strong>页面：</strong>${escapeHtml(step.url || meta.sourceUrl)}</p>
              <p>${escapeHtml(aiStep.description || step.description || "")}</p>
              <span class="checkline">检查标准：${escapeHtml(aiStep.check || step.check || "确认该步骤已完成。")}</span>
              ${aiStep.risk ? `<span class="riskline">风险提示：${escapeHtml(aiStep.risk)}</span>` : ""}
            </div>
          </section>
        `;
      })
      .join("")}
    <section>
      <h3>异常处理</h3>
      <ul>${exceptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
    ${
      qualityChecks.length
        ? `<section><h3>质量检查</h3><ul>${qualityChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
        : ""
    }
    <section>
      <h3>维护规则</h3>
      <ul>${maintenanceRules.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
};

const updateStepFromInput = (target) => {
  const card = target.closest(".step-editor");
  if (!card) return;

  const step = state.steps.find((item) => item.id === card.dataset.id);
  if (!step) return;

  if (target.classList.contains("step-title")) {
    step.title = target.value.trim();
  }

  if (target.classList.contains("step-description")) {
    step.description = target.value.trim();
  }

  if (target.classList.contains("step-check")) {
    step.check = target.value.trim();
  }

  state.aiSop = null;
  renderSop();
};

const buildMarkdown = () => {
  const meta = getMeta();
  const aiSop = state.aiSop;
  const title = aiSop?.title || meta.title;
  const prerequisites = aiSop?.prerequisites || [
    "确认已登录目标系统，账号权限、业务资料和待处理对象已经准备完毕。",
  ];
  const exceptions = aiSop?.exceptions || [
    "如果当前页面、字段、权限或系统反馈与截图不一致，应暂停执行并交由负责人确认。",
  ];
  const qualityChecks = aiSop?.qualityChecks || [];
  const maintenanceRules = aiSop?.maintenanceRules || [
    "当业务规则或系统界面变化后，应重新记录关键流程并更新该 SOP。",
  ];
  const lines = [
    `# ${title}`,
    "",
    `- 适用对象：${aiSop?.audience || meta.audience}`,
    `- 版本：${meta.version}`,
    `- 来源页面：${meta.sourceUrl}`,
    `- 更新时间：${meta.updatedAt}`,
    "",
    "## 目的",
    "",
    aiSop?.purpose || "将已记录的网页操作整理为可复用、可培训、可检查的标准作业流程。",
    "",
    "## 执行前检查",
    "",
    ...prerequisites.map((item) => `- ${item}`),
    "",
    "## 操作步骤",
    "",
  ];

  state.steps.forEach((step, index) => {
    const aiStep = aiSop?.steps?.[index] || {};
    lines.push(`### ${index + 1}. ${aiStep.title || step.title || `步骤 ${index + 1}`}`);
    lines.push("");
    lines.push(`- 时间点：${step.time || "00:00"}`);
    lines.push(`- 页面：${step.url || meta.sourceUrl}`);
    lines.push(`- 操作说明：${aiStep.description || step.description || ""}`);
    lines.push(`- 检查标准：${aiStep.check || step.check || "确认该步骤已完成。"}`);
    if (aiStep.risk) lines.push(`- 风险提示：${aiStep.risk}`);
    lines.push("");
  });

  lines.push("## 异常处理", "");
  lines.push(...exceptions.map((item) => `- ${item}`));
  if (qualityChecks.length) {
    lines.push("", "## 质量检查", "");
    lines.push(...qualityChecks.map((item) => `- ${item}`));
  }
  lines.push("", "## 维护规则", "");
  lines.push(...maintenanceRules.map((item) => `- ${item}`));
  return lines.join("\n");
};

const setAiStatus = (message, kind = "") => {
  els.aiStatus.hidden = false;
  els.aiStatus.textContent = message;
  els.aiStatus.className = `ai-status ${kind}`.trim();
};

const buildAiPayload = () => ({
  meta: getMeta(),
  steps: state.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    title: step.title,
    description: step.description,
    check: step.check,
    target: step.target,
    selector: step.selector,
    url: step.url,
    time: step.time,
  })),
});

const optimizeWithAi = async () => {
  if (state.steps.length === 0) {
    setAiStatus("没有可优化的步骤。", "error");
    return;
  }

  const backendUrl = getBackendUrl();
  localStorage.setItem("sopflow_backend_url", backendUrl);
  els.aiButton.disabled = true;
  setAiStatus("正在请求 AI 后端优化 SOP...");

  try {
    const response = await fetch(`${backendUrl}/api/generate-sop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiPayload()),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `AI 后端返回 ${response.status}`);
    }

    state.aiSop = data.sop;
    if (state.aiSop?.title) {
      els.titleInput.value = state.aiSop.title;
    }
    renderSop();
    setAiStatus("AI 优化完成。请检查步骤和风险提示后再导出。", "success");
  } catch (error) {
    setAiStatus(`AI 优化失败：${error.message}`, "error");
  } finally {
    els.aiButton.disabled = false;
  }
};

const download = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

els.stepsEditor.addEventListener("input", (event) => {
  updateStepFromInput(event.target);
});

[els.titleInput, els.audienceInput, els.versionInput].forEach((input) => {
  input.addEventListener("input", () => {
    state.aiSop = null;
    render();
  });
});

els.backendUrlInput.addEventListener("change", () => {
  localStorage.setItem("sopflow_backend_url", getBackendUrl());
});

els.aiButton.addEventListener("click", optimizeWithAi);

els.copyMarkdown.addEventListener("click", async () => {
  await navigator.clipboard.writeText(buildMarkdown());
  els.copyMarkdown.textContent = "已复制";
  window.setTimeout(() => {
    els.copyMarkdown.textContent = "复制 Markdown";
  }, 1200);
});

els.downloadHtml.addEventListener("click", () => {
  const meta = getMeta();
  const title = state.aiSop?.title || meta.title;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.65; margin: 40px; color: #17211f; }
    img { max-width: 620px; width: 100%; border: 1px solid #d9e2df; border-radius: 8px; }
    section { margin: 28px 0; }
  </style>
</head>
<body>${els.sopOutput.innerHTML}</body>
</html>`;
  download(`${title}.html`, html, "text/html;charset=utf-8");
});

els.downloadJson.addEventListener("click", () => {
  const meta = getMeta();
  const title = state.aiSop?.title || meta.title;
  download(
    `${title}.json`,
    JSON.stringify({ meta, steps: state.steps, aiSop: state.aiSop }, null, 2),
    "application/json;charset=utf-8",
  );
});

loadSession();
