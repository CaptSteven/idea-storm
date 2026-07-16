importScripts("shared.js", "storage.js");

const ACTIVE_TAB_KEY = "sopflow_active_tabs";
const SETTINGS_KEY = "sopflow_settings";
const LEGACY_SESSION_KEY = "sopflow_sessions";
const MIGRATION_KEY = "sopflow_migration_v2";
let migrationPromise = null;

const getActiveTabs = async () => {
  const data = await chrome.storage.local.get(ACTIVE_TAB_KEY);
  return data[ACTIVE_TAB_KEY] || {};
};

const setActiveTabs = async (tabs) => {
  await chrome.storage.local.set({ [ACTIVE_TAB_KEY]: tabs });
};

const getSettings = async () => {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...SOPFlowShared.DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
};

const setSettings = async (patch) => {
  const settings = { ...(await getSettings()), ...(patch || {}) };
  settings.screenshotsEnabled = settings.screenshotsEnabled !== false;
  settings.autoRedact = settings.autoRedact !== false;
  settings.backendUrl = SOPFlowShared.normalizeLocalBackendUrl(settings.backendUrl);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
};

chrome.runtime.onInstalled.addListener(() => {
  void migrateLegacySessions();
});

chrome.runtime.onStartup.addListener(() => {
  void migrateLegacySessions();
});

void migrateLegacySessions();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "扩展操作失败。" }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "SOPFLOW_CAPTURE_SCREENSHOT":
      return captureAndStoreScreenshot(message, sender);
    case "SOPFLOW_SAVE_SESSION":
      return saveSession(message.session, sender);
    case "SOPFLOW_GET_SESSION":
      return { session: (await SOPFlowStorage.getSession(message.sessionId)) || null };
    case "SOPFLOW_LIST_SESSIONS":
      return { sessions: await SOPFlowStorage.listSessions() };
    case "SOPFLOW_DELETE_SESSION":
      await SOPFlowStorage.deleteSession(message.sessionId);
      return {};
    case "SOPFLOW_DUPLICATE_SESSION":
      return { session: await SOPFlowStorage.duplicateSession(message.sessionId) };
    case "SOPFLOW_DELETE_SCREENSHOT":
      await SOPFlowStorage.deleteScreenshot(message.screenshotId);
      return {};
    case "SOPFLOW_GET_SCREENSHOT":
      return getScreenshotData(message.screenshotId);
    case "SOPFLOW_GET_ACTIVE_SESSION":
      return { session: await getActiveSession(message.tabId) };
    case "SOPFLOW_CONTENT_READY":
      return { session: await getActiveSession(sender.tab?.id) };
    case "SOPFLOW_OPEN_DASHBOARD":
      return openDashboard(message.sessionId);
    case "SOPFLOW_GET_SETTINGS":
      return { settings: await getSettings() };
    case "SOPFLOW_SET_SETTINGS":
      return { settings: await setSettings(message.settings) };
    case "SOPFLOW_STORAGE_ESTIMATE":
      return getStorageEstimate();
    case "SOPFLOW_IMPORT_SESSION":
      return { session: await importSession(message.payload) };
    default:
      throw new Error("Unsupported SOPFlow message.");
  }
}

async function saveSession(session, sender) {
  const normalized = await SOPFlowStorage.putSession(session);
  const activeTabs = await getActiveTabs();
  const tabId = sender.tab?.id || normalized.tabId;
  if (tabId) {
    if (normalized.status === "recording") activeTabs[tabId] = normalized.id;
    else delete activeTabs[tabId];
    await setActiveTabs(activeTabs);
  }
  return { session: normalized };
}

async function getActiveSession(tabId) {
  if (!tabId) return null;
  const activeTabs = await getActiveTabs();
  const sessionId = activeTabs[tabId];
  if (!sessionId) return null;
  const session = await SOPFlowStorage.getSession(sessionId);
  return session?.status === "recording" ? session : null;
}

