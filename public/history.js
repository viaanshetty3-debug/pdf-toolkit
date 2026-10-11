// IndexedDB-backed history of processed files. Keeps the actual blobs so the
// user can re-download without re-running the tool.

const DB_NAME = 'pdftk-history';
const STORE = 'files';
const MAX_ENTRIES = 20;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function recordHistory({ tool, filename, blob }) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.add({ tool, filename, blob, size: blob.size, type: blob.type, when: Date.now() });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    // Trim to MAX_ENTRIES most recent.
    const all = await getHistory();
    if (all.length > MAX_ENTRIES) {
      const toDelete = all.slice(MAX_ENTRIES).map(e => e.id);
      const tx2 = db.transaction(STORE, 'readwrite');
      for (const id of toDelete) tx2.objectStore(STORE).delete(id);
    }
  } catch { /* history is a nice-to-have, never break the main flow */ }
}

export async function getHistory() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.when - a.when));
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

export async function clearHistory() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await new Promise(r => tx.oncomplete = r);
}

export async function deleteHistoryEntry(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await new Promise(r => tx.oncomplete = r);
}
