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
// every row of a store, one at a time (never the whole store in memory at once)
function eachOf(db, store, fn) {
  return new Promise((resolve, reject) => {
    const r = db.transaction([store], 'readonly').objectStore(store).openCursor();
    r.onsuccess = () => { const c = r.result; if (!c) return resolve(); fn(c.value); c.continue(); };
    r.onerror = () => reject(r.error);
  });
}
const BIG_ROW = 64 * 1024; // a row bigger than this (a document's text) goes in the binary part, not the header

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
async function unpack(v, bins, count) {
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await unpack(x, bins, count)); return out; }
  if (v && typeof v === 'object') {
    if ('__json' in v) { const b = bins[v.__json]; if (count) count.bytes += b.size; return unpack(JSON.parse(await b.data.text()), bins, count); }
    if ('__bin' in v) {
      const b = bins[v.__bin];
      if (count) count.bytes += b.size;
      // copy the bytes out of the picked file first: Safari can't store a piece of a file you picked
      // (it fails with "an internal error in the Indexed Database server")
      if (b.kind === 'blob') { const bytes = await b.data.arrayBuffer(); return b.name ? new File([bytes], b.name, { type: b.type || '' }) : new Blob([bytes], { type: b.type || '' }); }
      const buf = await b.data.arrayBuffer();
      if (b.kind === 'ab') return buf;
      const T = globalThis[b.kind];
      return typeof T === 'function' ? new T(buf) : buf;
    }
    if ('__date' in v) return new Date(v.__date);
    const o = {};
    for (const k in v) o[k] = await unpack(v[k], bins, count);
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
    for (const s of db.objectStoreNames) {
      const rows = [];
      await eachOf(db, s, (row) => {
        const packed = pack(row, parts);
        const json = JSON.stringify(packed);
        if (json.length > BIG_ROW) { parts.push({ data: new Blob([json]), kind: 'json' }); rows.push({ __json: parts.length - 1 }); }
        else rows.push(packed);
      });
      stores[s] = rows;
    }
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

function tx(db, s, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction([s], 'readwrite');
    fn(t.objectStore(s));
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('storage is full'));
  });
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
  const total = Object.values(header.dbs).reduce((t, d) => t + Object.values(d.stores).reduce((u, r) => u + r.length, 0), 0);
  let done = 0;
  async function restore(onProgress) {
    for (const [name, { version, stores }] of Object.entries(header.dbs)) {
      // open at the backup's version so missing stores get made (same app, same versions); a newer app here
      // already has a higher version, so then just open it as it is
      let db;
      try { db = await openDb(name, version, Object.keys(stores)); } catch (e) { if (e?.name !== 'VersionError') throw e; db = await openDb(name); }
      for (const [s, rows] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(s)) continue;
        await tx(db, s, (os) => os.clear());
        // a few documents at a time: each is read from the file only when it's saved, so a backup of any
        // size never has to fit in memory at once
        let batch = [];
        const count = { bytes: 0 };
        const flush = async () => {
          if (!batch.length) return;
          const b = batch; batch = []; count.bytes = 0;
          try { await tx(db, s, (os) => { for (const r of b) os.put(r); }); }
          catch (e) {
            // Safari's database sometimes drops a big write: reopen it and save these one at a time
            try { db.close(); } catch {}
            db = await openDb(name);
            for (const r of b) await tx(db, s, (os) => os.put(r));
          }
        };
        for (let i = 0; i < rows.length; i++) {
          batch.push(await unpack(rows[i], bins, count));
          if (count.bytes > 8e6 || batch.length >= 100) await flush();
          onProgress?.(++done, total);
        }
        await flush();
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
