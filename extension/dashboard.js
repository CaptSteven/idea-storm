const params = new URLSearchParams(location.search);

const state = {
  sessions: [],
  session: null,
  screenshotCache: new Map(),
  saveTimer: null,
  savePromise: Promise.resolve(),
  editRevision: 0,
};

const els = {
  sessionList: document.querySelector("#sessionList"),
  refreshLibrary: document.querySelector("#refreshLibrary"),
  importFile: document.querySelector("#importFile"),
  storageUsage: document.querySelector("#storageUsage"),
  storageWarning: document.querySelector("#storageWarning"),
  emptyWorkspace: document.querySelector("#emptyWorkspace"),
  editorWorkspace: document.querySelector("#editorWorkspace"),
  documentTitle: document.querySelector("#documentTitle"),
  documentMeta: document.querySelector("#documentMeta"),
  titleInput: document.querySelector("#titleInput"),
  audienceInput: document.querySelector("#audienceInput"),
  versionInput: document.querySelector("#versionInput"),
  backendUrlInput: document.querySelector("#backendUrlInput"),
  stepCount: document.querySelector("#stepCount"),
  stepsEditor: document.querySelector("#stepsEditor"),
  sopOutput: document.querySelector("#sopOutput"),
  aiButton: document.querySelector("#aiButton"),
  aiStatus: document.querySelector("#aiStatus"),
  copyMarkdown: document.querySelector("#copyMarkdown"),
  printPdf: document.querySelector("#printPdf"),
  downloadHtml: document.querySelector("#downloadHtml"),
  downloadJson: document.querySelector("#downloadJson"),
  duplicateSession: document.querySelector("#duplicateSession"),
  deleteSession: document.querySelector("#deleteSession"),
  stepEditorTemplate: document.querySelector("#stepEditorTemplate"),
};

const send = async (type, payload = {}) => {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "扩展操作失败。");
  return response;
};

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
};

const formatDate = (value) => {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
};

const setAiStatus = (message, kind = "") => {
  els.aiStatus.hidden = !message;
  els.aiStatus.textContent = message;
  els.aiStatus.className = `ai-status ${kind}`.trim();
};

const getAiStep = (step) => {
  const aiSteps = state.session?.aiSop?.steps || [];
  return aiSteps.find((item) => item.sourceStepId === step.id) || {};
};

async function refreshLibrary(preferredId = state.session?.id || params.get("session")) {
  const response = await send("SOPFLOW_LIST_SESSIONS");
  state.sessions = response.sessions || [];
  renderLibrary();
  await refreshStorageUsage();
  const targetId = preferredId && state.sessions.some((item) => item.id === preferredId)
    ? preferredId
    : state.sessions[0]?.id;
  if (targetId) await selectSession(targetId);
  else showEmptyWorkspace();
}

