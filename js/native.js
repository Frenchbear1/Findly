// The iPhone app (Capacitor): documents live as real files in "On My iPhone › Instant Search" instead of the browser's
// storage, scanned pages are read with Live Text, and the library shows up in Spotlight and Shortcuts.
// In a normal browser none of this exists and isNative is false.
export const NATIVE_BUILD = '__IS_BUILD__';
const cap = globalThis.Capacitor;
const tauri = globalThis.__TAURI__;
/** 'ios' (the iPhone/iPad app), 'windows' (the desktop app) or 'web' (a browser). */
const shell = cap?.isNativePlatform?.() ? 'ios' : tauri?.core ? 'windows' : 'web';
// The app's own plugins: the native bridge lists them in Capacitor.Plugins (registerPlugin only exists when
// @capacitor/core is bundled, which this app doesn't do: same as Calfie)
const plugin = (name) => {
  if (shell !== 'ios') return null;
  if (cap.Plugins?.[name]) return cap.Plugins[name];
  try { return typeof cap.registerPlugin === 'function' ? cap.registerPlugin(name) : null; } catch { return null; }
};

// The Windows app: the same calls as the iPhone's plugin, answered by the app itself (src-tauri/src/lib.rs).
const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
const onFocus = (cb) => {
  let last = 0;
  const go = () => { if (Date.now() - last > 1500) { last = Date.now(); cb(); } };
  addEventListener('focus', go);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
};
const desktopFiles = shell === 'windows' ? {
  info: () => invoke('info'),
  list: () => invoke('list'),
  write: ({ path, data, append }) => invoke('write', { path, data, append }),
  freeName: ({ name, folder }) => invoke('free_name', { name, folder: folder || null }),
  remove: ({ path }) => invoke('remove', { path }),
  rename: ({ from, name }) => invoke('rename', { from, name }),
  moveTo: ({ from, folder }) => invoke('move_to', { from, folder }),
  read: ({ path, offset, length }) => invoke('read', { path, offset, length }),
  stat: ({ path }) => invoke('stat', { path }),
  takeIncoming: async () => ({ files: [] }),
  keepAwake: async () => {},
  // a library folder inside iCloud Drive (iCloud for Windows) syncs with your Apple devices: folders and order too
  cloud: async () => { const r = await invoke('info'); const on = /icloud ?drive|iCloud~/i.test(r.root); return { available: on, on, windows: true }; },
  setCloud: async () => { throw new Error('iCloud sync is for Apple devices'); },
  pickFolder: () => invoke('pick_folder'),
  reveal: () => invoke('reveal'),
  // files changed in the folder (Explorer, another app): picked up whenever you come back to the window
  addListener: (ev, cb) => { if (ev === 'changed') onFocus(cb); },
} : null;
const quiet = { index: async () => ({}), takePending: async () => ({}), addListener: () => {} };

export const Files = shell === 'windows' ? desktopFiles : plugin('ISFiles');
// if the app's file storage can't be reached, behave like the website (browser storage) rather than fail
export const platform = shell === 'ios' && !Files ? 'web' : shell;
export const isNative = platform !== 'web';
export const Text = plugin('ISText');
export const Link = plugin('ISLink') || quiet;
/** Live Text (reading scanned pages) is on the iPhone. */
export const hasLiveText = !!Text;

