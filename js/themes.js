// Reading themes: the app's colours and, if you like, the pages themselves.
// A theme is a background, a page colour, an ink colour and an accent; everything else is derived.

export const THEMES = [
  { id: 'auto', name: 'Match system', auto: true },
  { id: 'daylight', name: 'Daylight', bg: '#f5f4f1', page: '#ffffff', ink: '#1b1b1d', accent: '#2f54eb' },
  { id: 'paper', name: 'Paper', bg: '#ece8df', page: '#f9f7f1', ink: '#25231f', accent: '#3a5bd9' },
  { id: 'cream', name: 'Cream', bg: '#e9dfc6', page: '#f6eed9', ink: '#2f281d', accent: '#a0612a' },
  { id: 'sepia', name: 'Sepia', bg: '#dccaa6', page: '#efe1c3', ink: '#4a3923', accent: '#9a5216' },
  { id: 'sage', name: 'Sage', bg: '#d7e2d0', page: '#e8f0e2', ink: '#22301d', accent: '#3d7a4b' },
  { id: 'mist', name: 'Mist', bg: '#dfe4ec', page: '#eff2f7', ink: '#1c2431', accent: '#3a62c3' },
  { id: 'blush', name: 'Blush', bg: '#ecdedb', page: '#f8efed', ink: '#33231f', accent: '#b04757' },
  { id: 'dusk', name: 'Dusk', bg: '#303237', page: '#3b3e44', ink: '#e7e5e0', accent: '#8ea2ff', dark: true },
  { id: 'night', name: 'Night', bg: '#141517', page: '#1e1f23', ink: '#ecebe8', accent: '#7d95ff', dark: true },
  { id: 'ember', name: 'Night sepia', bg: '#1b1611', page: '#271f18', ink: '#e9d9bd', accent: '#e0a15a', dark: true },
  { id: 'navy', name: 'Midnight', bg: '#0d1421', page: '#162033', ink: '#d5deeb', accent: '#7aa7ff', dark: true },
  { id: 'forest', name: 'Forest', bg: '#111914', page: '#1a251e', ink: '#d5e3d7', accent: '#78c08f', dark: true },
  { id: 'black', name: 'Black', bg: '#000000', page: '#0c0c0c', ink: '#d4d4d4', accent: '#8ea2ff', dark: true },
  { id: 'custom', name: 'Custom', custom: true },
];
export const THEME_DEFAULTS = { rtheme: 'auto', tint: true, tintAmt: 85, pageContrast: 50, custom: { h: 38, s: 32, b: 86 } };

// ---- colour helpers ----
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const rgba = (a, al) => { const [r, g, b] = hex(a); return `rgba(${r}, ${g}, ${b}, ${al})`; };
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
    id: 'custom', name: 'Custom', dark,
    bg: hsl(h, s * 0.5, L),
    page: hsl(h, s * 0.55, dark ? Math.min(40, L + 5) : Math.min(98.5, L + 5)),
    ink: dark ? hsl(h, s * 0.25, 88) : hsl(h, s * 0.35, 13),
    accent: s < 8 ? (dark ? '#8ea2ff' : '#2f54eb') : hsl(h, Math.min(70, 35 + s), dark ? 68 : 40),
  };
}

export function resolveTheme(p) {
  const id = p.rtheme || 'auto';
  if (id === 'auto') return null;
  if (id === 'custom') return customTheme(p.custom || THEME_DEFAULTS.custom);
  return THEMES.find((t) => t.id === id && !t.auto && !t.custom) || null;
}

// All the colour tokens for a theme. pageContrast (0–100, 50 = as designed) moves the page away from or
// toward the background.
export function themeTokens(t, pageContrast = 50) {
  const amt = (pageContrast - 50) / 50;
  const page = amt >= 0 ? mix(t.page, t.dark ? '#ffffff' : '#ffffff', amt * (t.dark ? 0.1 : 0.6)) : mix(t.page, t.bg, -amt);
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
  for (const k of APPLIED) root.style.removeProperty(k);
  let dark;
  let css = '';
  if (t) {
    dark = !!t.dark;
    root.dataset.theme = dark ? 'dark' : 'light';
    const tokens = themeTokens(t, p.pageContrast ?? 50);
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
    css = Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';');
  } else {
    root.removeAttribute('data-theme');
    dark = matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // pages take on the theme: light themes tint the white paper, dark themes turn the page dark
  const tint = p.tint !== false;
  root.classList.toggle('doc-tint', tint);
  root.classList.toggle('doc-dark', tint && dark);
  root.style.setProperty('--tint', String((p.tintAmt ?? 85) / 100));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t ? t.bg : dark ? '#141517' : '#f5f4f1';
  try { localStorage.setItem(CACHE, JSON.stringify({ css, dark: t ? dark : null, tint, amt: (p.tintAmt ?? 85) / 100 })); } catch {}
  return dark;
}

