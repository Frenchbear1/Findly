// Copies the static web app into www/ so Capacitor can bundle it into the iOS app.
// GitHub Pages keeps serving the repo root as the web app; www/ is a generated copy and is gitignored.
import { cpSync, rmSync, readdirSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const skip = new Set(['.git', '.github', '.gitignore', '.nojekyll', 'node_modules', 'www', 'ios', 'scripts', 'tests',
  'package.json', 'package-lock.json', 'capacitor.config.json', 'vercel.json', 'src-tauri']);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const name of readdirSync(root)) {
  if (skip.has(name) || name.endsWith('.md')) continue;
  cpSync(join(root, name), join(out, name), { recursive: true });
}
// the iPhone app bundles its own files: no service worker there (it would only get in the way of app updates);
// the website (Vercel) keeps it for offline use
if (process.env.IS_APP === '1' || process.argv.includes('--app')) writeFileSync(join(out, 'sw.js'), 'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.registration.unregister()));\n');
const nat = join(out, 'js', 'native.js');
writeFileSync(nat, readFileSync(nat, 'utf8').replace('__IS_BUILD__', process.env.IS_BUILD || 'local'));
// Universal Links: tells iPhones that links to a search on this site belong to the app (team ID from the
// APPLE_TEAM_ID environment variable on Vercel, or the one written into TEAM below)
const TEAM = process.env.APPLE_TEAM_ID || 'N24CJAPYYP';
const aasa = join(out, '.well-known', 'apple-app-site-association');
writeFileSync(aasa, readFileSync(aasa, 'utf8').replace('__APPLE_TEAM_ID__', TEAM));
console.log('Built www/');
