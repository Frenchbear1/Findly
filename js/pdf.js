// PDF helpers shared by ingest (text extraction) and the original-page view (canvas + highlight boxes).
// The same textFromItems() runs in both places, so stored character offsets line up with the page's text items.

const pdfjsLib = window.pdfjsLib;
if (pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

export const EXTRACTOR_VERSION = 1;

export function textFromItems(items) {
  let text = '';
  const map = []; // [textStart, itemIndex, length]
  let prev = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!('str' in it)) continue;
    const s = it.str.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
    const tr = it.transform;
    const x = tr[4];
    const y = tr[5];
    const h = Math.hypot(tr[2], tr[3]) || it.height || 10;
    if (prev) {
      const lh = Math.max(h, prev.h);
      const dy = Math.abs(y - prev.y);
      if (prev.eol || dy > lh * 0.55) {
        if (s || !prev.eol) {
          const para = dy > lh * 1.75;
          if (!text.endsWith('\n')) text += para ? '\n\n' : '\n';
          else if (para && !text.endsWith('\n\n')) text += '\n';
        }
      } else if (s) {
        const gap = x - prev.xEnd;
        if (gap > lh * 0.15 && !/\s$/.test(text) && !/^\s/.test(s)) text += ' ';
      }
    }
    if (s) {
      map.push([text.length, i, s.length]);
      text += s;
    }
    if (s || it.hasEOL) prev = { y, h: s ? h : prev ? prev.h : h, xEnd: x + (it.width || 0), eol: !!it.hasEOL };
  }
  return { text, map };
}

export async function extractPdf(bytes, onProgress) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(textFromItems(content.items).text);
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
  } finally {
    doc.destroy();
  }
  return pages;
}

// ---------- original page view ----------
// Where character i falls inside a text run, using real glyph widths rather than equal-width characters.
const measureCtx = document.createElement('canvas').getContext('2d');
function fraction(str, i, family) {
  if (i <= 0) return 0;
  if (i >= str.length) return 1;
  measureCtx.font = `100px ${family}`;
  const total = measureCtx.measureText(str).width;
  return total > 0 ? measureCtx.measureText(str.slice(0, i)).width / total : i / str.length;
}

const openDocs = new Map(); // docId -> Promise<PDFDocumentProxy>

export function getPdf(docId, loadBytes) {
  if (!openDocs.has(docId)) {
    openDocs.set(
      docId,
      loadBytes().then((bytes) => {
        if (!bytes) throw new Error('Original file not stored');
        return pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
      })
    );
    openDocs.get(docId).catch(() => openDocs.delete(docId));
  }
  return openDocs.get(docId);
}

export function closePdf(docId) {
  const p = openDocs.get(docId);
  if (p) { p.then((d) => d.destroy()).catch(() => {}); openDocs.delete(docId); }
}

/**
 * Render page n (0-based) for `host`. ranges: [[start,end,color,hitIndex|null]]
 * Returns { show, cleanup }: call show() to swap the finished page in (nothing changes on screen before that).
 */
// Where the text sits on the page, as fractions: { x: [left, right] | null, y: [top, bottom] | null }.
// Each side is null when its margins are too small to bother trimming (or there isn't enough text to tell).
// Rotated text is ignored.
function textBox(items, base) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, count = 0;
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
    const tx = pdfjsLib.Util.transform(base.transform, t);
    const fh = Math.hypot(tx[2], tx[3]) || 10;
    const w = (it.width || 0) * base.scale;
    x0 = Math.min(x0, tx[4]);
    x1 = Math.max(x1, tx[4] + w);
    y0 = Math.min(y0, tx[5] - fh);
    y1 = Math.max(y1, tx[5] + fh * 0.3);
    count++;
  }
  if (count < 3) return { x: null, y: null };
  const a = Math.max(0, x0 / base.width - 0.025), b = Math.min(1, x1 / base.width + 0.025);
  const c = Math.max(0, y0 / base.height - 0.02), d = Math.min(1, y1 / base.height + 0.02);
  return {
    x: a + (1 - b) < 0.08 || b - a < 0.35 ? null : [a, b],
    y: c + (1 - d) < 0.05 || d - c < 0.2 ? null : [c, d],
  };
}

