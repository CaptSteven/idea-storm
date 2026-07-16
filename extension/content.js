(() => {
  if (window.__sopflowRecorderInjected) return;
  window.__sopflowRecorderInjected = true;

  const state = {
    recording: false,
    session: null,
    settings: { ...SOPFlowShared.DEFAULT_SETTINGS },
    lastInputStateByElement: new WeakMap(),
    inputTimers: new WeakMap(),
    lastUrl: SOPFlowShared.sanitizeUrl(location.href),
    saveChain: Promise.resolve(),
  };

  const formatTime = (milliseconds) => {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  const elapsed = () => {
    const startedAt = new Date(state.session?.startedAt || Date.now()).getTime();
    return Date.now() - startedAt;
  };

  const getElementName = (element) => {
    if (!element) return "页面";
    const text = [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("alt"),
      element.innerText,
      element.textContent,
    ]
      .map((item) => SOPFlowShared.cleanText(item, 80))
      .find(Boolean);
    return text || element.tagName?.toLowerCase?.() || "页面";
  };

  const getCssPath = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
        parts.unshift(selector);
        break;
      }
      const classes = Array.from(current.classList || [])
        .filter((name) => !name.startsWith("sopflow-"))
        .slice(0, 2)
        .map((name) => `.${CSS.escape(name)}`)
        .join("");
      selector += classes;
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  const getSensitiveRects = () => {
    const rects = [];
    document.querySelectorAll("input,textarea,select,[contenteditable='true']").forEach((element) => {
      if (!SOPFlowShared.isSensitiveElement(element)) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > innerHeight) return;
      rects.push({
        x: Math.max(0, rect.x - 6),
        y: Math.max(0, rect.y - 6),
        width: Math.min(innerWidth, rect.width + 12),
        height: Math.min(innerHeight, rect.height + 12),
      });
    });
    return rects;
  };

  const showBadge = (message = "") => {
    let badge = document.querySelector("#sopflow-recorder-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "sopflow-recorder-badge";
      badge.style.cssText = [
        "position:fixed", "z-index:2147483647", "right:16px", "bottom:16px",
        "padding:10px 12px", "border-radius:8px", "background:#17211f", "color:#fff",
        "font:600 13px system-ui,sans-serif", "box-shadow:0 10px 30px rgba(0,0,0,.2)",
      ].join(";");
      document.documentElement.appendChild(badge);
    }
    badge.textContent = message || `SOPFlow 记录中 · ${state.session?.steps?.length || 0} 步`;
  };

  const hideBadge = () => document.querySelector("#sopflow-recorder-badge")?.remove();

  const saveSession = async () => {
    if (!state.session) return;
    state.session.sourceUrl = SOPFlowShared.sanitizeUrl(location.href);
    state.session.sourceHost = SOPFlowShared.hostnameFromUrl(state.session.sourceUrl);
    const snapshot = structuredClone(state.session);
    state.saveChain = state.saveChain.catch(() => {}).then(async () => {
      const response = await chrome.runtime.sendMessage({ type: "SOPFLOW_SAVE_SESSION", session: snapshot });
      if (!response?.ok) throw new Error(response?.error || "保存记录失败。");
      if (state.session?.id === response.session?.id) {
        state.session.updatedAt = response.session.updatedAt;
      }
      return response.session;
    });
    return state.saveChain;
  };

  const captureStepScreenshot = async (stepId) => {
    if (!state.settings.screenshotsEnabled || !state.session) return;
    await new Promise((resolve) => setTimeout(resolve, 260));
    const response = await chrome.runtime.sendMessage({
      type: "SOPFLOW_CAPTURE_SCREENSHOT",
      sessionId: state.session.id,
      stepId,
      sensitiveRects: getSensitiveRects(),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    });
    const step = state.session?.steps.find((item) => item.id === stepId);
    if (!step) return;
    if (!response?.ok) {
      step.screenshotError = response?.error || "截图失败";
    } else {
      step.screenshotId = response.screenshotId || null;
      step.screenshotError = "";
    }
    await saveSession();
  };

  const addStep = async (kind, element, descriptor, { screenshot = true } = {}) => {
    if (!state.recording || !state.session) return;
    if (state.session.steps.length >= SOPFlowShared.MAX_STEPS) {
      showBadge(`SOPFlow 已达到 ${SOPFlowShared.MAX_STEPS} 步上限`);
      return;
    }

    const step = SOPFlowShared.normalizeStep({
      id: SOPFlowShared.createId(),
      kind,
      time: formatTime(elapsed()),
      url: location.href,
      selector: getCssPath(element),
      target: getElementName(element),
      ...descriptor,
    }, state.session.steps.length);
    state.session.steps.push(step);
    state.session.aiSop = null;
    showBadge();
    await saveSession();
    if (screenshot) {
      captureStepScreenshot(step.id).catch(async (error) => {
        const currentStep = state.session?.steps.find((item) => item.id === step.id);
        if (!currentStep) return;
        currentStep.screenshotError = error.message || "截图失败";
        try { await saveSession(); } catch { /* Page may be unloading. */ }
      });
    }
  };

  const describeClick = (element) => {
    const name = getElementName(element);
    const role = element.getAttribute?.("role") || element.tagName?.toLowerCase?.() || "控件";
    return {
      title: `点击 ${name}`,
      description: `点击“${name}”控件（${role}）。`,
      check: "确认页面出现预期反馈或进入下一状态。",
    };
  };

  const describeInput = (element) => {
    const name = getElementName(element);
    const value = SOPFlowShared.describeInputValue(element);
    return {
      title: `${element.tagName === "SELECT" ? "选择" : "填写"} ${name}`,
      description: `在“${name}”字段执行输入或选择：${value}。`,
      check: "确认字段状态已保存且格式符合业务要求。",
    };
  };

  const onClick = (event) => {
    const element = event.target?.closest?.(
      "button,a,input[type='button'],input[type='submit'],[role='button'],label",
    );
    if (!element || element.id === "sopflow-recorder-badge") return;
    void addStep("click", element, describeClick(element));
  };

  const onInputChanged = (event) => {
    const element = event.target;
    if (!element?.matches?.("input,textarea,select,[contenteditable='true']")) return;
    const type = element.getAttribute?.("type")?.toLowerCase?.() || "";
    const currentState = type === "checkbox" || type === "radio"
      ? `checked:${Boolean(element.checked)}`
      : element.tagName === "SELECT"
        ? `selected:${element.selectedIndex}`
        : "changed";
    if (state.lastInputStateByElement.get(element) === currentState && event.type !== "blur") return;
    state.lastInputStateByElement.set(element, currentState);
    clearTimeout(state.inputTimers.get(element));
    state.inputTimers.set(element, setTimeout(() => {
      void addStep("input", element, describeInput(element));
    }, 420));
  };

  const onSubmit = (event) => {
    const form = event.target;
    void addStep("submit", form, {
      title: "提交当前表单",
      description: `提交“${getElementName(form)}”中的当前信息。`,
      check: "确认系统没有重复提交，并显示成功或下一步状态。",
    });
  };

  const recordNavigationIfNeeded = () => {
    const nextUrl = SOPFlowShared.sanitizeUrl(location.href);
    if (!state.recording || state.lastUrl === nextUrl) return;
    const previous = state.lastUrl;
    state.lastUrl = nextUrl;
    void addStep("navigation", document.body, {
      title: "进入新页面",
      description: `页面从 ${previous || "上一页面"} 进入 ${nextUrl}。`,
      check: "确认新页面加载完成后继续操作。",
    });
  };

  const patchHistory = () => {
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function patchedHistory(...args) {
        const result = original.apply(this, args);
        setTimeout(recordNavigationIfNeeded, 0);
        return result;
      };
    }
    addEventListener("popstate", () => setTimeout(recordNavigationIfNeeded, 0));
  };

  const start = async () => {
    if (state.recording) return getStatus();
    const now = new Date().toISOString();
    state.recording = true;
    state.lastUrl = SOPFlowShared.sanitizeUrl(location.href);
    state.session = SOPFlowShared.normalizeSession({
      id: SOPFlowShared.createId(),
      status: "recording",
      title: document.title ? `${document.title} 操作 SOP` : "网页操作 SOP",
      sourceUrl: location.href,
      startedAt: now,
      createdAt: now,
      steps: [],
    });
    showBadge();
    await addStep("start", document.body, {
      title: "开始记录流程",
      description: `打开页面：${document.title || state.session.sourceUrl}`,
      check: "确认当前页面是流程起点。",
    });
    return getStatus();
  };

  const resume = (session) => {
    if (!session || session.status !== "recording") return getStatus();
    state.recording = true;
    state.session = SOPFlowShared.normalizeSession(session);
    state.lastUrl = SOPFlowShared.sanitizeUrl(location.href);
    showBadge();
    return getStatus();
  };

  const stop = async () => {
    if (!state.session) return getStatus();
    state.recording = false;
    state.session.status = "complete";
    state.session.endedAt = new Date().toISOString();
    hideBadge();
    await saveSession();
    return getStatus();
  };

  const getStatus = () => ({
    recording: state.recording,
    sessionId: state.session?.id || null,
    stepCount: state.session?.steps?.length || 0,
    title: document.title,
    url: SOPFlowShared.sanitizeUrl(location.href),
  });

  const restoreActiveSession = async () => {
    try {
      const settingsResponse = await chrome.runtime.sendMessage({ type: "SOPFLOW_GET_SETTINGS" });
      if (settingsResponse?.ok) state.settings = settingsResponse.settings;
      const response = await chrome.runtime.sendMessage({ type: "SOPFLOW_CONTENT_READY" });
      if (response?.ok && response.session) {
        resume(response.session);
        recordNavigationIfNeeded();
      }
    } catch {
      // Extension runtime is unavailable on browser-managed pages.
    }
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onInputChanged, true);
  document.addEventListener("blur", onInputChanged, true);
  document.addEventListener("submit", onSubmit, true);
  patchHistory();
  void restoreActiveSession();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SOPFLOW_START") {
      start().then(sendResponse);
      return true;
    }
    if (message.type === "SOPFLOW_STOP") {
      stop().then(sendResponse);
      return true;
    }
    if (message.type === "SOPFLOW_STATUS") {
      sendResponse(getStatus());
      return false;
    }
    if (message.type === "SOPFLOW_RESUME") {
      sendResponse(resume(message.session));
      return false;
    }
    if (message.type === "SOPFLOW_SETTINGS_UPDATED") {
      state.settings = { ...state.settings, ...message.settings };
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
