// Send your whole library straight to another device: no file in between.
// The receiving device shows a QR code (and a short code); the sending device scans it (or types the code).
// The two connect directly over the local network (WebRTC); a public introduction service (PeerJS) only passes the
// connection details between them, never your documents. Works between the iPhone app, browsers on computers and Android.
//
// A transfer keeps going while you use the app: hide the sheet and a small pill shows its progress (tap it to come back).
// If the connection drops (Wi-Fi blips, the phone locks, the other device sleeps), it pauses and keeps trying to
// reconnect; once it does, it carries on from the last byte that arrived, so nothing is sent twice or lost.
import qrcode from '../vendor/transfer/qrcode.mjs';
import { backupStream, readBackup, inventory } from './backup.js';
import { isNative, platform, Files, writeBytes, removeFile, diskFile } from './native.js';

const WEB_URL = 'https://instant-search-virid.vercel.app/';
const CHUNK = 64 * 1024;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// (tests can point this at their own connection service)
const PEER_OPTS = () => ({ debug: 0, ...(globalThis.__peerOpts || {}) });
const peerId = (code) => `findly-xfer-${code.toLowerCase()}`;
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join('');
const fmt = (b) => (b < 1048576 ? `${Math.max(b ? 1 : 0, Math.round(b / 1024))} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
// What this device is, as the other one will show it: its kind (for the picture) and a name.
const ua = navigator.userAgent;
function deviceKind() {
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // an iPad asking for the desktop site
  if (platform === 'ios') return /iPad/.test(ua) || touchMac ? 'ipad' : 'iphone';
  if (platform === 'windows') return 'windows';
  if (/iPad/.test(ua) || touchMac) return 'ipad';
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'android' : 'android-tablet';
  if (/CrOS/.test(ua)) return 'chromebook';
  const p = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Mac/i.test(p) || /Macintosh/.test(ua)) return 'mac';
  if (/Win/i.test(p) || /Windows/.test(ua)) return 'windows';
  if (/Linux|X11/i.test(p + ua)) return 'linux';
  return 'computer';
}
const KIND_NAME = { iphone: 'iPhone', ipad: 'iPad', android: 'Android phone', 'android-tablet': 'Android tablet', mac: 'Mac', windows: 'Windows PC', chromebook: 'Chromebook', linux: 'Linux PC', computer: 'Computer' };
const device = () => KIND_NAME[deviceKind()];
// the model, where the browser will say (Android: "Pixel 8"), worked out once
let modelName = null;
(async () => { try { const v = await navigator.userAgentData?.getHighEntropyValues?.(['model']); if (v?.model) modelName = v.model; } catch {} })();
const me = () => ({ kind: deviceKind(), name: modelName || device() });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keepAwake = (on) => { if (isNative) Files.keepAwake?.({ on }).catch?.(() => {}); };

function load(src, global) {
  if (globalThis[global]) return Promise.resolve(globalThis[global]);
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok(globalThis[global]);
    s.onerror = () => bad(new Error('couldn’t load the transfer tools'));
    document.head.append(s);
  });
}
const loadPeer = () => load('vendor/transfer/peerjs.min.js', 'peerjs').then((m) => m.Peer || m.default?.Peer);

// ---- the sheet, and the pill it shrinks into so you can keep using the app ----
// The sheet has a little scene at its top that carries through the whole transfer: the two devices, the line
// between them that goes from searching to linked, documents streaming across it (faster when it's fast), a ring
// filling round the receiving device, and a check when it's all there. Below it, the words and buttons for each step
// slide in as the last ones slip away.
const GLYPH = {
  phone: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 5h3"/></svg>',
  tablet: '<svg viewBox="0 0 24 24"><rect x="4" y="2.5" width="16" height="19" rx="2.4"/><path d="M11 18.5h2"/></svg>',
  laptop: '<svg viewBox="0 0 24 24"><rect x="4.5" y="5" width="15" height="10.5" rx="1.6"/><path d="M2.5 18.5h19"/></svg>',
  desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M9 20h6M12 16v4"/></svg>',
  unknown: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="11" height="9" rx="1.5"/><rect x="15.5" y="8" width="5.5" height="10" rx="1.5"/><path d="M6 18.5h5"/></svg>',
};
const KIND_GLYPH = { iphone: 'phone', android: 'phone', ipad: 'tablet', 'android-tablet': 'tablet', mac: 'laptop', chromebook: 'laptop', windows: 'desktop', linux: 'desktop', computer: 'laptop' };
// (older versions of the app only send a name: work the picture out from that)
const kindFromName = (n) => (/iPad|tablet/i.test(n) ? 'ipad' : /iPhone|Android|phone/i.test(n) ? 'iphone' : /Mac/i.test(n) ? 'mac' : /Windows|PC/i.test(n) ? 'windows' : n ? 'computer' : '');
const glyphFor = (kind) => GLYPH[KIND_GLYPH[kind]] || GLYPH.unknown;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let current = null; // one transfer at a time
function panel(kind) {
  const title = kind === 'send' ? 'Send to another device' : 'Receive from another device';
  const self = me();
  const d = document.createElement('dialog');
  d.className = 'xfer';
  const dev = (side, k, label) => `<div class="xf-dev ${side}"><div class="xf-halo"></div><svg class="xf-pr" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><circle class="v" cx="32" cy="32" r="29" pathLength="100"/></svg><div class="xf-glyph">${glyphFor(k)}</div><svg class="xf-ok" viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" pathLength="100"/></svg><small>${esc(label)}</small></div>`;
  // the sender's always on the left, the receiver on the right: documents flow left to right
  const mine = `This ${self.name}`;
  const left = kind === 'send' ? dev('a', self.kind, mine) : dev('a', '', 'Other device');
  const right = kind === 'send' ? dev('b', '', 'Other device') : dev('b', self.kind, mine);
  d.innerHTML = `<div class="xf-head"><h3>${esc(title)}</h3><button class="xf-stop" data-cancel hidden>Stop</button><button class="icon-btn sm" data-x aria-label="Hide"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button></div>
    <div class="xf-body"><div class="xf-stage" hidden>${left}<div class="xf-link"><i class="xf-line"></i><div class="xf-flow"></div><b class="xf-pulse"></b></div>${right}</div><div class="xf-info"></div></div>
    <div class="xf-foot" hidden><button class="btn primary" data-hide>Keep using the app</button></div>`;
  const pill = document.createElement('button');
  pill.className = 'xf-pill';
  pill.hidden = true;
  pill.innerHTML = '<svg class="xf-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="v" cx="18" cy="18" r="15" pathLength="100"/></svg><span></span>';
  document.body.append(d, pill);
  d.show(); // not modal: the app stays usable underneath
  const body = d.querySelector('.xf-body');
  const stage = d.querySelector('.xf-stage');
  const info = d.querySelector('.xf-info');
  // which step the scene shows: null (hidden: the QR code and camera have their own), connecting, linked,
  // sending, paused, placing, done, error
  let phase = null;
  const setPhase = (p) => {
    if (p === phase) return;
    const was = phase;
    phase = p;
    if (!p) { if (!stage.hidden) { stage.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 160, easing: 'ease-in' }).onfinish = () => { if (!phase) stage.hidden = true; }; } return; }
    if (stage.hidden) { stage.hidden = false; if (!reduce()) stage.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' }); }
    stage.className = `xf-stage is-${p}`;
    // the moment they find each other: the line snaps solid with a pulse, and a tap you can feel
    if ((p === 'linked' || p === 'sending') && (was === 'connecting' || was === null) && !reduce()) {
      stage.classList.add('just-linked');
      setTimeout(() => stage.classList.remove('just-linked'), 900);
      navigator.vibrate?.(12);
    }
    if (p === 'done') { navigator.vibrate?.([10, 60, 18]); burst(); }
    if (p === 'error') stage.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 380 });
    flow(p === 'sending');
  };
  // documents streaming across: little sheets of paper, a few a second, more when it's quicker
  let flowT = 0, rate = 0;
  const flow = (on) => {
    clearTimeout(flowT);
    if (!on || reduce()) return;
    const lane = stage.querySelector('.xf-flow');
    const spawn = () => {
      if (phase !== 'sending' || !d.isConnected) return;
      if (lane.childElementCount < 14) {
        const p = document.createElement('i');
        p.style.setProperty('--y', `${(Math.random() * 14 - 7).toFixed(1)}px`);
        p.style.setProperty('--r', `${(Math.random() * 30 - 15).toFixed(0)}deg`);
        lane.append(p);
        p.addEventListener('animationend', () => p.remove(), { once: true });
      }
      // ~1.2 MB/s and up: as busy as it gets; slower: calmer
      const every = Math.max(90, Math.min(520, 520 - Math.min(1, rate / 1.2e6) * 430));
      flowT = setTimeout(spawn, every * (0.75 + Math.random() * 0.5));
    };
    spawn();
  };
  // the finish: a ripple out from the receiving device
  const burst = () => {
    if (reduce()) return;
    const host = stage.querySelector('.xf-dev.b');
    for (let k = 0; k < 2; k++) {
      const r = document.createElement('b');
      r.className = 'xf-ripple';
      r.style.animationDelay = `${k * 160}ms`;
      host.append(r);
      r.addEventListener('animationend', () => r.remove(), { once: true });
    }
    for (let k = 0; k < 10; k++) {
      const s = document.createElement('i');
      s.className = 'xf-spark';
      const a = (k / 10) * Math.PI * 2 + Math.random() * 0.4;
      s.style.setProperty('--dx', `${Math.cos(a) * (38 + Math.random() * 16)}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * (38 + Math.random() * 16)}px`);
      host.append(s);
      s.addEventListener('animationend', () => s.remove(), { once: true });
    }
  };
  const ring = (p) => { const v = stage.querySelector('.xf-dev.b .xf-pr .v'); v.style.strokeDasharray = `${(p * 100).toFixed(2)} 100`; v.style.opacity = p > 0.003 ? '1' : '0'; }; // (a round cap at 0 would leave a dot)
  // the words below: the old ones slip up and away as the new ones rise in
  let swapT = 0;
  const setInfo = (html) => {
    clearTimeout(swapT);
    for (const x of info.querySelectorAll(':scope > .xf-step.out')) x.remove(); // anything still leaving goes now
    const old = info.querySelector(':scope > .xf-step');
    const next = document.createElement('div');
    next.className = 'xf-step';
    next.innerHTML = html;
    if (!old || reduce()) { info.replaceChildren(next); return next; }
    old.classList.add('out');
    old.style.position = 'absolute';
    info.append(next);
    next.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    old.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).onfinish = () => old.remove();
    return next;
  };
  // the number counts up smoothly between updates, and the speed and time left are worked out as it goes
  let shown = 0, target = 0, numRaf = 0, last = null;
  const tick = () => {
    numRaf = 0;
    shown += (target - shown) * 0.18;
    if (Math.abs(target - shown) < 0.05) shown = target;
    const n = info.querySelector('.xf-pct b');
    if (n) n.textContent = Math.floor(shown);
    if (shown !== target) numRaf = requestAnimationFrame(tick);
  };
  const t = {
    kind, d, body, pill, active: false, finished: false, live: false,
    // the pill's words when the sheet is tucked away and nothing is being sent yet
    note(text) { if (!t.active) { pill.querySelector('span').textContent = text; pill.querySelector('.v').style.strokeDasharray = '0 100'; } },
    // the other device introduced itself: show it by name
    other(name, k) {
      const side = kind === 'send' ? 'b' : 'a';
      const host = stage.querySelector(`.xf-dev.${side}`);
      host.querySelector('.xf-glyph').innerHTML = glyphFor(k || kindFromName(name));
      host.animate([{ transform: 'scale(0.85)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.4)' });
      const n = String(name || '').replace(/^an? /i, '');
      host.querySelector('small').textContent = n === n.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1) : n; // ("computer" → "Computer", but iPhone stays iPhone)
    },
    // something went wrong: say what, and offer to start again
    fail(msg, retry) {
      t.active = false;
      keepAwake(false);
      d.querySelector('.xf-foot').hidden = true;
      if (phase) setPhase('error');
      setInfo(`<p class="xf-err">${esc(msg)}</p>${retry ? '<div class="xf-btns"><button class="btn primary" data-retry>Try again</button></div>' : ''}`);
      if (retry) info.querySelector('[data-retry]').onclick = () => { t.onCancel?.(); t.destroy(); retry(); };
      pill.classList.add('paused');
      pill.querySelector('span').textContent = 'Transfer stopped · tap';
    },
    onCancel: null, onDone: null,
    // a step: its words (and buttons), with the scene showing where things are
    set(html, p = null) { setPhase(p); return setInfo(html); },
    get info() { return info; },
    // running: the scene, the sheet's numbers and the pill stay in step
    status(label, done, total, { paused = false, placing = false } = {}) {
      t.active = true;
      d.querySelector('.xf-foot').hidden = false;
      const p = total ? Math.min(1, done / total) : 0;
      const pct = Math.floor(p * 100);
      setPhase(paused ? 'paused' : placing ? 'placing' : 'sending');
      // how fast: a gentle average, so it doesn't jitter
      const now = performance.now();
      // (measured over at least a second: the connection takes a few MB at once whenever its buffer empties, and
      // measuring across that burst showed impossible speeds like 900 MB/s)
      if (paused || placing || !last || done < last.done) { if (!paused) last = { done, at: now }; }
      else if (now - last.at >= 1000) {
        const r = ((done - last.done) / (now - last.at)) * 1000;
        rate = rate ? rate * 0.6 + r * 0.4 : r;
        last = { done, at: now };
      }
      if (!info.querySelector('.xf-run')) {
        setInfo('<div class="xf-run"><p class="xf-big"></p><p class="xf-pct"><b>0</b><span>%</span></p><div class="xf-bar"><i></i></div><p class="xf-sub"></p></div>');
        shown = 0;
      }
      const run = info.querySelector('.xf-run');
      run.querySelector('.xf-big').textContent = label;
      run.querySelector('.xf-pct').hidden = placing && !total;
      run.querySelector('.xf-bar i').style.width = `${(p * 100).toFixed(1)}%`;
      run.querySelector('.xf-bar').classList.toggle('paused', paused);
      target = p * 100;
      if (!numRaf) numRaf = requestAnimationFrame(tick);
      const left = rate > 0 && !paused && !placing ? (total - done) / rate : 0;
      const eta = left > 90 ? `about ${Math.round(left / 60)} min left` : left > 3 ? `about ${Math.round(left / 5) * 5 || 5} s left` : '';
      run.querySelector('.xf-sub').textContent = total && !placing ? [`${fmt(done)} of ${fmt(total)}`, rate > 0 && !paused ? `${fmt(rate)}/s` : '', eta].filter(Boolean).join(' · ') : '';
      ring(placing ? 1 : p);
      stage.classList.toggle('placing', placing);
      pill.classList.toggle('paused', paused);
      pill.querySelector('.v').style.strokeDasharray = `${(p * 100).toFixed(1)} 100`;
      pill.querySelector('span').textContent = paused ? `Paused · ${pct}%` : `${kind === 'send' ? 'Sending' : 'Receiving'} ${pct}%`;
    },
    hide() { if (d.open) d.close(); pill.hidden = false; },
    show() { pill.hidden = true; if (!d.open) d.show(); },
    finish(html, { pillText = null, onTap = null, ok = false } = {}) {
      t.active = false;
      t.finished = true;
      keepAwake(false);
      d.querySelector('.xf-foot').hidden = true;
      d.querySelector('[data-cancel]').hidden = true; // nothing left to stop: only the close button stays
      if (ok) { ring(1); setPhase('done'); } else if (phase) setPhase('error');
      setInfo(html);
      const toPill = () => { pill.hidden = false; pill.classList.remove('paused'); pill.classList.add('done'); pill.querySelector('span').textContent = pillText; pill.onclick = onTap || (() => t.show()); };
      if (pillText && !d.open) toPill();
      else pill.hidden = true;
      if (ok) {
        // done: let the tick play, then tidy away this sheet and whatever it was opened from (Settings)
        setTimeout(() => {
          if (!t.finished || current !== t) return;
          for (const o of document.querySelectorAll('dialog[open]')) if (o !== d) { try { o.close(); } catch {} }
          if (onTap) { if (d.open) d.close(); toPill(); return; } // still something to tap (load the library)
          t.destroy();
        }, 2200);
      }
    },
    destroy() { t.active = false; clearTimeout(flowT); keepAwake(false); if (d.open) d.close(); d.remove(); pill.remove(); if (current === t) current = null; },
  };
  // hiding keeps it going (the pill shows how it's doing); Stop ends it and cleans everything up
  const tuck = () => (t.live && !t.finished ? t.hide() : (t.onCancel?.(), t.destroy()));
  d.querySelector('[data-x]').onclick = tuck;
  d.querySelector('[data-hide]').onclick = () => t.hide();
  d.querySelector('[data-cancel]').onclick = () => { t.onCancel?.(); t.destroy(); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); tuck(); });
  t.goLive = () => { t.live = true; d.querySelector('[data-cancel]').hidden = false; t.note('Getting ready…'); };
  pill.onclick = () => t.show();
  current = t;
  return t;
}
function busy() {
  if (!current) return false;
  current.show();
  return true;
}

