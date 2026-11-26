// Backup: everything in the app — documents (original files + their text), folders, linked pages, boards,
// themes, settings, shortcuts and the download helper — in one file, to move to another device and import there.
//
// File layout: "ISBACKUP1\n", a 12-digit header length, the header (JSON), then the binary parts back to back.
// Binary values (file bytes, pictures on boards) are swapped in the header for { __bin: i } markers.

import { isNative, readBytes, saveBytes, writeBytes, removeFile, listFiles } from './native.js';

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
    req.onblocked = () => reject(new Error('close Findly in your other tabs and try again'));
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
// big pieces are read 8 MB at a time so the import's progress can move while a large document comes in
async function readAll(b, count) {
  const size = b.data.size;
  if (size < 16e6 || !count?.part) return b.data.arrayBuffer();
  const out = new Uint8Array(size);
  const STEP = 8 * 1024 * 1024;
  for (let i = 0; i < size; i += STEP) {
    out.set(new Uint8Array(await b.data.slice(i, Math.min(size, i + STEP)).arrayBuffer()), i);
    count.part(Math.min(size, i + STEP) / size);
  }
  return out.buffer;
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
      if (b.kind === 'blob') { const bytes = await readAll(b, count); return b.name ? new File([bytes], b.name, { type: b.type || '' }) : new Blob([bytes], { type: b.type || '' }); }
      const buf = await readAll(b, count);
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

// ---- syncing without duplicates ----
// A document counts as already here when it's the same one (same id, same text) or the same text added separately
// (same text fingerprint, or same name and size). A document with the same id but different text is an update.
export async function inventory() {
  if (!(await exists('instant-search'))) return [];
  const db = await openDb('instant-search');
  const out = [];
  try { if (db.objectStoreNames.contains('docs')) await eachOf(db, 'docs', (d) => out.push({ id: d.id, name: d.name, size: d.size || 0, hash: d.hash || '' })); }
  finally { db.close(); }
  return out;
}
export function alreadyHere(have) {
  const byId = new Map(have.map((d) => [d.id, d]));
  const hashes = new Set(have.map((d) => d.hash).filter(Boolean));
  const named = new Set(have.map((d) => `${d.name}|${d.size}`));
  return (d) => {
    const mine = byId.get(d.id);
    if (mine) return !!d.hash && mine.hash === d.hash;
    return (d.hash && hashes.has(d.hash)) || named.has(`${d.name}|${d.size || 0}`);
  };
}
const DOC_STORES = new Set(['docs', 'texts', 'files']);
// what a document already on both devices takes from the other one when they're matched by contents, not id
const META = ['name', 'names', 'nameAs', 'folderId', 'source', 'enabled'];
const WATCHED = 'instant-search:watched', PREFS = 'instant-search:prefs';
async function localDocs() {
  if (!(await exists('instant-search'))) return [];
  const db = await openDb('instant-search');
  const out = [];
  try { if (db.objectStoreNames.contains('docs')) await eachOf(db, 'docs', (d) => out.push(d)); } finally { db.close(); }
  return out;
}
// On the iPhone page text lives in its own database, not here: the app hands over how to read it.
let textSource = null; // { ids(): [doc id], pages(id): Promise<[text]> }
export const setTextSource = (src) => { textSource = src; };

/** The backup as a stream: the header bytes, then parts that are only read when they're needed (so a library of any
 *  size can be sent to another device or written to a file a piece at a time). */
export async function backupStream({ have = null } = {}) {
  const parts = [];
  const dbs = {};
  let skip = new Set(), sending = 0;
  const sizes = isNative ? new Map((await listFiles()).map((f) => [f.path, f.size])) : null;
  for (const name of DBS) {
    if (!(await exists(name))) continue; // opening a database that isn't there would create an empty one
    let db;
    try { db = await openDb(name); } catch { continue; }
    const stores = {};
    if (have && name === 'instant-search' && db.objectStoreNames.contains('docs')) { // syncing: leave out what the other device has
      const here = alreadyHere(have);
      await eachOf(db, 'docs', (d) => { if (here(d)) skip.add(d.id); else sending++; });
    } else if (name === 'instant-search' && db.objectStoreNames.contains('docs')) await eachOf(db, 'docs', () => sending++);
    for (const s of db.objectStoreNames) {
      const rows = [];
      // a document the other device already has still sends its details (names, folder, link, …) — just not its
      // file or its text again
      const skipped = (row) => name === 'instant-search' && DOC_STORES.has(s) && s !== 'docs' && skip.has(row.id);
      // in the iPhone app the documents themselves are files in the library folder: they're read when they're sent
      if (isNative && s === 'files') {
        const recs = [];
        await eachOf(db, s, (row) => recs.push(row));
        for (const r of recs) {
          if (skipped(r)) continue;
          if (!r.path) { rows.push(pack(r, parts)); continue; }
          if (r.text) {
            let bytes;
            try { bytes = await readBytes(r.path); } catch { continue; }
            rows.push(pack({ id: r.id, bytes: new TextDecoder().decode(bytes) }, parts));
            continue;
          }
          if (!sizes.has(r.path)) continue;
          parts.push({ size: sizes.get(r.path), kind: 'blob', read: async () => new Blob([await readBytes(r.path)]) });
          rows.push({ id: r.id, bytes: { __bin: parts.length - 1 } });
        }
        stores[s] = rows;
        continue;
      }
      if (s === 'texts' && textSource && name === 'instant-search') {
        // each document's text is read for the backup when it's sent (measured now, read again then, so
        // never the whole library's text in memory at once)
        for (const id of textSource.ids()) {
          if (skip.has(id)) continue;
          const size = new TextEncoder().encode(JSON.stringify({ id, pages: await textSource.pages(id) })).length;
          parts.push({ size, kind: 'json', read: async () => new Blob([JSON.stringify({ id, pages: await textSource.pages(id) })]) });
          rows.push({ __json: parts.length - 1, id });
        }
        await eachOf(db, s, (row) => { if (!skipped(row) && !rows.some((r) => r.id === row.id)) rows.push(pack(row, parts)); });
        stores[s] = rows;
        continue;
      }
      await eachOf(db, s, (row) => {
        if (skipped(row)) return;
        const packed = pack(row, parts);
        const json = JSON.stringify(packed);
        if (json.length > BIG_ROW) { parts.push({ data: new Blob([json]), kind: 'json' }); rows.push({ __json: parts.length - 1, id: row.id }); }
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
  const lib = dbs['instant-search']?.stores || {};
  const header = JSON.stringify({
    app: 'Findly', v: 1, made: Date.now(),
    localStorage: ls, dbs,
    bins: parts.map((p) => ({ size: p.data ? p.data.size : p.size, kind: p.kind, type: p.type || '', name: p.name || '' })),
  });
  const json = new TextEncoder().encode(header);
  const head = new Uint8Array([...new TextEncoder().encode(MAGIC + String(json.length).padStart(12, '0')), ...json]);
  const size = head.length + parts.reduce((t, p) => t + (p.data ? p.data.size : p.size), 0);
  return {
    head, size,
    summary: { docs: (lib.docs || []).length, sending, folders: (lib.folders || []).length },
    parts: parts.map((p) => ({ size: p.data ? p.data.size : p.size, read: p.data ? async () => p.data : p.read })),
  };
}

/** Builds the backup file (all of it, as one Blob: for browsers). */
export async function makeBackup() {
  const st = await backupStream();
  const blobs = [];
  for (const p of st.parts) blobs.push(await p.read());
  return new Blob([st.head, ...blobs], { type: 'application/octet-stream' });
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
  if (!start.startsWith(MAGIC)) throw new Error('this isn’t a Findly backup');
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
  // progress goes by bytes, not rows: a 200 MB manual moves the bar 200 MB worth, a settings row barely at all
  const weigh = (v) => {
    if (Array.isArray(v)) return v.reduce((t, x) => t + weigh(x), 0);
    if (v && typeof v === 'object') {
      if ('__bin' in v) return bins[v.__bin]?.size || 0;
      if ('__json' in v) return bins[v.__json]?.size || 0;
      let t = 0;
      for (const k in v) t += weigh(v[k]);
      return t;
    }
    return 0;
  };
  const ROW = 2048; // a little for every row, so many small rows still move the bar
  const total = Object.values(header.dbs).reduce((t, d) => t + Object.values(d.stores).reduce((u, rows) => u + rows.reduce((w, r) => w + ROW + weigh(r), 0), 0), 0) || 1;
  let done = 0, metaChanged = 0;
  // merge: add what's new and update what changed, keep everything else here (and this device's settings)
  async function restore(onProgress, { merge = false } = {}) {
    const here = merge ? alreadyHere(await inventory()) : null;
    const skip = new Set();
    if (merge) for (const d of await unpack(lib.docs || [], bins)) if (here(d)) skip.add(d.id);
    // the documents already here, so their details can be brought up to date without touching their files
    const mine = merge ? await localDocs() : [];
    const mineById = new Map(mine.map((d) => [d.id, d]));
    const twin = (d) => mineById.get(d.id) || mine.find((m) => (d.hash && m.hash === d.hash) || (m.name === d.name && (m.size || 0) === (d.size || 0)));
    for (const [name, { version, stores }] of Object.entries(header.dbs)) {
      // open at the backup's version so missing stores get made (same app, same versions); a newer app here
      // already has a higher version, so then just open it as it is
      let db;
      try { db = await openDb(name, version, Object.keys(stores)); } catch (e) { if (e?.name !== 'VersionError') throw e; db = await openDb(name); }
      for (const [s, rows] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(s)) continue;
        const existing = new Map();
        if (merge && isNative && s === 'files') {
          const old = await new Promise((res, rej) => { const r = db.transaction([s], 'readonly').objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
          for (const r of old) if (r.path) existing.set(r.id, r.path);
        }
        if (merge) { /* nothing is cleared */ } else if (isNative && s === 'files') { // replacing everything: the old documents' files go too
          const old = await new Promise((res, rej) => { const r = db.transaction([s], 'readonly').objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
          for (const r of old) if (r.path) await removeFile(r.path);
        }
        if (!merge) await tx(db, s, (os) => os.clear());
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
        const names = new Map((await unpack(stores.docs || [], bins)).map((d) => [d.id, d.name]));
        for (let i = 0; i < rows.length; i++) {
          const docRow = name === 'instant-search' && DOC_STORES.has(s);
          const w = ROW + weigh(rows[i]);
          const step = () => { done += w; onProgress?.(Math.min(done, total), total); };
          if (merge && docRow && s === 'docs' && rows[i].id != null && skip.has(rows[i].id)) {
            // already here: take the other device's details for it (its names, folder, link, how it's shown)
            const d = await unpack(rows[i], bins);
            const m = twin(d);
            if (m) {
              const upd = m.id === d.id ? { ...m, ...d } : { ...m, ...Object.fromEntries(META.filter((k) => k in d).map((k) => [k, d[k]])) };
              if (JSON.stringify(upd) !== JSON.stringify(m)) { batch.push(upd); metaChanged++; }
            }
            step(); continue;
          }
          if (merge && docRow && rows[i].id != null && skip.has(rows[i].id)) { step(); continue; }
          const readShare = isNative && s === 'files' ? 0.45 : 0.9; // in the app, writing the file is the other half
          count.part = (f) => onProgress?.(Math.min(done + w * readShare * f, total), total);
          let row = await unpack(rows[i], bins, count);
          count.part = null;
          if (merge && docRow && skip.has(row.id)) { step(); continue; }
          // in the iPhone app, documents go back into the library folder as real files
          if (isNative && s === 'files' && row.bytes != null) {
            const text = typeof row.bytes === 'string';
            let path = existing.get(row.id); // an update to a document already here: same file, new contents
            const part = (f) => onProgress?.(Math.min(done + w * (readShare + (1 - readShare) * f), total), total); // a big file moves the bar as it's written
            if (path) await writeBytes(path, row.bytes, part);
            else path = await saveBytes(names.get(row.id) || `${row.id}.pdf`, row.bytes, '', part);
            row = { id: row.id, path, text };
            count.bytes = 0;
          }
          batch.push(row);
          if (count.bytes > 8e6 || batch.length >= 100) await flush();
          step();
        }
        await flush();
      }
      db.close();
    }
    if (merge) { // this device keeps its own look and settings; the library's own bits still come across
      const theirs = header.localStorage || {};
      try { // pages being watched for new documents
        const a = JSON.parse(localStorage.getItem(WATCHED) || '[]'), b = JSON.parse(theirs[WATCHED] || '[]');
        const urls = new Set(a.map((w) => w.url));
        const all = [...a.map((w) => b.find((x) => x.url === w.url) ? { ...w, ...b.find((x) => x.url === w.url) } : w), ...b.filter((w) => !urls.has(w.url))];
        if (b.length) localStorage.setItem(WATCHED, JSON.stringify(all));
      } catch {}
      try { // how document names are shown
        const tp = JSON.parse(theirs[PREFS] || 'null');
        if (tp && tp.nameAs) { const mp = JSON.parse(localStorage.getItem(PREFS) || '{}'); mp.nameAs = tp.nameAs; localStorage.setItem(PREFS, JSON.stringify(mp)); }
      } catch {}
      return;
    }
    const old = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREFIX)) old.push(k); }
    old.forEach((k) => localStorage.removeItem(k));
    for (const [k, v] of Object.entries(header.localStorage || {})) localStorage.setItem(k, v);
  }
  /** How many documents already here had their details changed by the last merge. */
  const metaCount = () => metaChanged;
  /** How many of the backup's documents are new or changed here. */
  async function fresh() {
    const here = alreadyHere(await inventory());
    return (await unpack(lib.docs || [], bins)).filter((d) => !here(d)).length;
  }
  return { summary, restore, fresh, metaCount };
}
