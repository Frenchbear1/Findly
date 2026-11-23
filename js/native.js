// The iPhone app (Capacitor): documents live as real files in "On My iPhone › Instant Search" instead of the browser's
// storage, scanned pages are read with Live Text, and the library shows up in Spotlight and Shortcuts.
// In a normal browser none of this exists and isNative is false.
export const NATIVE_BUILD = '__IS_BUILD__';
const cap = globalThis.Capacitor;
export const isNative = !!cap?.isNativePlatform?.();
const plugin = (name) => (isNative && typeof cap.registerPlugin === 'function' ? cap.registerPlugin(name) : null);
export const Files = plugin('ISFiles');
export const Text = plugin('ISText');
export const Link = plugin('ISLink');

let rootP = null;
const root = () => (rootP ||= Files.info().then((r) => r.root.replace(/\/?$/, '/')));
const enc = (path) => path.split('/').map(encodeURIComponent).join('/');
export async function fileUrl(path) { return cap.convertFileSrc((await root()) + enc(path)); }

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
