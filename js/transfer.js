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
const device = () => (platform === 'ios' ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : platform === 'windows' ? 'Windows PC' : /Android/i.test(navigator.userAgent) ? 'Android device' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : /Mac/i.test(navigator.platform) ? 'Mac' : 'computer');
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
let current = null; // one transfer at a time
function panel(kind) {
  const title = kind === 'send' ? 'Send to another device' : 'Receive from another device';
  const d = document.createElement('dialog');
  d.className = 'xfer';
  d.innerHTML = `<div class="xf-head"><h3>${esc(title)}</h3><button class="icon-btn sm" data-x aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div><div class="xf-body"></div><div class="xf-foot" hidden><button class="btn" data-cancel>Cancel transfer</button><button class="btn primary" data-hide>Keep using the app</button></div>`;
  const pill = document.createElement('button');
  pill.className = 'xf-pill';
  pill.hidden = true;
  pill.innerHTML = '<svg class="xf-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="v" cx="18" cy="18" r="15" pathLength="100"/></svg><span></span>';
  document.body.append(d, pill);
  d.showModal();
  const body = d.querySelector('.xf-body');
  const t = {
    kind, d, body, pill, active: false, finished: false,
    onCancel: null, onDone: null,
    set(html) { body.innerHTML = html; },
    // running: the sheet's progress, the pill's ring and words stay in step
    status(label, done, total, { paused = false } = {}) {
      t.active = true;
      d.querySelector('.xf-foot').hidden = false;
      const p = total ? Math.min(1, done / total) : 0;
      const pct = Math.floor(p * 100);
      const bar = body.querySelector('.xf-run');
      if (!bar) body.innerHTML = '<div class="xf-run"><p class="xf-big"></p><div class="xf-bar"><i></i></div><p class="xf-sub"></p></div>';
      body.querySelector('.xf-big').textContent = label;
      body.querySelector('.xf-bar i').style.width = `${(p * 100).toFixed(1)}%`;
      body.querySelector('.xf-bar').classList.toggle('paused', paused);
      body.querySelector('.xf-sub').textContent = total ? `${fmt(done)} of ${fmt(total)} · ${pct}%` : '';
      pill.classList.toggle('paused', paused);
      pill.querySelector('.v').style.strokeDasharray = `${(p * 100).toFixed(1)} 100`;
      pill.querySelector('span').textContent = paused ? `Paused · ${pct}%` : `${kind === 'send' ? 'Sending' : 'Receiving'} ${pct}%`;
    },
    hide() { if (d.open) d.close(); pill.hidden = false; },
    show() { pill.hidden = true; if (!d.open) d.showModal(); },
    finish(html, { pillText = null, onTap = null } = {}) {
      t.active = false;
      t.finished = true;
      keepAwake(false);
      d.querySelector('.xf-foot').hidden = true;
      body.innerHTML = html;
      if (pillText && !d.open) { pill.classList.remove('paused'); pill.classList.add('done'); pill.querySelector('span').textContent = pillText; pill.onclick = onTap || (() => t.show()); }
      else pill.hidden = true;
    },
    destroy() { t.active = false; keepAwake(false); if (d.open) d.close(); d.remove(); pill.remove(); if (current === t) current = null; },
  };
  d.querySelector('[data-x]').onclick = () => (t.active ? t.hide() : t.destroy());
  d.querySelector('[data-hide]').onclick = () => t.hide();
  d.querySelector('[data-cancel]').onclick = () => { t.onCancel?.(); t.destroy(); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); t.active ? t.hide() : t.destroy(); });
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
  t.set(`${html}<div class="xf-opts">
      <button class="xf-opt on" data-v="merge"><b>Add what’s new</b><span>Only documents this device doesn’t have yet, or that changed. Nothing here is removed and there are no duplicates.</span></button>
      <button class="xf-opt" data-v="replace"><b>Replace everything</b><span>Make this device an exact copy of the other one, settings included.</span></button>
    </div><div class="xf-btns"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Receive</button></div>`);
  let v = 'merge';
  t.body.querySelectorAll('.xf-opt').forEach((b) => (b.onclick = () => { v = b.dataset.v; t.body.querySelectorAll('.xf-opt').forEach((x) => x.classList.toggle('on', x === b)); }));
  t.body.querySelector('[data-yes]').onclick = () => ok(v);
  t.body.querySelector('[data-no]').onclick = () => ok(null);
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
  t.set('<p class="xf-sub">Getting ready…</p>');
  let Peer;
  try { Peer = await loadPeer(); } catch (e) { t.set(`<p class="xf-err">${esc(e.message)}</p>`); return; }
  const code = newCode();
  peer = new Peer(peerId(code), PEER_OPTS());
  unwatch = watchPeer(peer, t);
  const paused = (why) => { if (t.active && !t.finished) t.status(why, got, expect, { paused: true }); };
  peer.on('error', (e) => {
    if (t.finished) return;
    if (t.active) paused('Paused: reconnecting…');
    else if (e.type !== 'network' && e.type !== 'disconnected') t.set(`<p class="xf-err">Couldn’t connect (${esc(e.type || e.message)}). Check both devices are online and try again.</p>`);
  });
  peer.on('open', () => {
    if (t.active || t.finished) return; // a reconnect: the code on screen is still the same
    const qr = qrcode(0, 'M');
    qr.addData(`${WEB_URL}#send-to=${code}`);
    qr.make();
    t.set(`<div class="xf-qr">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
      <p class="xf-big">On the other device: Backup › <b>Send to another device</b>, then scan this</p>
      <p class="xf-sub">or type the code</p><p class="xf-code">${code.slice(0, 3)} ${code.slice(3)}</p>
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
          // the usual: just what's new or changed, added to what's here; or start over with exactly what the other device has
          const pick = await choose(t, `<p class="xf-big">A ${esc(msg.from)} wants to send its library (${msg.docs} document${msg.docs === 1 ? '' : 's'}).</p>`);
          if (!pick) { c.send(JSON.stringify({ t: 'no' })); t.destroy(); stop(); return; }
          mode = pick;
          t.set('<p class="xf-sub">Comparing libraries…</p>');
          c.send(JSON.stringify({ t: 'go', mode, have: mode === 'merge' ? await inventory() : null }));
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
          label = msg.sending ? `Receiving ${msg.sending} new or changed document${msg.sending === 1 ? '' : 's'}` : 'Bringing boards and folders up to date';
          keepAwake(true);
          t.status(label, 0, expect);
          c.send(JSON.stringify({ t: 'ready' }));
        } else if (msg.t === 'done') {
          await writing;
          await sink.flush();
          if (got < expect) { c.send(JSON.stringify({ t: 'from', offset: got })); return; } // something went missing: ask again
          t.status('Putting everything in place…', 0, 1);
          try {
            const b = await readBackup(await sink.file());
            await b.restore((n, of) => t.status('Putting everything in place…', n, of), { merge: mode === 'merge' });
            c.send(JSON.stringify({ t: 'ok' }));
            sink.drop();
            unwatch();
            t.finish('<p class="xf-big">All here.</p><p class="xf-sub">Load it now, or keep going and load it later.</p><div class="xf-btns"><button class="btn primary" data-load>Load my library</button></div>',
              { pillText: 'Received · tap to load', onTap: reload });
            t.body.querySelector('[data-load]').onclick = reload;
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
        t.set('<p class="xf-big">Connected</p><p class="xf-sub">Waiting for the other device to accept…</p>');
        c.send(JSON.stringify({ t: 'hello', sid, from: device(), docs: stream.summary.docs }));
      }
    });
    c.on('data', async (m) => {
      if (typeof m !== 'string' || c !== conn) return;
      const msg = JSON.parse(m);
      if (msg.t === 'no') t.finish('<p class="xf-sub">The other device said no.</p>');
      else if (msg.t === 'go') {
        t.set('<p class="xf-sub">Working out what to send…</p>');
        try { stream = await backupStream({ have: msg.mode === 'merge' ? msg.have || [] : null }); } catch (e) { t.set(`<p class="xf-err">Couldn’t read your library: ${esc(e?.message || e)}</p>`); return; }
        c.send(JSON.stringify({ t: 'size', size: stream.size, sending: stream.summary.sending }));
      } else if (msg.t === 'ready') { keepAwake(true); pump(c, 0); }
      else if (msg.t === 'from') pump(c, msg.offset); // carry on from what the other device already has
      else if (msg.t === 'ok') { unwatch(); t.finish('<p class="xf-big">Sent.</p><p class="xf-sub">Your library is on the other device now.</p>', { pillText: 'Sent ✓' }); setTimeout(() => peer.destroy(), 1500); }
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
    t.status('Sending…', sent, stream.size);
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
          if (sent === stream.size || sent % (CHUNK * 32) < CHUNK) t.status('Sending…', sent, stream.size);
        }
        pos += seg.size;
      }
      await drain();
      if (my !== token) return;
      c.send(JSON.stringify({ t: 'done' }));
      t.status('Sent everything: the other device is putting it in place…', stream.size, stream.size);
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
    t.set('<p class="xf-sub">Connecting…</p>');
    let Peer;
    try { Peer = await loadPeer(); } catch (e) { t.set(`<p class="xf-err">${esc(e.message)}</p>`); return; }
    try { stream = await backupStream(); } catch (e) { t.set(`<p class="xf-err">Couldn’t read your library: ${esc(e?.message || e)}</p>`); return; }
    peer = new Peer(PEER_OPTS());
    unwatch = watchPeer(peer, t);
    peer.on('error', (e) => {
      if (t.active) { pausedNow('Paused: reconnecting…'); reconnect(); return; }
      if (!t.finished) t.set(`<p class="xf-err">${e.type === 'peer-unavailable' ? 'That code isn’t showing on any device. Check it and that the other device is still on the Receive screen.' : `Couldn’t connect (${esc(e.type || e.message)}).`}</p>`);
    });
    let first = true;
    peer.on('open', () => { if (first) { first = false; open(false); } });
  };
  if (given) return connect(given);
  t.set(`<div class="xf-cam"><video playsinline muted></video><div class="xf-aim"></div></div>
    <p class="xf-big">Scan the code on the other device</p>
    <form class="xf-type"><input maxlength="7" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="or type the code"><button class="btn primary">Connect</button></form>`);
  t.body.querySelector('.xf-type').onsubmit = (e) => { e.preventDefault(); connect(e.target.querySelector('input').value); };
  video = t.body.querySelector('video');
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
        if (m) { navigator.vibrate?.(20); connect(m[1]); return; }
      }
      requestAnimationFrame(tick);
    };
    tick();
  } catch {
    t.body.querySelector('.xf-cam')?.remove(); // no camera (or no permission): typing the code still works
  }
}
