// The scrubber: a slim glass bar standing in for a scroll bar. Its top is the start of the list and its
// bottom the end (for pages, the first page and the last, every page evenly in between), so you can tap
// anywhere on it to jump or slide along it. Where you are shows as a bump in the bar; while your finger is
// on it the bump swells and travels along the bar with you, like a snake that's swallowed a mouse, with
// the page number floating beside it where there is one.
//
// A scrubber is made from an adapter:
//   rect()    — {top, bottom, right} on screen for the bar, or null when there's nothing to scrub
//   get()     — where you are, 0 … 1
//   set(f)    — go there
//   stops()   — how many pages the bar is divided into (for the label and the little tick), optional
//   label(i)  — {main, sub} for stop i, optional (no label, no floating tag)
//   prepare() — called as a drag starts, optional
//   layer     — the element whose stacking the bar joins (so menus over it stay over the bar), optional
//   scroller  — what scrolls (window by default)

const W = 64; // the element's width; the bar runs down near its right edge
const XC = W - 7; // the bar's centre line, just in from the edge
const PAD = 40; // room above and below the bar for the bump to swell into
const BASE = 5; // the bar's width at rest
const IDLE = { amp: 6, sig: 13 }; // the little bump marking where you are
const HELD = { amp: 22, sig: 30 }; // …and swollen while you drag

