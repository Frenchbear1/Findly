// The page numbers a document prints on itself ("2-4", "iv", "A-3", "112"), so the app can say "Page 2-4"
// instead of "Page 37". A label is only trusted when its neighbours agree with it (2-3, 2-4, 2-5…); pages with
// nothing believable keep their plain position number.

const norm = (s) => s.replace(/[–—]/g, '-').trim();
const CP = /^(?:([A-Z]{1,3})-)?(\d{1,3})-(\d{1,4})$/; // 2-4, 12-110, A-3 is handled by AP
const AP = /^([A-Z]{1,3})-(\d{1,4})$/;                // appendix / glossary style: A-3, G-12
const NUM = /^\d{1,4}$/;
const ROMAN = /^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

function romanValue(s) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let t = 0;
  const a = s.toLowerCase();
  for (let i = 0; i < a.length; i++) t += v[a[i]] < (v[a[i + 1]] || 0) ? -v[a[i]] : v[a[i]];
  return t;
}

// What a token could be: { kind, group, value, text }. Pages in one run share kind and group and count up.
function parse(tok) {
  const t = norm(tok).replace(/^page\s+/i, '');
  let m;
  if ((m = t.match(CP))) return { kind: 'cp', group: `${m[1] || ''}${m[2]}`, value: Number(m[3]), text: t };
  if ((m = t.match(AP))) return { kind: 'ap', group: m[1], value: Number(m[2]), text: t };
  if (NUM.test(t)) return { kind: 'n', group: '', value: Number(t), text: t };
  if (ROMAN.test(t) && t.length <= 7) return { kind: 'r', group: t === t.toUpperCase() ? 'R' : 'r', value: romanValue(t), text: t };
  return null;
}

// Tokens that sit where page numbers do: alone on a line, or at either end of one of the page's first or last lines.
function candidates(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const edge = [...lines.slice(0, 3), ...lines.slice(-3)];
  const out = [];
  const seen = new Set();
  for (const line of edge) {
    if (line.length > 90) continue;
    const words = line.split(/\s+/);
    const toks = line.length <= 14 ? [line, words[0], words[words.length - 1]] : [words[0], words[words.length - 1]];
    if (words.length >= 2 && /^page$/i.test(words[0])) toks.push(words.slice(0, 2).join(' '));
    for (const tok of toks) {
      const c = parse(tok);
      if (!c) continue;
      const key = `${c.kind}|${c.group}|${c.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

const fits = (a, b, gap) => a.kind === b.kind && a.group === b.group && b.value - a.value === gap;

/** Labels from the text of each page, or null when the document doesn't number its pages in a way we can trust. */
export function detectLabels(pages) {
  const N = pages.length;
  if (N < 3) return null;
  const cands = pages.map(candidates);
  const chosen = new Array(N).fill(null);
  for (let n = 0; n < N; n++) {
    let best = null, bestScore = 0;
    for (const c of cands[n]) {
      let score = 0;
      for (const d of [-2, -1, 1, 2]) {
        const m = n + d;
        if (m < 0 || m >= N) continue;
        if (cands[m].some((o) => (d < 0 ? fits(o, c, -d) : fits(c, o, d)))) score += Math.abs(d) === 1 ? 2 : 1;
      }
      // a new chapter starts at page 1: trust "3-1" when the next page says "3-2"
      if (score > bestScore) { best = c; bestScore = score; }
    }
    // plain numbers need a direct neighbour to agree; chapter-page and roman ones are distinctive enough with one a page further off
    if (best && (bestScore >= 2 || (bestScore >= 1 && best.kind !== 'n'))) chosen[n] = best;
  }
  // fill a lone gap inside a run: 2-4, ?, 2-6 → 2-5
  for (let n = 1; n < N - 1; n++) {
    const a = chosen[n - 1], b = chosen[n + 1];
    if (!chosen[n] && a && b && fits(a, b, 2)) {
      const v = a.value + 1;
      chosen[n] = { ...a, value: v, text: a.kind === 'cp' ? a.text.replace(/\d+$/, String(v)) : a.kind === 'ap' ? `${a.group}-${v}` : a.kind === 'n' ? String(v) : toRoman(v, a.group === 'R') };
    }
  }
  const labelled = chosen.filter(Boolean).length;
  if (labelled < Math.max(3, N * 0.3)) return null;
  const labels = chosen.map((c) => (c ? c.text : null));
  // printed numbers that just repeat the position add nothing
  if (labels.every((l, n) => l == null || l === String(n + 1))) return null;
  return labels;
}

function toRoman(v, upper) {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [n, r] of t) while (v >= n) { s += r; v -= n; }
  return upper ? s.toUpperCase() : s;
}

/** A PDF's own page labels (set by its maker), cleaned up; null when they just count 1, 2, 3… */
export function cleanPdfLabels(labels, N) {
  if (!Array.isArray(labels) || labels.length !== N) return null;
  const out = labels.map((l) => (l == null ? null : String(l).trim() || null));
  if (out.every((l, n) => l == null || l === String(n + 1))) return null;
  return out;
}
