const STORAGE_KEY = "sopflow_demo_sessions_v2";
const ACTIVE_KEY = "sopflow_demo_active_session";

const screenshotSources = {
  "shot-order-list": "assets/sample-order-list.png",
  "shot-order-detail": "assets/sample-order-detail.png",
  "shot-refund-confirm": "assets/sample-refund-confirmation.png",
  "shot-campaign-list": "assets/sample-campaign-list.png",
};

const samples = [
  {
    schemaVersion: 2,
    id: "demo-refund",
    status: "complete",
    title: "客服退款处理 SOP",
    audience: "新客服、运营助理、外包团队",
    version: "v1.2",
    sourceUrl: "https://merchant.example.com/orders",
    startedAt: "2026-07-16T08:20:00.000Z",
    endedAt: "2026-07-16T08:23:10.000Z",
    createdAt: "2026-07-16T08:20:00.000Z",
    updatedAt: "2026-07-16T08:23:10.000Z",
    steps: [
      {
        id: "refund-step-1", kind: "click", time: "00:08",
        url: "https://merchant.example.com/orders", target: "待处理订单",
        title: "筛选待处理退款订单",
        description: "在订单列表中将状态切换为“退款待处理”，并打开最早提交的订单。",
        check: "确认列表仅显示待处理退款订单，且订单编号与工单一致。",
        risk: "不要在筛选条件未生效时批量操作。", screenshotId: "shot-order-list",
      },
      {
        id: "refund-step-2", kind: "click", time: "00:42",
        url: "https://merchant.example.com/orders/10482", target: "订单详情",
        title: "核对订单与退款原因",
        description: "核对订单金额、支付状态、退款原因和客户提交的凭证。",
        check: "订单金额、客户信息与退款工单一致，付款状态为已支付。",
        risk: "客户联系方式属于敏感信息，不应出现在导出文档中。", screenshotId: "shot-order-detail",
      },
      {
        id: "refund-step-3", kind: "submit", time: "02:31",
        url: "https://merchant.example.com/orders/10482/refund", target: "确认退款",
        title: "提交退款并记录结果",
        description: "确认退款金额后提交申请，将系统生成的退款编号回填到客服工单。",
        check: "页面显示退款已提交，并产生唯一退款编号。",
        risk: "提交后不要重复点击；状态未更新时先刷新核对。", screenshotId: "shot-refund-confirm",
      },
    ],
  },
  {
    schemaVersion: 2,
    id: "demo-campaign",
    status: "complete",
    title: "促销活动下线检查",
    audience: "电商运营、值班负责人",
    version: "v0.3",
    sourceUrl: "https://merchant.example.com/campaigns",
    startedAt: "2026-07-15T12:10:00.000Z",
    endedAt: "2026-07-15T12:12:00.000Z",
    createdAt: "2026-07-15T12:10:00.000Z",
    updatedAt: "2026-07-15T12:12:00.000Z",
    steps: [
      {
        id: "campaign-step-1", kind: "click", time: "00:12",
        url: "https://merchant.example.com/campaigns", target: "活动列表",
        title: "定位到期活动",
        description: "按结束时间排序，定位当天到期且仍处于启用状态的活动。",
        check: "活动名称、渠道和结束时间与排期表一致。",
        risk: "确认活动不属于延期名单。", screenshotId: "shot-campaign-list",
      },
      {
        id: "campaign-step-2", kind: "submit", time: "01:08",
        url: "https://merchant.example.com/campaigns/summer-sale", target: "停用活动",
        title: "停用活动并复核前台",
        description: "停用活动后打开前台页面，确认活动标签和优惠价格已消失。",
        check: "后台状态为已停用，前台不再展示活动权益。",
        risk: "前台缓存可能延迟，需在无痕窗口二次核对。", screenshotId: null,
      },
    ],
  },
];

const state = {
  sessions: loadSessions(),
  activeId: localStorage.getItem(ACTIVE_KEY),
};

const els = Object.fromEntries([
  "sessionList", "newCopy", "importFile", "resetDemo", "documentTitle", "documentMeta",
  "optimizeButton", "copyMarkdown", "downloadHtml", "downloadJson", "deleteSession",
  "titleInput", "audienceInput", "versionInput", "sourceUrl", "statusMessage", "stepCount",
  "stepsEditor", "documentState", "sopOutput", "stepTemplate",
].map((id) => [id, document.querySelector(`#${id}`)]));