function renderLibrary() {
  els.sessionList.innerHTML = "";
  if (!state.sessions.length) {
    els.sessionList.innerHTML = '<div class="library-empty">暂无记录。完成一次网页录制后会显示在这里。</div>';
    return;
  }
  state.sessions.forEach((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-card ${session.id === state.session?.id ? "is-active" : ""}`;
    button.innerHTML = `
      <strong>${SOPFlowShared.escapeHtml(session.title)}</strong>
      <span>${SOPFlowShared.escapeHtml(session.sourceHost)} · ${session.steps.length} 步 · ${formatDate(session.updatedAt)}</span>
    `;
    button.addEventListener("click", () => selectSession(session.id));
    els.sessionList.appendChild(button);
  });
}

async function selectSession(id) {
  await flushSave();
  const response = await send("SOPFLOW_GET_SESSION", { sessionId: id });
  if (!response.session) {
    await refreshLibrary();
    return;
  }
  state.session = SOPFlowShared.normalizeSession(response.session);
  history.replaceState(null, "", `?session=${encodeURIComponent(id)}`);
  els.emptyWorkspace.hidden = true;
  els.editorWorkspace.hidden = false;
  populateMeta();
  renderLibrary();
  renderAll();
}

function showEmptyWorkspace() {
  state.session = null;
  els.emptyWorkspace.hidden = false;
  els.editorWorkspace.hidden = true;
  renderLibrary();
}

function populateMeta() {
  els.titleInput.value = state.session.title;
  els.audienceInput.value = state.session.audience;
  els.versionInput.value = state.session.version;
  send("SOPFLOW_GET_SETTINGS").then((response) => {
    els.backendUrlInput.value = response.settings.backendUrl;
  }).catch(() => {
    els.backendUrlInput.value = SOPFlowShared.DEFAULT_SETTINGS.backendUrl;
  });
}

function renderAll() {
  if (!state.session) return;
  els.documentTitle.textContent = state.session.title;
  els.documentMeta.textContent = `${state.session.sourceHost} · ${state.session.steps.length} 步 · 更新于 ${formatDate(state.session.updatedAt)}`;
  els.stepCount.textContent = `${state.session.steps.length} 步`;
  renderEditors();
  renderSop();
  void hydrateScreenshots();
}

function renderEditors() {
  els.stepsEditor.innerHTML = "";
  if (!state.session.steps.length) {
    els.stepsEditor.innerHTML = '<div class="library-empty">这份记录没有步骤。</div>';
    return;
  }

  state.session.steps.forEach((step, index) => {
    const node = els.stepEditorTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = step.id;
    node.querySelector(".step-index").textContent = `步骤 ${index + 1} · ${step.time}`;
    node.querySelector(".step-title").value = step.title;
    node.querySelector(".step-description").value = step.description;
    node.querySelector(".step-check").value = step.check;
    node.querySelector(".step-risk").value = step.risk || getAiStep(step).risk || "";
    node.querySelector(".move-up").disabled = index === 0;
    node.querySelector(".move-down").disabled = index === state.session.steps.length - 1;
    const image = node.querySelector(".step-shot");
    if (step.screenshotId) image.dataset.screenshotId = step.screenshotId;
    node.querySelector(".remove-shot").disabled = !step.screenshotId;
    els.stepsEditor.appendChild(node);
  });
}

function renderSop() {
  if (!state.session) return;
  const aiSop = state.session.aiSop || {};
  const prerequisites = aiSop.prerequisites || ["确认已登录目标系统，并准备好执行流程所需的账号权限和业务资料。"];
  const exceptions = aiSop.exceptions || ["页面、权限或反馈与记录不一致时，停止操作并联系负责人确认。"];
  const qualityChecks = aiSop.qualityChecks || [];
  const maintenanceRules = aiSop.maintenanceRules || ["页面结构或业务规则变化后，应重新记录受影响的步骤。"];

  els.sopOutput.innerHTML = `
    <header>
      <p class="eyebrow">STANDARD OPERATING PROCEDURE</p>
      <h2>${SOPFlowShared.escapeHtml(aiSop.title || state.session.title)}</h2>
      <p>${SOPFlowShared.escapeHtml(aiSop.purpose || "将网页操作整理为可复用、可培训、可检查的标准作业流程。")}</p>
    </header>
    <section class="summary">
      <div class="summary-box"><span>适用对象</span><strong>${SOPFlowShared.escapeHtml(aiSop.audience || state.session.audience)}</strong></div>
      <div class="summary-box"><span>版本</span><strong>${SOPFlowShared.escapeHtml(state.session.version)}</strong></div>
      <div class="summary-box"><span>步骤</span><strong>${state.session.steps.length} 步</strong></div>
      <div class="summary-box"><span>来源</span><strong>${SOPFlowShared.escapeHtml(state.session.sourceHost)}</strong></div>
    </section>
    <section><h3>执行前检查</h3><ul>${prerequisites.map((item) => `<li>${SOPFlowShared.escapeHtml(item)}</li>`).join("")}</ul></section>
    ${state.session.steps.map((step, index) => {
      const aiStep = getAiStep(step);
      return `
        <section class="sop-step">
          ${step.screenshotId
            ? `<img data-screenshot-id="${step.screenshotId}" alt="${SOPFlowShared.escapeHtml(step.title)} 截图" />`
            : '<div class="no-image">无截图</div>'}
          <div>
            <h3>${index + 1}. ${SOPFlowShared.escapeHtml(aiStep.title || step.title)}</h3>
            <p><strong>时间点：</strong>${SOPFlowShared.escapeHtml(step.time)}　<strong>页面：</strong>${SOPFlowShared.escapeHtml(step.url)}</p>
            <p>${SOPFlowShared.escapeHtml(aiStep.description || step.description)}</p>
            <span class="checkline">检查标准：${SOPFlowShared.escapeHtml(aiStep.check || step.check)}</span>
            ${(step.risk || aiStep.risk) ? `<span class="riskline">风险提示：${SOPFlowShared.escapeHtml(step.risk || aiStep.risk)}</span>` : ""}
          </div>
        </section>`;
    }).join("")}
    <section><h3>异常处理</h3><ul>${exceptions.map((item) => `<li>${SOPFlowShared.escapeHtml(item)}</li>`).join("")}</ul></section>
    ${qualityChecks.length ? `<section><h3>质量检查</h3><ul>${qualityChecks.map((item) => `<li>${SOPFlowShared.escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}
    <section><h3>维护规则</h3><ul>${maintenanceRules.map((item) => `<li>${SOPFlowShared.escapeHtml(item)}</li>`).join("")}</ul></section>
  `;
}

async function hydrateScreenshots() {
  const images = [...document.querySelectorAll("img[data-screenshot-id]")];
  await Promise.all(images.map(async (image) => {
    const id = image.dataset.screenshotId;
    if (!id) return;
    let dataUrl = state.screenshotCache.get(id);
    if (!dataUrl) {
      const response = await send("SOPFLOW_GET_SCREENSHOT", { screenshotId: id });
      dataUrl = response.dataUrl;
      if (dataUrl) state.screenshotCache.set(id, dataUrl);
    }
    if (dataUrl) {
      image.src = dataUrl;
      image.classList.add("has-image");
      const empty = image.parentElement?.querySelector?.(".shot-empty");
      if (empty) empty.hidden = true;
    }
  }));
}

function markStepsChanged() {
  state.session = SOPFlowShared.stripAiResultForChangedSteps(state.session);
  queueSave();
  renderAll();
}

function queueSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => void saveCurrentSession(), 450);
}

async function flushSave() {
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    await saveCurrentSession();
  }
  await state.savePromise.catch(() => {});
}

async function saveCurrentSession() {
  if (!state.session) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const snapshot = structuredClone(state.session);
  const revision = state.editRevision;
  state.savePromise = state.savePromise.catch(() => {}).then(async () => {
    const response = await send("SOPFLOW_SAVE_SESSION", { session: snapshot });
    const index = state.sessions.findIndex((item) => item.id === response.session.id);
    if (index >= 0) state.sessions[index] = response.session;
    else state.sessions.unshift(response.session);
    if (state.session?.id === response.session.id && state.editRevision === revision) {
      state.session = response.session;
      els.documentTitle.textContent = state.session.title;
    }
    renderLibrary();
    return response.session;
  });
  return state.savePromise;
}

function updateMeta() {
  if (!state.session) return;
  state.session.title = els.titleInput.value.trim() || "未命名 SOP";
  state.session.audience = els.audienceInput.value.trim() || "未指定";
  state.session.version = els.versionInput.value.trim() || "v0.1";
  state.editRevision += 1;
  queueSave();
  renderSop();
  els.documentTitle.textContent = state.session.title;
}

function updateStep(target) {
  const card = target.closest(".step-editor");
  if (!card || !state.session) return;
  const step = state.session.steps.find((item) => item.id === card.dataset.id);
  if (!step) return;
  if (target.classList.contains("step-title")) step.title = target.value.trim() || "未命名步骤";
  if (target.classList.contains("step-description")) step.description = target.value.trim();
  if (target.classList.contains("step-check")) step.check = target.value.trim() || "确认该步骤已完成。";
  if (target.classList.contains("step-risk")) step.risk = target.value.trim();
  state.session.aiSop = null;
  state.editRevision += 1;
  queueSave();
  renderSop();
  void hydrateScreenshots();
}

function moveStep(id, direction) {
  const index = state.session.steps.findIndex((step) => step.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= state.session.steps.length) return;
  const [step] = state.session.steps.splice(index, 1);
  state.session.steps.splice(next, 0, step);
  state.session.steps.forEach((item, order) => { item.order = order; });
  state.session.aiSop = null;
  state.editRevision += 1;
  queueSave();
  renderAll();
}

async function removeStep(id) {
  const step = state.session.steps.find((item) => item.id === id);
  if (step?.screenshotId) {
    await send("SOPFLOW_DELETE_SCREENSHOT", { screenshotId: step.screenshotId });
    state.screenshotCache.delete(step.screenshotId);
  }
  state.session.steps = state.session.steps.filter((item) => item.id !== id);
  state.session.steps.forEach((item, order) => { item.order = order; });
  state.session.aiSop = null;
  state.editRevision += 1;
  await saveCurrentSession();
  renderAll();
}

async function removeScreenshot(id) {
  const step = state.session.steps.find((item) => item.id === id);
  if (!step?.screenshotId) return;
  await send("SOPFLOW_DELETE_SCREENSHOT", { screenshotId: step.screenshotId });
  state.screenshotCache.delete(step.screenshotId);
  step.screenshotId = null;
  state.editRevision += 1;
  await saveCurrentSession();
  renderAll();
}

function buildAiPayload() {
  return {
    schemaVersion: SOPFlowShared.SCHEMA_VERSION,
    meta: {
      title: state.session.title,
      audience: state.session.audience,
      version: state.session.version,
      sourceUrl: state.session.sourceUrl,
    },
    steps: state.session.steps.map((step) => ({
      sourceStepId: step.id,
      kind: step.kind,
      title: step.title,
      description: step.description,
      check: step.check,
      risk: step.risk,
      target: step.target,
      url: step.url,
      time: step.time,
    })),
  };
}

async function optimizeWithAi() {
  if (!state.session?.steps.length) return setAiStatus("没有可优化的步骤。", "error");
  let backendUrl;
  try {
    backendUrl = SOPFlowShared.normalizeLocalBackendUrl(els.backendUrlInput.value.trim());
    await send("SOPFLOW_SET_SETTINGS", { settings: { backendUrl } });
  } catch (error) {
    setAiStatus(error.message, "error");
    return;
  }
  els.aiButton.disabled = true;
  setAiStatus("正在使用本地 AI 后端优化 SOP...");
  try {
    const response = await fetch(`${backendUrl}/api/generate-sop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiPayload()),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || data.schemaVersion !== SOPFlowShared.SCHEMA_VERSION) {
      throw new Error(data.error?.message || `AI 后端返回 ${response.status}`);
    }
    state.session.aiSop = data.sop;
    if (data.sop.title) {
      state.session.title = data.sop.title;
      els.titleInput.value = data.sop.title;
    }
    await saveCurrentSession();
    renderAll();
    setAiStatus("AI 优化完成。导出前请检查内容和截图脱敏效果。", "success");
  } catch (error) {
    setAiStatus(`AI 优化失败：${error.message}`, "error");
  } finally {
    els.aiButton.disabled = false;
  }
}

