// Send your whole library straight to another device: no file in between.
// The receiving device shows a QR code (and a short code); the sending device scans it (or types the code).
// The two connect directly over the local network (WebRTC); a public introduction service (PeerJS) only passes the
// connection details between them, never your documents. Works between the iPhone app, browsers on computers and Android.
import qrcode from '../vendor/transfer/qrcode.mjs';
import { backupStream, readBackup, inventory } from './backup.js';
import { isNative, writeBytes, removeFile, diskFile } from './native.js';

const WEB_URL = 'https://frenchbear1.github.io/Instant-Search/';
const CHUNK = 64 * 1024;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// (tests can point this at their own connection service)
const PEER_OPTS = () => ({ debug: 0, ...(globalThis.__peerOpts || {}) });
const peerId = (code) => `findly-xfer-${code.toLowerCase()}`;
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join('');
const fmt = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
const device = () => (isNative ? 'iPhone' : /Android/i.test(navigator.userAgent) ? 'Android device' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : /Mac/i.test(navigator.platform) ? 'Mac' : 'computer');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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

// a sheet that stays up during the transfer
function sheet(title) {
  const d = document.createElement('dialog');
  d.className = 'xfer';
  d.innerHTML = `<div class="xf-head"><h3>${esc(title)}</h3><button class="icon-btn sm" data-x aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div><div class="xf-body"></div>`;
  document.body.append(d);
  d.showModal();
  const body = d.querySelector('.xf-body');
  const api = {
    d, body,
    set(html) { body.innerHTML = html; },
    progress(label, done, total) {
      const p = total ? Math.min(1, done / total) : 0;
      body.innerHTML = `<p class="xf-big">${esc(label)}</p><div class="xf-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div><p class="xf-sub">${fmt(done)} of ${fmt(total)} · ${Math.round(p * 100)}%</p>`;
    },
    onclose: null,
    close() { if (d.open) d.close(); },
  };
  d.addEventListener('close', () => { api.onclose?.(); d.remove(); });
  d.querySelector('[data-x]').onclick = () => api.close();
  return api;
}

const choose = (s, html) => new Promise((ok) => {
  s.set(`${html}<div class="xf-opts">
      <button class="xf-opt on" data-v="merge"><b>Add what’s new</b><span>Only documents this device doesn’t have yet, or that changed. Nothing here is removed and there are no duplicates.</span></button>
      <button class="xf-opt" data-v="replace"><b>Replace everything</b><span>Make this device an exact copy of the other one, settings included.</span></button>
    </div><div class="xf-btns"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Receive</button></div>`);
  let v = 'merge';
  s.body.querySelectorAll('.xf-opt').forEach((b) => (b.onclick = () => { v = b.dataset.v; s.body.querySelectorAll('.xf-opt').forEach((x) => x.classList.toggle('on', x === b)); }));
  s.body.querySelector('[data-yes]').onclick = () => ok(v);
  s.body.querySelector('[data-no]').onclick = () => ok(null);
});