export function makeScrub(ad) {
  const box = document.createElement('div');
  box.className = 'scrub';
  box.innerHTML = '<div class="scrub-fill"></div><svg class="scrub-line" aria-hidden="true"><path/></svg><div class="scrub-hit"></div>';
  const tag = document.createElement('div');
  tag.className = 'scrub-tag';
  tag.innerHTML = '<b></b><small></small>';
  document.body.append(box);
  if (ad.label) document.body.append(tag);
  const fill = box.querySelector('.scrub-fill');
  const line = box.querySelector('.scrub-line');
  const path = line.querySelector('path');
  const hit = box.querySelector('.scrub-hit');
  const tagMain = tag.querySelector('b'), tagSub = tag.querySelector('small');

  let top = 0, h = 0, right = 0, lastRect = '';
  let f = 0; // where you are, 0 … 1
  let bumpY = 0, amp = IDLE.amp, sig = IDLE.sig, ampV = 0; // the bump as drawn (it eases toward its target)
  let drag = null, raf = 0, idleT = 0, tagT = 0, lastI = -1, shown = false, fresh = true;

  function measure(r) {
    top = Math.round(r.top) + 6;
    h = Math.max(0, Math.round(r.bottom) - 8 - top);
    right = Math.round(r.right);
    const key = `${top},${h},${right}`;
    if (key === lastRect) return false;
    lastRect = key;
    box.style.top = `${top - PAD}px`;
    box.style.height = `${h + PAD * 2}px`;
    box.style.left = `${right - W}px`;
    tag.style.right = `${innerWidth - right + 36}px`;
    line.setAttribute('viewBox', `0 0 ${W} ${h + PAD * 2}`);
    if (ad.layer) { const z = getComputedStyle(ad.layer()).zIndex; box.style.zIndex = tag.style.zIndex = z === 'auto' ? '' : z; }
    return true;
  }
  const yOf = (v) => top + v * h;
  const fOf = (y) => Math.max(0, Math.min(1, (y - top) / Math.max(1, h)));

  function shape() {
    const yb = bumpY - top + PAD, r = BASE / 2;
    const y0 = PAD, y1 = PAD + h;
    const half = (y) => {
      const d = (y - yb) / sig;
      const w = BASE / 2 + (amp / 2) * Math.exp(-d * d);
      // round the ends: the outline closes in like a pill's cap
      const e = Math.min(y - y0, y1 - y), R = Math.max(r, Math.min(w, 10));
      return e >= R ? w : w * Math.sqrt(Math.max(0, 1 - Math.pow(1 - e / R, 2)));
    };
    const ys = [];
    const near0 = Math.max(y0 + 12, yb - sig * 3), near1 = Math.min(y1 - 12, yb + sig * 3);
    for (let y = y0; y < y0 + 12; y += 1) ys.push(y);
    if (near0 < near1) { ys.push(near0); for (let y = near0 + 2; y < near1; y += 2) ys.push(y); ys.push(near1); }
    for (let y = y1 - 12; y <= y1; y += 1) ys.push(y);
    ys.sort((a, b) => a - b);
    const L = ys.map((y) => `${(XC - half(y)).toFixed(2)} ${y.toFixed(1)}`);
    const R = ys.slice().reverse().map((y) => `${(XC + half(y)).toFixed(2)} ${y.toFixed(1)}`);
    return `M${L.join('L')}L${R.join('L')}Z`;
  }

  function draw() {
    raf = 0;
    const r = ad.rect();
    const ok = !!r && r.bottom - r.top > 80;
    if (ok !== shown) { shown = ok; box.classList.toggle('on', ok); if (!ok) { tag.classList.remove('on'); lastRect = ''; fresh = true; } }
    if (!ok) return;
    const moved = measure(r);
    if (!drag) f = Math.max(0, Math.min(1, ad.get()));
    const want = yOf(f);
    if (fresh) { bumpY = want; fresh = false; }
    const tgt = drag ? HELD : IDLE;
    // the bump: firm on your finger, with a soft spring in its size so it swells and settles
    bumpY += (want - bumpY) * (drag ? 0.55 : 0.4);
    ampV = ampV * 0.62 + (tgt.amp - amp) * 0.2;
    amp += ampV;
    sig += (tgt.sig - sig) * 0.22;
    const d = shape();
    fill.style.clipPath = `path('${d}')`;
    fill.style.webkitClipPath = `path('${d}')`;
    path.setAttribute('d', d);
    if (tag.classList.contains('on')) tag.style.transform = `translate3d(0, ${Math.round(bumpY - tag.offsetHeight / 2)}px, 0)`;
    const moving = moved || Math.abs(want - bumpY) > 0.3 || Math.abs(tgt.amp - amp) > 0.05 || Math.abs(ampV) > 0.05 || Math.abs(tgt.sig - sig) > 0.1;
    if (moving) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(draw); }

  function showTag(v) {
    const n = ad.stops?.() || 0;
    const i = n > 1 ? Math.round(v * (n - 1)) : 0;
    if (i !== lastI) { lastI = i; if (n > 1) navigator.vibrate?.(3); if (!ad.label) return; const t = ad.label(i); tagMain.textContent = t.main; tagSub.textContent = t.sub || ''; tagSub.hidden = !t.sub; }
    if (!ad.label) return;
    clearTimeout(tagT);
    tag.classList.add('on');
  }
  const hideTag = (ms) => { clearTimeout(tagT); tagT = setTimeout(() => tag.classList.remove('on'), ms); };

  // awake while you scroll, then dims back
  function wake() {
    box.classList.add('awake');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (!drag) box.classList.remove('awake'); }, 1400);
  }

  function move(e) {
    if (!drag) return;
    e.preventDefault();
    f = fOf(e.clientY);
    ad.set(f);
    showTag(f);
    kick();
  }
  hit.addEventListener('pointerdown', (e) => {
    if (!shown || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    ad.prepare?.();
    drag = { id: e.pointerId };
    try { hit.setPointerCapture(e.pointerId); } catch {}
    box.classList.add('held', 'awake');
    lastI = -1;
    move(e);
  });
  hit.addEventListener('pointermove', move);
  const end = (e) => {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
    drag = null;
    box.classList.remove('held');
    hideTag(700);
    wake();
    kick();
  };
  hit.addEventListener('pointerup', end);
  hit.addEventListener('pointercancel', end);
  hit.addEventListener('lostpointercapture', end);
  // the list shouldn't scroll (or the drawer close) under a finger that's on the bar
  for (const t of ['touchstart', 'mousedown', 'click']) hit.addEventListener(t, (e) => e.stopPropagation(), { passive: t !== 'click' });
  hit.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });

  const sc = ad.scroller || window;
  sc.addEventListener('scroll', () => { if (!drag) { wake(); kick(); } }, { passive: true });
  addEventListener('resize', () => { lastRect = ''; kick(); });
  // panels slide in and out and views change with the body's classes: follow along for the slide
  new MutationObserver(() => { let k = 0; const t = () => { lastRect = ''; draw(); if (++k < 30) requestAnimationFrame(t); }; requestAnimationFrame(t); })
    .observe(document.body, { attributes: true, attributeFilter: ['class', 'data-view'] });
  return { refresh() { kick(); }, get dragging() { return !!drag; } };
}

