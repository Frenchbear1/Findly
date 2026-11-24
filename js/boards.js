// Idea boards: collect results — exactly as they looked, cropped or whole — into boards, and boards inside
// boards. Everything stays on this device (its own IndexedDB database, separate from the library).

const DB = 'instant-search-boards';
let dbp;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const run = (stores, mode, fn) => db().then((d) => new Promise((resolve, reject) => {
  const t = d.transaction(stores, mode);
  const out = fn(t);
  t.oncomplete = () => resolve(out?.result ?? out);
  t.onerror = () => reject(t.error);
}));
const put = (store, rows) => run([store], 'readwrite', (t) => rows.forEach((r) => t.objectStore(store).put(r)));
const del = (store, ids) => run([store], 'readwrite', (t) => ids.forEach((id) => t.objectStore(store).delete(id)));

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => Date.now();

export function initBoards(api) {
  const { esc, el, I, toast, recordCustom } = api;
  const LAYOUT = 'instant-search:boards-layout';
  const B = { boards: [], items: [], loaded: null, at: null, q: '', type: 'all', doc: '', sort: 'new', urls: new Map(), layout: (() => { try { return localStorage.getItem(LAYOUT) || 'cards'; } catch { return 'cards'; } })() };
  const LAYOUTS = [
    ['cards', 'Cards', '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5.5" rx="1.5"/><rect x="13.5" y="12" width="7" height="8.5" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/></svg>'],
    ['full', 'Full posts', '<svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="11" rx="1.6"/><path d="M4 18h16M4 21h10"/></svg>'],
    ['list', 'List', '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><rect x="3.5" y="14.5" width="5" height="5" rx="1.2"/><path d="M11.5 6h9M11.5 8.5h6M11.5 16h9M11.5 18.5h6"/></svg>'],
  ];
  let viewer = null; // the open post, if any
  let skipPop = false;

  function load() {
    if (!B.loaded) {
      B.loaded = Promise.all([
        run(['boards'], 'readonly', (t) => t.objectStore('boards').getAll()),
        run(['items'], 'readonly', (t) => t.objectStore('items').getAll()),
      ]).then(([boards, items]) => { B.boards = boards; B.items = items; }).catch(() => { toast('Boards can’t be stored in this browser'); });
    }
    return B.loaded;
  }

  // ---- model ----
  const board = (id) => B.boards.find((b) => b.id === id) || null;
  const kids = (id) => B.boards.filter((b) => (b.parentId || null) === (id || null));
  const within = (id) => { const out = [id]; for (let i = 0; i < out.length; i++) for (const k of kids(out[i])) out.push(k.id); return out; };
  const path = (id) => { const out = []; for (let b = board(id); b; b = board(b.parentId)) out.unshift(b); return out; };
  const pathName = (id) => path(id).map((b) => b.name).join(' › ');
  const itemsIn = (id) => B.items.filter((it) => it.boardId === id);
  const countIn = (id) => { const ids = new Set(within(id)); return B.items.filter((it) => ids.has(it.boardId)).length; };
  const recent = () => [...B.boards].sort((a, b) => (b.used || b.updated || 0) - (a.used || a.updated || 0));
  const imgUrl = (it) => {
    if (!it.image) return '';
    if (!B.urls.has(it.id)) B.urls.set(it.id, URL.createObjectURL(it.image));
    return B.urls.get(it.id);
  };
  const forgetUrl = (id) => { const u = B.urls.get(id); if (u) URL.revokeObjectURL(u); B.urls.delete(id); };

  async function createBoard(name, parentId = null) {
    const b = { id: uid(), parentId, name: name.trim() || 'Untitled board', pinned: false, created: now(), updated: now(), used: now() };
    B.boards.push(b);
    await put('boards', [b]);
    recordCustom(`New board “${b.name}”`, async () => { await removeBoard(b.id, { silent: true }); }, async () => { B.boards.push(b); await put('boards', [b]); render(); });
    render();
    return b;
  }
  async function saveBoard(b) { b.updated = now(); await put('boards', [b]); }
  async function saveItem(it) { it.updated = now(); await put('items', [it]); }

  // Deleting a board takes the boards and items inside it too — and all of it comes back with Undo.
  async function removeBoard(id, { silent = false } = {}) {
    const ids = within(id);
    const boards = B.boards.filter((b) => ids.includes(b.id));
    const items = B.items.filter((it) => ids.includes(it.boardId));
    B.boards = B.boards.filter((b) => !ids.includes(b.id));
    B.items = B.items.filter((it) => !ids.includes(it.boardId));
    await del('boards', ids);
    await del('items', items.map((it) => it.id));
    if (B.at && ids.includes(B.at)) B.at = boards.find((b) => b.id === id)?.parentId || null;
    render();
    if (silent) return;
    const restore = async () => { B.boards.push(...boards); B.items.push(...items); await put('boards', boards); await put('items', items); render(); };
    recordCustom(`Delete board “${boards[0]?.name}”`, restore, () => removeBoard(id, { silent: true }));
    toast(`Deleted “${boards[0]?.name}”${items.length ? ` and ${items.length} saved ${items.length === 1 ? 'result' : 'results'}` : ''}`, { action: 'Undo', onAction: restore });
  }
  async function removeItems(list) {
    const ids = list.map((it) => it.id);
    B.items = B.items.filter((it) => !ids.includes(it.id));
    await del('items', ids);
    ids.forEach(forgetUrl);
    render();
    const restore = async () => { B.items.push(...list); await put('items', list); render(); };
    recordCustom(list.length === 1 ? 'Remove from board' : `Remove ${list.length} results`, restore, () => removeItems(list));
    toast(list.length === 1 ? 'Removed from the board' : `Removed ${list.length}`, { action: 'Undo', onAction: restore });
  }
  async function moveTo(things, destId) {
    const before = things.map((x) => ({ x, from: x.kind === 'board' ? x.b.parentId : x.it.boardId }));
    for (const { x } of before) {
      if (x.kind === 'board') { if (within(x.b.id).includes(destId)) continue; x.b.parentId = destId; await saveBoard(x.b); }
      else { x.it.boardId = destId; await saveItem(x.it); }
    }
    const dest = board(destId);
    if (dest) { dest.used = now(); await saveBoard(dest); }
    render();
    recordCustom('Move', async () => { for (const { x, from } of before) { if (x.kind === 'board') { x.b.parentId = from; await saveBoard(x.b); } else { x.it.boardId = from; await saveItem(x.it); } } render(); }, () => moveTo(things, destId));
    toast(`Moved to ${dest ? `“${dest.name}”` : 'Boards'}`, { ms: 2200 });
  }

  // Save a result to a board. seed() gives { image, w, h, text, title, docId, docName, n, q, mode, cropped }.
  async function addTo(boardId, seed) {
    await load();
    let data;
    try { data = await seed(); } catch (err) { toast(`Couldn’t save it (${err.message})`); return; }
    const it = { id: uid(), boardId, kind: 'page', title: data.title || '', note: '', pinned: false, created: now(), updated: now(), ...data };
    B.items.push(it);
    await put('items', [it]);
    const b = board(boardId);
    if (b) { b.used = now(); await saveBoard(b); }
    recordCustom(`Add to “${b?.name}”`, async () => { B.items = B.items.filter((x) => x.id !== it.id); await del('items', [it.id]); render(); }, async () => { B.items.push(it); await put('items', [it]); render(); });
    toast(`Saved to “${b?.name || 'board'}”`, { action: 'Open', onAction: () => open(boardId) });
    render();
  }

  // ---- small dialogs: a name, or a place (board picker) ----
  function ask(title, value = '', ok = 'Create') {
    return new Promise((resolve) => {
      const d = el('dialog', 'bv-ask');
      d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><input name="n" value="${esc(value)}" placeholder="Board name" maxlength="80" autocomplete="off"><footer><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${esc(ok)}</button></footer></form>`;
      document.body.append(d);
      const input = d.querySelector('input');
      d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? input.value.trim() : null; d.remove(); resolve(v || null); });
      d.showModal();
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }
  // Pick a board (and make new ones along the way). Resolves to a board id, or null for the top level, or undefined if cancelled.
  function pick(title, { action = 'Save here', start = null, exclude = null, allowTop = false } = {}) {
    return load().then(() => new Promise((resolve) => {
      const d = el('dialog', 'bv-pick');
      let at = start && board(start) ? start : null;
      let chosen;
      const draw = () => {
        const crumbs = [{ id: null, name: 'Boards' }, ...path(at)];
        const list = kids(at).filter((b) => !exclude || !within(exclude).includes(b.id)).sort((a, b) => b.pinned - a.pinned || a.name.localeCompare(b.name));
        d.innerHTML = `<div class="bp">
          <header><h3>${esc(title)}</h3><button class="icon-btn sm" data-x aria-label="Close">${I.x}</button></header>
          <nav class="bp-crumbs">${crumbs.map((c, i) => `${i ? '<span>›</span>' : ''}<button data-go="${c.id ?? ''}">${esc(c.name)}</button>`).join('')}</nav>
          <div class="bp-list">${list.map((b) => `<button class="bp-row" data-go="${b.id}">${I.board}<span>${esc(b.name)}</span><em>${countIn(b.id) || ''}</em>${kids(b.id).length ? I.chevron : ''}</button>`).join('') || `<p class="bp-empty">${at ? 'No boards inside this one yet.' : 'No boards yet — make your first one.'}</p>`}</div>
          <button class="bp-new" data-new>${I.plus}New board${at ? ` in “${esc(board(at).name)}”` : ''}</button>
          <footer><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok ${!at && !allowTop ? 'disabled' : ''}>${esc(action)}${at ? ` in “${esc(board(at).name)}”` : ''}</button></footer>
        </div>`;
      };
      d.addEventListener('click', async (e) => {
        if (e.target === d || e.target.closest('[data-x]')) { d.close(); return; }
        const go = e.target.closest('[data-go]');
        if (go) { at = go.dataset.go || null; draw(); return; }
        if (e.target.closest('[data-new]')) {
          const name = await ask(at ? `New board in “${board(at).name}”` : 'New board');
          if (name) { const b = await createBoard(name, at); at = b.id; }
          draw();
          return;
        }
        if (e.target.closest('[data-ok]')) { chosen = at; d.close(); }
      });
      d.addEventListener('close', () => { d.remove(); resolve(chosen); });
      document.body.append(d);
      draw();
      d.showModal();
    }));
  }

  // The page menu's "Add to board" choices: recent boards, a new one, or choose anywhere.
  function menuItems(seed) {
    const items = [];
    for (const b of recent().slice(0, 4)) items.push({ label: b.name, sub: b.parentId ? pathName(b.parentId) : '', icon: I.board, run: () => addTo(b.id, seed) });
    items.push({ label: 'New board…', icon: I.plus, run: async () => { const name = await ask('New board'); if (name) { const b = await createBoard(name); addTo(b.id, seed); } } });
    if (B.boards.length) items.push({ label: 'Choose a board…', icon: I.folder, run: async () => { const id = await pick('Save to a board'); if (id) addTo(id, seed); } });
    return items;
  }

  // ---- the board view ----
  let view = null;
  function ensureView() {
    if (view) return view;
    view = el('div', 'bv');
    view.id = 'boardsView';
    view.hidden = true;
    view.innerHTML = `
      <header class="bv-top">
        <button class="icon-btn" data-back aria-label="Back">${I.arrowLeft}</button>
        <nav class="bv-crumbs" aria-label="Where you are"></nav>
        <button class="icon-btn" data-bmenu aria-label="Board options" hidden>${I.more}</button>
        <button class="icon-btn" data-close aria-label="Close boards">${I.x}</button>
      </header>
      <div class="bv-tools">
        <label class="bv-search">${api.searchIcon}<input type="search" placeholder="Search saved results and notes" autocomplete="off" enterkeyhint="search"><button class="icon-btn sm" data-clear aria-label="Clear" hidden>${I.x}</button></label>
        <div class="bv-filters">
          <div class="seg small bv-type">${[['all', 'All'], ['page', 'Pages'], ['note', 'Notes'], ['pinned', 'Pinned']].map(([k, l]) => `<button data-type="${k}">${l}</button>`).join('')}</div>
          <div class="seg small bv-layout" role="group" aria-label="Layout">${LAYOUTS.map(([k, l, ic]) => `<button data-layout="${k}" title="${l}" aria-label="${l}">${ic}</button>`).join('')}</div>
          <select class="bv-doc" aria-label="Filter by document"></select>
          <select class="bv-sort" aria-label="Sort">
            <option value="new">Newest first</option><option value="old">Oldest first</option><option value="edited">Recently edited</option>
            <option value="az">Title A–Z</option><option value="doc">Document & page</option>
          </select>
        </div>
      </div>
      <main class="bv-body"></main>
      <div class="bv-fab"><button class="btn" data-newnote>${I.pencil}Note</button><button class="btn primary" data-newboard>${I.plus}Board</button></div>`;
    document.body.append(view);
    const input = view.querySelector('.bv-search input');
    input.addEventListener('input', () => { B.q = input.value; view.querySelector('[data-clear]').hidden = !B.q; renderBody(); });
    view.querySelector('[data-clear]').addEventListener('pointerdown', (e) => e.preventDefault());
    view.querySelector('.bv-doc').addEventListener('change', (e) => { B.doc = e.target.value; renderBody(); });
    view.querySelector('.bv-sort').addEventListener('change', (e) => { B.sort = e.target.value; renderBody(); });
    view.addEventListener('click', onClick);
    addEventListener('popstate', () => {
      if (skipPop) { skipPop = false; return; }
      if (viewer) { viewer.close(); return; } // Back closes the post first, then the boards
      if (!view.hidden) close(true);
    });
    return view;
  }

  async function open(id = null) {
    await load();
    ensureView();
    B.at = id && board(id) ? id : null;
    if (view.hidden) {
      view.hidden = false;
      document.body.classList.add('boards-open');
      try { history.pushState({ boards: true }, ''); } catch {}
      view.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }
    render();
  }
  function close(fromPop = false) {
    if (!view || view.hidden) return;
    view.hidden = true;
    document.body.classList.remove('boards-open');
    if (!fromPop && history.state?.boards) history.back();
  }
  const isOpen = () => !!view && !view.hidden;
  const postOpen = () => !!viewer;

  function render() {
    if (!view || view.hidden) return;
    const crumbs = [{ id: null, name: 'Boards' }, ...path(B.at)];
    view.querySelector('.bv-crumbs').innerHTML = crumbs.map((c, i) => `${i ? '<span>›</span>' : ''}<button data-go="${c.id ?? ''}" ${i === crumbs.length - 1 ? 'aria-current="page"' : ''}>${esc(c.name)}</button>`).join('');
    view.querySelector('[data-bmenu]').hidden = !B.at;
    view.querySelector('[data-back]').hidden = !B.at;
    view.querySelectorAll('.bv-type button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === B.type)));
    view.querySelectorAll('.bv-layout button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === B.layout)));
    view.querySelector('.bv-sort').value = B.sort;
    renderBody();
  }

  function scopeItems() {
    // this board and everything inside it (the top level is everything)
    const ids = B.at ? new Set(within(B.at)) : null;
    return B.items.filter((it) => !ids || ids.has(it.boardId));
  }
  function filtered() {
    const words = B.q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = scopeItems();
    // without a search or filter, a board shows only what's directly in it (its boards show as cards);
    // the top level shows boards, plus anything pinned anywhere
    const searching = words.length || B.doc || B.type !== 'all';
    if (!searching) list = B.at ? list.filter((it) => it.boardId === B.at) : list.filter((it) => it.pinned);
    if (B.type === 'page') list = list.filter((it) => it.kind === 'page');
    if (B.type === 'note') list = list.filter((it) => it.kind === 'note' || (it.note || '').trim());
    if (B.type === 'pinned') list = list.filter((it) => it.pinned);
    if (B.doc) list = list.filter((it) => it.docId === B.doc);
    if (words.length) list = list.filter((it) => { const hay = [it.title, it.note, it.docName, it.text, it.q, pathName(it.boardId)].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); });
    const by = {
      new: (a, b) => b.created - a.created,
      old: (a, b) => a.created - b.created,
      edited: (a, b) => b.updated - a.updated,
      az: (a, b) => (a.title || a.docName || '').localeCompare(b.title || b.docName || '', undefined, { numeric: true }),
      doc: (a, b) => (a.docName || '').localeCompare(b.docName || '', undefined, { numeric: true }) || (a.n ?? 0) - (b.n ?? 0),
    }[B.sort];
    return list.sort(by);
  }

  const when = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  function itemCard(it, showWhere) {
    const title = it.title || (it.kind === 'note' ? 'Note' : `${it.docName || 'Page'}`);
    // the document's name shows once: as the title when there's no title of your own, or under it
    const meta = it.kind === 'page' ? `${it.title && it.docName ? `${esc(it.docName)} · ` : ''}Page ${(it.n ?? 0) + 1}` : `Note · ${when(it.updated)}`;
    const body = it.image
      ? `<img src="${imgUrl(it)}" alt="" loading="lazy" width="${it.w || ''}" height="${it.h || ''}">`
      : it.kind === 'note'
      ? `<div class="bv-note">${(B.layout === 'full' ? esc(it.note || '') : esc(it.note || '').slice(0, 600)) || '<span class="muted">Empty note</span>'}</div>`
      : `<div class="bv-text">${esc(B.layout === 'full' ? it.text || '' : (it.text || '').slice(0, 500))}</div>`;
    return `<article class="bv-card${it.pinned ? ' pinned' : ''}" data-item="${it.id}">
      <div class="bv-media">${body}</div>
      <div class="bv-cap"><b>${esc(title)}</b><small>${meta}${showWhere && it.boardId !== B.at ? ` · <i>${esc(pathName(it.boardId))}</i>` : ''}</small>
      ${it.kind === 'page' && it.note ? `<p>${esc(B.layout === 'full' ? it.note : it.note.slice(0, 160))}</p>` : ''}</div>
      ${it.pinned ? `<span class="bv-pin" title="Pinned">${api.pinIcon}</span>` : ''}
      <button class="bv-more" data-imenu="${it.id}" aria-label="Options">${I.more}</button>
    </article>`;
  }
  function boardCard(b) {
    const inside = B.items.filter((it) => new Set(within(b.id)).has(it.boardId));
    const thumbs = inside.filter((it) => it.image).slice(0, 3);
    return `<article class="bv-board${b.pinned ? ' pinned' : ''}" data-board="${b.id}">
      <div class="bv-mosaic n${thumbs.length}">${thumbs.map((it) => `<img src="${imgUrl(it)}" alt="">`).join('') || `<span>${I.board}</span>`}</div>
      <div class="bv-cap"><b>${esc(b.name)}</b><small>${inside.length} saved${kids(b.id).length ? ` · ${kids(b.id).length} ${kids(b.id).length === 1 ? 'board' : 'boards'}` : ''}</small></div>
      ${b.pinned ? `<span class="bv-pin">${api.pinIcon}</span>` : ''}
      <button class="bv-more" data-bm="${b.id}" aria-label="Board options">${I.more}</button>
    </article>`;
  }

  function renderBody() {
    const body = view.querySelector('.bv-body');
    // document filter choices: documents that appear in this scope
    const docs = new Map(scopeItems().filter((it) => it.docId).map((it) => [it.docId, it.docName]));
    const sel = view.querySelector('.bv-doc');
    sel.innerHTML = `<option value="">All documents</option>${[...docs].map(([id, n]) => `<option value="${esc(id)}">${esc(n || 'Document')}</option>`).join('')}`;
    if (B.doc && !docs.has(B.doc)) B.doc = '';
    sel.value = B.doc;
    sel.hidden = docs.size < 2 && !B.doc;
    const searching = !!B.q.trim() || !!B.doc || B.type !== 'all';
    const boards = searching ? [] : kids(B.at).sort((a, b) => b.pinned - a.pinned || (b.used || 0) - (a.used || 0));
    const list = filtered();
    const pinned = searching ? [] : list.filter((it) => it.pinned);
    const rest = searching ? list : list.filter((it) => !it.pinned);
    let html = '';
    if (boards.length) html += `<section><h4>Boards</h4><div class="bv-boards">${boards.map(boardCard).join('')}</div></section>`;
    if (pinned.length) html += `<section><h4>${api.pinIcon}Pinned</h4><div class="bv-grid">${pinned.map((it) => itemCard(it, !B.at)).join('')}</div></section>`;
    if (rest.length) html += `<section>${boards.length || pinned.length ? `<h4>${searching ? `${rest.length} found` : 'Saved'}</h4>` : searching ? `<h4>${rest.length} found</h4>` : ''}<div class="bv-grid">${rest.map((it) => itemCard(it, searching)).join('')}</div></section>`;
    if (!html) {
      html = searching
        ? `<div class="bv-empty">${api.searchIcon}<b>Nothing matches</b><span>Try other words, or clear the filters.</span></div>`
        : `<div class="bv-empty">${I.board}<b>${B.at ? 'This board is empty' : 'Save results to boards'}</b><span>${B.at ? 'Tap a result page and choose <b>Add to board</b>, or add a note or a board inside this one.' : 'Tap any result page and choose <b>Add to board</b>. Saved results keep the crop they had — and boards can hold boards.'}</span></div>`;
    }
    body.innerHTML = html;
    body.className = `bv-body l-${B.layout}`;
  }

  async function onClick(e) {
    const t = e.target;
    if (t.closest('[data-close]')) return close();
    if (t.closest('[data-back]')) { B.at = board(B.at)?.parentId || null; return render(); }
    const go = t.closest('[data-go]');
    if (go) { B.at = go.dataset.go || null; return render(); }
    if (t.closest('[data-clear]')) { const i = view.querySelector('.bv-search input'); i.value = ''; B.q = ''; t.closest('[data-clear]').hidden = true; i.focus(); return renderBody(); }
    const lay = t.closest('[data-layout]');
    if (lay) { B.layout = lay.dataset.layout; try { localStorage.setItem(LAYOUT, B.layout); } catch {} view.querySelector('.bv-body').scrollTop = 0; return render(); }
    const type = t.closest('[data-type]');
    if (type) { B.type = type.dataset.type; return render(); }
    if (t.closest('[data-newboard]')) { const name = await ask(B.at ? `New board in “${board(B.at).name}”` : 'New board'); if (name) await createBoard(name, B.at); return; }
    if (t.closest('[data-newnote]')) {
      if (!B.at) { const id = await pick('Where should the note go?', { action: 'Add note' }); if (id === undefined || id === null) return; B.at = id; render(); }
      const it = { id: uid(), boardId: B.at, kind: 'note', title: '', note: '', pinned: false, created: now(), updated: now() };
      B.items.push(it);
      await put('items', [it]);
      recordCustom('New note', async () => { B.items = B.items.filter((x) => x.id !== it.id); await del('items', [it.id]); render(); }, async () => { B.items.push(it); await put('items', [it]); render(); });
      render();
      return openItem(it, true);
    }
    const bm = t.closest('[data-bm]');
    if (bm) { e.stopPropagation(); return boardMenu(bm, board(bm.dataset.bm)); }
    if (t.closest('[data-bmenu]')) return boardMenu(t.closest('[data-bmenu]'), board(B.at));
    const im = t.closest('[data-imenu]');
    if (im) { e.stopPropagation(); return itemMenu(im, B.items.find((x) => x.id === im.dataset.imenu)); }
    const bc = t.closest('[data-board]');
    if (bc) { B.at = bc.dataset.board; view.querySelector('.bv-body').scrollTop = 0; return render(); }
    const ic = t.closest('[data-item]');
    if (ic) return openItem(B.items.find((x) => x.id === ic.dataset.item));
  }

  function boardMenu(anchor, b) {
    if (!b) return;
    api.menu(anchor, [
      { header: b.name },
      { label: 'Open', icon: I.board, run: () => { B.at = b.id; render(); } },
      { label: b.pinned ? 'Unpin' : 'Pin to the top', icon: api.pinIcon, run: async () => { b.pinned = !b.pinned; await saveBoard(b); render(); } },
      { label: 'Rename…', icon: I.pencil, run: async () => { const name = await ask('Rename board', b.name, 'Rename'); if (name && name !== b.name) { const old = b.name; b.name = name; await saveBoard(b); recordCustom('Rename board', async () => { b.name = old; await saveBoard(b); render(); }, async () => { b.name = name; await saveBoard(b); render(); }); render(); } } },
      { label: 'Move…', icon: I.out, run: async () => { const id = await pick(`Move “${b.name}”`, { action: 'Move here', start: b.parentId, exclude: b.id, allowTop: true }); if (id !== undefined && id !== b.parentId) moveTo([{ kind: 'board', b }], id); } },
      { sep: true },
      { label: 'Delete board', icon: I.trash, danger: true, run: () => removeBoard(b.id) },
    ]);
  }
  function itemMenu(anchor, it) {
    if (!it) return;
    api.menu(anchor, [
      { label: 'Open', icon: I.text, run: () => openItem(it) },
      { label: it.pinned ? 'Unpin' : 'Pin to the top', icon: api.pinIcon, run: async () => { it.pinned = !it.pinned; await saveItem(it); render(); } },
      ...(it.kind === 'page' ? [{ label: 'Go to this page', icon: I.book, run: () => { close(); api.openDoc(it.docId, it.n); } }] : []),
      { label: 'Move…', icon: I.out, run: async () => { const id = await pick('Move to', { action: 'Move here', start: it.boardId }); if (id && id !== it.boardId) moveTo([{ kind: 'item', it }], id); } },
      { sep: true },
      { label: 'Remove', icon: I.trash, danger: true, run: () => removeItems([it]) },
    ]);
  }

  // A post, full screen: the saved page at full width, its title and note, and a row of actions along
  // the bottom that never sits over the content. Title and page are plain text until you tap them.
  function openItem(it, focusNote = false) {
    if (!it) return;
    if (viewer) viewer.close();
    const order = [...view.querySelectorAll('.bv-body [data-item]')].map((n) => n.dataset.item).filter((id, i, a) => a.indexOf(id) === i);
    const d = el('dialog', 'bv-item');
    viewer = d;
    let cur = it, dirty = false, tmr;
    const flush = async () => { if (!dirty) return; dirty = false; await saveItem(cur); render(); };
    const later = () => { dirty = true; clearTimeout(tmr); tmr = setTimeout(flush, 500); };
    const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    const defTitle = (x) => (x.kind === 'note' ? 'Note' : x.docName || 'Saved page');

    const fill = (x, focus) => {
      cur = x;
      const hasDoc = x.kind === 'page' && api.hasDoc(x.docId);
      const at = order.indexOf(x.id);
      const acts = [
        ['pin', api.pinIcon, x.pinned ? 'Pinned' : 'Pin', x.pinned],
        hasDoc && ['open', I.book, 'Open'],
        x.q && hasDoc && ['search', api.searchIcon, 'Search'],
        ['move', I.out, 'Move'],
        (x.text || x.note) && ['copy', I.copy, 'Copy'],
        x.image && ['save', I.save, 'Save'],
        ['del', I.trash, 'Remove'],
      ].filter(Boolean);
      d.innerHTML = `
        <header class="bi-top">
          <button class="icon-btn" data-x aria-label="Back">${I.arrowLeft}</button>
          <div class="bi-head">
            <button class="bi-title-t${x.title ? '' : ' def'}" data-edit="title" title="Tap to rename">${esc(x.title || defTitle(x))}</button>
            ${x.kind === 'page' ? `<div class="bi-sub">${x.title ? `<span>${esc(x.docName || 'Document')}</span> · ` : ''}<button data-edit="page" title="Tap to change the page">Page ${(x.n ?? 0) + 1}</button></div>` : `<div class="bi-sub"><span>Note · ${when(x.updated)}</span></div>`}
          </div>
          ${order.length > 1 && at >= 0 ? `<div class="bi-step"><button class="icon-btn sm" data-step="-1" aria-label="Previous post" ${at <= 0 ? 'disabled' : ''}>${I.arrowLeft}</button><small>${at + 1}/${order.length}</small><button class="icon-btn sm nx" data-step="1" aria-label="Next post" ${at >= order.length - 1 ? 'disabled' : ''}>${I.arrowLeft}</button></div>` : ''}
        </header>
        <div class="bi-scroll">
          ${x.image ? `<div class="bi-img"><img src="${imgUrl(x)}" alt=""></div>` : x.text ? `<div class="bi-text">${esc(x.text)}</div>` : ''}
          <textarea class="bi-note" placeholder="${x.kind === 'note' ? 'Write anything…' : 'Add a note…'}" rows="${x.kind === 'note' ? 8 : 2}">${esc(x.note || '')}</textarea>
          <p class="bi-meta">${x.q ? `Searched “${esc(x.q)}” · ` : ''}in ${esc(pathName(x.boardId) || 'Boards')} · saved ${when(x.created)}</p>
        </div>
        <nav class="bi-bar" style="--n:${acts.length}">${acts.map(([a, ic, l, on]) => `<button data-a="${a}"${a === 'del' ? ' class="danger"' : ''}${on != null ? ` aria-pressed="${!!on}"` : ''}>${ic}<span>${l}</span></button>`).join('')}</nav>`;
      const note = d.querySelector('.bi-note');
      note.addEventListener('input', () => { cur.note = note.value; autosize(note); later(); });
      requestAnimationFrame(() => autosize(note));
      d.querySelector('.bi-scroll').scrollTop = 0;
      if (focus) setTimeout(() => note.focus(), 60);
    };

    // tap the title or the page number to edit it; Enter or tapping away puts it back to plain text
    const edit = (btn) => {
      const what = btn.dataset.edit;
      const inp = document.createElement('input');
      inp.className = `bi-edit ${what}`;
      if (what === 'title') { inp.value = cur.title || ''; inp.placeholder = defTitle(cur); inp.maxLength = 140; }
      else { inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '1'; inp.value = String((cur.n ?? 0) + 1); }
      btn.replaceWith(inp);
      inp.focus();
      inp.select?.();
      let done = false;
      const finish = async (keep) => {
        if (done) return;
        done = true;
        if (keep) {
          if (what === 'title') cur.title = inp.value.trim();
          else { const v = parseInt(inp.value, 10); if (v > 0) cur.n = v - 1; }
          dirty = true;
          await flush();
        }
        fill(cur);
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
      inp.addEventListener('blur', () => finish(true));
    };

    d.addEventListener('cancel', (e) => { if (d.querySelector('.bi-edit')) e.preventDefault(); });
    d.addEventListener('close', () => {
      clearTimeout(tmr);
      flush();
      d.remove();
      if (viewer === d) viewer = null;
      if (history.state?.boardsItem) { skipPop = true; history.back(); }
    });
    d.addEventListener('click', async (e) => {
      if (e.target.closest('[data-x]')) return d.close();
      const ed = e.target.closest('[data-edit]');
      if (ed) return edit(ed);
      const st = e.target.closest('[data-step]');
      if (st) { await flush(); const next = B.items.find((y) => y.id === order[order.indexOf(cur.id) + Number(st.dataset.step)]); if (next) fill(next); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      const x = cur;
      if (a === 'pin') { x.pinned = !x.pinned; await saveItem(x); fill(x); render(); }
      else if (a === 'open') { d.close(); close(); api.openDoc(x.docId, x.n); }
      else if (a === 'search') { d.close(); close(); api.search(x.q, x.mode); }
      else if (a === 'move') { const id = await pick('Move to', { action: 'Move here', start: x.boardId }); if (id && id !== x.boardId) { await moveTo([{ kind: 'item', it: x }], id); fill(x); } }
      else if (a === 'copy') api.copy([x.title, x.text, x.note].filter(Boolean).join('\n\n'));
      else if (a === 'save') api.saveBlob(x.image, `${(x.title || x.docName || 'saved').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}${x.n != null ? ` p${x.n + 1}` : ''}.jpg`);
      else if (a === 'del') { d.close(); removeItems([x]); }
    });
    // swipe sideways across the post for the previous or next one
    let sx = null;
    d.addEventListener('pointerdown', (e) => { sx = e.target.closest('.bi-scroll') && !e.target.closest('textarea, input') ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
    d.addEventListener('pointerup', (e) => {
      if (!sx) return;
      const dx = e.clientX - sx.x, dy = e.clientY - sx.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && performance.now() - sx.t < 600) d.querySelector(`[data-step="${dx < 0 ? 1 : -1}"]:not([disabled])`)?.click();
      sx = null;
    });
    fill(it, focusNote);
    document.body.append(d);
    d.showModal();
    try { history.pushState({ boards: true, boardsItem: true }, ''); } catch {}
    d.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
  }

  load();
  // after an import: read the boards again and redraw if they're showing
  async function reload() {
    B.loaded = null;
    await load();
    if (isOpen()) render();
  }
  return { open, close, isOpen, postOpen, menuItems, pick, addTo, load, reload };
}