// Every piece of (unrotated) text as [left, right, top, bottom] fractions of the page, packed in one array.
function textLines(items, base) {
  const out = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
    const tx = pdfjsLib.Util.transform(base.transform, t);
    const fh = Math.hypot(tx[2], tx[3]) || 10;
    out.push(tx[4] / base.width, (tx[4] + (it.width || 0) * base.scale) / base.width, (tx[5] - fh) / base.height, (tx[5] + fh * 0.25) / base.height);
  }
  return new Float32Array(out);
}

// Columns (a, b, c…): where the text's vertical gutters split the page, as [left, right] fractions of its
// width — or null for a page that's one column. A gutter is a strip that almost no text crosses (a heading
// running across the page is fine); columns narrower than a fifth of the page don't count.
function textColumns(items, base) {
  const N = 240;
  const cov = new Float32Array(N);
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
    const tx = pdfjsLib.Util.transform(base.transform, t);
    const fh = Math.hypot(tx[2], tx[3]) || 10;
    const w = (it.width || 0) * base.scale;
    const i0 = Math.max(0, Math.floor((tx[4] / base.width) * N));
    const i1 = Math.min(N - 1, Math.ceil(((tx[4] + w) / base.width) * N) - 1);
    for (let i = i0; i <= i1; i++) cov[i] += fh;
  }
  let lo = 0, hi = N - 1;
  while (lo < N && !cov[lo]) lo++;
  while (hi > lo && !cov[hi]) hi--;
  if (hi - lo < N * 0.4) return null;
  let max = 0;
  for (let i = lo; i <= hi; i++) max = Math.max(max, cov[i]);
  const quiet = (i) => cov[i] < max * 0.06;
  const cols = [];
  let start = lo;
  for (let i = lo + 1; i < hi; ) {
    if (!quiet(i)) { i++; continue; }
    let j = i;
    while (j < hi && quiet(j)) j++;
    if (j - i >= 3) { cols.push([start, i]); start = j; }
    i = j + 1;
  }
  cols.push([start, hi + 1]);
  const keep = cols.filter(([a, b]) => (b - a) / N >= 0.2).map(([a, b]) => [a / N, b / N]);
  if (keep.length < 2) return null;
  // a column reaches as far as the lines that start in it actually run (a long line can poke into the gutter)
  const ends = keep.map(([, b]) => b);
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
    const tx = pdfjsLib.Util.transform(base.transform, t);
    const x0 = tx[4] / base.width, x1 = (tx[4] + (it.width || 0) * base.scale) / base.width;
    const k = keep.findIndex(([a, b]) => x0 >= a - 0.005 && x0 < b);
    if (k >= 0) ends[k] = Math.max(ends[k], Math.min(x1, keep[k + 1]?.[0] ?? 1));
  }
  // a little breathing room, but never reaching into the next column's text
  return keep.map(([a], k) => [
    Math.max(0, a - 0.012, k > 0 ? ends[k - 1] + 0.003 : 0),
    Math.min(1, ends[k] + 0.012, k < keep.length - 1 ? keep[k + 1][0] - 0.003 : 1),
  ]);
}

// Invisible, selectable text laid over the drawn page, so a long press selects words like on any web page.
// Sizes follow --sf (CSS pixels per PDF unit), kept up to date as the page is resized.
function textLayer(items, styles, base) {
  const layer = document.createElement('div');
  layer.className = 'pdf-text';
  const frag = document.createDocumentFragment();
  for (const it of items) {
    if (!it.str) { if (it.hasEOL) frag.append(document.createElement('br')); continue; }
    const t = it.transform;
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
    const tx = pdfjsLib.Util.transform(base.transform, t);
    const fh = Math.hypot(tx[2], tx[3]) || 10;
    const st = styles?.[it.fontName] || {};
    const family = st.fontFamily || 'sans-serif';
    const ascent = st.ascent || 0.8;
    const span = document.createElement('span');
    span.textContent = it.str;
    span.style.left = `${(tx[4] / base.width) * 100}%`;
    span.style.top = `${((tx[5] - fh * ascent) / base.height) * 100}%`;
    span.style.fontSize = `calc(var(--sf, 1) * ${fh.toFixed(2)}px)`;
    span.style.fontFamily = family;
    measureCtx.font = `${fh}px ${family}`;
    const natural = measureCtx.measureText(it.str).width;
    const target = (it.width || 0) * base.scale;
    if (natural > 0 && target > 0) span.style.transform = `scaleX(${(target / natural).toFixed(4)})`;
    frag.append(span);
    if (it.hasEOL) frag.append(document.createElement('br'));
  }
  layer.append(frag);
  return layer;
}