// The pages of the results or of a document: the bar's stops are the pages, each an equal share of it.
export function pageScrub(app) {
  let items = [], dirty = true, root = null;
  const mo = new MutationObserver(() => { dirty = true; s.refresh(); });
  function collect() {
    const r = app.root();
    if (r !== root) { mo.disconnect(); root = r; if (r) mo.observe(r, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); }
    if (dirty || r !== root) items = root ? [...root.querySelectorAll('.page')].filter((a) => !a.hidden && a.offsetParent) : [];
    dirty = false;
    return items;
  }
  const s = makeScrub({
    rect() {
      const n = collect().length;
      if (n < 2 || document.scrollingElement.scrollHeight <= innerHeight + 40 || !app.on()) return null;
      return { top: app.trackTop(), bottom: app.bottomY(), right: innerWidth };
    },
    stops: () => items.length,
    // where you are: the page under the line where pages start, and how far through it
    get() {
      const n = items.length;
      const y = app.topY();
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (items[m].getBoundingClientRect().bottom <= y) lo = m + 1; else hi = m; }
      const r = items[lo].getBoundingClientRect();
      let p = Math.min(n - 1, lo + Math.max(0, Math.min(0.999, (y - r.top) / Math.max(1, r.height))));
      // the last page can't scroll up to the top, so over the final screenful the bump runs on to the end
      const max = document.scrollingElement.scrollHeight - innerHeight, left = max - scrollY;
      if (left < innerHeight && max > 0) p += (n - 1 - p) * (1 - Math.max(0, left) / innerHeight);
      return p / (n - 1);
    },
    // and the other way: scroll so that place is where pages start
    set(f) {
      const n = items.length, p = f * (n - 1);
      const i = Math.max(0, Math.min(n - 1, Math.floor(p))), fr = Math.min(1, p - i);
      const r = items[i].getBoundingClientRect();
      app.hold();
      window.scrollTo({ top: Math.round(scrollY + r.top + r.height * fr - app.topY()), behavior: 'instant' });
    },
    label: (i) => app.label(items[i]),
    prepare() { app.prepare(); dirty = true; collect(); },
  });
  return s;
}

// A list in a panel (the library, the pages-with-hits list): the bar runs down its right side and maps
// straight onto its scroll.
export function listScrub(el, opts = {}) {
  const scroller = typeof el === 'function' ? null : el;
  const get = () => (typeof el === 'function' ? el() : el);
  const s = makeScrub({
    scroller: scroller || window,
    layer: opts.layer,
    rect() {
      const e = get();
      if (!e || !e.offsetParent || e.scrollHeight <= e.clientHeight + 8 || getComputedStyle(e).visibility === 'hidden') return null;
      const r = e.getBoundingClientRect();
      if (r.right < 40 || r.left > innerWidth - 20 || r.bottom - r.top < 80) return null;
      return { top: Math.max(r.top, 0), bottom: Math.min(r.bottom, innerHeight), right: r.right + (opts.inset ?? 0) };
    },
    get() { const e = get(); return e.scrollTop / Math.max(1, e.scrollHeight - e.clientHeight); },
    set(f) { const e = get(); e.scrollTop = Math.round(f * (e.scrollHeight - e.clientHeight)); },
  });
  // the panel slides in and out, and the list grows and shrinks: keep the bar with it
  const e = get();
  if (e) {
    new ResizeObserver(() => s.refresh()).observe(e);
    new MutationObserver(() => s.refresh()).observe(e, { childList: true, subtree: true });
  }
  return s;
}