function buildMarkdown() {
  const aiSop = state.session.aiSop || {};
  const lines = [
    `# ${aiSop.title || state.session.title}`, "",
    `- 适用对象：${aiSop.audience || state.session.audience}`,
    `- 版本：${state.session.version}`,
    `- 来源页面：${state.session.sourceUrl}`,
    `- 更新时间：${new Date().toLocaleString("zh-CN")}`, "",
    "## 目的", "", aiSop.purpose || "将网页操作整理为可复用的标准作业流程。", "",
    "## 执行前检查", "", ...(aiSop.prerequisites || ["确认账号权限和业务资料已准备完毕。"]).map((item) => `- ${item}`), "",
    "## 操作步骤", "",
  ];
  state.session.steps.forEach((step, index) => {
    const aiStep = getAiStep(step);
    lines.push(`### ${index + 1}. ${aiStep.title || step.title}`, "");
    lines.push(`- 时间点：${step.time}`);
    lines.push(`- 页面：${step.url}`);
    lines.push(`- 操作说明：${aiStep.description || step.description}`);
    lines.push(`- 检查标准：${aiStep.check || step.check}`);
    if (step.risk || aiStep.risk) lines.push(`- 风险提示：${step.risk || aiStep.risk}`);
    lines.push("");
  });
  lines.push("## 异常处理", "", ...(aiSop.exceptions || ["页面状态异常时停止操作并联系负责人。"]).map((item) => `- ${item}`));
  if (aiSop.qualityChecks?.length) lines.push("", "## 质量检查", "", ...aiSop.qualityChecks.map((item) => `- ${item}`));
  lines.push("", "## 维护规则", "", ...(aiSop.maintenanceRules || ["页面或规则变化后更新 SOP。"]).map((item) => `- ${item}`));
  return lines.join("\n");
}

