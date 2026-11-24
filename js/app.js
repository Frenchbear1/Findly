import { compile, MODES, inWhere, WHERE } from './search.js';
import { store, stuckStorage, setDiskPath } from './store.js';
import { isNative, platform, hasLiveText, Files, Link, listFiles, readFileObj, recognize, writeBytes, readBytes, cloudStatus, setCloud, listAll, pickLibraryFolder, libraryFolder, revealLibrary, diskFile } from './native.js';
const b64 = (u8) => { let x = ''; for (let i = 0; i < u8.length; i += 0x8000) x += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(x); };
import { readFile, kindOf, ACCEPT, paginate } from './ingest.js';
import { detectLabels, cleanPdfLabels } from './pagelabels.js';
import { getPdf, closePdf, renderPdfPage, EXTRACTOR_VERSION, MARKS_V, marksForPdf } from './pdf.js';
import { renderHtmlPage, forgetHtml, renderedText } from './htmlview.js';
import { remoteFetch, remoteInfo, remoteChanged, download, documentLinks, looksLikeDocument, fileNameFor, editionKey, linkKey, linkSimilarity, SAME_DOC_SCORE, helper, NeedsHelper } from './remote.js';
import { comboFromEvent, comboLabel, worksWhileTyping, isMac } from './keys.js';
import { applyReadingTheme, openThemeBar, themeBarOpen, THEME_DEFAULTS, BLUR_DEF, blurPx } from './themes.js';
import { initBoards } from './boards.js';
import { makeBackup, readBackup, backupStream } from './backup.js';
import { send as sendTo, receive as receiveFrom } from './transfer.js';

// ---------- small helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const NUM = new Intl.NumberFormat(); // one formatter, reused (toLocaleString builds a new one every call)
const fmt = (n) => NUM.format(n);
// Only touch the page when the content really changed: rebuilding an element under the mouse
// restarts its hover effect, which looks like flickering.
function setHTML(node, html) {
  if (node._html === html) return;
  node.innerHTML = html;
  node._html = html;
}
// Update a list in place: keep children that didn't change, swap only those that did.
function morphChildren(parent, next, keyOf) {
  const old = new Map();
  for (const c of [...parent.children]) old.set(keyOf(c), c);
  const want = [];
  for (const n of [...next.children]) {
    const k = keyOf(n);
    const o = old.get(k);
    old.delete(k);
    if (!o) { want.push(n); continue; }
    if (o.outerHTML === n.outerHTML) { want.push(o); continue; }
    if (o._morph) { o._morph(o, n); want.push(o); continue; }
    o.replaceWith(n);
    want.push(n);
  }
  for (const o of old.values()) o.remove();
  want.forEach((c, i) => { if (parent.children[i] !== c) parent.insertBefore(c, parent.children[i] || null); });
}
const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const KIND_LABEL = { pdf: 'PDF', docx: 'DOC', txt: 'TXT', md: 'MD', html: 'HTML', rtf: 'RTF' };
const I = {
  arrowLeft: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v0A2.5 2.5 0 0 1 6.5 19H19"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 10h14M5 14h14M5 18h9"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  arrows: '<svg viewBox="0 0 24 24"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  fitW: '<svg viewBox="0 0 24 24"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  fitP: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="1.5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  folderPlus: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6.5 3.5 3.5h-11L10 9.5z"/><path d="M12 13v8"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M15 12H4M8 8l-4 4 4 4M14 5h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-5"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  crop: '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  columns: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6.5 8.5h3M6.5 12h3M14.5 8.5h3M14.5 12h3"/></svg>',
  board: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="9" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.6"/><rect x="3" y="15" width="7.5" height="6" rx="1.6"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.9 1.2-1.8l-.4-.9c-.5-1.1.3-2.3 1.5-2.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15.5" cy="7.5" r="1.2"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  wide: '<svg viewBox="0 0 24 24"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
};

// ---------- preferences ----------
const PREF_KEY = 'instant-search:prefs';
const PREFS_V = 2;
const prefs = Object.assign(
  { mode: 'all', matchCase: false, wholeWord: false, near: 8, sort: 'library', view: 'original', theme: 'auto', q: '', zoom: 'width', compact: false, sideHidden: false, keys: {}, v: PREFS_V, crop: true, cropLines: 3, trim: true, columns: false, pageNav: 'tabs' },
  (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })()
);
// reading themes replace the old light/dark/auto switch
for (const [k, v] of Object.entries(THEME_DEFAULTS)) if (!(k in prefs)) prefs[k] = k === 'rtheme' ? ({ light: 'daylight', dark: 'night' }[prefs.theme] || 'auto') : structuredClone(v);
// v2: pages open as the original and fit the width by default; Regex is gone
if ((prefs.v || 1) < 2) { prefs.view = 'original'; prefs.zoom = 'width'; prefs.v = PREFS_V; }
prefs.view = 'original'; // pages are always shown as the original (the text view is gone)
if (!MODES[prefs.mode]) prefs.mode = 'all';
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };

// ---------- state ----------
// Searching while you type happens in a worker that keeps its own copy of the page texts; this map keeps it in step.
const searchWorker = (() => {
  try { return new Worker(new URL('./search-worker.js', import.meta.url), { type: 'module' }); } catch { return null; }
})();
// the worker's copy of each document's headings and captions
function sendMarks(doc) { try { searchWorker?.postMessage({ t: 'marks', id: doc.id, marks: doc.marks || null }); } catch {} }
class TextMap extends Map {
  set(k, v) { super.set(k, v); try { searchWorker?.postMessage({ t: 'set', id: k, pages: v }); } catch {} const d = S.docs.find((x) => x.id === k); if (d?.marks) sendMarks(d); return this; }
  delete(k) { try { searchWorker?.postMessage({ t: 'del', id: k }); } catch {} return super.delete(k); }
  clear() { try { searchWorker?.postMessage({ t: 'clear' }); } catch {} super.clear(); }
}
const S = {
  docs: [],            // metadata, library order
  folders: [],         // { id, name, order, collapsed }
  texts: new TextMap(), // docId -> page texts
  matcher: null,
  error: null,
  terms: [],
  pxPerChar: 0.3,
  pageAspect: 1.294,
};

// A view is one scrolling list of documents/pages: the compiled results, or one whole document.
function makeView(root, kind) {
  return { root, kind, docId: null, list: [], info: new Map(), total: 0, cur: -1, navY: null, scrollY: 0, revealed: new Map(), pageEls: new Map(), dirty: true };
}
const results = makeView($('#results'), 'results');
const reader = makeView($('#reader'), 'reader');
let active = results;

const q = $('#q');
const docById = (id) => S.docs.find((d) => d.id === id);
const folderById = (id) => S.folders.find((f) => f.id === id);
const folderOf = (d) => (d.folderId && folderById(d.folderId)) || null;
// Library order: each folder's documents in folder order, then documents not in a folder.
// The library's top level mixes folders and documents that aren't in a folder, in one order (`pos`).
// Without a saved position, folders come first and loose documents after them.
function topLevel() {
  const items = [];
  S.folders.forEach((f, i) => items.push({ kind: 'folder', id: f.id, f, pos: f.pos ?? i }));
  S.docs.forEach((d, i) => {
    if (!(d.folderId && folderById(d.folderId))) items.push({ kind: 'doc', id: d.id, d, pos: d.pos ?? 1e6 + i });
  });
  return items.sort((a, b) => a.pos - b.pos);
}
// Library order, top to bottom: each folder's documents where the folder sits.
function orderedDocs() {
  const out = [];
  for (const it of topLevel()) {
    if (it.kind === 'doc') out.push(it.d);
    else for (const d of S.docs) if (d.folderId === it.id) out.push(d);
  }
  return out;
}
const pkey = (docId, n) => `${docId}:${n}`;
// A page's number as the document prints it ("2-4", "iv"), or its position when it doesn't say.
const plabel = (doc, n) => doc?.labels?.[n] || String(n + 1);
const LABELS_V = 1;
function docLabels(kind, pages, fromPdf) {
  if (kind !== 'pdf') return null;
  return cleanPdfLabels(fromPdf, pages.length) || detectLabels(pages);
}
// Documents added before page labels existed: read them from the text once, in the background.
function labelOlderDocs() {
  const todo = S.docs.filter((d) => d.kind === 'pdf' && !d.status && d.labelsV !== LABELS_V && S.texts.has(d.id));
  if (!todo.length) return;
  const step = () => {
    const d = todo.shift();
    if (!d) { store.updateDocs(S.docs.filter((x) => x.labelsV === LABELS_V && !x.status).map(stripMeta)).catch(() => {}); return; }
    d.labels = detectLabels(S.texts.get(d.id) || []);
    d.labelsV = LABELS_V;
    setTimeout(step, 0);
  };
  setTimeout(step, 1500);
}
// Headings and captions for PDFs added before they were picked out: read again from each PDF, quietly,
// one document at a time.
async function markOlderDocs() {
  const todo = S.docs.filter((d) => d.kind === 'pdf' && !d.status && d.marksV !== MARKS_V && S.texts.has(d.id));
  for (const d of todo) {
    await new Promise((r) => setTimeout(r, 400));
    if (!S.docs.includes(d) || d.status) continue;
    try {
      const pdf = await getPdf(d.id, () => store.file(d.id));
      const marks = await marksForPdf(pdf, S.texts.get(d.id) || [], () => !S.docs.includes(d));
      if (!marks) continue;
      d.marks = marks;
      d.marksV = MARKS_V;
      store.updateDoc(stripMeta(d)).catch(() => {});
      sendMarks(d);
      if (prefs.where && prefs.where !== 'any' && S.matcher) runSearch();
    } catch {}
  }
}
// A group is one section: a whole document, or (when ranking pages) a single hit page and the pages opened around it.
const groupKey = (R, doc) => (R?.flat ? pkey(doc.id, R.pages[0].n) : doc.id);
const searchable = (d) => !d.status;
// a link can narrow the search to one document (see "links to a search"); otherwise the ticked documents
let linkOnly = null;
const inScope = (d) => searchable(d) && (linkOnly ? d.id === linkOnly : d.enabled);

// ---------- searching ----------
function computeHits(docs) {
  const list = [];
  if (S.matcher) {
    for (const doc of docs) {
      const pages = S.texts.get(doc.id);
      if (!pages) continue;
      const hp = [];
      const where = prefs.where && prefs.where !== 'any' ? prefs.where : null;
      for (let n = 0; n < pages.length; n++) {
        let r = S.matcher.match(pages[n]);
        if (r && where) r = inWhere(r, doc.marks?.[n] || null, where);
        if (r) hp.push({ n, ranges: r, count: r.length });
      }
      if (hp.length) list.push({ doc, pages: hp, hits: hp.reduce((a, p) => a + p.count, 0) });
    }
  }
  return list;
}

function assign(v, list) {
  if (v.kind === 'results' && prefs.sort === 'hits') list.sort((a, b) => b.hits - a.hits);
  if (v.kind === 'results' && prefs.sort === 'pages') {
    // every hit page from every document, ranked by how many hits it has
    const flat = [];
    list.forEach((R, di) => R.pages.forEach((p) => flat.push({ doc: R.doc, pages: [p], hits: p.count, flat: true, di })));
    flat.sort((a, b) => b.hits - a.hits || a.di - b.di || a.pages[0].n - b.pages[0].n);
    list = flat;
  }
  v.list = list;
  v.byKey = new Map(list.map((R) => [groupKey(R, R.doc), R]));
  v.info.clear();
  let h = 0;
  for (const R of list) {
    R.hitStart = h;
    for (const p of R.pages) { p.h0 = h; h += p.count; v.info.set(pkey(R.doc.id, p.n), p); }
  }
  v.total = h;
  v.cur = -1;
  v.navY = null;
}

// A page found by the worker: its hit count right away, its hit positions decoded only when something needs them.
function workerPage(n, count, data, at) {
  let ranges = null;
  return {
    n, count,
    get ranges() {
      if (!ranges) { ranges = new Array(count); for (let i = 0; i < count; i++) { const j = (at + i) * 3; ranges[i] = [data[j], data[j + 1], data[j + 2]]; } }
      return ranges;
    },
  };
}
let searchSeq = 0;
const workerWaits = new Map();
searchWorker?.addEventListener('message', (e) => { const w = workerWaits.get(e.data.qid); if (w) { workerWaits.delete(e.data.qid); w(e.data.docs); } });
// Searches the documents in the worker; resolves to the same shape as computeHits, or null if a newer search took over.
function workerHits(docs) {
  const qid = ++searchSeq;
  for (const [k, w] of workerWaits) { workerWaits.delete(k); w(null); } // older searches are moot
  return new Promise((resolve) => {
    workerWaits.set(qid, (found) => {
      if (!found) return resolve(null);
      const byId = new Map(docs.map((d) => [d.id, d]));
      resolve(found.map((f) => {
        let at = 0;
        const pages = [];
        for (let i = 0; i < f.ns.length; i++) { pages.push(workerPage(f.ns[i], f.counts[i], f.data, at)); at += f.counts[i]; }
        return { doc: byId.get(f.id), pages, hits: at };
      }).filter((R) => R.doc));
    });
    searchWorker.postMessage({ t: 'q', qid, query: q.value, opts: { mode: prefs.mode, matchCase: prefs.matchCase, wholeWord: prefs.wholeWord, near: prefs.near, where: prefs.where || 'any' }, ids: docs.map((d) => d.id) });
  });
}

function prepSearch() {
  prefs.q = q.value;
  savePrefs();
  const m = compile(q.value, prefs);
  S.error = m?.error || null;
  S.matcher = m && !m.error ? m : null;
  S.terms = S.matcher ? S.matcher.terms : [];
}
// While typing: the matching runs in the worker, so the keyboard and the page stay smooth; only the newest
// keystroke's results are shown.
async function runSearchLive() {
  if (!searchWorker) { runSearch(); return; }
  prepSearch();
  if (!S.matcher) { searchSeq++; runSearch(); return; }
  const scope = orderedDocs().filter(inScope);
  const rdoc = reader.docId && docById(reader.docId);
  const docs = rdoc && !scope.includes(rdoc) ? [...scope, rdoc] : scope;
  document.body.classList.add('searching');
  const found = await workerHits(docs);
  if (!found) return; // a newer search is on its way
  document.body.classList.remove('searching');
  const inResults = new Set(scope);
  showSearch(found.filter((R) => inResults.has(R.doc)), rdoc ? found.filter((R) => R.doc === rdoc) : null);
}

function runSearch({ keepScroll = false } = {}) {
  searchSeq++; // anything the worker is still doing is out of date now
  for (const [k, w] of workerWaits) { workerWaits.delete(k); w(null); }
  document.body.classList.remove('searching');
  prepSearch();
  const rdoc = reader.docId && docById(reader.docId);
  showSearch(computeHits(orderedDocs().filter(inScope)), rdoc ? computeHits([rdoc]) : null, { keepScroll });
}

function showSearch(list, readerList, { keepScroll = false } = {}) {
  sweepSoon(600); // size the pages above once things settle
  const before = { sig: resultsSig(), cur: results.cur, navY: results.navY, dirty: results.dirty, state: resultsState() };
  assign(results, list);
  if (keepScroll && !before.dirty && before.sig === resultsSig() && before.state === resultsState() && results.list.length) {
    results.cur = before.cur; // same results: keep the page as it is, including opened pages and the current hit
    results.navY = before.navY;
  } else {
    results.revealed.clear();
    cropOpen.clear();
    results.dirty = true;
    if (active === results) renderView(results, { keepScroll });
  }

  if (reader.docId) {
    assign(reader, readerList || []);
    if (active === reader) refreshInPlace(reader);
    else reader.dirty = true;
  }
  updateChrome();
}

function resultsSig() {
  return prefs.sort + '§' + results.list.map((R) => `${R.doc.id}:${R.doc.name}:${R.doc.hash || ''}:${R.doc.folderId || ''}:${R.pages.map((p) => p.n + '/' + p.count).join(',')}`).join('|');
}
// what the results area shows when there are no results lists (library empty, idle, error…)
function resultsState() {
  return [S.docs.length, !!S.error, !!S.matcher, S.docs.filter(inScope).length, linkOnly || ''].join(',');
}

let searchTimer;
function scheduleSearch() {
  clearTimeout(searchTimer);
  let chars = 0;
  for (const p of S.texts.values()) chars += p.length * 3000;
  // the search itself no longer holds up typing (it runs in a worker), so it can start almost at once
  searchTimer = setTimeout(searchWorker ? runSearchLive : runSearch, searchWorker ? 70 : chars > 6e6 ? 260 : 110);
}

// ---------- text rendering ----------
// PDF lines are joined back into paragraphs for reading. Same-length substitution keeps offsets valid.
function reflow(text) {
  const lines = text.split('\n');
  let max = 0;
  for (const l of lines) if (l.length > max) max = l.length;
  const min = Math.max(30, max * 0.6);
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out += line;
    if (i === lines.length - 1) break;
    const next = lines[i + 1];
    const t = line.trimEnd();
    const join =
      t && next.trim() && line.length >= min && !/[:;]$/.test(t) &&
      !/^\s*([•●▪◦‣\-–—*]|\(?\d{1,3}[.)]|\(?[a-z][.)]\s)/i.test(next);
    out += join ? (/\p{L}-$/u.test(t) && /^\p{Ll}/u.test(next) ? '​' : ' ') : '\n';
  }
  return out;
}

function markup(text, ranges) {
  let html = '';
  let pos = 0;
  for (const [s, e, c, h] of ranges) {
    if (s < pos) continue;
    html += esc(text.slice(pos, s));
    html += h != null
      ? `<mark class="m c${c}" data-h="${h}">${esc(text.slice(s, e))}</mark>`
      : `<mark class="s c${c}">${esc(text.slice(s, e))}</mark>`;
    pos = e;
  }
  return html + esc(text.slice(pos));
}

function pageRanges(v, docId, n, text, ctx) {
  const info = ctx ? null : v.info.get(pkey(docId, n));
  if (info) return info.ranges.map((r, i) => [r[0], r[1], r[2], info.h0 + i]);
  return S.matcher ? S.matcher.soft(text).map((r) => [r[0], r[1], r[2], null]) : [];
}

// ---------- page cards ----------
const override = new Map(); // per-page Text/Original choice
// PDFs keep their file; HTML files added from now on keep their source too
const hasOriginal = (doc) => doc.kind === 'pdf' || doc.kind === 'html';
function pageMode(doc, n) {
  if (!hasOriginal(doc)) return 'text';
  const o = override.get(doc.kind === 'html' ? pkey(doc.id, WEB) : pkey(doc.id, n));
  if (o) return o;
  // a PDF page with no extractable text (a scan) is only useful as the original
  if (doc.kind === 'pdf' && !(S.texts.get(doc.id)?.[n] || '').trim()) return 'original';
  return prefs.view;
}
// An HTML document shown as the real web page is one card, not one per page: the page loads once and
// moving between hits scrolls inside it. (In the "pages with most hits" ranking each entry stays its own card.)
const WEB = 'web';
const webMode = (doc, R) => doc.kind === 'html' && !R?.flat && pageMode(doc, 0) === 'original';
const artFor = (v, docId, n) => {
  const find = () => v.pageEls.get(pkey(docId, n)) || v.pageEls.get(pkey(docId, WEB));
  return find() || (v.pending ? (finishRender(v), find()) : null); // not drawn yet: finish the list first
};
function webR(v, doc) { return v.list.find((r) => r.doc.id === doc.id && !r.flat) || null; }
function webHeadHtml(v, doc) {
  const R = webR(v, doc);
  const badge = R ? `<span class="phits" title="${plural(R.hits, 'hit')}">${fmt(R.hits)}</span>` : '';
  return `<span class="ph-pill"><span class="pno">Web page</span>${badge}</span><span class="grow"></span><button class="chip-btn" data-act="pmode" title="Show the page’s text instead, split into pages">${I.text}Text</button>`;
}
function webEl(v, doc, R) {
  const art = el('article', `page web${R ? ' hit' : ''}`);
  art.dataset.doc = doc.id;
  art.dataset.n = R?.pages[0]?.n ?? 0;
  art._v = v;
  art._web = true;
  const body = el('div', 'page-body');
  body.style.height = HTML_FRAME_H() + 'px';
  art.append(el('header', 'page-head', webHeadHtml(v, doc)), body);
  v.pageEls.set(pkey(doc.id, WEB), art);
  io.observe(art);
  nearTopIO.observe(art);
  ioFar.observe(art);
  return art;
}
// Hit k counted among the highlights the web page shows (every occurrence of the search words, in order).
function webOrdinal(v, k) {
  const loc = locate(v, k);
  if (!loc) return 0;
  const pages = S.texts.get(loc.R.doc.id) || [];
  let before = 0;
  for (let m = 0; m < loc.p.n; m++) before += S.matcher.soft(pages[m]).length;
  const start = loc.p.ranges[k - loc.p.h0]?.[0];
  const within = S.matcher.soft(pages[loc.p.n] || '').findIndex((r) => r[0] === start);
  return before + Math.max(0, within);
}
const HTML_FRAME_H = () => Math.round(Math.min(innerHeight * 0.78, 1000));

// Which highlighted match (counting through the whole document) a page's first hit is, for the HTML view.
function htmlOrdinal(doc, n, ranges) {
  if (!S.matcher) return 0;
  const pages = S.texts.get(doc.id) || [];
  let before = 0;
  for (let m = 0; m < n; m++) before += S.matcher.soft(pages[m]).length;
  if (!ranges.length) return before;
  const within = S.matcher.soft(pages[n] || '').findIndex((r) => r[0] === ranges[0][0]);
  return before + Math.max(0, within);
}

function estimate(doc, n, mode = pageMode(doc, n)) {
  const z = zoomValue();
  if (mode === 'original') return doc.kind === 'html' ? HTML_FRAME_H() + 44 : Math.round(BASE_W * z * S.pageAspect) + 56;
  const chars = (S.texts.get(doc.id)?.[n] || '').length;
  return Math.max(150, Math.round(chars * S.pxPerChar * z) + 80);
}

// Pages start at an estimated height and settle to their real one once drawn (and cropped). When that
// happens to a page above where you're reading, everything below would jump; instead the scroll moves by
// the same amount in the same frame, so what's on screen stays still however fast you go. (Done here
// rather than with the browser's scroll anchoring, which Safari lacks.)
let anchorQuiet = false;
function quietAnchor() { anchorQuiet = true; requestAnimationFrame(() => requestAnimationFrame(() => { anchorQuiet = false; })); }
const sizeRO = new ResizeObserver((es) => {
  let line = null, shift = 0;
  for (const e of es) {
    const art = e.target;
    const h = e.borderBoxSize?.[0]?.blockSize ?? art.offsetHeight;
    const was = art._h;
    art._h = h;
    if (was == null || !h || Math.abs(h - was) < 0.5 || !art._settling || anchorQuiet || dragging || kept(art) || !art.isConnected) continue;
    if (line == null) line = Math.max(safeTop(), $('.topbar')?.getBoundingClientRect().bottom || 0);
    if (art.getBoundingClientRect().top < line - 1) shift += h - was;
  }
  if (Math.abs(shift) >= 0.5) {
    autoScrollUntil = performance.now() + 120; // the top bar isn't moved by our own correction
    window.scrollBy({ top: shift, behavior: 'instant' });
  }
});

// A result that's sliding off sideways, or waiting behind a page you swiped to, keeps what it has drawn.
const kept = (art) => art.hidden || !!art._visit || !!art._busy || art.style.position === 'absolute';
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const art = e.target;
      if (e.isIntersecting) {
        if (art._filled) art.lastElementChild.querySelector('.pdf-frame:not(.clone)')?._sharpen?.(); // its sharp copy, now it's close
        fill(art);
      } else if (art._cleanup && !kept(art) && Math.abs(e.boundingClientRect.top) > innerHeight * 4) unfill(art);
    }
  },
  { rootMargin: '1400px 0px' }
);
const ioFar = new IntersectionObserver(
  // (a result hidden behind the page you swiped to is kept as it is, ready to come back)
  (entries) => { for (const e of entries) if (!e.isIntersecting && e.target._cleanup && !kept(e.target)) unfill(e.target); },
  { rootMargin: '5000px 0px' }
);

function headHtml(v, doc, n, ctx, flat = false) {
  const info = v.info.get(pkey(doc.id, n));
  let badge = '';
  if (info && ctx) badge = `<span class="phits none" title="${plural(info.count, 'hit')} — this page is also ranked on its own">${fmt(info.count)}</span>`;
  else if (info) badge = `<span class="phits" title="${plural(info.count, 'hit')}">${fmt(info.count)}</span>`;
  let rank = '';
  if (flat && !ctx) {
    const i = v.list.findIndex((r) => r.flat && r.doc.id === doc.id && r.pages[0].n === n);
    if (i >= 0) rank = `<span class="rank" title="Ranked ${fmt(i + 1)} by hits">${fmt(i + 1)}</span>`;
  }
  const lab = plabel(doc, n);
  return `<span class="ph-pill">${rank}<span class="pno"${lab !== String(n + 1) ? ` title="Page ${lab} · ${fmt(n + 1)} of ${fmt(S.texts.get(doc.id)?.length || 0)} in the file"` : ''}>Page ${esc(lab)}</span>${badge}</span><span class="grow"></span>`;
}

function pageEl(v, doc, n, R) {
  const ctx = !!(R?.flat && n !== R.pages[0].n); // a neighbouring page opened for context
  const info = ctx ? null : v.info.get(pkey(doc.id, n));
  const art = el('article', `page${info ? ' hit' : ''}${!info && v.kind === 'results' ? ' extra' : ''}`);
  art.dataset.doc = doc.id;
  art.dataset.n = n;
  art._v = v;
  art._ctx = ctx;
  art._flat = !!R?.flat;
  const head = el('header', 'page-head', headHtml(v, doc, n, ctx, !!R?.flat));
  const body = el('div', 'page-body');
  body.style.height = bodyEstimate(art, doc, n) + 'px';
  art.append(head, body);
  v.pageEls.set(ctx ? `${pkey(doc.id, n)}@${groupKey(R, doc)}` : pkey(doc.id, n), art);
  io.observe(art);
  sizeRO.observe(art);
  nearTopIO.observe(art);
  ioFar.observe(art);
  return art;
}

function fill(art) {
  if (art._filled) return art._filled;
  const v = art._v;
  const doc = docById(art.dataset.doc);
  const n = Number(art.dataset.n);
  const body = art.lastElementChild;
  if (!doc) return Promise.resolve();
  const text = S.texts.get(doc.id)?.[n] || '';
  // in the "pages with most hits" ranking an HTML page is shown as text; its web page opens once from the button
  const mode = art._flat && doc.kind === 'html' ? 'text' : pageMode(doc, n);
  const ranges = pageRanges(v, doc.id, n, text, art._ctx);
  const token = (art._token = (art._token || 0) + 1);
  art._settling = true; // its height is about to settle from the estimate (see sizeRO)
  // The old content (if any) stays on screen until the new one is ready, then gets released.
  const swapped = () => { art._prevCleanup?.(); art._prevCleanup = null; };
  const showLoading = () => { if (!body.childElementCount) body.classList.add('loading'); };

  art._filled = (async () => {
    if (mode === 'original' && doc.kind === 'html') {
      showLoading();
      try {
        const cleanup = await renderHtmlPage({
          docId: doc.id, n: art._web ? 0 : n, pageCount: art._web ? 1 : S.texts.get(doc.id)?.length || 1, host: body,
          matcher: S.matcher, zoom: zoomValue(),
          ordinal: art._web ? (() => { const R = webR(v, doc); if (!R || !S.matcher) return 0; const k = v.cur >= R.hitStart && v.cur < R.hitStart + R.hits ? v.cur : R.hitStart; return webOrdinal(v, k); })() : htmlOrdinal(doc, n, ranges), base: doc.source?.url || doc.baseUrl || '',
        });
        if (token !== art._token) { cleanup(); return; }
        art._cleanup = cleanup;
        swapped();
      } catch (err) {
        if (token !== art._token) return;
        const missing = /wasn’t stored/.test(err.message);
        // added before the app kept web pages: a linked one can simply be fetched again
        if (missing && doc.source?.url && !art._refetched) {
          art._refetched = true;
          body.innerHTML = `<p class="empty-page">${I.refresh}<span>Getting the web page…</span></p>`;
          try {
            const dl = await download(doc.source.url);
            const html = new TextDecoder().decode(dl.bytes);
            await store.addDoc(stripMeta(Object.assign(doc, { hasOriginal: true })), S.texts.get(doc.id), html);
            forgetHtml(doc.id);
            if (token === art._token) { art._token++; art._filled = null; fill(art); }
            return;
          } catch (e2) { err = e2; }
        }
        body.innerHTML = `<p class="empty-page">${I.warn}<span>${missing && !doc.source?.url
          ? 'This page was added before the app kept the web page itself. Drop the file in again to see the real page (your library keeps everything else).'
          : `Couldn’t show the original (${esc(helperProblem(err))}).`}</span></p>`;
        swapped();
      }
      body.classList.remove('loading');
    } else if (mode === 'original') {
      showLoading();
      try {
        const pdf = await getPdf(doc.id, () => store.file(doc.id));
        if (!doc.labelsPdf) { // the PDF's own labels beat ones read from the text
          doc.labelsPdf = 1;
          pdf.getPageLabels().then((l) => { const c = cleanPdfLabels(l, pdf.numPages); if (c) doc.labels = c; store.updateDoc(stripMeta(doc)).catch(() => {}); }).catch(() => {});
        }
        if (token !== art._token) return;
        const r = await renderPdfPage(pdf, n, body, ranges, BASE_W * zoomValue(), { trim: !!prefs.trim, columns: !!prefs.columns && v.kind === 'results', prio: () => (token === art._token && art.isConnected ? screenDistance(art) : null) });
        if (!r) return; // let go before its turn came
        if (token !== art._token) { r.cleanup(); return; }
        r.show();
        art._cleanup = r.cleanup;
        art._edge = pageEdge(body);
        swapped();
        keepBudget(art);
        const fr = body.querySelector('.pdf-page');
        if (fr && !r.trimmed) S.pageAspect = fr.offsetHeight / fr.offsetWidth || S.pageAspect;
      } catch (err) {
        if (token !== art._token) return;
        body.innerHTML = `<p class="empty-page">${I.warn}<span>Couldn’t show the original page (${esc(err.message)}).</span></p>`;
        swapped();
      }
      body.classList.remove('loading');
    } else {
      const display = doc.kind === 'pdf' ? reflow(text) : text;
      body.innerHTML = text.trim()
        ? `<div class="page-text">${markup(display, ranges)}</div>`
        : `<p class="empty-page">No text on this page${doc.kind === 'pdf' ? ' — it may be a scan or picture. Switch to <b>Original</b> to see it.' : '.'}</p>`;
      swapped();
    }
    body.style.height = '';
    body.style.minHeight = '';
    if (mode !== 'original') art._edge = null;
    tabsBeside(art);
    applyCrop(art);
    noteCropHeight(art, mode === 'original');
    if (mode === 'text' && text.length > 600) {
      const ratio = (body.offsetHeight - 40) / text.length / zoomValue();
      if (ratio > 0.05 && ratio < 2) S.pxPerChar = S.pxPerChar * 0.8 + ratio * 0.2;
    }
    if (v.cur >= 0) markCurrent(v);
    art._sized = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (token === art._token) art._settling = false; }));
  })();
  return art._filled;
}

// The page tabs are painted as part of their page, so each one needs its page's own paper colour: read
// from the rendered PDF's corners (the page's margin), plus that colour as dark themes show it.
function pageEdge(body) {
  const c = body.querySelector('.pdf-frame:not(.clone) canvas');
  if (!c || !c.width) return null;
  try {
    const x = c.getContext('2d'), w = c.width, h = c.height, k = 3;
    const px = [[k, k], [w - k - 1, k], [k, h - k - 1], [w - k - 1, h - k - 1]].map(([a, b]) => [...x.getImageData(a, b, 1, 1).data.slice(0, 3)]);
    // the colour most corners agree on (a picture running to one corner doesn't count)
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 10);
    const rgb = px.map((p) => [p, px.filter((q) => near(p, q)).length]).sort((a, b) => b[1] - a[1])[0][0];
    const hx = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    // dark themes: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.92), as the CSS does
    let [r, g, b] = rgb.map((v) => 1 - v / 255);
    const cs = -1, sn = 0; // cos/sin of 180°
    const m = [0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
      0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
      0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072];
    const hr = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]
      .map((v) => Math.max(0, Math.min(1, v)) * 0.92).map((v) => Math.max(0, Math.min(1, (v - 0.5) * 0.92 + 0.5)));
    return { e: hx(rgb), d: hx(hr.map((v) => v * 255)) };
  } catch { return null; }
}
function paintTab(tab, art) {
  if (!tab) return;
  const pdf = !!art?.querySelector('.pdf-frame:not(.clone)');
  tab.classList.toggle('pdf', pdf);
  tab.classList.toggle('extra', !pdf && !!art?.classList.contains('extra'));
  const e = pdf ? art._edge : null;
  if (e) { tab.style.setProperty('--e', e.e); tab.style.setProperty('--ed', e.d); }
  else { tab.style.removeProperty('--e'); tab.style.removeProperty('--ed'); }
}
function paintGap(g) {
  paintTab(g.querySelector('.gap-tab.down'), g.previousElementSibling?.classList.contains('page') ? g.previousElementSibling : null);
  paintTab(g.querySelector('.gap-tab.up'), g.nextElementSibling?.classList.contains('page') ? g.nextElementSibling : null);
}
function tabsBeside(art) {
  for (const g of [art.previousElementSibling, art.nextElementSibling]) if (g?.classList.contains('gap')) paintGap(g);
}
// gaps come and go as pages unfold; a MutationObserver keeps every new tab painted
const gapMO = new MutationObserver((recs) => {
  for (const r of recs) for (const n of r.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.classList.contains('gap')) paintGap(n);
    else if (n.classList.contains('page')) tabsBeside(n);
    else n.querySelectorAll?.('.gap').forEach(paintGap);
  }
});
queueMicrotask(() => { for (const id of ['results', 'reader']) { const r = document.getElementById(id); if (r) gapMO.observe(r, { childList: true, subtree: true }); } });

// Drawn PDF pages are held to a budget: past it, the ones furthest from the screen are let go (they're
// drawn again if you come back). Without it a fast scroll could pile up enough page images for iOS to
// stop the app for using too much memory, which reloads it.
const drawn = new Set();
// a page let go while still near the screen is drawn again as it comes into view
const comeback = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { comeback.unobserve(e.target); fill(e.target); } }, { rootMargin: '300px 0px' });
const DRAWN_MAX = 16;
// Pages above the screen are sized ahead of time: while you're not scrolling, the nearest ones above that
// have never been drawn get their quick soft copy (which settles their height), one after another going up.
// Scrolling back up then finds them the right size already, instead of the view being nudged as they
// settle. (Pages below can settle whenever; that never moves what you're looking at.)
let sweepT = 0, lastScrollAt = 0;
addEventListener('scroll', () => { lastScrollAt = performance.now(); sweepSoon(); }, { passive: true });
function sweepSoon(ms = 350) { clearTimeout(sweepT); sweepT = setTimeout(sweep, ms); }
async function sweep() {
  const v = active;
  const busy = new Set();
  const next = () => {
    const pages = v.root.querySelectorAll('.page');
    // the last page whose bottom is above the screen, then upward
    let lo = 0, hi = pages.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (pages[m].getBoundingClientRect().bottom <= 0) { k = m; lo = m + 1; } else hi = m - 1; }
    for (let i = k; i >= 0; i--) { const a = pages[i]; if (!a._sized && !a._filled && !a.hidden && !a._web && !busy.has(a)) return a; }
    return null;
  };
  // two at a time, so it keeps pace with the drawing queue
  const lane = async () => {
    for (;;) {
      if (performance.now() - lastScrollAt < 300) { sweepSoon(); return; } // wait until scrolling stops
      if (v !== active || document.hidden) return;
      const target = next();
      if (!target) return;
      busy.add(target);
      await fill(target);
      busy.delete(target);
    }
  };
  await Promise.all([lane(), lane()]);
}

// how far a page is from the screen, in pixels (0 when any of it shows): pages are drawn nearest first
function screenDistance(art) {
  const r = art.getBoundingClientRect();
  return r.bottom < 0 ? -r.bottom : r.top > innerHeight ? r.top - innerHeight : 0;
}
function keepBudget(art) {
  drawn.add(art);
  if (drawn.size <= DRAWN_MAX) return;
  const mid = innerHeight / 2;
  const far = [...drawn].filter((a) => a !== art && a.isConnected && !kept(a))
    .map((a) => { const r = a.getBoundingClientRect(); return [a, r.bottom < 0 ? -r.bottom : r.top > innerHeight ? r.top - innerHeight : -1]; })
    .filter(([, d]) => d > 200)
    .sort((x, y) => y[1] - x[1]);
  for (const [a] of far) { if (drawn.size <= DRAWN_MAX) break; unfill(a); comeback.observe(a); }
  for (const a of drawn) if (!a.isConnected) drawn.delete(a);
}

function unfill(art) {
  art._plan = null;
  const body = art.lastElementChild;
  if (body.offsetHeight) { body.style.height = body.offsetHeight + 'px'; body.style.minHeight = '0px'; } // held at exactly its size (a small crop is under the usual minimum)
  art._cropRO?.disconnect();
  body.classList.remove('cropped');
  art._cleanup?.();
  art._cleanup = null;
  art._prevCleanup?.();
  art._prevCleanup = null;
  art._filled = null;
  art._token = (art._token || 0) + 1;
  for (const c of body.querySelectorAll('canvas')) c.width = c.height = 0; // copies for cropped pieces too: free them now, not whenever
  body.replaceChildren();
  drawn.delete(art);
}

function refill(art) {
  const v = art._v;
  const doc = docById(art.dataset.doc);
  if (!doc) return;
  const n = Number(art.dataset.n);
  const info = art._ctx ? null : v.info.get(pkey(doc.id, n));
  art.classList.toggle('hit', !!info);
  art.firstElementChild.innerHTML = art._web ? webHeadHtml(v, doc) : headHtml(v, doc, n, art._ctx, art._flat);
  const wasFilled = !!art._filled;
  const body = art.lastElementChild;
  // keep what's on screen; it's released once the new version has been swapped in
  const old = [art._prevCleanup, art._cleanup].filter(Boolean);
  art._prevCleanup = old.length ? () => old.forEach((f) => f()) : null;
  art._cleanup = null;
  art._filled = null;
  art._token = (art._token || 0) + 1;
  if (wasFilled && body.childElementCount) {
    fill(art);
  } else {
    art._prevCleanup?.();
    art._prevCleanup = null;
    body.replaceChildren();
    body.classList.remove('cropped');
    body.style.height = bodyEstimate(art, doc, n) + 'px';
  }
}

// ---------- cropping result pages to the hits ----------
// A hit page in the results shows just the band of the page holding its hits, with a few lines above and
// below (prefs.cropLines). "Top of page" / "Rest of page" open it out to the page's edges; the page
// before or after still comes from the buttons between pages, as always.
const cropOpen = new Map(); // pkey -> { top, bottom } opened out by hand (cleared when the search changes)
function cropWanted(art) {
  if (!prefs.crop || art._ctx || art._web || art._v?.kind !== 'results') return false;
  return !!art._v.info.get(pkey(art.dataset.doc, Number(art.dataset.n)))?.count;
}
// The band to show, as fractions of the page's height: [a, b], or null for the whole page.
function cropBand(art, content) {
  const marks = [];
  let line = 0;
  if (content.classList.contains('pdf-frame')) {
    const hs = [];
    for (const b of content.querySelectorAll('.box.m')) {
      const t = parseFloat(b.style.top) / 100;
      const h = parseFloat(b.style.height) / 100;
      if (!(h > 0)) continue;
      marks.push([t, t + h]);
      hs.push(h);
    }
    hs.sort((x, y) => x - y);
    line = (hs[hs.length >> 1] || 0.015) * 1.15;
  } else {
    const H = content.offsetHeight;
    if (!H) return null;
    const top = content.getBoundingClientRect().top;
    for (const m of content.querySelectorAll('mark.m')) {
      const r = m.getBoundingClientRect();
      marks.push([(r.top - top) / H, (r.bottom - top) / H]);
    }
    line = (parseFloat(getComputedStyle(content).lineHeight) || 26) / H;
  }
  if (!marks.length) return null;
  const open = cropOpen.get(pkey(art.dataset.doc, Number(art.dataset.n))) || {};
  const pad = line * (Number(prefs.cropLines) || 3);
  let a = Math.min(...marks.map((m) => m[0])) - pad;
  let b = Math.max(...marks.map((m) => m[1])) + pad;
  if (open.at != null) a = Math.min(a, open.at); // dragged open part of the way
  if (open.ab != null) b = Math.max(b, open.ab);
  if (open.top || a < line * 1.5) a = 0; // not worth hiding a line or two
  if (open.bottom || b > 1 - line * 1.5) b = 1;
  if (a <= 0 && b >= 1) return null;
  return [Math.max(0, a), Math.min(1, b)];
}
function applyCrop(art) {
  const body = art.lastElementChild;
  const content = body.querySelector('.pdf-frame:not(.clone), .page-text');
  if (!content) return;
  const plan = colPlan(art, content);
  if (plan) { layoutPieces(art, body, content, plan); return; }
  if (body.classList.contains('pieces')) unpiece(art, body, content);
  art._regions = null;
  let clip = body.querySelector(':scope > .crop-clip');
  const hits = cropWanted(art) ? cropBand(art, content) : null; // the band around the hits, or null = whole page
  // wide view also trims the blank top and bottom of a PDF page, wherever the page's top or bottom shows
  const ty = prefs.trim && content.dataset.ty ? content.dataset.ty.split(',').map(Number) : null;
  let band = hits || [0, 1];
  if (ty) band = [Math.max(band[0], ty[0]), Math.min(band[1], ty[1])];
  if (band[1] - band[0] < 0.02) band = hits || [0, 1];
  art._band = band[0] > 0 || band[1] < 1 ? band : null;
  content._sharpen?.(band);
  if (!art._band) {
    if (clip) body.replaceChildren(content);
    body.classList.remove('cropped', 'cut-top', 'cut-bottom');
    art._cropRO?.disconnect();
    return;
  }
  if (!clip) {
    clip = el('div', 'crop-clip');
    const inner = el('div', 'crop-inner');
    clip.append(inner);
    body.replaceChildren(clip);
    inner.append(content);
    // zoom, width changes and text reflow resize the page: keep the band on the hits
    art._cropRO?.disconnect();
    let seen = 0;
    art._cropRO = new ResizeObserver(() => {
      const h = content.offsetHeight;
      if (Math.abs(h - seen) > 0.5) { seen = h; applyCrop(art); }
    });
    art._cropRO.observe(content);
  }
  const H = content.offsetHeight;
  clip.style.height = Math.max(24, Math.round((band[1] - band[0]) * H)) + 'px';
  clip.firstElementChild.style.marginTop = -Math.round(band[0] * H) + 'px';
  // "cropped" = cut down to the hits (the trimmed margins alone don't count)
  body.classList.toggle('cropped', !!hits);
  body.classList.toggle('cut-top', !!hits && hits[0] > (ty?.[0] || 0) + 0.005);
  body.classList.toggle('cut-bottom', !!hits && hits[1] < (ty?.[1] ?? 1) - 0.005);
  edgeNavs(body, body.classList.contains('cut-top'), body.classList.contains('cut-bottom'));
}
// Arrows set into the top and bottom borders of a cropped result: tap to open the page up or down.
const EYE_H = 'M0 10C13 10 16 1.5 27 1.5L49 1.5C60 1.5 63 10 76 10C63 10 60 18.5 49 18.5L27 18.5C16 18.5 13 10 0 10';
function edgeNavs(body, top, bottom) {
  for (const b of body.querySelectorAll(':scope > .edge-nav, :scope > .edge-drag')) b.remove();
  const make = (side) => {
    if (prefs.expand === 'drag') { // an accent bar to pull the page open with
      const b = el('button', `edge-drag ${side}`, '<i></i>');
      b.dataset.drag = side;
      b.setAttribute('aria-label', side === 'top' ? 'Drag up to show more of the page above' : 'Drag down to show more of the page below');
      body.append(b);
      return;
    }
    const b = el('button', `edge-nav ${side}`, `<svg class="cn-eye" viewBox="0 0 76 20" preserveAspectRatio="none"><path class="f" d="${EYE_H}Z"/><path d="${EYE_H}"/></svg>${side === 'top' ? I.up : I.down}`);
    b.dataset.act = `edge-${side}`;
    b.setAttribute('aria-label', side === 'top' ? 'Show the page above this' : 'Show the rest of the page below');
    body.append(b);
  };
  if (top) make('top');
  if (bottom) make('bottom');
}
function expandEdge(art, side) {
  const key = pkey(art.dataset.doc, Number(art.dataset.n));
  record(side === 'top' ? 'Show above' : 'Show below');
  cropOpen.set(key, { ...cropOpen.get(key), [side]: true });
  const body = art.lastElementChild;
  const anchor = body.querySelector('.box.m, mark.m');
  const before = anchor?.getBoundingClientRect().top;
  const h0 = body.offsetHeight;
  applyCrop(art);
  if (side === 'top' && before != null) {
    const d = anchor.getBoundingClientRect().top - before;
    if (d) window.scrollBy({ top: d, behavior: 'instant' });
  }
  const added = body.offsetHeight - h0;
  if (added > 0 && !reduceMotion()) {
    // reveal the page itself; the arrows in the border stay put on top the whole time
    const parts = [...body.children].filter((c) => !c.matches('.edge-nav, .col-nav, .edge-drag, .col-drag'));
    let off = 0;
    const total = parts.reduce((t, c) => t + c.offsetHeight, 0);
    for (const c of parts) {
      const h = c.offsetHeight;
      // how much of the new strip falls in this part
      const cut = side === 'top' ? Math.max(0, Math.min(h, added - off)) : Math.max(0, Math.min(h, off + h - (total - added)));
      off += h;
      if (cut > 0) c.animate([{ clipPath: side === 'top' ? `inset(${cut}px 0 0 0)` : `inset(0 0 ${cut}px 0)` }, { clipPath: 'inset(0 0 0 0)' }], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  }
}
// ---- drag bars: pull a cropped page open with your finger ----
// Top/bottom bar: the page opens under your finger while everything else holds still; near the edge of the
// screen it scrolls along with you, and it stops where the page ends. Side bar: the view glides toward the
// next column as you drag and finishes (or springs back) when you let go. A tap does what the button did.
let dragging = null;
const lerp = (a, b, t) => a + (b - a) * t;
function startEdgeDrag(e, handle) {
  const art = handle.closest('article.page');
  const body = art?.lastElementChild;
  if (!art || !body) return;
  const content = body.querySelector('.pdf-frame:not(.clone), .page-text');
  const ty = prefs.trim && content?.dataset.ty ? content.dataset.ty.split(',').map(Number) : [0, 1];
  const side = handle.dataset.drag;
  let clip, frame, band, set;
  const pieces = [...body.querySelectorAll(':scope > .piece')];
  if (pieces.length) {
    const i = side === 'top' ? 0 : pieces.length - 1;
    const pc = art._plan?.pieces[i];
    if (!pc) return;
    clip = pieces[i];
    frame = clip.querySelector('.pdf-frame');
    band = [...pc.band];
    set = (b) => { art._pieceX = { ...art._pieceX, [pc.key]: { at: b[0], ab: b[1] } }; };
  } else {
    clip = body.querySelector(':scope > .crop-clip');
    frame = content;
    band = art._band ? [...art._band] : null;
    set = (b) => {
      const key = pkey(art.dataset.doc, Number(art.dataset.n));
      const o = { ...cropOpen.get(key), at: b[0], ab: b[1] };
      if (b[0] <= ty[0] + 0.002) o.top = true;
      if (b[1] >= ty[1] - 0.002) o.bottom = true;
      cropOpen.set(key, o);
    };
  }
  if (!clip || !frame || !band) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  const key = pkey(art.dataset.doc, Number(art.dataset.n));
  const was = { open: cropOpen.get(key), px: art._pieceX };
  const H = frame.offsetHeight;
  const r0 = clip.getBoundingClientRect();
  dragging = {
    kind: 'edge', art, side, clip, H, band, cur: [...band], ty, set, was, handle,
    y0: e.clientY, y: e.clientY, moved: false,
    line: r0.top, // where the old top edge of the page sits on screen (it holds still while the top opens)
  };
  art.classList.add('dragging');
  handle.classList.add('on');
  dragLoop();
}
function applyEdge(d) {
  const { clip, H, cur } = d;
  clip.style.height = Math.max(24, Math.round((cur[1] - cur[0]) * H)) + 'px';
  clip.firstElementChild.style.marginTop = -Math.round(cur[0] * H) + 'px';
  // ask for the sharp copy a good way ahead of the finger, so it's usually there before you get to it
  const src = d.art.lastElementChild.querySelector('.pdf-frame:not(.clone)');
  src?._sharpen?.([Math.max(0, cur[0] - (d.side === 'top' ? 0.15 : 0)), Math.min(1, cur[1] + (d.side === 'bottom' ? 0.15 : 0))]);
}
function dragLoop() {
  const d = dragging;
  if (!d) return;
  if (d.kind === 'edge') {
    const topZone = Math.max(safeTop(), $('.topbar').getBoundingClientRect().bottom) + 96;
    const botZone = innerHeight - ($('#mbar:not([hidden])') ? 150 : 90);
    let v = 0;
    if (d.side === 'bottom' && d.y > botZone && d.cur[1] < d.ty[1]) v = Math.min(18, ((d.y - botZone) / 90) * 18);
    if (d.side === 'top' && d.y < topZone && d.cur[0] > d.ty[0]) v = -Math.min(18, ((topZone - d.y) / 90) * 18);
    if (v) {
      const y = scrollY;
      autoScrollUntil = performance.now() + 250; // the top bar holds still while we scroll for you
      window.scrollBy({ top: v, behavior: 'instant' });
      if (d.side === 'top') d.line -= scrollY - y; // the page moved down under the finger
    }
    if (d.side === 'bottom') {
      const top = d.clip.getBoundingClientRect().top;
      d.cur[1] = Math.max(d.band[1], Math.min(d.ty[1], d.cur[0] + (d.y - top) / d.H));
      applyEdge(d);
    } else {
      const was = d.cur[0];
      d.cur[0] = Math.max(d.ty[0], Math.min(d.band[0], d.band[0] - (d.line - d.y) / d.H));
      const grew = (was - d.cur[0]) * d.H;
      applyEdge(d);
      // the page grew upward: scroll by the same amount so what you were reading doesn't move
      if (Math.abs(grew) > 0.01) { autoScrollUntil = performance.now() + 250; window.scrollBy({ top: grew, behavior: 'instant' }); }
    }
  } else if (d.kind === 'col') {
    // pull the side bar inward, as if swiping the next column into view
    const p = Math.max(0, Math.min(1, -d.dir * (d.x - d.x0) / d.reach));
    applyCol(d, p);
  }
  d.raf = requestAnimationFrame(dragLoop);
}
const safeTop = () => { const p = $('#safeProbe'); return p ? p.offsetHeight : 0; };
function applyCol(d, p) {
  d.p = p;
  if (!d.asked) { // the column it's heading for, sharp in time
    d.asked = true;
    const src = d.frame.closest('.page-body')?.querySelector('.pdf-frame:not(.clone)');
    src?._sharpen?.([Math.min(d.from.band[0], d.to.band[0]), Math.max(d.from.band[1], d.to.band[1])], [Math.min(d.from.span[0], d.to.span[0]), Math.max(d.from.span[1], d.to.span[1])]);
  }
  const span = [lerp(d.from.span[0], d.to.span[0], p), lerp(d.from.span[1], d.to.span[1], p)];
  frameSpan(d.frame, span);
  const H = d.frame.offsetHeight;
  const band = [lerp(d.from.band[0], d.to.band[0], p), lerp(d.from.band[1], d.to.band[1], p)];
  d.clip.style.height = Math.max(24, Math.round((band[1] - band[0]) * H)) + 'px';
  d.clip.firstElementChild.style.marginTop = -Math.round(band[0] * H) + 'px';
}
function startColDrag(e, handle) {
  const art = handle.closest('article.page');
  const body = art?.lastElementChild;
  const i = Number(handle.dataset.piece);
  const pc = art?._plan?.pieces[i];
  const content = body?.querySelector('.pdf-frame:not(.clone)');
  if (!pc?.cols || !content) return;
  const dir = handle.dataset.drag === 'col-next' ? 1 : -1;
  const k = dir < 0 ? pc.k - 1 : pc.k, k2 = dir > 0 ? pc.k2 + 1 : pc.k2;
  if (k < 0 || k2 >= pc.cols.length) return;
  // where the piece will end up: the plan with the column added, worked out without drawing it
  const was = art._colOpen;
  art._colOpen = { ...was, [pc.key]: [k, k2] };
  const target = colPlan(art, content)?.pieces.find((q) => q.key === pc.key);
  art._colOpen = was;
  if (!target) return;
  const clip = body.querySelectorAll(':scope > .piece')[i];
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  dragging = {
    kind: 'col', art, i, dir, handle, clip, frame: clip.querySelector('.pdf-frame'),
    from: { span: [...pc.span], band: [...pc.band] }, to: { span: target.span, band: target.band },
    now: { ...was, [pc.key]: [k, k2] }, was,
    x0: e.clientX, x: e.clientX, y0: e.clientY, y: e.clientY, reach: Math.max(120, clip.offsetWidth * 0.55), moved: false, p: 0,
  };
  art.classList.add('dragging');
  handle.classList.add('on');
  dragLoop();
}
function moveDrag(e) {
  const d = dragging;
  if (!d || !d.handle.hasPointerCapture?.(e.pointerId)) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (Math.hypot(d.x - (d.x0 ?? d.x), d.y - d.y0) > 6) d.moved = true;
}
function endDrag(e, cancelled) {
  const d = dragging;
  if (!d) return;
  dragging = null;
  cancelAnimationFrame(d.raf);
  d.art.classList.remove('dragging');
  d.handle.classList.remove('on');
  const art = d.art;
  if (!d.moved && !cancelled) { // a tap: same as the button
    if (d.kind === 'edge') expandEdge(art, d.side);
    else shiftColumn(art, d.i, d.dir);
    return;
  }
  if (d.kind === 'edge') {
    const now = { open: cropOpen.get(pkey(art.dataset.doc, Number(art.dataset.n))), px: art._pieceX };
    if (Math.abs(d.cur[0] - d.band[0]) < 0.001 && Math.abs(d.cur[1] - d.band[1]) < 0.001) return;
    d.set(d.cur);
    const key = pkey(art.dataset.doc, Number(art.dataset.n));
    const after = { open: cropOpen.get(key), px: art._pieceX };
    const put = (st) => { if (st.open) cropOpen.set(key, st.open); else cropOpen.delete(key); art._pieceX = st.px; if (art.isConnected) applyCrop(art); };
    void now;
    recordCustom(d.side === 'top' ? 'Show above' : 'Show below', () => put(d.was), () => put(after));
    applyCrop(art);
    return;
  }
  // sideways: past about a third finishes the move, otherwise it springs back
  const go = d.p > 0.33 && !cancelled;
  const from = d.p, to = go ? 1 : 0, t0 = performance.now(), ms = 260;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    applyCol(d, lerp(from, to, 1 - Math.pow(1 - k, 3)));
    if (k < 1) { requestAnimationFrame(step); return; }
    if (go) {
      const set = (v) => { art._colOpen = v; if (art.isConnected) applyCrop(art); };
      recordCustom(d.dir > 0 ? 'Column to the right' : 'Column to the left', () => set(d.was), () => set(d.now));
      art._colOpen = d.now;
    }
    art.lastElementChild._pieceSig = null;
    applyCrop(art);
  };
  requestAnimationFrame(step);
}
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest?.('.edge-drag, .col-drag');
  if (!h || dragging) return;
  if (h.classList.contains('col-drag')) startColDrag(e, h); else startEdgeDrag(e, h);
});
document.addEventListener('pointermove', moveDrag);
document.addEventListener('pointerup', (e) => endDrag(e, false));
document.addEventListener('pointercancel', (e) => endDrag(e, true));
// the page mustn't scroll under a finger that's dragging a bar
document.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });

// Open a cropped page out to the whole page ('all'), or crop it to the hits again ('crop'), keeping the
// hits where they are on screen.
function expandCrop(art, how) {
  const key = pkey(art.dataset.doc, Number(art.dataset.n));
  record(how === 'crop' ? `Crop page ${Number(art.dataset.n) + 1}` : `Whole page ${Number(art.dataset.n) + 1}`);
  const from = how === 'crop' ? null : visibleRegion(art);
  if (how === 'crop') cropOpen.delete(key);
  else cropOpen.set(key, { top: true, bottom: true });
  const content = art.querySelector('.pdf-frame:not(.clone), .page-text');
  const before = content?.getBoundingClientRect().top;
  applyCrop(art);
  if (from && content?.classList.contains('pdf-frame')) { zoomOutTo(art, from); return; }
  if (before == null) return;
  const after = content.getBoundingClientRect().top;
  if (after !== before) window.scrollBy({ top: after - before, behavior: 'instant' });
  if (!reduceMotion()) art.lastElementChild.animate([{ opacity: 0.35, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
}

// ---------- column view ----------
// With columns on, a cropped hit page shows only the column(s) holding its hits — a, b, c… — each cut to the
// lines around its hits and filling the width. "Show the whole page" zooms back out to the full page.
const COL_NAMES = 'abcdefgh';
const boxCenter = (b) => parseFloat(b.style.left) / 100 + parseFloat(b.style.width) / 200;
// Columns around one spot on the page, from only the text in rows y0..y1 — so a picture or heading that
// runs across the page somewhere else doesn't hide the columns where your hit is. Returns [left, right]
// spans, or null when the text there is one column.
function localColumns(lines, y0, y1) {
  if (!lines?.length) return null;
  const N = 240;
  const cov = new Float32Array(N);
  let rows = 0;
  for (let i = 0; i < lines.length; i += 4) {
    const ov = Math.min(lines[i + 3], y1) - Math.max(lines[i + 2], y0);
    if (ov <= 0) continue;
    rows++;
    const i0 = Math.max(0, Math.floor(lines[i] * N)), i1 = Math.min(N - 1, Math.ceil(lines[i + 1] * N) - 1);
    for (let k = i0; k <= i1; k++) cov[k] += ov;
  }
  if (rows < 3) return null;
  let lo = 0, hi = N - 1;
  while (lo < N && !cov[lo]) lo++;
  while (hi > lo && !cov[hi]) hi--;
  if (hi - lo < N * 0.4) return null;
  let max = 0;
  for (let k = lo; k <= hi; k++) max = Math.max(max, cov[k]);
  const quiet = (k) => cov[k] < max * 0.2; // a line or two crossing the gutter (a heading) is fine
  const cols = [];
  let start = lo;
  for (let k = lo + 1; k < hi; ) {
    if (!quiet(k)) { k++; continue; }
    let e = k;
    while (e < hi && quiet(e)) e++;
    if (e - k >= 3) { cols.push([start, k]); start = e; }
    k = e + 1;
  }
  cols.push([start, hi + 1]);
  const keep = cols.filter(([a, b]) => (b - a) / N >= 0.18).map(([a, b]) => [a / N, b / N]);
  if (keep.length < 2) return null;
  // each column reaches as far as its lines actually run, but never into the next column's text
  const ends = keep.map(([, b]) => b);
  for (let i = 0; i < lines.length; i += 4) {
    if (Math.min(lines[i + 3], y1) - Math.max(lines[i + 2], y0) <= 0) continue;
    const k = keep.findIndex(([a, b]) => lines[i] >= a - 0.005 && lines[i] < b);
    if (k >= 0) ends[k] = Math.max(ends[k], Math.min(lines[i + 1], keep[k + 1]?.[0] ?? 1));
  }
  return keep.map(([a], k) => [
    Math.max(0, a - 0.012, k > 0 ? ends[k - 1] + 0.003 : 0),
    Math.min(1, ends[k] + 0.012, k < keep.length - 1 ? keep[k + 1][0] - 0.003 : 1),
  ]);
}
// With columns on, each hit is shown in just its column (worked out around that hit), with the lines
// around it. Hits next to each other in the same column share a piece; a hit in full-width text gets a
// full-width piece. The side arrows can move a piece to the column beside it.
function colPlan(art, content) {
  if (!prefs.columns || !content.classList.contains('pdf-frame') || !cropWanted(art)) return null;
  const open = cropOpen.get(pkey(art.dataset.doc, Number(art.dataset.n)));
  if (open?.top && open?.bottom) return null;
  const lines = content._lines;
  const boxes = [...content.querySelectorAll('.box.m')];
  if (!lines || !boxes.length) return null;
  const hs = boxes.map((b) => parseFloat(b.style.height) / 100).filter((h) => h > 0).sort((a, b) => a - b);
  const line = (hs[hs.length >> 1] || 0.015) * 1.15;
  const pad = line * (Number(prefs.cropLines) || 3);
  const ty = prefs.trim && content.dataset.ty ? content.dataset.ty.split(',').map(Number) : [0, 1];
  const tx = content.dataset.tx ? content.dataset.tx.split(',').map(Number) : [0, 1];
  // each hit: its band of rows, and the column it sits in there
  const hits = boxes.map((b) => {
    const top = parseFloat(b.style.top) / 100, bot = top + parseFloat(b.style.height) / 100;
    const cols = localColumns(lines, top - pad, bot + pad);
    const c = boxCenter(b);
    const k = cols ? cols.findIndex(([x0, x1]) => c >= x0 && c < x1) : -1;
    return { top, bot, cols: k >= 0 ? cols : null, k };
  }).sort((a, b) => a.top - b.top);
  if (!hits.some((h) => h.cols)) return null;
  const same = (a, b) => (!a.cols && !b.cols) || (a.cols && b.cols && Math.abs(a.cols[a.k][0] - b.cols[b.k][0]) < 0.03 && Math.abs(a.cols[a.k][1] - b.cols[b.k][1]) < 0.03);
  const groups = [];
  for (const h of hits) {
    const g = groups.find((x) => same(x, h) && h.top - pad <= x.bot + pad + line);
    if (g) { g.bot = Math.max(g.bot, h.bot); g.top = Math.min(g.top, h.top); }
    else groups.push({ ...h });
  }
  // one crop per page: hits in more than one place (or column) get one band around them all, full width
  if (groups.length > 1) return null;
  // reading order: down the left column, then the next one
  groups.sort((a, b) => (a.cols ? a.cols[a.k][0] : 0) - (b.cols ? b.cols[b.k][0] : 0) || a.top - b.top);
  const opened = art._colOpen || {};
  let pieces = groups.map((g) => {
    let a = g.top - pad, z = g.bot + pad;
    if (open?.top || a < ty[0] + line * 1.5) a = ty[0];
    if (open?.bottom || z > ty[1] - line * 1.5) z = ty[1];
    const key = `${g.top.toFixed(3)}`;
    const px = art._pieceX?.[key]; // this piece dragged open part of the way
    if (px?.at != null) a = Math.max(ty[0], Math.min(a, px.at));
    if (px?.ab != null) z = Math.min(ty[1], Math.max(z, px.ab));
    if (!g.cols) return { key, cols: null, k: -1, k2: -1, span: tx, band: [Math.max(0, a), Math.min(1, z)], cutA: a > ty[0] + 0.005, cutB: z < ty[1] - 0.005 };
    const r = opened[key];
    const k = r ? Math.max(0, r[0]) : g.k, k2 = r ? Math.min(g.cols.length - 1, r[1]) : g.k;
    // with a neighbouring column revealed, show both columns from where they start to where they end
    let span = [g.cols[k][0], g.cols[k2][1]];
    if (k2 > k) {
      [a, z] = columnRun(lines, g.cols, k, k2, g.top, g.bot, ty, line);
      // reach the real ends of the lines in the run, however long they get
      for (let i = 0; i < lines.length; i += 4) {
        const c = (lines[i] + lines[i + 1]) / 2;
        if (lines[i + 3] < a || lines[i + 2] > z || c < span[0] || c > span[1]) continue;
        span = [Math.max(span[0] - 0.05, Math.min(span[0], lines[i] - 0.01)), Math.min(span[1] + 0.05, Math.max(span[1], lines[i + 1] + 0.01))];
      }
      span = [Math.max(0, span[0]), Math.min(1, span[1])];
    }
    return { key, cols: g.cols, k, k2, wide: k2 > k, span, band: [Math.max(0, a), Math.min(1, z)], cutA: a > ty[0] + 0.005, cutB: z < ty[1] - 0.005 };
  });
  // an opened-up piece takes in any other piece that now sits inside it
  pieces = pieces.filter((p) => !pieces.some((q) => q !== p && q.wide && q.span[0] <= (p.span[0] + p.span[1]) / 2 && (p.span[0] + p.span[1]) / 2 <= q.span[1] && q.band[0] <= p.band[0] + 0.01 && p.band[1] <= q.band[1] + 0.01));
  return { pieces };
}
// How far up and down the page a run of columns goes: until a line runs across the gap between them
// (a full-width heading, figure caption or paragraph), or the page ends.
function columnRun(lines, cols, k, k2, top, bot, ty, line) {
  let a = ty[0], z = ty[1];
  for (let g = k; g < k2; g++) {
    const g0 = cols[g][1], g1 = cols[g + 1][0];
    for (let i = 0; i < lines.length; i += 4) {
      if (!(lines[i] < g0 - 0.004 && lines[i + 1] > g1 + 0.004)) continue;
      if (lines[i + 3] <= top) a = Math.max(a, lines[i + 3] + 0.004);
      else if (lines[i + 2] >= bot) z = Math.min(z, lines[i + 2] - 0.004);
    }
  }
  // …or a stretch with no text in the columns at all (a picture, a big break)
  const x0 = cols[k][0], x1 = cols[k2][1], gap = line * 3.2;
  const ls = [];
  for (let i = 0; i < lines.length; i += 4) {
    const c = (lines[i] + lines[i + 1]) / 2;
    // column text starts at a column's left edge; labels scattered over a picture don't
    const flush = cols.slice(k, k2 + 1).some(([l]) => Math.abs(lines[i] - l - 0.012) < 0.03);
    if (flush && c >= x0 && c <= x1 && lines[i + 2] >= a - 0.002 && lines[i + 3] <= z + 0.002) ls.push([lines[i + 2], lines[i + 3]]);
  }
  let up = top;
  for (const [t, b] of ls.filter(([, b]) => b <= top + 0.002).sort((p, q) => q[1] - p[1])) {
    if (up - b > gap) break;
    up = Math.min(up, t);
  }
  let down = bot;
  for (const [t, b] of ls.filter(([t]) => t >= bot - 0.002).sort((p, q) => p[0] - q[0])) {
    if (t - down > gap) break;
    down = Math.max(down, b);
  }
  return [Math.max(a, up - line * 0.4), Math.min(z, down + line * 0.4)];
}
function copyCanvases(frame, c) {
  const src = [...frame.querySelectorAll('canvas')];
  for (const old of c.querySelectorAll('canvas')) { old.width = old.height = 0; old.remove(); }
  const sheet = c.querySelector('.pdf-page');
  const first = sheet.firstChild;
  for (const s of src) {
    const d = s.cloneNode(false);
    d.width = s.width; d.height = s.height;
    if (s.width) d.getContext('2d').drawImage(s, 0, 0);
    sheet.insertBefore(d, first);
  }
}
function cloneFrame(frame) {
  const c = frame.cloneNode(true);
  c.classList.add('clone');
  copyCanvases(frame, c);
  return c;
}
function frameSpan(frame, span) {
  if (span) { frame.style.setProperty('--ts', (1 / (span[1] - span[0])).toFixed(4)); frame.style.setProperty('--tx0', span[0].toFixed(4)); }
  else { frame.style.removeProperty('--ts'); frame.style.removeProperty('--tx0'); }
}
function unpiece(art, body, content) {
  for (const b of content.querySelectorAll('.box.off')) {
    b.classList.remove('off');
    if (b.dataset.hOff != null) { b.dataset.h = b.dataset.hOff; delete b.dataset.hOff; }
  }
  frameSpan(content, content.dataset.tx ? content.dataset.tx.split(',').map(Number) : null);
  if (body.querySelector(':scope > .piece')) body.replaceChildren(content);
  body.classList.remove('pieces');
  body._pieceSig = null;
  art._regions = null;
}
function layoutPieces(art, body, content, plan) {
  const sig = plan.pieces.map((p) => `${p.key}:${p.span.map((x) => x.toFixed(3)).join('-')}`).join(',');
  if (body._pieceSig !== sig || !body.querySelector(':scope > .piece')) {
    unpiece(art, body, content);
    const frames = plan.pieces.map((_, k) => (k === 0 ? content : cloneFrame(content)));
    body.replaceChildren();
    plan.pieces.forEach((pc, k) => {
      const frame = frames[k];
      frameSpan(frame, pc.span);
      // each hit lives in exactly one piece, so jumping to it lands in the right column
      for (const b of frame.querySelectorAll('.box')) {
        const c = boxCenter(b);
        if (c >= pc.span[0] && c < pc.span[1]) continue;
        if (k > 0) { b.remove(); continue; }
        b.classList.add('off');
        if (b.dataset.h != null) { b.dataset.hOff = b.dataset.h; delete b.dataset.h; }
      }
      const clip = el('div', 'crop-clip piece');
      const inner = el('div', 'crop-inner');
      inner.append(frame);
      clip.append(inner);
      // arrows tucked into the sides when there's a column that way
      const nav = (side, act, label) => {
        if (prefs.expand === 'drag') {
          const b = el('button', `col-drag ${side}`, '<i></i>');
          b.dataset.drag = act;
          b.dataset.piece = k;
          b.setAttribute('aria-label', `${label} (pull inward)`);
          body.append(b);
          return;
        }
        const b = el('button', `col-nav ${side}`, `<svg class="cn-eye" viewBox="0 0 20 76" preserveAspectRatio="none"><path class="f" d="${EYE}Z"/><path d="${EYE}"/></svg>${I.chevron}`);
        b.dataset.act = act;
        b.dataset.piece = k;
        b.setAttribute('aria-label', label);
        body.append(b);
      };
      if (pc.cols && pc.k > 0) nav('left', 'col-prev', 'Show the column to the left too');
      if (pc.cols && pc.k2 < pc.cols.length - 1) nav('right', 'col-next', 'Show the column to the right too');
      body.append(clip);
    });
    body._pieceSig = sig;
    art._cropRO?.disconnect();
    let seen = 0;
    art._cropRO = new ResizeObserver(() => {
      const h = content.offsetHeight;
      if (Math.abs(h - seen) > 0.5) { seen = h; applyCrop(art); }
    });
    art._cropRO.observe(content);
  }
  if (content._sharpen) {
    const ys = plan.pieces.map((p) => p.band), xs = plan.pieces.map((p) => p.span || [0, 1]);
    content._sharpen([Math.min(...ys.map((b) => b[0])), Math.max(...ys.map((b) => b[1]))], [Math.min(...xs.map((b) => b[0])), Math.max(...xs.map((b) => b[1]))]);
    // the copies for the other pieces take the sharp drawing too, once it's there
    content._onSharp = () => { for (const c of body.querySelectorAll('.pdf-frame.clone')) copyCanvases(content, c); };
  }
  const so = content.querySelector('.pdf-page');
  [...body.querySelectorAll(':scope > .piece')].forEach((clip, k) => {
    const pc = plan.pieces[k];
    const frame = clip.querySelector('.pdf-frame');
    if (k > 0) {
      // the copy's invisible text is sized for its own width
      const sc = frame.querySelector('.pdf-page');
      const sf = parseFloat(so?.style.getPropertyValue('--sf'));
      if (sf && so.clientWidth && sc) sc.style.setProperty('--sf', ((sf * sc.clientWidth) / so.clientWidth).toFixed(5));
    }
    const H = frame.offsetHeight;
    clip.style.height = Math.max(24, Math.round((pc.band[1] - pc.band[0]) * H)) + 'px';
    clip.firstElementChild.style.marginTop = -Math.round(pc.band[0] * H) + 'px';
    clip.classList.toggle('cut-a', pc.cutA);
    clip.classList.toggle('cut-b', pc.cutB);
    // the side arrows sit on the card's border, level with the middle of their piece
    for (const nav of body.querySelectorAll(`:scope > :is(.col-nav, .col-drag)[data-piece="${k}"]`)) {
      const h = clip.offsetHeight;
      nav.style.height = Math.max(30, Math.min(76, h - 12)) + 'px';
      nav.style.top = clip.offsetTop + h / 2 + 'px';
    }
  });
  body.classList.add('cropped', 'pieces');
  body.classList.remove('cut-top', 'cut-bottom');
  art._band = null;
  art._regions = plan.pieces.map((p) => ({ x: p.span, y: p.band }));
  art._plan = plan;
  edgeNavs(body, plan.pieces.some((p) => p.cutA), plan.pieces.some((p) => p.cutB));
}
// The border splits around a side arrow and closes again after it, like a venturi run backwards.
const EYE = 'M10 0C10 13 1.5 16 1.5 27L1.5 49C1.5 60 10 63 10 76C10 63 18.5 60 18.5 49L18.5 27C18.5 16 10 13 10 0';
// Slide a piece over to the column beside it: the page glides sideways inside the piece.
function shiftColumn(art, i, dir) {
  const pc = art._plan?.pieces[i];
  if (!pc?.cols) return;
  const k = dir < 0 ? pc.k - 1 : pc.k, k2 = dir > 0 ? pc.k2 + 1 : pc.k2;
  if (k < 0 || k2 >= pc.cols.length) return;
  const was = art._colOpen, now = { ...art._colOpen, [pc.key]: [k, k2] };
  const set = (v) => { art._colOpen = v; if (art.isConnected) applyCrop(art); };
  recordCustom(dir > 0 ? 'Column to the right' : 'Column to the left', () => set(was), () => set(now));
  const body = art.lastElementChild;
  const oldClip = body.querySelectorAll(':scope > .piece')[i];
  const before = oldClip?.querySelector('.pdf-page')?.getBoundingClientRect();
  const oldR = oldClip?.getBoundingClientRect();
  art._colOpen = now;
  applyCrop(art);
  const clip = [...body.querySelectorAll(':scope > .piece')].find((c, n) => art._plan.pieces[n]?.key === pc.key);
  const sheet = clip?.querySelector('.pdf-page');
  if (!before || !sheet || reduceMotion()) return;
  // the page shrinks to fit both columns and the piece opens up and down around where you were
  const after = sheet.getBoundingClientRect();
  const sc = before.width / after.width;
  const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
  sheet.style.transformOrigin = '0 0';
  sheet.animate([{ transform: `translate(${(before.left - after.left).toFixed(1)}px, ${(before.top - after.top).toFixed(1)}px) scale(${sc.toFixed(4)})` }, { transform: 'none' }], { duration: 520, easing: ease });
  const r = clip.getBoundingClientRect();
  if (oldR && r.height > oldR.height + 1) {
    const top = Math.max(0, Math.min(r.height - oldR.height, oldR.top - r.top));
    const bottom = Math.max(0, r.height - oldR.height - top);
    clip.animate([{ clipPath: `inset(${top.toFixed(1)}px 0 ${bottom.toFixed(1)}px 0)` }, { clipPath: 'inset(0 0 0 0)' }], { duration: 520, easing: ease });
  }
}
// What part of the page is on screen right now (for the zoom-out): its rect, and where it sits on the page.
function visibleRegion(art) {
  const body = art.lastElementChild;
  const pieces = [...body.querySelectorAll(':scope > .piece')];
  const clip = pieces.find((p) => p.querySelector('.cur')) || pieces[0] || body.querySelector(':scope > .crop-clip');
  const frame = clip?.querySelector('.pdf-frame');
  if (!frame) return null;
  const ts = parseFloat(frame.style.getPropertyValue('--ts')) || 1;
  const tx0 = parseFloat(frame.style.getPropertyValue('--tx0')) || 0;
  const k = pieces.indexOf(clip);
  const y = k >= 0 ? art._regions?.[k]?.y : art._band;
  if (!y) return null;
  return { rect: clip.getBoundingClientRect(), x: [tx0, tx0 + 1 / ts], y };
}
// The page zooms out from the part you were reading to the whole page: the rest of the page (other
// columns included) comes in around it, while that part stays where your eyes are.
function zoomOutTo(art, from) {
  const body = art.lastElementChild;
  const sheet = body.querySelector('.pdf-frame:not(.clone) .pdf-page');
  if (!sheet) return;
  let S = sheet.getBoundingClientRect();
  const dy = S.top + from.y[0] * S.height - from.rect.top;
  if (Math.abs(dy) > 1) { window.scrollBy({ top: dy, behavior: 'instant' }); S = sheet.getBoundingClientRect(); }
  if (reduceMotion()) return;
  const R = { left: S.left + from.x[0] * S.width, top: S.top + from.y[0] * S.height, width: (from.x[1] - from.x[0]) * S.width, height: (from.y[1] - from.y[0]) * S.height };
  const E = body.getBoundingClientRect();
  const k = from.rect.width / Math.max(1, R.width);
  const tx = from.rect.left - E.left - (R.left - E.left) * k;
  const ty = from.rect.top - E.top - (R.top - E.top) * k;
  const px = (v) => `${Math.max(0, v).toFixed(1)}px`;
  const clipFrom = `inset(${px(R.top - E.top)} ${px(E.right - R.left - R.width)} ${px(E.bottom - R.top - R.height)} ${px(R.left - E.left)} round 14px)`;
  art.classList.add('zooming');
  body.style.transformOrigin = '0 0';
  const anim = body.animate(
    [{ transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(4)})`, clipPath: clipFrom }, { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 14px)' }],
    { duration: 640, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  );
  anim.onfinish = anim.oncancel = () => { art.classList.remove('zooming'); body.style.transformOrigin = ''; };
}
function setFit(mode) {
  const same = mode === 'column' ? prefs.columns : !prefs.columns && prefs.zoom === mode;
  const offCol = same && mode === 'column'; // column view off → back to fit width
  record(offCol ? 'Column view off' : same ? 'Zoom 100%' : mode === 'column' ? 'Column view' : mode === 'page' ? 'Fit page' : 'Fit width');
  H.busy = true;
  try {
    prefs.columns = !same && mode === 'column';
    prefs.zoom = offCol ? 'width' : same ? 1 : mode === 'page' ? 'page' : 'width';
    savePrefs();
    applyZoom();
    recropAll();
  } finally { H.busy = false; }
}
// What a page will roughly take before it's drawn (a cropped hit page is only a band of the page).
function bodyEstimate(art, doc, n) {
  const full = art._flat && doc.kind === 'html' ? estimate(doc, n, 'text') : estimate(doc, n);
  if (!cropWanted(art)) return full;
  const z = zoomValue();
  const orig = pageMode(doc, n) === 'original';
  // once a few cropped pages have been drawn, their real heights are the best guess for the rest
  const seen = cropSeen[orig ? 'o' : 't'];
  if (seen.n >= 2 && seen.key === cropKey()) return Math.min(full, Math.round(seen.avg * z));
  const line = (orig ? (BASE_W * z * S.pageAspect) / 52 : 16.5 * 1.66 * z) * (orig && prefs.columns ? 2 : 1);
  return Math.min(full, Math.round(line * (2 * (Number(prefs.cropLines) || 3) + 2) + 70));
}
const cropSeen = { o: { n: 0, avg: 0, key: '' }, t: { n: 0, avg: 0, key: '' } };
const cropKey = () => `${prefs.cropLines}|${!!prefs.columns}|${!!prefs.trim}`;
function noteCropHeight(art, orig) {
  if (!art._band || !cropWanted(art)) return;
  const h = art.lastElementChild.offsetHeight / zoomValue();
  if (!h) return;
  const s = cropSeen[orig ? 'o' : 't'], k = cropKey();
  if (s.key !== k) { s.key = k; s.n = 0; s.avg = 0; }
  s.avg = s.n ? s.avg + (h - s.avg) / Math.min(s.n + 1, 30) : h;
  s.n++;
}
let recropT = 0;
function recropAll() {
  cancelAnimationFrame(recropT);
  recropT = requestAnimationFrame(() => {
    const a = captureAnchor();
    for (const art of results.pageEls.values()) {
      const body = art.lastElementChild;
      if (body.querySelector(':scope > .crop-clip, :scope > .pdf-frame, :scope > .page-text')) applyCrop(art);
      else if (!art._filled) body.style.height = bodyEstimate(art, docById(art.dataset.doc), Number(art.dataset.n)) + 'px';
    }
    restoreAnchor(a);
    trackPosition();
  });
}
function setCrop(on) {
  record(on ? 'Crop to hits' : 'Show whole pages');
  prefs.crop = !!on;
  savePrefs();
  syncControls();
  recropAll();
}
function setTrim(on) {
  record(on ? 'Trim margins' : 'Keep margins');
  prefs.trim = !!on;
  savePrefs();
  syncControls();
  for (const v of [results, reader]) {
    if (v !== active) { v.dirty = true; continue; }
    for (const art of v.pageEls.values()) if (art._cleanup && art.querySelector('.pdf-frame')) refill(art);
  }
}
function setCropLines(n) {
  record('Lines around hits', { group: 'lines' });
  prefs.cropLines = Math.max(1, Math.min(15, Math.round(Number(n) || 3)));
  savePrefs();
  syncControls();
  if (prefs.crop) recropAll();
}

function setPageNav(v) {
  if (prefs.pageNav === v) return;
  record(v === 'swipe' ? 'Swipe for pages' : 'Tabs for pages');
  prefs.pageNav = v;
  savePrefs();
  syncControls();
  redrawMenu?.();
  if (v === 'swipe' && !localStorage.getItem('instant-search:swipe-told')) {
    toast('Swipe a result sideways for the page before or after it');
    try { localStorage.setItem('instant-search:swipe-told', '1'); } catch {}
  }
}

// ---------- swiping a result to the page before or after it ----------
// The next (or previous) page slides in over the result, as a whole page; a button by the page number
// brings the result back. The list of results never grows.
function visitEl(home, n) {
  const v = home._v;
  const doc = docById(home.dataset.doc);
  const art = el('article', 'page extra visit');
  art.dataset.doc = doc.id;
  art.dataset.n = n;
  art._v = v;
  art._ctx = true;
  art._flat = home._flat;
  art._home = home;
  const info = v.info.get(pkey(doc.id, n));
  const hn = Number(home.dataset.n);
  const head = el('header', 'page-head', `<span class="ph-pill"><span class="pno">Page ${esc(plabel(doc, n))}</span>${info ? `<span class="phits">${fmt(info.count)}</span>` : ''}</span><span class="grow"></span><button class="visit-back" data-act="visit-back" title="Back to the result">${I.undo}Page ${esc(plabel(doc, hn))}</button>`);
  const body = el('div', 'page-body');
  body.style.minHeight = Math.round(home.lastElementChild.offsetHeight) + 'px';
  art.append(head, body);
  return art;
}
// Start drawing the page before/after off-screen (while your finger is still moving).
function prepVisit(home, n) {
  const shown = home._visit || home;
  if (n === Number(home.dataset.n)) return null;
  const next = visitEl(home, n);
  next.classList.add('visit-stage');
  next.style.width = shown.offsetWidth + 'px';
  shown.after(next);
  next._ready = Promise.race([fill(next), new Promise((r) => setTimeout(r, 2500))]);
  return next;
}
async function goVisit(home, n, dir, rec = true, prepped = null) {
  const cur = home._visit || null;
  const shown = cur || home;
  const curN = Number(shown.dataset.n);
  const homeN = Number(home.dataset.n);
  const drop = () => { if (prepped && prepped !== home) { prepped._cleanup?.(); prepped.remove(); } };
  if (n === curN || !shown.isConnected || shown._busy) return drop();
  const count = S.texts.get(home.dataset.doc)?.length || 0;
  if (n < 0 || n >= count) { // the document ends here: a little bump
    drop();
    if (!reduceMotion()) shown.animate([{ transform: 'none' }, { transform: `translateX(${-dir * 18}px)` }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    return;
  }
  if (rec) recordCustom(`Page ${plabel(docById(home.dataset.doc), n)}`, () => goVisit(home, curN, -dir, false), () => goVisit(home, n, dir, false));
  shown._busy = true;
  let next = home;
  if (n !== homeN) {
    next = prepped && Number(prepped.dataset.n) === n ? prepped : (drop(), prepVisit(home, n));
    await next._ready;
    if (!shown.isConnected) { next.remove(); shown._busy = false; return; }
    next.lastElementChild.style.minHeight = '';
    next.classList.remove('visit-stage', 'peeking');
    for (const k of ['width', 'top', 'left', 'transform']) next.style[k] = '';
  } else drop();

  // both pages at once: the one you're leaving lifts off and fades, the new one slides in under the veil
  const html = document.documentElement;
  html.style.overflowAnchor = 'none';
  const top = shown.getBoundingClientRect().top;
  const ghost = !reduceMotion() && dir;
  if (ghost) {
    const parent = shown.parentElement;
    Object.assign(shown.style, { position: 'absolute', zIndex: '3', pointerEvents: 'none', top: shown.offsetTop + 'px', left: shown.offsetLeft + 'px', width: shown.offsetWidth + 'px', margin: '0' });
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  }
  if (next === home) { home.hidden = false; if (!home.lastElementChild.style.height || home.lastElementChild.style.height === '0px') home.lastElementChild.style.height = ''; fill(home); }
  else if (next.previousElementSibling !== shown) shown.after(next);
  if (!ghost) { if (cur) { cur._cleanup?.(); cur.remove(); } else home.hidden = true; }
  home._visit = next === home ? null : next;
  const d = next.getBoundingClientRect().top - top;
  if (d) window.scrollBy({ top: d, behavior: 'instant' });
  if (ghost) shown.style.top = next.offsetTop + 'px';
  const toTop = () => { // a page you've moved to starts at its top
    const t = next.getBoundingClientRect().top;
    if (t < topOffset() - 40) window.scrollBy({ top: t - topOffset() - 8, behavior: 'smooth' });
  };
  requestAnimationFrame(() => { html.style.overflowAnchor = ''; });
  const finish = () => {
    if (cur) { cur._cleanup?.(); cur.remove(); }
    else if (shown === home) home.hidden = true;
    for (const k of ['position', 'zIndex', 'pointerEvents', 'top', 'left', 'width', 'margin', 'transform', 'opacity']) shown.style[k] = '';
    shown._busy = false;
    markStuck();
    if (rec) toTop();
  };
  if (!ghost) { shown._busy = false; if (!reduceMotion()) next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 }); markStuck(); if (rec) toTop(); return; }
  const from = shown._drag || 0; // where the finger left it
  const ease = 'cubic-bezier(0.25, 0.9, 0.3, 1)';
  if (next._peekX != null) {
    // it was already peeking in from the side: carry on like a carousel, both pages moving together
    const w = shown.offsetWidth + SWIPE_GAP;
    const t = Math.max(240, Math.min(420, Math.abs(next._peekX) * 1.1));
    shown.animate([{ transform: `translateX(${from}px)`, opacity: shown._dragO ?? 1 }, { transform: `translateX(${-dir * w}px)`, opacity: 0 }], { duration: t, easing: ease, fill: 'forwards' }).onfinish = (ev) => { finish(); ev.target.cancel(); };
    next.animate([{ transform: `translateX(${next._peekX}px)` }, { transform: 'none' }], { duration: t, easing: ease });
    next._peekX = null;
  } else {
    shown.animate([{ transform: `translateX(${from}px)`, opacity: 1 }, { transform: `translateX(${-dir * 38}%) scale(0.96)`, opacity: 0 }], { duration: 420, easing: ease, fill: 'forwards' }).onfinish = (ev) => { finish(); ev.target.cancel(); };
    next.animate([{ transform: `translateX(${dir * 30}%)`, opacity: 0, filter: 'blur(3px)' }, { transform: 'none', opacity: 1, filter: 'none' }], { duration: 460, easing: ease });
  }
  shown._drag = 0;
  shown._dragO = null;
}
const SWIPE_GAP = 30;
const SWIPE_AT = 72; // how far to drag before letting go switches pages
function bindPageSwipe(host) {
  let s = null;
  // the marker that sits on the seam between the two pages: the page number in a ring that fills as you drag
  // an arrow in the gap between the two pages, pointing the way you're going
  const peek = el('div', 'swipe-peek', I.chevron);
  document.body.append(peek);
  const pageOf = (t) => {
    const art = t.closest?.('.page.hit, .page.visit');
    return art && !art._web && !art.hidden && art._v?.kind === 'results' ? art : null;
  };
  const unprep = () => { if (s?.prep) { s.prep._cleanup?.(); s.prep.remove(); s.prep = null; } };
  const hidePeek = () => { peek.classList.remove('on', 'go'); };
  host.addEventListener('pointerdown', (e) => {
    s = null;
    if (prefs.pageNav !== 'swipe' || e.pointerType === 'mouse' || e.target.closest('button, a, input, textarea, .menu')) return;
    const art = pageOf(e.target);
    if (art && !art._busy) s = { art, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, on: false, id: e.pointerId, dir: 0, prep: null, go: false };
  }, { passive: true });
  host.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) {
      if (!s.moved && Math.hypot(dx, dy) > 5) s.moved = performance.now();
      if (!s.moved && performance.now() - s.t > 420) { s = null; return; } // held still: that's a long press for selecting
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx) * 1.4) { s = null; return; } // that's scrolling
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 0.7) return; // a slanted swipe still counts
      if (String(getSelection?.() || '').trim()) { s = null; return; }
      s.on = true;
      s.w = s.art.offsetWidth;
    }
    const dir = dx < 0 ? 1 : -1;
    const home = s.art._home || s.art;
    const n = Number(s.art.dataset.n) + dir;
    const count = S.texts.get(home.dataset.doc)?.length || 0;
    const edge = n < 0 || n >= count;
    if (dir !== s.dir) { // heading the other way: get that page ready instead
      unprep();
      s.dir = dir;
      if (!edge) {
        s.prep = n === Number(home.dataset.n) ? null : prepVisit(home, n);
        if (s.prep) {
          s.prep.classList.add('peeking');
          Object.assign(s.prep.style, { top: s.art.offsetTop + 'px', left: s.art.offsetLeft + 'px', width: s.w + 'px' });
        }
      }
    }
    // the page follows your finger; the next one comes in from the side, right behind it
    const move = edge ? Math.sign(dx) * Math.min(60, Math.abs(dx) * 0.3) : dx;
    const p = Math.min(1, Math.abs(dx) / SWIPE_AT);
    s.art.style.transform = `translateX(${move}px)`;
    s.art.style.opacity = String(edge ? 1 : 1 - Math.min(0.7, (Math.abs(dx) / (s.w * 0.6)) * 0.7)); // the page you're leaving fades
    s.art._drag = move;
    s.art._dragO = Number(s.art.style.opacity);
    const peekX = dir * (s.w + SWIPE_GAP) + move;
    if (s.prep) s.prep.style.transform = `translateX(${peekX}px)`;
    // the seam marker, kept in the middle of what you can see of the page
    if (edge) { hidePeek(); return; }
    const r = s.art.getBoundingClientRect();
    const top = Math.max(r.top, topOffset()), bot = Math.min(r.bottom, innerHeight - 96);
    const seam = dir > 0 ? r.right + SWIPE_GAP / 2 : r.left - SWIPE_GAP / 2;
    peek.style.left = seam + 'px';
    peek.style.top = (bot > top ? (top + bot) / 2 : innerHeight / 2) + 'px';
    peek.style.opacity = String(Math.min(1, p * 1.5));
    peek.classList.toggle('back', dir < 0);
    peek.classList.add('on');
    const go = p >= 1;
    if (go !== s.go) { s.go = go; peek.classList.toggle('go', go); if (go) navigator.vibrate?.(6); }
  }, { passive: true });
  const end = (e, ok) => {
    if (!s || e.pointerId !== s.id) return;
    const { art, on, prep, w, dir: sdir } = s;
    const dx = e.clientX - s.x;
    const v = Math.abs(dx) / Math.max(1, performance.now() - (s.moved || s.t));
    s.prep = null;
    s = null;
    hidePeek();
    if (!on) { if (prep) { prep._cleanup?.(); prep.remove(); } return; }
    art._swiped = performance.now();
    const from = art.style.transform, fromO = art.style.opacity || '1';
    art.style.transform = '';
    art.style.opacity = '';
    const dir = dx < 0 ? 1 : -1;
    if (!ok || dir !== sdir || (Math.abs(dx) < SWIPE_AT && v < 0.45) || !prep && Number(art.dataset.n) + dir !== Number((art._home || art).dataset.n)) {
      // not far enough: both pages settle back
      art._drag = 0;
      art._dragO = null;
      if (!reduceMotion()) art.animate([{ transform: from, opacity: fromO }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
      if (prep) {
        const a = prep.animate([{ transform: prep.style.transform }, { transform: `translateX(${sdir * (w + SWIPE_GAP)}px)` }], { duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
        a.onfinish = () => { prep._cleanup?.(); prep.remove(); };
      }
      return;
    }
    if (prep) prep._peekX = dir * (w + SWIPE_GAP) + (art._drag || 0);
    goVisit(art._home || art, Number(art.dataset.n) + dir, dir, true, prep);
  };
  host.addEventListener('touchmove', (e) => {
    if (!s) return;
    const t = e.touches[0];
    if (s.on || (t && Math.abs(t.clientX - s.x) > Math.abs(t.clientY - s.y))) e.preventDefault();
  }, { passive: false });
  host.addEventListener('pointerup', (e) => end(e, true));
  host.addEventListener('pointercancel', (e) => end(e, false));
  // a swipe isn't a tap on the page
  host.addEventListener('click', (e) => { const art = e.target.closest?.('.page'); if (art && performance.now() - (art._swiped || 0) < 450) { e.stopPropagation(); e.preventDefault(); } }, true);
  // a trackpad's sideways swipe does the same
  let acc = 0, quiet = 0, tmr;
  host.addEventListener('wheel', (e) => {
    if (prefs.pageNav !== 'swipe' || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const art = pageOf(e.target);
    if (!art) return;
    e.preventDefault();
    if (performance.now() < quiet) return;
    acc += e.deltaX;
    clearTimeout(tmr);
    tmr = setTimeout(() => (acc = 0), 220);
    if (Math.abs(acc) > 120) {
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      quiet = performance.now() + 700;
      goVisit(art._home || art, Number(art.dataset.n) + dir, dir);
    }
  }, { passive: false });
}

// ---------- gaps between hit pages ----------
function visiblePages(v, doc, R) {
  const count = S.texts.get(doc.id)?.length || 0;
  if (v.kind === 'reader') return Array.from({ length: count }, (_, i) => i);
  const set = new Set(R ? R.pages.map((p) => p.n) : []);
  for (const n of v.revealed.get(groupKey(R, doc)) || []) set.add(n);
  return [...set].sort((a, b) => a - b);
}

function gapEl(doc, a, b, count, R) {
  const hidden = b - a - 1;
  const g = el('div', 'gap');
  g.dataset.doc = doc.id;
  g.dataset.key = groupKey(R, doc);
  g._R = R;
  g.dataset.a = a;
  g.dataset.b = b;
  // Tabs on the right, like a notebook's: "next page" hangs off the bottom of the page above, "page before"
  // sticks up from the top of the page below. (Pages past the end of the document have no tab.)
  const unfold = '<svg viewBox="0 0 24 24"><path d="M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>';
  const down = a >= 0 ? `<button class="gap-tab down" data-act="after" title="Show page ${esc(plabel(doc, a + 1))}">${I.down}${esc(plabel(doc, a + 1))}</button>` : '';
  const up = b < count && (hidden > 1 || a < 0) ? `<button class="gap-tab up" data-act="before" title="Show page ${esc(plabel(doc, b - 1))}">${I.up}${esc(plabel(doc, b - 1))}</button>` : '';
  const all = '';
  g.classList.toggle('has-down', !!down);
  g.classList.toggle('has-up', !!up);
  g.innerHTML = (down || (all && !up) ? `<div class="gap-row">${all}${down}</div>` : '') + (up ? `<div class="gap-row">${down ? '' : all}${up}</div>` : '');
  return g;
}

function nodesBetween(v, doc, vis, a, b, R) {
  if (webMode(doc, R)) return a < 0 ? [webEl(v, doc, R)] : [];
  const count = S.texts.get(doc.id)?.length || 0;
  const nodes = [];
  let prev = a;
  for (const n of vis) {
    if (n <= a || n >= b) continue;
    if (n > prev + 1) nodes.push(gapEl(doc, prev, n, count, R));
    nodes.push(pageEl(v, doc, n, R));
    prev = n;
  }
  if (b > prev + 1) nodes.push(gapEl(doc, prev, b, count, R));
  return nodes;
}

// Open the page(s) hidden by a gap. The new page is drawn out of sight first; only once it's ready does it
// take its place — in one step, with what you're looking at staying exactly where it is — and then glide in.
async function onGap(g, act) {
  if (g._busy || !g.isConnected) return;
  const v = active;
  const doc = docById(g.dataset.doc);
  if (!doc) return;
  const a = Number(g.dataset.a);
  const b = Number(g.dataset.b);
  const R = g._R;
  const key = g.dataset.key;
  record(act === 'all' ? `Show ${plural(b - a - 1, 'page')}` : `Show page ${(act === 'after' ? a + 1 : b - 1) + 1}`);
  if (!v.revealed.has(key)) v.revealed.set(key, new Set());
  const set = v.revealed.get(key);
  if (act === 'after') set.add(a + 1);
  else if (act === 'before') set.add(b - 1);
  else for (let n = a + 1; n < b; n++) set.add(n);
  const nodes = nodesBetween(v, doc, visiblePages(v, doc, R), a, b, R);
  const pages = nodes.filter((x) => x.classList.contains('page'));

  // 1) draw it out of sight, right where it will go (same width, nothing moves yet)
  g._busy = true;
  g.classList.add('busy');
  const stage = el('div', 'gap-stage');
  stage.style.top = g.offsetTop + 'px';
  stage.append(...nodes);
  g.after(stage);
  const first = act === 'after' ? pages.slice(0, 2) : pages.slice(-2);
  await Promise.race([Promise.all(first.map((p) => fill(p))), new Promise((r) => setTimeout(r, 2500))]);
  if (!g.isConnected) { stage.remove(); return; } // the list was rebuilt meanwhile

  // 2) put it in place in one step; when it opens above you, scroll by exactly its height so nothing jumps
  const html = document.documentElement;
  html.style.overflowAnchor = 'none';
  const ref = act === 'after' ? null : stage.nextElementSibling || g.closest('.doc-sec')?.nextElementSibling;
  const refTop = ref?.getBoundingClientRect().top;
  stage.replaceWith(...nodes);
  g.remove();
  if (ref) {
    const d = ref.getBoundingClientRect().top - refTop;
    if (d) window.scrollBy({ top: d, behavior: 'instant' });
    // pages further up that weren't drawn yet still grow later: keep compensating for those
    const sizes = new Map(nodes.map((x) => [x, x.offsetHeight]));
    const ro = new ResizeObserver((entries) => {
      let dd = 0;
      for (const en of entries) {
        const h = en.target.offsetHeight;
        dd += h - (sizes.get(en.target) ?? h);
        sizes.set(en.target, h);
      }
      if (dd) window.scrollBy({ top: dd, behavior: 'instant' });
    });
    nodes.forEach((x) => ro.observe(x));
    setTimeout(() => { ro.disconnect(); html.style.overflowAnchor = ''; }, 2500);
  } else requestAnimationFrame(() => { html.style.overflowAnchor = ''; });

  // 3) the unveil: a quick, springy glide (transform + opacity only, so it stays smooth)
  if (reduceMotion()) return;
  const from = act === 'after' ? 'translateY(-26px) scale(0.965)' : 'translateY(26px) scale(0.965)';
  for (const p of pages) {
    const r = p.getBoundingClientRect();
    if (r.bottom < -40 || r.top > innerHeight + 40) continue;
    p.style.transformOrigin = act === 'after' ? '50% 0' : '50% 100%';
    p.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }
}


// ---------- rendering views ----------
function docHeadHtml(v, doc, R) {
  const count = S.texts.get(doc.id)?.length || 0;
  if (R?.flat) {
    const f = folderOf(doc);
    return `<span class="ftype ${doc.kind}">${KIND_LABEL[doc.kind] || 'TXT'}</span><h2 title="${esc(doc.name)}">${esc(doc.name)}</h2>${f ? `<span class="dfolder" title="Folder">${I.folder}${esc(f.name)}</span>` : ''}<span class="grow"></span>`;
  }
  const stat = R && webMode(doc, R) ? `<b class="dcount" title="${plural(R.hits, 'hit')}">${fmt(R.hits)}</b>`
    : R
    ? `<b class="dcount" title="${plural(R.hits, 'hit')}">${fmt(R.hits)}</b> in ${plural(R.pages.length, 'page')}<span class="dof"> of ${fmt(count)}</span>`
    : S.matcher ? `No hits · ${plural(count, 'page')}` : plural(count, 'page');
  const btn = '';
  const f = folderOf(doc);
  const where = f ? `<span class="dfolder" title="Folder">${I.folder}${esc(f.name)}</span>` : '';
  return `<span class="ftype ${doc.kind}">${KIND_LABEL[doc.kind] || 'TXT'}</span><h2 title="${esc(doc.name)}">${esc(doc.name)}</h2>${where}<span class="dstat">${stat}</span><span class="grow"></span>${btn}`;
}

function sectionEl(v, doc, R) {
  const sec = el('section', 'doc-sec');
  sec.dataset.doc = doc.id;
  sec.dataset.key = groupKey(R, doc);
  if (R?.flat) {
    sec.classList.add('ranked');
    const prev = v.list[v.list.indexOf(R) - 1];
    if (prev?.doc.id === doc.id) sec.classList.add('same-doc'); // same document as the page above: no repeat of its name
  }
  sec.append(el('div', 'doc-head', docHeadHtml(v, doc, R)));
  const pages = el('div', 'doc-pages');
  const count = S.texts.get(doc.id)?.length || 0;
  // Ranked pages from the same document that follow each other down the document share the pages between
  // them: the upper one offers them, the lower one doesn't — so a page is never shown twice side by side.
  let lo = -1, hi = count;
  if (R?.flat) {
    const i = v.list.indexOf(R);
    const first = R.pages[0].n;
    const prev = v.list[i - 1], next = v.list[i + 1];
    if (prev?.flat && prev.doc.id === doc.id && prev.pages[0].n < first) lo = first - 1;
    if (next?.flat && next.doc.id === doc.id && next.pages[0].n > first) hi = next.pages[0].n;
  }
  pages.append(...nodesBetween(v, doc, visiblePages(v, doc, R), lo, hi, R));
  sec.append(pages);
  return sec;
}

// Returns the drawn original pages (PDF canvases / HTML frames) so a rebuilt view can keep showing them
// until their replacements are ready, instead of flashing empty cards.
function clearView(v, { keep = false } = {}) {
  const kept = new Map();
  for (const [key, art] of v.pageEls) {
    io.unobserve(art);
    ioFar.unobserve(art);
    const body = art.lastElementChild;
    if (keep && art._cleanup && body.childElementCount) {
      kept.set(key, { nodes: [...body.childNodes], height: body.offsetHeight, cleanup: [art._prevCleanup, art._cleanup].filter(Boolean) });
    } else {
      art._prevCleanup?.();
      art._cleanup?.();
    }
  }
  v.pageEls.clear();
  v.pending = null; // stop drawing the old list
  v.pendingTok = (v.pendingTok || 0) + 1;
  v.root.replaceChildren();
  return kept;
}

// ---- drawing a long results list a screenful at a time ----
// The first pages go in at once; the rest follow in small slices between frames, so typing and scrolling never
// wait for thousands of pages to be built. Anything that needs a page that isn't drawn yet finishes the list first.
function sectionJob(v, doc, R) {
  if (webMode(doc, R)) return { sec: sectionEl(v, doc, R), done: true };
  const sec = el('section', 'doc-sec');
  sec.dataset.doc = doc.id;
  sec.dataset.key = groupKey(R, doc);
  if (R?.flat) {
    sec.classList.add('ranked');
    const prev = v.list[v.list.indexOf(R) - 1];
    if (prev?.doc.id === doc.id) sec.classList.add('same-doc');
  }
  sec.append(el('div', 'doc-head', docHeadHtml(v, doc, R)));
  const pagesEl = el('div', 'doc-pages');
  sec.append(pagesEl);
  const count = S.texts.get(doc.id)?.length || 0;
  let lo = -1, hi = count;
  if (R?.flat) {
    const i = v.list.indexOf(R);
    const first = R.pages[0].n;
    const prev = v.list[i - 1], next = v.list[i + 1];
    if (prev?.flat && prev.doc.id === doc.id && prev.pages[0].n < first) lo = first - 1;
    if (next?.flat && next.doc.id === doc.id && next.pages[0].n > first) hi = next.pages[0].n;
  }
  const vis = visiblePages(v, doc, R).filter((n) => n > lo && n < hi);
  return { sec, pagesEl, doc, R, vis, lo, hi, idx: 0, done: false };
}
function renderSome(v, budget) {
  const P = v.pending;
  if (!P) return;
  while (P.i < P.jobs.length && budget > 0) {
    const j = P.jobs[P.i];
    if (!j.sec.isConnected) v.root.append(j.sec);
    if (j.done) { P.i++; continue; }
    const chunk = j.vis.slice(j.idx, j.idx + budget);
    const last = j.idx + chunk.length >= j.vis.length;
    const a = j.idx === 0 ? j.lo : j.vis[j.idx - 1];
    const b = last ? j.hi : chunk[chunk.length - 1] + 1; // only the final slice draws the gap after the last page
    j.pagesEl.append(...nodesBetween(v, j.doc, chunk, a, b, j.R));
    j.idx += chunk.length;
    budget -= Math.max(1, chunk.length);
    if (last) { j.done = true; P.i++; }
  }
  if (P.i >= P.jobs.length) v.pending = null;
}
function finishRender(v) { if (v.pending) renderSome(v, Infinity); }
function pumpRender(v, tok) {
  if (v.pendingTok !== tok || !v.pending) return;
  const t = performance.now();
  while (v.pending && performance.now() - t < 6) renderSome(v, 6);
  if (v.pending) setTimeout(() => pumpRender(v, tok), 12);
}

// Fill everything on (or just off) screen right away, so the first painted frame already shows the pages.
function fillVisibleNow(v, kept) {
  for (const [key, art] of v.pageEls) {
    const k = kept?.get(key);
    if (k) {
      art.lastElementChild.replaceChildren(...k.nodes);
      art.lastElementChild.style.height = '';
      art._prevCleanup = () => k.cleanup.forEach((f) => f());
      kept.delete(key);
    }
  }
  for (const k of kept?.values() || []) k.cleanup.forEach((f) => f());
  const margin = innerHeight;
  for (const art of v.pageEls.values()) {
    const r = art.getBoundingClientRect();
    if (r.bottom < -margin || r.top > innerHeight + margin) continue;
    fill(art);
  }
}

function renderView(v, { keepScroll = true } = {}) {
  const kept = clearView(v, { keep: true });
  v.dirty = false;
  if (v.kind === 'reader') {
    const doc = docById(v.docId);
    if (doc) v.root.append(sectionEl(v, doc, v.list[0]));
    fillVisibleNow(v, kept);
    return;
  }
  const done = () => fillVisibleNow(v, kept);
  if (!S.docs.length) { v.root.append(emptyLibrary()); done(); return; }
  if (S.error) { v.root.append(stateBox('error', 'That search can’t run', esc(S.error))); done(); return; }
  if (!S.matcher) { v.root.append(idleState()); done(); return; }
  const scope = S.docs.filter((d) => d.enabled && searchable(d));
  if (!scope.length) {
    v.root.append(stateBox('none', 'No documents selected', 'Tick at least one document in the library to search it.'));
    done();
    return;
  }
  if (!v.list.length) { v.root.append(noResults(scope.length)); done(); return; }
  v.pending = { jobs: v.list.map((R) => sectionJob(v, R.doc, R)), i: 0 };
  const tok = v.pendingTok;
  renderSome(v, keepScroll ? Infinity : 24); // keeping the place needs every page there; a fresh search needs a screenful
  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  done();
  if (v.pending) setTimeout(() => pumpRender(v, tok), 30);
}

// Re-highlight without rebuilding the page list (keeps the reader where it is).
function refreshInPlace(v) {
  if (v.dirty && v.kind === 'results') { renderView(v); return; }
  if (!v.root.childElementCount) { renderView(v); return; }
  for (const sec of $$('.doc-sec', v.root)) {
    const doc = docById(sec.dataset.doc);
    if (!doc) continue;
    const R = v.byKey?.get(sec.dataset.key);
    sec.firstElementChild.innerHTML = docHeadHtml(v, doc, R);
  }
  for (const art of v.pageEls.values()) refill(art);
  v.dirty = false;
}

function stateBox(kind, title, body, extra = '') {
  return el('div', `state ${kind}`, `<h3>${title}</h3><p>${body}</p>${extra}`);
}

function emptyLibrary() {
  const box = el('div', 'hero');
  box.innerHTML = `
    <div class="hero-drop" data-act="pick">
      <div class="hero-icon">${I.upload}</div>
      <h3>Drop documents here</h3>
      <p>PDF, Word, text, Markdown and HTML. Everything stays on this device.</p>
      <button class="btn primary" data-act="pick">Choose files</button>
    </div>
    <div class="hero-steps">
      <div><b>1</b><span>Add as many references as you like</span></div>
      <div><b>2</b><span>Search them all at once, six different ways</span></div>
      <div><b>3</b><span>Read only the pages that hit, and open the pages around them</span></div>
    </div>`;
  return box;
}

function idleState() {
  const ready = orderedDocs().filter(searchable);
  const scope = ready.filter((d) => d.enabled);
  const pages = scope.reduce((a, d) => a + (S.texts.get(d.id)?.length || 0), 0);
  const busy = S.docs.filter((d) => d.status).length;
  const box = el('div', 'idle');
  const title = !scope.length && busy
    ? `Reading ${plural(busy, 'document')}…`
    : `Search ${plural(scope.length, 'document')} · ${plural(pages, 'page')}${busy ? ` <span class="muted">(${fmt(busy)} still reading)</span>` : ''}`;
  box.innerHTML = `
    <h3>${title}</h3>
    <p class="muted">Results show the actual pages, not snippets. Pages without hits are folded away — open them whenever you want to keep reading.</p>
    <div class="tips">
      <div><code>engine failure</code><span>All words mode finds pages with both words</span></div>
      <div><code>"fuel pump"</code><span>Quotes keep words together</span></div>
      <div><code>-checklist</code><span>A minus excludes pages with that word</span></div>
      <div><code>hydraul*</code><span>A star matches any ending</span></div>
      <div><code>(stall OR spin) NOT training</code><span>Boolean mode for full logic</span></div>
      <div><span class="keys"><kbd>Enter</kbd> <kbd>⇧ Enter</kbd></span><span>Jump between hits</span></div>
    </div>
    <div class="idle-docs">${ready.map((d) => `<button class="doc-card" data-act="read" data-doc="${d.id}"><span class="ftype ${d.kind}">${KIND_LABEL[d.kind]}</span><span class="dc-name">${esc(d.name)}</span><span class="dc-meta">${plural(S.texts.get(d.id)?.length || 0, 'page')}</span></button>`).join('')}</div>`;
  return box;
}

function noResults(n) {
  const tips = [];
  if (prefs.mode === 'all' && S.terms.filter((t) => !t.neg).length > 1) tips.push('<button class="link" data-mode="any">Try Any word</button>');
  if (prefs.mode === 'near') tips.push('<button class="link" data-mode="all">Try All words (any distance)</button>');
  if (prefs.mode === 'phrase') tips.push('<button class="link" data-mode="all">Try All words</button>');
  if (prefs.wholeWord) tips.push('<button class="link" data-fix="word">Turn off whole word</button>');
  if (prefs.matchCase) tips.push('<button class="link" data-fix="case">Turn off match case</button>');
  const off = S.docs.filter((d) => !d.enabled && searchable(d)).length;
  if (off) tips.push(`<button class="link" data-fix="all">Include the other ${plural(off, 'document')}</button>`);
  return stateBox('none', 'No matches', `Nothing found in ${plural(n, 'document')}.`, tips.length ? `<div class="fixes">${tips.join('')}</div>` : '');
}

// ---------- hit navigation ----------
function locate(v, k) {
  for (const R of v.list) {
    if (k < R.hitStart || k >= R.hitStart + R.hits) continue;
    for (const p of R.pages) if (k >= p.h0 && k < p.h0 + p.count) return { R, p };
  }
  return null;
}

function markCurrent(v) {
  $$('.cur', v.root).forEach((x) => x.classList.remove('cur'));
  if (v.cur < 0) return null;
  const els = $$(`[data-h="${v.cur}"]`, v.root);
  els.forEach((x) => x.classList.add('cur'));
  return els[0] || null;
}

function topOffset() {
  if (document.body.classList.contains('bar-hidden')) return 8;
  return ($('.topbar')?.offsetHeight || 0) + 8;
}
const isPhone = () => matchMedia('(max-width: 900px)').matches;

// While the app scrolls by itself (jumping to a hit or page) the phone's top bar holds still, so the
// spot it aims for doesn't move under the bar halfway through.
let autoScrollUntil = 0;
function scrollToEl(target, block = 'center', force) {
  const r = target.getBoundingClientRect();
  const top = topOffset();
  const y = block === 'center'
    ? scrollY + r.top - (top + (innerHeight - top) / 2) + r.height / 2
    : scrollY + r.top - top - ($('.doc-head')?.offsetHeight || 0) - 6;
  const far = Math.abs(y - scrollY) > innerHeight * 2.5;
  const behavior = force || (far || reduceMotion() ? 'instant' : 'smooth');
  autoScrollUntil = performance.now() + (behavior === 'smooth' ? 900 : 300);
  window.scrollTo({ top: Math.max(0, y), behavior });
  return Math.max(0, y);
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

async function goTo(v, k, { instant = false } = {}) {
  if (!v.total) return;
  k = ((k % v.total) + v.total) % v.total;
  v.cur = k;
  updateCounter();
  const loc = locate(v, k);
  if (!loc) return;
  const art = artFor(v, loc.R.doc.id, loc.p.n);
  if (!art) return;
  if (art._visit) await goVisit(art, Number(art.dataset.n), 0, false);
  await fill(art);
  if (v.cur !== k) return;
  if (art._web) {
    // scroll inside the page; only move the list if the page card isn't fully on screen
    art._cleanup?.goto?.(webOrdinal(v, k));
    const r = art.getBoundingClientRect();
    if (r.top < topOffset() - 4 || r.bottom > innerHeight + 4) v.navY = scrollToEl(art, r.height > innerHeight - topOffset() ? 'start' : 'center', instant ? 'instant' : undefined);
    else v.navY = scrollY;
    return;
  }
  const target = markCurrent(v) || art;
  const startY = scrollY;
  v.navY = scrollToEl(target, 'center', instant ? 'instant' : undefined);
  target.classList.remove('pulse');
  void target.offsetWidth;
  target.classList.add('pulse');
  await settle(v, k, target, instant || Math.abs(v.navY - startY) > innerHeight * 2.5);
}

// Pages around the target fill in after a jump and push it around; keep re-centering until it holds still.
async function settle(v, k, target, wasInstant) {
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (!wasInstant) {
    await Promise.race([new Promise((r) => addEventListener('scrollend', r, { once: true })), new Promise((r) => setTimeout(r, 700))]);
  }
  for (let i = 0; i < 6; i++) {
    await frames();
    if (v.cur !== k || !target.isConnected) return;
    const r = target.getBoundingClientRect();
    const top = topOffset();
    const mid = top + (innerHeight - top) / 2;
    if (Math.abs(r.top + r.height / 2 - mid) < 48) return;
    v.navY = scrollToEl(target, 'center', 'instant');
  }
}

// If the reader scrolled away since the last jump, continue from what's on screen.
function startFromViewport(v, dir) {
  const arts = [];
  for (const R of v.list) for (const p of R.pages) arts.push(p);
  const top = topOffset();
  let lo = 0, hi = arts.length - 1, idx = arts.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = arts[mid];
    const R = v.list.find((r) => r.pages.includes(p));
    const a = artFor(v, R.doc.id, p.n);
    const rect = a ? a.getBoundingClientRect() : { bottom: 0 };
    if (rect.bottom > top + 40) { idx = mid; hi = mid - 1; } else lo = mid + 1;
  }
  if (idx >= arts.length) return dir > 0 ? 0 : v.total - 1;
  return dir > 0 ? arts[idx].h0 : arts[idx].h0 - 1;
}

function step(dir) {
  const v = active;
  if (!v.total) return;
  const moved = v.navY == null || Math.abs(scrollY - v.navY) > innerHeight * 0.8;
  if (v.cur < 0 || moved) goTo(v, startFromViewport(v, dir));
  else goTo(v, v.cur + dir);
}

function stepColor(color) {
  const v = active;
  if (!v.total) return;
  const start = v.cur + 1;
  let best = null, first = null;
  for (const R of v.list) for (const p of R.pages) p.ranges.forEach((r, i) => {
    if (r[2] !== color) return;
    const h = p.h0 + i;
    if (first == null) first = h;
    if (best == null && h >= start) best = h;
  });
  const k = best ?? first;
  if (k != null) goTo(v, k);
}

async function scrollToPage(v, docId, n) {
  let art = artFor(v, docId, n);
  if (art?._web) {
    const p = v.info.get(pkey(docId, n));
    if (p) { goTo(v, p.h0); return; }
  }
  if (!art && v.kind === 'results') {
    const doc = docById(docId);
    const g = $$('.gap', v.root).find((x) => x.dataset.doc === docId && Number(x.dataset.a) < n && Number(x.dataset.b) > n);
    if (doc && g) {
      const key = g.dataset.key;
      if (!v.revealed.has(key)) v.revealed.set(key, new Set());
      v.revealed.get(key).add(n);
      g.replaceWith(...nodesBetween(v, doc, visiblePages(v, doc, g._R), Number(g.dataset.a), Number(g.dataset.b), g._R));
      art = v.pageEls.get(pkey(docId, n));
    }
  }
  if (!art) return;
  scrollToEl(art, 'start', 'instant');
  await fill(art);
  scrollToEl(art, 'start', 'instant');
  trackPosition();
}

// ---------- keeping your place ----------
// Where you are (the search, the page and how far into it, the document open) is noted as you scroll, so if
// the app is restarted — iOS does that to an app using too much memory — it opens right back where you were.
const PLACE = 'instant-search:place';
let placeT = 0;
function notePlace() {
  clearTimeout(placeT);
  placeT = setTimeout(() => {
    if (!H.ready) return;
    const a = captureAnchor();
    const st = { t: Date.now(), q: prefs.q || '', view: active === reader ? 'reader' : 'results', doc: reader.docId,
      at: a ? { d: a.art.dataset.doc, n: Number(a.art.dataset.n), r: a.ratio, y: a.y } : null, y: scrollY };
    try { localStorage.setItem(PLACE, JSON.stringify(st)); } catch {}
  }, 300);
}
addEventListener('scroll', notePlace, { passive: true });
async function restorePlace() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(PLACE) || 'null'); } catch {}
  if (!st || Date.now() - st.t > 6 * 3600e3 || (st.q || '') !== (prefs.q || '')) return;
  const at = st.at;
  if (st.view === 'reader' && st.doc && docById(st.doc)) await openReader(st.doc, at?.d === st.doc ? at.n : 0);
  else if (at && docById(at.d) && (st.y || 0) > 50) await scrollToPage(results, at.d, at.n);
  else return;
  // then the same spot inside the page
  const art = at && active.pageEls.get(pkey(at.d, at.n));
  if (art) { const r = art.getBoundingClientRect(); window.scrollBy({ top: r.top + at.r * r.height - at.y, behavior: 'instant' }); }
}

// ---------- reader ----------
async function openReader(docId, n) {
  const doc = docById(docId);
  if (!doc || doc.status) return;
  record('Open the document');
  if (active === results) results.scrollY = scrollY;
  curPageN = n ?? 0;
  curArt = null;
  reader.docId = docId;
  assign(reader, computeHits([doc]));
  active = reader;
  document.body.dataset.view = 'reader';
  renderView(reader);
  updateChrome();
  if (n == null) n = reader.list[0]?.pages[0]?.n ?? 0;
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (n > 0) await scrollToPage(reader, docId, n);
}

function closeReader() {
  if (active !== reader) return;
  record('Back to results');
  clearView(reader);
  reader.docId = null;
  active = results;
  document.body.dataset.view = 'results';
  if (results.dirty) renderView(results);
  updateChrome();
  requestAnimationFrame(() => window.scrollTo({ top: results.scrollY, behavior: 'instant' }));
}

// ---------- chrome: counter, summary, outline, library ----------
function updateCounter() {
  const v = active;
  const c = $('#counter');
  const has = !!S.matcher;
  c.hidden = !has;
  c.textContent = !v.total ? 'No hits' : v.cur < 0 ? plural(v.total, 'hit') : `${fmt(v.cur + 1)} of ${fmt(v.total)}`;
  c.classList.toggle('zero', has && !v.total);
  $('#prevBtn').disabled = $('#nextBtn').disabled = !v.total;
  $('#mCountText').textContent = !v.total ? '0' : v.cur < 0 ? fmt(v.total) : `${fmt(v.cur + 1)}/${fmt(v.total)}`;
  ['mPrev', 'mNext', 'mPrevPage', 'mNextPage', 'mCount'].forEach((id) => ($('#' + id).disabled = !v.total));
  $('#clearBtn').hidden = !q.value;
  // on phones and tablets the count lives on the pages-panel button, keeping the search box free for typing
  const n = v.total;
  $('#panelCount').textContent = n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : fmt(n);
  $('#panelBtn').setAttribute('aria-label', `${plural(n, 'hit')} — pages with hits`);
}

function updateSummary() {
  const box = $('#summary');
  const v = active;
  let html = '';
  if (v.kind === 'reader') {
    const doc = docById(v.docId);
    const count = S.texts.get(v.docId)?.length || 0;
    html += `<button class="back-btn" data-act="back" title="Back to results">${I.arrowLeft}<span>Results</span></button>
      <span class="reader-title" title="${esc(doc?.name || '')}"><span class="ftype ${doc?.kind}">${KIND_LABEL[doc?.kind] || ''}</span><b>${esc(doc?.name || '')}</b></span>
      <label class="jump" title="Go to page"><span class="jl">Page</span><input id="jumpInput" type="text" value="${esc(plabel(doc, curPageN))}" inputmode="${doc?.labels ? 'text' : 'numeric'}" autocomplete="off" spellcheck="false" aria-label="Page number"><span>/ ${fmt(count)}</span></label>`;
  }
  else if (linkOnly && docById(linkOnly)) {
    html += `<span class="link-scope">${I.link}<span>Only <b>${esc(docById(linkOnly).name)}</b></span><button type="button" data-act="unscope">Search all</button></span>`;
  }
  setHTML(box, html);
  box.hidden = !html;

  const showHead = v.kind === 'results' && S.matcher && v.list.length;
  const dock = $('#dock');
  dock.hidden = !(v.kind === 'reader' || showHead);
  $('#mbar').hidden = dock.hidden;
  document.body.classList.toggle('has-dock', !dock.hidden);
}

function updateOutline() {
  const v = active;
  const nav = $('#outline');
  const box = $('#outlineList');
  if (!S.matcher || !v.list.length) { setHTML(box, ''); nav.hidden = true; $('#panelBtn').hidden = true; setPanel(false); return; }
  nav.hidden = false;
  $('#panelBtn').hidden = false;
  $('#olSort').hidden = v.kind !== 'results';
  if (v.list[0]?.flat) {
    const rows = v.list.slice(0, 400).map((R, i) => {
      const p = R.pages[0];
      return `<button class="ol-row" data-doc="${R.doc.id}" data-n="${p.n}" title="${esc(R.doc.name)} · page ${esc(plabel(R.doc, p.n))}"><span class="ol-rank">${i + 1}</span><span class="ol-where"><b>p. ${esc(plabel(R.doc, p.n))}</b><span>${esc(R.doc.name)}</span></span><em>${fmt(R.hits)}</em></button>`;
    }).join('');
    const more = v.list.length > 400 ? `<span class="ol-more">+${fmt(v.list.length - 400)} more pages</span>` : '';
    setHTML(box, `<div class="ol-title">Pages by hits</div><div class="ol-rows">${rows}${more}</div>`);
    trackPosition();
    return;
  }
  setHTML(box, `<div class="ol-title">${v.kind === 'reader' ? 'Pages with hits' : 'Jump to'}</div>` + v.list.map((R) => {
    const chips = R.pages.slice(0, 500).map((p) => `<button class="ol-p" data-doc="${R.doc.id}" data-n="${p.n}" title="Page ${esc(plabel(R.doc, p.n))} · ${plural(p.count, 'hit')}">${esc(plabel(R.doc, p.n))}${p.count > 1 ? `<sup>${p.count}</sup>` : ''}</button>`).join('');
    const more = R.pages.length > 500 ? `<span class="ol-more">+${fmt(R.pages.length - 500)}</span>` : '';
    const name = v.kind === 'reader' ? '' : `<button class="ol-doc" data-doc="${R.doc.id}" data-n="${R.pages[0].n}"><span>${esc(R.doc.name)}</span><em>${fmt(R.hits)}</em></button>`;
    return `<div class="ol-group">${name}<div class="ol-pages">${chips}${more}</div></div>`;
  }).join(''));
  trackPosition();
}

const progressText = (d) => `${d.phase === 'download' ? 'Downloading' : d.phase === 'scan' ? 'Reading scanned pages' : 'Reading'}… ${d.progress ? Math.round(d.progress * 100) + '%' : ''}`;
// While a file downloads or reads, only its own text and bar change — nothing else in the library is touched.
function showProgress(d) {
  const li = $(`#lib .lib-item[data-id="${d.id}"]`);
  const t = li?.querySelector('.ptext');
  const bar = li?.querySelector('.prog i');
  if (!t || !bar) { renderLibrary(); return; }
  t.textContent = progressText(d);
  bar.style.width = Math.round((d.progress || 0) * 100) + '%';
}

function docItemHtml(d, hits) {
  const count = S.texts.get(d.id)?.length || d.pages || 0;
  const meta = d.status === 'indexing'
    ? `<span class="ptext">${progressText(d)}</span>`
    : `${d.source ? `<span class="linked" title="${esc(sourceTitle(d.source))}">${I.link}</span>` : ''}${plural(count, 'page')}${d.updatedAt && Date.now() - d.updatedAt < 14 * 864e5 ? ' · <span class="fresh-tag">updated</span>' : ''}${d.noText ? ' · <span class="warn">no text found</span>' : ''}`;
  const h = S.matcher && d.enabled && !d.status ? `<span class="lhits${hits.get(d.id) ? '' : ' zero'}">${fmt(hits.get(d.id) || 0)}</span>` : '';
  return `<li class="lib-item${d.enabled ? ' on' : ''}${d.status ? ' busy' : ''}${reader.docId === d.id && active === reader ? ' reading' : ''}" data-id="${d.id}">
    <label class="chk" title="Include in search"><input type="checkbox" ${d.enabled ? 'checked' : ''} ${d.status ? 'disabled' : ''}><span></span></label>
    <button class="lib-main" data-act="read" title="${esc(d.name)}" draggable="false"><span class="lname">${esc(d.name)}</span><span class="lmeta"><span class="ftype ${d.kind}">${KIND_LABEL[d.kind]}</span>${meta}</span></button>
    ${h}
    <span class="lib-acts"><button class="mini" data-act="solo" title="Search only this document">${I.target}</button><button class="mini" data-act="dmenu" title="More">${I.more}</button></span>
    ${d.status === 'indexing' ? `<div class="prog"><i style="width:${Math.round((d.progress || 0) * 100)}%"></i></div>` : ''}
  </li>`;
}

let renaming = null; // { fid, input } while a folder name is being edited
function renderLibrary() {
  const ul = $('#lib');
  const hadFocus = renaming && document.activeElement === renaming.input;
  const hits = new Map();
  for (const R of results.list) hits.set(R.doc.id, (hits.get(R.doc.id) || 0) + R.hits);
  const ready = S.docs.filter(searchable);
  $('#libCount').textContent = S.docs.length ? `${ready.filter((d) => d.enabled).length}/${ready.length}` : '';
  $('#toggleAll').hidden = ready.length < 2;
  $('#toggleAll').textContent = ready.every((d) => d.enabled) ? 'None' : 'All';
  const by = new Map(S.folders.map((f) => [f.id, []]));
  for (const d of S.docs) by.get(d.folderId)?.push(d);
  const folderHtml = (f) => {
    const docs = by.get(f.id);
    const rd = docs.filter(searchable);
    const on = rd.filter((d) => d.enabled).length;
    const fh = docs.reduce((a, d) => a + (d.enabled ? hits.get(d.id) || 0 : 0), 0);
    const badge = S.matcher && on ? `<span class="lhits${fh ? '' : ' zero'}">${fmt(fh)}</span>` : '';
    return `<li class="folder${f.collapsed ? ' collapsed' : ''}${rd.length && !on ? ' off' : ''}" data-fid="${f.id}">
      <div class="folder-row">
        <label class="chk" title="Search this whole folder"><input type="checkbox" data-fchk ${rd.length && on === rd.length ? 'checked' : ''} ${on && on < rd.length ? 'data-indet' : ''} ${rd.length ? '' : 'disabled'}><span></span></label>
        <button class="folder-main" data-act="fold" title="${esc(f.name)}"><span class="chev">${I.chevron}</span><span class="ficon">${I.folder}</span><span class="fname">${esc(f.name)}</span>${f.source ? `<span class="linked" title="${esc(sourceTitle(f.source))}">${I.link}</span>` : ''}<span class="fcount">${fmt(docs.length)}</span></button>
        ${badge}
        <span class="lib-acts"><button class="mini" data-act="fsolo" title="Search only this folder">${I.target}</button><button class="mini" data-act="fadd" title="Add documents to this folder">${I.plus}</button><button class="mini" data-act="fmenu" title="More">${I.more}</button></span>
      </div>
      <ul class="folder-docs">${docs.length ? docs.map((d) => docItemHtml(d, hits)).join('') : '<li class="folder-empty">Drag documents here, or use + to add files</li>'}</ul>
    </li>`;
  };
  const next = document.createElement('ul');
  next.innerHTML = topLevel().map((it) => (it.kind === 'folder' ? folderHtml(it.f) : docItemHtml(it.d, hits))).join('');
  // folders are updated piece by piece (their row, then each document in them)
  const keyOf = (n) => n.dataset.id ? 'd' + n.dataset.id : n.dataset.fid ? 'f' + n.dataset.fid : 'x' + n.className;
  const morphFolder = (o, n) => {
    o.className = n.className;
    const or = o.querySelector(':scope > .folder-row');
    const nr = n.querySelector(':scope > .folder-row');
    if (or.outerHTML !== nr.outerHTML) or.replaceWith(nr);
    morphChildren(o.querySelector(':scope > .folder-docs'), n.querySelector(':scope > .folder-docs'), keyOf);
  };
  for (const f of next.querySelectorAll(':scope > .folder')) f._morph = morphFolder;
  for (const f of ul.querySelectorAll(':scope > .folder')) f._morph = morphFolder;
  // the checkbox "checked" state lives in a property; keep the markup in step so comparisons work
  $$('input[type="checkbox"]', ul).forEach((i) => i.toggleAttribute('checked', i.checked));
  morphChildren(ul, next, keyOf);
  $$('[data-indet]', ul).forEach((i) => (i.indeterminate = true));
  $$('input[type="checkbox"]:not([data-indet])', ul).forEach((i) => (i.indeterminate = false));
  if (renaming) {
    const span = $(`.folder[data-fid="${renaming.fid}"] .fname`, ul);
    if (span) {
      span.replaceWith(renaming.input);
      if (hadFocus) renaming.input.focus({ preventScroll: true });
    }
  }
  $('#libEmpty').hidden = !!(S.docs.length || S.folders.length);
  $('#checkAllBtn').hidden = !hasSources();
}

function syncControls() {
  $$('#modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === prefs.mode)));
  $('#nearBox').hidden = prefs.mode !== 'near';
  $('#nearN').value = prefs.near;
  $('#caseBtn').setAttribute('aria-pressed', String(prefs.matchCase));
  $('#wordBtn').setAttribute('aria-pressed', String(prefs.wholeWord));
  $('#sortSel2').value = prefs.sort;
  $$('#viewSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === prefs.view)));
  $('#viewSeg').hidden = true;
  document.body.classList.toggle('compact', !!prefs.compact || isPhone()); // phones always use the slim search bar
  document.body.classList.toggle('side-hidden', !!prefs.sideHidden);
  $('#compactBtn').title = prefs.compact ? `Show the full toolbar (${keyHint('toggleCompact')})` : `Minimize the toolbar (${keyHint('toggleCompact')})`;
  const flags = [prefs.matchCase ? 'Aa' : '', prefs.wholeWord ? '<u>ab</u>' : '', prefs.mode === 'near' ? `≤${prefs.near}` : ''].filter(Boolean);
  const pill = `<span class="full">${MODE_SHORT[prefs.mode]}</span><span class="short">${MODE_TINY[prefs.mode]}</span>${WHERE[prefs.where]?.short ? `<em class="where">${WHERE[prefs.where].short}</em>` : ''}${flags.map((f) => `<em>${f}</em>`).join('')}<svg class="pill-arrow" viewBox="0 0 24 24"><path d="M8 10l4 4 4-4"/></svg>`;
  setHTML($('#modePill'), pill);
  setHTML($('#mMode'), pill);
  $('#zoomVal').textContent = Math.round(zoomValue() * 100) + '%';
  $('#fitWidth').setAttribute('aria-pressed', String(prefs.zoom === 'width'));
  $('#fitPage').setAttribute('aria-pressed', String(prefs.zoom === 'page' && !prefs.columns));
  $('#fitWidth').setAttribute('aria-pressed', String(prefs.zoom === 'width' && !prefs.columns));
  $('#fitCol').setAttribute('aria-pressed', String(!!prefs.columns));
  $('#cropBtn').setAttribute('aria-pressed', String(!!prefs.crop));
  $('#trimBtn').setAttribute('aria-pressed', String(!!prefs.trim));
  $('#cropSpan').hidden = !prefs.crop;
  $('#cropOut').textContent = `±${prefs.cropLines}`;
  $('#cropMinus').disabled = prefs.cropLines <= 1;
  $('#cropPlus').disabled = prefs.cropLines >= 15;
  $('#navBtn').setAttribute('aria-pressed', String(prefs.pageNav === 'swipe'));
  document.body.classList.toggle('nav-swipe', prefs.pageNav === 'swipe');
  q.placeholder = {
    any: 'Pages with any of these words…',
    all: 'Pages with all of these words…',
    phrase: 'An exact phrase…',
    near: 'Words close together…',
    boolean: 'e.g. (stall OR spin) AND recovery NOT training',
  }[prefs.mode];
  $('#themeBtn').dataset.theme = prefs.theme;
}

function updateChrome() {
  updateCounter();
  updateSummary();
  updateOutline();
  renderLibrary();
  syncControls();
}

// The page you're on is the one filling the most of the screen between the bars — not a sliver at the top.
let curArt = null;
let curPageN = 0;
function readingArea() {
  const tb = $('.topbar').getBoundingClientRect();
  let top = Math.max(0, tb.bottom);
  const dh = active.root.querySelector('.doc-head');
  if (dh && dh.offsetHeight) top += dh.offsetHeight; // the sticky document title covers the top of the pages
  const mb = $('#mbar');
  const mr = mb.hidden ? null : mb.getBoundingClientRect();
  const bottom = mr && mr.height ? mr.top : innerHeight;
  return { top, bottom: Math.max(top + 1, bottom) };
}
function currentArt() {
  const arts = active.root.getElementsByClassName('page'); // in page order
  const n = arts.length;
  if (!n) return null;
  const { top, bottom } = readingArea();
  let lo = 0, hi = n - 1, first = n;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arts[mid].getBoundingClientRect().bottom > top) { first = mid; hi = mid - 1; } else lo = mid + 1;
  }
  let best = null, bestVis = 0, curVis = -1;
  for (let i = first; i < n; i++) {
    const r = arts[i].getBoundingClientRect();
    if (r.top >= bottom) break;
    const vis = Math.min(r.bottom, bottom) - Math.max(r.top, top);
    if (arts[i] === curArt) curVis = vis;
    if (vis > bestVis) { bestVis = vis; best = arts[i]; }
  }
  // at an even split, stay on the page you were on so the number doesn't flicker
  if (best && curArt && best !== curArt && curVis >= 0 && bestVis - curVis < 16) best = curArt;
  return best;
}

// Highlight where the reader currently is (outline chip + reader page box).
let trackRaf = 0;
function trackPosition() {
  if (trackRaf) return;
  trackRaf = requestAnimationFrame(() => {
    trackRaf = 0;
    const art = currentArt();
    const changed = art !== curArt;
    curArt = art;
    if (!art) { $$('#outline .on').forEach((b) => b.classList.remove('on')); return; }
    if (active === reader) curPageN = Number(art.dataset.n);
    const jump = $('#jumpInput');
    if (jump && !jump._editing && active === reader) jump.value = plabel(docById(reader.docId), curPageN);
    if (!changed && $('#outline .on')) return;
    $$('#outline .on').forEach((b) => b.classList.remove('on'));
    const chip = $(`#outline :is(.ol-p, .ol-row)[data-doc="${art.dataset.doc}"][data-n="${art.dataset.n}"]`);
    if (chip) {
      chip.classList.add('on');
      const box = $('#outlineList');
      const cr = chip.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      if (br.height && (cr.top < br.top + 30 || cr.bottom > br.bottom - 10)) box.scrollTop += cr.top - br.top - br.height / 2;
    }
  });
}

// The pages panel: a column on wide screens, a sheet from the right on smaller ones.
function setPanel(open) {
  document.body.classList.toggle('panel', !!open);
  $('#panelBtn')?.setAttribute('aria-pressed', String(!!open));
  if (open) { curArt = null; trackPosition(); }
}

// ---------- library actions ----------
let pendingRemoval = null;
function removeDoc(id) {
  const idx = S.docs.findIndex((d) => d.id === id);
  if (idx < 0) return;
  finalizeRemoval();
  const doc = S.docs[idx];
  const pages = S.texts.get(id);
  S.docs.splice(idx, 1);
  S.texts.delete(id);
  if (reader.docId === id) closeReader();
  runSearch();
  pendingRemoval = { doc, pages, idx, timer: setTimeout(finalizeRemoval, 6000) };
  toast(`Removed “${doc.name}”`, { action: 'Undo', onAction: undoRemoval, ms: 6000 });
}
function finalizeRemoval() {
  if (!pendingRemoval) return;
  clearTimeout(pendingRemoval.timer);
  const { doc } = pendingRemoval;
  pendingRemoval = null;
  closePdf(doc.id);
  forgetHtml(doc.id);
  store.deleteDoc(doc.id).catch(() => {});
}
function undoRemoval() {
  if (!pendingRemoval) return;
  clearTimeout(pendingRemoval.timer);
  const { doc, pages, idx } = pendingRemoval;
  pendingRemoval = null;
  S.docs.splice(idx, 0, doc);
  S.texts.set(doc.id, pages);
  runSearch();
}

function setEnabled(id, on) {
  const d = docById(id);
  if (!d) return;
  d.enabled = on;
  store.updateDoc(stripMeta(d)).catch(() => {});
  runSearch();
}
function solo(id) {
  const ready = S.docs.filter(searchable);
  const already = ready.every((d) => d.enabled === (d.id === id));
  for (const d of ready) d.enabled = already ? true : d.id === id;
  store.updateDocs(ready.map(stripMeta)).catch(() => {});
  runSearch();
  if (!already) toast(`Searching only “${docById(id).name}”`);
}
function toggleAll() {
  const ready = S.docs.filter(searchable);
  const all = ready.every((d) => d.enabled);
  for (const d of ready) d.enabled = !all;
  store.updateDocs(ready.map(stripMeta)).catch(() => {});
  runSearch();
}
const stripMeta = ({ status, progress, ...m }) => m;

// ---------- folders ----------
const saveFolders = () => store.putFolders(S.folders).catch(() => {});

function createFolder(name) {
  let base = (name || 'New folder').trim() || 'New folder';
  let n = base;
  for (let i = 2; S.folders.some((f) => f.name.toLowerCase() === n.toLowerCase()); i++) n = `${base} ${i}`;
  const f = { id: uid(), name: n, order: S.folders.reduce((m, x) => Math.max(m, x.order || 0), 0) + 1, collapsed: false };
  const lastFolder = topLevel().filter((x) => x.kind === 'folder').pop();
  if (lastFolder && S.folders.some((x) => x.pos != null)) f.pos = lastFolder.pos + 0.001;
  S.folders.push(f);
  saveFolders();
  renderLibrary();
  return f;
}

function folderNamed(name) {
  return S.folders.find((f) => f.name.toLowerCase() === name.toLowerCase()) || createFolder(name);
}

function startRename(fid) {
  const f = folderById(fid);
  const li = $(`#lib .folder[data-fid="${fid}"]`);
  if (!f || !li) return;
  li.classList.remove('collapsed');
  const span = $('.fname', li);
  const input = el('input', 'frename');
  renaming = { fid, input };
  input.value = f.name;
  input.setAttribute('aria-label', 'Folder name');
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    renaming = null;
    const v = input.value.trim();
    if (save && v && v !== f.name) {
      f.name = v;
      saveFolders();
      refreshInPlace(results);
    }
    renderLibrary();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!input.isConnected || document.activeElement !== input) finish(true); }, 0));
  input.addEventListener('click', (e) => e.stopPropagation());
}

function toggleFolder(fid) {
  const f = folderById(fid);
  if (!f) return;
  f.collapsed = !f.collapsed;
  saveFolders();
  $(`#lib .folder[data-fid="${fid}"]`)?.classList.toggle('collapsed', f.collapsed);
}

function setFolderEnabled(fid, on) {
  const docs = S.docs.filter((d) => d.folderId === fid && searchable(d));
  for (const d of docs) d.enabled = on;
  store.updateDocs(docs.map(stripMeta)).catch(() => {});
  runSearch();
}

function soloFolder(fid) {
  const ready = S.docs.filter(searchable);
  const inside = (d) => d.folderId === fid;
  if (!ready.some(inside)) { toast('This folder is empty'); return; }
  const already = ready.every((d) => d.enabled === inside(d));
  for (const d of ready) d.enabled = already ? true : inside(d);
  store.updateDocs(ready.map(stripMeta)).catch(() => {});
  runSearch();
  if (!already) toast(`Searching only the “${folderById(fid).name}” folder`);
}

function moveDocs(ids, fid) {
  const docs = ids.map(docById).filter(Boolean).filter((d) => (d.folderId || null) !== (fid || null));
  if (!docs.length) return;
  for (const d of docs) { d.folderId = fid || null; delete d.pos; } // out of a folder: lands at the bottom
  store.updateDocs(docs.filter(searchable).map(stripMeta)).catch(() => {});
  const f = fid && folderById(fid);
  if (f?.collapsed) { f.collapsed = false; saveFolders(); }
  runSearch({ keepScroll: true });
  toast(`${docs.length === 1 ? `“${docs[0].name}”` : plural(docs.length, 'document')} moved ${f ? `to “${f.name}”` : 'out of the folder'}`, { ms: 2200 });
}

// ---------- rearranging: tap a document or folder to put the item right above it ----------
let reorderTimer;
function afterReorder() {
  renderLibrary();
  clearTimeout(reorderTimer);
  reorderTimer = setTimeout(() => runSearch({ keepScroll: true }), 350);
}
const liveFolder = (d) => (d.folderId && folderById(d.folderId) ? d.folderId : null);
// Save a new top-level order (folders and loose documents together).
function writeTopLevel(items) {
  items.forEach((it, i) => { (it.kind === 'folder' ? it.f : it.d).pos = i; });
  S.folders.sort((a, b) => a.pos - b.pos);
  S.folders.forEach((f, i) => (f.order = i + 1));
  saveFolders();
}
function saveDocOrder() {
  S.docs.forEach((x, i) => (x.order = i + 1));
  store.updateDocs(S.docs.filter(searchable).map(stripMeta)).catch(() => {});
}
/**
 * Move a document. where = { above: docId } | { aboveFolder: folderId } | { endOf: folderId } | { bottom: true }
 * Above a loose document or a folder (or at the bottom) it sits loose in the library; above a document
 * inside a folder, or at the end of a folder, it goes into that folder.
 */
function putDoc(id, where) {
  const d = docById(id);
  if (!d || where.above === id) return;
  const before = liveFolder(d);
  const ref = where.above && docById(where.above);
  const refFolder = ref ? liveFolder(ref) : null;
  if ((ref && !refFolder) || where.aboveFolder || where.bottom) {
    // top level
    d.folderId = null;
    const items = topLevel().filter((it) => it.id !== id);
    const me = { kind: 'doc', id, d };
    const at = where.bottom ? items.length : items.findIndex((it) => it.id === (where.aboveFolder || where.above));
    items.splice(at < 0 ? items.length : at, 0, me);
    writeTopLevel(items);
  } else {
    // inside a folder
    const fid = refFolder || where.endOf;
    S.docs.splice(S.docs.indexOf(d), 1);
    if (ref) S.docs.splice(S.docs.indexOf(ref), 0, d);
    else {
      const group = S.docs.filter((x) => liveFolder(x) === fid);
      S.docs.splice(group.length ? S.docs.indexOf(group[group.length - 1]) + 1 : S.docs.length, 0, d);
    }
    d.folderId = fid;
    delete d.pos;
    const f = folderById(fid);
    if (f?.collapsed) { f.collapsed = false; saveFolders(); }
  }
  saveDocOrder();
  afterReorder();
  flashRow(`#lib .lib-item[data-id="${id}"]`);
  const now = liveFolder(d);
  if (before !== now) toast(`“${d.name}” moved ${now ? `into “${folderById(now).name}”` : 'out of its folder'}`, { ms: 2000 });
}
// Move a folder above any top-level item (a folder or a loose document), or to the bottom.
function putFolder(id, aboveId = null) {
  if (!folderById(id) || aboveId === id) return;
  const items = topLevel();
  const me = items.find((it) => it.id === id);
  const rest = items.filter((it) => it !== me);
  const at = aboveId ? rest.findIndex((it) => it.id === aboveId) : rest.length;
  rest.splice(at < 0 ? rest.length : at, 0, me);
  writeTopLevel(rest);
  saveDocOrder();
  afterReorder();
  flashRow(`#lib .folder[data-fid="${id}"] > .folder-row`);
}
function flashRow(sel) {
  requestAnimationFrame(() => {
    const r = $(sel);
    if (!r) return;
    r.classList.remove('moved');
    void r.offsetWidth;
    r.classList.add('moved');
    r.scrollIntoView({ block: 'nearest' });
  });
}
const docsIn = (fid) => S.docs.filter((x) => liveFolder(x) === fid);
const self = (label) => ({ label: `${label} (this one)`, icon: I.text, disabled: true });
// ---------- drag to reorder the library ----------
// Press and drag a document or folder (with a finger: hold a moment, then drag). The others make room under a line that
// shows where it will land; over the middle of a folder, a document goes inside it. Near the top or bottom the list
// scrolls. Works the same with a mouse, a pen or a finger. ("Rearrange" in the menus still does it by picking.)
function bindLibDrag() {
  const lib = $('#lib'), zone = $('.lib-zone');
  const NO = '.lib-acts, .chk, .mini, input, .rename';
  let s = null;
  const line = el('div', 'drag-line');
  const end = (drop) => {
    if (!s) return;
    const { ghost, src, kind, id, target, timer } = s;
    clearTimeout(timer);
    cancelAnimationFrame(s.raf);
    s = null;
    document.body.classList.remove('lib-dragging');
    line.remove();
    $$('.drop-into').forEach((x) => x.classList.remove('drop-into'));
    src?.classList.remove('drag-src');
    if (!ghost) return;
    if (drop && target) {
      ghost.remove();
      lib._justDragged = performance.now();
      if (kind === 'doc') putDoc(id, target.where);
      else putFolder(id, target.where.aboveFolder || target.where.above || null);
    } else {
      // nowhere to put it: it floats back home
      const r = src.getBoundingClientRect();
      ghost.animate([{ transform: ghost.style.transform }, { transform: `translate(${r.left}px, ${r.top}px)` }], { duration: 200, easing: 'ease-out' }).onfinish = () => ghost.remove();
    }
  };
  // where the dragged thing would land for a pointer at y
  const targetAt = (x, y) => {
    const under = document.elementFromPoint(x, y);
    const zr = zone.getBoundingClientRect();
    if (!under || !zone.contains(under) || y > lib.getBoundingClientRect().bottom) {
      if (y >= zr.top && y <= zr.bottom && x >= zr.left && x <= zr.right) return { where: { bottom: true }, lineEl: lib, after: true };
      return null;
    }
    const docLi = under.closest('.lib-item');
    const folder = under.closest('.folder');
    if (s.kind === 'folder') {
      // folders only go between top-level things
      const top = under.closest('#lib > li');
      if (!top) return { where: { bottom: true }, lineEl: lib, after: true };
      const r = top.getBoundingClientRect();
      const below = y > r.top + Math.min(r.height, 44) / 2;
      const next = below ? top.nextElementSibling : top;
      const nid = next && (next.dataset.fid || next.dataset.id);
      return nid ? { where: { aboveFolder: nid }, lineEl: next } : { where: { bottom: true }, lineEl: top, after: true };
    }
    if (folder && under.closest('.folder-row')) {
      const r = folder.querySelector('.folder-row').getBoundingClientRect();
      const f = r.height, rel = (y - r.top) / f;
      if (rel > 0.25 && rel < 0.75) return { where: { endOf: folder.dataset.fid }, into: folder }; // into the folder
      if (rel <= 0.25) return { where: { aboveFolder: folder.dataset.fid }, lineEl: folder };
      const first = folder.classList.contains('collapsed') ? null : folder.querySelector('.folder-docs > .lib-item');
      if (first) return { where: { above: first.dataset.id }, lineEl: first };
      const nxt = folder.nextElementSibling;
      return nxt ? { where: nxt.dataset.fid ? { aboveFolder: nxt.dataset.fid } : { above: nxt.dataset.id }, lineEl: nxt } : { where: { bottom: true }, lineEl: folder, after: true };
    }
    if (docLi) {
      const r = docLi.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { where: { above: docLi.dataset.id }, lineEl: docLi };
      const nxt = docLi.nextElementSibling?.classList.contains('lib-item') ? docLi.nextElementSibling : null;
      if (nxt) return { where: { above: nxt.dataset.id }, lineEl: nxt };
      const inF = docLi.closest('.folder');
      if (inF) return { where: { endOf: inF.dataset.fid }, lineEl: docLi, after: true };
      const n2 = docLi.nextElementSibling;
      return n2 ? { where: n2.dataset.fid ? { aboveFolder: n2.dataset.fid } : { above: n2.dataset.id }, lineEl: n2 } : { where: { bottom: true }, lineEl: docLi, after: true };
    }
    if (folder) return { where: { endOf: folder.dataset.fid }, into: folder }; // the empty space inside an open folder
    return null;
  };
  const show = (t) => {
    $$('.drop-into').forEach((x) => x.classList.remove('drop-into'));
    if (!t) { line.remove(); return; }
    if (t.into) { line.remove(); t.into.classList.add('drop-into'); return; }
    const r = t.lineEl.getBoundingClientRect(), zr = zone.getBoundingClientRect();
    const y = (t.after ? r.bottom : r.top) - zr.top + zone.scrollTop;
    line.style.top = `${y - 1}px`;
    line.style.left = `${Math.max(6, r.left - zr.left)}px`;
    line.style.right = '6px';
    if (!line.isConnected) zone.append(line);
  };
  const begin = () => {
    s.started = true;
    const r = s.src.getBoundingClientRect();
    s.dx = s.x - r.left; s.dy = s.y - r.top;
    const ghost = s.src.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${r.width}px`;
    ghost.style.transform = `translate(${r.left}px, ${r.top}px)`;
    document.body.append(ghost);
    s.ghost = ghost;
    s.src.classList.add('drag-src');
    document.body.classList.add('lib-dragging');
    navigator.vibrate?.(8);
    const scroll = () => { // near the top or bottom edge, the list scrolls by itself
      if (!s) return;
      const zr = zone.getBoundingClientRect();
      const v = s.y < zr.top + 44 ? -Math.ceil((zr.top + 44 - s.y) / 4) : s.y > zr.bottom - 44 ? Math.ceil((s.y - zr.bottom + 44) / 4) : 0;
      if (v) { zone.scrollTop += v; s.target = targetAt(s.x, s.y); show(s.target); }
      s.raf = requestAnimationFrame(scroll);
    };
    s.raf = requestAnimationFrame(scroll);
  };
  lib.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest(NO)) return;
    const li = e.target.closest('.lib-item');
    const fr = !li && e.target.closest('.folder-row');
    if (!li && !fr) return;
    if (li && docById(li.dataset.id)?.status) return;
    const kind = li ? 'doc' : 'folder';
    s = { kind, id: li ? li.dataset.id : fr.closest('.folder').dataset.fid, src: li || fr.closest('.folder'), x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', pid: e.pointerId, started: false };
    // a finger has to hold still a moment first (so a quick swipe still scrolls the list)
    if (s.touch) s.timer = setTimeout(() => { if (s && !s.started) begin(); }, 380);
  });
  addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.pid) return;
    s.x = e.clientX; s.y = e.clientY;
    if (!s.started) {
      const moved = Math.hypot(s.x - s.x0, s.y - s.y0);
      if (s.touch) { if (moved > 8) { clearTimeout(s.timer); s = null; } return; } // it was a scroll
      if (moved < 6) return;
      begin();
    }
    s.ghost.style.transform = `translate(${s.x - s.dx}px, ${s.y - s.dy}px) scale(1.02)`;
    s.target = targetAt(s.x, s.y);
    show(s.target);
    // hovering a closed folder opens it
    const f = s.target?.into;
    if (f && f.classList.contains('collapsed')) {
      if (s.hoverF !== f) { s.hoverF = f; clearTimeout(s.openT); s.openT = setTimeout(() => { const fo = folderById(f.dataset.fid); if (s && s.hoverF === f && fo?.collapsed) toggleFolder(fo.id); }, 650); }
    } else s.hoverF = null;
  });
  addEventListener('pointerup', (e) => { if (s && e.pointerId === s.pid) end(s.started); });
  addEventListener('pointercancel', (e) => { if (s && e.pointerId === s.pid) end(false); });
  // while dragging with a finger, the page mustn't scroll under it
  addEventListener('touchmove', (e) => { if (s?.started) e.preventDefault(); }, { passive: false });
  // the click that ends a drag isn't a tap on the row
  lib.addEventListener('click', (e) => { if (performance.now() - (lib._justDragged || 0) < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  lib.addEventListener('contextmenu', (e) => { if (s?.touch) e.preventDefault(); });
}

// "Rearrange" for a document: the library as it looks. Tap anything to put the document right above it.
// A folder's › (or hovering it) opens its files, to put the document inside it.
function rearrangeDocItems(id) {
  const docRow = (x) => (x.id === id ? self(x.name) : { label: x.name, icon: I.text, run: () => putDoc(id, { above: x.id }) });
  const items = [{ header: 'Put it above…' }];
  for (const it of topLevel()) {
    if (it.kind === 'doc') { items.push(docRow(it.d)); continue; }
    const f = it.f;
    items.push({
      label: f.name, icon: I.folder,
      run: () => putDoc(id, { aboveFolder: f.id }),
      submenu: () => [{ header: `Inside “${f.name}”` }, ...docsIn(f.id).map(docRow), { sep: true }, { label: `At the end of “${f.name}”`, icon: I.down, run: () => putDoc(id, { endOf: f.id }) }],
    });
  }
  items.push({ sep: true }, { label: 'At the bottom of the library', icon: I.down, run: () => putDoc(id, { bottom: true }) });
  return items;
}
function rearrangeFolderItems(fid) {
  return [
    { header: 'Put it above…' },
    ...topLevel().map((it) => (it.id === fid ? self(it.f.name)
      : { label: it.kind === 'folder' ? it.f.name : it.d.name, icon: it.kind === 'folder' ? I.folder : I.text, run: () => putFolder(fid, it.id) })),
    { sep: true },
    { label: 'At the bottom of the library', icon: I.down, run: () => putFolder(fid, null) },
  ];
}

let pendingFolderDelete = null;
function deleteFolder(fid) {
  const f = folderById(fid);
  if (!f) return;
  const docs = S.docs.filter((d) => d.folderId === fid);
  const idx = S.folders.indexOf(f);
  S.folders.splice(idx, 1);
  for (const d of docs) d.folderId = null;
  store.deleteFolder(fid).catch(() => {});
  store.updateDocs(docs.filter(searchable).map(stripMeta)).catch(() => {});
  runSearch({ keepScroll: true });
  pendingFolderDelete = { f, idx, ids: docs.map((d) => d.id) };
  toast(`Deleted folder “${f.name}”${docs.length ? ` — its ${plural(docs.length, 'document')} ${docs.length === 1 ? 'is' : 'are'} kept` : ''}`, {
    action: 'Undo',
    ms: 6000,
    onAction: () => {
      const p = pendingFolderDelete;
      if (!p) return;
      pendingFolderDelete = null;
      S.folders.splice(p.idx, 0, p.f);
      saveFolders();
      const back = p.ids.map(docById).filter(Boolean);
      for (const d of back) d.folderId = p.f.id;
      store.updateDocs(back.filter(searchable).map(stripMeta)).catch(() => {});
      runSearch({ keepScroll: true });
    },
  });
}

// ---------- popover menu ----------
function closeMenu() {
  $$('.pop-menu').forEach((m) => m.remove());
  $$('.menu-open').forEach((x) => x.classList.remove('menu-open'));
}
// Small screens and touch: a submenu replaces the menu (with Back). Laptops: it opens beside it on hover.
const compactMenus = () => matchMedia('(max-width: 700px), (pointer: coarse)').matches;

function fillMenu(m, items, { onBack } = {}) {
  m.replaceChildren();
  if (onBack) {
    const back = el('button', 'menu-item menu-back', `${I.arrowLeft}<span>Back</span>`);
    back.addEventListener('click', (e) => { e.stopPropagation(); onBack(); });
    m.append(back, el('div', 'menu-sep'));
  }
  for (const it of items) {
    if (it.sep) { m.append(el('div', 'menu-sep')); continue; }
    if (it.header) { m.append(el('div', 'menu-head', esc(it.header))); continue; }
    if (it.node) { m.append(it.node()); continue; }
    const b = el('button', `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}${it.submenu ? ' has-sub' : ''}`,
      `${it.icon || '<span class="menu-gap"></span>'}<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.checked ? I.check : ''}${it.submenu ? `<i class="sub-arrow${it.run ? ' split' : ''}" title="Show what’s inside">${I.chevron}</i>` : ''}`);
    b.setAttribute('role', 'menuitem');
    if (it.disabled) b.disabled = true;
    if (it.submenu) {
      b.setAttribute('aria-haspopup', 'menu');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        // an item that has its own action does it when tapped; its › still opens the list
        if (it.run && !e.target.closest('.sub-arrow')) { closeMenu(); it.run(); return; }
        if (compactMenus()) {
          const prev = items;
          fillMenu(m, it.submenu(), { onBack: () => { fillMenu(m, prev, { onBack }); placeMenu(m); } });
          placeMenu(m);
          m.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
        } else openSubmenu(m, b, it.submenu());
      });
      b.addEventListener('mouseenter', () => { if (!compactMenus()) { clearTimeout(m._closeT); openSubmenu(m, b, it.submenu()); } });
    } else {
      // small delay so moving the mouse diagonally toward the side window doesn't close it
      b.addEventListener('mouseenter', () => { if (!compactMenus() && m._sub) { clearTimeout(m._closeT); m._closeT = setTimeout(() => closeSubmenu(m), 260); } });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!it.keep || !m._items) { closeMenu(); it.run(); return; }
        // a switch that stays open: flip it and redraw the menu in place
        it.run();
        fillMenu(m, m._items(), { onBack });
        placeMenu(m);
      });
    }
    m.append(b);
  }
}
// A menu opened at a tap: kept on screen, clear of the top bar and the bottom bar.
function openMenuAt(x, y, items) {
  closeMenu();
  const m = el('div', 'pop-menu at-point');
  m.setAttribute('role', 'menu');
  m._at = { x, y, scrollY };
  fillMenu(m, items);
  document.body.append(m);
  placeMenu(m);
}
function placeMenu(m) {
  if (m._at) {
    const w = m.offsetWidth, h = m.offsetHeight;
    const tb = $('.topbar').getBoundingClientRect();
    const mb = $('#mbar');
    const lo = Math.max(8, tb.bottom + 6);
    const hi = (!mb.hidden && mb.getBoundingClientRect().height ? mb.getBoundingClientRect().top : innerHeight) - 8;
    const { x, y } = m._at;
    let top = y + 14;
    if (top + h > hi) top = y - 14 - h;
    top = Math.max(lo, Math.min(top, hi - h));
    m.style.left = Math.max(8, Math.min(x - w / 2, innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, top) + 'px';
    return;
  }
  const r = m._anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  m.style.top = top + 'px';
}
function closeSubmenu(parent) {
  if (parent._sub) closeSubmenu(parent._sub); // and anything opened from it
  parent._sub?.remove();
  parent._sub = null;
  parent._subFor = null;
  parent.querySelectorAll('.has-sub.open').forEach((x) => x.classList.remove('open'));
}
function openSubmenu(parent, item, items) {
  if (parent._sub && parent._subFor === item) return;
  closeSubmenu(parent);
  const sm = el('div', 'pop-menu sub');
  sm.setAttribute('role', 'menu');
  fillMenu(sm, items);
  document.body.append(sm);
  parent._sub = sm;
  parent._subFor = item;
  sm.addEventListener('mouseenter', () => clearTimeout(parent._closeT));
  item.classList.add('open');
  const r = item.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  const w = sm.offsetWidth;
  const h = sm.offsetHeight;
  let left = pr.right + 4;
  if (left + w > innerWidth - 8) left = Math.max(8, pr.left - w - 4); // no room on the right: open to the left
  sm.style.left = left + 'px';
  sm.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - h - 8)) + 'px';
}
function openMenu(anchor, items) {
  const wasOpen = anchor.classList.contains('menu-open');
  closeMenu();
  if (wasOpen) return;
  const m = el('div', 'pop-menu');
  m.setAttribute('role', 'menu');
  m._anchor = anchor;
  if (typeof items === 'function') { m._items = items; items = items(); } // can redraw itself in place
  fillMenu(m, items);
  document.body.append(m);
  anchor.classList.add('menu-open');
  placeMenu(m);
  m.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
}
function moveItems(d) {
  const items = [{ header: 'Move to' }];
  for (const f of S.folders) items.push({ label: f.name, icon: I.folder, checked: d.folderId === f.id, run: () => moveDocs([d.id], f.id) });
  if (folderOf(d)) items.push({ label: 'No folder', icon: I.out, run: () => moveDocs([d.id], null) });
  items.push({ label: 'New folder…', icon: I.folderPlus, run: () => { const f = createFolder(); moveDocs([d.id], f.id); startRename(f.id); } });
  return items;
}

function docMenu(anchor, id) {
  const d = docById(id);
  if (!d) return;
  openMenu(anchor, [
    { label: 'Read whole document', icon: I.book, disabled: !!d.status, run: () => { openReader(id); closeDrawer(); } },
    { label: 'Search only this', icon: I.target, disabled: !!d.status, run: () => solo(id) },
    { sep: true },
    ...(d.source ? [
      { sep: true },
      { label: 'Check for an update', icon: I.refresh, disabled: !!d.status, run: () => checkSources({ docIds: [id] }) },
      { label: 'Open the original link', icon: I.globe, run: () => window.open(d.source.url, '_blank', 'noopener') },
      ...(S.watch.some((w) => w.url === d.source.page) ? [{
        label: 'Stop watching its page', icon: I.out, run: () => {
          const w = S.watch.find((x) => x.url === d.source.page);
          S.watch = S.watch.filter((x) => x !== w);
          saveWatch();
          renderLibrary();
          toast(`↻ will no longer look at “${pageTitle(w)}” for new documents`);
        },
      }] : []),
    ] : []),
    { sep: true },
    { label: 'Rearrange', icon: I.arrows, disabled: !!d.status, submenu: () => rearrangeDocItems(id) },
    { label: 'Move to folder', icon: I.folder, submenu: () => moveItems(d).slice(1) },
    { sep: true },
    { label: 'Remove from library', icon: I.trash, danger: true, run: () => removeDoc(id) },
  ]);
}

function folderMenu(anchor, fid) {
  openMenu(anchor, [
    { label: 'Add documents here…', icon: I.plus, run: () => pickFiles(fid) },
    { label: 'Add from a web link…', icon: I.link, run: () => openLinkDialog(fid) },
    ...(folderById(fid)?.source ? [
      { label: 'Check for updates', icon: I.refresh, run: () => checkSources({ folderIds: [fid] }) },
      { label: 'Open the linked page', icon: I.globe, run: () => window.open(folderById(fid).source.url, '_blank', 'noopener') },
      { label: 'Unlink from the page', icon: I.out, run: () => { delete folderById(fid).source; saveFolders(); renderLibrary(); toast('The folder keeps its documents but won’t look for new ones'); } },
    ] : []),
    { label: 'Search only this folder', icon: I.target, run: () => soloFolder(fid) },
    { label: 'Rename', icon: I.pencil, run: () => startRename(fid) },
    { label: 'Rearrange', icon: I.arrows, disabled: topLevel().length < 2, submenu: () => rearrangeFolderItems(fid) },
    { sep: true },
    { label: 'Delete folder (keeps documents)', icon: I.trash, danger: true, run: () => deleteFolder(fid) },
  ]);
}

function addMenu(anchor) {
  const items = [
    { label: 'Add files…', icon: I.plus, run: () => pickFiles(null) },
    { label: 'Add a folder from your computer…', icon: I.folderPlus, run: () => $('#dirInput').click() },
    { label: 'Add files into a new folder…', icon: I.folderPlus, run: () => pickFiles('new') },
    { label: 'Add from a web link…', icon: I.link, run: () => openLinkDialog(null) },
  ];
  items.push({ label: 'Find documents with AI…', icon: I.link, run: () => openLinkDialog(null, { aiOpen: true }) });
  if (hasSources()) items.push({ label: 'Check linked sources for updates', icon: I.refresh, run: () => checkSources() });
  if (S.folders.length) {
    items.push({ sep: true }, { header: 'Add files into' });
    for (const f of S.folders) items.push({ label: f.name, icon: I.folder, run: () => pickFiles(f.id) });
  }
  openMenu(anchor, items);
}

const byName = (a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true, sensitivity: 'base' });

// where the next file-picker selection goes: null (no folder), a folder id, or 'new'
let pickTarget = null;
function pickFiles(target) {
  pickTarget = target;
  $('#fileInput').click();
}

// Dropped items can include whole folders; read them recursively.
function droppedEntries(dt) {
  const entries = [...(dt.items || [])].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  return entries.length ? entries : null;
}
async function readEntries(entries) {
  const groups = [];
  const loose = [];
  const walk = async (entry, out) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, out);
      }
    }
  };
  for (const e of entries) {
    if (e.isDirectory) {
      const files = [];
      await walk(e, files);
      groups.push({ name: e.name, files });
    } else await walk(e, loose);
  }
  return { groups, loose };
}

// target: folder id, null, or undefined (= no folder; dropped folders become library folders)
async function importDrop(dt, target) {
  const entries = droppedEntries(dt);
  if (!entries) { addFiles(dt.files, target || null); return; }
  const { groups, loose } = await readEntries(entries);
  if (loose.length) addFiles(loose, target || null);
  for (const g of groups) {
    const usable = g.files.filter((f) => kindOf(f.name)).sort(byName);
    if (!usable.length) { toast(`No supported documents in “${g.name}”`); continue; }
    const fid = target || folderNamed(g.name).id;
    addFiles(usable, fid, { quietSkip: true });
    if (usable.length < g.files.length) toast(`Skipped ${plural(g.files.length - usable.length, 'file')} in “${g.name}” that aren’t documents`);
  }
}

// ---------- adding files ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
let queue = Promise.resolve();

function addFiles(fileList, folderId = null, { quietSkip = false } = {}) {
  const files = [...fileList];
  if (!files.length) return;
  const bad = files.filter((f) => !kindOf(f.name));
  if (bad.length && !quietSkip) toast(`Skipped ${bad.length === 1 ? `“${bad[0].name}”` : plural(bad.length, 'file')} — use PDF, Word (.docx), text, Markdown or HTML`);
  let order = S.docs.reduce((m, d) => Math.max(m, d.order || 0), 0);
  const maybeNewer = [];
  for (const file of files) {
    const kind = kindOf(file.name);
    if (!kind) continue;
    const dup = S.docs.find((d) => d.name === file.name && d.size === file.size);
    if (dup && file._diskPath) { // already in the library: from now on it's this file in the folder
      setDiskPath(dup.id, file._diskPath);
      store.addDoc(stripMeta(dup), S.texts.get(dup.id) || [], null).catch(() => {});
      continue;
    }
    if (dup) {
      if (folderId && dup.folderId !== folderId) moveDocs([dup.id], folderId);
      else toast(`“${file.name}” is already in your library`);
      continue;
    }
    // same name, or the same document with a different edition letter/year: probably a newer copy
    const older = S.docs.find((d) => !d.status && d.kind === kind && (d.name === file.name || editionKey(d.name) === editionKey(file.name)));
    if (older && !forceNew.has(file) && !file._diskPath) { maybeNewer.push({ file, doc: older }); continue; }
    const meta = { id: uid(), name: file.name, kind, size: file.size, addedAt: Date.now(), order: ++order, enabled: true, status: 'indexing', progress: 0, v: EXTRACTOR_VERSION, folderId: folderId || null };
    if (file._diskPath) setDiskPath(meta.id, file._diskPath);
    S.docs.push(meta);
    queue = queue.then(() => ingest(file, meta));
  }
  renderLibrary();
  syncControls();
  if (active === results && !S.matcher) renderView(results);
  if (maybeNewer.length) offerReplacements(maybeNewer, folderId);
}
const forceNew = new WeakSet(); // files the person chose to add separately

async function ingest(file, meta) {
  let last = 0;
  try {
    let { pages, bytes, baseUrl } = await readFile(file, (n, total) => {
      meta.progress = n / total;
      const now = performance.now();
      if (now - last > 120) { last = now; showProgress(meta); }
    });
    // a page that builds itself with scripts: search the text it actually shows
    if (meta.kind === 'html' && typeof bytes === 'string' && /<script[\s>]/i.test(bytes)) {
      const shown = (await renderedText(bytes, meta.source?.url || baseUrl).catch(() => '')).trim();
      const plain = pages.join('\n').trim();
      if (shown.length > plain.length * 1.15 + 80) pages = paginate(shown);
    }
    const pdfLabels = pages.labels;
    const before = pages, pdfMarks = pages.marks;
    if (hasLiveText && meta.kind === 'pdf' && bytes) pages = await liveText(bytes, pages, meta);
    // headings and captions, where the page's text is still the one they were found in
    if (pdfMarks) { meta.marks = pages.map((t, n) => (t === before[n] ? pdfMarks[n] : null)); meta.marksV = MARKS_V; }
    const chars = pages.reduce((a, p) => a + p.trim().length, 0);
    meta.pages = pages.length;
    meta.labels = docLabels(meta.kind, pages, pdfLabels);
    meta.labelsV = LABELS_V;
    meta.hash = textHash(pages);
    meta.noText = meta.kind === 'pdf' && chars < pages.length * 25;
    if (meta.kind === 'html' && bytes) meta.hasOriginal = true;
    if (baseUrl) meta.baseUrl = baseUrl;
    if (!S.docs.includes(meta)) return; // removed while reading
    if (meta.folderId && !folderById(meta.folderId)) meta.folderId = null;
    delete meta.status;
    delete meta.progress;
    delete meta.phase;
    S.texts.set(meta.id, pages);
    try {
      await store.addDoc(stripMeta(meta), pages, bytes);
    } catch (e) {
      if (stuckStorage(e)) storageStuck();
      else toast(`“${meta.name}” is searchable now but couldn’t be saved on this device (${e.message || 'storage full'})`);
    }
    if (meta.noText) toast(`“${meta.name}” has little or no text — it may be scanned. Use Original view to read it.`);
  } catch (err) {
    S.docs = S.docs.filter((d) => d !== meta);
    toast(`Couldn’t read “${meta.name}”: ${err.message || err}`);
  }
  runSearch({ keepScroll: true });
  updateStorage();
}

// Safari's database got stuck: offer to rebuild it (it's unusable until then)
async function storageStuck(lead = 'Saving failed because') {
  const sure = await review({
    title: 'This browser’s storage is stuck',
    intro: `${lead} Safari’s storage for this app stopped working (“internal error in the Indexed Database server”). This often happens after a very large import. Repairing deletes what’s stored here so it can start fresh; then add your documents again (or import a smaller backup).`,
    rows: [],
    apply: 'Repair storage',
    danger: true,
  });
  if (!sure) return;
  await store.rebuild();
  location.reload();
}

async function updateStorage() {
  indexSpotlight();
  const box = $('#storage');
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est) return;
    const mb = (est.usage || 0) / 1048576;
    box.textContent = S.docs.length ? `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB stored on this device` : 'Stored only on this device';
  } catch {}
}

// ---------- documents from websites ----------
const fmtSize = (b) => (!b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`);
// Pages being watched without a folder (documents from them sit loose in the library).
const WATCH_KEY = 'instant-search:watched';
S.watch = (() => { try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || []; } catch { return []; } })();
const saveWatch = () => { try { localStorage.setItem(WATCH_KEY, JSON.stringify(S.watch)); } catch {} };
const pageTitle = (src) => (src.title || '').split(/\s[|–—-]\s/)[0] || (() => { try { return new URL(src.url).hostname; } catch { return 'linked page'; } })();
const hasSources = () => S.docs.some((d) => d.source) || S.folders.some((f) => f.source) || S.watch.length > 0;
function sourceTitle(src) {
  const when = src.checkedAt ? ` · checked ${new Date(src.checkedAt).toLocaleDateString()}` : '';
  return `Linked to ${src.url}${when}`;
}
function textHash(pages) {
  let h = 2166136261;
  for (const p of pages) for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + pages.length;
}
// "Chapter 4: Principles of Flight (6.4 MB)" -> "Chapter 4 Principles of Flight.pdf"
function nameFromLink(text, url, type) {
  const file = fileNameFor(url, type);
  const ext = (file.match(/\.[a-z0-9]+$/i) || [''])[0];
  const clean = String(text || '')
    .replace(/\(?\s*\d+(\.\d+)?\s*(KB|MB|GB)\s*\)?/gi, '')
    .replace(/\b(pdf|download|opens? in new (tab|window))\b/gi, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length >= 3 && clean.length <= 120 ? clean + ext : file;
}
function helperProblem(err) {
  if (err instanceof NeedsHelper) return 'This site doesn’t allow direct downloads, so the download helper is needed.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(err?.message || '')) return 'Couldn’t reach the download helper. Check its address below.';
  return err?.message || String(err);
}

// Add one document from a link (download → read → save). Shows progress in the library.
function addRemote(url, { folderId = null, linkText = '', note = '', page = '', info = null } = {}) {
  const name = linkText ? nameFromLink(linkText, url, info?.type) : fileNameFor(url, info?.type);
  const kind = kindOf(name) || 'html';
  const order = S.docs.reduce((m, d) => Math.max(m, d.order || 0), 0) + 1;
  const meta = { id: uid(), name, kind, size: info?.size || 0, addedAt: Date.now(), order, enabled: true, status: 'indexing', phase: 'download', progress: 0, v: EXTRACTOR_VERSION, folderId, source: { url, linkText, note, page } };
  S.docs.push(meta);
  renderLibrary();
  queue = queue.then(async () => {
    let last = 0;
    try {
      const dl = await download(url, (f) => {
        meta.progress = f;
        const now = performance.now();
        if (now - last > 150) { last = now; showProgress(meta); }
      });
      if (kind !== 'html' && dl.info.type === 'text/html') throw new Error('the link opened a web page instead of a document');
      meta.phase = 'read';
      meta.progress = 0;
      meta.size = dl.info.size;
      meta.source = { url, linkText, note, page, etag: dl.info.etag, lastModified: dl.info.lastModified, size: dl.info.size, checkedAt: Date.now() };
      await ingest(new File([dl.bytes], meta.name, { type: dl.info.type || '' }), meta);
    } catch (err) {
      S.docs = S.docs.filter((d) => d !== meta);
      renderLibrary();
      if (err instanceof NeedsHelper) { toast(`“${meta.name}”: ${helperProblem(err)}`); openLinkDialog(folderId, { url, helperOpen: true }); }
      else toast(`Couldn’t add “${meta.name}”: ${helperProblem(err)}`, { ms: 6000 });
    }
  });
}

// ---------- the iPhone app ----------
// Scanned pages (little or no text) are read with Live Text, on the device.
async function liveText(bytes, pages, meta) {
  const scanned = pages.map((p, i) => (p.trim().length < 25 ? i : -1)).filter((i) => i >= 0);
  if (!scanned.length) return pages;
  const out = pages.slice();
  let pdf;
  try {
    const pdfjs = globalThis.pdfjsLib;
    pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes), isEvalSupported: false }).promise;
    meta.phase = 'scan';
    for (let k = 0; k < scanned.length; k++) {
      if (!S.docs.includes(meta)) break;
      const page = await pdf.getPage(scanned[k] + 1);
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, 2200 / Math.max(vp.width, vp.height));
      const v = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(v.width);
      c.height = Math.round(v.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: v }).promise;
      const r = await recognize(c).catch(() => null);
      if (r?.text?.trim()) out[scanned[k]] = r.text;
      c.width = c.height = 0;
      page.cleanup();
      meta.progress = (k + 1) / scanned.length;
      showProgress(meta);
    }
  } catch {} finally { pdf?.destroy?.(); delete meta.phase; }
  return out;
}

// The library folder (On My iPhone › Instant Search): files added there are added to the library, files
// changed there are read again, files deleted there leave the library. Runs at start and whenever the app comes back.
let syncing = null;
async function syncFolder() {
  if (!isNative) return;
  if (syncing) return syncing;
  syncing = (async () => {
    const [all, paths] = await Promise.all([listAll(), store.paths()]);
    const files = all.files || [];
    const byPath = new Map([...paths].map(([id, p]) => [p, id]));
    const onDisk = new Map(files.map((f) => [f.path, f]));
    const waiting = new Set(all.waiting || []); // still coming down from iCloud: not deleted
    if (all.pending) setTimeout(() => syncFolder(), 4000); // check again once they've arrived
    // gone from the folder: gone from the library
    for (const [id, path] of paths) {
      if (onDisk.has(path) || waiting.has(path)) continue;
      const doc = docById(id);
      if (!doc || doc.status) continue;
      S.docs.splice(S.docs.indexOf(doc), 1);
      S.texts.delete(id);
      closePdf(id);
      store.deleteDoc(id, { keepFile: true }).catch(() => {});
    }
    const fresh = [];
    // a backup opened in Findly (or dropped in its folder): offer to bring it in, read from disk a piece at a time
    for (const f of files) {
      if (!/\.isbackup$/i.test(f.path) || /^(Backups|\.)/.test(f.path)) continue;
      const seen = `instant-search:offered:${f.path}:${f.size}`;
      if (localStorage.getItem(seen)) continue;
      try { localStorage.setItem(seen, '1'); } catch {}
      setTimeout(async () => importBackup(await diskFile(f.path)), 300);
      break;
    }
    for (const f of files) {
      const name = f.path.split('/').pop();
      if (!kindOf(name) || name === 'Put documents here.txt' || /^(Backups|\.findly)\//.test(f.path)) continue;
      const id = byPath.get(f.path);
      const doc = id && docById(id);
      if (doc) {
        // replaced or edited in the folder: read it again in place
        if (!doc.status && doc.size && f.size !== doc.size) {
          try {
            const file = await readFileObj(f.path);
            const { pages, bytes } = await readFile(file);
            setDiskPath(doc.id, f.path);
            await replaceDoc(doc, { pages, bytes, size: f.size }, false);
          } catch {}
        }
        continue;
      }
      if (id) continue;
      const file = await readFileObj(f.path).catch(() => null);
      if (!file) continue;
      file._diskPath = f.path;
      fresh.push(file);
    }
    // files put in subfolders (at any depth) land in a library folder of the same name: "Manuals › FAA"
    const byDir = new Map();
    for (const file of fresh) {
      const dir = file._diskPath.split('/').slice(0, -1).filter(Boolean).join(' › ');
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(file);
    }
    for (const [dir, list] of byDir) addFiles(list.sort(byName), dir ? folderNamed(dir).id : null, { quietSkip: true });
    if (fresh.length) libStatus.done(`Added ${plural(fresh.length, 'document')} from the Findly folder`);
    else { renderLibrary(); runSearch({ keepScroll: true }); }
  })().finally(() => { syncing = null; });
  return syncing;
}
// Spotlight: every document, with its text, so a search on the iPhone finds it.
let spotT = 0;
function indexSpotlight() {
  if (!isNative) return;
  clearTimeout(spotT);
  spotT = setTimeout(() => {
    const docs = S.docs.filter((d) => !d.status).map((d) => ({ id: d.id, title: d.name.replace(/\.[a-z0-9]+$/i, ''), pages: d.pages || 0, text: (S.texts.get(d.id) || []).join('\n').slice(0, 200000) }));
    Link.index({ docs }).catch(() => {});
  }, 3000);
}
// Shortcuts / Siri ("Search documents for…") and Spotlight results open here.
function openFromSystem(r) {
  if (!r) return;
  if (r.url) { // a link to a search, opened in the app instead of the browser
    const h = (() => { try { return new URL(r.url).hash; } catch { return ''; } })();
    if (h.startsWith('#find?')) { if (location.hash === h) openSearchLink(); else location.hash = h; }
    return;
  }
  if (r.q) { q.value = r.q; if (active === reader) closeReader(); runSearch(); updateChrome?.(); }
  else if (r.doc && docById(r.doc)) openReader(r.doc, 0);
}
// ---- iCloud sync: your folders and how documents are organised travel with the files ----
// The documents themselves sync as files in iCloud Drive › Findly (each device reads them itself). Folders and each
// document's folder, order and on/off state go in a small library file next to them; the newest one wins.
const STATE = '.findly/library.json';
const ME = (() => { try { let id = localStorage.getItem('instant-search:device'); if (!id) { id = uid(); localStorage.setItem('instant-search:device', id); } return id; } catch { return 'device'; } })();
let cloudOn = false, stateT = 0, applying = false;
function scheduleState() {
  if (!cloudOn || applying) return;
  clearTimeout(stateT);
  stateT = setTimeout(writeState, 1200);
}
async function writeState() {
  const paths = await store.paths();
  const docs = {};
  for (const d of S.docs) { const p = paths.get(d.id); if (p && !d.status) docs[p] = { folderId: d.folderId || null, order: d.order || 0, enabled: d.enabled !== false, name: d.name }; }
  const at = Date.now();
  await writeBytes(STATE, JSON.stringify({ v: 1, at, device: ME, folders: S.folders, docs })).catch(() => {});
  try { localStorage.setItem('instant-search:stateAt', String(at)); } catch {}
}
async function applyState() {
  if (!cloudOn) return;
  let st;
  try { st = JSON.parse(new TextDecoder().decode(await readBytes(STATE))); } catch { return; }
  const seen = Number(localStorage.getItem('instant-search:stateAt') || 0);
  if (!st || st.at <= seen) return;
  await queue; // documents still being read get their folder once they're in
  applying = true;
  try {
    S.folders = st.folders || [];
    const ids = new Map([...(await store.paths())].map(([id, p]) => [p, id]));
    const changed = [];
    for (const [p, m] of Object.entries(st.docs || {})) {
      const doc = docById(ids.get(p));
      if (!doc) continue;
      Object.assign(doc, { folderId: m.folderId && S.folders.some((f) => f.id === m.folderId) ? m.folderId : null, order: m.order, enabled: m.enabled });
      changed.push(doc);
    }
    S.docs.sort((a, b) => (a.order || 0) - (b.order || 0));
    await store.putFolders(S.folders).catch(() => {});
    if (changed.length) await store.updateDocs(changed.map(stripMeta)).catch(() => {});
    localStorage.setItem('instant-search:stateAt', String(st.at));
    renderLibrary();
    runSearch({ keepScroll: true });
  } finally { applying = false; }
}
async function syncCloud() {
  await syncFolder();
  await applyState();
  indexSpotlight();
}
async function toggleCloud() {
  const st = await cloudStatus();
  if (!st.available) { toast('iCloud Drive isn’t available. Sign in to iCloud and turn on iCloud Drive in Settings, then try again.', { ms: 7000 }); return; }
  const on = !st.on;
  const sure = await review({
    title: on ? 'Turn on iCloud sync?' : 'Turn off iCloud sync?',
    intro: on
      ? 'Your documents move into <b>iCloud Drive › Findly</b>, so Findly on your other Apple devices has the same library: documents, folders and how they’re organised. Documents already there from your other devices are added here too, with no duplicates.'
      : 'Your documents are copied back onto this device. iCloud keeps its copy for your other devices; changes here won’t reach them any more.',
    rows: [],
    apply: on ? 'Turn on' : 'Turn off',
    alwaysApply: true,
  });
  if (!sure) return;
  const busy = toast(on ? 'Moving your library into iCloud…' : 'Copying your library onto this device…', { ms: Infinity });
  try {
    // what each document is called on disk now, so they keep their place after the move
    const before = await store.paths();
    await setCloud(on);
    cloudOn = on;
    const after = new Set((await listFiles()).map((f) => f.path));
    for (const [id, p] of before) if (after.has(p)) setDiskPath(id, p);
    busy._hide();
    toast(on ? 'iCloud sync is on' : 'iCloud sync is off');
    if (on) await writeState();
    syncCloud();
  } catch (e) {
    busy._hide();
    toast(`Couldn’t change iCloud sync: ${e?.message || e}`, { ms: 7000 });
  }
}

// Windows: the library is a folder you choose; documents are read straight from it
async function changeLibraryFolder() {
  const now = await libraryFolder().catch(() => '');
  const sure = await review({
    title: 'Library folder',
    intro: `Findly reads your documents straight from a folder on this computer${now ? `, now <b>${esc(now)}</b>` : ''}. Pick another folder: the documents in it become your library, and anything you add goes there.`,
    rows: [],
    apply: 'Choose folder…',
    alwaysApply: true,
  });
  if (!sure) return;
  const p = await pickLibraryFolder().catch((e) => { toast(`Couldn’t change the folder: ${e?.message || e}`); return null; });
  if (!p) return;
  // the old folder's documents leave the library (their files stay where they are); the new folder's come in
  for (const d of [...S.docs]) { S.docs.splice(S.docs.indexOf(d), 1); S.texts.delete(d.id); closePdf(d.id); await store.deleteDoc(d.id, { keepFile: true }).catch(() => {}); }
  renderLibrary();
  cloudOn = !!(await cloudStatus()).on;
  toast(cloudOn ? `Library folder: ${p} (in iCloud Drive: syncing with your Apple devices)` : `Library folder: ${p}`, { ms: 6000 });
  try { localStorage.removeItem('instant-search:stateAt'); } catch {} // take the folder's own organisation
  syncCloud();
}

function nativeSetup() {
  if (!isNative) return;
  document.documentElement.classList.add('native');
  for (const k of ['updateDoc', 'updateDocs', 'putFolders', 'deleteFolder', 'addDoc']) { // any change to the library: tell your other devices
    const orig = store[k];
    store[k] = (...a) => { scheduleState(); return orig.apply(store, a); };
  }
  if (platform === 'windows') document.documentElement.classList.add('desktop-app');
  if (platform === 'windows') addEventListener('focus', () => applyState()); // changes from your other devices
  cloudStatus().then((st) => { cloudOn = !!st.on; return syncCloud(); });
  Files.addListener('changed', () => syncCloud());
  Files.addListener('incoming', () => syncFolder().then(indexSpotlight));
  // documents dropped into the folder in Files while Findly was in the background: pick them up on coming back
  let lastLook = Date.now();
  const lookAgain = () => {
    if (document.hidden || Date.now() - lastLook < 1500) return;
    lastLook = Date.now();
    syncFolder().then(indexSpotlight).catch(() => {});
  };
  document.addEventListener('visibilitychange', lookAgain);
  addEventListener('focus', lookAgain);
  Files.takeIncoming().then((r) => { if (r?.files?.length) syncFolder(); }).catch(() => {});
  Link.addListener('open', openFromSystem);
  Link.takePending().then(openFromSystem).catch(() => {});
}

// Swap a document's contents for a newer version, optionally keeping the old one as "(previous)".
async function replaceDoc(doc, { pages, bytes, size, name, source }, keepOld) {
  if (keepOld) {
    const oldBytes = await store.file(doc.id).catch(() => null);
    const copy = { ...stripMeta(doc), id: uid(), name: doc.name.replace(/(\.[a-z0-9]+)?$/i, ' (previous)$1'), enabled: false, source: undefined, previousOf: doc.id, archivedAt: Date.now() };
    delete copy.updatedAt;
    S.docs.splice(S.docs.indexOf(doc) + 1, 0, copy);
    S.texts.set(copy.id, S.texts.get(doc.id));
    await store.addDoc(copy, S.texts.get(doc.id), oldBytes || undefined).catch(() => {});
  }
  closePdf(doc.id);
  forgetHtml(doc.id);
  for (const k of [...override.keys()]) if (k.startsWith(doc.id + ':')) override.delete(k);
  const chars = pages.reduce((a, p) => a + p.trim().length, 0);
  Object.assign(doc, {
    pages: pages.length, size: size || doc.size, updatedAt: Date.now(), hash: textHash(pages),
    labels: docLabels(doc.kind, pages, pages.labels), labelsV: LABELS_V,
    noText: doc.kind === 'pdf' && chars < pages.length * 25,
    marks: pages.marks || null, marksV: pages.marks ? MARKS_V : 0,
  });
  sendMarks(doc);
  if (name) doc.name = name;
  if (source) doc.source = source;
  if (doc.kind === 'html' && bytes) doc.hasOriginal = true;
  S.texts.set(doc.id, pages);
  await store.addDoc(stripMeta(doc), pages, bytes || undefined).catch((e) => toast(`Updated, but couldn’t save on this device (${e.message})`));
}

// Compare a new version with the copy in the library. Big drops in pages or size usually mean the
// download isn't really the document (an error page, a single chapter instead of the book…).
function compareVersions(doc, pages, size) {
  const oldPages = S.texts.get(doc.id)?.length || doc.pages || 0;
  const oldSize = doc.size || 0;
  const same = doc.hash && doc.hash === textHash(pages);
  const reasons = [];
  if (oldPages >= 3 && pages.length < oldPages * 0.6) reasons.push(`only ${plural(pages.length, 'page')} instead of ${fmt(oldPages)}`);
  if (oldSize > 50 * 1024 && size && size < oldSize * 0.4) reasons.push(`only ${fmtSize(size)} instead of ${fmtSize(oldSize)}`);
  const chars = pages.reduce((a, p) => a + p.trim().length, 0);
  if (doc.kind === 'pdf' && !doc.noText && chars < pages.length * 25) reasons.push('almost no text');
  const detail = `${fmt(oldPages)} → ${plural(pages.length, 'page')}${oldSize && size ? ` · ${fmtSize(oldSize)} → ${fmtSize(size)}` : ''}`;
  return { same, suspicious: reasons.length > 0, detail, reasons };
}

// ---------- review dialog ----------
function review({ title, intro = '', rows, options = [], apply = 'Apply', cancel = 'Cancel', danger = false, alwaysApply = false }) {
  return new Promise((resolve) => {
    const dlg = $('#reviewDlg');
    $('#reviewTitle').textContent = title;
    $('#reviewIntro').innerHTML = intro;
    const boxes = rows.filter((r) => !r.header && !r.info).length;
    $('#reviewBulk').hidden = boxes < 3;
    let inGroup = false;
    $('#reviewList').innerHTML = rows.map((r, i) => {
      if (r.header) {
        let n = 0;
        for (let j = i + 1; j < rows.length && !rows[j].header; j++) if (!rows[j].info) n++;
        const bulk = n >= 2 && boxes > n ? `<span class="sec-bulk"><button type="button" data-sec="all">All</button><button type="button" data-sec="none">None</button></span>` : '';
        const close = inGroup ? '</div>' : '';
        inGroup = true;
        return `${close}<h4>${esc(r.header)}${bulk}</h4><div class="rgroup">`;
      }
      const body = `<span class="rtext"><b>${esc(r.title)}</b><span>${r.detail || ''}</span></span>`;
      if (r.info) return `<div class="rrow info ${r.tone || ''}">${body}</div>`;
      return `<label class="rrow ${r.tone || ''}"><input type="checkbox" data-i="${i}" ${r.checked ? 'checked' : ''}>${body}</label>`;
    }).join('') + (inGroup ? '</div>' : '');
    $('#reviewOpts').innerHTML = options.map((o) => o.choices
      ? `<div class="choice" role="radiogroup" aria-label="${esc(o.label || '')}">${o.label ? `<div class="choice-title">${esc(o.label)}</div>` : ''}${o.choices.map((c) => `<label class="choice-card"><input type="radio" name="opt-${o.id}" data-c="${o.id}" value="${c.value}" ${c.value === o.value ? 'checked' : ''}><span><b>${esc(c.label)}</b><em>${esc(c.hint || '')}</em></span></label>`).join('')}</div>`
      : `<label class="check-row"><input type="checkbox" data-o="${o.id}" ${o.checked ? 'checked' : ''}> ${esc(o.label)}</label>`).join('');
    const actionable = danger || alwaysApply || rows.some((r) => !r.header && !r.info);
    $('#reviewApply').classList.toggle('danger', danger);
    $('#reviewApply').hidden = !actionable;
    $('#reviewApply').textContent = apply;
    $('#reviewCancel').textContent = actionable ? cancel : 'Close';
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const picked = new Set($$('#reviewList input:checked').map((x) => rows[Number(x.dataset.i)]));
      const opts = Object.fromEntries($$('#reviewOpts input[data-o]').map((x) => [x.dataset.o, x.checked]));
      for (const x of $$('#reviewOpts input[data-c]:checked')) opts[x.dataset.c] = x.value;
      $('#reviewApply').onclick = $('#reviewCancel').onclick = $('#reviewX').onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(ok ? { picked, unpicked: rows.filter((r) => !r.header && !r.info && !picked.has(r)), options: opts } : null);
    };
    const count = () => {
      const all = $$('#reviewList input');
      const on = all.filter((x) => x.checked).length;
      $('#reviewCount').textContent = all.length ? `${fmt(on)} of ${fmt(all.length)} selected` : '';
    };
    count();
    $('#reviewList').onchange = (e) => {
      const i = Number(e.target.dataset?.i);
      if (rows[i]?.all) $$('#reviewList input').forEach((x) => (x.checked = e.target.checked));
      count();
    };
    $('#reviewBulk').onclick = (e) => {
      const b = e.target.closest('[data-all]');
      if (!b) return;
      $$('#reviewList input').forEach((x) => (x.checked = b.dataset.all === '1'));
      count();
    };
    $('#reviewList').onclick = (e) => {
      const b = e.target.closest('[data-sec]');
      if (!b) return;
      e.preventDefault();
      const grp = b.closest('h4').nextElementSibling;
      if (grp) for (const box of grp.querySelectorAll('input')) box.checked = b.dataset.sec === 'all';
      count();
    };
    $('#reviewApply').onclick = () => finish(true);
    $('#reviewCancel').onclick = $('#reviewX').onclick = () => finish(false);
    // a previous dialog's close event can arrive after this one opened; only a real close cancels
    dlg.onclose = () => { if (!dlg.open) finish(false); };
    closeMenu();
    dlg.showModal();
  });
}

// ---------- option 3: dropping in a newer copy of a document you already have ----------
async function offerReplacements(list, folderId) {
  libStatus.show(`Comparing ${plural(list.length, 'file')} with your copies`, 0);
  const rows = [{ header: 'Replace these?' }];
  for (const [k, item] of list.entries()) {
    libStatus.show(`Comparing ${plural(list.length, 'file')} with your copies`, k / list.length);
    try {
      const { pages, bytes } = await readFile(item.file);
      const c = compareVersions(item.doc, pages, item.file.size);
      Object.assign(item, { pages, bytes });
      rows.push({
        item, checked: !c.suspicious, tone: c.suspicious ? 'warn' : c.same ? '' : 'up',
        title: item.doc.name,
        detail: `${c.same ? 'Same text as your copy' : c.detail}${item.file.name !== item.doc.name ? ` · from “${esc(item.file.name)}”` : ''}${c.suspicious ? ` — careful: ${c.reasons.join(', ')}` : ''}`,
      });
    } catch (err) {
      rows.push({ info: true, tone: 'warn', title: item.file.name, detail: `Couldn’t read it: ${esc(err.message || err)}` });
    }
  }
  libStatus.hide();
  const res = await review({
    title: 'Newer copies of documents you have?',
    intro: 'These look like new versions of documents already in your library. Ticked ones replace your copy (same folder and settings). Unticked ones are added as separate documents.',
    rows,
    options: [{ id: 'keep', label: 'Keep the old versions too (as “(previous)”, left out of searches)' }],
    apply: 'Update',
  });
  if (!res) return;
  for (const r of rows) {
    if (!r.item || !r.item.pages) continue;
    if (res.picked.has(r)) await replaceDoc(r.item.doc, { pages: r.item.pages, bytes: r.item.bytes, size: r.item.file.size, name: r.item.file.name }, res.options.keep);
    else { forceNew.add(r.item.file); addFiles([r.item.file], folderId); }
  }
  runSearch({ keepScroll: true });
  updateStorage();
  const n = [...res.picked].filter((r) => r.item).length;
  if (n) toast(`Updated ${plural(n, 'document')}`);
}

// ---------- option 1 + 2: add from a link (a file, or a page listing files) ----------
function openLinkDialog(folderId, { url = '', helperOpen = false, aiOpen = false } = {}) {
  closeMenu();
  const sel = $('#linkFolder');
  sel.innerHTML = `<option value="">No folder</option>` + S.folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  sel.value = folderId || '';
  $('#linkUrl').value = url;

  $('#autoCheck').checked = !!prefs.autoCheck;
  showHelperState();
  if (helperOpen) setTimeout(() => openHelper(), 250);
  $('#aiBox').open = aiOpen || false;
  loadHelperCode();

  fillAiBox();
  setLinkStatus('');
  $('#linkGo').disabled = false;
  $('#linkDlg').showModal();
  setTimeout(() => (aiOpen ? $('#aiGo') : $('#linkUrl')).focus(), 50);
  if (aiOpen && !unlinked().length) setAiMode('new');
  if (aiOpen) setTimeout(() => $('#aiBox').scrollIntoView({ block: 'nearest' }), 60);
}
function setLinkStatus(msg, err) {
  const s = $('#linkStatus');
  s.textContent = msg;
  s.classList.toggle('err', !!err);
}

async function submitLink() {
  let url = $('#linkUrl').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { url = new URL(url).toString(); } catch { setLinkStatus('That doesn’t look like a web link.', true); return; }
  const folderId = $('#linkFolder').value || null;
  $('#linkGo').disabled = true;
  setLinkStatus('Looking at the link…');
  try {
    const info = await remoteInfo(url);
    if (info.status >= 400) throw new Error(`the site answered ${info.status}`);
    if (looksLikeDocument(info.finalUrl || url, info.type)) {
      $('#linkDlg').close();
      addRemote(url, { folderId, info });
      toast('Downloading the document…', { ms: 2000 });
      return;
    }
    setLinkStatus('Reading the page…');
    const { res, finalUrl } = await remoteFetch(url);
    const html = await res.text();
    const { links, title } = documentLinks(html, finalUrl || url);
    $('#linkDlg').close();
    if (!links.length) {
      addRemote(url, { folderId, info: { ...info, type: 'text/html' } });
      toast('No documents are listed on that page, so the page itself was added.');
      return;
    }
    await pickFromPage(url, links, title, folderId);
  } catch (err) {
    setLinkStatus(helperProblem(err), true);
    if (err instanceof NeedsHelper || /helper/i.test(String(err?.message))) openHelper();
  } finally {
    $('#linkGo').disabled = false;
  }
}

async function fillSizes(links) {
  const need = links.filter((l) => !l.shownSize).slice(0, 60);
  let i = 0;
  const worker = async () => {
    while (i < need.length) {
      const l = need[i++];
      try { l.shownSize = (await remoteInfo(l.url)).size; } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// A page that lists both a whole book and its chapters: the book is about as big as everything else together.
function looksLikeWholeBook(link, links) {
  // when the page nests parts under a document, that document is the combined edition to keep
  if (links.some((l) => l.parent === link.url) || link.parent) return false;
  if (links.length < 4 || !link.shownSize) return false;
  const others = links.filter((l) => l !== link).reduce((a, l) => a + (l.shownSize || 0), 0);
  return link.shownSize >= others * 0.55 || /full|complete|entire|whole/i.test(link.text);
}

async function pickFromPage(pageUrl, links, title, folderId) {
  libStatus.show(`Found ${plural(links.length, 'document')} on the page · checking sizes`);
  await fillSizes(links).finally(() => libStatus.hide());
  const rows = [{ header: title || 'Documents on this page' }];
  for (const l of links) {
    const book = looksLikeWholeBook(l, links);
    const parent = l.parent && links.find((x) => x.url === l.parent);
    const why = book ? ' · <b>looks like the whole book — the chapters below cover the same pages</b>'
      : parent ? ` · <b>listed under “${esc(parent.text)}”, which already includes it</b>` : '';
    rows.push({ link: l, checked: !book && !parent, title: l.text, detail: `${[fmtSize(l.shownSize) || 'size unknown', l.note && esc(l.note)].filter(Boolean).join(' · ')} · ${esc(fileNameFor(l.url))}${why}` });
  }
  const res = await review({
    title: 'Add documents from this page',
    intro: 'Pick the documents to add. Pages often list a whole book <i>and</i> its parts (chapters, or changes already included in a combined edition) — those parts start unticked so you don’t get every hit twice.',
    rows,
    options: [{
      id: 'link', label: 'After adding them', value: 'watch', choices: [
        { value: 'watch', label: 'Keep them up to date', hint: 'When you press ↻, the app checks this page for new versions and new documents.' },
        { value: 'once', label: 'Just this once', hint: 'Download these now and forget the page. They won’t be updated.' },
      ],
    }],
    apply: 'Add',
  });
  if (!res) return;
  const picked = rows.filter((r) => r.link && res.picked.has(r));
  if (!picked.length) return;
  const fid = folderId && folderById(folderId) ? folderId : null; // no folder picked: they go straight into the library
  const watch = res.options.link === 'watch';
  if (watch) {
    const src = { url: pageUrl, title, ignored: rows.filter((r) => r.link && !res.picked.has(r)).map((r) => r.link.url), checkedAt: Date.now() };
    if (fid) { folderById(fid).source = src; saveFolders(); }
    else { S.watch = S.watch.filter((w) => w.url !== pageUrl).concat(src); saveWatch(); }
  }
  for (const r of picked) addRemote(r.link.url, { folderId: fid, linkText: r.link.text, note: r.link.note, page: watch ? pageUrl : '', info: { size: r.link.shownSize } });
  renderLibrary();
}

// ---------- finding links for files you already have, with an AI chatbot ----------
// The app writes a request listing your unlinked files; you paste it into a chatbot that can search the web,
// then paste its answer back. Every link it gives is opened and checked here before anything is linked.
const AI_BOTS = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/', q: (t) => `https://chatgpt.com/?hints=search&q=${encodeURIComponent(t)}` },
  claude: { label: 'Claude', url: 'https://claude.ai/new', q: (t) => `https://claude.ai/new?q=${encodeURIComponent(t)}` },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com/app' },
  perplexity: { label: 'Perplexity', url: 'https://www.perplexity.ai/', q: (t) => `https://www.perplexity.ai/search?q=${encodeURIComponent(t)}` },
  copilot: { label: 'Copilot', url: 'https://copilot.microsoft.com/' },
};
const unlinked = () => S.docs.filter((d) => !d.status && !d.source);

function fillAiBox() {
  const all = unlinked();
  const ticked = all.filter((d) => d.enabled);
  const opts = [`<option value="all">All files without a link (${fmt(all.length)})</option>`];
  if (ticked.length && ticked.length < all.length) opts.push(`<option value="ticked">Only ticked ones (${fmt(ticked.length)})</option>`);
  for (const f of S.folders) {
    const n = all.filter((d) => d.folderId === f.id).length;
    if (n) opts.push(`<option value="f:${f.id}">Folder “${esc(f.name)}” (${fmt(n)})</option>`);
  }
  const which = $('#aiWhich');
  const was = which.value;
  which.innerHTML = opts.join('');
  if ([...which.options].some((o) => o.value === was)) which.value = was;
  const dest = $('#aiDest');
  const dwas = dest.value;
  dest.innerHTML = `<option value="new">A new folder</option><option value="">No folder</option>` + S.folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  if (dest.dataset.picked && [...dest.options].some((o) => o.value === dwas)) dest.value = dwas;
  $('#aiDestNameRow').hidden = dest.value !== 'new';
  setAiMode(aiMode);
  $('#aiBot').innerHTML = Object.entries(AI_BOTS).map(([k, b]) => `<option value="${k}">${b.label}</option>`).join('');
  $('#aiBot').value = AI_BOTS[prefs.aiBot] ? prefs.aiBot : 'chatgpt';
  $('#aiState').textContent = all.length ? `${plural(all.length, 'file')} not linked` : '';
  setAiStatus('');
}
let aiMode = 'link';
function setAiMode(m) {
  aiMode = m;
  $$('#aiMode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
  $$('#aiBox [data-for]').forEach((x) => (x.hidden = x.dataset.for !== m));
  $('#aiGo').disabled = $('#aiCopy').disabled = m === 'link' && !unlinked().length;
}
function setAiStatus(msg, err) {
  const s = $('#aiStatus');
  s.innerHTML = msg;
  s.classList.toggle('err', !!err);
}
function aiFiles() {
  const v = $('#aiWhich').value;
  const all = unlinked();
  if (v === 'ticked') return all.filter((d) => d.enabled);
  if (v.startsWith('f:')) return all.filter((d) => d.folderId === v.slice(2));
  return all;
}
function aiPrompt(docs) {
  const opening = (d) => {
    const first = (S.texts.get(d.id) || []).find((p) => p.trim()) || '';
    const t = first.replace(/\s+/g, ' ').trim().slice(0, 90);
    return t ? ` — begins “${t.replace(/["“”]/g, '')}…”` : '';
  };
  const line = (d) => `- ${d.name} (${[d.pages || S.texts.get(d.id)?.length ? plural(d.pages || S.texts.get(d.id).length, 'page') : '', fmtSize(d.size)].filter(Boolean).join(', ')})${opening(d)}`;
  const groups = [];
  for (const it of topLevel()) {
    if (it.kind === 'folder') {
      const inside = docs.filter((d) => d.folderId === it.id);
      if (inside.length) groups.push(`Folder “${it.f.name}”:\n${inside.map(line).join('\n')}`);
    }
  }
  const loose = docs.filter((d) => !(d.folderId && folderById(d.folderId)));
  if (loose.length) groups.push(`${groups.length ? 'Not in a folder:\n' : ''}${loose.map(line).join('\n')}`);
  return `I keep the documents listed below in a document search app. I want to link each one to its official source on the web, so the app can check that source for newer editions later.

For each file, search the web and find the official publisher's copy (for example faa.gov for FAA handbooks and orders). Open the pages to confirm. Only give links you have confirmed exist and that come from the official publisher — not mirrors, shops, school sites or file-sharing sites. If you are not sure, write NOT FOUND. A wrong link is worse than no link, so never guess or build a URL from a pattern.

For each file give:
- PAGE: the publisher's web page that lists this document and its download, i.e. the page they update when a new edition comes out. This matters most, because the app watches that page for new editions.
- FILE: the direct download link of the current edition (usually a .pdf), exactly as linked on that page.

Several of my files often come from the same page — for example one handbook page that lists the whole book and every chapter separately, or a page listing a manual and each of its changes. That's expected: still write one line per file, repeat the same PAGE on each of those lines, and give each line the FILE link for that particular file (the chapter's own link for a chapter, the whole-book link only for the whole book). Match by what the file is (its title and opening words), not just its name. Never put two of my files on the same FILE link unless they really are the same document.

Reply with one code block and nothing else, one line per file, in exactly this format, with the file name copied exactly as I wrote it:
<file name> | PAGE: <link or NOT FOUND> | FILE: <link or NOT FOUND>

My files (folder names, page counts and opening words are there to help you identify them):

${groups.join('\n\n')}`;
}
function aiNewPrompt(ask) {
  const dest = $('#aiDest').value;
  const where = dest === 'new' ? ($('#aiDestName').value.trim() || '') : dest ? folderById(dest)?.name || '' : '';
  const have = S.docs.filter((d) => !d.status && (dest && dest !== 'new' ? d.folderId === dest : true)).slice(0, 60).map((d) => d.name);
  return `I keep documents in a document search app that downloads them from their official sources and checks those sources for new editions. Please find these documents for me:

${ask}${where ? `

(They'll go in a folder called “${where}”.)` : ''}

Search the web and open the pages to confirm every link. Only give links you have confirmed exist and that come from the official publisher (for example faa.gov, ecfr.gov, govinfo.gov) — not mirrors, shops, school sites or file-sharing sites. Never guess or build a URL you haven't opened. Leave out anything you're not sure about.

One line per document. Each needs a direct download of a file (PDF preferred), not a web page for reading online:
- the document's title, short, the way the publisher names it
- PAGE: a publisher's page that itself links to that file and is updated when a new edition comes out — or NOT FOUND
- FILE: the direct download link of the current edition
If several documents come from the same page, repeat that PAGE on each of their lines and give each its own FILE link. Don't list a combined whole-book file and its separate parts both, unless I asked for that.
For US federal regulations (the CFR, such as the FARs in Title 14), list each part as its own document, using govinfo.gov's PDF of that part from the most recent annual edition, with PAGE: NOT FOUND.${have.length ? `

I already have these, so leave them out: ${have.join('; ')}` : ''}

Reply with one code block and nothing else, in exactly this format:
<title> | PAGE: <link or NOT FOUND> | FILE: <link>`;
}
function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  (document.querySelector('dialog[open]') || document.body).append(ta); // outside an open dialog the page is inert
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  if (!ok && navigator.clipboard) { navigator.clipboard.writeText(text).catch(() => {}); ok = true; }
  return ok;
}
function aiCopy(go) {
  let text;
  let what;
  if (aiMode === 'new') {
    const ask = $('#aiAsk').value.trim();
    if (!ask) { setAiStatus('Write what you’re looking for first.', true); $('#aiAsk').focus(); return; }
    text = aiNewPrompt(ask);
    what = 'your request';
  } else {
    const docs = aiFiles();
    if (!docs.length) return;
    text = aiPrompt(docs);
    what = plural(docs.length, 'file name');
  }
  const ok = copyText(text);
  const bot = AI_BOTS[$('#aiBot').value] || AI_BOTS.chatgpt;
  prefs.aiBot = $('#aiBot').value;
  savePrefs();
  if (go) {
    const pre = bot.q && text.length < 3500 ? bot.q(text) : bot.url; // long requests are pasted instead
    window.open(pre, '_blank', 'noopener');
    setAiStatus(ok
      ? `Copied ${what}. ${pre !== bot.url ? `It should already be typed into ${bot.label}; if the box is empty, paste it` : `In ${bot.label}, paste it into the message box`} (Ctrl+V, or long-press → Paste). When it answers, copy its code block and paste it below.`
      : 'Couldn’t copy automatically. Use “Copy only” and try again.', !ok);
  } else {
    setAiStatus(ok ? `Copied ${what} — paste it into any AI chat.` : 'Couldn’t copy automatically.', !ok);
  }
}

function cleanUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^utm_/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.toString();
  } catch { return ''; }
}
const sameUrl = (a, b) => {
  const n = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + decodeURIComponent(x.pathname).replace(/\/+$/, '') + x.search).toLowerCase(); } catch { return u; } };
  return n(a) === n(b);
};
function parseAiAnswer(text) {
  const out = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!line.includes('|') || !/(PAGE|FILE)\s*:/i.test(line)) continue;
    const parts = line.split('|').map((s) => s.trim());
    const name = parts[0].replace(/^[`"'*“”]+|[`"'*“”]+$/g, '').trim();
    const get = (k) => {
      const p = parts.find((x) => new RegExp(`^\\**${k}\\**\\s*:`, 'i').test(x));
      const m = p && p.match(/https?:\/\/[^\s<>()"'`\[\]]+/i);
      return m ? cleanUrl(m[0].replace(/[.,;:]+$/, '')) : '';
    };
    if (name) out.push({ name, page: get('PAGE'), file: get('FILE') });
  }
  return out;
}

// ---- the download helper's secret key: lets it fetch from any site while only you can use it ----
const KEY_STORE = 'instant-search:helperKey';
const keyOf = (u) => { try { return new URL(u).searchParams.get('key') || ''; } catch { return ''; } };
const withKey = (u, k) => { try { const x = new URL(u); x.searchParams.set('key', k); return x.toString(); } catch { return u; } };
function ensureHelperKey() {
  let k = keyOf(helper.get());
  if (!k) { try { k = localStorage.getItem(KEY_STORE) || ''; } catch {} }
  if (!k) {
    const a = new Uint8Array(20);
    crypto.getRandomValues(a);
    k = [...a].map((b) => (b % 36).toString(36)).join('');
  }
  try { localStorage.setItem(KEY_STORE, k); } catch {}
  return k;
}
let helperCode = null;
function loadHelperCode() {
  const key = ensureHelperKey();
  return fetch('helper/cloudflare-worker.js', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.text() : null))
    .then((code) => (helperCode = code
      ? code.replace(/const ALLOWED_SITES = \[[\s\S]*?\];/, "const ALLOWED_SITES = ['*'];").replace(/const ACCESS_KEY = '[^']*';/, `const ACCESS_KEY = '${key}';`)
      : null))
    .catch(() => null);
}
function copyHelperCode(btn) {
  const finish = (ok) => {
    if (ok) {
      // the address the app uses carries the key (an older helper simply ignores it)
      const key = ensureHelperKey();
      if (helper.get()) helper.set(withKey(helper.get(), key));
      btn.textContent = 'Copied ✓ Now paste it in Cloudflare';
      btn.classList.add('done');
    } else {
      btn.textContent = 'Couldn’t copy — try again';
    }
  };
  if (helperCode) finish(copyText(helperCode));
  else loadHelperCode().then((code) => finish(!!code && copyText(code)));
}
// ---- the download helper, set up step by step in its own window ----
// Sites like faa.gov don't let other websites download their files; a tiny free program on Cloudflare (the helper)
// fetches them for Findly. This walks a first-timer through it with the links, the code and a test built in.
const HELPER_STEP = 'instant-search:helperStep';
async function testHelper(v) {
  if (!v) return { ok: false, msg: 'Paste your helper’s address first.' };
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  let stored = '';
  try { stored = localStorage.getItem(KEY_STORE) || ''; } catch {}
  if (!keyOf(v) && stored) v = withKey(v, stored); // this device made the key: put it back on
  if (keyOf(v)) { try { localStorage.setItem(KEY_STORE, keyOf(v)); } catch {} }
  helper.set(v);
  try {
    const res = await fetch(v, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok || !/download helper/i.test(text)) {
      return { ok: false, url: v, msg: /hello world/i.test(text) ? 'That’s still Cloudflare’s Hello World. Go back a step: paste the helper code into the worker and press Deploy.' : 'Something answered, but it isn’t the helper. Check the address, and that you pasted the code and pressed Deploy.' };
    }
    if (/key (missing|wrong)/i.test(text)) return { ok: false, url: v, msg: 'The helper is running but this address is missing its key. Use the whole address from the device where you set it up (it ends in ?key=…), or copy the code again and re-deploy.' };
    try { localStorage.removeItem('instant-search:direct'); } catch {}
    return { ok: true, url: v, any: /any site/i.test(text) };
  } catch {
    return { ok: false, url: v, msg: 'Nothing answered at that address. It should look like https://findly-helper.yourname.workers.dev, and the worker needs to be deployed.' };
  }
}
function showHelperState(state) {
  const el = $('#helperState');
  if (!el) return;
  const st = state || (helper.get() ? 'set' : 'none');
  el.textContent = { ok: 'working ✓', set: 'set up', none: 'not set up', bad: 'not working' }[st] || '';
  el.className = st === 'ok' || st === 'set' ? 'ok' : st === 'bad' ? 'bad' : '';
  const btn = $('#helperOpen');
  if (btn) btn.textContent = st === 'none' ? 'Set up' : 'Manage';
}
function openHelper() {
  let d = $('#helperDlg');
  if (!d) {
    d = el('dialog', 'helper-dlg');
    d.id = 'helperDlg';
    document.body.append(d);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
  const STEPS = ['Account', 'Worker', 'Code', 'Connect', 'Done'];
  let step = helper.get() ? 4 : Math.min(3, Number(localStorage.getItem(HELPER_STEP) || 0));
  let result = null;
  const go = (n) => { step = Math.max(0, Math.min(4, n)); try { localStorage.setItem(HELPER_STEP, String(Math.min(step, 3))); } catch {} render(); };
  const ext = (href, label) => `<a class="btn hs-link" href="${href}" target="_blank" rel="noopener">${label}<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>`;
  const body = () => {
    if (step === 0) return `<h4>Make a free Cloudflare account</h4>
      <p>The helper runs on Cloudflare’s free plan. No card needed. If you already have an account, just sign in.</p>
      <div class="hs-acts">${ext('https://dash.cloudflare.com/sign-up', 'Create a free account')}${ext('https://dash.cloudflare.com/login', 'Sign in')}</div>
      <p class="hs-tip">Come back here when you see Cloudflare’s dashboard.</p>`;
    if (step === 1) return `<h4>Create the worker</h4>
      <ol class="hs-ol">
        <li>Open <b>Workers &amp; Pages</b> ${ext('https://dash.cloudflare.com/?to=/:account/workers-and-pages/create', 'Open it')}</li>
        <li>Choose <b>Start with Hello World!</b> (or <b>Create Worker</b>).</li>
        <li>Name it <code>findly-helper</code> <button type="button" class="btn sm" data-copyname>Copy name</button></li>
        <li>Press <b>Deploy</b>.</li>
      </ol>
      <p class="hs-tip">Cloudflare renames buttons now and then; pick the closest match.</p>`;
    if (step === 2) return `<h4>Put the helper’s code in it</h4>
      <ol class="hs-ol">
        <li><button type="button" class="btn primary" data-copycode>Copy helper code</button><br><span class="muted">It includes your own secret key, so only you can use your helper.</span></li>
        <li>In Cloudflare, on your new worker, press <b>Edit code</b>.</li>
        <li>Select everything in the editor (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>A</kbd>), paste over it, and press <b>Deploy</b>.</li>
      </ol>`;
    if (step === 3) return `<h4>Connect Findly to it</h4>
      <p>Copy your worker’s address from Cloudflare (on the worker’s page, under <b>Domains</b> or next to <b>Visit</b>). It ends in <code>.workers.dev</code>.</p>
      <div class="hs-url"><input id="helperUrl" type="url" inputmode="url" placeholder="https://findly-helper.yourname.workers.dev" autocomplete="off" spellcheck="false" value="${esc(helper.get() || '')}"><button type="button" class="btn" data-pasteurl>Paste</button></div>
      <button type="button" class="btn primary hs-test" data-test>Test it</button>
      <p class="hs-result${result ? (result.ok ? ' ok' : ' bad') : ''}">${result ? esc(result.ok ? 'Working ✓' : result.msg) : ''}</p>`;
    return `<div class="hs-done ${result?.ok === false ? 'bad' : ''}"><span class="hs-check">${result?.ok === false ? '!' : '✓'}</span>
        <h4>${result?.ok === false ? 'Your helper isn’t answering' : 'Your download helper is set up'}</h4>
        <p>${result?.ok === false ? esc(result.msg) : 'Findly can now add documents from any website, including faa.gov, and check them for updates.'}${result?.ok && !result.any ? ' <b>It only allows the sites listed in it:</b> copy the code again (step 3) and re-deploy to allow any site.' : ''}</p></div>
      <div class="hs-box"><b>Using Findly on another device?</b><p>Copy this address there: Add from a web link › Download helper › Manage › Connect.</p>
        <div class="hs-url"><input readonly value="${esc(helper.get() || '')}"><button type="button" class="btn" data-copyurl>Copy</button></div></div>
      <div class="hs-acts"><button type="button" class="btn" data-test>Test again</button><button type="button" class="btn" data-goto="2">Update the code</button><button type="button" class="btn" data-goto="3">Change address</button></div>`;
  };
  const render = () => {
    d.innerHTML = `<header class="hs-head"><h3>Download helper</h3><button class="icon-btn sm" data-x aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button></header>
      <ol class="hs-steps">${STEPS.map((n, i) => `<li><button type="button" data-goto="${i}" class="${i < step ? 'done' : i === step ? 'on' : ''}" ${i === 4 && !helper.get() ? 'disabled' : ''}><i>${i < step ? '✓' : i + 1}</i><span>${n}</span></button></li>`).join('')}</ol>
      <div class="hs-body">${body()}</div>
      <footer class="hs-foot">${step > 0 && step < 4 ? '<button type="button" class="btn" data-back>Back</button>' : '<span></span>'}${step < 3 ? '<button type="button" class="btn primary" data-next>I’ve done this · Next</button>' : step === 4 ? '<button type="button" class="btn primary" data-x>Done</button>' : '<span></span>'}</footer>`;
    if (step === 3) setTimeout(() => d.querySelector('#helperUrl')?.focus(), 50);
  };
  d.onclick = async (e) => {
    const t = e.target;
    if (t === d || t.closest('[data-x]')) { d.close(); return; }
    const g = t.closest('[data-goto]');
    if (g && !g.disabled) { result = null; go(Number(g.dataset.goto)); return; }
    if (t.closest('[data-next]')) return go(step + 1);
    if (t.closest('[data-back]')) return go(step - 1);
    if (t.closest('[data-copyname]')) { copyText('findly-helper'); t.closest('button').textContent = 'Copied ✓'; return; }
    if (t.closest('[data-copycode]')) return copyHelperCode(t.closest('button'));
    if (t.closest('[data-copyurl]')) { copyText(helper.get()); t.closest('button').textContent = 'Copied ✓'; return; }
    if (t.closest('[data-pasteurl]')) { try { d.querySelector('#helperUrl').value = (await navigator.clipboard.readText()).trim(); } catch { d.querySelector('#helperUrl').focus(); } return; }
    if (t.closest('[data-test]')) {
      const b = t.closest('button');
      b.disabled = true;
      b.textContent = 'Testing…';
      const v = step === 3 ? d.querySelector('#helperUrl').value.trim() : helper.get();
      result = await testHelper(v);
      showHelperState(result.ok ? 'ok' : 'bad');
      if (result.ok) { try { localStorage.removeItem(HELPER_STEP); } catch {} step = 4; }
      render();
    }
  };
  d.onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'helperUrl') { e.preventDefault(); d.querySelector('[data-test]')?.click(); } };
  loadHelperCode();
  render();
  if (!d.open) d.showModal();
}

function helperFixHtml(hosts, picks) {
  const list = hosts.map((h) => `<b>${esc(h)}</b>`).join(', ');
  return `<span class="helper-fix"><b>Your download helper doesn’t allow ${list} yet</b>, so ${picks ? 'some of these' : 'these'} couldn’t be downloaded. Update it once and it can download from any site, protected by your own secret key:
    <ol><li><button type="button" class="btn sm" data-copyhelper>Copy the updated helper code</button></li>
    <li>Open <a href="https://dash.cloudflare.com" target="_blank" rel="noopener">Cloudflare</a> → <b>Workers &amp; Pages</b> → your helper → <b>Edit code</b>. Select everything in the editor, paste, and click <b>Deploy</b>.</li>
    <li>Come back and press <b>Try again</b>${picks ? ' in Find documents with AI' : ''}.</li></ol>
    <em>Your key is saved in the helper address. To use the helper on another device, open <b>Download helper › Manage</b> in the web link window and copy the address.</em></span>`;
}
async function linkWithAi() {
  const items = parseAiAnswer($('#aiAnswer').value);
  if (!items.length) {
    setAiStatus('Couldn’t find any answer lines in that. Paste the AI’s whole code block — lines look like <i>name | PAGE: … | FILE: …</i>', true);
    return;
  }
  const norm = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9]+/g, '');
  const pool = S.docs.filter((d) => !d.status);
  const rows = [];
  const groups = { ok: [], warn: [], bad: [], unsure: [], already: [], missing: [], fresh: [], freshBad: [], blocked: [] };
  // the download helper refuses sites that aren't in its list: collect them for one clear fix
  const blocked = new Set();
  const blockedBy = (err) => {
    const m = String(err?.message || '').match(/set up to fetch from ([a-z0-9.-]+)/i);
    if (m) blocked.add(m[1].replace(/\.+$/, '').replace(/^www\./, ''));
    return !!m;
  };
  const jobs = [];
  const newJobs = [];
  const used = new Set();
  for (const it of items) {
    const d = pool.find((x) => x.name === it.name && !used.has(x)) || pool.find((x) => norm(x.name) === norm(it.name) && !used.has(x));
    if (!d) {
      if (it.file || it.page) newJobs.push(it);
      else groups.unsure.push({ info: true, title: it.name, detail: 'No link given.' });
      continue;
    }
    used.add(d);
    if (d.source) { groups.already.push({ info: true, title: d.name, detail: `Already linked to ${esc(d.source.page || d.source.url)}` }); continue; }
    if (!it.page && !it.file) { groups.unsure.push({ info: true, title: d.name, detail: 'The AI couldn’t find a reliable source, so it’s left as is.' }); continue; }
    jobs.push({ d, ...it });
  }
  $('#linkDlg').close();
  const total = jobs.length + newJobs.length;
  libStatus.show(`Checking ${plural(total, 'link')}`, 0);
  const pages = new Map();
  const readPage = (url) => {
    if (!pages.has(url)) pages.set(url, (async () => {
      const { res, finalUrl } = await remoteFetch(url);
      if (!res.ok) throw new Error(`the page answered ${res.status}`);
      return documentLinks(await res.text(), finalUrl || url);
    })());
    return pages.get(url);
  };
  // Which link on a page is this file? By name, then by its opening words (titles are usually on page 1),
  // then by exact file size.
  const sizes = new Map();
  const words = (x) => String(x || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w));
  const findOnPage = async (pageUrl, links, d) => {
    const me = { text: d.name, url: 'https://x/' + encodeURIComponent(d.name), size: d.size };
    const best = links.map((l) => ({ l, s: linkSimilarity(me, { text: l.text, url: l.url }) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= SAME_DOC_SCORE) return best.l;
    const opening = new Set(words(((S.texts.get(d.id) || []).find((p) => p.trim()) || '').slice(0, 600)));
    const byText = links.map((l) => {
      const w = [...new Set(words(l.text))].filter((x) => !['pdf', 'kb', 'mb', 'the', 'of', 'and'].includes(x));
      return { l, n: w.length, s: w.length ? w.filter((x) => opening.has(x)).length / w.length : 0 };
    }).filter((x) => x.n >= 2 && x.s >= 0.8).sort((a, b) => b.s - a.s || b.n - a.n);
    if (byText.length && (byText.length === 1 || byText[0].s > byText[1].s || byText[0].n > byText[1].n)) return byText[0].l;
    if (!d.size) return null;
    if (!sizes.has(pageUrl)) sizes.set(pageUrl, (async () => {
      const m = new Map();
      await Promise.all(links.slice(0, 80).map(async (l) => { try { m.set(l, (await remoteInfo(l.url)).size); } catch {} }));
      return m;
    })());
    const m = await sizes.get(pageUrl);
    return links.find((l) => m.get(l) === d.size) || null;
  };
  let done = 0;
  const check = async (job) => {
    const { d } = job;
    let page = job.page;
    let file = job.file;
    if (page && looksLikeDocument(page) && !file) { file = page; page = ''; }
    let link = null;
    let pageInfo = null;
    let pageNote = '';
    if (page) {
      try {
        pageInfo = await readPage(page);
        link = file && pageInfo.links.find((l) => sameUrl(l.url, file));
        if (link && d.size) {
          // the AI picked a link on the page; if another link there is clearly this file, use that one
          const alt = await findOnPage(page, pageInfo.links, d);
          if (alt && alt.url !== link.url) {
            try {
              const [a, b] = await Promise.all([remoteInfo(link.url), remoteInfo(alt.url)]);
              if (b.size === d.size && a.size !== d.size) { link = alt; pageNote = 'the AI picked another file on that page, so the matching one was used'; }
            } catch {}
          }
        }
        if (!link) link = await findOnPage(page, pageInfo.links, d);
        if (!link) pageNote = file ? 'the page doesn’t list this file, so only the file is linked' : '';
      } catch (err) {
        pageNote = `couldn’t open its page (${esc(helperProblem(err))})`;
        pageInfo = null;
      }
    }
    const url = link?.url || file;
    if (!url) { groups.bad.push({ info: true, tone: 'warn', title: d.name, detail: `Not linked — ${pageNote || 'no download link for this file on that page'}.` }); return; }
    let info;
    try {
      info = await remoteInfo(url);
      if (info.status >= 400) throw new Error(`the site answered ${info.status}`);
      if (d.kind !== 'html' && info.type === 'text/html') throw new Error('the link opens a web page, not the document');
    } catch (err) {
      if (blockedBy(err)) { groups.blocked.push(d.name); return; }
      groups.bad.push({ info: true, tone: 'warn', title: d.name, detail: `Not linked — ${esc(helperProblem(err))}` });
      return;
    }
    const owner = S.docs.find((o) => o !== d && o.source && sameUrl(o.source.url, url));
    if (owner) { groups.bad.push({ info: true, tone: 'warn', title: d.name, detail: `Not linked — “${esc(owner.name)}” already follows that link.` }); return; }
    const same = d.size && info.size && d.size === info.size;
    const odd = !same && d.size && info.size && (info.size < d.size * 0.4 || info.size > d.size * 2.5);
    const watchPage = link && pageInfo ? page : '';
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    const bits = [
      `<b>${esc(host)}</b>`,
      link?.text && `“${esc(link.text)}”${link.note ? ` (${esc(link.note)})` : ''}`,
      same ? 'same file as yours ✓'
        : odd ? `<b>very different size — ${fmtSize(info.size)} vs your ${fmtSize(d.size)}; may not be the same document</b>`
        : info.size && d.size ? `the site’s copy is ${fmtSize(info.size)}, yours ${fmtSize(d.size)} — ↻ will offer the site’s version` : '',
      watchPage && 'its page will be watched for new editions',
      pageNote,
    ].filter(Boolean);
    const row = {
      kind: 'ailink', doc: d, page: watchPage, links: pageInfo?.links || [], pageTitle: pageInfo?.title || '',
      // a matching file keeps the site's version tags; a different one is checked properly on the next ↻
      source: { url, linkText: link?.text || '', note: link?.note || '', page: watchPage, etag: same ? info.etag : '', lastModified: same ? info.lastModified : '', size: same ? info.size : d.size || 0, checkedAt: Date.now() },
      checked: !odd, tone: odd ? 'warn' : same ? 'up' : '', title: d.name, detail: bits.join(' · '),
    };
    (odd ? groups.warn : groups.ok).push(row);
  };
  // a document you don't have yet
  const checkNew = async (it) => {
    let page = it.page;
    let file = it.file;
    if (page && looksLikeDocument(page) && !file) { file = page; page = ''; }
    let link = null;
    let pageInfo = null;
    if (page) {
      try {
        pageInfo = await readPage(page);
        link = (file && pageInfo.links.find((l) => sameUrl(l.url, file))) || null;
        if (!link && !file) {
          const best = pageInfo.links.map((l) => ({ l, s: linkSimilarity({ text: it.name, url: 'https://x/' + encodeURIComponent(it.name) }, { text: l.text, url: l.url }) })).sort((a, b) => b.s - a.s)[0];
          if (best && best.s >= SAME_DOC_SCORE) link = best.l;
        }
      } catch { pageInfo = null; }
    }
    const url = link?.url || file;
    const bad = (why) => groups.freshBad.push({ info: true, tone: 'warn', title: it.name, detail: `Not added — ${why}` });
    if (!url) return bad('no download link.');
    const owner = S.docs.find((o) => o.source && sameUrl(o.source.url, url));
    if (owner) { groups.already.push({ info: true, title: it.name, detail: `Already in your library as “${esc(owner.name)}”.` }); return; }
    let info;
    try {
      info = await remoteInfo(url);
      if (info.status >= 400) throw new Error(`the site answered ${info.status}`);
      if (info.type === 'text/html' || !looksLikeDocument(info.finalUrl || url, info.type)) throw new Error('the link opens a web page, not a downloadable document');
    } catch (err) {
      if (blockedBy(err)) { groups.blocked.push(it.name); return; }
      return bad(esc(helperProblem(err)));
    }
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    const watchPage = link && pageInfo ? page : '';
    groups.fresh.push({
      kind: 'ainew', at: newJobs.indexOf(it), name: it.name, url, link, page: watchPage, links: pageInfo?.links || [], pageTitle: pageInfo?.title || '', remote: info,
      checked: aiMode === 'new', tone: 'up', title: it.name,
      detail: [`<b>${esc(host)}</b>`, fmtSize(info.size), esc(fileNameFor(url)), watchPage && 'its page will be watched for new editions'].filter(Boolean).join(' · '),
    });
  };
  let i = 0;
  const all = [...jobs.map((j) => () => check(j)), ...newJobs.map((j) => () => checkNew(j))];
  const worker = async () => {
    while (i < all.length) {
      await all[i++]();
      done++;
      libStatus.show(`Checking links · ${done} of ${total}`, done / total);
    }
  };
  try { await Promise.all([worker(), worker(), worker(), worker()]); } finally { libStatus.hide(); }

  // two of your files on the same link: keep the one that's the same file (or the first), set the others aside
  const byUrl = new Map();
  for (const r of groups.ok.concat(groups.warn)) (byUrl.get(r.source.url) || byUrl.set(r.source.url, []).get(r.source.url)).push(r);
  for (const list of byUrl.values()) {
    if (list.length < 2) continue;
    const keep = list.find((r) => r.tone === 'up') || list.find((r) => r.checked) || list[0];
    for (const r of list) {
      if (r === keep) continue;
      groups.ok = groups.ok.filter((x) => x !== r);
      groups.warn = groups.warn.filter((x) => x !== r);
      r.checked = false;
      r.tone = 'warn';
      r.detail += ` · <b>same link as “${esc(keep.doc.name)}” — only one file can follow a link</b>`;
      groups.warn.push(r);
    }
  }
  groups.fresh.sort((a, b) => a.at - b.at); // keep the AI's order (Part 1, Part 61, Part 91…)
  const seenNew = new Set();
  groups.fresh = groups.fresh.filter((r) => !seenNew.has(r.url) && !byUrl.has(r.url) && seenNew.add(r.url));
  const dest = $('#aiDest').value;
  const destName = dest === 'new' ? ($('#aiDestName').value.trim() || 'New folder') : dest ? folderById(dest)?.name : '';
  const sec = (header, list) => { if (list.length) rows.push({ header }, ...list); };
  if (groups.blocked.length) {
    const names = groups.blocked.slice(0, 5).map(esc).join(', ') + (groups.blocked.length > 5 ? `, and ${fmt(groups.blocked.length - 5)} more` : '');
    rows.push({ header: 'Waiting on your download helper' }, { info: true, tone: 'warn', title: `${plural(groups.blocked.length, 'document')} from ${[...blocked].join(', ')}`, detail: names });
    loadHelperCode();
  }
  sec(destName ? `New documents → “${destName}”` : 'New documents', groups.fresh);
  sec('Couldn’t add these', groups.freshBad);
  sec('Ready to link', groups.ok);
  sec('Check these first', groups.warn);
  sec('Couldn’t use these links', groups.bad);
  sec('The AI wasn’t sure', groups.unsure);
  sec('Already linked', groups.already);
  sec('Not in your library', groups.missing);
  const picks = groups.ok.length + groups.warn.length + groups.fresh.length;
  const linking = groups.ok.length + groups.warn.length;
  const res = await review({
    title: !picks ? (groups.blocked.length ? 'Your download helper needs one update' : 'No links to use') : groups.fresh.length && !linking ? 'Add these documents' : linking && !groups.fresh.length ? 'Link these files' : 'Add and link',
    intro: (groups.blocked.length ? helperFixHtml([...blocked], picks) : '') + (picks ? `Every link below was opened and checked. ${groups.fresh.length ? 'Ticked new documents are downloaded and kept up to date. ' : ''}${linking ? 'Ticked files of yours get linked; your copies stay as they are until you press ↻ to check for updates.' : ''}` : groups.blocked.length ? '' : 'None of the links could be used. The details are below.'),
    rows,
    options: picks && groups.ok.concat(groups.warn, groups.fresh).some((r) => r.page) ? [{ id: 'watch', label: 'Also watch their pages, to catch editions published under a new file name and new documents', checked: true }] : [],
    alwaysApply: !picks && groups.blocked.length > 0,
    apply: !picks ? (groups.blocked.length ? 'Try again' : 'OK') : groups.fresh.length && !linking ? 'Add' : linking && !groups.fresh.length ? 'Link' : 'Add and link',
  });
  if (res && !picks && groups.blocked.length) { setTimeout(() => linkWithAi(), 50); return; }
  if (!res || !picks) return;
  const freshPicked = rows.filter((r) => r.kind === 'ainew' && res.picked.has(r));
  let destId = null;
  if (freshPicked.length) {
    if (dest === 'new') destId = createFolder(destName).id;
    else if (dest && folderById(dest)) destId = dest;
  }
  const seenUrl = new Set();
  const picked = rows.filter((r) => r.kind === 'ailink' && res.picked.has(r) && !seenUrl.has(r.source.url) && seenUrl.add(r.source.url));
  const watch = !!res.options.watch;
  for (const r of picked) r.doc.source = { ...r.source, page: watch ? r.page : '' };
  for (const r of freshPicked) addRemote(r.url, { folderId: destId, linkText: r.link?.text || r.name, note: r.link?.note || '', page: watch ? r.page : '', info: { size: r.remote.size, type: r.remote.type } });
  if (watch) {
    const byPage = new Map();
    for (const r of picked) if (r.page) (byPage.get(r.page) || byPage.set(r.page, []).get(r.page)).push({ ...r, folderId: r.doc.folderId || '' });
    for (const r of freshPicked) if (r.page) (byPage.get(r.page) || byPage.set(r.page, []).get(r.page)).push({ ...r, folderId: destId || '' });
    for (const [url, list] of byPage) {
      if (S.folders.some((f) => f.source?.url === url) || S.watch.some((w) => w.url === url)) continue;
      // documents already on the page that you don't have aren't offered as "new" later; only ones added after today
      const linked = new Set(S.docs.filter((d) => d.source).map((d) => d.source.url));
      const src = { url, title: list[0].pageTitle, ignored: list[0].links.map((l) => l.url).filter((u) => !linked.has(u)), checkedAt: Date.now() };
      const fids = [...new Set(list.map((r) => r.folderId))];
      const f = fids.length === 1 && fids[0] && folderById(fids[0]);
      // a folder follows a page only if none of its documents are linked on their own (a watched folder counts those as its own)
      if (f && !f.source && !S.docs.some((d) => d.folderId === f.id && d.source && !d.source.page)) f.source = src;
      else S.watch.push(src);
    }
    saveFolders();
    saveWatch();
  }
  await store.updateDocs(picked.map((r) => stripMeta(r.doc))).catch(() => {});
  renderLibrary();
  if (groups.blocked.length) toast(`${plural(groups.blocked.length, 'document')} still waiting on your download helper. After updating it, open Find documents with AI and press Check & add again — your answer is still there.`, { ms: 9000 });
  toast([freshPicked.length && `Adding ${plural(freshPicked.length, 'document')}`, picked.length && `linked ${plural(picked.length, 'file')}`].filter(Boolean).join(' · ').replace(/^l/, 'L') + '. Press ↻ next to Library any time to check for updates.', { ms: 6000 });
}

async function newerEdition(url) {
  const years = [...new Set(String(url).match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) || [])];
  if (years.length !== 1) return null;
  const y = Number(years[0]);
  const now = new Date().getFullYear();
  for (let n = Math.min(now + 1, y + 3); n > y; n--) {
    const cand = url.split(years[0]).join(String(n));
    try {
      const info = await remoteInfo(cand);
      if (info.status < 400 && info.type !== 'text/html' && looksLikeDocument(info.finalUrl || cand, info.type)) return { url: cand, year: n };
    } catch {}
  }
  return null;
}

// ---------- checking linked sources for updates ----------
let checking = false;
async function checkSources({ docIds = null, folderIds = null, quiet = false } = {}) {
  if (checking) { toast('Already checking — one moment'); return; }
  const all = !docIds && !folderIds;
  const watchers = [
    ...S.folders.filter((f) => f.source && (all || folderIds?.includes(f.id))).map((f) => ({
      name: f.name, src: f.source, folderId: f.id,
      members: (d) => d.source?.page === f.source.url || (d.folderId === f.id && d.source && !d.source.page),
    })),
    ...(all ? S.watch : []).map((w) => ({ name: pageTitle(w), src: w, folderId: null, members: (d) => d.source?.page === w.url })),
  ];
  const folders = watchers; // (kept for the summary below)
  const covered = new Set();
  const jobs = [];      // { doc, url, link? }
  const rows = [];
  const add = (header, row) => { if (!rows.some((r) => r.header === header)) rows.push({ header }); rows.splice(lastIndexOfHeader(header) + 1, 0, row); };
  const lastIndexOfHeader = (header) => {
    let i = rows.findIndex((r) => r.header === header);
    while (i + 1 < rows.length && !rows[i + 1].header) i++;
    return i;
  };
  let upToDate = 0;
  let failures = 0;
  checking = true;
  $('#checkAllBtn').classList.add('spin');
  const status = (msg, frac) => libStatus.show(msg, frac);
  status('Checking for updates…');

  try {
    // pages that list documents: find new, renamed and removed ones
    for (const w of watchers) {
      status('Checking for updates · reading linked pages');
      try {
        const { res, finalUrl } = await remoteFetch(w.src.url);
        if (!res.ok) throw new Error(`the page answered ${res.status}`);
        const { links } = documentLinks(await res.text(), finalUrl || w.src.url);
        const inFolder = S.docs.filter((d) => w.members(d) && d.source && !d.status);
        const matched = new Set();
        const fresh = [];
        for (const l of links) {
          let d = inFolder.find((x) => x.source.url === l.url);
          if (d) { matched.add(d); jobs.push({ doc: d, url: l.url, link: l }); continue; }
          if ((w.src.ignored || []).includes(l.url)) continue;
          fresh.push(l);
        }
        // Sites often publish a new version under a new file name and a slightly different title
        // ("…Basic with Change 1, 2 and 3" -> "…Basic with Change 1"). Pair each vanished document with the
        // new link that looks most like it; the page-count/size check after downloading guards against mistakes.
        const gone = inFolder.filter((x) => !matched.has(x) && !links.some((k) => k.url === x.source.url));
        if (gone.length && fresh.length) await fillSizes(fresh);
        const pairs = [];
        for (const d of gone) {
          for (const l of fresh) {
            const exact = (d.source.linkText && linkKey(d.source.linkText) === linkKey(l.text)) || editionKey(fileNameFor(d.source.url)) === editionKey(fileNameFor(l.url));
            const score = exact ? 2 : linkSimilarity({ text: d.source.linkText || d.name, url: d.source.url, size: d.size }, { text: l.text, url: l.url, size: l.shownSize });
            if (score >= SAME_DOC_SCORE) pairs.push({ d, l, score });
          }
        }
        pairs.sort((a, b) => b.score - a.score);
        const pairedLinks = new Set();
        for (const { d, l } of pairs) {
          if (matched.has(d) || pairedLinks.has(l)) continue;
          matched.add(d);
          pairedLinks.add(l);
          jobs.push({ doc: d, url: l.url, link: l, renamed: true });
        }
        for (const l of fresh) {
          if (pairedLinks.has(l)) continue;
          add('New on the page', { kind: 'new', watch: w, link: l, checked: !l.parent, tone: 'up', title: l.text, detail: `${[fmtSize(l.shownSize), l.note].filter(Boolean).join(' · ')} · ${esc(fileNameFor(l.url))}` });
        }
        for (const d of inFolder) {
          if (!matched.has(d)) { add('No longer on the page', { info: true, title: d.name, detail: 'Kept in your library. The site may have moved or retired it.' }); covered.add(d); }
        }
        inFolder.forEach((d) => covered.add(d));
        w.src.checkedAt = Date.now();
      } catch (err) {
        failures++;
        add('Couldn’t check', { info: true, tone: 'warn', title: w.name, detail: esc(helperProblem(err)) });
        S.docs.filter((d) => w.members(d)).forEach((d) => covered.add(d));
      }
    }
    // single linked documents
    for (const d of S.docs) {
      if (!d.source || d.status || covered.has(d) || jobs.some((j) => j.doc === d)) continue;
      if (!all && !docIds?.includes(d.id) && !folderIds?.includes(d.folderId)) continue;
      jobs.push({ doc: d, url: d.source.url });
    }

    let n = 0;
    for (const job of jobs) {
      n++;
      const d = job.doc;
      status(`Checking for updates · ${n} of ${jobs.length}`, (n - 1) / jobs.length);
      try {
        // files with the year in their address (like govinfo's yearly CFR editions): look for a newer year
        if (!job.renamed && !job.link && !d.source.page) {
          const newer = await newerEdition(job.url);
          if (newer) { job.url = newer.url; job.renamed = true; job.edition = newer.year; }
        }
        if (!job.renamed) {
          const { changed, info } = await remoteChanged(job.url, d.source);
          if (info?.status >= 400) throw new Error(`the site answered ${info.status}`);
          if (changed === false) { upToDate++; d.source.checkedAt = Date.now(); continue; }
        }
        status(`Downloading updates · ${n} of ${jobs.length}`, (n - 0.5) / jobs.length);
        const dl = await download(job.url);
        if (d.kind !== 'html' && dl.info.type === 'text/html') throw new Error('the link now opens a web page instead of the document');
        const { pages, bytes } = await readFile(new File([dl.bytes], fileNameFor(dl.info.finalUrl || job.url, dl.info.type), { type: dl.info.type }));
        const c = compareVersions(d, pages, dl.info.size);
        const source = { ...d.source, url: job.url, linkText: job.link?.text || d.source.linkText, note: job.link?.note || d.source.note, etag: dl.info.etag, lastModified: dl.info.lastModified, size: dl.info.size, checkedAt: Date.now() };
        if (c.same) { upToDate++; d.source = source; continue; }
        // a renamed document takes its new title (unless it was named some other way)
        const newName = job.renamed && job.link?.text && d.source.linkText && d.name === nameFromLink(d.source.linkText, d.source.url, '')
          ? nameFromLink(job.link.text, job.url, dl.info.type) : undefined;
        add(c.suspicious ? 'Looks wrong — check before updating' : 'Updated on the site', {
          kind: 'update', doc: d, payload: { pages, bytes, size: dl.info.size, source, name: newName }, checked: !c.suspicious, tone: c.suspicious ? 'warn' : 'up',
          title: d.name,
          detail: `${c.detail}${job.edition ? ` · ${job.edition} edition` : job.renamed ? ` · now “${esc(job.link?.text || fileNameFor(job.url))}”${job.link?.note ? ` (${esc(job.link.note)})` : ''}, new file ${esc(fileNameFor(job.url))}` : ''}${c.suspicious ? ` — ${c.reasons.join(', ')}` : ''}`,
        });
      } catch (err) {
        failures++;
        add('Couldn’t check', { info: true, tone: 'warn', title: d.name, detail: esc(helperProblem(err)) });
      }
    }
    // sizes for newly listed documents
    const fresh = rows.filter((r) => r.kind === 'new');
    if (fresh.length) {
      status('Checking for updates · almost done', 0.97);
      await fillSizes(fresh.map((r) => r.link));
      for (const r of fresh) r.detail = `${fmtSize(r.link.shownSize) || 'size unknown'} · ${esc(fileNameFor(r.link.url))}`;
    }
  } catch (e) {
    libStatus.hide();
    throw e;
  } finally {
    checking = false;
    $('#checkAllBtn').classList.remove('spin');
    saveFolders();
    saveWatch();
    store.updateDocs(S.docs.filter((d) => d.source && !d.status).map(stripMeta)).catch(() => {});
    renderLibrary();
  }

  const actionable = rows.filter((r) => r.kind);
  if (!actionable.length && !rows.length) {
    libStatus.done(jobs.length || folders.length ? `Everything is up to date · ${plural(upToDate, 'document')} checked` : 'Nothing linked to check yet');
    return;
  }
  if (quiet && !actionable.length && !failures) { libStatus.done(`Everything is up to date · ${plural(upToDate, 'document')} checked`); return; }
  libStatus.hide();
  if (upToDate) rows.push({ header: 'Up to date' }, { info: true, title: plural(upToDate, 'document'), detail: 'No changes on the site.' });
  const res = await review({
    title: actionable.length ? 'Updates found' : 'Check finished',
    intro: actionable.length ? 'Ticked items will be applied. Anything that looks wrong is left unticked so you can decide.' : '',
    rows,
    options: rows.some((r) => r.kind === 'update') ? [{ id: 'keep', label: 'Keep the old versions too (as “(previous)”, left out of searches)' }] : [],
    apply: 'Apply',
  });
  if (!res) return;
  let updated = 0;
  for (const r of rows) {
    if (r.kind === 'update' && res.picked.has(r)) { await replaceDoc(r.doc, r.payload, res.options.keep); updated++; }
    if (r.kind === 'new') {
      if (res.picked.has(r)) addRemote(r.link.url, { folderId: r.watch.folderId, linkText: r.link.text, note: r.link.note, page: r.watch.src.url, info: { size: r.link.shownSize } });
      else (r.watch.src.ignored ||= []).push(r.link.url); // don't suggest it again
    }
  }
  saveFolders();
  saveWatch();
  runSearch({ keepScroll: true });
  updateStorage();
  const added = rows.filter((r) => r.kind === 'new' && res.picked.has(r)).length;
  if (updated || added) libStatus.done([updated && `Updated ${plural(updated, 'document')}`, added && `adding ${plural(added, 'new document')}`].filter(Boolean).join(' · '), 3500);
}

// ---------- removing things: pick folders, documents or everything, then confirm ----------
// ---------- backup ----------
// One file with everything (documents, folders, linked pages, boards, themes, settings, shortcuts, helper),
// to save to Files and import on another device.
// How often linked documents are checked for newer editions: every N days, weeks or months.
const CHECK_UNITS = { day: 864e5, week: 7 * 864e5, month: 30.44 * 864e5 };
const checkEvery = () => ({ n: Math.max(1, Math.min(99, Number(prefs.checkN) || 1)), unit: CHECK_UNITS[prefs.checkUnit] ? prefs.checkUnit : 'day' });
function checkEveryText() {
  const { n, unit } = checkEvery();
  if (n === 1) return unit === 'day' ? 'Once a day' : unit === 'week' ? 'Once a week' : 'Once a month';
  return `Every ${n} ${unit}s`;
}
// due a few hours early, so opening the app at a slightly earlier time of day still counts
const checkDue = () => { const { n, unit } = checkEvery(); return Date.now() - (prefs.lastAutoCheck || 0) > n * CHECK_UNITS[unit] - 4 * 3600e3; };

// ---------- settings: one tidy sheet for everything that isn't searching or reading ----------
function openSettings() {
  closeMenu();
  let d = $('#settingsDlg');
  if (!d) {
    d = el('dialog', 'set-dlg');
    d.id = 'settingsDlg';
    document.body.append(d);
    d.addEventListener('click', (e) => { if (e.target === d) shut(); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });
  }
  function shut() {
    if (!d.open || d.classList.contains('closing')) return;
    d.classList.add('closing');
    setTimeout(() => { d.classList.remove('closing'); d.close(); }, 180);
  }
  const chev = '<svg class="set-chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
  const row = (id, icon, label, sub = '', end = chev, cls = '') => `<button type="button" class="set-row ${cls}" data-s="${id}"><span class="set-ic">${icon}</span><span class="set-t"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>${end}</button>`;
  const sw = (on) => `<span class="set-sw${on ? ' on' : ''}" aria-hidden="true"><i></i></span>`;
  const group = (title, rows) => rows.filter(Boolean).length ? `<section><h4>${title}</h4><div class="set-group">${rows.filter(Boolean).join('')}</div></section>` : '';
  const palette = '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.9 1.2-1.8l-.4-.9c-.5-1.1.3-2.3 1.5-2.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15.5" cy="7.5" r="1.2"/></svg>';
  const refresh = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/></svg>';
  const cloud = '<svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 9.5a4.2 4.2 0 0 1-.5 8.5z"/></svg>';
  const help = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4M12 17h.01"/></svg>';
  const keys = '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/></svg>';
  const bolt = '<svg viewBox="0 0 24 24"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/></svg>';
  const disk = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>';
  const render = () => {
    const linked = hasSources();
    // already open: swap only the rows, so the sheet doesn't replay its entrance or lose its scroll
    const open = d.open && d.querySelector('.set-body');
    const keepY = open ? open.scrollTop : 0;
    const html = `<div class="set-sheet" tabindex="-1" autofocus>
      <i class="set-grab" aria-hidden="true"></i>
      <header class="set-head"><h3>Settings</h3><button class="icon-btn sm" data-s="x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button></header>
      <div class="set-body">
        ${group('Appearance', [
          row('theme', palette, 'Reading theme', 'Colours, paper, accent, transparency and blur'),
        ])}
        ${group('Reading', [
          `<div class="set-row static"><span class="set-ic"><svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="10" rx="2"/><path d="M9 3.5h6M9 20.5h6"/></svg></span><span class="set-t"><b>Opening cropped pages</b><small>${prefs.expand === 'drag' ? 'Drag the bars on a cropped page to pull it open' : 'Tap the arrows on a cropped page to open it'}</small></span><span class="seg small set-seg"><button type="button" data-s="xb" aria-pressed="${prefs.expand !== 'drag'}">Buttons</button><button type="button" data-s="xd" aria-pressed="${prefs.expand === 'drag'}">Drag</button></span></div>`,
          `<div class="set-row static"><span class="set-ic">${I.undo}</span><span class="set-t"><b>Undo &amp; redo</b><small>${prefs.undoStyle === 'buttons' ? 'Arrows at both ends of the bottom bar' : 'Swipe the bottom bar: right to undo, left to redo'}</small></span><span class="seg small set-seg"><button type="button" data-s="ug" aria-pressed="${prefs.undoStyle !== 'buttons'}">Gestures</button><button type="button" data-s="ub" aria-pressed="${prefs.undoStyle === 'buttons'}">Buttons</button></span></div>`,
        ])}
        ${group('Documents from websites', [
          row('helper', bolt, 'Download helper', helper.get() ? 'Set up' : 'Not set up · needed for sites like faa.gov'),
          linked && row('check', refresh, 'Check for updates now', 'Looks for newer editions of linked documents'),
          row('auto', refresh, 'Check automatically', prefs.autoCheck ? `${checkEveryText()}, when you open the app` : 'Off', sw(prefs.autoCheck)),
          `<div class="set-row static set-every"${prefs.autoCheck ? '' : ' hidden'}><span class="set-ic"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></span><span class="set-t"><b>How often</b></span><span class="stepper set-step"><button type="button" data-s="cn-" aria-label="Less often">${I.minus}</button><output>${checkEvery().n}</output><button type="button" data-s="cn+" aria-label="More">${I.plus}</button></span><span class="seg small set-seg set-units">${['day', 'week', 'month'].map((u) => `<button type="button" data-s="cu-${u}" aria-pressed="${checkEvery().unit === u}">${u[0].toUpperCase() + u.slice(1)}${checkEvery().n === 1 ? '' : 's'}</button>`).join('')}</span></div>`,
        ])}
        ${group('Sync & backup', [
          platform === 'ios' && row('cloud', cloud, 'iCloud sync', cloudOn ? 'On · your Apple devices share one library' : 'Keep iPhone, iPad and Mac in step', sw(cloudOn)),
          platform === 'windows' && row('folder', I.folder, 'Library folder', cloudOn ? 'In iCloud Drive · syncing' : 'Choose where your documents live'),
          platform === 'windows' && row('reveal', I.out, 'Show library folder', 'Open it in File Explorer'),
          row('send', I.out, 'Send to another device', 'Straight across Wi-Fi, no file'),
          row('receive', I.upload, 'Receive from another device', 'Adds what’s new, no duplicates'),
          row('export', I.save, 'Export everything', 'One backup file'),
          row('import', I.upload, 'Import a backup', 'Adds what’s new, or replaces everything'),
        ])}
        ${group('Help', [
          row('help', help, 'How searching works'),
          !matchMedia('(pointer: coarse)').matches && row('keys', keys, 'Keyboard shortcuts'),
        ])}
        ${group('Library', [
          `<div class="set-row static"><span class="set-ic">${disk}</span><span class="set-t"><b>Storage</b><small>${esc($('#storage').textContent)} · ${plural(S.docs.length, 'document')}</small></span></div>`,
          row('clear', I.trash || I.x, 'Clear library…', 'Pick folders, documents or everything', '', 'danger'),
        ])}
      </div>
    </div>`;
    if (open) {
      const t = document.createElement('template');
      t.innerHTML = html;
      open.replaceWith(t.content.querySelector('.set-body'));
      d.querySelector('.set-body').scrollTop = keepY;
    } else d.innerHTML = html;
  };
  d.oninput = (e) => {
    if (e.target.hasAttribute('data-glass')) prefs.glassT = Number(e.target.value);
    else if (e.target.hasAttribute('data-blur')) prefs.blurL = Number(e.target.value);
    else return;
    applyGlass();
    clearTimeout(d._gt);
    d._gt = setTimeout(savePrefs, 250);
  };
  d.onclick = async (e) => {
    if (e.target === d) return shut();
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const k = b.dataset.s;
    const then = (fn) => { shut(); closeDrawer(); setTimeout(fn, 200); };
    if (k === 'x') return shut();
    if (k === 'xb' || k === 'xd') {
      prefs.expand = k === 'xd' ? 'drag' : 'buttons';
      savePrefs();
      const rowEl = b.closest('.set-row');
      rowEl.querySelectorAll('[data-s="xb"], [data-s="xd"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.s === k)));
      rowEl.querySelector('small').textContent = k === 'xd' ? 'Drag the bars on a cropped page to pull it open' : 'Tap the arrows on a cropped page to open it';
      for (const art of $$('article.page')) { // swap the arrows for bars (or back) on pages already shown
        const body = art.lastElementChild;
        if (!body?.classList.contains('cropped')) continue;
        body._pieceSig = null;
        applyCrop(art);
      }
      return;
    }
    if (k === 'ug' || k === 'ub') { // just flip the switch and its line of text in place
      prefs.undoStyle = k === 'ub' ? 'buttons' : 'gestures';
      savePrefs();
      syncUndoBtns();
      const rowEl = b.closest('.set-row');
      rowEl.querySelectorAll('[data-s="ug"], [data-s="ub"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.s === k)));
      rowEl.querySelector('small').textContent = k === 'ub' ? 'Arrows at both ends of the bottom bar' : 'Swipe the bottom bar: right to undo, left to redo';
      return;
    }
    const syncEvery = () => { // the toggle's line and the "how often" row, updated in place
      const auto = d.querySelector('[data-s="auto"]');
      auto.querySelector('small').textContent = prefs.autoCheck ? `${checkEveryText()}, when you open the app` : 'Off';
      auto.querySelector('.set-sw').classList.toggle('on', !!prefs.autoCheck);
      const ev = d.querySelector('.set-every');
      ev.hidden = !prefs.autoCheck;
      const { n, unit } = checkEvery();
      ev.querySelector('output').textContent = n;
      ev.querySelector('[data-s="cn-"]').disabled = n <= 1;
      ev.querySelectorAll('.set-units button').forEach((x) => { const u = x.dataset.s.slice(3); x.setAttribute('aria-pressed', String(u === unit)); x.textContent = u[0].toUpperCase() + u.slice(1) + (n === 1 ? '' : 's'); });
    };
    if (k === 'auto') { prefs.autoCheck = !prefs.autoCheck; savePrefs(); $('#autoCheck') && ($('#autoCheck').checked = prefs.autoCheck); syncEvery(); return; }
    if (k === 'cn-' || k === 'cn+') { prefs.checkN = Math.max(1, Math.min(99, checkEvery().n + (k === 'cn+' ? 1 : -1))); savePrefs(); syncEvery(); return; }
    if (k.startsWith('cu-')) { prefs.checkUnit = k.slice(3); savePrefs(); syncEvery(); return; }
    if (k === 'cloud') { await toggleCloud(); render(); return; }
    if (k === 'theme') return then(openThemes);
    if (k === 'helper') return then(openHelper);
    if (k === 'check') return then(() => checkSources());
    if (k === 'folder') return then(changeLibraryFolder);
    if (k === 'reveal') return then(() => revealLibrary());
    if (k === 'send') return then(() => sendTo());
    if (k === 'receive') return then(() => receiveFrom({ reload: (mode) => (mode === 'replace' ? location.reload() : refreshLibrary()) }));
    if (k === 'export') return then(exportAll);
    if (k === 'import') return then(() => $('#backupInput').click());
    if (k === 'help') return then(() => $('#help').showModal());
    if (k === 'keys') return then(openKeys);
    if (k === 'clear') return then(openClear);
  };
  updateStorage();
  render();
  d.showModal();
}
function backupMenu(anchor) {
  openMenu(anchor, [
    { header: 'Backup' },
    ...(platform === 'windows' ? [{ label: 'Library folder…', sub: cloudOn ? 'In iCloud Drive: syncing with your Apple devices' : 'Choose a folder (pick iCloud Drive › Findly to sync with your Apple devices)', icon: I.folder, run: changeLibraryFolder }, { label: 'Show library folder', sub: 'Open it in File Explorer', icon: I.out, run: () => revealLibrary() }, { sep: true }] : []),
    ...(platform === 'ios' ? [{ label: 'iCloud sync', sub: cloudOn ? 'On: your Apple devices share one library (iCloud Drive › Findly)' : 'Keep the same library on your iPhone, iPad and Mac', icon: I.save, checked: cloudOn, run: toggleCloud }, { sep: true }] : []),
    { label: 'Send to another device', sub: 'Straight across Wi-Fi, no file: scan the code on the other device', icon: I.out, run: () => sendTo() },
    { label: 'Receive from another device', sub: 'Shows a code to scan; adds what’s new, no duplicates', icon: I.upload, run: () => receiveFrom({ reload: (mode) => (mode === 'replace' ? location.reload() : refreshLibrary()) }) },
    { sep: true },
    { label: 'Export everything', sub: 'Documents, folders, links, boards, themes and settings in one file', icon: I.save, run: exportAll },
    { label: 'Import a backup…', sub: 'Adds what’s new, or replaces everything', icon: I.upload, run: () => $('#backupInput').click() },
  ]);
}
async function exportAll() {
  libStatus.show('Making the backup', 0);
  if (isNative) { // the iPhone app: written straight into Files › On My iPhone › Instant Search › Backups, a piece at a time
    try {
      const d = new Date();
      const name = `Backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.isbackup`;
      const st = await backupStream();
      const { path } = await Files.freeName({ name, folder: 'Backups' });
      await writeBytes(path, st.head);
      let done = st.head.length;
      for (const p of st.parts) {
        const blob = await p.read();
        const u8 = new Uint8Array(await blob.arrayBuffer());
        for (let i = 0; i < u8.length; i += 3 << 20) {
          await Files.write({ path, data: b64(u8.subarray(i, i + (3 << 20))), append: true });
        }
        done += u8.length;
        libStatus.show('Making the backup', done / st.size);
      }
      libStatus.hide();
      toast(`Backup saved in ${platform === 'windows' ? 'your library folder' : 'Files › On My iPhone › Findly'} › ${path} (${fmtSize(st.size)})`, { ms: 8000 });
    } catch (err) {
      libStatus.hide();
      toast(`Couldn’t make the backup: ${err?.message || err}`, { ms: 6000 });
    }
    return;
  }
  try {
    const blob = await makeBackup();
    const d = new Date();
    const name = `Findly backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.isbackup`;
    libStatus.hide();
    const file = new File([blob], name, { type: 'application/octet-stream' });
    // phones: the share sheet has Save to Files; computers: a normal download
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    saveBlob(file, name);
    toast(`Backup saved (${fmtSize(blob.size)})`);
  } catch (err) {
    libStatus.hide();
    toast(`Couldn’t make the backup: ${err?.message || err}`, { ms: 6000 });
  }
}
// Bring the library on screen up to date with what's stored (after an import or a transfer), without reloading.
async function refreshLibrary() {
  const [docs, texts, folders] = await Promise.all([store.allDocs(), store.allTexts(), store.allFolders()]);
  const busyDocs = S.docs.filter((d) => d.status); // still being added: keep them
  S.folders = folders.sort((a, b) => (a.order || 0) - (b.order || 0));
  S.texts.clear();
  for (const t of texts) S.texts.set(t.id, t.pages);
  S.docs = docs.filter((d) => S.texts.has(d.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const d of busyDocs) if (!S.docs.some((x) => x.id === d.id)) S.docs.push(d);
  try { S.watch = JSON.parse(localStorage.getItem(WATCH_KEY)) || []; } catch {}
  await boards.reload?.();
  renderLibrary();
  syncControls();
  runSearch({ keepScroll: true });
  updateStorage();
  if (isNative) { scheduleState(); indexSpotlight(); }
  labelOlderDocs();
}
async function importBackup(file) {
  let b;
  try { b = await readBackup(file); } catch (err) { toast(`Couldn’t open “${file.name}”: ${err?.message || err}`, { ms: 6000 }); return; }
  const s = b.summary;
  const fresh = await b.fresh().catch(() => s.docs);
  const res = await review({
    title: 'Import this backup?',
    intro: `Made ${esc(new Date(s.made).toLocaleString())} with ${esc(plural(s.docs, 'document'))} (${fmtSize(s.size)}). ${fresh ? `<b>${esc(plural(fresh, 'document'))}</b> ${fresh === 1 ? 'is' : 'are'} new or changed here and will be added; the rest are already here and are skipped, so nothing is duplicated.` : 'Every document in it is already here; folders and boards will be brought up to date.'} Nothing on this device is removed.`,
    rows: [],
    options: [{ id: 'replace', label: 'Replace everything instead (this device becomes an exact copy of the backup, settings included)' }],
    apply: 'Import',
    alwaysApply: true,
  });
  if (!res) return;
  const merge = !res.options?.replace;
  libStatus.show('Importing · getting ready');
  try {
    navigator.storage?.persist?.().catch(() => {});
    let last = 0;
    let most = 0;
    await b.restore((n, of) => {
      if (n < most) return; // never backwards
      most = n;
      const now = performance.now();
      if (now - last < 80 && n < of) return; // smooth, not hundreds of repaints a second
      last = now;
      libStatus.show('Importing', n / of);
    }, { merge });
    if (!merge) { location.reload(); return; } // everything replaced, settings too: start fresh
    await refreshLibrary();
    libStatus.done(fresh ? `Imported · ${plural(fresh, 'document')} added or updated` : 'Imported · already up to date');
  } catch (err) {
    libStatus.hide();
    if (stuckStorage(err)) storageStuck('The import stopped because');
    else toast(`Import stopped: ${err?.message || err}. Try again, or free up space on this device.`, { ms: 8000 });
  }
}

async function openClear() {
  if (!S.docs.length && !S.folders.length) { toast('Your library is already empty'); return; }
  const docCount = (fid) => S.docs.filter((d) => d.folderId === fid).length;
  const rows = [
    { header: 'Everything' },
    { all: true, title: 'The whole app', detail: `All ${plural(S.docs.length, 'document')}${S.folders.length ? `, ${plural(S.folders.length, 'folder')}` : ''} and linked pages`, tone: 'warn' },
  ];
  if (S.folders.length) {
    rows.push({ header: 'Folders' });
    for (const f of S.folders) rows.push({ folder: f, title: f.name, detail: `Folder and its ${plural(docCount(f.id), 'document')}` });
  }
  rows.push({ header: 'Documents' });
  for (const d of orderedDocs()) {
    const f = folderOf(d);
    rows.push({ doc: d, title: d.name, detail: `${plural(S.texts.get(d.id)?.length || d.pages || 0, 'page')}${f ? ` · in “${esc(f.name)}”` : ''}` });
  }
  const res = await review({
    title: 'Remove from this device',
    intro: 'Tick what to remove. You’ll be asked to confirm next.',
    rows,
    options: [{ id: 'settings', label: 'If removing the whole app: also reset settings (theme, shortcuts, zoom, download helper)' }],
    apply: 'Continue',
  });
  if (!res) return;
  const everything = [...res.picked].some((r) => r.all);
  const folders = everything ? [...S.folders] : [...res.picked].filter((r) => r.folder).map((r) => r.folder);
  const docs = new Set(everything ? S.docs : [...res.picked].filter((r) => r.doc).map((r) => r.doc));
  for (const f of folders) S.docs.filter((d) => d.folderId === f.id).forEach((d) => docs.add(d));
  if (!docs.size && !folders.length) return;
  const what = everything ? 'everything in Findly' : [docs.size && plural(docs.size, 'document'), folders.length && plural(folders.length, 'folder')].filter(Boolean).join(' and ');
  const sure = await review({
    title: `Remove ${what}?`,
    intro: `This deletes ${everything ? 'all your documents, folders and linked pages' : 'them'} from this device and can’t be undone.${everything && res.options.settings ? ' Your settings will be reset too.' : ''}`,
    rows: [],
    apply: 'Remove',
    danger: true,
  });
  if (!sure) return;
  finalizeRemoval();
  if (active === reader && docs.has(docById(reader.docId))) closeReader();
  if (everything) {
    S.docs.forEach((d) => { closePdf(d.id); forgetHtml(d.id); });
    S.docs = [];
    S.folders = [];
    S.watch = [];
    saveWatch();
    S.texts.clear();
    await store.clear().catch(() => {});
    if (res.options.settings) {
      for (const k of ['instant-search:prefs', 'instant-search:helper', 'instant-search:direct', 'instant-search:watched']) try { localStorage.removeItem(k); } catch {}
      location.reload();
      return;
    }
  } else {
    for (const d of docs) {
      closePdf(d.id);
      forgetHtml(d.id);
      S.texts.delete(d.id);
      store.deleteDoc(d.id).catch(() => {});
    }
    S.docs = S.docs.filter((d) => !docs.has(d));
    for (const f of folders) store.deleteFolder(f.id).catch(() => {});
    S.folders = S.folders.filter((f) => !folders.includes(f));
  }
  runSearch({ keepScroll: true });
  updateStorage();
  toast(`Removed ${what}`);
}

// ---------- toasts ----------
// One quiet status line at the top of the library (and a hairline at the top of the screen when the library is
// out of view) for long jobs: update checks, imports, transfers. No popups piling up.
const libStatus = (() => {
  let hideT = 0;
  let line = null;
  let shown = 0, target = 0, raf = 0; // the percentage glides to each new value instead of jumping
  const fmtPct = (f) => `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`;
  const glide = () => {
    raf = 0;
    const pct = $('#libStatus .ls-pct');
    shown += (target - shown) * 0.18;
    if (Math.abs(target - shown) < 0.0008) shown = target;
    if (pct && pct.dataset.on) pct.textContent = fmtPct(shown);
    if (shown !== target) raf = requestAnimationFrame(glide);
  };
  const box = () => $('#libStatus');
  const hair = () => line || (line = document.body.appendChild(el('div', 'top-progress', '<b></b>')));
  const paint = (text, frac) => {
    const b = box();
    clearTimeout(hideT);
    b.hidden = false;
    requestAnimationFrame(() => b.classList.add('on'));
    b.querySelector('.ls-text').textContent = text;
    const known = typeof frac === 'number' && isFinite(frac);
    const f = known ? Math.max(0, Math.min(1, frac)) : 0;
    const pct = b.querySelector('.ls-pct');
    if (known) {
      if (!pct.dataset.on || f < shown) shown = f; // a new job starts from where it is
      pct.dataset.on = '1';
      target = f;
      if (!raf) raf = requestAnimationFrame(glide);
      if (shown === target) pct.textContent = fmtPct(f);
    } else { delete pct.dataset.on; pct.textContent = ''; shown = target = 0; }
    b.classList.toggle('busy', !known);
    b.querySelector('.ls-bar b').style.transform = known ? `scaleX(${f})` : '';
    const r = b.getBoundingClientRect();
    const seen = b.offsetParent && r.width > 0 && r.right > 4 && r.left < innerWidth - 4;
    const h = hair();
    h.classList.toggle('on', !seen);
    h.classList.toggle('busy', !known);
    h.firstChild.style.transform = known ? `scaleX(${f})` : '';
  };
  return {
    show: paint,
    done(text, ms = 2600) {
      const b = box();
      paint(text, 1);
      b.classList.add('ok');
      const pct = b.querySelector('.ls-pct');
      delete pct.dataset.on;
      pct.textContent = '';
      shown = target = 0;
      line?.classList.remove('on');
      hideT = setTimeout(() => { b.classList.remove('on', 'ok'); setTimeout(() => { if (!b.classList.contains('on')) b.hidden = true; }, 260); }, ms);
    },
    hide() {
      const b = box();
      clearTimeout(hideT);
      b.classList.remove('on', 'ok', 'busy');
      const pct = b.querySelector('.ls-pct');
      delete pct.dataset.on;
      shown = target = 0;
      line?.classList.remove('on');
      setTimeout(() => { if (!b.classList.contains('on')) b.hidden = true; }, 260);
    },
  };
})();

function toast(msg, { action, onAction, ms = 4200 } = {}) {
  const t = el('div', 'toast', `<span>${esc(msg)}</span>`);
  if (action) {
    const b = el('button', 'toast-btn', esc(action));
    b.onclick = () => { onAction(); t.remove(); };
    t.append(b);
  }
  const box = $('#toasts');
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  t._hide = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  if (ms !== Infinity) setTimeout(t._hide, ms);
  return t;
}

// ---------- undo / redo ----------
// Everything you do — searching, switching how pages look, opening pages, cropping, boards — can be undone
// and redone: tap the Undo chip that briefly takes the search type's place on the floating bar, swipe the
// bar left-to-right (undo) or right-to-left (redo), or press Ctrl+Z / Ctrl+Shift+Z.
const H = { undo: [], redo: [], busy: false, group: null, groupAt: 0, ready: false };
const SNAP_KEYS = ['mode', 'matchCase', 'wholeWord', 'near', 'sort', 'view', 'zoom', 'crop', 'cropLines', 'trim', 'columns'];
function pageSpot() {
  const a = currentArt();
  if (!a) return { y: scrollY };
  return { doc: a.dataset.doc, n: Number(a.dataset.n), off: a.getBoundingClientRect().top, y: scrollY };
}
function snapshot(extra = {}) {
  return {
    q: q.value,
    p: Object.fromEntries(SNAP_KEYS.map((k) => [k, prefs[k]])),
    revealed: new Map([...results.revealed].map(([k, set]) => [k, new Set(set)])),
    cropOpen: new Map([...cropOpen].map(([k, v]) => [k, { ...v }])),
    override: new Map(override),
    reader: active === reader ? { doc: reader.docId, n: curPageN } : null,
    at: pageSpot(),
    ...extra,
  };
}
// Undo and redo leave you where you are: whatever hit (or page) you're looking at stays at the same spot on
// screen while things open or close around it, even as pages finish drawing.
function grabAnchor() {
  const a = currentArt();
  if (!a) return null;
  const { top, bottom } = readingArea();
  const mid = (top + bottom) / 2;
  let best = null, bd = Infinity;
  for (const m of a.querySelectorAll('[data-h]')) {
    if (m.closest('.clone')) continue;
    const r = m.getBoundingClientRect();
    if (!r.height) continue;
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (d < bd) { bd = d; best = m; }
  }
  const home = a._home || a;
  return { doc: home.dataset.doc, n: Number(home.dataset.n), h: best?.dataset.h ?? null, y: best?.getBoundingClientRect().top, ay: a.getBoundingClientRect().top };
}
function findAnchor(an) {
  let art = active.pageEls?.get(pkey(an.doc, an.n));
  if (!art) return null;
  if (art.hidden && art._visit) art = art._visit;
  if (art.hidden || !art.isConnected) return null;
  if (an.h != null) {
    for (const m of art.querySelectorAll(`[data-h="${an.h}"]`)) if (!m.closest('.clone') && m.getBoundingClientRect().height) return [m, an.y];
  }
  return [art, an.ay];
}
let anchorHold = 0;
function holdAnchor(an, ms = 900) {
  const id = ++anchorHold;
  const t0 = performance.now();
  const stop = () => { anchorHold++; };
  // your own scrolling always wins
  addEventListener('wheel', stop, { once: true, passive: true });
  addEventListener('touchstart', stop, { once: true, passive: true });
  const step = () => {
    if (id !== anchorHold) return;
    const f = findAnchor(an);
    if (f) {
      const d = f[0].getBoundingClientRect().top - f[1];
      if (Math.abs(d) > 0.5) window.scrollBy({ top: d, behavior: 'instant' });
    }
    if (performance.now() - t0 < ms) requestAnimationFrame(step);
    else { removeEventListener('wheel', stop); removeEventListener('touchstart', stop); }
  };
  step();
  return !!findAnchor(an);
}
async function restoreSnap(s, an = null) {
  H.busy = true;
  try {
    const zoomChanged = prefs.zoom !== s.p.zoom;
    const trimChanged = prefs.trim !== s.p.trim || prefs.columns !== s.p.columns;
    Object.assign(prefs, s.p);
    savePrefs();
    q.value = s.q;
    override.clear();
    for (const [k, v] of s.override) override.set(k, v);
    if (!s.reader && active === reader) closeReader();
    runSearch();
    results.revealed = new Map([...s.revealed].map(([k, set]) => [k, new Set(set)]));
    cropOpen.clear();
    for (const [k, v] of s.cropOpen) cropOpen.set(k, { ...v });
    results.dirty = true;
    syncControls();
    if (zoomChanged) document.documentElement.style.setProperty('--z', zoomValue().toFixed(4));
    if (s.reader) {
      if (active !== reader || reader.docId !== s.reader.doc) await openReader(s.reader.doc, s.reader.n);
      else { if (trimChanged) renderView(reader); else refreshInPlace(reader); }
    } else if (active === results) {
      renderView(results);
      // stay put; only if what you were looking at is gone (another search) go back to where that one was
      if (!(an && holdAnchor(an))) {
        const art = s.at?.doc != null ? results.pageEls.get(pkey(s.at.doc, s.at.n)) : null;
        if (art) window.scrollBy({ top: art.getBoundingClientRect().top - s.at.off, behavior: 'instant' });
        else if (s.at) window.scrollTo({ top: s.at.y, behavior: 'instant' });
      }
    }
    if (active === reader && reader.dirty) results.dirty = true;
    updateChrome();
  } finally {
    H.busy = false;
  }
}
// Call right before changing something. Repeats of the same kind within a moment (typing, a slider) are one step.
function record(label, { group = null, snap = null } = {}) {
  if (H.busy || !H.ready) return;
  const now = performance.now();
  if (group && H.group === group && now - H.groupAt < 1600) { H.groupAt = now; showUndo('undo'); return; }
  H.group = group;
  H.groupAt = now;
  H.undo.push({ label, before: typeof snap === 'function' ? snap() : snap || snapshot() });
  if (H.undo.length > 120) H.undo.shift();
  H.redo.length = 0;
  showUndo('undo');
}
// For things kept outside the view state (boards): give the two directions yourself.
function recordCustom(label, undo, redo) {
  if (H.busy) return;
  H.undo.push({ label, undo, redo });
  if (H.undo.length > 120) H.undo.shift();
  H.redo.length = 0;
  H.group = null;
  showUndo('undo');
}
async function undo() {
  const e = H.undo.pop();
  if (!e) { toast('Nothing to undo', { ms: 1200 }); return; }
  H.group = null;
  closeMenu();
  const an = grabAnchor();
  if (e.undo) { H.busy = true; try { await e.undo(); } finally { H.busy = false; } if (an) holdAnchor(an); }
  else { e.after = snapshot(); await restoreSnap(e.before, an); }
  H.redo.push(e);
  showUndo('redo', `Undone: ${e.label}`);
}
async function redo() {
  const e = H.redo.pop();
  if (!e) { toast('Nothing to redo', { ms: 1200 }); return; }
  H.group = null;
  closeMenu();
  const an = grabAnchor();
  if (e.redo) { H.busy = true; try { await e.redo(); } finally { H.busy = false; } if (an) holdAnchor(an); }
  else await restoreSnap(e.after, an);
  H.undo.push(e);
  showUndo('undo', `Redone: ${e.label}`);
}
// Undo / redo on the phone bar: "gestures" (swipe the bar, and a chip pops up after a change) or "buttons"
// (fixed arrows at either end of the bar).
function syncUndoBtns() {
  const buttons = prefs.undoStyle === 'buttons';
  document.body.classList.toggle('undo-buttons', buttons);
  if (buttons) document.body.classList.remove('undo-on');
  const u = $('#mUndoBtn'), r = $('#mRedoBtn');
  if (u) { u.disabled = !H.undo.length; u.title = H.undo.length ? `Undo: ${H.undo.at(-1).label}` : 'Nothing to undo'; }
  if (r) { r.disabled = !H.redo.length; r.title = H.redo.length ? `Redo: ${H.redo.at(-1).label}` : 'Nothing to redo'; }
}
// The chip: "Undo" right after you do something, "Redo" right after an undo; it steps aside after a moment.
let undoTimer = 0;
function showUndo(kind, note) {
  // no pop-up undo button any more: undo is the bar's swipe (Gestures) or its fixed arrows (Buttons), or Ctrl+Z
  syncUndoBtns();
  if (note) {
    const hint = $('#swipeHint');
    if (hint) { hint.textContent = note; hint.className = 'swipe-hint flash'; clearTimeout(hint._t); hint._t = setTimeout(() => (hint.className = 'swipe-hint'), 1400); }
  }
}
// Swipe the floating bar: left→right undoes, right→left redoes. Quick sideways flicks only, so tapping,
// holding and the other gestures on the bar keep working.
const bar = { swiping: false, justSwiped: 0, jogging: false, resets: [] };
function bindBarSwipe(el) {
  let s = null;
  const hint = $('#swipeHint');
  const feedback = (dx) => {
    const dir = dx > 0 ? 'undo' : 'redo';
    const list = dir === 'undo' ? H.undo : H.redo;
    const ready = Math.abs(dx) > 56;
    el.style.setProperty('--swx', `${Math.max(-60, Math.min(60, dx * 0.18))}px`);
    hint.innerHTML = list.length ? `${dir === 'undo' ? I.undo : ''}<span>${dir === 'undo' ? 'Undo' : 'Redo'} · ${esc(list.at(-1).label)}</span>${dir === 'redo' ? I.redo : ''}` : `<span>Nothing to ${dir}</span>`;
    hint.className = `swipe-hint show${ready && list.length ? ' ready' : ''}`;
    hint.style.opacity = Math.min(1, Math.abs(dx) / 40);
    if (ready && !s.buzzed && list.length) { s.buzzed = true; navigator.vibrate?.(6); }
    if (!ready) s.buzzed = false;
  };
  el.addEventListener('pointerdown', (e) => { if (e.button === 0 && prefs.undoStyle !== 'buttons') s = { x: e.clientX, y: e.clientY, t: performance.now(), on: false }; }, true);
  el.addEventListener('pointermove', (e) => {
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) {
      if (bar.jogging) { s = null; return; }
      const quick = performance.now() - s.t < 300;
      if (quick && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        s.on = true;
        bar.swiping = true;
        bar.resets.forEach((f) => f());
        closeMenu();
        el.classList.add('swiping');
        try { el.setPointerCapture(e.pointerId); } catch {}
      } else if (!quick && Math.hypot(dx, dy) > 16) { s = null; return; } // a slow drag belongs to the control under it
      else return;
    }
    e.stopPropagation();
    feedback(dx);
  }, true);
  const end = (e, ok) => {
    if (!s) return;
    const was = s;
    s = null;
    if (!was.on) return;
    e?.stopPropagation();
    bar.justSwiped = performance.now();
    setTimeout(() => (bar.swiping = false), 0);
    el.classList.remove('swiping');
    el.style.removeProperty('--swx');
    hint.className = 'swipe-hint';
    hint.style.opacity = '';
    const dx = e ? e.clientX - was.x : 0;
    if (ok && dx > 56) undo();
    else if (ok && dx < -56) redo();
  };
  el.addEventListener('pointerup', (e) => end(e, true), true);
  el.addEventListener('pointercancel', (e) => end(e, false), true);
  el.addEventListener('click', (e) => { if (performance.now() - bar.justSwiped < 450) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// ---------- theme ----------
function applyTheme() {
  applyReadingTheme(prefs);
  applyGlass();
}
// How see-through the bars, buttons and menus are: 0 = solid, 50 = as designed, 100 = nearly clear.
// Each surface keeps its own designed opacity at 50 and scales from there in both directions.
const GLASS = { '--a-top': 76, '--a-bar': 40, '--a-menu': 80, '--a-head': 74, '--a-dock': 88 };
function applyGlass() {
  const t = Math.max(0, Math.min(100, prefs.glassT ?? 50)) / 100;
  const root = document.documentElement.style;
  for (const [k, base] of Object.entries(GLASS)) {
    const a = t <= 0.5 ? 100 + (base - 100) * (t / 0.5) : base + (6 - base) * ((t - 0.5) / 0.5);
    root.setProperty(k, `${a.toFixed(1)}%`);
  }
  // blur on a curve (see themes.js): fine control at the light end, heavy frosting only at the far end
  root.setProperty('--bpx', `${blurPx(prefs.blurL ?? BLUR_DEF).toFixed(1)}px`);
}
function openThemes() {
  closeMenu();
  openThemeBar(prefs, { save: savePrefs, glass: applyGlass });
}

// ---------- events ----------
function bind() {
  $('#fileInput').accept = ACCEPT;
  $('#fileInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    let target = pickTarget;
    pickTarget = null;
    if (target === 'new') { target = createFolder().id; addFiles(files, target); startRename(target); }
    else addFiles(files, target && folderById(target) ? target : null);
  });
  $('#dirInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const groups = new Map();
    for (const f of files) {
      const top = (f.webkitRelativePath || '').split('/')[0] || 'Imported';
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top).push(f);
    }
    for (const [name, list] of groups) {
      const usable = list.filter((f) => kindOf(f.name)).sort(byName);
      if (!usable.length) { toast(`No supported documents in “${name}”`); continue; }
      addFiles(usable, folderNamed(name).id, { quietSkip: true });
      if (usable.length < list.length) toast(`Added ${plural(usable.length, 'document')} from “${name}” · skipped ${plural(list.length - usable.length, 'other file')}`);
    }
  });
  $('#addBtn').addEventListener('click', () => pickFiles(null));
  $('#addMoreBtn').addEventListener('click', (e) => { e.stopPropagation(); addMenu(e.currentTarget); });
  $('#newFolderBtn').addEventListener('click', () => { const f = createFolder(); startRename(f.id); });
  $('#checkAllBtn').addEventListener('click', () => checkSources());
  $('#linkForm').addEventListener('submit', (e) => { e.preventDefault(); submitLink(); });
  $('#linkDlg').addEventListener('click', (e) => { if (e.target === e.currentTarget || e.target.closest('[data-close]')) $('#linkDlg').close(); });
  $('#reviewIntro').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copyhelper]');
    if (!b) return;
    copyHelperCode(b);
  });
  $('#aiMode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { setAiMode(b.dataset.m); setAiStatus(''); } });
  $('#aiDest').addEventListener('change', (e) => { e.target.dataset.picked = '1'; $('#aiDestNameRow').hidden = e.target.value !== 'new'; });
  $('#aiGo').addEventListener('click', () => aiCopy(true));
  $('#aiCopy').addEventListener('click', () => aiCopy(false));
  $('#aiBot').addEventListener('change', (e) => { prefs.aiBot = e.target.value; savePrefs(); });
  $('#aiCheck').addEventListener('click', () => linkWithAi());
  $('#aiPaste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error('empty');
      $('#aiAnswer').value = text;
      linkWithAi();
    } catch {
      $('#aiAnswer').focus();
      setAiStatus('Paste the answer into the box (Ctrl+V, or long-press → Paste), then press Check &amp; link.');
    }
  });
  $('#autoCheck').addEventListener('change', (e) => { prefs.autoCheck = e.target.checked; savePrefs(); });
  $('#helperOpen').addEventListener('click', () => openHelper());
  document.addEventListener('click', (e) => { if (!e.target.closest('.pop-menu')) closeMenu(); });
  addEventListener('resize', closeMenu);
  $('.sidebar').addEventListener('scroll', closeMenu, true);

  q.addEventListener('input', () => {
    record('Search', { group: 'search', snap: () => snapshot({ q: prefs.q }) });
    $('#clearBtn').hidden = !q.value;
    scheduleSearch();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchTimer && prefs.q !== q.value) { clearTimeout(searchTimer); runSearch(); }
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      if (q.value) { q.value = ''; runSearch(); } else q.blur();
    }
  });
  $('#clearBtn').addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard up and the box focused
  $('#clearBtn').addEventListener('click', () => { record('Clear search'); q.value = ''; runSearch(); q.focus(); });
  $('#prevBtn').addEventListener('click', () => step(-1));
  $('#nextBtn').addEventListener('click', () => step(1));

  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('#nearN').addEventListener('input', (e) => { record('Near distance', { group: 'near' }); prefs.near = Math.max(1, Math.min(200, Number(e.target.value) || 8)); scheduleSearch(); });
  $('#caseBtn').addEventListener('click', () => { record('Match case'); prefs.matchCase = !prefs.matchCase; runSearch(); });
  $('#wordBtn').addEventListener('click', () => { record('Whole words'); prefs.wholeWord = !prefs.wholeWord; runSearch(); });
  $('#sortSel2').addEventListener('change', (e) => { record('Sort'); prefs.sort = e.target.value; runSearch(); });
  $('#viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
  $('#zoomIn').addEventListener('click', () => zoomBy(1));
  $('#zoomOut').addEventListener('click', () => zoomBy(-1));
  $('#zoomVal').addEventListener('click', () => setZoom(1));
  $('#fitWidth').addEventListener('click', () => setFit('width'));
  $('#fitCol').addEventListener('click', () => setFit('column'));
  $('#fitPage').addEventListener('click', () => setFit('page'));
  $('#cropBtn').addEventListener('click', () => setCrop(!prefs.crop));
  $('#trimBtn').addEventListener('click', () => setTrim(!prefs.trim));
  $('#cropMinus').addEventListener('click', () => setCropLines(prefs.cropLines - 1));
  $('#cropPlus').addEventListener('click', () => setCropLines(prefs.cropLines + 1));
  $('#navBtn').addEventListener('click', () => setPageNav(prefs.pageNav === 'swipe' ? 'tabs' : 'swipe'));
  bindPageSwipe($('#results'));
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      syncControls(); // phones always get the slim search bar
      if (innerWidth > 1240) setPanel(false);
      if (typeof prefs.zoom === 'string') applyZoom();
      trackPosition();
    }, 150);
  });
  $('#panelBtn').addEventListener('click', () => setPanel(!document.body.classList.contains('panel')));
  $('#compactBtn').addEventListener('click', toggleCompact);
  bindSideResize();
  // phone reading bar
  bindModePicker($('#mMode'));
  bindBarSwipe($('#mbar'));
  for (const b of [$('#mUndo'), $('#dUndo')]) b.addEventListener('click', () => (b.dataset.kind === 'redo' ? redo() : undo()));
  $('#mUndoBtn').addEventListener('click', () => undo());
  $('#mRedoBtn').addEventListener('click', () => redo());
  syncUndoBtns();
  bindHoldMenu($('#mMore'), moreItems);
  bindJog($('#mCount'));
  $('#mPrev').addEventListener('click', () => step(-1));
  $('#mNext').addEventListener('click', () => step(1));
  $('#mPrevPage').addEventListener('click', () => stepPage(-1));
  $('#mNextPage').addEventListener('click', () => stepPage(1));
  addEventListener('scroll', onScrollBars, { passive: true });
  q.addEventListener('focus', () => setBarHidden(false));
  $('#keysBtn').addEventListener('click', openKeys);

  // search type pill: tap to open the list, or press, slide onto a type and let go
  bindModePicker($('#modePill'));
  let wheelAt = 0;
  $('#modePill').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (Date.now() - wheelAt < 180) return;
    wheelAt = Date.now();
    const modes = Object.keys(MODES);
    const i = modes.indexOf(prefs.mode) + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
    setMode(modes[(i + modes.length) % modes.length]);
  }, { passive: false });

  // shortcut editor
  $('#keys').addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) { recording = null; $('#keys').close(); return; }
    const chip = e.target.closest('.kchip');
    const add = e.target.closest('.kadd');
    const reset = e.target.closest('.kreset');
    if (chip) setBindings(chip.dataset.id, bindings(actionById(chip.dataset.id)).filter((k) => k !== chip.dataset.key));
    else if (add) { recording = add.dataset.id; renderKeys(); $('#keysList').focus({ preventScroll: true }); }
    else if (reset) setBindings(reset.dataset.id, actionById(reset.dataset.id).keys);
  });
  $('#keysReset').addEventListener('click', () => { prefs.keys = {}; savePrefs(); buildKeyMap(); renderKeys(); syncControls(); toast('Shortcuts reset to defaults', { ms: 1800 }); });
  $('#keys').addEventListener('cancel', (e) => { if (recording) { e.preventDefault(); recording = null; renderKeys(); } });
  addEventListener('keydown', (e) => {
    if (!recording || !$('#keys').open) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { recording = null; renderKeys(); return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    const id = recording;
    recording = null;
    setTimeout(() => $(`.kadd[data-id="${id}"]`)?.focus({ preventScroll: true }), 0);
    const other = ACTIONS.find((a) => a.id && a.id !== id && bindings(a).includes(combo));
    if (other) {
      setBindings(other.id, bindings(other).filter((k) => k !== combo));
      toast(`${comboLabel(combo)} moved from “${other.label}”`, { ms: 2600 });
    }
    const mine = bindings(actionById(id));
    setBindings(id, mine.includes(combo) ? mine : [...mine, combo]);
  }, true);
  $('#themeBtn').addEventListener('click', openThemes);
  $('#boardsBtn').addEventListener('click', openBoards);
  $('#libBoardsBtn').addEventListener('click', openBoards);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $('#helpBtn').addEventListener('click', () => $('#help').showModal());
  $('#help').addEventListener('click', (e) => { if (e.target === e.currentTarget || e.target.closest('[data-close]')) $('#help').close(); });

  // library
  $('#lib').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.hasAttribute('data-fchk')) { setFolderEnabled(e.target.closest('.folder').dataset.fid, e.target.checked); return; }
    const li = e.target.closest('.lib-item');
    if (li) setEnabled(li.dataset.id, e.target.checked);
  });
  $('#lib').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    e.stopPropagation();
    const act = b.dataset.act;
    const fid = b.closest('.folder')?.dataset.fid;
    const id = b.closest('.lib-item')?.dataset.id;
    if (id) {
      if (act === 'read') { if (!docById(id)?.status) { openReader(id); closeDrawer(); } }
      else if (act === 'solo') solo(id);
      else if (act === 'dmenu') docMenu(b, id);
      return;
    }
    if (!fid) return;
    if (act === 'fold') toggleFolder(fid);
    else if (act === 'fsolo') soloFolder(fid);
    else if (act === 'fadd') pickFiles(fid);
    else if (act === 'fmenu') folderMenu(b, fid);
  });
  $('#lib').addEventListener('dblclick', (e) => {
    const f = e.target.closest('.folder-main');
    if (f) { e.preventDefault(); startRename(f.closest('.folder').dataset.fid); }
  });

  // drag a document into a folder (or out of one); drop files from the computer onto a folder
  const DOC_TYPE = 'application/x-instant-doc';
  const zone = $('.lib-zone');
  let dragId = null;
  // a drag may start from the document's name or the row itself, never from its buttons or checkbox
  const NO_DRAG = '.lib-acts, .chk, .mini, input';
  let pressedOn = null;
  $('#lib').addEventListener('pointerdown', (e) => { pressedOn = e.target; }, true);
  $('#lib').addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('.lib-item');
    if (!li) return;
    if (pressedOn?.closest?.(NO_DRAG)) { e.preventDefault(); return; }
    dragId = li.dataset.id;
    e.dataTransfer.setData(DOC_TYPE, li.dataset.id);
    e.dataTransfer.setData('text/plain', docById(li.dataset.id)?.name || '');
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragged');
    document.body.classList.add('moving-doc');
  });
  const clearDropMarks = () => $$('.drop-on').forEach((x) => x.classList.remove('drop-on'));
  $('#lib').addEventListener('dragend', () => {
    dragId = null;
    $$('.dragged').forEach((x) => x.classList.remove('dragged'));
    document.body.classList.remove('moving-doc');
    clearDropMarks();
  });
  const dropTarget = (e) => e.target.closest?.('.folder') || zone;
  zone.addEventListener('dragover', (e) => {
    const types = e.dataTransfer.types;
    const internal = types.includes(DOC_TYPE);
    if (!internal && !types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
    const t = dropTarget(e);
    if (zone._over === t) return; // nothing changed: no work on every mouse move
    zone._over = t;
    clearDropMarks();
    t.classList.add('drop-on');
    const f = t.classList.contains('folder') && folderById(t.dataset.fid);
    if (f?.collapsed) setTimeout(() => { if (zone._over === t && f.collapsed) toggleFolder(f.id); }, 700);
  });
  zone.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !zone.contains(e.relatedTarget)) { clearDropMarks(); zone._over = null; }
  });
  zone.addEventListener('drop', (e) => {
    const types = e.dataTransfer.types;
    const internal = types.includes(DOC_TYPE);
    if (!internal && !types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    const t = dropTarget(e);
    const fid = t.classList.contains('folder') ? t.dataset.fid : null;
    clearDropMarks();
    zone._over = null;
    document.body.classList.remove('dragging', 'moving-doc');
    resetDrag();
    if (internal) moveDocs([dragId || e.dataTransfer.getData(DOC_TYPE)], fid);
    else importDrop(e.dataTransfer, fid || undefined);
  });
  bindLibDrag();
  $('#toggleAll').addEventListener('click', toggleAll);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#backupInput').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importBackup(f); });

  // results + reader (delegated)
  const onMain = (e) => {
    const t = e.target;
    const mark = t.closest('[data-h]') || (t.closest('.pdf-text') && document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.matches?.('.box[data-h]')));
    if (mark && active.root.contains(mark)) {
      active.cur = Number(mark.dataset.h);
      active.navY = scrollY;
      markCurrent(active);
      updateCounter();
    }
    const gapBtn = t.closest('.gap [data-act]');
    if (gapBtn) { onGap(gapBtn.closest('.gap'), gapBtn.dataset.act); return; }
    // tap a page: its menu opens right where you tapped (tap again anywhere to dismiss)
    const tapped = t.closest('.page-body');
    if (tapped && !t.closest('[data-act], button, a, input') && !String(getSelection?.() || '').trim() && !hadSelection) {
      e.stopPropagation();
      if ($('.pop-menu')) { closeMenu(); return; }
      const art = tapped.closest('.page');
      if (art) openMenuAt(e.clientX, e.clientY, pageItems(art));
      return;
    }
    const b = t.closest('[data-act]');
    if (!b) {
      const m = t.closest('[data-mode]');
      if (m) setMode(m.dataset.mode);
      const f = t.closest('[data-fix]');
      if (f) {
        if (f.dataset.fix === 'word') prefs.wholeWord = false;
        if (f.dataset.fix === 'case') prefs.matchCase = false;
        if (f.dataset.fix === 'all') { S.docs.forEach((d) => (d.enabled = true)); store.updateDocs(S.docs.filter(searchable).map(stripMeta)).catch(() => {}); }
        runSearch();
      }
      return;
    }
    const act = b.dataset.act;
    const art = b.closest('.page');
    const sec = b.closest('.doc-sec');
    if (act === 'pick') $('#fileInput').click();
    else if (act === 'read') openReader(b.dataset.doc || sec?.dataset.doc);
    else if (act === 'open' && art) openReader(art.dataset.doc, Number(art.dataset.n));
    else if (act === 'web' && art) { override.set(pkey(art.dataset.doc, WEB), 'original'); openReader(art.dataset.doc, Number(art.dataset.n)); }
    else if (act === 'pmode' && art) togglePageMode(art);
    else if ((act === 'col-next' || act === 'col-prev') && art) shiftColumn(art, Number(b.dataset.piece), act === 'col-next' ? 1 : -1);
    else if ((act === 'edge-top' || act === 'edge-bottom') && art) expandEdge(art, act === 'edge-top' ? 'top' : 'bottom');
    else if (act === 'visit-back' && art?._home) goVisit(art._home, Number(art._home.dataset.n), Number(art.dataset.n) > Number(art._home.dataset.n) ? -1 : 1);
  };
  // a tap that only clears a text selection shouldn't also open the page's menu
  let hadSelection = false;
  const noteSel = () => { hadSelection = !!String(getSelection?.() || '').trim(); };
  $('#results').addEventListener('pointerdown', noteSel);
  $('#reader').addEventListener('pointerdown', noteSel);
  $('#results').addEventListener('click', onMain);
  $('#reader').addEventListener('click', onMain);

  $('#summary').addEventListener('click', (e) => {
    const t = e.target.closest('[data-color]');
    if (t) stepColor(Number(t.dataset.color));
    if (e.target.closest('[data-act="back"]')) closeReader();
  });
  $('#summary').addEventListener('change', (e) => {
    if (e.target.id !== 'jumpInput') return;
    const count = S.texts.get(reader.docId)?.length || 1;
    const doc = docById(reader.docId);
    const typed = e.target.value.trim().replace(/[–—]/g, '-');
    // the document's own number first ("2-4", "iv"), then a plain position
    let i = doc?.labels ? doc.labels.findIndex((l) => l && l.toLowerCase() === typed.toLowerCase()) : -1;
    if (i < 0) i = Math.max(1, Math.min(count, Number(typed) || 1)) - 1;
    e.target.value = plabel(doc, i);
    scrollToPage(reader, reader.docId, i);
  });
  $('#summary').addEventListener('keydown', (e) => { if (e.target.id === 'jumpInput' && e.key === 'Enter') e.target.blur(); });
  // while you type a page number it isn't overwritten; once you're done it follows the scroll again
  $('#summary').addEventListener('input', (e) => { if (e.target.id === 'jumpInput') e.target._editing = true; });
  $('#summary').addEventListener('focusout', (e) => { if (e.target.id === 'jumpInput') { e.target._editing = false; trackPosition(); } });
  $('#outline').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    const v = active;
    const info = v.info.get(pkey(b.dataset.doc, Number(b.dataset.n)));
    if (!info || !info.count) { if (innerWidth <= 1240) setPanel(false); scrollToPage(v, b.dataset.doc, Number(b.dataset.n)); return; }
    // First click lands on the page's first hit; clicking the same page again steps through its hits.
    const onPage = v.cur >= info.h0 && v.cur < info.h0 + info.count;
    const k = onPage && b.matches('.ol-p, .ol-row') ? info.h0 + ((v.cur - info.h0 + 1) % info.count) : info.h0;
    if (innerWidth <= 1240) setPanel(false); // the panel covers the page on smaller screens: get out of the way
    goTo(v, k);
  });

  addEventListener('scroll', trackPosition, { passive: true });
  addEventListener('scroll', () => { const m = $('.pop-menu.at-point'); if (m && Math.abs(scrollY - m._at.scrollY) > 24) closeMenu(); }, { passive: true });

  // keyboard
  addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes (inside a text box the box does its own undo)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key) && !$('dialog[open]')) {
      const el = document.activeElement;
      if (!(/INPUT|TEXTAREA|SELECT/.test(el?.tagName) || el?.isContentEditable)) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
        return;
      }
    }
    if (e.key === 'Escape' && $('.pop-menu')) { closeMenu(); return; }
    if (e.key === 'Escape' && themeBarOpen()) { openThemeBar(prefs, { save: savePrefs, glass: applyGlass }); return; }
    if (boards.isOpen()) { if (e.key === 'Escape' && !$('dialog[open]')) boards.close(); return; }
    if (e.key === 'Escape' && document.body.classList.contains('panel')) { setPanel(false); return; }
    if ($('dialog[open]') || e.isComposing) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const a = keyMap.get(combo);
    if (!a) return;
    const el = document.activeElement;
    const typing = /INPUT|TEXTAREA|SELECT/.test(el?.tagName) || el?.isContentEditable;
    if (typing && !worksWhileTyping(combo)) return;
    if (a.id === 'back' && active !== reader) return;
    e.preventDefault();
    a.run();
  });

  // drag & drop anywhere
  let dragDepth = 0;
  resetDrag = () => { dragDepth = 0; };
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    importDrop(e.dataTransfer);
  });

  // mobile drawer
  $('#menuBtn').addEventListener('click', toggleLibrary);
  $('#scrim').addEventListener('click', () => { closeDrawer(); setPanel(false); });

  // keep the floating zoom bar centred on the pages themselves (not the whole window)
  const placeDock = () => {
    const r = $('.col').getBoundingClientRect();
    if (r.width) $('#dock').style.left = `${Math.round(r.left + r.width / 2)}px`;
  };
  // the column changes width when the library or the pages panel comes and goes: keep "fit" fitting
  let colW = 0;
  new ResizeObserver(() => {
    placeDock();
    const w = $('.col').clientWidth;
    if (w && colW && Math.abs(w - colW) > 1 && typeof prefs.zoom === 'string') applyZoom();
    colW = w;
  }).observe($('.col'));
  addEventListener('resize', placeDock);
  placeDock();

  // keep the sticky offset accurate
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--top-h', $('.topbar').offsetHeight + 'px');
  }).observe($('.topbar'));
}
const closeDrawer = () => document.body.classList.remove('drawer');
let resetDrag = () => {};

const MODE_SHORT = { any: 'Any word', all: 'All words', phrase: 'Phrase', near: 'Near', boolean: 'Boolean' };
const MODE_TINY = { any: 'Any', all: 'All', phrase: '“ ”', near: 'Near', boolean: 'Bool' };

// ---------- zoom ----------
const BASE_W = 840; // page width at 100%
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
// measured once per frame: it reads layout, and a results list asks for it once per page
let zoomMemo = null;
function zoomValue() {
  const key = `${prefs.zoom}|${S.pageAspect}`; // (window size isn't part of the key: reading it forces a layout; the memo only lives one frame)
  if (zoomMemo?.key === key) return zoomMemo.v;
  const v = zoomValueNow();
  zoomMemo = { key, v };
  requestAnimationFrame(() => { zoomMemo = null; });
  return v;
}
function zoomValueNow() {
  const z = prefs.zoom;
  if (z === 'width') {
    const w = $('.col')?.clientWidth || BASE_W;
    return Math.min(3, Math.max(0.4, w / BASE_W));
  }
  if (z === 'page') {
    const avail = innerHeight - ($('.topbar')?.offsetHeight || 0) - 48 - 44 - 24;
    const w = Math.min(avail / S.pageAspect, $('.col')?.clientWidth || BASE_W);
    return Math.min(3, Math.max(0.3, w / BASE_W));
  }
  return Math.min(3, Math.max(0.4, Number(z) || 1));
}

// keep the page you're looking at in place while sizes change
function captureAnchor() {
  const y = topOffset() + ($('.doc-head')?.offsetHeight || 0) + 24;
  const x = active.root.getBoundingClientRect().left + active.root.clientWidth / 2;
  const art = document.elementFromPoint(x, y)?.closest?.('.page');
  if (!art) return null;
  const r = art.getBoundingClientRect();
  return { art, y, ratio: (y - r.top) / Math.max(1, r.height) };
}
function restoreAnchor(a) {
  quietAnchor();
  if (!a || !a.art.isConnected) return;
  const r = a.art.getBoundingClientRect();
  window.scrollBy({ top: r.top + a.ratio * r.height - a.y, behavior: 'instant' });
}

let zoomTimer;
function applyZoom() {
  const anchor = captureAnchor();
  document.documentElement.style.setProperty('--z', zoomValue().toFixed(4));
  syncControls();
  restoreAnchor(anchor);
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    // redraw original pages at the new size so they stay sharp
    const a = captureAnchor();
    for (const art of active.pageEls.values()) if (art._cleanup) refill(art);
    requestAnimationFrame(() => restoreAnchor(a));
  }, 260);
}
function setZoom(z) {
  if (prefs.zoom !== z) record('Zoom', { group: 'zoom' });
  prefs.zoom = z;
  savePrefs();
  applyZoom();
}
function zoomBy(dir) {
  const cur = zoomValue();
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > cur + 0.01) : [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.01);
  setZoom(next ?? (dir > 0 ? 3 : 0.5));
}

// ---------- smart navigation ----------
function hitPages(v) {
  const arr = [];
  for (const R of v.list) for (const p of R.pages) if (p.count) arr.push({ R, p });
  return arr;
}
// Which hit page is "current": the one holding the current hit, or the one on screen if you've scrolled away.
function pageCursor(v, arr) {
  const moved = v.navY == null || Math.abs(scrollY - v.navY) > innerHeight * 0.8;
  if (v.cur >= 0 && !moved) {
    return { i: arr.findIndex((x) => v.cur >= x.p.h0 && v.cur < x.p.h0 + x.p.count), inside: true };
  }
  const top = topOffset() + ($('.doc-head')?.offsetHeight || 0);
  let lo = 0, hi = arr.length - 1, idx = arr.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const a = artFor(v, arr[mid].R.doc.id, arr[mid].p.n);
    const r = a ? a.getBoundingClientRect() : { bottom: 0 };
    if (r.bottom > top + 40) { idx = mid; hi = mid - 1; } else lo = mid + 1;
  }
  if (idx >= arr.length) return { i: arr.length - 1, inside: true };
  const a = artFor(v, arr[idx].R.doc.id, arr[idx].p.n);
  return { i: idx, inside: a ? a.getBoundingClientRect().top < top + 60 : true };
}
function stepPage(dir) {
  const v = active;
  const arr = hitPages(v);
  if (!arr.length) return;
  const { i, inside } = pageCursor(v, arr);
  let t = dir > 0 ? (inside ? i + 1 : i) : i - 1;
  t = ((t % arr.length) + arr.length) % arr.length;
  goTo(v, arr[t].p.h0);
}
function stepDoc(dir) {
  const v = active;
  const arr = hitPages(v);
  if (!arr.length) return;
  const { i, inside } = pageCursor(v, arr);
  const docId = arr[i].R.doc.id;
  if (dir > 0) {
    let t = arr.findIndex((x, k) => k > i && x.R.doc.id !== docId);
    if (!inside && t < 0) t = i;
    goTo(v, arr[t < 0 ? 0 : t].p.h0);
  } else {
    // start of this document if we're past its first hit, otherwise the previous document
    let start = i;
    while (start > 0 && arr[start - 1].R.doc.id === docId) start--;
    const atStart = v.cur === arr[start].p.h0 && !(v.navY == null || Math.abs(scrollY - v.navY) > innerHeight * 0.8);
    if (!atStart) { goTo(v, arr[start].p.h0); return; }
    let t = start - 1;
    if (t < 0) t = arr.length - 1;
    const prevDoc = arr[t].R.doc.id;
    while (t > 0 && arr[t - 1].R.doc.id === prevDoc) t--;
    goTo(v, arr[t].p.h0);
  }
}
function pan(dir) {
  window.scrollBy({ top: dir * (innerHeight - topOffset()) * 0.5, behavior: reduceMotion() ? 'instant' : 'smooth' });
}
function currentDocAndPage() {
  const y = topOffset() + ($('.doc-head')?.offsetHeight || 0) + 24;
  const art = document.elementFromPoint(active.root.getBoundingClientRect().left + 40, y)?.closest?.('.page');
  return art ? { docId: art.dataset.doc, n: Number(art.dataset.n) } : null;
}

// ---------- keyboard shortcuts ----------
const MOD = isMac ? 'Cmd' : 'Ctrl';
const ACTIONS = [
  { group: 'Move through results' },
  { id: 'nextHit', label: 'Next hit', keys: ['N', 'F3'], run: () => step(1) },
  { id: 'prevHit', label: 'Previous hit', keys: ['Shift+N', 'Shift+F3'], run: () => step(-1) },
  { id: 'nextPage', label: 'Next page with hits', keys: [']', 'J'], run: () => stepPage(1) },
  { id: 'prevPage', label: 'Previous page with hits', keys: ['[', 'K'], run: () => stepPage(-1) },
  { id: 'nextDoc', label: 'Next document with hits', keys: ['Shift+]'], run: () => stepDoc(1) },
  { id: 'prevDoc', label: 'Previous document with hits', keys: ['Shift+['], run: () => stepDoc(-1) },
  { id: 'firstHit', label: 'First hit', keys: ['G'], run: () => goTo(active, 0) },
  { id: 'lastHit', label: 'Last hit', keys: ['Shift+G'], run: () => goTo(active, active.total - 1) },
  { id: 'panDown', label: 'Pan down half a screen', keys: ['Shift+J'], run: () => pan(1) },
  { id: 'panUp', label: 'Pan up half a screen', keys: ['Shift+K'], run: () => pan(-1) },
  { group: 'Search' },
  { id: 'focusSearch', label: 'Go to the search box', keys: ['/', `${MOD}+K`, `${MOD}+F`], run: () => { q.focus(); q.select(); } },
  ...Object.keys(MODES).map((m, i) => ({ id: `mode_${m}`, label: `Search type: ${MODES[m].label}`, keys: [`Alt+${i + 1}`], run: () => setMode(m) })),
  { id: 'toggleCase', label: 'Match case on/off', keys: ['Alt+C'], run: () => { record('Match case'); prefs.matchCase = !prefs.matchCase; runSearch(); } },
  { id: 'toggleWord', label: 'Whole words on/off', keys: ['Alt+W'], run: () => { record('Whole words'); prefs.wholeWord = !prefs.wholeWord; runSearch(); } },
  { group: 'View' },
  { id: 'zoomIn', label: 'Zoom in', keys: ['=', 'Shift+='], run: () => zoomBy(1) },
  { id: 'zoomOut', label: 'Zoom out', keys: ['-'], run: () => zoomBy(-1) },
  { id: 'zoomReset', label: 'Zoom 100%', keys: ['0'], run: () => setZoom(1) },
  { id: 'fitWidth', label: 'Fit width', keys: ['W'], run: () => setFit('width') },
  { id: 'fitPage', label: 'Fit page', keys: ['F'], run: () => setFit('page') },
  { id: 'fitColumn', label: 'Column view (just the column with your hits)', keys: ['V'], run: () => setFit('column') },
  { id: 'toggleCrop', label: 'Crop result pages to the hits', keys: ['C'], run: () => setCrop(!prefs.crop) },
  { id: 'toggleTrim', label: 'Trim page margins (wide view)', keys: ['M'], run: () => setTrim(!prefs.trim) },
  { id: 'toggleCompact', label: 'Minimize / show the toolbar', keys: ['H'], run: () => toggleCompact() },
  { id: 'toggleLibrary', label: 'Hide / show the library', keys: ['L'], run: () => toggleLibrary() },
  { id: 'readDoc', label: 'Read the whole document you’re on', keys: ['R'], run: () => { const c = currentDocAndPage(); if (c && active === results) openReader(c.docId, c.n); } },
  { id: 'back', label: 'Back to results', keys: ['Escape', 'B'], run: () => closeReader() },
  { id: 'openBoards', label: 'Open your boards', keys: ['Shift+B'], run: () => openBoards() },
  { id: 'openKeys', label: 'Show these shortcuts', keys: ['Shift+/'], run: () => openKeys() },
];
const actionById = (id) => ACTIONS.find((a) => a.id === id);
const bindings = (a) => prefs.keys?.[a.id] ?? a.keys;
let keyMap = new Map();
function buildKeyMap() {
  keyMap = new Map();
  for (const a of ACTIONS) if (a.id) for (const k of bindings(a)) if (!keyMap.has(k)) keyMap.set(k, a);
}
function keyHint(id) {
  const k = bindings(actionById(id))[0];
  return k ? comboLabel(k) : 'no key';
}
function setBindings(id, keys) {
  const a = actionById(id);
  prefs.keys = { ...(prefs.keys || {}) };
  if (JSON.stringify(keys) === JSON.stringify(a.keys)) delete prefs.keys[id];
  else prefs.keys[id] = keys;
  savePrefs();
  buildKeyMap();
  renderKeys();
  syncControls();
}

let recording = null; // action id waiting for a key
function openKeys() {
  closeMenu();
  recording = null;
  renderKeys();
  $('#keys').showModal();
}
function renderKeys() {
  const list = $('#keysList');
  let html = '';
  for (const a of ACTIONS) {
    if (a.group) { html += `<h4>${esc(a.group)}</h4>`; continue; }
    const keys = bindings(a);
    const custom = !!prefs.keys?.[a.id];
    const chips = keys.map((k) => `<button class="kchip" data-id="${a.id}" data-key="${esc(k)}" title="Remove this key"><kbd>${esc(comboLabel(k))}</kbd>${I.x}</button>`).join('');
    const rec = recording === a.id;
    html += `<div class="krow${rec ? ' rec' : ''}"><span class="klabel">${esc(a.label)}</span><span class="kkeys">${chips}${rec ? '<span class="krec">Press a key… <em>Esc to cancel</em></span>' : `<button class="kadd" data-id="${a.id}" title="Add a key">${I.plus}</button>`}${custom ? `<button class="kreset" data-id="${a.id}" title="Back to default">Reset</button>` : ''}</span></div>`;
  }
  list.innerHTML = html;
}

function toggleCompact() {
  prefs.compact = !prefs.compact;
  savePrefs();
  const a = captureAnchor();
  updateChrome();
  requestAnimationFrame(() => { restoreAnchor(a); if (prefs.zoom === 'page') applyZoom(); });
}
// ---------- resizable library ----------
const SIDE_MIN = 200;
const SIDE_DEFAULT = 288;
const sideMax = () => Math.max(SIDE_MIN, Math.min(640, Math.round(innerWidth * 0.5)));
function applySideWidth(w) {
  if (w == null) document.documentElement.style.removeProperty('--side-w-user');
  else document.documentElement.style.setProperty('--side-w-user', Math.round(w) + 'px');
}
function bindSideResize() {
  const handle = $('#sideResize');
  let drag = null;
  let raf = 0;
  const finish = () => {
    if (prefs.zoom === 'width') applyZoom();
    savePrefs();
  };
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { left: $('.sidebar').getBoundingClientRect().left, w: prefs.sideW || SIDE_DEFAULT };
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('side-resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const raw = e.clientX - drag.left;
    // drag far enough left and letting go hides the library
    document.body.classList.toggle('side-collapsing', raw < 140);
    const w = Math.max(SIDE_MIN, Math.min(sideMax(), raw));
    drag.cur = raw;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { prefs.sideW = w; applySideWidth(w); });
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove('side-resizing', 'side-collapsing');
    if (d.cur != null && d.cur < 140) {
      prefs.sideW = d.w;
      applySideWidth(d.w);
      toggleLibrary();
      toast(`Library hidden — press ${keyHint('toggleLibrary')} or ☰ to bring it back`, { ms: 2600 });
    }
    finish();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => { delete prefs.sideW; applySideWidth(null); finish(); });
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = Math.max(SIDE_MIN, Math.min(sideMax(), (prefs.sideW || SIDE_DEFAULT) + (e.key === 'ArrowRight' ? 24 : -24)));
    prefs.sideW = w;
    applySideWidth(w);
    finish();
  });
}

function toggleLibrary() {
  if (innerWidth <= 900) { document.body.classList.toggle('drawer'); return; }
  prefs.sideHidden = !prefs.sideHidden;
  savePrefs();
  syncControls();
  if (prefs.zoom === 'width') applyZoom();
}
function setView(view) {
  if (prefs.view === view) return;
  record(view === 'text' ? 'Text pages' : 'Original pages');
  prefs.view = view;
  savePrefs();
  override.clear();
  syncControls();
  if (active.list.some((R) => R.doc.kind === 'html') || (active === reader && docById(reader.docId)?.kind === 'html')) renderView(active);
  else refreshInPlace(active);
  if (active === reader) results.dirty = true;
}

// ---------- search type picker ----------
// One list for both ways of using it: tap the pill to open it and tap a type, or press the pill,
// slide onto a type and let go. Only the row under your finger when you let go is picked — letting go
// anywhere else changes nothing.
const NEAR_STEPS = [2, 3, 5, 8, 12, 20, 40, 80];
const PICK_HINT = { any: 'Any of the words', all: 'Every word, anywhere on the page', phrase: 'The words together, in order', near: 'All the words close together', boolean: 'AND, OR, NOT and ( )' };
function pickerHtml() {
  const opts = Object.keys(MODES).map((m) => `<button class="pk-opt${prefs.mode === m ? ' on' : ''}" data-mode="${m}" role="option" aria-selected="${prefs.mode === m}"><span class="pk-txt"><b>${MODES[m].label}</b><span>${PICK_HINT[m] || MODES[m].hint}</span></span>${I.check}</button>`).join('');
  const near = prefs.mode === 'near'
    ? `<div class="pk-near"><span>Within</span><button class="pk-step" data-near="-1" aria-label="Fewer words apart">${I.minus}</button><b>${fmt(Number(prefs.near) || 8)}</b><button class="pk-step" data-near="1" aria-label="More words apart">${I.plus}</button><span>words</span></div>`
    : '';
  return `<div class="pk-opts" role="listbox" aria-label="Search type">${opts}</div>${near}<div class="pk-togs"><button class="pk-tog" data-tog="case" aria-pressed="${prefs.matchCase}"><i>Aa</i>Match case</button><button class="pk-tog" data-tog="word" aria-pressed="${prefs.wholeWord}"><i><u>ab</u></i>Whole words</button></div><div class="pk-where"><span>Look in</span><div class="pk-wseg">${Object.entries(WHERE).map(([k, w]) => `<button type="button" data-where="${k}" aria-pressed="${(prefs.where || 'any') === k}">${w.label}</button>`).join('')}</div></div>`;
}
const pickerFor = (anchor) => { const m = $('.picker'); return m && m._anchor === anchor ? m : null; };
function openPicker(anchor) {
  closeMenu();
  const m = el('div', 'pop-menu picker', pickerHtml());
  m._anchor = anchor;
  m.addEventListener('click', (e) => {
    e.stopPropagation();
    const o = e.target.closest('.pk-opt');
    if (o) { closeMenu(); setMode(o.dataset.mode); return; }
    const t = e.target.closest('[data-tog]');
    if (t) {
      record(t.dataset.tog === 'case' ? 'Match case' : 'Whole words');
      if (t.dataset.tog === 'case') prefs.matchCase = !prefs.matchCase;
      else prefs.wholeWord = !prefs.wholeWord;
    }
    const wh = e.target.closest('[data-where]');
    if (wh) { record('Look in'); prefs.where = wh.dataset.where; }
    const n = e.target.closest('[data-near]');
    if (n) {
      const cur = Number(prefs.near) || 8;
      record('Near distance', { group: 'near' });
      prefs.near = Number(n.dataset.near) > 0 ? (NEAR_STEPS.find((x) => x > cur) ?? cur) : ([...NEAR_STEPS].reverse().find((x) => x < cur) ?? cur);
    }
    if (!t && !n && !wh) return;
    syncControls();
    runSearch();
    m.innerHTML = pickerHtml();
    placeMenu(m);
  });
  document.body.append(m);
  anchor.classList.add('menu-open');
  placeMenu(m);
  return m;
}
function bindModePicker(anchor) {
  let st = null;
  const rowAt = (x, y) => {
    const m = pickerFor(anchor);
    if (!m) return null;
    for (const o of m.querySelectorAll('.pk-opt')) {
      const r = o.getBoundingClientRect();
      if (y >= r.top && y < r.bottom && x >= r.left - 48 && x <= r.right + 48) return o;
    }
    return null;
  };
  const light = (o) => {
    if (o === st.hot) return;
    st.hot?.classList.remove('hot');
    o?.classList.add('hot');
    st.hot = o;
    if (o) navigator.vibrate?.(4);
  };
  anchor.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or focus jump on a long press
    const wasOpen = !!pickerFor(anchor);
    if (!wasOpen) openPicker(anchor);
    st = { x: e.clientX, y: e.clientY, moved: false, wasOpen, hot: null };
    anchor.setPointerCapture(e.pointerId);
    anchor.classList.add('pressing');
  });
  bar.resets.push(() => { if (st) { st = null; anchor.classList.remove('pressing'); } });
  anchor.addEventListener('pointermove', (e) => {
    if (!st || bar.swiping) return;
    if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) st.moved = true;
    if (st.moved) light(rowAt(e.clientX, e.clientY));
  });
  const end = (e, ok) => {
    if (!st) return;
    const s = st;
    st = null;
    anchor.classList.remove('pressing');
    s.hot?.classList.remove('hot');
    if (!ok) return;
    if (s.moved) {
      const o = rowAt(e.clientX, e.clientY);
      const r = anchor.getBoundingClientRect();
      const onPill = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (o) { closeMenu(); setMode(o.dataset.mode); navigator.vibrate?.(8); }
      else if (!onPill) closeMenu(); // slid off the list: nothing changes
      return;
    }
    if (s.wasOpen) closeMenu(); // tapping the pill again closes the list
  };
  anchor.addEventListener('pointerup', (e) => end(e, true));
  anchor.addEventListener('pointercancel', (e) => end(e, false));
  anchor.addEventListener('click', (e) => {
    e.stopPropagation(); // the pointer handlers already acted; don't let the page close the list we just opened
    if (e.detail !== 0) return;
    if (pickerFor(anchor)) closeMenu(); // keyboard: Enter / Space toggles it
    else openPicker(anchor).querySelector('.pk-opt.on')?.focus({ preventScroll: true });
  });
}

// Press and hold (or press and slide) opens the menu; slide onto an option and let go to pick it.
// A plain tap opens the same menu to tap through.
function bindHoldMenu(el, getItems) {
  let st = null;
  const hot = (x, y) => {
    let found = null;
    for (const it of $$('.pop-menu :is(.menu-item, .mp-row [data-v])')) {
      const r = it.getBoundingClientRect();
      const on = !it.disabled && y >= r.top && y < r.bottom && x > r.left - 60 && x < r.right + 60;
      it.classList.toggle('hot', on);
      if (on) found = it;
    }
    if (found && st && found !== st.last) { st.last = found; navigator.vibrate?.(4); }
    return found;
  };
  const open = () => {
    st.open = true;
    clearTimeout(st.timer);
    closeMenu();
    openMenu(el, getItems);
    el.classList.add('holding');
    navigator.vibrate?.(8);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const wasOpen = el.classList.contains('menu-open');
    st = { x: e.clientX, y: e.clientY, open: false, wasOpen };
    el.setPointerCapture(e.pointerId);
    st.timer = setTimeout(open, 240);
  });
  bar.resets.push(() => { if (st) { clearTimeout(st.timer); st = null; el.classList.remove('holding'); } });
  el.addEventListener('pointermove', (e) => {
    if (!st || bar.swiping) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.open && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) open();
    if (st.open) hot(e.clientX, e.clientY);
  });
  const end = (e, apply) => {
    if (!st) return;
    clearTimeout(st.timer);
    const s = st;
    st = null;
    el.classList.remove('holding');
    if (s.open) {
      const target = apply && e ? hot(e.clientX, e.clientY) : null;
      if (target) target.click();
      else if (apply && e && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) closeMenu(); // slid off: nothing picked
      // held still and let go: leave the menu open to tap
    } else if (apply) {
      if (s.wasOpen) closeMenu(); else openMenu(el, getItems);
    }
  };
  el.addEventListener('pointerup', (e) => end(e, true));
  el.addEventListener('pointercancel', () => end(null, false));
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail === 0) openMenu(el, getItems);
  });
}

// A row of buttons in a menu panel. Each button has data-v; `act(v)` runs and the panel redraws in place.
function panelRow(cls, html, act) {
  return () => {
    const r = el('div', `mp-row ${cls}`, html);
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      e.stopPropagation();
      if (!b || b.disabled) return;
      act(b.dataset.v);
      redrawMenu();
    });
    return r;
  };
}
function redrawMenu() {
  const m = $('.pop-menu');
  if (!m?._items) return;
  fillMenu(m, m._items());
  placeMenu(m);
}
const on = (b) => `aria-pressed="${!!b}"`;
function moreItems() {
  const items = [];
  items.push({ header: 'Zoom' },
    { node: panelRow('zoom-row', `<button class="pk-step" data-v="-1" aria-label="Zoom out">${I.minus}</button><button class="mp-zoom" data-v="1">${Math.round(zoomValue() * 100)}%</button><button class="pk-step" data-v="+1" aria-label="Zoom in">${I.plus}</button>`,
      (v) => (v === '1' ? setZoom(1) : zoomBy(Number(v)))) },
    { node: panelRow('two three', `<button class="pk-tog" data-v="width" ${on(prefs.zoom === 'width' && !prefs.columns)}>${I.fitW}Width</button>${S.docs.some((d) => d.kind === 'pdf') ? `<button class="pk-tog" data-v="column" ${on(prefs.columns)} title="Show just the column(s) with your hits, filling the width">${I.columns}Column</button>` : ''}<button class="pk-tog" data-v="page" ${on(prefs.zoom === 'page' && !prefs.columns)}>${I.fitP}Page</button>`,
      (v) => setFit(v)) });
  const crop = active === results;
  const trim = S.docs.some((d) => d.kind === 'pdf');
  if (crop || trim) {
    items.push({ header: 'Fit to the text' }, { node: panelRow('two', `${crop ? `<button class="pk-tog" data-v="crop" ${on(prefs.crop)}>${I.crop}Crop to hits</button>` : ''}${trim ? `<button class="pk-tog" data-v="trim" ${on(prefs.trim)}>${I.wide}Trim margins</button>` : ''}`,
      (v) => (v === 'crop' ? setCrop(!prefs.crop) : setTrim(!prefs.trim))) });
    if (crop && prefs.crop) items.push({ node: cropSliderRow });
  }
  if (active === results) {
    items.push({ header: 'Next & previous page' }, { node: panelRow('seg-row', `<div class="seg">${[['tabs', 'Tabs'], ['swipe', 'Swipe']].map(([k, l]) => `<button data-v="${k}" ${on(prefs.pageNav === k)}>${l}</button>`).join('')}</div>`,
      (v) => setPageNav(v)) });
  }
  items.push({ header: 'Search' }, { node: panelRow('two', `<button class="pk-tog" data-v="case" ${on(prefs.matchCase)}><i>Aa</i>Match case</button><button class="pk-tog" data-v="word" ${on(prefs.wholeWord)}><i><u>ab</u></i>Whole words</button>`,
    (v) => { record(v === 'case' ? 'Match case' : 'Whole words'); if (v === 'case') prefs.matchCase = !prefs.matchCase; else prefs.wholeWord = !prefs.wholeWord; syncControls(); runSearch(); }) });
  if (active === results) {
    items.push({ header: 'Sort by most hits' }, { node: panelRow('seg-row', `<div class="seg">${[['library', 'Library', 'Library order'], ['hits', 'Documents', 'Documents with most hits'], ['pages', 'Pages', 'Pages with most hits']].map(([k, label, title]) => `<button data-v="${k}" title="${title}" ${on(prefs.sort === k)}>${label}</button>`).join('')}</div>`,
      (v) => { if (prefs.sort !== v) record('Sort'); prefs.sort = v; runSearch(); }) });
  }
  items.push({ sep: true }, { node: panelRow('two', `<button class="pk-tog" data-v="theme">${I.palette}Theme</button><button class="pk-tog" data-v="boards">${I.board}Boards</button>`,
    (v) => (v === 'theme' ? openThemes() : openBoards())) },
  { node: panelRow('two', `${active === reader ? `<button class="pk-tog" data-v="back">${I.arrowLeft}Results</button>` : ''}<button class="pk-tog" data-v="lib">${I.folder}Library</button>`,
    (v) => { closeMenu(); if (v === 'back') closeReader(); else toggleLibrary(); }) });
  return items;
}

// Switch one page between its extracted text and the original.
function togglePageMode(art) {
  const sec = art.closest('.doc-sec');
  const doc = docById(art.dataset.doc);
  const n = Number(art.dataset.n);
  record(pageMode(doc, n) === 'original' ? `Page ${plabel(doc, n)} as text` : `Page ${plabel(doc, n)} original`);
  if (doc.kind === 'html') {
    override.set(pkey(doc.id, WEB), pageMode(doc, n) === 'original' ? 'text' : 'original');
    const v = art._v;
    if (sec && !sec.classList.contains('ranked')) {
      for (const [key, a] of [...v.pageEls]) if (a.dataset.doc === doc.id && sec.contains(a)) { io.unobserve(a); ioFar.unobserve(a); a._prevCleanup?.(); a._cleanup?.(); v.pageEls.delete(key); }
      const R = v.kind === 'reader' ? v.list[0] : v.byKey?.get(sec.dataset.key);
      const fresh = sectionEl(v, doc, R);
      sec.replaceWith(fresh);
      for (const a of v.pageEls.values()) if (fresh.contains(a)) { const r = a.getBoundingClientRect(); if (r.bottom > -innerHeight && r.top < innerHeight * 2) fill(a); }
      if (pageMode(doc, n) === 'original') scrollToEl(fresh, 'start', 'instant');
    } else refill(art);
    return;
  }
  override.set(pkey(doc.id, n), pageMode(doc, n) === 'original' ? 'text' : 'original');
  refill(art);
}

// ---------- page popup ----------
// Everything you can do with a page, from a tap on it.
function pageItems(art) {
  const v = art._v;
  const doc = docById(art.dataset.doc);
  const n = Number(art.dataset.n);
  const items = [{ header: art._web ? doc.name : `Page ${plabel(doc, n)}` }];
  if (v.kind === 'results' && !art._web) {
    const prev = art.previousElementSibling || art.closest('.doc-sec')?.previousElementSibling?.querySelector(':scope > .doc-pages')?.lastElementChild;
    const next = art.nextElementSibling;
    const unfold = '<svg viewBox="0 0 24 24"><path d="M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>';
    const hiddenIn = (g) => Number(g.dataset.b) - Number(g.dataset.a) - 1;
    if (prev?.classList.contains('gap') && Number(prev.dataset.b) === n) {
      items.push({ label: `Show page ${n} above`, icon: I.up, run: () => onGap(prev, 'before') });
      if (hiddenIn(prev) > 1 && !art._flat) items.push({ label: `Show all ${hiddenIn(prev)} pages above`, sub: `Pages ${Number(prev.dataset.a) + 2}–${n}`, icon: unfold, run: () => onGap(prev, 'all') });
    }
    if (next?.classList.contains('gap') && Number(next.dataset.a) === n) {
      items.push({ label: `Show page ${n + 2} below`, icon: I.down, run: () => onGap(next, 'after') });
      if (hiddenIn(next) > 1 && !art._flat) items.push({ label: `Show all ${hiddenIn(next)} pages below`, sub: `Pages ${n + 2}–${Number(next.dataset.b)}`, icon: unfold, run: () => onGap(next, 'all') });
    }
    if (cropWanted(art)) {
      if (art.lastElementChild.classList.contains('cropped')) items.push({ label: 'Show the whole page', icon: I.expand, run: () => expandCrop(art, 'all') });
      else if (cropOpen.has(pkey(doc.id, n))) items.push({ label: 'Crop to the hits again', icon: I.crop, run: () => expandCrop(art, 'crop') });
    }
  }
  if (art._flat && doc.kind === 'html') items.push({ label: 'Open the web page', icon: I.globe, run: () => { override.set(pkey(doc.id, WEB), 'original'); openReader(doc.id, n); } });
  if (v.kind === 'results') items.push({ label: 'Read it in the document', icon: I.book, run: () => openReader(doc.id, art._web ? undefined : n) });
  const text = art._web ? '' : S.texts.get(doc.id)?.[n] || '';
  if (text.trim()) items.push({ label: 'Copy the page’s text', icon: I.copy, run: () => toast(copyText(doc.kind === 'pdf' ? reflow(text) : text) ? 'Page text copied' : 'Couldn’t copy', { ms: 1600 }) });
  const save = art._web ? [] : saveItems(art);
  items.push({ label: 'Copy link to this page', sub: 'Same search, document and page', icon: I.link, run: () => toast(copyText(searchLink(doc, art._web ? null : n)) ? 'Link copied' : 'Couldn’t copy', { ms: 1600 }) });
  items.push({ sep: true });
  if (!art._web) items.push({ label: 'Add to board', icon: I.board, submenu: () => boards.menuItems(() => boardSeed(art)) });
  if (save.length) items.push({ label: 'Save as…', icon: I.save, submenu: () => save });
  return items;
}

// ---------- boards ----------
// What gets saved to a board: the page exactly as it's shown (cropped band, columns, trimmed margins…) as a
// picture, plus its text so it can be searched; text pages are kept as text.
function pageExcerpt(art) {
  const doc = docById(art.dataset.doc);
  const raw = S.texts.get(doc.id)?.[Number(art.dataset.n)] || '';
  const t = doc.kind === 'pdf' ? reflow(raw) : raw;
  if (!art._band || art._regions) return t.slice(0, 6000).trim();
  const a = Math.floor(art._band[0] * t.length), b = Math.ceil(art._band[1] * t.length);
  const from = Math.max(0, t.lastIndexOf(' ', a) + 1), to = t.indexOf(' ', b);
  return t.slice(from, to < 0 ? undefined : to).trim();
}
async function boardSeed(art) {
  const doc = docById(art.dataset.doc);
  const n = Number(art.dataset.n);
  const base = { docId: doc.id, docName: doc.name, n, q: prefs.q || q.value, mode: prefs.mode, title: '', text: pageExcerpt(art) };
  if (doc.kind === 'pdf' && art.querySelector('.pdf-frame:not(.clone)')) {
    const c = await pageCanvas(art, true, 1200);
    const image = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    const out = { ...base, image, w: c.width, h: c.height, cropped: !!(art._band || art._regions) };
    c.width = c.height = 0;
    return out;
  }
  return base;
}
const boards = initBoards({
  pageLabel: (docId, n) => plabel(docById(docId), n),
  esc, el, I, toast, recordCustom,
  pinIcon: I.pin,
  searchIcon: I.search,
  menu: (anchor, items) => openMenu(anchor, items),
  hasDoc: (id) => !!docById(id),
  openDoc: (id, n) => {
    if (!docById(id)) { toast('That document isn’t in your library any more'); return; }
    if (active === reader && reader.docId === id) scrollToPage(reader, id, n ?? 0);
    else openReader(id, n ?? 0);
  },
  search: (text, mode) => {
    record('Search');
    H.busy = true;
    try {
      if (mode && MODES[mode]) prefs.mode = mode;
      if (active === reader) closeReader();
      q.value = text || '';
      runSearch();
      syncControls();
    } finally { H.busy = false; }
  },
  copy: (text) => toast(copyText(text) ? 'Copied' : 'Couldn’t copy', { ms: 1400 }),
  saveBlob,
});
function openBoards() {
  closeMenu();
  closeDrawer();
  boards.open();
}

// ---------- saving a page, or the part of it you're looking at ----------
const fileStem = (name) => (name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'page');
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
function saveItems(art) {
  const doc = docById(art.dataset.doc);
  const n = Number(art.dataset.n);
  const stem = `${fileStem(doc.name)} p${plabel(doc, n).replace(/[\\/:*?"<>|]/g, "-")}`;
  const items = [];
  if (doc.kind === 'pdf') {
    const cut = !!art.querySelector('.pdf-frame') && art.lastElementChild.classList.contains('cropped');
    const run = (section, kind) => () => savePage(art, { section, kind, name: `${stem}${section ? ' (section)' : ''}` });
    if (cut) items.push({ header: 'This section' }, { label: 'Image (PNG)', icon: I.image, run: run(true, 'png') }, { label: 'PDF', icon: I.text, run: run(true, 'pdf') });
    items.push({ header: 'Whole page' }, { label: 'Image (PNG)', icon: I.image, run: run(false, 'png') }, { label: 'PDF', icon: I.text, run: run(false, 'pdf') });
  }
  const text = S.texts.get(doc.id)?.[n] || '';
  if (text.trim()) items.push(...(items.length ? [{ sep: true }] : []), { label: 'Text file', icon: I.text, run: () => saveBlob(new Blob([doc.kind === 'pdf' ? reflow(text) : text], { type: 'text/plain' }), `${stem}.txt`) });
  return items;
}
// Draws the page sharply (with the highlights you see), cut to what's on screen when `section` is set.
async function pageCanvas(art, section, width = 2000) {
  const doc = docById(art.dataset.doc);
  const n = Number(art.dataset.n);
  const pdf = await getPdf(doc.id, () => store.file(doc.id));
  const page = await pdf.getPage(n + 1);
  const base = page.getViewport({ scale: 1 });
  let x = [0, 1], y = [0, 1];
  const frame = art.querySelector('.pdf-frame:not(.clone)');
  if (section) {
    if (frame?.dataset.tx) x = frame.dataset.tx.split(',').map(Number);
    if (art._band) y = art._band;
  }
  const regions = section && art._regions?.length ? art._regions : [{ x, y }];
  const narrow = Math.min(...regions.map((r) => r.x[1] - r.x[0]));
  const scale = Math.min(width / (base.width * narrow), 4096 / base.width, 4096 / base.height);
  const vp = page.getViewport({ scale });
  const full = document.createElement('canvas');
  full.width = Math.floor(vp.width);
  full.height = Math.floor(vp.height);
  const ctx = full.getContext('2d', { alpha: false });
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  // the highlights, as shown
  ctx.globalCompositeOperation = 'multiply';
  for (const b of frame?.querySelectorAll('.pdf-hits .box') || []) {
    const cs = getComputedStyle(b);
    const L = (parseFloat(b.style.left) / 100) * full.width, T = (parseFloat(b.style.top) / 100) * full.height;
    const W = (parseFloat(b.style.width) / 100) * full.width, H = (parseFloat(b.style.height) / 100) * full.height;
    if (b.classList.contains('m')) { ctx.fillStyle = cs.backgroundColor; ctx.fillRect(L, T, W, H); }
    else { ctx.fillStyle = cs.borderBottomColor; ctx.fillRect(L, T + H - 2 * scale, W, 2 * scale); }
  }
  ctx.globalCompositeOperation = 'source-over';
  // one piece, or the column pieces stacked like they're shown, each as wide as the picture
  const cuts = regions.map((r) => ({ sx: Math.floor(r.x[0] * full.width), sy: Math.floor(r.y[0] * full.height), sw: Math.max(1, Math.round((r.x[1] - r.x[0]) * full.width)), sh: Math.max(1, Math.round((r.y[1] - r.y[0]) * full.height)) }));
  const W = Math.max(...cuts.map((c) => c.sw));
  const gap = cuts.length > 1 ? Math.round(W * 0.02) : 0;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = cuts.reduce((h, c) => h + Math.round((c.sh * W) / c.sw), 0) + gap * (cuts.length - 1);
  const oc = out.getContext('2d', { alpha: false });
  oc.fillStyle = '#fff';
  oc.fillRect(0, 0, out.width, out.height);
  let at = 0;
  for (const c of cuts) {
    const h = Math.round((c.sh * W) / c.sw);
    oc.drawImage(full, c.sx, c.sy, c.sw, c.sh, 0, at, W, h);
    at += h + gap;
    if (gap) { oc.fillStyle = '#e3e0da'; oc.fillRect(0, at - gap / 2 - 1, W, 2); }
  }
  full.width = full.height = 0;
  return out;
}
// A one-page PDF holding a JPEG, sized to a letter-width page.
function jpegPdf(jpeg, w, h) {
  const enc = new TextEncoder();
  const parts = [];
  const at = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const pw = 612, ph = +(612 * h / w).toFixed(2);
  const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10])); // %PDF-1.4 + binary marker
  at[1] = len; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  at[2] = len; push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  at[3] = len; push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  at[4] = len; push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); push(jpeg); push('\nendstream\nendobj\n');
  at[5] = len; push(`5 0 obj\n<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((i) => `${String(at[i]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
async function savePage(art, { section, kind, name }) {
  toast(kind === 'pdf' ? 'Making the PDF…' : 'Making the image…', { ms: 1500 });
  try {
    const c = await pageCanvas(art, section);
    const blob = await new Promise((r) => c.toBlob(r, kind === 'pdf' ? 'image/jpeg' : 'image/png', 0.92));
    if (!blob) throw new Error('the page was too big to draw');
    if (kind === 'pdf') saveBlob(jpegPdf(new Uint8Array(await blob.arrayBuffer()), c.width, c.height), `${name}.pdf`);
    else saveBlob(blob, `${name}.png`);
    c.width = c.height = 0;
  } catch (err) {
    toast(`Couldn’t save it (${err.message})`);
  }
}

// The "lines around the hits" slider, as a row in the phone's options menu.
function cropSliderRow() {
  const row = el('div', 'menu-range', `<span>Lines around hits</span><span class="stepper"><button data-d="-1" aria-label="Fewer lines">${I.minus}</button><output>±${prefs.cropLines}</output><button data-d="1" aria-label="More lines">${I.plus}</button></span>`);
  const sync = () => {
    row.querySelector('output').textContent = `±${prefs.cropLines}`;
    row.querySelector('[data-d="-1"]').disabled = prefs.cropLines <= 1;
    row.querySelector('[data-d="1"]').disabled = prefs.cropLines >= 15;
  };
  sync();
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-d]');
    if (b) { setCropLines(prefs.cropLines + Number(b.dataset.d)); sync(); }
  });
  return row;
}

// Slide along the hit counter to scrub through hits one by one; tap it for the next hit.
function bindJog(el) {
  let j = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !active.total) return;
    const v = active;
    const moved = v.navY == null || Math.abs(scrollY - v.navY) > innerHeight * 0.8;
    j = { x: e.clientX, t: performance.now(), start: v.cur >= 0 && !moved ? v.cur : Math.max(0, startFromViewport(v, 1)), moved: false, last: v.cur };
    el.setPointerCapture(e.pointerId);
  });
  bar.resets.push(() => { if (j) { j = null; el.classList.remove('jogging'); bar.jogging = false; } });
  el.addEventListener('pointermove', (e) => {
    if (!j || bar.swiping) return;
    const dx = e.clientX - j.x;
    // hold a moment, then slide, to scrub; a quick flick is the bar's undo/redo swipe
    if (!j.moved && Math.abs(dx) > 8) {
      if (performance.now() - j.t < 300) return;
      j.moved = true;
      bar.jogging = true;
      el.classList.add('jogging');
    }
    if (!j.moved) return;
    const k = Math.max(0, Math.min(active.total - 1, j.start + Math.trunc(dx / 22)));
    if (k !== j.last) { j.last = k; navigator.vibrate?.(3); goTo(active, k, { instant: true }); }
  });
  const end = (apply) => {
    if (!j) return;
    const s = j;
    j = null;
    el.classList.remove('jogging');
    bar.jogging = false;
    if (!s.moved && apply && !bar.swiping && performance.now() - bar.justSwiped > 450) step(1);
  };
  el.addEventListener('pointerup', () => end(true));
  el.addEventListener('pointercancel', () => end(false));
  el.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0) step(1); });
}

// On phones the top bar slides away while you read and comes back when you scroll up.
let lastScrollY = 0;
// A page's label only gets its frosted backing once it's stuck under the headers (then the page scrolls
// beneath it); until then it's see-through, so the tabs and arrows beside it show and can be tapped.
let stuckRaf = 0;
const stuckNow = new Set();
// Only pages crossing the top of the screen can have a stuck header, so only those are measured each frame
// (measuring every page above the screen made scrolling heavier the further down you went).
const nearTop = new Set();
const nearTopIO = new IntersectionObserver((es) => {
  for (const e of es) {
    if (e.isIntersecting) { nearTop.add(e.target); if (barMax) placeHeads(e.target, Math.round(barOff)); } // catch up as it arrives
    else nearTop.delete(e.target);
  }
}, { rootMargin: '0px 0px -55% 0px' });
function markStuck() {
  if (stuckRaf) return;
  stuckRaf = requestAnimationFrame(() => {
    stuckRaf = 0;
    const view = document.body.dataset.view === 'reader' ? $('#reader') : $('#results');
    const now = new Set();
    for (const art of nearTop) {
      if (!art.isConnected) { nearTop.delete(art); continue; }
      if (art.hidden || !view.contains(art)) continue;
      const a = art.getBoundingClientRect();
      if (a.top > 320) continue;
      if (a.bottom < 0) continue;
      const head = art.firstElementChild;
      if (head?.classList.contains('page-head') && head.getBoundingClientRect().top - a.top > 0.5) now.add(head);
    }
    for (const h of stuckNow) if (!now.has(h)) h.classList.remove('stuck');
    for (const h of now) h.classList.add('stuck');
    stuckNow.clear();
    now.forEach((h) => stuckNow.add(h));
  });
}
addEventListener('scroll', markStuck, { passive: true });
addEventListener('resize', markStuck);

// The headers stuck under the top bar glide up and down with it (moved with transforms, not by animating
// their sticky position, so nothing gaps or stutters while you scroll).
const BAR_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
// The top bar follows your finger: it slides up by exactly as much as you scroll down (and back down as you
// scroll up), the sticky headers move with it, and nothing jumps. When you let go a half-out bar finishes the
// way you were going: scrolling down tucks it away, pulling back up brings it all the way in.
let barOff = 0, barMax = 0, barAnim = 0, barSnapT = 0, touching = false, barDir = 1, barRun = 0, barGoal = 0;
const BAR_MS = 320; // how long the bar takes to glide out or in
const safeProbe = () => {
  let p = $('#safeProbe');
  if (!p) { p = el('div'); p.id = 'safeProbe'; p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none'; document.body.append(p); }
  return p.offsetHeight;
};
let barSafe = 0, barView = '';
function measureBar() {
  barSafe = safeProbe();
  barView = document.body.dataset.view || '';
  const t = $('.topbar');
  barMax = t ? t.offsetHeight + 2 : 0; // all the way out; the sticky headers stop under the status bar (see ios.css)
  // reading a document: only the search row tucks away; the title row (back, name, page box) stays, just
  // under the status bar
  const sum = barView === 'reader' && t ? $('#summary') : null;
  if (sum && sum.offsetHeight) barMax = Math.max(0, sum.getBoundingClientRect().top - t.getBoundingClientRect().top + barOff - barSafe - 4);
}
// Smoothness: the offset is drawn once per frame, in whole pixels (half pixels make the bar and its text
// shimmer), and only on what moves: the bar and the headers of the few pages at the top of the screen.
// (A shared CSS variable made every element in the results restyle each frame, thousands on PDF pages.)
let barDrawn = -1, barRaf = 0;
function placeHeads(art, px) {
  if (!isPhone()) return;
  const safe = barSafe, topH = Math.max(0, barMax - 2);
  const t = Math.max(safe, topH - px);
  const sec = art.closest('.doc-sec');
  const dh = sec?.querySelector(':scope > .doc-head');
  if (dh) dh.style.top = `${t}px`;
}
function drawBar() {
  barRaf = 0;
  const px = Math.round(barOff);
  if (px === barDrawn) return;
  barDrawn = px;
  const tb = $('.topbar');
  if (tb) tb.style.transform = px ? `translateY(${-px}px)` : '';
  // reading a document the search row slides up under the status bar while the title row stays: fade it as it goes
  const sr = barView === 'reader' ? $('.search-row') : null;
  if (sr) sr.style.opacity = barMax ? String(Math.max(0, 1 - px / (barMax * 0.75)).toFixed(2)) : '';
  else if (barDrawn === px) $('.search-row')?.style.removeProperty('opacity');
  for (const art of nearTop) placeHeads(art, px);
  document.body.classList.toggle('bar-hidden', barMax > 0 && barOff >= barMax - 0.5);
  markStuck();
}
function putBar(v) {
  barOff = Math.max(0, Math.min(barMax, v));
  if (!barRaf) barRaf = requestAnimationFrame(drawBar);
}
function glideBar(to, ms = 240) {
  barGoal = to;
  cancelAnimationFrame(barAnim);
  const from = barOff;
  if (Math.abs(to - from) < 0.5) { putBar(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in and out
    putBar(from + (to - from) * e);
    cancelAnimationFrame(barRaf);
    drawBar(); // already inside a frame: draw now, not next frame
    if (k < 1) barAnim = requestAnimationFrame(step);
  };
  barAnim = requestAnimationFrame(step);
}
function settleBar() {
  return; // the bar glides on its own now (see onScrollBars)
  if (touching) return; // wait until the finger is off and the scroll has come to rest
  if (barOff > 0 && barOff < barMax) glideBar(barDir < 0 ? 0 : barMax);
}
function setBarHidden(h) {
  if (!barMax) measureBar();
  glideBar(h ? barMax : 0);
}
addEventListener('touchstart', () => { touching = true; clearTimeout(barSnapT); cancelAnimationFrame(barAnim); }, { passive: true });
addEventListener('touchend', () => { touching = false; clearTimeout(barSnapT); barSnapT = setTimeout(settleBar, 160); }, { passive: true });
addEventListener('touchcancel', () => { touching = false; clearTimeout(barSnapT); barSnapT = setTimeout(settleBar, 160); }, { passive: true });
addEventListener('resize', () => { measureBar(); putBar(barOff); });
function onScrollBars() {
  const y = scrollY;
  const dy = y - lastScrollY;
  lastScrollY = y;
  if (performance.now() < autoScrollUntil) return;
  if (!isPhone() || document.activeElement === q || document.body.classList.contains('drawer') || $('.pop-menu')) {
    if (barOff && barGoal !== 0) glideBar(0);
    return;
  }
  if (!barMax || barView !== (document.body.dataset.view || '')) measureBar();
  // The bar doesn't follow your finger: once you've scrolled a little one way it glides all the way out
  // (or back in) at an easy pace, and stays put until you turn around.
  if (Math.sign(dy) !== Math.sign(barRun)) barRun = 0;
  barRun += dy;
  const want = y <= 4 ? 0 : barRun > 14 ? barMax : barRun < -14 ? 0 : null;
  if (want != null && want !== barGoal) { barGoal = want; glideBar(want, BAR_MS); }
}

function setMode(mode) {
  if (!MODES[mode] || prefs.mode === mode) return;
  record('Search type');
  prefs.mode = mode;
  syncControls();
  runSearch();
}

// ---------- links to a search ----------
// A link like …/#find?q=dihedral&t=near&n=8&doc=07_phak_ch5.pdf&p=19&src=https://… opens the app with that
// search, in that one document, at that page. "Copy link to this page" in a page's tap menu makes one, so you
// can drop it in your notes. If the document isn't in this library yet, src lets the app download it first.
const APP_WEB = 'https://instant-search-virid.vercel.app/';
function searchLink(doc, n) {
  const p = new URLSearchParams();
  if (q.value.trim()) p.set('q', q.value.trim());
  p.set('t', prefs.mode);
  if (prefs.mode === 'near') p.set('n', String(prefs.near));
  if (prefs.matchCase) p.set('case', '1');
  if (prefs.wholeWord) p.set('word', '1');
  p.set('doc', doc.name);
  if (n != null) p.set('p', String(n + 1));
  if (doc.source?.url) p.set('src', doc.source.url);
  // from the iPhone app, links use the website's address: on an iPhone with the app they open the app (Universal Links),
  // anywhere else the website
  return `${isNative ? APP_WEB : location.origin + location.pathname}#find?${p}`;
}
const bareName = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').trim();
function findLinkedDoc(name, src) {
  const ready = S.docs.filter(searchable);
  const file = src ? bareName(fileNameFor(src)) : '';
  return (src && ready.find((d) => d.source?.url === src))
    || (name && ready.find((d) => d.name.toLowerCase() === name.toLowerCase()))
    || (name && ready.find((d) => bareName(d.name) === bareName(name)))
    || (file && ready.find((d) => bareName(d.name) === file || bareName(fileNameFor(d.source?.url || '')) === file))
    || null;
}
function setLinkOnly(id) {
  linkOnly = id;
  runSearch();
}
async function openSearchLink() {
  const m = location.hash.match(/^#find\?(.*)$/);
  if (!m) return;
  const p = new URLSearchParams(m[1]);
  history.replaceState(null, '', location.pathname + location.search); // a reload shouldn't replay it
  const name = p.get('doc') || '', src = p.get('src') || '';
  if (p.has('t') && MODES[p.get('t')]) prefs.mode = p.get('t');
  if (p.has('n')) prefs.near = Math.max(1, Math.min(200, Number(p.get('n')) || 8));
  prefs.matchCase = p.get('case') === '1';
  prefs.wholeWord = p.get('word') === '1';
  if (p.has('q')) q.value = p.get('q');
  savePrefs();
  syncControls();
  let doc = (name || src) ? findLinkedDoc(name, src) : null;
  if (!doc && src) {
    toast(`Adding “${name || fileNameFor(src)}” to your library…`, { ms: 3000 });
    addRemote(src, {});
    await queue;
    doc = findLinkedDoc(name, src);
  }
  if ((name || src) && !doc) {
    toast(`“${name || src}” isn’t in your library${src ? ' and couldn’t be downloaded' : ''}, so this searches everything.`, { ms: 6000 });
  }
  if (active === reader) closeReader();
  linkOnly = doc ? doc.id : null;
  runSearch();
  const page = Number(p.get('p')) - 1;
  if (!doc || !(page >= 0)) return;
  await new Promise((r) => requestAnimationFrame(r));
  if (results.info.has(pkey(doc.id, page))) await goTo(results, results.info.get(pkey(doc.id, page)).h0, { instant: true });
  else openReader(doc.id, Math.min(page, (S.texts.get(doc.id)?.length || 1) - 1));
}

// ---------- start ----------
async function start() {
  applyTheme();
  $('#modes').innerHTML = Object.entries(MODES)
    .map(([k, m], i) => `<button data-mode="${k}" title="${m.hint} (Alt+${i + 1})">${m.label}</button>`)
    .join('');
  buildKeyMap();
  bind();
  q.value = prefs.q || '';
  document.documentElement.style.setProperty('--z', '1');
  if (prefs.sideW) applySideWidth(Math.min(prefs.sideW, sideMax()));
  syncControls();
  try {
    const [docs, texts, folders] = await Promise.all([store.allDocs(), store.allTexts(), store.allFolders()]);
    S.folders = folders.sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const t of texts) S.texts.set(t.id, t.pages);
    S.docs = docs.filter((d) => S.texts.has(d.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) {
    if (stuckStorage(e)) storageStuck('Your library couldn’t be loaded because');
    else toast('This browser is blocking local storage (a Private tab?), so documents won’t be kept after you close the page.');
  }
  runSearch();
  applyZoom();
  updateStorage();
  labelOlderDocs();
  nativeSetup();
  restorePlace();
  for (const d of S.docs) if (d.marks) sendMarks(d);
  setTimeout(markOlderDocs, 4000);
  const sendTo_ = location.hash.match(/send-to=([A-Z0-9]{6})/i);
  if (sendTo_) { history.replaceState(null, '', location.pathname + location.search); sendTo({ code: sendTo_[1] }); }
  if (prefs.autoCheck && hasSources() && checkDue()) {
    prefs.lastAutoCheck = Date.now();
    savePrefs();
    setTimeout(() => checkSources({ quiet: true }), 1500);
  }
  document.body.classList.add('ready');
  H.ready = true;
  $('#summary').addEventListener('click', (e) => { if (e.target.closest('[data-act="unscope"]')) setLinkOnly(null); });
  window.addEventListener('hashchange', openSearchLink);
  await openSearchLink();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!matchMedia('(pointer: coarse)').matches && S.docs.length) q.focus();
}

start();
