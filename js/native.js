// The iPhone app (Capacitor): documents live as real files in "On My iPhone › Instant Search" instead of the browser's
// storage, scanned pages are read with Live Text, and the library shows up in Spotlight and Shortcuts.
// In a normal browser none of this exists and isNative is false.
export const NATIVE_BUILD = '__IS_BUILD__';
const cap = globalThis.Capacitor;
const tauri = globalThis.__TAURI__;
/** 'ios' (the iPhone/iPad app), 'windows' (the desktop app) or 'web' (a browser). */
export const platform = cap?.isNativePlatform?.() ? 'ios' : tauri?.core ? 'windows' : 'web';
export const isNative = platform !== 'web';
const plugin = (name) => (platform === 'ios' && typeof cap.registerPlugin === 'function' ? cap.registerPlugin(name) : null);

// The Windows app: the same calls as the iPhone's plugin, answered by the app itself (src-tauri/src/lib.rs).
const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
const onFocus = (cb) => {
  let last = 0;
  const go = () => { if (Date.now() - last > 1500) { last = Date.now(); cb(); } };
  addEventListener('focus', go);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
};
const desktopFiles = platform === 'windows' ? {
  info: () => invoke('info'),
  list: () => invoke('list'),
  write: ({ path, data, append }) => invoke('write', { path, data, append }),
  freeName: ({ name, folder }) => invoke('free_name', { name, folder: folder || null }),
  remove: ({ path }) => invoke('remove', { path }),
  rename: ({ from, name }) => invoke('rename', { from, name }),
  read: ({ path, offset, length }) => invoke('read', { path, offset, length }),
  stat: ({ path }) => invoke('stat', { path }),
  takeIncoming: async () => ({ files: [] }),
  keepAwake: async () => {},
  cloud: async () => ({ available: false, on: false }),
  setCloud: async () => { throw new Error('iCloud sync is for Apple devices'); },
  pickFolder: () => invoke('pick_folder'),
  reveal: () => invoke('reveal'),
  // files changed in the folder (Explorer, another app): picked up whenever you come back to the window
  addListener: (ev, cb) => { if (ev === 'changed') onFocus(cb); },
} : null;
const quiet = { index: async () => ({}), takePending: async () => ({}), addListener: () => {} };

export const Files = platform === 'windows' ? desktopFiles : plugin('ISFiles');
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
  if (!r.ok) throw new Error(`“${path}” is missing from the Instant Search folder`);
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
export async function saveBytes(name, data, folder = '') {
  const { path } = await Files.freeName({ name, folder });
  await writeBytes(path, data);
  return path;
}
/** Writes bytes to a path, a few MB at a time. */
export async function writeBytes(path, data) {
  const u8 = data instanceof Uint8Array ? data : typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
  const step = 3 * 1024 * 1024;
  if (!u8.length) return Files.write({ path, data: '', append: false });
  for (let i = 0; i < u8.length; i += step) await Files.write({ path, data: b64(u8.subarray(i, i + step)), append: i > 0 });
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
