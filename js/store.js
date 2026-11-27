// Tiny IndexedDB wrapper. Documents live on this device only.
// stores: docs (metadata), texts (page text per doc), files (original PDF bytes for the page view), folders

import { isNative, readBytes, saveBytes, writeBytes, removeFile, nativeIndex } from './native.js';

// In the iPhone app a document's original file is a real file in the library folder (On My iPhone › Instant Search);
// the database only remembers which file is whose. In a browser the bytes go in the database as before.
const diskPath = new Map(); // id -> path, for documents found in the folder (already on disk)
export const setDiskPath = (id, path) => diskPath.set(id, path);
export const getDiskPath = (id) => diskPath.get(id);
/** Library-folder files already being added (not saved yet): a folder scan mustn't add them a second time. */
export const pendingDiskPaths = () => new Set(diskPath.values());

const DB_NAME = 'instant-search';
const DB_VERSION = 2;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const out = fn(t);
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
      })
  );
}

export const store = {
  async allDocs() {
    return tx(['docs'], 'readonly', (t) => t.objectStore('docs').getAll());
  },
  async allFolders() {
    return tx(['folders'], 'readonly', (t) => t.objectStore('folders').getAll());
  },
  async putFolders(folders) {
    return tx(['folders'], 'readwrite', (t) => folders.forEach((f) => t.objectStore('folders').put(f)));
  },
  async deleteFolder(id) {
    return tx(['folders'], 'readwrite', (t) => t.objectStore('folders').delete(id));
  },
  async allTexts() {
    return tx(['texts'], 'readonly', (t) => t.objectStore('texts').getAll());
  },
  /** Ids of documents whose text is in this database (one at a time from here: see textOf). */
  async textIds() {
    return tx(['texts'], 'readonly', (t) => t.objectStore('texts').getAllKeys());
  },
  async textOf(id) {
    return tx(['texts'], 'readonly', (t) => t.objectStore('texts').get(id));
  },
  async dropText(id) {
    return tx(['texts'], 'readwrite', (t) => t.objectStore('texts').delete(id));
  },
  async addDoc(meta, pages, fileBytes) {
    let rec = fileBytes ? { id: meta.id, bytes: fileBytes } : null;
    if (isNative && (fileBytes || diskPath.has(meta.id))) {
      const text = typeof fileBytes === 'string';
      let path = diskPath.get(meta.id);
      diskPath.delete(meta.id);
      if (!path) {
        const old = await tx(['files'], 'readonly', (t) => t.objectStore('files').get(meta.id));
        if (old?.path) { path = old.path; await writeBytes(path, fileBytes); } // a newer version: same file, new contents
        else path = await saveBytes(meta.name, fileBytes);
      }
      rec = { id: meta.id, path, text };
    }
    return tx(['docs', 'texts', 'files'], 'readwrite', (t) => {
      t.objectStore('docs').put(meta);
      // the iPhone keeps page text in its own database (S.texts writes it there), not in this one
      if (!nativeIndex) t.objectStore('texts').put({ id: meta.id, pages });
      if (rec) t.objectStore('files').put(rec);
    });
  },
  /** id -> path of every document kept as a file in the library folder (iPhone app). */
  async paths() {
    const all = await tx(['files'], 'readonly', (t) => t.objectStore('files').getAll());
    return new Map(all.filter((r) => r.path).map((r) => [r.id, r.path]));
  },
  /** A document's file moved within the library folder. */
  async setPath(id, path) {
    return tx(['files'], 'readwrite', (t) => {
      const os = t.objectStore('files');
      const g = os.get(id);
      g.onsuccess = () => { if (g.result) os.put({ ...g.result, path }); };
    });
  },
  async updateDoc(meta) {
    return tx(['docs'], 'readwrite', (t) => t.objectStore('docs').put(meta));
  },
  async updateDocs(metas) {
    return tx(['docs'], 'readwrite', (t) => metas.forEach((m) => t.objectStore('docs').put(m)));
  },
  async file(id) {
    const rec = await tx(['files'], 'readonly', (t) => t.objectStore('files').get(id));
    if (rec?.path) { const b = await readBytes(rec.path); return rec.text ? new TextDecoder().decode(b) : b; }
    return rec ? rec.bytes : null;
  },
  async deleteDoc(id, { keepFile = false } = {}) {
    if (isNative && !keepFile) {
      const rec = await tx(['files'], 'readonly', (t) => t.objectStore('files').get(id)).catch(() => null);
      if (rec?.path) await removeFile(rec.path);
    }
    return tx(['docs', 'texts', 'files'], 'readwrite', (t) => {
      t.objectStore('docs').delete(id);
      t.objectStore('texts').delete(id);
      t.objectStore('files').delete(id);
    });
  },
  async clear() {
    if (isNative) for (const path of (await this.paths()).values()) await removeFile(path);
    return tx(['docs', 'texts', 'files', 'folders'], 'readwrite', (t) => {
      t.objectStore('docs').clear();
      t.objectStore('texts').clear();
      t.objectStore('files').clear();
      t.objectStore('folders').clear();
    });
  },
  // Safari can leave its database stuck ("an internal error was encountered in the Indexed Database
  // server") after a failed big write; only deleting it and starting fresh gets it working again.
  async rebuild() {
    try { (await dbPromise)?.close(); } catch {}
    dbPromise = null;
    for (const name of ['instant-search', 'instant-search-boards']) {
      await new Promise((resolve) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
    }
  },
};
export const stuckStorage = (e) => /internal error|Indexed Database server|UnknownError/i.test(`${e?.name} ${e?.message}`);