let rootP = null;
const root = () => (rootP ||= Files.info().then((r) => (platform === 'windows' ? r.root.replace(/[\\/]?$/, '\\') : r.root.replace(/\/?$/, '/'))));
const enc = (path) => path.split('/').map(encodeURIComponent).join('/');
export async function fileUrl(path) {
  if (platform === 'windows') return tauri.core.convertFileSrc((await root()) + path.replace(/\//g, '\\'));
  return cap.convertFileSrc((await root()) + enc(path));
}
/** Windows: pick the library folder (the app then reads documents straight from it). */
export async function pickLibraryFolder() { const p = await Files.pickFolder(); if (p) rootP = null; return p; }
export async function libraryFolder() { return (await Files.info()).root; }
export const revealLibrary = () => Files.reveal?.();

/** The bytes of a file in the library folder. */
export async function readBytes(path) {
  const r = await fetch(await fileUrl(path));
  if (!r.ok) throw new Error(`“${path}” is missing from the Findly folder`);
  return r.arrayBuffer();
}
/** The file in the library folder as a File (for reading it like a picked file). */
export async function readFileObj(path) {
  const name = path.split('/').pop();
  return new File([await readBytes(path)], name);
}

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
/** Saves bytes as a new file in the library folder (a free name is picked); returns its path. */
export async function saveBytes(name, data, folder = '', onPart) {
  const { path } = await Files.freeName({ name, folder });
  await writeBytes(path, data, onPart);
  return path;
}
/** Writes bytes to a path, a few MB at a time. */
export async function writeBytes(path, data, onPart) {
  const u8 = data instanceof Uint8Array ? data : typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
  const step = 3 * 1024 * 1024;
  if (!u8.length) return Files.write({ path, data: '', append: false });
  for (let i = 0; i < u8.length; i += step) {
    await Files.write({ path, data: b64(u8.subarray(i, i + step)), append: i > 0 });
    onPart?.(Math.min(1, (i + step) / u8.length));
  }
}
export const removeFile = (path) => Files.remove({ path }).catch(() => {});
export const listFiles = async () => (await Files.list()).files || [];

/** Live Text: the text in a picture (a canvas of a scanned page). */
export async function recognize(canvas) {
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return Text.recognize({ image: url.slice(url.indexOf(',') + 1) });
}

/** A file in the library folder that reads only the pieces asked for (so a backup of any size can be imported). */
export async function diskFile(path) {
  const f = (await listFiles()).find((x) => x.path === path) || (await Files.stat({ path }));
  const piece = (a, b) => ({
    size: Math.max(0, b - a),
    async arrayBuffer() {
      const out = new Uint8Array(Math.max(0, b - a));
      for (let at = 0; at < out.length; at += 4 * 1024 * 1024) {
        const { data } = await Files.read({ path, offset: a + at, length: Math.min(4 * 1024 * 1024, out.length - at) });
        const bin = atob(data);
        for (let i = 0; i < bin.length; i++) out[at + i] = bin.charCodeAt(i);
      }
      return out.buffer;
    },
    async text() { return new TextDecoder().decode(await this.arrayBuffer()); },
    slice(x, y) { return piece(a + x, a + Math.min(y, b - a)); },
  });
  return { name: path.split('/').pop(), size: f.size, slice: (a, b = f.size) => piece(a, Math.min(b, f.size)) };
}

/** iCloud sync (iCloud Drive › Findly): { available, on } */
export const cloudStatus = () => (Files.cloud ? Files.cloud().catch(() => ({ available: false, on: false })) : Promise.resolve({ available: false, on: false }));
export const setCloud = async (on) => { const r = await Files.setCloud({ on }); rootP = null; return r; }; // the library moved: ask where it is now
export const listAll = async () => Files.list();

// ---------- pages drawn by Apple's PDF engine (the iPhone) ----------
const PdfDraw = plugin('ISPdf');
/** The iPhone draws PDF pages itself (lighter on memory than drawing them in the page). */
export const nativePdf = !!PdfDraw && platform === 'ios';
/** A decoded <img> of page n (0-based) of the library file at path: the whole page `width` pixels wide, or the
 *  part r = [x0, x1, y0, y1] of it (fractions of the page). */
export async function drawPage(path, n, width, r = [0, 1, 0, 1], quality = 0.82) {
  const file = (await root()) + enc(path);
  const res = await PdfDraw.render({ file, page: n, width, x0: r[0], x1: r[1], y0: r[2], y1: r[3], quality });
  const img = new Image();
  img.decoding = 'async';
  img.width = res.width;
  img.height = res.height;
  img._path = res.path;
  img.src = cap.convertFileSrc(res.path);
  try { await img.decode(); } catch { PdfDraw.forget({ paths: [res.path] }).catch(() => {}); throw new Error('page image'); }
  return img;
}
/** Live Text for page n (0-based) of a library PDF, read by the app itself (the page never comes into the web page). */
export async function ocrPage(path, n) {
  if (!PdfDraw?.ocr) throw new Error('no ocr');
  const file = (await root()) + enc(path);
  return (await PdfDraw.ocr({ file, page: n })).text || '';
}
/** The app's own file picker: files (or a whole folder) are copied into the library folder one at a time and
 *  announced as they land ('imported' events), instead of being read into the page. */
export const pickNative = platform === 'ios' && Files?.pick ? (opts) => Files.pick(opts) : null;
/** Page images no longer shown (their files are deleted). */
export const forgetPages = (paths) => { if (paths.length) PdfDraw?.forget({ paths }).catch(() => {}); };

/** A library PDF for pdf.js read in pieces, as it needs them (its pages, its index), instead of the whole file
 *  being loaded into the page first: a long manual can be tens of megabytes, and results jump between several. */
export async function pdfRange(path) {
  const url = await fileUrl(path);
  const get = async (a, b) => {
    for (let k = 0; ; k++) {
      try {
        const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
        if (r.status === 206) return r;
        throw new Error(`status ${r.status}`);
      } catch (e) { if (k >= 2) throw e; await new Promise((res) => setTimeout(res, 150)); }
    }
  };
  const head = await get(0, 65535);
  const total = Number((head.headers.get('Content-Range') || '').split('/')[1]);
  if (!(total > 0)) throw new Error('no size');
  const t = new globalThis.pdfjsLib.PDFDataRangeTransport(total, new Uint8Array(await head.arrayBuffer()));
  t.requestDataRange = (begin, end) => {
    get(begin, end - 1).then((r) => r.arrayBuffer()).then((b) => t.onDataRange(begin, new Uint8Array(b))).catch(() => {});
  };
  return t;
}

// ---------- the library's text in a database (the iPhone) ----------
const IndexP = plugin('ISIndex');
/** The iPhone keeps page text in its own database with a text index, not in memory (see ISIndexPlugin). */
export const nativeIndex = !!IndexP && platform === 'ios';
export const Index = IndexP;
/** The binary answer of a search (a file the iPhone wrote), as an ArrayBuffer. */
export async function readResultFile(path) {
  const r = await fetch(cap.convertFileSrc(path));
  return r.arrayBuffer();
}