/** This device receives: show the code, wait for the other device, then take everything in. */
export async function receive({ toast, reload }) {
  const s = sheet('Receive from another device');
  let peer, conn, done = false, sink;
  s.onclose = () => { if (!done) { try { conn?.send(JSON.stringify({ t: 'cancel' })); } catch {} } peer?.destroy(); sink?.drop?.(); };
  s.set('<p class="xf-sub">Getting ready…</p>');
  let Peer;
  try { Peer = await loadPeer(); } catch (e) { s.set(`<p class="xf-err">${esc(e.message)}</p>`); return; }
  const code = newCode();
  peer = new Peer(peerId(code), PEER_OPTS());
  peer.on('error', (e) => { if (!done) s.set(`<p class="xf-err">Couldn’t connect (${esc(e.type || e.message)}). Check both devices are online and try again.</p>`); });
  peer.on('open', () => {
    const qr = qrcode(0, 'M');
    qr.addData(`${WEB_URL}#send-to=${code}`);
    qr.make();
    s.set(`<div class="xf-qr">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
      <p class="xf-big">On the other device: Backup › <b>Send to another device</b>, then scan this</p>
      <p class="xf-sub">or type the code</p><p class="xf-code">${code.slice(0, 3)} ${code.slice(3)}</p>
      <p class="xf-note">Keep this open. Both devices on the same Wi-Fi is fastest.</p>`);
  });
  peer.on('connection', (c) => {
    if (conn) { c.close(); return; }
    conn = c;
    let expect = 0, got = 0, mode = 'merge', label = 'Receiving…';
    c.on('data', async (m) => {
      if (typeof m === 'string') {
        const msg = JSON.parse(m);
        if (msg.t === 'hello') {
          // the usual: just what's new or changed, added to what's here; or start over with exactly what the other device has
          const pick = await choose(s, `<p class="xf-big">A ${esc(msg.from)} wants to send its library (${msg.docs} document${msg.docs === 1 ? '' : 's'}).</p>`);
          if (!pick) { c.send(JSON.stringify({ t: 'no' })); s.close(); return; }
          mode = pick;
          s.set('<p class="xf-sub">Comparing libraries…</p>');
          c.send(JSON.stringify({ t: 'go', mode, have: mode === 'merge' ? await inventory() : null }));
        } else if (msg.t === 'size') {
          expect = msg.size;
          sink = await makeSink();
          s.progress(msg.sending ? `Receiving ${msg.sending} new or changed document${msg.sending === 1 ? '' : 's'}…` : 'Nothing new to add: updating boards and folders…', 0, expect);
          label = msg.sending ? `Receiving ${msg.sending} new or changed document${msg.sending === 1 ? '' : 's'}…` : 'Updating…';
          c.send(JSON.stringify({ t: 'ready' }));
        } else if (msg.t === 'done') {
          await sink.flush();
          s.set('<p class="xf-big">Putting everything in place…</p><div class="xf-bar"><i style="width:0%"></i></div>');
          try {
            const b = await readBackup(await sink.file());
            await b.restore((n, of) => { const bar = s.body.querySelector('.xf-bar i'); if (bar) bar.style.width = `${(n / of) * 100}%`; }, { merge: mode === 'merge' });
            done = true;
            c.send(JSON.stringify({ t: 'ok' }));
            sink.drop();
            s.set('<p class="xf-big">All here.</p><p class="xf-sub">Restarting with your library…</p>');
            setTimeout(reload, 900);
          } catch (e) {
            c.send(JSON.stringify({ t: 'fail', why: e?.message || String(e) }));
            s.set(`<p class="xf-err">Couldn’t finish: ${esc(e?.message || e)}</p>`);
          }
        } else if (msg.t === 'cancel') {
          s.set('<p class="xf-err">The other device stopped sending.</p>');
        }
        return;
      }
      await sink.add(m);
      got += m.byteLength;
      if (got === expect || got % (CHUNK * 64) < CHUNK) s.progress(label, got, expect);
    });
    c.on('close', () => { if (!done && expect) s.set('<p class="xf-err">The connection dropped. Try again with both devices awake and nearby.</p>'); });
  });
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
      chain = chain.then(() => import('./native.js').then((m) => m.Files.write({ path, data: toB64(all), append: true })));
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
  const s = sheet('Send to another device');
  let stream = null, peer, video, stop = false;
  const stopCam = () => { stop = true; video?.srcObject?.getTracks().forEach((t) => t.stop()); };
  s.onclose = () => { stopCam(); peer?.destroy(); };
  const connect = async (code) => {
    stopCam();
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) return;
    s.set('<p class="xf-sub">Connecting…</p>');
    let Peer;
    try { Peer = await loadPeer(); } catch (e) { s.set(`<p class="xf-err">${esc(e.message)}</p>`); return; }
    try { stream = await backupStream(); } catch (e) { s.set(`<p class="xf-err">Couldn’t read your library: ${esc(e?.message || e)}</p>`); return; }
    peer = new Peer(PEER_OPTS());
    peer.on('error', (e) => s.set(`<p class="xf-err">${e.type === 'peer-unavailable' ? 'That code isn’t showing on any device. Check it and that the other device is still on the Receive screen.' : `Couldn’t connect (${esc(e.type || e.message)}).`}</p>`));
    peer.on('open', () => {
      const c = peer.connect(peerId(code), { serialization: 'raw', reliable: true });
      c.on('open', () => {
        s.set('<p class="xf-big">Connected</p><p class="xf-sub">Waiting for the other device to accept…</p>');
        c.send(JSON.stringify({ t: 'hello', from: device(), docs: stream.summary.docs }));
      });
      c.on('data', async (m) => {
        if (typeof m !== 'string') return;
        const msg = JSON.parse(m);
        if (msg.t === 'no') s.set('<p class="xf-sub">The other device said no.</p>');
        else if (msg.t === 'go') {
          s.set('<p class="xf-sub">Working out what to send…</p>');
          try { stream = await backupStream({ have: msg.mode === 'merge' ? msg.have || [] : null }); } catch (e) { s.set(`<p class="xf-err">Couldn’t read your library: ${esc(e?.message || e)}</p>`); return; }
          c.send(JSON.stringify({ t: 'size', size: stream.size, sending: stream.summary.sending }));
        } else if (msg.t === 'ready') pump(c, s, stream).catch((e) => s.set(`<p class="xf-err">Sending stopped: ${esc(e?.message || e)}</p>`));
        else if (msg.t === 'ok') s.set('<p class="xf-big">Sent.</p><p class="xf-sub">Your library is on the other device now.</p>');
        else if (msg.t === 'fail') s.set(`<p class="xf-err">The other device couldn’t finish: ${esc(msg.why)}</p>`);
        else if (msg.t === 'cancel') s.set('<p class="xf-err">The other device cancelled.</p>');
      });
    });
  };
  if (given) return connect(given);
  s.set(`<div class="xf-cam"><video playsinline muted></video><div class="xf-aim"></div></div>
    <p class="xf-big">Scan the code on the other device</p>
    <form class="xf-type"><input maxlength="7" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="or type the code"><button class="btn primary">Connect</button></form>`);
  s.body.querySelector('.xf-type').onsubmit = (e) => { e.preventDefault(); connect(e.target.querySelector('input').value); };
  video = s.body.querySelector('video');
  try {
    const jsQR = await load('vendor/transfer/jsQR.js', 'jsQR');
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    await video.play();
    const c = document.createElement('canvas');
    const g = c.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (stop) return;
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
    s.body.querySelector('.xf-cam')?.remove(); // no camera (or no permission): typing the code still works
  }
}

// push the backup across, a piece at a time, never running ahead of the connection
async function pump(c, s, stream) {
  const dc = c.dataChannel;
  dc.bufferedAmountLowThreshold = 1 << 20;
  const drain = () => new Promise((ok) => { if (dc.bufferedAmount < 4 << 20) return ok(); dc.addEventListener('bufferedamountlow', ok, { once: true }); });
  let sent = 0;
  const push = async (u8) => {
    for (let i = 0; i < u8.length; i += CHUNK) {
      await drain();
      const piece = u8.slice(i, i + CHUNK);
      dc.send(piece.buffer);
      sent += piece.length;
      if (sent === stream.size || sent % (CHUNK * 64) < CHUNK) s.progress('Sending…', sent, stream.size);
    }
  };
  s.progress('Sending…', 0, stream.size);
  await push(stream.head);
  for (const p of stream.parts) await push(new Uint8Array(await (await p.read()).arrayBuffer()));
  await drain();
  c.send(JSON.stringify({ t: 'done' }));
  s.set('<p class="xf-big">Sent everything</p><p class="xf-sub">The other device is putting it in place…</p>');
}
