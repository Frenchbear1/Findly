// Where the library's page text lives.
//
// In a browser (and on Windows) it's all in memory: a Map of document id -> page texts, mirrored to the search
// worker. On the iPhone that doesn't scale: tens of thousands of pages are hundreds of megabytes, and iOS stops
// an app using that much. There the text lives in a database on the phone (see ISIndexPlugin) and only what's
// on screen is kept here: page counts and lengths for every document, and an LRU cache of recent pages.
//
// Both look the same to the rest of the app:
//   has(id), count(id), len(id, n), peek(id, n)  — right away
//   get(id)                                      — page list (a stand-in on the iPhone: length right, text
//                                                  only for pages already fetched; prefer the calls below)
//   page(id, n), load(id, from, to), all(id)     — the text, fetched if need be
//   set(id, pages), delete(id), clear(), keys(), values(), size
import { Index } from './native.js';

const CACHE_PAGES = 600;

export class NativeTexts {
  constructor() {
    this.lens = new Map(); // id -> [characters per page]
    this.cache = new Map(); // `${id}:${n}` -> text, least recently used first
    this.waits = new Map(); // `${id}:${from}` -> pending fetch
    this.fts = false;
  }
  async init() {
    const r = await Index.info();
    this.fts = !!r.fts;
    this.lens = new Map(Object.entries(r.docs || {}));
    this.openings = new Map();
    Index.openings().then((o) => { this.openings = new Map(Object.entries(o.docs || {})); }).catch(() => {});
  }
  /** The start of a document's first page with text (for short descriptions; '' until read). */
  opening(id) { return this.openings?.get(id) || ''; }
  /** Takes a document out of the library for now (Undo can put it back): its text stays in the database. */
  detach(id) {
    const lens = this.lens.get(id);
    this.lens.delete(id);
    return lens;
  }
  attach(id, lens) { if (lens) this.lens.set(id, lens); }
  /** Deletes a detached document's text for good. */
  forget(id) { if (!this.lens.has(id)) Index.remove({ ids: [id] }).catch(() => {}); }
  get size() { return this.lens.size; }
  has(id) { return this.lens.has(id); }
  keys() { return this.lens.keys(); }
  values() { return this.lens.values(); } // arrays as long as each document (used for sizes)
  count(id) { return this.lens.get(id)?.length || 0; }
  len(id, n) { return this.lens.get(id)?.[n] || 0; }
  peek(id, n) {
    const k = `${id}:${n}`;
    const t = this.cache.get(k);
    if (t !== undefined) { this.cache.delete(k); this.cache.set(k, t); }
    return t;
  }
  remember(id, n, t) {
    const k = `${id}:${n}`;
    this.cache.delete(k);
    this.cache.set(k, t);
    while (this.cache.size > CACHE_PAGES) this.cache.delete(this.cache.keys().next().value);
  }
  /** Pages from..<to of a document into the cache. */
  async load(id, from, to) {
    const n = this.count(id);
    from = Math.max(0, from); to = Math.min(n, to);
    let a = from;
    while (a < to && this.cache.has(`${id}:${a}`)) a++;
    let b = to;
    while (b > a && this.cache.has(`${id}:${b - 1}`)) b--;
    if (a >= b) return;
    const key = `${id}:${a}:${b}`;
    if (!this.waits.has(key)) {
      this.waits.set(key, Index.pages({ id, from: a, to: b }).then((r) => {
        (r.pages || []).forEach((t, i) => this.remember(id, a + i, t));
      }).finally(() => this.waits.delete(key)));
    }
    await this.waits.get(key);
  }
  async page(id, n) {
    const t = this.peek(id, n);
    if (t !== undefined) return t;
    await this.load(id, n, n + 1);
    return this.peek(id, n) ?? '';
  }
  /** Every page of a document (not kept in the cache: for the rare whole-document jobs). */
  async all(id) {
    const out = [];
    const n = this.count(id);
    for (let a = 0; a < n; a += 400) out.push(...((await Index.pages({ id, from: a, to: a + 400 })).pages || []));
    return out;
  }
  /** A stand-in page list: the right length; a page's text if it's been fetched, otherwise ''. */
  get(id) {
    if (!this.lens.has(id)) return undefined;
    const self = this;
    return new Proxy([], {
      get(_, k) {
        if (k === 'length') return self.count(id);
        if (k === '_textsOf') return id;
        if (typeof k === 'string' && /^\d+$/.test(k)) return self.peek(id, Number(k)) ?? '';
        return Array.prototype[k];
      },
      has(_, k) { return k === 'length' || (typeof k === 'string' && /^\d+$/.test(k) && Number(k) < self.count(id)); },
    });
  }
  /** Stores a document's pages (in parts, so a huge document isn't sent in one go). */
  set(id, pages) {
    if (pages && pages._textsOf) { // a copy of another document's pages
      const from = pages._textsOf;
      this.lens.set(id, [...(this.lens.get(from) || [])]);
      this.all(from).then((all) => this.write(id, all)).catch(() => {});
      return this;
    }
    pages = pages || [];
    this.lens.set(id, pages.map((p) => p.length));
    const first = pages.slice(0, 4).find((p) => p.trim());
    if (first) this.openings?.set(id, first.slice(0, 1200));
    for (const k of [...this.cache.keys()]) if (k.startsWith(id + ':')) this.cache.delete(k);
    pages.slice(0, 40).forEach((t, i) => this.remember(id, i, t));
    this.pending = (this.pending || Promise.resolve()).then(() => this.write(id, pages)).catch(() => {});
    return this;
  }
  async write(id, pages) {
    const STEP = 300;
    if (!pages.length) { await Index.put({ id, pages: [] }); return; }
    for (let a = 0; a < pages.length; a += STEP) await Index.put({ id, pages: pages.slice(a, a + STEP), append: a > 0 });
  }
  /** Resolves once everything given to set() is in the database. */
  flushed() { return this.pending || Promise.resolve(); }
  delete(id) {
    const had = this.lens.delete(id);
    for (const k of [...this.cache.keys()]) if (k.startsWith(id + ':')) this.cache.delete(k);
    Index.remove({ ids: [id] }).catch(() => {});
    return had;
  }
  clear() { this.lens.clear(); this.cache.clear(); Index.clear().catch(() => {}); }
}
