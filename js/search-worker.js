// Searching off the main thread, so typing never waits for it.
// Holds a copy of every document's page texts; answers queries in library order; drops a query the moment a newer
// one arrives (it checks between documents and every few milliseconds), so only the latest keystroke's search
// ever finishes.
import { compile, inWhere } from './search.js';

const texts = new Map(); // docId -> page texts
const marks = new Map(); // docId -> per page headings and captions (see inWhere)
let latest = 0;

const pause = () => new Promise((r) => setTimeout(r, 0)); // lets newer messages in

self.onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'set') { texts.set(m.id, m.pages); return; }
  if (m.t === 'marks') { if (m.marks) marks.set(m.id, m.marks); else marks.delete(m.id); return; }
  if (m.t === 'del') { texts.delete(m.id); marks.delete(m.id); return; }
  if (m.t === 'clear') { texts.clear(); marks.clear(); return; }
  if (m.t !== 'q') return;
  latest = m.qid;
  const qid = m.qid;
  const matcher = compile(m.query, m.opts);
  if (!matcher || matcher.error) { self.postMessage({ t: 'r', qid, docs: [] }); return; }
  const out = [];
  const transfer = [];
  let since = performance.now();
  for (const id of m.ids) {
    const pages = texts.get(id);
    if (!pages) continue;
    const where = m.opts.where && m.opts.where !== 'any' ? m.opts.where : null;
    const dm = where ? marks.get(id) : null;
    const ns = [];
    const counts = [];
    const data = [];
    for (let n = 0; n < pages.length; n++) {
      let r = matcher.match(pages[n]);
      if (r && where) r = inWhere(r, dm?.[n] || null, where);
      if (r) {
        ns.push(n);
        counts.push(r.length);
        for (const x of r) data.push(x[0], x[1], x[2]);
      }
      if (performance.now() - since > 8) {
        await pause();
        if (latest !== qid) return; // a newer search took over
        since = performance.now();
      }
    }
    if (ns.length) {
      const d = { id, ns: Int32Array.from(ns), counts: Int32Array.from(counts), data: Int32Array.from(data) };
      transfer.push(d.ns.buffer, d.counts.buffer, d.data.buffer);
      out.push(d);
    }
  }
  if (latest !== qid) return;
  self.postMessage({ t: 'r', qid, docs: out }, transfer);
};