const choose = (t, html) => new Promise((ok) => {
  const step = t.set(`${html}<div class="xf-opts">
      <button class="xf-opt on" data-v="merge"><b>Add what’s new</b><span>Only documents this device doesn’t have yet, or that changed. Nothing here is removed and there are no duplicates.</span></button>
      <button class="xf-opt" data-v="replace"><b>Replace everything</b><span>Make this device an exact copy of the other one, settings included.</span></button>
    </div><div class="xf-btns"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Receive</button></div>`, 'linked');
  let v = 'merge';
  step.querySelectorAll('.xf-opt').forEach((b) => (b.onclick = () => { v = b.dataset.v; step.querySelectorAll('.xf-opt').forEach((x) => x.classList.toggle('on', x === b)); }));
  step.querySelector('[data-yes]').onclick = () => ok(v);
  step.querySelector('[data-no]').onclick = () => ok(null);
});

// keep the introduction service connected (it drops when the network does)
function watchPeer(peer, t) {
  const kick = () => { if (!peer.destroyed && peer.disconnected && navigator.onLine !== false) try { peer.reconnect(); } catch {} };
  peer.on('disconnected', () => setTimeout(kick, 1500));
  const iv = setInterval(kick, 4000);
  addEventListener('online', kick);
  return () => { clearInterval(iv); removeEventListener('online', kick); };
}

