const els = {
  statusLabel: document.querySelector("#statusLabel"),
  stepCount: document.querySelector("#stepCount"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  openButton: document.querySelector("#openButton"),
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
    files: ["content.js"],
  });
};

const sendToTab = async (type) => {
  if (!activeTab?.id) {
    throw new Error("没有可用的当前页面。");
  }

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

const refreshStatus = async () => {
  activeTab = await getActiveTab();
  if (!activeTab?.id || activeTab.url?.startsWith("chrome://")) {
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

    if (active.ok && active.session && !active.session.endedAt) {
      const restored = await chrome.tabs.sendMessage(activeTab.id, {
        type: "SOPFLOW_RESUME",
        session: active.session,
      });
      setStatus(restored);
      return;
    }

    const status = await chrome.tabs.sendMessage(activeTab.id, {
      type: "SOPFLOW_STATUS",
    });
    setStatus(status);
  } catch {
    setStatus({ recording: false, stepCount: 0, sessionId: null });
  }
};

els.startButton.addEventListener("click", async () => {
  try {
    const status = await sendToTab("SOPFLOW_START");
    setStatus(status);
  } catch (error) {
    els.statusLabel.textContent = error.message;
  }
});

els.stopButton.addEventListener("click", async () => {
  try {
    const status = await sendToTab("SOPFLOW_STOP");
    setStatus(status);
    if (status.sessionId) {
      await chrome.runtime.sendMessage({
        type: "SOPFLOW_OPEN_DASHBOARD",
        sessionId: status.sessionId,
      });
    }
  } catch (error) {
    els.statusLabel.textContent = error.message;
  }
});

els.openButton.addEventListener("click", async () => {
  if (!currentStatus?.sessionId) return;
  await chrome.runtime.sendMessage({
    type: "SOPFLOW_OPEN_DASHBOARD",
    sessionId: currentStatus.sessionId,
  });
});

refreshStatus();
