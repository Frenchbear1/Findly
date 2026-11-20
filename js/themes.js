// Reading themes: the app's colours, and real paper for the pages.
// A theme is a background, a page colour, an ink colour, an accent and a paper; everything else is derived.

export const THEMES = [
  { id: 'auto', name: 'Match system', auto: true },
  { id: 'daylight', name: 'Daylight', bg: '#f5f4f1', page: '#ffffff', ink: '#1b1b1d', accent: '#2f54eb', paper: 'smooth' },
  { id: 'paper', name: 'Paper', bg: '#ece8df', page: '#f9f7f1', ink: '#25231f', accent: '#3a5bd9', paper: 'fine' },
  { id: 'cream', name: 'Cream', bg: '#e9dfc6', page: '#f6eed9', ink: '#2f281d', accent: '#a0612a', paper: 'book' },
  { id: 'sepia', name: 'Sepia', bg: '#dccaa6', page: '#efe1c3', ink: '#4a3923', accent: '#9a5216', paper: 'natural' },
  { id: 'sage', name: 'Sage', bg: '#d7e2d0', page: '#e8f0e2', ink: '#22301d', accent: '#3d7a4b', paper: 'rice' },
  { id: 'mist', name: 'Mist', bg: '#dfe4ec', page: '#eff2f7', ink: '#1c2431', accent: '#3a62c3', paper: 'laid' },
  { id: 'blush', name: 'Blush', bg: '#ecdedb', page: '#f8efed', ink: '#33231f', accent: '#b04757', paper: 'handmade' },
  { id: 'dusk', name: 'Dusk', bg: '#303237', page: '#3b3e44', ink: '#e7e5e0', accent: '#8ea2ff', dark: true, paper: 'felt' },
  { id: 'night', name: 'Night', bg: '#141517', page: '#1e1f23', ink: '#ecebe8', accent: '#7d95ff', dark: true, paper: 'card' },
  { id: 'ember', name: 'Night sepia', bg: '#1b1611', page: '#271f18', ink: '#e9d9bd', accent: '#e0a15a', dark: true, paper: 'natural' },
  { id: 'navy', name: 'Midnight', bg: '#0d1421', page: '#162033', ink: '#d5deeb', accent: '#7aa7ff', dark: true, paper: 'linen' },
  { id: 'forest', name: 'Forest', bg: '#111914', page: '#1a251e', ink: '#d5e3d7', accent: '#78c08f', dark: true, paper: 'felt' },
  { id: 'black', name: 'Black', bg: '#000000', page: '#0c0c0c', ink: '#d4d4d4', accent: '#8ea2ff', dark: true, paper: 'smooth' },
  { id: 'custom', name: 'Custom', custom: true },
];
// Real paper: scanned textures (Subtle Patterns, CC BY-SA 3.0 — see vendor/paper/LICENSE.txt), evened out
// around mid-grey so they give any page colour its grain.
export const PAPERS = [
  { id: 'theme', name: 'Theme’s paper' },
  { id: 'smooth', name: 'Smooth' },
  { id: 'fine', name: 'Fine' },
  { id: 'book', name: 'Book' },
  { id: 'laid', name: 'Laid' },
  { id: 'rice', name: 'Rice' },
  { id: 'handmade', name: 'Handmade' },
  { id: 'recycled', name: 'Recycled' },
  { id: 'natural', name: 'Natural' },
  { id: 'linen', name: 'Linen' },
  { id: 'felt', name: 'Felt' },
  { id: 'card', name: 'Cardstock' },
];
export const THEME_DEFAULTS = { rtheme: 'auto', tint: true, tintAmt: 85, pageLift: null, paper: 'theme', grain: 50, custom: { h: 38, s: 32, b: 86 } };
// absolute, because a url() inside a CSS variable resolves against the stylesheet that uses it
const paperUrl = (id) => (id && id !== 'smooth' ? new URL(`vendor/paper/${id}.webp`, document.baseURI).href : '');

// ---- colour helpers ----
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const rgba = (a, al) => { const [r, g, b] = hex(a); return `rgba(${r}, ${g}, ${b}, ${al})`; };
const light = (a) => hex(a).reduce((s, v) => s + v, 0) / 765;
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

