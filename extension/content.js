(() => {
  if (window.__sopflowRecorderInjected) {
    return;
  }
  window.__sopflowRecorderInjected = true;

  const state = {
    recording: false,
    sessionId: null,
    startedAt: null,
    steps: [],
    lastInputValueByElement: new WeakMap(),
    lastUrl: location.href,
  };

  const formatTime = (milliseconds) => {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const mins = String(Math.floor(total / 60)).padStart(2, "0");
    const secs = String(total % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const createId = () => crypto.randomUUID();

  const elapsed = () => (state.startedAt ? Date.now() - state.startedAt : 0);

  const getElementName = (element) => {
    if (!element) return "页面";

    const aria = element.getAttribute("aria-label");
    const title = element.getAttribute("title");
    const placeholder = element.getAttribute("placeholder");
    const alt = element.getAttribute("alt");
    const text = element.innerText || element.textContent;
    const value = element.value && element.tagName === "BUTTON" ? element.value : "";

    return [aria, title, placeholder, alt, text, value]
      .map((item) => String(item || "").replace(/\s+/g, " ").trim())
      .find(Boolean)
      ?.slice(0, 80) || element.tagName.toLowerCase();
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

      const className = Array.from(current.classList || [])
        .slice(0, 2)
        .map((name) => `.${CSS.escape(name)}`)
        .join("");
      selector += className;
      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(" > ");
  };

  const describeClick = (element) => {
    const name = getElementName(element);
    const role = element.getAttribute("role") || element.tagName.toLowerCase();
    return {
      title: `点击 ${name}`,
      description: `在当前页面点击“${name}”控件。控件类型：${role}。`,
      check: "页面进入预期状态，或对应操作反馈已出现。",
    };
  };

  const describeInput = (element) => {
    const name = getElementName(element);
    const type = element.getAttribute("type") || element.tagName.toLowerCase();
    const value = type === "password" ? "••••••" : String(element.value || "").slice(0, 80);
    return {
      title: `填写 ${name}`,
      description: `在“${name}”字段输入或选择：${value || "空值"}。`,
      check: "字段内容已保留，格式符合业务要求。",
    };
  };

  const showBadge = () => {
    let badge = document.querySelector("#sopflow-recorder-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "sopflow-recorder-badge";
      badge.style.cssText = [
        "position:fixed",
        "z-index:2147483647",
        "right:16px",
        "bottom:16px",
        "padding:10px 12px",
        "border-radius:8px",
        "background:#17211f",
        "color:#fff",
        "font:600 13px system-ui,sans-serif",
        "box-shadow:0 10px 30px rgba(0,0,0,.2)",
      ].join(";");
      document.documentElement.appendChild(badge);
    }

    badge.textContent = `SOPFlow 记录中 · ${state.steps.length} 步`;
  };

  const hideBadge = () => {
    document.querySelector("#sopflow-recorder-badge")?.remove();
  };

  const captureScreenshot = () =>
    chrome.runtime.sendMessage({ type: "SOPFLOW_CAPTURE_SCREENSHOT" });

  const saveSession = () => {
    if (!state.sessionId) {
      return Promise.resolve({ ok: false, error: "No active session." });
    }

    const session = {
      id: state.sessionId,
      title: document.title ? `${document.title} 操作 SOP` : "网页操作 SOP",
      url: location.href,
      startedAt: new Date(state.startedAt || Date.now()).toISOString(),
      endedAt: state.recording ? null : new Date().toISOString(),
      steps: state.steps,
    };

    return chrome.runtime.sendMessage({ type: "SOPFLOW_SAVE_SESSION", session });
  };

  const addStep = async (kind, element, descriptor) => {
    if (!state.recording) return;

    const step = {
      id: createId(),
      kind,
      time: formatTime(elapsed()),
      url: location.href,
      selector: getCssPath(element),
      target: getElementName(element),
      image: "",
      screenshotError: "",
      ...descriptor,
    };

    state.steps.push(step);
    showBadge();
    await saveSession();

    captureScreenshot()
      .then(async (screenshot) => {
        if (!screenshot?.ok) {
          step.screenshotError = screenshot?.error || "截图失败";
        } else {
          step.image = screenshot.dataUrl;
          step.screenshotError = "";
        }
        await saveSession();
      })
      .catch(async (error) => {
        step.screenshotError = error.message || "截图失败";
        await saveSession();
      });
  };

  const onClick = (event) => {
    const element = event.target?.closest?.("button,a,input,textarea,select,[role='button'],[contenteditable='true'],label");
    if (!element || element.id === "sopflow-recorder-badge") return;

    addStep("click", element, describeClick(element));
  };

  const onChange = (event) => {
    const element = event.target;
    if (!element?.matches?.("input,textarea,select,[contenteditable='true']")) return;

    const nextValue = element.isContentEditable ? element.textContent : element.value;
    const previousValue = state.lastInputValueByElement.get(element);
    if (previousValue === nextValue) return;
    state.lastInputValueByElement.set(element, nextValue);

    window.setTimeout(() => {
      addStep("input", element, describeInput(element));
    }, 120);
  };

  const start = async () => {
    if (state.recording) {
      return getStatus();
    }

    state.recording = true;
    state.sessionId = createId();
    state.startedAt = Date.now();
    state.steps = [];
    showBadge();
    await addStep("start", document.body, {
      title: "开始记录流程",
      description: `打开页面：${document.title || location.href}`,
      check: "确认当前页面是流程起点。",
    });
    return getStatus();
  };

  const resume = (session) => {
    if (!session || session.endedAt) {
      return getStatus();
    }

    state.recording = true;
    state.sessionId = session.id;
    state.startedAt = new Date(session.startedAt || Date.now()).getTime();
    state.steps = Array.isArray(session.steps) ? session.steps : [];
    state.lastUrl = location.href;
    showBadge();
    return getStatus();
  };

  const recordNavigationIfNeeded = () => {
    if (!state.recording || state.lastUrl === location.href) return;

    const fromUrl = state.lastUrl;
    state.lastUrl = location.href;
    addStep("navigation", document.body, {
      title: "进入新页面",
      description: `页面从 ${fromUrl} 跳转到 ${location.href}。`,
      check: "确认新页面已加载，并继续执行下一步操作。",
    });
  };

  const patchHistory = () => {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      window.setTimeout(recordNavigationIfNeeded, 0);
      return result;
    };

    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      window.setTimeout(recordNavigationIfNeeded, 0);
      return result;
    };

    window.addEventListener("popstate", () => {
      window.setTimeout(recordNavigationIfNeeded, 0);
    });
  };

  const restoreActiveSession = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "SOPFLOW_CONTENT_READY" });
      if (response?.ok && response.session && !response.session.endedAt) {
        resume(response.session);
        recordNavigationIfNeeded();
      }
    } catch {
      // The extension runtime can be unavailable on browser-managed pages.
    }
  };

  const stop = async () => {
    state.recording = false;
    hideBadge();
    await saveSession();
    return getStatus();
  };

  const getStatus = () => ({
    recording: state.recording,
    sessionId: state.sessionId,
    stepCount: state.steps.length,
    title: document.title,
    url: location.href,
  });

  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("blur", onChange, true);
  patchHistory();
  restoreActiveSession();

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

    return false;
  });
})();
