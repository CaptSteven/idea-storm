const SESSION_KEY = "sopflow_sessions";
const ACTIVE_TAB_KEY = "sopflow_active_tabs";

const getSessions = async () => {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return data[SESSION_KEY] || {};
};

const setSessions = async (sessions) => {
  await chrome.storage.local.set({ [SESSION_KEY]: sessions });
};

const getActiveTabs = async () => {
  const data = await chrome.storage.local.get(ACTIVE_TAB_KEY);
  return data[ACTIVE_TAB_KEY] || {};
};

const setActiveTabs = async (tabs) => {
  await chrome.storage.local.set({ [ACTIVE_TAB_KEY]: tabs });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SOPFLOW_CAPTURE_SCREENSHOT") {
    captureScreenshot(sender, sendResponse);
    return true;
  }

  if (message.type === "SOPFLOW_SAVE_SESSION") {
    saveSession(message.session, sender, sendResponse);
    return true;
  }

  if (message.type === "SOPFLOW_GET_SESSION") {
    getSession(message.sessionId, sendResponse);
    return true;
  }

  if (message.type === "SOPFLOW_GET_ACTIVE_SESSION") {
    getActiveSession(message.tabId, sendResponse);
    return true;
  }

  if (message.type === "SOPFLOW_CONTENT_READY") {
    getActiveSessionForSender(sender, sendResponse);
    return true;
  }

  if (message.type === "SOPFLOW_LIST_SESSIONS") {
    listSessions(sendResponse);
    return true;
  }

  if (message.type === "SOPFLOW_OPEN_DASHBOARD") {
    openDashboard(message.sessionId, sendResponse);
    return true;
  }

  return false;
});

const captureScreenshot = async (sender, sendResponse) => {
  try {
    if (!sender.tab?.windowId) {
      throw new Error("No active tab is available for screenshot capture.");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
      format: "jpeg",
      quality: 72,
    });
    sendResponse({ ok: true, dataUrl });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
};

const saveSession = async (session, sender, sendResponse) => {
  try {
    const sessions = await getSessions();
    const activeTabs = await getActiveTabs();
    const tabId = sender.tab?.id;

    sessions[session.id] = {
      ...session,
      tabId,
      updatedAt: new Date().toISOString(),
    };

    if (tabId && session.endedAt) {
      delete activeTabs[tabId];
    } else if (tabId) {
      activeTabs[tabId] = session.id;
    }

    await setSessions(sessions);
    await setActiveTabs(activeTabs);
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
};

const getSession = async (sessionId, sendResponse) => {
  try {
    const sessions = await getSessions();
    sendResponse({ ok: true, session: sessions[sessionId] || null });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
};

const listSessions = async (sendResponse) => {
  try {
    const sessions = await getSessions();
    const items = Object.values(sessions)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 20);
    sendResponse({ ok: true, sessions: items });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
};

const getActiveSession = async (tabId, sendResponse) => {
  try {
    const activeTabs = await getActiveTabs();
    const sessions = await getSessions();
    const sessionId = activeTabs[tabId];
    sendResponse({ ok: true, session: sessionId ? sessions[sessionId] || null : null });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
};

const getActiveSessionForSender = async (sender, sendResponse) => {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: true, session: null });
      return;
    }

    const activeTabs = await getActiveTabs();
    const sessions = await getSessions();
    const sessionId = activeTabs[tabId];
    sendResponse({ ok: true, session: sessionId ? sessions[sessionId] || null : null });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
};

const openDashboard = async (sessionId, sendResponse) => {
  try {
    const url = chrome.runtime.getURL(`dashboard.html?session=${encodeURIComponent(sessionId)}`);
    const tab = await chrome.tabs.create({ url });
    sendResponse({ ok: true, tabId: tab.id });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
};

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || tab.url.startsWith("chrome://")) {
    return;
  }

  const activeTabs = await getActiveTabs();
  const sessionId = activeTabs[tabId];
  if (!sessionId) return;

  const sessions = await getSessions();
  const session = sessions[sessionId];
  if (!session || session.endedAt) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tabId, {
      type: "SOPFLOW_RESUME",
      session,
    });
  } catch {
    // Some browser-managed pages cannot be scripted.
  }
});