// The custom theme, from three sliders: hue, colour (how tinted) and brightness.
export function customTheme({ h = 38, s = 32, b = 86 } = {}) {
  const L = 4 + b * 0.92;
  const dark = L < 50;
  return {
    id: 'custom', name: 'Custom', dark, paper: dark ? 'felt' : 'fine',
    bg: hsl(h, s * 0.5, L),
    page: hsl(h, s * 0.55, dark ? Math.min(40, L + 5) : Math.min(98.5, L + 5)),
    ink: dark ? hsl(h, s * 0.25, 88) : hsl(h, s * 0.35, 13),
    accent: s < 8 ? (dark ? '#8ea2ff' : '#2f54eb') : hsl(h, Math.min(70, 35 + s), dark ? 68 : 40),
  };
}

const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
export function resolveTheme(p) {
  const id = p.rtheme || 'auto';
  if (id === 'custom') return customTheme(p.custom || THEME_DEFAULTS.custom);
  if (id === 'auto') return THEMES.find((t) => t.id === (systemDark() ? 'night' : 'daylight'));
  return THEMES.find((t) => t.id === id && !t.auto && !t.custom) || THEMES[1];
}

// How far the page sits from the background, -100 (much darker) … +100 (much lighter). null = as designed.
const LIFT = 0.6;
export function themeLift(t) {
  const lb = light(t.bg), lp = light(t.page);
  const v = lp >= lb ? (lp - lb) / Math.max(0.001, 1 - lb) : -(lb - lp) / Math.max(0.001, lb);
  return Math.round(Math.max(-1, Math.min(1, v / LIFT)) * 100);
}
export function pageColour(t, lift) {
  if (lift == null) return t.page;
  return lift >= 0 ? mix(t.bg, '#ffffff', (lift / 100) * LIFT) : mix(t.bg, '#000000', (-lift / 100) * LIFT);
}

// All the colour tokens for a theme.
export function themeTokens(t, lift = null) {
  const page = pageColour(t, lift);
  const d = t.dark;
  return {
    '--bg': t.bg,
    '--panel': mix(t.bg, t.ink, 0.03),
    '--card': page,
    '--card-2': mix(page, t.bg, 0.45),
    '--ink': t.ink,
    '--ink-2': mix(t.ink, t.bg, 0.2),
    '--muted': mix(t.ink, t.bg, 0.46),
    '--line': mix(t.bg, t.ink, d ? 0.13 : 0.11),
    '--line-2': mix(t.bg, t.ink, d ? 0.2 : 0.17),
    '--accent': t.accent,
    '--accent-ink': d ? mix(t.accent, '#000000', 0.85) : '#ffffff',
    '--accent-soft': rgba(t.accent, d ? 0.16 : 0.11),
    '--seg-on': d ? mix(page, t.ink, 0.12) : page,
    '--doc-page': page,
    '--doc-ink': t.ink,
  };
}

const APPLIED = Object.keys(themeTokens(THEMES[1]));
const CACHE = 'instant-search:theme';

export function applyReadingTheme(p) {
  const root = document.documentElement;
  const t = resolveTheme(p);
  const dark = !!t.dark;
  root.dataset.theme = dark ? 'dark' : 'light';
  const tokens = themeTokens(t, p.pageLift ?? null);
  for (const k of APPLIED) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  // the pages take on the theme: light themes tint the white paper, dark themes turn the page dark
  const tint = p.tint !== false;
  root.classList.toggle('doc-tint', tint);
  root.classList.toggle('doc-dark', tint && dark);
  root.style.setProperty('--tint', String((p.tintAmt ?? 85) / 100));
  // …and get real paper grain
  const paper = (p.paper || 'theme') === 'theme' ? t.paper || 'smooth' : p.paper;
  const url = paperUrl(paper);
  root.classList.toggle('paper', !!url);
  root.style.setProperty('--paper-img', url ? `url("${url}")` : 'none');
  root.style.setProperty('--grain', String(((p.grain ?? 50) / 100) * (dark ? 0.7 : 1)));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t.bg;
  const extra = [['--paper-img', url ? `url("${url}")` : 'none'], ['--grain', root.style.getPropertyValue('--grain')], ['--tint', root.style.getPropertyValue('--tint')]];
  const css = [...Object.entries(tokens), ...extra].map(([k, v]) => `${k}:${v}`).join(';');
  try { localStorage.setItem(CACHE, JSON.stringify({ css, dark, tint, paper: !!url, auto: (p.rtheme || 'auto') === 'auto' })); } catch {}
  return dark;
}