/** This device receives: show the code, wait for the other device, then take everything in. */
export async function receive({ reload }) {
  if (busy()) return;
  const t = panel('receive');
  let peer, conn = null, sink = null, session = null, mode = 'merge', expect = 0, got = 0, label = 'Receiving…', unwatch = () => {};
  let writing = Promise.resolve();
  const stop = () => { unwatch(); try { conn?.send(JSON.stringify({ t: 'cancel' })); } catch {} peer?.destroy(); sink?.drop?.(); };
  t.onCancel = stop;
  const again = () => receive({ reload });
  t.set('<p class="xf-sub">Getting ready…</p>');
  let Peer;
  try { Peer = await loadPeer(); } catch (e) { t.fail(`${e.message}. Check your internet connection.`, again); return; }
  const code = newCode();
  peer = new Peer(peerId(code), PEER_OPTS());
  t.goLive();
  unwatch = watchPeer(peer, t);
  const slow = setTimeout(() => { if (!peer.open && !t.active) { stop(); t.fail('Couldn’t reach the connection service. Check this device is online and try again.', again); } }, 15000);
  const paused = (why) => { if (t.active && !t.finished) t.status(why, got, expect, { paused: true }); };
  peer.on('error', (e) => {
    if (t.finished) return;
    if (t.active) paused('Paused: reconnecting…');
    else if (e.type !== 'network' && e.type !== 'disconnected') { stop(); t.fail(`Couldn’t connect (${e.type || e.message}). Check both devices are online and try again.`, again); }
  });
  peer.on('open', () => {
    clearTimeout(slow);
    if (t.active || t.finished) return; // a reconnect: the code on screen is still the same
    t.note(`Waiting · code ${code.slice(0, 3)} ${code.slice(3)}`);
    const qr = qrcode(0, 'M');
    qr.addData(`${WEB_URL}#send-to=${code}`);
    qr.make();
    const chars = [...code].map((ch, k) => `${k === 3 ? '<em></em>' : ''}<span style="--k:${k}">${ch}</span>`).join('');
    t.set(`<div class="xf-qr"><b class="xf-wave"></b><b class="xf-wave"></b><b class="xf-wave"></b><div class="xf-qr-card">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div></div>
      <p class="xf-big">On the other device: Settings › <b>Send to another device</b>, then scan this</p>
      <p class="xf-sub">or type the code</p><p class="xf-code" aria-label="${code}">${chars}</p>
      <p class="xf-note">Both devices on the same Wi-Fi is fastest.</p>`);
  });
  peer.on('connection', (c) => {
    c.on('data', async (m) => {
      if (typeof m === 'string') {
        const msg = JSON.parse(m);
        if (msg.t === 'hello') {
          if (session) { c.close(); return; } // already busy with another device
          conn = c;
          session = msg.sid;
          t.other(msg.from, msg.kind);
          // the usual: just what's new or changed, added to what's here; or start over with exactly what the other device has
          const pick = await choose(t, `<p class="xf-big">${/^[aeiou]/i.test(msg.from) ? 'An' : 'A'} ${esc(msg.from)} wants to send its library (${msg.docs} document${msg.docs === 1 ? '' : 's'}).</p>`);
          if (!pick) { c.send(JSON.stringify({ t: 'no' })); t.destroy(); stop(); return; }
          mode = pick;
          t.set('<p class="xf-big">Comparing libraries…</p><p class="xf-sub">Working out what’s new</p>', 'linked');
          c.send(JSON.stringify({ t: 'go', mode, from: me().name, kind: me().kind, have: mode === 'merge' ? await inventory() : null }));
        } else if (msg.t === 'resume' && msg.sid === session) {
          // the same transfer, after a dropped connection: carry on from what arrived
          conn = c;
          await writing;
          await sink?.flush();
          c.send(JSON.stringify({ t: 'from', offset: got }));
          t.status(label, got, expect);
        } else if (c !== conn) {
          // a message from an old connection: ignore it
        } else if (msg.t === 'size') {
          expect = msg.size;
          sink = await makeSink();
          label = msg.sending ? `Receiving ${msg.sending} new or changed document${msg.sending === 1 ? '' : 's'}` : 'Bringing names, folders and boards up to date';
          keepAwake(true);
          t.status(label, 0, expect);
          c.send(JSON.stringify({ t: 'ready' }));
        } else if (msg.t === 'done') {
          await writing;
          await sink.flush();
          if (got < expect) { c.send(JSON.stringify({ t: 'from', offset: got })); return; } // something went missing: ask again
          t.status('Putting everything in place…', 0, 1, { placing: true });
          try {
            const b = await readBackup(await sink.file());
            await b.restore((n, of) => t.status('Putting everything in place…', n, of, { placing: true }), { merge: mode === 'merge' });
            c.send(JSON.stringify({ t: 'ok' }));
            sink.drop();
            unwatch();
            if (mode === 'merge') { // just bring the library up to date, no reload
              await Promise.resolve(reload('merge')).catch(() => {});
              t.finish('<p class="xf-big">All here.</p><p class="xf-sub">Your library is up to date.</p>', { pillText: 'Received ✓', ok: true });
            } else {
              t.finish('<p class="xf-big">All here.</p><p class="xf-sub">Load it now, or keep going and load it later.</p><div class="xf-btns"><button class="btn primary" data-load>Load my library</button></div>',
                { pillText: 'Received · tap to load', onTap: () => reload('replace'), ok: true });
              t.info.querySelector('[data-load]').onclick = () => reload('replace');
            }
            setTimeout(() => peer.destroy(), 1500);
          } catch (e) {
            c.send(JSON.stringify({ t: 'fail', why: e?.message || String(e) }));
            t.finish(`<p class="xf-err">Couldn’t finish: ${esc(e?.message || e)}</p>`, { pillText: 'Transfer failed' });
          }
        } else if (msg.t === 'cancel') {
          t.finish('<p class="xf-err">The other device stopped sending.</p>', { pillText: 'Transfer cancelled' });
          stop();
        }
        return;
      }
      if (c !== conn || !sink) return;
      const n = m.byteLength;
      writing = writing.then(() => sink.add(m));
      got += n;
      if (got === expect || got % (CHUNK * 32) < CHUNK) t.status(label, got, expect);
    });
    c.on('close', () => { if (c === conn && t.active && !t.finished) paused('Paused: connection lost, waiting for the other device…'); });
  });
  addEventListener('offline', () => paused('Paused: no internet'), { once: false });
}