async function openDashboard(sessionId) {
  const suffix = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${suffix}`) });
  return { tabId: tab.id };
}

async function captureAndStoreScreenshot(message, sender) {
  if (!sender.tab?.windowId) throw new Error("没有可截图的活动页面。");
  const settings = await getSettings();
  if (!settings.screenshotsEnabled) return { screenshotId: null, skipped: true };

  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
    format: "jpeg",
    quality: 78,
  });
  const blob = await processScreenshot(dataUrl, {
    rects: settings.autoRedact ? message.sensitiveRects || [] : [],
    viewportWidth: Number(message.viewportWidth || 0),
    viewportHeight: Number(message.viewportHeight || 0),
  });
  const screenshotId = SOPFlowShared.createId();
  await SOPFlowStorage.putScreenshot({
    id: screenshotId,
    sessionId: message.sessionId,
    stepId: message.stepId,
    blob,
    size: blob.size,
    createdAt: new Date().toISOString(),
  });
  return { screenshotId };
}

async function processScreenshot(dataUrl, options) {
  const sourceBlob = await (await fetch(dataUrl)).blob();
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    if (options.rects.length) throw new Error("当前浏览器无法执行截图脱敏，已取消这张截图。");
    return sourceBlob;
  }

  const bitmap = await createImageBitmap(sourceBlob);
  const outputScale = Math.min(1, 1440 / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * outputScale));
  const height = Math.max(1, Math.round(bitmap.height * outputScale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    if (options.rects.length) throw new Error("当前浏览器无法执行截图脱敏，已取消这张截图。");
    return sourceBlob;
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const viewportWidth = options.viewportWidth || bitmap.width;
  const viewportHeight = options.viewportHeight || bitmap.height;
  const sourceScaleX = bitmap.width / viewportWidth;
  const sourceScaleY = bitmap.height / viewportHeight;

  for (const rect of options.rects.slice(0, 60)) {
    const sourceX = Math.max(0, Number(rect.x || 0) * sourceScaleX);
    const sourceY = Math.max(0, Number(rect.y || 0) * sourceScaleY);
    const sourceWidth = Math.min(bitmap.width - sourceX, Number(rect.width || 0) * sourceScaleX);
    const sourceHeight = Math.min(bitmap.height - sourceY, Number(rect.height || 0) * sourceScaleY);
    if (sourceWidth < 2 || sourceHeight < 2) continue;

    const outputX = sourceX * outputScale;
    const outputY = sourceY * outputScale;
    const outputWidth = sourceWidth * outputScale;
    const outputHeight = sourceHeight * outputScale;
    context.save();
    context.beginPath();
    context.rect(outputX, outputY, outputWidth, outputHeight);
    context.clip();
    if ("filter" in context) {
      context.filter = "blur(18px)";
      context.drawImage(
        bitmap,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        outputX,
        outputY,
        outputWidth,
        outputHeight,
      );
    } else {
      context.fillStyle = "#697773";
      context.fillRect(outputX, outputY, outputWidth, outputHeight);
    }
    context.restore();
  }

  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
}

async function getScreenshotData(id) {
  if (!id) return { dataUrl: "" };
  const screenshot = await SOPFlowStorage.getScreenshot(id);
  if (!screenshot?.blob) return { dataUrl: "" };
  return { dataUrl: await blobToDataUrl(screenshot.blob), size: screenshot.size || screenshot.blob.size };
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

async function migrateLegacySessions() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = runLegacyMigration();
  return migrationPromise;
}

async function runLegacyMigration() {
  const state = await chrome.storage.local.get([MIGRATION_KEY, LEGACY_SESSION_KEY]);
  if (state[MIGRATION_KEY]) return;
  const legacy = state[LEGACY_SESSION_KEY] || {};

  for (const rawSession of Object.values(legacy)) {
    const sessionId = rawSession.id || SOPFlowShared.createId();
    const migratedSteps = [];
    for (const rawStep of rawSession.steps || []) {
      let screenshotId = rawStep.screenshotId || null;
      if (!screenshotId && typeof rawStep.image === "string" && rawStep.image.startsWith("data:")) {
        screenshotId = SOPFlowShared.createId();
        const blob = await dataUrlToBlob(rawStep.image);
        await SOPFlowStorage.putScreenshot({
          id: screenshotId,
          sessionId,
          stepId: rawStep.id,
          blob,
          size: blob.size,
          createdAt: new Date().toISOString(),
        });
      }
      migratedSteps.push({ ...rawStep, image: undefined, screenshotId });
    }
    await SOPFlowStorage.putSession({ ...rawSession, id: sessionId, steps: migratedSteps });
  }

  await chrome.storage.local.remove(LEGACY_SESSION_KEY);
  await chrome.storage.local.set({ [MIGRATION_KEY]: new Date().toISOString() });
}

async function importSession(payload) {
  if (!payload || typeof payload !== "object") throw new Error("导入文件不是有效的 SOPFlow JSON。");
  const raw = payload.session || payload;
  const newId = SOPFlowShared.createId();
  const session = SOPFlowShared.normalizeSession({
    ...raw,
    id: newId,
    status: "complete",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aiSop: null,
    steps: (raw.steps || []).map((step) => ({ ...step, id: SOPFlowShared.createId(), screenshotId: null })),
  });

  const screenshotMap = payload.screenshots || {};
  for (const step of session.steps) {
    const original = raw.steps?.[step.order];
    const dataUrl = screenshotMap[original?.screenshotId] || original?.image;
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      const blob = await dataUrlToBlob(dataUrl);
      const screenshotId = SOPFlowShared.createId();
      await SOPFlowStorage.putScreenshot({
        id: screenshotId,
        sessionId: newId,
        stepId: step.id,
        blob,
        size: blob.size,
        createdAt: new Date().toISOString(),
      });
      step.screenshotId = screenshotId;
    }
  }
  return SOPFlowStorage.putSession(session);
}

async function getStorageEstimate() {
  const estimate = await navigator.storage?.estimate?.();
  return {
    usage: Number(estimate?.usage || 0),
    quota: Number(estimate?.quota || 0),
  };
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const activeTabs = await getActiveTabs();
  if (activeTabs[tabId]) {
    delete activeTabs[tabId];
    await setActiveTabs(activeTabs);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || /^(chrome|edge|about):/.test(tab.url)) return;
  const session = await getActiveSession(tabId);
  if (!session) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["shared.js", "content.js"],
    });
    await chrome.tabs.sendMessage(tabId, { type: "SOPFLOW_RESUME", session });
  } catch {
    // Browser-managed and restricted pages cannot be scripted.
  }
});