// ---- the theme bar: a row of cards along the bottom, so you can watch the results change ----
function mini(t, paperId) {
  const url = paperUrl(paperId || t.paper);
  return `<span class="tc-prev" style="--tb:${t.bg};--tp:${t.page};--ti:${t.ink};--ta:${t.accent}${url ? `;--tx:url('${url}')` : ''}"><span class="tc-page${url ? ' grain' : ''}${t.dark ? ' dk' : ''}"><i></i><i></i><i class="hl"></i><i></i></span></span>`;
}
function themeCard(t, on) {
  let prev;
  if (t.auto) prev = '<span class="tc-prev tc-auto"><span class="l"><i></i><i></i><i></i></span><span class="d"><i></i><i></i><i></i></span></span>';
  else if (t.custom) prev = '<span class="tc-prev tc-custom"><span class="tc-page"><i></i><i></i><i class="hl"></i><i></i></span></span>';
  else prev = mini(t);
  return `<button class="tcard${on ? ' on' : ''}" data-theme="${t.id}" aria-pressed="${on}">${prev}<span>${t.name}</span></button>`;
}
function paperCard(pp, on, t) {
  const id = pp.id === 'theme' ? t.paper || 'smooth' : pp.id;
  return `<button class="tcard${on ? ' on' : ''}" data-paper="${pp.id}" aria-pressed="${on}">${mini(t, id)}<span>${pp.name}</span></button>`;
}