// ---- the theme sheet ----
const swatch = (t, on) => {
  const c = t.custom ? null : t.auto ? null : t;
  const preview = t.auto
    ? `<span class="th-prev th-auto"><span class="th-half l"><i></i><i></i><i></i></span><span class="th-half d"><i></i><i></i><i></i></span></span>`
    : `<span class="th-prev" style="--tb:${c ? c.bg : 'var(--bg)'};--tp:${c ? c.page : 'var(--card)'};--ti:${c ? c.ink : 'var(--ink)'};--ta:${c ? c.accent : 'var(--accent)'}"><span class="th-page"><i></i><i></i><i class="hl"></i><i></i></span></span>`;
  return `<button class="th-swatch${on ? ' on' : ''}${t.custom ? ' custom' : ''}" data-id="${t.id}" aria-pressed="${on}">${preview}<span class="th-name">${t.name}</span></button>`;
};

export function openThemeSheet(prefs, { save, onChange }) {
  let dlg = document.getElementById('themeDlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'themeDlg';
    dlg.setAttribute('aria-label', 'Reading theme');
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  const apply = () => { applyReadingTheme(prefs); save(); onChange?.(); };
  const render = () => {
    const custom = prefs.rtheme === 'custom';
    const c = prefs.custom || THEME_DEFAULTS.custom;
    dlg.innerHTML = `<div class="th-sheet">
      <header><h3>Reading theme</h3><button class="icon-btn sm" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button></header>
      <div class="th-grid">${THEMES.map((t) => swatch(t, (prefs.rtheme || 'auto') === t.id)).join('')}</div>
      <section class="th-custom"${custom ? '' : ' hidden'}>
        <label class="th-slider"><span>Hue</span><input type="range" min="0" max="360" value="${c.h}" data-k="h" class="hue"></label>
        <label class="th-slider"><span>Colour</span><input type="range" min="0" max="60" value="${c.s}" data-k="s"></label>
        <label class="th-slider"><span>Brightness</span><input type="range" min="0" max="100" value="${c.b}" data-k="b" class="bright"></label>
      </section>
      <section class="th-pages">
        <label class="th-switch"><span><b>Theme the pages too</b><small>PDF pages take on the theme’s paper — white pages turn to it, and dark themes turn pages dark</small></span><input type="checkbox" data-tint ${prefs.tint !== false ? 'checked' : ''}><i></i></label>
        <label class="th-slider"${prefs.tint !== false ? '' : ' hidden'}><span>Strength</span><input type="range" min="10" max="100" value="${prefs.tintAmt ?? 85}" data-amt></label>
        <label class="th-slider"><span>Page contrast</span><input type="range" min="0" max="100" value="${prefs.pageContrast ?? 50}" data-pc></label>
      </section>
      <footer><button class="btn" data-reset>Reset</button><button class="btn primary" data-close>Done</button></footer>
    </div>`;
    const hue = dlg.querySelector('.hue');
    if (hue) hue.style.setProperty('--sat', `${Math.max(20, c.s * 1.4)}%`);
  };
  render();
  dlg.onclick = (e) => {
    if (e.target === dlg) return dlg.close();
    if (e.target.closest('[data-close]')) return dlg.close();
    const sw = e.target.closest('.th-swatch');
    if (sw) { prefs.rtheme = sw.dataset.id; apply(); render(); return; }
    if (e.target.closest('[data-reset]')) { Object.assign(prefs, structuredClone(THEME_DEFAULTS)); apply(); render(); }
  };
  dlg.oninput = (e) => {
    const t = e.target;
    if (t.dataset.k) { prefs.custom = { ...(prefs.custom || THEME_DEFAULTS.custom), [t.dataset.k]: Number(t.value) }; prefs.rtheme = 'custom'; dlg.querySelectorAll('.th-swatch').forEach((b) => b.classList.toggle('on', b.dataset.id === 'custom')); }
    else if (t.hasAttribute('data-amt')) prefs.tintAmt = Number(t.value);
    else if (t.hasAttribute('data-pc')) prefs.pageContrast = Number(t.value);
    else if (t.hasAttribute('data-tint')) { prefs.tint = t.checked; t.closest('section').querySelector('[data-amt]').closest('label').hidden = !t.checked; }
    else return;
    applyReadingTheme(prefs);
    clearTimeout(dlg._t);
    dlg._t = setTimeout(() => { save(); onChange?.(); }, 250);
  };
  if (!dlg.open) dlg.showModal();
}
