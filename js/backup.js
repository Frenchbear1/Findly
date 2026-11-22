// Backup: everything in the app — documents (original files + their text), folders, linked pages, boards,
// themes, settings, shortcuts and the download helper — in one file, to move to another device and import there.
//
// File layout: "ISBACKUP1\n", a 12-digit header length, the header (JSON), then the binary parts back to back.
// Binary values (file bytes, pictures on boards) are swapped in the header for { __bin: i } markers.

const MAGIC = 'ISBACKUP1\n';
const DBS = ['instant-search', 'instant-search-boards'];
const LS_PREFIX = 'instant-search';

// open a database; with stores given, make any that are missing (all of the app's stores are keyed by id)
function openDb(name, version, stores = []) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
    req.onupgradeneeded = () => { for (const s of stores) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('close Instant Search in your other tabs and try again'));
  });
}
async function exists(name) {
  if (!indexedDB.databases) return true;
  try { return (await indexedDB.databases()).some((d) => d.name === name); } catch { return true; }
}
function allOf(db, store) {
  return new Promise((resolve, reject) => {
    const r = db.transaction([store], 'readonly').objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// swap binary values for markers; parts collects the bytes
function pack(v, parts) {
  if (v instanceof Blob) { parts.push({ data: v, kind: 'blob', type: v.type, name: v.name }); return { __bin: parts.length - 1 }; }
  if (v instanceof ArrayBuffer) { parts.push({ data: new Blob([v]), kind: 'ab' }); return { __bin: parts.length - 1 }; }
  if (ArrayBuffer.isView(v)) { parts.push({ data: new Blob([v]), kind: v.constructor.name }); return { __bin: parts.length - 1 }; }
  if (v instanceof Date) return { __date: v.getTime() };
  if (Array.isArray(v)) return v.map((x) => pack(x, parts));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = pack(v[k], parts); return o; }
  return v;
}
async function unpack(v, bins) {
  if (Array.isArray(v)) return Promise.all(v.map((x) => unpack(x, bins)));
  if (v && typeof v === 'object') {
    if ('__bin' in v) {
      const b = bins[v.__bin];
      if (b.kind === 'blob') return b.name ? new File([b.data], b.name, { type: b.type || '' }) : new Blob([b.data], { type: b.type || '' });
      const buf = await b.data.arrayBuffer();
      if (b.kind === 'ab') return buf;
      const T = globalThis[b.kind];
      return typeof T === 'function' ? new T(buf) : buf;
    }
    if ('__date' in v) return new Date(v.__date);
    const o = {};
    for (const k in v) o[k] = await unpack(v[k], bins);
    return o;
  }
  return v;
}

/** Builds the backup file. */
export async function makeBackup() {
  const parts = [];
  const dbs = {};
  for (const name of DBS) {
    if (!(await exists(name))) continue; // opening a database that isn't there would create an empty one
    let db;
    try { db = await openDb(name); } catch { continue; }
    const stores = {};
    for (const s of db.objectStoreNames) stores[s] = pack(await allOf(db, s), parts);
    dbs[name] = { version: db.version, stores };
    db.close();
  }
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS_PREFIX)) ls[k] = localStorage.getItem(k);
  }
  const header = JSON.stringify({
    app: 'Instant Search', v: 1, made: Date.now(),
    localStorage: ls, dbs,
    bins: parts.map((p) => ({ size: p.data.size, kind: p.kind, type: p.type || '', name: p.name || '' })),
  });
  const head = new TextEncoder().encode(header);
  return new Blob([MAGIC, String(head.length).padStart(12, '0'), head, ...parts.map((p) => p.data)], { type: 'application/octet-stream' });
}

/** Reads a backup file; returns a summary and a restore() that replaces everything on this device. */
export async function readBackup(file) {
  const start = await file.slice(0, MAGIC.length + 12).text();
  if (!start.startsWith(MAGIC)) throw new Error('this isn’t an Instant Search backup');
  const len = Number(start.slice(MAGIC.length));
  const at = new TextEncoder().encode(start).length; // the magic and length are plain ASCII
  const header = JSON.parse(await file.slice(at, at + len).text());
  let off = at + len;
  const bins = header.bins.map((b) => { const data = file.slice(off, off + b.size); off += b.size; return { ...b, data }; });
  if (off > file.size) throw new Error('the backup file is incomplete');
  const lib = header.dbs['instant-search']?.stores || {};
  const summary = {
    made: header.made,
    docs: (lib.docs || []).length,
    folders: (lib.folders || []).length,
    boards: (header.dbs['instant-search-boards']?.stores?.boards || []).length,
    size: file.size,
  };
  async function restore() {
    for (const [name, { version, stores }] of Object.entries(header.dbs)) {
      // open at the backup's version so missing stores get made (same app, same versions); a newer app here
      // already has a higher version, so then just open it as it is
      let db;
      try { db = await openDb(name, version, Object.keys(stores)); } catch (e) { if (e?.name !== 'VersionError') throw e; db = await openDb(name); }
      for (const [s, rows] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(s)) continue;
        const data = await unpack(rows, bins);
        await new Promise((resolve, reject) => {
          const t = db.transaction([s], 'readwrite');
          const os = t.objectStore(s);
          os.clear();
          for (const r of data) os.put(r);
          t.oncomplete = resolve;
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error || new Error('storage is full'));
        });
      }
      db.close();
    }
    const old = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREFIX)) old.push(k); }
    old.forEach((k) => localStorage.removeItem(k));
    for (const [k, v] of Object.entries(header.localStorage || {})) localStorage.setItem(k, v);
  }
  return { summary, restore };
}