// where incoming bytes go: a file in the app's folder on the iPhone, memory (that the browser can page out) elsewhere
async function makeSink() {
  if (isNative) {
    const path = '.transfer/incoming.isbackup';
    await writeBytes(path, new Uint8Array(0));
    let buf = [], n = 0;
    let chain = Promise.resolve();
    const write = () => {
      if (!n) return chain;
      const all = new Uint8Array(n);
      let at = 0;
      for (const b of buf) { all.set(new Uint8Array(b), at); at += b.byteLength; }
      buf = []; n = 0;
      chain = chain.then(() => Files.write({ path, data: toB64(all), append: true }));
      return chain;
    };
    return {
      async add(b) { buf.push(b); n += b.byteLength; if (n >= 3 * 1024 * 1024) await write(); },
      async flush() { await write(); await chain; },
      file: () => diskFile(path),
      drop: () => removeFile(path),
    };
  }
  const parts = [];
  return { async add(b) { parts.push(new Blob([b])); }, async flush() {}, file: async () => new Blob(parts), drop() { parts.length = 0; } };
}
function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** This device sends: scan the other device's code (or type it), then stream everything across. */
export async function send({ code: given = '' } = {}) {
  if (busy()) return;
  const t = panel('send');
  let stream = null, peer, video, camOff = false, conn = null, target = '', token = 0, sent = 0, unwatch = () => {}, retrying = false;
  const sid = newCode() + newCode();
  const stopCam = () => { camOff = true; video?.srcObject?.getTracks().forEach((x) => x.stop()); };
  t.onCancel = () => { stopCam(); token++; unwatch(); try { conn?.send(JSON.stringify({ t: 'cancel' })); } catch {} setTimeout(() => peer?.destroy(), 300); };
  const pausedNow = (why) => { if (t.active && !t.finished) t.status(why, sent, stream?.size || 0, { paused: true }); };
  // open (or reopen) the connection to the receiver; on a reopen, ask where to carry on from
  const open = (resume) => {
    const c = peer.connect(peerId(target), { serialization: 'raw', reliable: true });
    c.on('open', () => {
      conn = c;
      retrying = false;
      if (resume) c.send(JSON.stringify({ t: 'resume', sid }));
      else {
        t.set('<p class="xf-big">Connected</p><p class="xf-sub">Waiting for the other device to accept…</p>', 'linked');
        t.note('Waiting for the other device…');
        c.send(JSON.stringify({ t: 'hello', sid, from: me().name, kind: me().kind, docs: stream.summary.docs }));
      }
    });
    c.on('data', async (m) => {
      if (typeof m !== 'string' || c !== conn) return;
      const msg = JSON.parse(m);
      if (msg.t === 'no') t.finish('<p class="xf-sub">The other device said no.</p>');
      else if (msg.t === 'go') {
        if (msg.from) t.other(msg.from, msg.kind);
        t.set('<p class="xf-big">Accepted</p><p class="xf-sub">Working out what to send…</p>', 'linked');
        try { stream = await backupStream({ have: msg.mode === 'merge' ? msg.have || [] : null }); } catch (e) { t.set(`<p class="xf-err">Couldn’t read your library: ${esc(e?.message || e)}</p>`, 'error'); return; }
        c.send(JSON.stringify({ t: 'size', size: stream.size, sending: stream.summary.sending }));
      } else if (msg.t === 'ready') { keepAwake(true); pump(c, 0); }
      else if (msg.t === 'from') pump(c, msg.offset); // carry on from what the other device already has
      else if (msg.t === 'ok') { unwatch(); t.finish('<p class="xf-big">Sent.</p><p class="xf-sub">Your library is on the other device now.</p>', { pillText: 'Sent ✓', ok: true }); setTimeout(() => peer.destroy(), 1500); }
      else if (msg.t === 'fail') t.finish(`<p class="xf-err">The other device couldn’t finish: ${esc(msg.why)}</p>`, { pillText: 'Transfer failed' });
      else if (msg.t === 'cancel') { t.finish('<p class="xf-err">The other device cancelled.</p>', { pillText: 'Transfer cancelled' }); token++; }
    });
    c.on('close', () => { if (c === conn && t.active && !t.finished) { token++; pausedNow('Paused: connection lost, reconnecting…'); reconnect(); } });
    c.on('error', () => {});
  };
  // keep trying until the other device answers again
  const reconnect = async () => {
    if (retrying) return;
    retrying = true;
    while (retrying && t.active && !t.finished) {
      await sleep(3000);
      if (!retrying || t.finished) break;
      if (navigator.onLine === false) { pausedNow('Paused: no internet'); continue; }
      if (peer.disconnected) { try { peer.reconnect(); } catch {} continue; }
      open(true);
    }
  };
  // push the backup across from a byte offset, a piece at a time, never running ahead of the connection
  const pump = async (c, from) => {
    const my = ++token;
    const dc = c.dataChannel;
    dc.bufferedAmountLowThreshold = 1 << 20;
    const drain = () => new Promise((ok) => { if (dc.bufferedAmount < 4 << 20 || dc.readyState !== 'open') return ok(); dc.addEventListener('bufferedamountlow', ok, { once: true }); setTimeout(ok, 5000); });
    sent = from;
    const n = stream.summary.sending;
    const what = n ? `Sending ${n} new or changed document${n === 1 ? '' : 's'}…` : 'Sending names, folders and boards…'; // so you can see what's going
    t.status(what, sent, stream.size);
    let pos = 0;
    const segs = [{ size: stream.head.length, read: async () => stream.head }, ...stream.parts.map((p) => ({ size: p.size, read: async () => new Uint8Array(await (await p.read()).arrayBuffer()) }))];
    try {
      for (const seg of segs) {
        if (pos + seg.size <= from) { pos += seg.size; continue; }
        const u8 = await seg.read();
        for (let i = Math.max(0, from - pos); i < u8.length; i += CHUNK) {
          if (my !== token) return; // paused, or a newer pump took over
          await drain();
          if (dc.readyState !== 'open') return;
          const piece = u8.slice(i, i + CHUNK);
          dc.send(piece.buffer);
          sent = pos + i + piece.length;
          if (sent === stream.size || sent % (CHUNK * 32) < CHUNK) t.status(what, sent, stream.size);
        }
        pos += seg.size;
      }
      await drain();
      if (my !== token) return;
      c.send(JSON.stringify({ t: 'done' }));
      t.status('Sent everything: the other device is putting it in place…', stream.size, stream.size, { placing: true });
    } catch (e) {
      if (my === token) { pausedNow('Paused: reconnecting…'); reconnect(); }
    }
  };
  addEventListener('offline', () => pausedNow('Paused: no internet'));
  addEventListener('online', () => { if (t.active && !t.finished) reconnect(); });

  const connect = async (code) => {
    stopCam();
    target = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (target.length !== 6) return;
    const again = () => send({ code: target });
    t.set('<p class="xf-big">Connecting…</p><p class="xf-sub">Finding the other device</p>', 'connecting');
    t.note('Connecting…');
    let Peer;
    try { Peer = await loadPeer(); } catch (e) { t.fail(`${e.message}. Check your internet connection.`, again); return; }
    try { stream = await backupStream(); } catch (e) { t.fail(`Couldn’t read your library: ${e?.message || e}`, again); return; }
    peer = new Peer(PEER_OPTS());
    t.goLive();
    unwatch = watchPeer(peer, t);
    // nothing back from the other device in time: say so instead of spinning forever
    setTimeout(() => { if (!conn && !t.finished && !t.active) { t.onCancel?.(); t.fail('The other device didn’t answer. Check the code, that it’s still showing the Receive screen, and that both devices are online.', again); } }, 20000);
    peer.on('error', (e) => {
      if (t.active) { pausedNow('Paused: reconnecting…'); reconnect(); return; }
      if (!t.finished) { t.onCancel?.(); t.fail(e.type === 'peer-unavailable' ? 'That code isn’t showing on any device. Check it, and that the other device is still on the Receive screen.' : `Couldn’t connect (${e.type || e.message}).`, again); }
    });
    let first = true;
    peer.on('open', () => { if (first) { first = false; open(false); } });
  };
  if (given) return connect(given);
  t.set(`<div class="xf-cam"><video playsinline muted></video><div class="xf-aim"><i></i><i></i><i></i><i></i></div><b class="xf-scan"></b></div>
    <p class="xf-big">Scan the code on the other device</p>
    <form class="xf-type"><input maxlength="7" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="or type the code"><button class="btn primary">Connect</button></form>`);
  t.info.querySelector('.xf-type').onsubmit = (e) => { e.preventDefault(); connect(e.target.querySelector('input').value); };
  video = t.info.querySelector('video');
  t.d.addEventListener('close', () => { if (!t.active) stopCam(); });
  try {
    const jsQR = await load('vendor/transfer/jsQR.js', 'jsQR');
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    await video.play();
    const c = document.createElement('canvas');
    const g = c.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (camOff) return;
      if (video.videoWidth) {
        const w = 480, h = Math.round((video.videoHeight / video.videoWidth) * w);
        c.width = w; c.height = h;
        g.drawImage(video, 0, 0, w, h);
        const hit = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        const m = hit?.data?.match(/send-to=([A-Z0-9]{6})/i) || hit?.data?.match(/^([A-Z0-9]{6})$/i);
        if (m) { // got it: the corners snap in round it with a flash, then on to connecting
          navigator.vibrate?.(20);
          t.info.querySelector('.xf-cam')?.classList.add('got');
          setTimeout(() => connect(m[1]), reduce() ? 0 : 420);
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  } catch {
    t.info.querySelector('.xf-cam')?.remove(); // no camera (or no permission): typing the code still works
  }
}
