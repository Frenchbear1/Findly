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

// ---------- headings and captions ----------
// Each line of a page's text with the size of its type, so headings (set larger than the body text) and
// figure/table captions can be told apart from ordinary text. Returns [start, end, size] per line.
export function lineSizes(text, map, items) {
  const lines = [];
  let i = 0, k = 0;
  while (i < text.length) {
    let e = text.indexOf('\n', i);
    if (e < 0) e = text.length;
    let h = 0, font = undefined;
    while (k < map.length && map[k][0] < e) {
      if (map[k][0] + map[k][2] > i) {
        const it = items[map[k][1]], tr = it.transform;
        h = Math.max(h, Math.hypot(tr[2], tr[3]) || it.height || 0);
        // the line's font, if the whole line is in one (a bold heading is; a sentence with a bold word isn't)
        if (it.str.trim()) font = font === undefined ? it.fontName : font === it.fontName ? font : null;
      }
      k++;
    }
    if (e > i && h) lines.push([i, e, Math.round(h * 4) / 4, font || null]);
    i = e + 1;
  }
  return lines;
}
// From every page's lines, the marks for each page: [kind, start, end, …] with kind 1 a heading, 2 a caption.
export const MARKS_V = 3;
export function marksFrom(pageLines, texts) {
  // the body: the type size, and the font, most of the document's characters are set in
  const sizes = new Map(), fonts = new Map();
  for (const lines of pageLines) for (const [s, e, h, f] of lines || []) {
    sizes.set(h, (sizes.get(h) || 0) + (e - s));
    if (f) fonts.set(f, (fonts.get(f) || 0) + (e - s));
  }
  const top = (m) => { let best = null, most = 0; for (const [k, n] of m) if (n > most) { most = n; best = k; } return [best, most]; };
  const [body] = top(sizes);
  const [bodyFont, bodyChars] = top(fonts);
  return pageLines.map((lines, n) => {
    if (!lines) return null;
    const t = texts[n] || '';
    const out = [];
    let byFont = 0;
    for (let li = 0; li < lines.length; li++) {
      const [s, e, h, f] = lines[li];
      const str = t.slice(s, e).trim();
      if (!/[A-Za-z]{2}/.test(str) || str.length > 160) continue;
      if (/^(figure|fig\.|table|exhibit|chart|diagram)\s*[A-Z]?[\d.-]+/i.test(str)) { out.push(2, s, e, 0); continue; }
      if (/\.{4,}|…{2,}/.test(str)) continue; // a contents line with dot leaders
      const big = body && h >= body * 1.15 && str.length <= 120 && !/^\d+([.-]\d+)*$/.test(str);
      // a short line all in capitals, at body size, reads as a heading too
      const caps = str.length <= 70 && str.length >= 4 && /[A-Z]{3}/.test(str) && str === str.toUpperCase() && !/[.,;]$/.test(str);
      // a whole line in another font than the text (bold, a different face), short, not a sentence carrying on:
      // the second- and third-level headings set at body size
      const own = f && bodyFont && f !== bodyFont && (fonts.get(f) || 0) < bodyChars * 0.25
        && h >= body * 0.95 && str.length >= 3 && str.length <= 100 && /^[A-Z0-9§(]/.test(str) && !/[,;:]$/.test(str)
        && str.split(/\s+/).length <= 14
        // …and introduces text: the body font follows within the next two lines (an index or contents
        // entry is followed by more entries, not by paragraphs)
        && lines.slice(li + 1, li + 3).some((l) => l[3] === bodyFont)
        && !/\s\d+([-–]\d+)?([,\s]+\d+([-–]\d+)?)*$/.test(str); // ends in page numbers: an index line
      if (own && !big && !caps) byFont++;
      if (big || caps || own) out.push(1, s, e, own && !big && !caps ? 1 : 0);
    }
    // a page where many lines are set apart only by their font is a list, table or index, not headings
    const tooMany = byFont > 6 && byFont > lines.length * 0.3;
    const kept = [];
    for (let i = 0; i < out.length; i += 4) if (!(tooMany && out[i + 3])) kept.push(out[i], out[i + 1], out[i + 2]);
    return kept.length ? kept : null;
  });
}

export async function extractPdf(bytes, onProgress) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  const pages = [];
  const lines = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const t = textFromItems(content.items);
      pages.push(t.text);
      lines.push(lineSizes(t.text, t.map, content.items));
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    pages.marks = marksFrom(lines, pages);
    // the page numbers the PDF's maker gave it ("i", "ii", "1-1"…), if any; the caller decides whether to use them
    try { pages.labels = await doc.getPageLabels(); } catch {}
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

// What getDocument reads from: the file's bytes, or (iPhone) { range } to read it in pieces as needed.
const source = (src) => (src?.range ? { range: src.range, disableAutoFetch: true, disableStream: true, rangeChunkSize: 131072 } : { data: src.slice(0) });

export function getPdf(docId, loadBytes, { fonts = true } = {}) {
  if (!openDocs.has(docId)) {
    openDocs.set(
      docId,
      loadBytes().then((bytes) => {
        if (!bytes) throw new Error('Original file not stored');
        // fonts are only needed to draw the page; when the iPhone draws it, only the text's positions are read
        return pdfjsLib.getDocument({ ...source(bytes), isEvalSupported: false, disableFontFace: !fonts }).promise;
      })
    );
    openDocs.get(docId).catch(() => openDocs.delete(docId));
  }
  return openDocs.get(docId);
}

/** Ids of the documents held open for drawing pages. */
export const openPdfIds = () => [...openDocs.keys()];

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

// Where something is actually printed: the page drawn small and scanned for ink, as fractions like textBox.
// Text positions alone can lie: official PDFs (eCFR, GPO) carry invisible print-shop text out in the margins,
// which made a blank margin look used. The ink tells the truth, so trimming never keeps an empty side.
// Scanned pages get two more things: specks of dust and the dark strip a scanner leaves at an edge don't count as
// ink (they kept whole margins open), and a page that went through the scanner crooked is measured for how far it
// leans (rot, in degrees, to turn it back upright; s, the little zoom that keeps its corners filled), with the ink
// box measured on the page as it will be shown, upright.
const inkCache = new Map();
async function inkBox(page, base, key, draw) {
  if (inkCache.has(key)) return inkCache.get(key);
  let out = null;
  try {
    const W = 560;
    const vp = page.getViewport({ scale: W / base.width });
    const c = document.createElement('canvas');
    c.width = W;
    const H = c.height = Math.max(1, Math.round(vp.height));
    const ctx = c.getContext('2d', { alpha: false, willReadFrequently: true });
    let drawn = false;
    if (draw) try { const img = await draw(W, [0, 1, 0, 1], 0.7); ctx.drawImage(img, 0, 0, W, H); draw.forget?.([img._path]); drawn = true; } catch {}
    if (!drawn) await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data } = ctx.getImageData(0, 0, W, H);
    out = measureInk(data, W, H);
    c.width = c.height = 0;
  } catch {}
  if (inkCache.size > 400) inkCache.delete(inkCache.keys().next().value);
  inkCache.set(key, out);
  return out;
}
// The measuring itself, on RGBA pixels (kept apart so it can be tested on its own).
export function measureInk(data, W, H) {
  // the paper's colour: what most of the page's outer edge is (not always white)
  const tally = new Map();
  const note = (x, y) => { const i = (y * W + x) * 4; const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3); tally.set(k, (tally.get(k) || 0) + 1); };
  for (let x = 0; x < W; x += 2) { note(x, 1); note(x, H - 2); }
  for (let y = 0; y < H; y += 2) { note(1, y); note(W - 2, y); }
  let bk = 0x7fff, bn = 0;
  for (const [k, n] of tally) if (n > bn) { bn = n; bk = k; }
  const br = ((bk >> 10) << 3) + 4, bg = (((bk >> 5) & 31) << 3) + 4, bb = ((bk & 31) << 3) + 4;
  // anything printed differs from it: dark text, and also pale pictures, tints and chart backgrounds
  const mask = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) if (Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb) > 30) mask[p] = 1;
  // a scanner's dark edge: a column or row at the very edge that's mostly "ink" isn't content
  const edgeX = Math.ceil(W * 0.04), edgeY = Math.ceil(H * 0.04);
  for (let x = 0; x < W; x++) {
    if (x >= edgeX && x < W - edgeX) continue;
    let n = 0;
    for (let y = 0; y < H; y++) n += mask[y * W + x];
    if (n > H * 0.5) for (let y = 0; y < H; y++) mask[y * W + x] = 0;
  }
  for (let y = 0; y < H; y++) {
    if (y >= edgeY && y < H - edgeY) continue;
    let n = 0;
    for (let x = 0; x < W; x++) n += mask[y * W + x];
    if (n > W * 0.5) mask.fill(0, y * W, (y + 1) * W);
  }
  // specks: ink only counts where there's more ink close by (a letter, a line, a picture), not a lone dot
  const S = new Uint32Array((W + 1) * (H + 1)); // running totals, for counting any square quickly
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += mask[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
  }
  // ink is grouped into blobs (marks within a couple of pixels join up, so a word, a line or a picture is one
  // blob); a blob too small to be anything but dust (or a stray dot) doesn't count
  const near = (x, y, R) => {
    const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
    return S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
  };
  const MIN = 36;
  const seen = new Uint8Array(W * H);
  const keep = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const blob = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!mask[p0] || seen[p0]) continue;
    let top = 0, area = 0;
    blob.length = 0;
    stack[top++] = p0;
    seen[p0] = 1;
    while (top) {
      const p = stack[--top];
      const x = p % W, y = (p / W) | 0;
      if (mask[p]) { area++; blob.push(p); }
      // reach two pixels out, through blank paper, to the next mark
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const q = yy * W + xx;
          if (!seen[q] && mask[q]) { seen[q] = 1; stack[top++] = q; }
        }
      }
    }
    if (area >= MIN) for (const p of blob) keep[p] = 1;
  }
  const xs = [], ys = [];
  for (let p = 0; p < W * H; p++) if (keep[p] && near(p % W, (p / W) | 0, 1) >= 2) { xs.push(p % W); ys.push((p / W) | 0); }
  if (xs.length < 12) return null;
  // how far the page leans: the angle at which the ink falls into the sharpest rows (lines of text line up)
  const cx = W / 2, cy = H / 2;
  const step = Math.max(1, Math.floor(xs.length / 60000));
  const bins = new Float64Array(H * 2 + 8);
  const sharpness = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    bins.fill(0);
    for (let k = 0; k < xs.length; k += step) {
      const b = Math.round(ys[k] - (xs[k] - cx) * t + H / 2) + 2;
      if (b >= 0 && b < bins.length) bins[b]++;
    }
    // softened a little first, so a level angle (where every pixel lands exactly on a row) isn't favoured over a
    // slanted one (where they fall between rows) just because of the rounding
    let sum = 0;
    for (let b = 1; b < bins.length - 1; b++) { const v = bins[b - 1] + 2 * bins[b] + bins[b + 1]; sum += v * v; }
    return sum;
  };
  let lean = 0;
  if (xs.length > 1500) {
    const flat = sharpness(0);
    let best = 0, bestS = flat;
    for (let d = -5; d <= 5.001; d += 0.25) { const v = sharpness(d); if (v > bestS) { bestS = v; best = d; } }
    for (let d = best - 0.25; d <= best + 0.251; d += 0.05) { const v = sharpness(d); if (v > bestS) { bestS = v; best = d; } }
    // only a clear, real lean: not a page that's straight already, and not a picture that fools it
    if (Math.abs(best) >= 0.15 && Math.abs(best) <= 5 && bestS > flat * 1.15) lean = Math.round(best * 100) / 100;
  }
  const rot = -lean; // turning it back
  const a = (rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const sc = rot ? Math.abs(cos) + Math.abs(sin) * Math.max(W / H, H / W) : 1;
  // the ink box, on the page as it will be shown (turned upright and zoomed a touch about its middle)
  const cols = new Uint16Array(W), rows = new Uint16Array(H);
  for (let k = 0; k < xs.length; k++) {
    let X = xs[k] + 0.5, Y = ys[k] + 0.5;
    if (rot) { const dx = X - cx, dy = Y - cy; X = cx + sc * (dx * cos - dy * sin); Y = cy + sc * (dx * sin + dy * cos); }
    const xi = Math.floor(X), yi = Math.floor(Y);
    if (xi >= 0 && xi < W) cols[xi]++;
    if (yi >= 0 && yi < H) rows[yi]++;
  }
  const first = (arr) => arr.findIndex((v) => v >= 2);
  const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= 2) return i; return -1; };
  const x0 = first(cols), x1 = last(cols), y0 = first(rows), y1 = last(rows);
  if (!(x0 >= 0 && x1 > x0 && y0 >= 0 && y1 > y0)) return null;
  return { x: [x0 / W, (x1 + 1) / W], y: [y0 / H, (y1 + 1) / H], rot, s: sc };
}
// Text box tightened by the ink: never keep a side that has nothing printed on it.
function tighten(box, ink) {
  if (!ink) return box;
  // what's printed, not where the text is: pictures and charts past the text (or above and below it)
  // stay in, and invisible text out in the margins doesn't hold them open
  const pad = 0.025;
  let x = [Math.max(0, ink.x[0] - pad), Math.min(1, ink.x[1] + pad)];
  if (x[1] - x[0] < 0.35 || x[0] + (1 - x[1]) < 0.08) x = null;
  let y = [Math.max(0, ink.y[0] - 0.015), Math.min(1, ink.y[1] + 0.015)];
  if (y[1] - y[0] < 0.2 || y[0] + (1 - y[1]) < 0.05) y = null;
  return { ...box, x, y };
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

// ---------- drawing order ----------
// Pages are drawn two at a time, nearest to where you are first: each waiting job is asked how far it is
// from the screen when a slot frees up (so scrolling re-orders the queue), and a job that answers null has
// been called off.
const waiting = [];
let running = 0;
const SLOTS = 2;
function pump() {
  while (running < SLOTS && waiting.length) {
    let best = -1, bd = Infinity;
    for (let i = waiting.length - 1; i >= 0; i--) {
      const d = waiting[i].prio();
      if (d == null) { waiting[i].res(null); waiting.splice(i, 1); if (best > i) best--; continue; }
      if (d < bd || best < 0) { bd = d; best = i; }
    }
    if (best < 0) return;
    const [job] = waiting.splice(best, 1);
    running++;
    job.res(() => { running--; pump(); });
  }
}
function slot(prio) {
  return new Promise((res) => { waiting.push({ prio, res }); pump(); });
}

// draw: on the iPhone, (widthPx, [x0, x1, y0, y1], quality) → a decoded <img> of the page (or that part of
// it) drawn by Apple's PDF engine; without it pdf.js draws into canvases. If it fails, pdf.js takes over.
export async function renderPdfPage(pdf, n, host, ranges, width, { trim = false, columns = false, prio = () => 0, draw = null } = {}) {
  const got = await slot(prio);
  if (!got) return null; // called off while waiting
  let freed = false;
  const release = () => { if (!freed) { freed = true; got(); } };
  let page;
  try {
  page = await pdf.getPage(n + 1);
  const base = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // "wide view": cut the side margins so the text fills the width (top and bottom margins are trimmed by the app)
  let box = trim ? textBox(content.items, base) : { x: null, y: null };
  const ink = await inkBox(page, base, `${pdf.fingerprints?.[0] || ''}:${n}`, draw); // crooked scans turn upright, trimmed or not
  if (trim) box = tighten(box, ink);
  const rot = ink?.rot || 0, rs = ink?.s || 1; // a crooked scan, turned upright
  const span = box.x;
  const ts = span ? 1 / (span[1] - span[0]) : 1;
  // in column view a column fills the width, so draw sharper (columns are found around each hit by the app)
  const tsDraw = columns ? Math.max(ts, 2.1) : ts;
  const cssWidth = Math.max(width || 0, host.clientWidth || 700) * tsDraw;
  const dpr = Math.min(window.devicePixelRatio || 1, columns ? 2 : 2.5);
  // each page's bitmap is capped at about 6 million pixels (24 MB): fast scrolling draws many pages at
  // once, and on iPhone running out of memory makes iOS restart the whole app
  const scale = Math.min(Math.min(cssWidth * dpr, 4096) / base.width, Math.sqrt(6e6 / (base.width * base.height)) * (ts > 1 ? Math.min(ts, 1.6) : 1));
  const vp = page.getViewport({ scale });
  // first a quick, soft copy of the whole page; the sharp one is drawn just for what's shown (sharpen below)
  const pscale = Math.max(Math.min(scale * 0.4, 520 / base.width), Math.min(scale, 300 / base.width));
  const pvp = page.getViewport({ scale: pscale });

  // .pdf-frame is the visible box; .pdf-page inside it is the whole page, scaled and shifted when trimmed
  const frame = document.createElement('div');
  frame.className = span ? 'pdf-frame trimmed' : 'pdf-frame';
  const sheet = document.createElement('div');
  sheet.className = 'pdf-page';
  sheet.style.aspectRatio = `${base.width} / ${base.height}`;
  if (span) { frame.style.setProperty('--ts', ts.toFixed(4)); frame.style.setProperty('--tx0', span[0].toFixed(4)); frame.dataset.tx = span.join(','); }
  if (box.y) frame.dataset.ty = box.y.join(','); // where the text starts and ends down the page
  frame._lines = textLines(content.items, base); // where each piece of text sits, for finding columns
  if (rot) {
    // the whole page turns (picture, highlights and selectable text together), so everything stays lined up
    sheet.style.transform = `rotate(${rot}deg) scale(${rs.toFixed(4)})`;
    frame.dataset.rot = String(rot);
    // where the text sits, as it's shown now
    const a = (rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), ar = base.height / base.width;
    const L = frame._lines;
    const to = (fx, fy) => { const dx = fx - 0.5, dy = (fy - 0.5) * ar; return [0.5 + rs * (dx * cos - dy * sin), 0.5 + (rs * (dx * sin + dy * cos)) / ar]; };
    for (let k = 0; k + 3 < L.length; k += 4) {
      const pts = [to(L[k], L[k + 2]), to(L[k + 1], L[k + 2]), to(L[k], L[k + 3]), to(L[k + 1], L[k + 3])];
      L[k] = Math.min(...pts.map((p) => p[0])); L[k + 1] = Math.max(...pts.map((p) => p[0]));
      L[k + 2] = Math.min(...pts.map((p) => p[1])); L[k + 3] = Math.max(...pts.map((p) => p[1]));
    }
  }
  let canvas = null;
  if (draw) try { canvas = await draw(Math.floor(pvp.width), [0, 1, 0, 1], 0.72); } catch { draw = null; }
  const nativeSoft = !!canvas;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = Math.floor(pvp.width);
    canvas.height = Math.floor(pvp.height);
  }
  canvas.className = 'soft';
  const layer = document.createElement('div');
  layer.className = 'pdf-hits';
  sheet.append(canvas, layer, textLayer(content.items, content.styles, base));
  frame.append(sheet);
  const sizer = new ResizeObserver(() => sheet.style.setProperty('--sf', (sheet.clientWidth / base.width).toFixed(5)));
  sizer.observe(sheet);
  // Draw off-screen first; whatever is showing now (the old render, or text) stays until this is ready.

  const task = nativeSoft ? { promise: Promise.resolve(), cancel() {} } : page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: pvp });

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
  release();
  // the page's parsed drawing (with every picture on it decoded) is let go right after each drawing; keeping
  // it for a dozen image-heavy pages is what runs an iPhone out of memory
  try { page.cleanup(); } catch {}

  // ---- the sharp copy, of just the part of the page that's shown (plus a little either side) ----
  // sharpen([y0, y1], [x0, x1]) asks for it; asking again for more (opening the crop) draws the larger part
  // and swaps it in when ready, the soft copy showing meanwhile. Fractions of the page.
  let sharp = null, have = null, want = null, busy = false, dead = false, sharpTask = null;
  // let a drawing go: a canvas's pixels freed, an image's file deleted
  const drop = (el) => { if (el.tagName === 'IMG') { draw?.forget?.([el._path]); el.removeAttribute('src'); } else el.width = el.height = 0; };
  const covers = (a, b) => a && a[0] <= b[0] + 1e-3 && a[1] >= b[1] - 1e-3 && a[2] <= b[2] + 1e-3 && a[3] >= b[3] - 1e-3;
  const sharpen = (y, x) => {
    if (y) {
      x = x || span || [0, 1];
      const lean = Math.abs(Math.sin((rot * Math.PI) / 180)); // a turned page shows a slanted strip of the source
      const pad = 0.04 + lean * (base.width / base.height), padX = 0.01 + lean * (base.height / base.width) * 0.5;
      const r = [Math.max(0, x[0] - padX), Math.min(1, x[1] + padX), Math.max(0, y[0] - pad), Math.min(1, y[1] + pad)];
      want = want && !covers(r, want) ? [Math.min(want[0], r[0]), Math.max(want[1], r[1]), Math.min(want[2], r[2]), Math.max(want[3], r[3])] : r;
    }
    if (!want || covers(have, want) || busy || dead) return;
    busy = true;
    (async () => {
      while (!dead && want && !covers(have, want)) {
        // a page well off the screen waits for its sharp copy until it comes close (sharpen() again then)
        const go = await slot(() => { if (dead) return null; const d = prio(); return d == null || d > 1800 ? null : d + 400; });
        if (!go) break;
        const [x0, x1, y0, y1] = want;
        try {
          const sx = Math.floor(x0 * vp.width), sy = Math.floor(y0 * vp.height);
          let c = null;
          if (draw) try { c = await draw(Math.floor(vp.width), [x0, x1, y0, y1], 0.85); } catch { c = null; }
          if (!c) {
            c = document.createElement('canvas');
            c.width = Math.max(1, Math.ceil(x1 * vp.width) - sx);
            c.height = Math.max(1, Math.ceil(y1 * vp.height) - sy);
            sharpTask = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, transform: [1, 0, 0, 1, -sx, -sy] });
            await sharpTask.promise;
          }
          c.className = 'sharp';
          const cw = c.naturalWidth || c.width, ch = c.naturalHeight || c.height;
          if (dead) { drop(c); break; }
          // margins in % are of the page's width: pull the strip up over the soft copy, to where it belongs
          const ar = vp.height / vp.width;
          c.style.marginTop = `${((sy / vp.height) - 1) * ar * 100}%`;
          c.style.marginLeft = `${(sx / vp.width) * 100}%`;
          c.style.width = `${(cw / vp.width) * 100}%`;
          try { page.cleanup(); } catch {}
          if (sharp) { sharp.replaceWith(c); drop(sharp); } else canvas.after(c);
          sharp = c;
          have = [sx / vp.width, (sx + cw) / vp.width, sy / vp.height, (sy + ch) / vp.height];
          frame._onSharp?.();
        } catch (e) { if (e?.name !== 'RenderingCancelledException') break; }
        finally { go(); }
      }
      busy = false;
    })();
  };
  const cleanup = () => {
    dead = true;
    task.cancel();
    sharpTask?.cancel();
    sizer.disconnect();
    drop(canvas);
    if (sharp) drop(sharp);
    frame.remove();
    try { page.cleanup(); } catch {}
  };
  frame._sharpen = sharpen;
  return { cleanup, trimmed: !!span, show: () => { if (!cancelled) host.replaceChildren(frame); } };
  } catch (e) { release(); throw e; }
}

/** Headings and captions for a document already in the library (added before they were detected). */
export async function marksForPdf(bytes, texts, isStale) {
  // its own copy of the document, without fonts (only the text's positions and sizes are needed), each page
  // let go as soon as it's read and the whole thing closed at the end: reading a long manual page by page
  // otherwise piles up enough in memory for iOS to restart the app
  const pdf = await pdfjsLib.getDocument({ ...source(bytes), isEvalSupported: false, disableFontFace: true }).promise;
  const lines = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      if (isStale?.()) return null;
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const t = textFromItems(content.items);
      // only where the text matches what's stored (a page read another way has other positions)
      lines.push(t.text === texts[n - 1] ? lineSizes(t.text, t.map, content.items) : null);
      page.cleanup();
      await new Promise((r) => setTimeout(r, n % 20 ? 0 : 60));
    }
  } finally {
    pdf.destroy();
  }
  return marksFrom(lines, texts);
}