if (!state.sessions.some((session) => session.id === state.activeId)) state.activeId = state.sessions[0]?.id;

function clone(value) {
  return structuredClone(value);
}

function loadSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return saved.map(SOPFlowShared.normalizeSession);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return clone(samples).map(SOPFlowShared.normalizeSession);
}

function activeSession() {
  return state.sessions.find((session) => session.id === state.activeId) || null;
}

function persist(message = "已保存") {
  const session = activeSession();
  if (session) session.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
  localStorage.setItem(ACTIVE_KEY, state.activeId || "");
  els.documentState.textContent = message;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function setStatus(message, kind = "") {
  els.statusMessage.hidden = !message;
  els.statusMessage.textContent = message;
  els.statusMessage.className = `status-message ${kind}`.trim();
}

function imageFor(step) {
  return step.screenshotId ? screenshotSources[step.screenshotId] || "" : "";
}

function aiStepFor(session, step) {
  return session.aiSop?.steps?.find((item) => item.sourceStepId === step.id) || {};
}

function render() {
  const session = activeSession();
  renderLibrary();
  if (!session) return;
  els.documentTitle.textContent = session.title;
  els.documentMeta.textContent = `${session.sourceHost} · ${session.steps.length} 步 · 更新于 ${formatDate(session.updatedAt)}`;
  els.titleInput.value = session.title;
  els.audienceInput.value = session.audience;
  els.versionInput.value = session.version;
  els.sourceUrl.textContent = session.sourceUrl;
  els.sourceUrl.href = session.sourceUrl;
  els.stepCount.textContent = `${session.steps.length} 步`;
  renderEditors(session);
  renderPreview(session);
}

function renderLibrary() {
  els.sessionList.innerHTML = "";
  for (const session of state.sessions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-item ${session.id === state.activeId ? "active" : ""}`;
    button.innerHTML = `<strong>${SOPFlowShared.escapeHtml(session.title)}</strong><span>${session.steps.length} 步 · ${formatDate(session.updatedAt)}</span>`;
    button.addEventListener("click", () => {
      state.activeId = session.id;
      persist();
      setStatus("");
      render();
    });
    els.sessionList.appendChild(button);
  }
}

function renderEditors(session) {
  els.stepsEditor.innerHTML = "";
  session.steps.forEach((step, index) => {
    const node = els.stepTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = step.id;
    node.querySelector(".step-label").textContent = `步骤 ${index + 1} · ${step.time}`;
    node.querySelector(".step-title").value = step.title;
    node.querySelector(".step-description").value = step.description;
    node.querySelector(".step-check").value = step.check;
    node.querySelector(".step-risk").value = step.risk;
    node.querySelector(".move-up").disabled = index === 0;
    node.querySelector(".move-down").disabled = index === session.steps.length - 1;
    const image = node.querySelector(".step-image");
    const source = imageFor(step);
    image.hidden = !source;
    node.querySelector(".image-empty").hidden = Boolean(source);
    node.querySelector(".remove-image").disabled = !source;
    if (source) {
      image.src = source;
      image.alt = `${step.title} 页面截图`;
    }
    els.stepsEditor.appendChild(node);
  });
}

function renderPreview(session) {
  const ai = session.aiSop || {};
  const prerequisites = ai.prerequisites || ["确认已登录业务系统，账号权限和工单资料准备完毕。"];
  const exceptions = ai.exceptions || ["页面状态、权限或业务数据与记录不一致时，停止操作并联系负责人。"];
  els.sopOutput.innerHTML = `
    <header class="document-heading">
      <p>STANDARD OPERATING PROCEDURE</p>
      <h2>${SOPFlowShared.escapeHtml(ai.title || session.title)}</h2>
      <span>${SOPFlowShared.escapeHtml(ai.purpose || "将已记录的网页操作整理为可培训、可检查的标准作业流程。")}</span>
    </header>
    <section class="summary-grid">
      <div><span>适用对象</span><strong>${SOPFlowShared.escapeHtml(ai.audience || session.audience)}</strong></div>
      <div><span>版本</span><strong>${SOPFlowShared.escapeHtml(session.version)}</strong></div>
      <div><span>步骤</span><strong>${session.steps.length} 步</strong></div>
      <div><span>来源</span><strong>${SOPFlowShared.escapeHtml(session.sourceHost)}</strong></div>
    </section>
    <section class="document-section"><h3>执行前检查</h3><ul>${prerequisites.map((item) => `<li>${SOPFlowShared.escapeHtml(item)}</li>`).join("")}</ul></section>
    ${session.steps.map((step, index) => {
      const optimized = aiStepFor(session, step);
      const source = imageFor(step);
      return `<section class="document-step">
        ${source ? `<img src="${source}" alt="${SOPFlowShared.escapeHtml(step.title)} 截图">` : '<div class="document-image-empty">无截图</div>'}
        <div>
          <p class="step-kicker">步骤 ${index + 1} · ${SOPFlowShared.escapeHtml(step.time)}</p>
          <h3>${SOPFlowShared.escapeHtml(optimized.title || step.title)}</h3>
          <p>${SOPFlowShared.escapeHtml(optimized.description || step.description)}</p>
          <span class="check-line">检查标准：${SOPFlowShared.escapeHtml(optimized.check || step.check)}</span>
          ${(step.risk || optimized.risk) ? `<span class="risk-line">风险提示：${SOPFlowShared.escapeHtml(step.risk || optimized.risk)}</span>` : ""}
        </div>
      </section>`;
    }).join("")}
    <section class="document-section"><h3>异常处理</h3><ul>${exceptions.map((item) => `<li>${SOPFlowShared.escapeHtml(item)}</li>`).join("")}</ul></section>
  `;
}

function updateMetadata() {
  const session = activeSession();
  session.title = els.titleInput.value.trim() || "未命名 SOP";
  session.audience = els.audienceInput.value.trim() || "未指定";
  session.version = els.versionInput.value.trim() || "v0.1";
  session.aiSop = null;
  persist("编辑已保存");
  render();
}

function updateStep(target) {
  const session = activeSession();
  const editor = target.closest(".step-editor");
  const step = session.steps.find((item) => item.id === editor?.dataset.id);
  if (!step) return;
  if (target.classList.contains("step-title")) step.title = target.value.trim() || "未命名步骤";
  if (target.classList.contains("step-description")) step.description = target.value.trim();
  if (target.classList.contains("step-check")) step.check = target.value.trim() || "确认该步骤已完成。";
  if (target.classList.contains("step-risk")) step.risk = target.value.trim();
  session.aiSop = null;
  persist("编辑已保存");
  renderPreview(session);
}

function moveStep(id, offset) {
  const session = activeSession();
  const index = session.steps.findIndex((step) => step.id === id);
  const next = index + offset;
  if (index < 0 || next < 0 || next >= session.steps.length) return;
  const [step] = session.steps.splice(index, 1);
  session.steps.splice(next, 0, step);
  session.steps.forEach((item, order) => { item.order = order; });
  session.aiSop = null;
  persist("顺序已保存");
  render();
}

function removeStep(id) {
  const session = activeSession();
  session.steps = session.steps.filter((step) => step.id !== id);
  session.steps.forEach((item, order) => { item.order = order; });
  session.aiSop = null;
  persist("步骤已删除");
  render();
}

function optimizeSample() {
  const session = activeSession();
  session.aiSop = {
    title: `${session.title} · 优化版`,
    purpose: "统一退款处理动作、检查标准和异常边界，降低重复提交与错误退款风险。",
    audience: session.audience,
    prerequisites: ["确认账号具备退款权限。", "准备订单编号、客服工单和客户凭证。"],
    steps: session.steps.map((step) => ({
      sourceStepId: step.id,
      title: step.title,
      description: step.description,
      check: step.check,
      risk: step.risk || "页面反馈异常时停止操作并核对业务规则。",
    })),
    exceptions: ["权限不足或订单状态不允许退款时，停止操作并升级给值班负责人。", "提交后未生成退款编号时，不要重复提交。"],
  };
  persist("优化结果已保存");
  renderPreview(session);
  setStatus("示例优化完成，输出步骤仍按 sourceStepId 对齐。", "success");
}

function markdownFor(session) {
  const ai = session.aiSop || {};
  const lines = [`# ${ai.title || session.title}`, "", `- 适用对象：${ai.audience || session.audience}`, `- 版本：${session.version}`, `- 来源：${session.sourceUrl}`, "", "## 操作步骤", ""];
  session.steps.forEach((step, index) => {
    const optimized = aiStepFor(session, step);
    lines.push(`### ${index + 1}. ${optimized.title || step.title}`, "", optimized.description || step.description, "", `- 检查标准：${optimized.check || step.check}`);
    if (step.risk || optimized.risk) lines.push(`- 风险提示：${step.risk || optimized.risk}`);
    lines.push("");
  });
  return lines.join("\n");
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "-");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function imageDataUrl(source) {
  const blob = await (await fetch(source)).blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function exportHtml() {
  const cloneOutput = els.sopOutput.cloneNode(true);
  await Promise.all([...cloneOutput.querySelectorAll("img")].map(async (image) => {
    image.src = await imageDataUrl(image.getAttribute("src"));
  }));
  const session = activeSession();
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>${SOPFlowShared.escapeHtml(session.title)}</title><style>body{max-width:980px;margin:40px auto;padding:0 24px;font:16px/1.65 system-ui;color:#17211f}img{width:100%;border:1px solid #d8e0de}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.summary-grid div{padding:12px;background:#f3f6f5}.summary-grid span,.step-kicker{display:block;color:#66736f;font-size:12px}.document-step{display:grid;grid-template-columns:300px 1fr;gap:20px;padding:24px 0;border-top:1px solid #d8e0de}.check-line,.risk-line{display:block;margin-top:8px;padding:8px;background:#e7f2ee}.risk-line{background:#fff4dd}@media(max-width:700px){.summary-grid,.document-step{grid-template-columns:1fr}}</style></head><body>${cloneOutput.innerHTML}</body></html>`;
  download(`${session.title}.html`, html, "text/html;charset=utf-8");
}

function createCopy() {
  const source = activeSession();
  const copySession = SOPFlowShared.normalizeSession({
    ...clone(source), id: SOPFlowShared.createId(), title: `${source.title} 副本`, aiSop: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    steps: source.steps.map((step) => ({ ...step, id: SOPFlowShared.createId() })),
  });
  state.sessions.unshift(copySession);
  state.activeId = copySession.id;
  persist("副本已创建");
  render();
}

els.stepsEditor.addEventListener("input", (event) => updateStep(event.target));
els.stepsEditor.addEventListener("click", (event) => {
  const editor = event.target.closest(".step-editor");
  if (!editor) return;
  if (event.target.closest(".move-up")) moveStep(editor.dataset.id, -1);
  if (event.target.closest(".move-down")) moveStep(editor.dataset.id, 1);
  if (event.target.closest(".remove-step") && confirm("删除这个步骤？")) removeStep(editor.dataset.id);
  if (event.target.closest(".remove-image")) {
    const step = activeSession().steps.find((item) => item.id === editor.dataset.id);
    step.screenshotId = null;
    persist("截图已移除");
    render();
  }
});

[els.titleInput, els.audienceInput, els.versionInput].forEach((input) => input.addEventListener("change", updateMetadata));
els.optimizeButton.addEventListener("click", optimizeSample);
els.newCopy.addEventListener("click", createCopy);
els.copyMarkdown.addEventListener("click", async () => {
  await navigator.clipboard.writeText(markdownFor(activeSession()));
  setStatus("Markdown 已复制。", "success");
});
els.downloadHtml.addEventListener("click", exportHtml);
els.downloadJson.addEventListener("click", () => {
  const session = activeSession();
  download(`${session.title}.json`, JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), session }, null, 2), "application/json;charset=utf-8");
});
els.deleteSession.addEventListener("click", () => {
  const session = activeSession();
  if (!session || !confirm(`删除“${session.title}”？`)) return;
  state.sessions = state.sessions.filter((item) => item.id !== session.id);
  if (!state.sessions.length) state.sessions = clone(samples).map(SOPFlowShared.normalizeSession);
  state.activeId = state.sessions[0].id;
  persist("记录已删除");
  render();
});
els.resetDemo.addEventListener("click", () => {
  state.sessions = clone(samples).map(SOPFlowShared.normalizeSession);
  state.activeId = state.sessions[0].id;
  persist("示例数据已恢复");
  setStatus("示例数据已恢复。", "success");
  render();
});
els.importFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const raw = payload.session || payload;
    const imported = SOPFlowShared.normalizeSession({ ...raw, id: SOPFlowShared.createId(), aiSop: null });
    state.sessions.unshift(imported);
    state.activeId = imported.id;
    persist("导入已保存");
    render();
  } catch (error) {
    setStatus(`导入失败：${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
});

render();