export async function renderPdfPage(pdf, n, host, ranges, width, { trim = false, columns = false } = {}) {
  const page = await pdf.getPage(n + 1);
  const base = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // "wide view": cut the side margins so the text fills the width (top and bottom margins are trimmed by the app)
  const box = trim ? textBox(content.items, base) : { x: null, y: null };
  const span = box.x;
  const ts = span ? 1 / (span[1] - span[0]) : 1;
  // in column view a column fills the width, so draw sharper (columns are found around each hit by the app)
  const tsDraw = columns ? Math.max(ts, 2.1) : ts;
  const cssWidth = Math.max(width || 0, host.clientWidth || 700) * tsDraw;
  const dpr = Math.min(window.devicePixelRatio || 1, columns ? 2 : 2.5);
  const scale = Math.min(cssWidth * dpr, 4096) / base.width;
  const vp = page.getViewport({ scale });

  // .pdf-frame is the visible box; .pdf-page inside it is the whole page, scaled and shifted when trimmed
  const frame = document.createElement('div');
  frame.className = span ? 'pdf-frame trimmed' : 'pdf-frame';
  const sheet = document.createElement('div');
  sheet.className = 'pdf-page';
  sheet.style.aspectRatio = `${base.width} / ${base.height}`;
  if (span) { frame.style.setProperty('--ts', ts.toFixed(4)); frame.style.setProperty('--tx0', span[0].toFixed(4)); frame.dataset.tx = span.join(','); }
  if (box.y) frame.dataset.ty = box.y.join(','); // where the text starts and ends down the page
  frame._lines = textLines(content.items, base); // where each piece of text sits, for finding columns
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const layer = document.createElement('div');
  layer.className = 'pdf-hits';
  sheet.append(canvas, layer, textLayer(content.items, content.styles, base));
  frame.append(sheet);
  const sizer = new ResizeObserver(() => sheet.style.setProperty('--sf', (sheet.clientWidth / base.width).toFixed(5)));
  sizer.observe(sheet);
  // Draw off-screen first; whatever is showing now (the old render, or text) stays until this is ready.

  const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp });

  if (ranges.length) {
    const { map } = textFromItems(content.items);
    const items = content.items;
    const starts = map.map((m) => m[0]);
    const frag = document.createDocumentFragment();
    for (const [s, e, color, h] of ranges) {
      let lo = 0, hi = starts.length - 1, k = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= s) { k = mid; lo = mid + 1; } else hi = mid - 1;
      }
      let first = true;
      for (; k < map.length && map[k][0] < e; k++) {
        const [ts, idx, len] = map[k];
        const te = ts + len;
        if (te <= s) continue;
        const it = items[idx];
        const tx = pdfjsLib.Util.transform(base.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]) || 10;
        const w = (it.width || 0) * base.scale;
        const cs = Math.max(s, ts) - ts;
        const ce = Math.min(e, te) - ts;
        const str = it.str.normalize('NFKC');
        const family = content.styles?.[it.fontName]?.fontFamily || 'sans-serif';
        const left = tx[4] + w * fraction(str, cs, family);
        const right = tx[4] + w * fraction(str, ce, family);
        const top = tx[5] - fh * 0.92;
        const box = document.createElement('div');
        box.className = `box ${h != null ? 'm' : 's'} c${color}`;
        if (h != null) box.dataset.h = h;
        if (!first) box.dataset.cont = '1';
        first = false;
        box.style.left = `${(left / base.width) * 100}%`;
        box.style.top = `${(top / base.height) * 100}%`;
        box.style.width = `${(Math.max(right - left, 2) / base.width) * 100}%`;
        box.style.height = `${((fh * 1.12) / base.height) * 100}%`;
        frag.append(box);
      }
    }
    layer.append(frag);
  }
  let cancelled = false;
  try { await task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') throw e; cancelled = true; }
  page.cleanup();
  const cleanup = () => { task.cancel(); sizer.disconnect(); canvas.width = canvas.height = 0; frame.remove(); };
  return { cleanup, trimmed: !!span, show: () => { if (!cancelled) host.replaceChildren(frame); } };
}