export function openThemeBar(prefs, { save }) {
  let bar = document.getElementById('themeBar');
  if (bar && !bar.hidden) { closeBar(bar, save); return; }
  if (!bar) {
    bar = document.createElement('section');
    bar.id = 'themeBar';
    bar.className = 'tbar';
    bar.setAttribute('aria-label', 'Reading theme');
    document.body.append(bar);
  }
  let tab = bar._tab || 'colours';
  const commit = () => { clearTimeout(bar._t); bar._t = setTimeout(save, 250); };
  const apply = () => { applyReadingTheme(prefs); commit(); };
  const keepScroll = (fn) => { const r = bar.querySelector('.tbar-row'); const x = r?.scrollLeft; fn(); const r2 = bar.querySelector('.tbar-row'); if (r2 && x != null) r2.scrollLeft = x; };
  const render = (centre) => {
    const t = resolveTheme(prefs);
    const lift = prefs.pageLift ?? themeLift(t);
    const c = prefs.custom || THEME_DEFAULTS.custom;
    let body = '';
    if (tab === 'colours') {
      body = `<div class="tbar-scroll"><button class="tbar-arrow l" data-scroll="-1" aria-label="Scroll left" hidden>${CHEV}</button><div class="tbar-row">${THEMES.map((x) => themeCard(x, (prefs.rtheme || 'auto') === x.id)).join('')}</div><button class="tbar-arrow r" data-scroll="1" aria-label="Scroll right" hidden>${CHEV}</button></div>
        ${prefs.rtheme === 'custom' ? `<div class="tbar-sliders">
          <label class="th-slider"><span>Hue</span><input type="range" min="0" max="360" value="${c.h}" data-k="h" class="hue" style="--sat:${Math.max(20, c.s * 1.4)}%"></label>
          <label class="th-slider"><span>Colour</span><input type="range" min="0" max="60" value="${c.s}" data-k="s"></label>
          <label class="th-slider"><span>Brightness</span><input type="range" min="0" max="100" value="${c.b}" data-k="b" class="bright"></label></div>` : ''}`;
    } else if (tab === 'paper') {
      body = `<div class="tbar-scroll"><button class="tbar-arrow l" data-scroll="-1" aria-label="Scroll left" hidden>${CHEV}</button><div class="tbar-row">${PAPERS.map((pp) => paperCard(pp, (prefs.paper || 'theme') === pp.id, t)).join('')}</div><button class="tbar-arrow r" data-scroll="1" aria-label="Scroll right" hidden>${CHEV}</button></div>
        <div class="tbar-sliders"><label class="th-slider"><span>Grain</span><input type="range" min="0" max="100" value="${prefs.grain ?? 50}" data-grain></label></div>
        <p class="tbar-credit">Paper textures: Subtle Patterns, CC BY-SA 3.0</p>`;
    } else {
      body = `<div class="tbar-sliders">
        <label class="th-slider lift"><span>Page vs background</span><input type="range" min="-100" max="100" value="${lift}" data-lift><button class="link-btn" data-lift-reset ${prefs.pageLift == null ? 'hidden' : ''}>Reset</button></label>
        <p class="tbar-hint"><span>← darker than the background</span><span>lighter →</span></p>
        <label class="th-switch"><span><b>Theme the pages</b><small>PDF pages take on the theme’s colour and paper (dark themes turn pages dark)</small></span><input type="checkbox" data-tint ${prefs.tint !== false ? 'checked' : ''}><i></i></label>
        <label class="th-slider"${prefs.tint !== false ? '' : ' hidden'}><span>Strength</span><input type="range" min="10" max="100" value="${prefs.tintAmt ?? 85}" data-amt></label>
      </div>`;
    }
    bar.innerHTML = `<div class="tbar-head">
        <div class="seg small tbar-tabs">${[['colours', 'Colours'], ['paper', 'Paper'], ['adjust', 'Adjust']].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>
        <button class="icon-btn sm" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div><div class="tbar-body">${body}</div>`;
    if (centre) bar.querySelector('.tcard.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    scrollable(bar.querySelector('.tbar-row'));
  };
  bar.onclick = (e) => {
    const sc = e.target.closest('[data-scroll]');
    if (sc) { const r = bar.querySelector('.tbar-row'); r.scrollBy({ left: Number(sc.dataset.scroll) * r.clientWidth * 0.8, behavior: 'smooth' }); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) { tab = bar._tab = tb.dataset.tab; render(true); return; }
    if (e.target.closest('[data-close]')) { closeBar(bar, save); return; }
    const th = e.target.closest('.tcard[data-theme]');
    if (th) { prefs.rtheme = th.dataset.theme; apply(); keepScroll(() => render()); return; }
    const pp = e.target.closest('.tcard[data-paper]');
    if (pp) { prefs.paper = pp.dataset.paper; apply(); keepScroll(() => render()); return; }
    if (e.target.closest('[data-lift-reset]')) { prefs.pageLift = null; apply(); render(); }
  };
  bar.oninput = (e) => {
    const t = e.target;
    if (t.dataset.k) { prefs.custom = { ...(prefs.custom || THEME_DEFAULTS.custom), [t.dataset.k]: Number(t.value) }; prefs.rtheme = 'custom'; }
    else if (t.hasAttribute('data-grain')) prefs.grain = Number(t.value);
    else if (t.hasAttribute('data-lift')) { prefs.pageLift = Number(t.value); bar.querySelector('[data-lift-reset]').hidden = false; }
    else if (t.hasAttribute('data-amt')) prefs.tintAmt = Number(t.value);
    else if (t.hasAttribute('data-tint')) { prefs.tint = t.checked; bar.querySelector('[data-amt]').closest('label').hidden = !t.checked; }
    else return;
    applyReadingTheme(prefs);
    commit();
  };
  render(true);
  bar.hidden = false;
  document.body.classList.add('tbar-open');
  bar.animate([{ transform: 'translateY(105%)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
}
const CHEV = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
// A row of cards you can move with the mouse wheel, by dragging, or with the arrows at its ends.
function scrollable(row) {
  if (!row) return;
  const wrap = row.parentElement;
  const sync = () => {
    const max = row.scrollWidth - row.clientWidth;
    wrap.querySelector('.l').hidden = row.scrollLeft < 4;
    wrap.querySelector('.r').hidden = row.scrollLeft > max - 4;
  };
  row.addEventListener('scroll', sync, { passive: true });
  requestAnimationFrame(sync);
  row.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // a trackpad already scrolls sideways
    const max = row.scrollWidth - row.clientWidth;
    if (max <= 0) return;
    e.preventDefault();
    row.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
  }, { passive: false });
  let drag = null;
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: row.scrollLeft, moved: false };
  });
  row.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    if (!drag.moved) { drag.moved = true; row.setPointerCapture(e.pointerId); row.classList.add('dragging'); }
    row.scrollLeft = drag.left - dx;
  });
  const end = () => {
    if (drag?.moved) {
      row.classList.remove('dragging');
      // the drag isn't a tap on the card under the mouse
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      row.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => row.removeEventListener('click', eat, { capture: true }), 60);
    }
    drag = null;
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
}
function closeBar(bar, save) {
  save();
  bar.animate([{ transform: 'none' }, { transform: 'translateY(105%)' }], { duration: 220, easing: 'ease-in' }).onfinish = () => {
    bar.hidden = true;
    document.body.classList.remove('tbar-open');
  };
}
export const themeBarOpen = () => { const b = document.getElementById('themeBar'); return !!b && !b.hidden; };