async function collectScreenshots() {
  const output = {};
  for (const step of state.session.steps) {
    if (!step.screenshotId) continue;
    let dataUrl = state.screenshotCache.get(step.screenshotId);
    if (!dataUrl) dataUrl = (await send("SOPFLOW_GET_SCREENSHOT", { screenshotId: step.screenshotId })).dataUrl;
    if (dataUrl) output[step.screenshotId] = dataUrl;
  }
  return output;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]/g, "-");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportHtml() {
  await hydrateScreenshots();
  const title = state.session.aiSop?.title || state.session.title;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>${SOPFlowShared.escapeHtml(title)}</title><style>body{max-width:980px;margin:40px auto;padding:0 24px;font-family:system-ui,sans-serif;color:#17211f;line-height:1.65}img{max-width:100%;border:1px solid #d7e0dd}section{margin:26px 0}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.summary-box{padding:12px;background:#f5f8f7}.sop-step{display:grid;grid-template-columns:300px 1fr;gap:20px;padding:20px 0;border-top:1px solid #d7e0dd}.checkline,.riskline{display:block;padding:8px;margin-top:8px;background:#e4f1ed}.riskline{background:#fff4df}@media(max-width:700px){.summary,.sop-step{grid-template-columns:1fr}}</style></head><body>${els.sopOutput.innerHTML}</body></html>`;
  download(`${title}.html`, html, "text/html;charset=utf-8");
}

async function exportJson() {
  const payload = {
    schemaVersion: SOPFlowShared.SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    session: state.session,
    screenshots: await collectScreenshots(),
  };
  download(`${state.session.title}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

async function refreshStorageUsage() {
  try {
    const estimate = await send("SOPFLOW_STORAGE_ESTIMATE");
    els.storageUsage.textContent = estimate.quota
      ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`
      : formatBytes(estimate.usage);
    els.storageWarning.hidden = estimate.usage < 250 * 1024 ** 2;
  } catch {
    els.storageUsage.textContent = "无法读取";
  }
}

els.stepsEditor.addEventListener("input", (event) => updateStep(event.target));
els.stepsEditor.addEventListener("click", async (event) => {
  const card = event.target.closest(".step-editor");
  if (!card) return;
  if (event.target.closest(".move-up")) moveStep(card.dataset.id, -1);
  if (event.target.closest(".move-down")) moveStep(card.dataset.id, 1);
  if (event.target.closest(".remove-step") && confirm("删除这个步骤？")) await removeStep(card.dataset.id);
  if (event.target.closest(".remove-shot") && confirm("删除这个步骤的截图？")) await removeScreenshot(card.dataset.id);
});

[els.titleInput, els.audienceInput, els.versionInput].forEach((input) => input.addEventListener("input", updateMeta));
els.backendUrlInput.addEventListener("change", async () => {
  try {
    const response = await send("SOPFLOW_SET_SETTINGS", {
      settings: { backendUrl: els.backendUrlInput.value.trim() },
    });
    els.backendUrlInput.value = response.settings.backendUrl;
    setAiStatus("");
  } catch (error) {
    setAiStatus(error.message, "error");
  }
});
els.aiButton.addEventListener("click", optimizeWithAi);
els.copyMarkdown.addEventListener("click", async () => {
  await navigator.clipboard.writeText(buildMarkdown());
  els.copyMarkdown.textContent = "已复制";
  setTimeout(() => { els.copyMarkdown.textContent = "复制 Markdown"; }, 1200);
});
els.printPdf.addEventListener("click", () => window.print());
els.downloadHtml.addEventListener("click", exportHtml);
els.downloadJson.addEventListener("click", exportJson);
els.refreshLibrary.addEventListener("click", () => refreshLibrary());
els.duplicateSession.addEventListener("click", async () => {
  await flushSave();
  const response = await send("SOPFLOW_DUPLICATE_SESSION", { sessionId: state.session.id });
  await refreshLibrary(response.session.id);
});
els.deleteSession.addEventListener("click", async () => {
  if (!state.session || !confirm(`删除“${state.session.title}”及其截图？`)) return;
  await flushSave();
  await send("SOPFLOW_DELETE_SESSION", { sessionId: state.session.id });
  state.screenshotCache.clear();
  state.session = null;
  await refreshLibrary(null);
});
els.importFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const response = await send("SOPFLOW_IMPORT_SESSION", { payload });
    await refreshLibrary(response.session.id);
  } catch (error) {
    alert(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
});

addEventListener("beforeunload", flushSave);
await refreshLibrary();
