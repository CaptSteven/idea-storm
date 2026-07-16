(function attachSopFlowStorage(root) {
  const DB_NAME = "sopflow";
  const DB_VERSION = 2;
  const SESSION_STORE = "sessions";
  const SCREENSHOT_STORE = "screenshots";

  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          const sessions = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
          sessions.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {
          const screenshots = db.createObjectStore(SCREENSHOT_STORE, { keyPath: "id" });
          screenshots.createIndex("sessionId", "sessionId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }

  async function withStore(storeName, mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
    });
  }

  async function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putSession(session) {
    const normalized = SOPFlowShared.normalizeSession({
      ...session,
      updatedAt: new Date().toISOString(),
    });
    await withStore(SESSION_STORE, "readwrite", (store) => store.put(normalized));
    return normalized;
  }

  async function getSession(id) {
    const db = await openDatabase();
    const tx = db.transaction(SESSION_STORE, "readonly");
    return requestValue(tx.objectStore(SESSION_STORE).get(id));
  }

  async function listSessions() {
    const db = await openDatabase();
    const tx = db.transaction(SESSION_STORE, "readonly");
    const items = await requestValue(tx.objectStore(SESSION_STORE).getAll());
    return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function putScreenshot(record) {
    await withStore(SCREENSHOT_STORE, "readwrite", (store) => store.put(record));
    return record;
  }

  async function getScreenshot(id) {
    const db = await openDatabase();
    const tx = db.transaction(SCREENSHOT_STORE, "readonly");
    return requestValue(tx.objectStore(SCREENSHOT_STORE).get(id));
  }

  async function deleteScreenshot(id) {
    await withStore(SCREENSHOT_STORE, "readwrite", (store) => store.delete(id));
  }

  async function getScreenshotsForSession(sessionId) {
    const db = await openDatabase();
    const tx = db.transaction(SCREENSHOT_STORE, "readonly");
    const index = tx.objectStore(SCREENSHOT_STORE).index("sessionId");
    return requestValue(index.getAll(IDBKeyRange.only(sessionId)));
  }

  async function deleteSession(id) {
    const screenshots = await getScreenshotsForSession(id);
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([SESSION_STORE, SCREENSHOT_STORE], "readwrite");
      tx.objectStore(SESSION_STORE).delete(id);
      const shotStore = tx.objectStore(SCREENSHOT_STORE);
      screenshots.forEach((shot) => shotStore.delete(shot.id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function duplicateSession(id) {
    const source = await getSession(id);
    if (!source) return null;
    const newId = SOPFlowShared.createId();
    const stepIdMap = new Map(source.steps.map((step) => [step.id, SOPFlowShared.createId()]));
    const screenshotMap = new Map();
    const screenshots = await getScreenshotsForSession(id);
    for (const shot of screenshots) {
      const nextId = SOPFlowShared.createId();
      screenshotMap.set(shot.id, nextId);
      await putScreenshot({
        ...shot,
        id: nextId,
        sessionId: newId,
        stepId: stepIdMap.get(shot.stepId) || null,
      });
    }
    const copy = SOPFlowShared.normalizeSession({
      ...source,
      id: newId,
      title: `${source.title} 副本`,
      status: "complete",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      aiSop: null,
      steps: source.steps.map((step) => ({
        ...step,
        id: stepIdMap.get(step.id),
        screenshotId: screenshotMap.get(step.screenshotId) || null,
      })),
    });
    return putSession(copy);
  }

  root.SOPFlowStorage = {
    openDatabase,
    putSession,
    getSession,
    listSessions,
    deleteSession,
    duplicateSession,
    putScreenshot,
    getScreenshot,
    deleteScreenshot,
    getScreenshotsForSession,
  };
})(globalThis);
