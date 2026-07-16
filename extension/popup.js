const els = {
  statusLabel: document.querySelector("#statusLabel"),
  stepCount: document.querySelector("#stepCount"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  openButton: document.querySelector("#openButton"),
  historyButton: document.querySelector("#historyButton"),
  screenshotsEnabled: document.querySelector("#screenshotsEnabled"),
  autoRedact: document.querySelector("#autoRedact"),
};

let activeTab = null;
let currentStatus = null;

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const injectRecorder = async (tabId) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["shared.js", "content.js"],
  });
};

const sendToTab = async (type) => {
  if (!activeTab?.id) throw new Error("没有可用的当前页面。");
  await injectRecorder(activeTab.id);
  return chrome.tabs.sendMessage(activeTab.id, { type });
};

const setStatus = (status) => {
  currentStatus = status;
  const recording = Boolean(status?.recording);
  const count = Number(status?.stepCount || 0);
  els.statusLabel.textContent = recording ? "正在记录当前页面" : "未记录";
  els.stepCount.textContent = `${count} 步`;
  els.startButton.disabled = recording;
  els.stopButton.disabled = !recording;
  els.openButton.disabled = !status?.sessionId || recording;
};

const loadSettings = async () => {
  const response = await chrome.runtime.sendMessage({ type: "SOPFLOW_GET_SETTINGS" });
  if (!response?.ok) return;
  els.screenshotsEnabled.checked = response.settings.screenshotsEnabled !== false;
  els.autoRedact.checked = response.settings.autoRedact !== false;
};

const saveSettings = async () => {
  const settings = {
    screenshotsEnabled: els.screenshotsEnabled.checked,
    autoRedact: els.autoRedact.checked,
  };
  const response = await chrome.runtime.sendMessage({ type: "SOPFLOW_SET_SETTINGS", settings });
  if (activeTab?.id && response?.ok) {
    try {
      await chrome.tabs.sendMessage(activeTab.id, {
        type: "SOPFLOW_SETTINGS_UPDATED",
        settings: response.settings,
      });
    } catch {
      // Recorder may not be injected yet.
    }
  }
};

const refreshStatus = async () => {
  activeTab = await getActiveTab();
  if (!activeTab?.id || /^(chrome|edge|about):/.test(activeTab.url || "")) {
    els.statusLabel.textContent = "当前页面不支持记录";
    els.startButton.disabled = true;
    els.stopButton.disabled = true;
    els.openButton.disabled = true;
    return;
  }

  try {
    const active = await chrome.runtime.sendMessage({
      type: "SOPFLOW_GET_ACTIVE_SESSION",
      tabId: activeTab.id,
    });
    await injectRecorder(activeTab.id);
    if (active.ok && active.session) {
      const restored = await chrome.tabs.sendMessage(activeTab.id, {
        type: "SOPFLOW_RESUME",
        session: active.session,
      });
      setStatus(restored);
      return;
    }
    setStatus(await chrome.tabs.sendMessage(activeTab.id, { type: "SOPFLOW_STATUS" }));
  } catch {
    setStatus({ recording: false, stepCount: 0, sessionId: null });
  }
};

els.startButton.addEventListener("click", async () => {
  try {
    setStatus(await sendToTab("SOPFLOW_START"));
  } catch (error) {
    els.statusLabel.textContent = error.message;
  }
});

els.stopButton.addEventListener("click", async () => {
  try {
    const status = await sendToTab("SOPFLOW_STOP");
    setStatus(status);
    if (status.sessionId) {
      await chrome.runtime.sendMessage({ type: "SOPFLOW_OPEN_DASHBOARD", sessionId: status.sessionId });
    }
  } catch (error) {
    els.statusLabel.textContent = error.message;
  }
});

els.openButton.addEventListener("click", async () => {
  if (!currentStatus?.sessionId) return;
  await chrome.runtime.sendMessage({ type: "SOPFLOW_OPEN_DASHBOARD", sessionId: currentStatus.sessionId });
});

els.historyButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SOPFLOW_OPEN_DASHBOARD" });
});

els.screenshotsEnabled.addEventListener("change", saveSettings);
els.autoRedact.addEventListener("change", saveSettings);

await loadSettings();
await refreshStatus();
