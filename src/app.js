// The Reading Room — the window's behaviour. Talks to the Rust side through Tauri commands.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const { openUrl } = window.__TAURI__.opener;

  const $ = id => document.getElementById(id);
  const S = { feeds: [], items: [], view: 'all', unreadOnly: true, openId: null, selId: null, q: '', shown: 60, refreshing: false, lastRefresh: null };
  const ICONS = {
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    saved: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>',
    unread: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>'
  };
  const HUES = [162, 210, 28, 280, 340, 95, 190, 50];
  const hueFor = id => HUES[(Number(id) * 7) % HUES.length];
  const feedById = id => S.feeds.find(f => String(f.id) === String(id));
  const item = id => S.items.find(i => i.id === id);
  const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
  const isWeb = u => /^https?:\/\//i.test(u || '');
  const msg = e => (typeof e === 'string' ? e : e?.message) || 'Something went wrong. Try again.';

  function ago(iso) {
    const t = new Date(iso).getTime(); if (!t) return '';
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const h = Math.round(m / 60); if (h < 24) return h + 'h';
    const d = Math.round(h / 24); if (d < 30) return d + 'd';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dayLabel(iso) {
    const d = new Date(iso), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if ((today - d) / 864e5 < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  function visible() {
    let list = S.items;
    if (S.view === 'saved') list = list.filter(i => i.saved);
    else if (S.view !== 'all') list = list.filter(i => String(i.feed_id) === String(S.view));
    if (S.unreadOnly && S.view !== 'saved') list = list.filter(i => !i.read || i.id === S.openId);
    if (S.q) { const q = S.q.toLowerCase(); list = list.filter(i => (i.title + ' ' + i.summary).toLowerCase().includes(q)); }
    return list;
  }
  const unreadCount = fid => S.items.filter(i => (fid == null || String(i.feed_id) === String(fid)) && !i.read).length;

  // ------------------------------------------------------------ render
  function renderRail() {
    const views = [{ id: 'all', name: 'All stories', count: unreadCount(null) }, { id: 'saved', name: 'Saved for later', count: S.items.filter(i => i.saved).length }];
    $('views').innerHTML = views.map(v => `<button data-view="${v.id}" aria-current="${S.view === v.id}"><span class="name">${esc(v.name)}</span><span class="count">${v.count || ''}</span></button>`).join('');
    $('feeds').innerHTML = S.feeds.map(f => `<button data-view="${f.id}" aria-current="${String(S.view) === String(f.id)}" title="${esc(f.status === 'error' ? f.error : f.url)}">
        <span class="fav" style="background:hsl(${hueFor(f.id)} 45% 42%)">${esc((f.title || '?').trim()[0] || '?')}</span>
        <span class="name">${esc(f.title)}</span>${f.status === 'error' ? '<span class="err" aria-label="Problem with this feed"></span>' : `<span class="count">${unreadCount(f.id) || ''}</span>`}</button>`).join('')
      || '<span class="note" style="padding:0 10px">No feeds yet. Add one below.</span>';
  }

  function renderHead() {
    const f = feedById(S.view);
    $('viewTitle').textContent = S.view === 'all' ? 'All stories' : S.view === 'saved' ? 'Saved for later' : (f ? f.title : 'Feed');
    const n = S.view === 'saved' ? S.items.filter(i => i.saved).length : unreadCount(S.view === 'all' ? null : S.view);
    const a = S.lastRefresh ? ago(S.lastRefresh) : '';
    const when = S.refreshing ? 'Checking feeds…' : S.lastRefresh ? (a === 'now' ? 'Checked just now' : `Checked ${a} ago`) : 'Not checked yet';
    $('viewSub').textContent = `${n} ${S.view === 'saved' ? 'saved' : 'unread'} · ${when}`;
    $('fAll').setAttribute('aria-pressed', String(!S.unreadOnly));
    $('fUnread').setAttribute('aria-pressed', String(S.unreadOnly));
    $('seg').hidden = S.view === 'saved';
    $('markAll').hidden = S.view === 'saved';
    $('refresh').disabled = S.refreshing;
    $('refresh').textContent = S.refreshing ? 'Refreshing…' : 'Refresh';

    const bar = $('feedBar');
    if (f) {
      bar.hidden = false;
      bar.innerHTML = `${isWeb(f.site) ? `<a class="btn" href="${esc(f.site)}">Visit site</a>` : ''}
        <button class="btn" id="renameFeed">Rename</button><button class="btn danger" id="removeFeed">Unfollow</button>`;
      if (f.status === 'error') showBanner(`This feed couldn't be read last time: ${esc(f.error)}`, true);
      else if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else {
      bar.hidden = true;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    }
  }

  function renderList() {
    const all = visible(), list = all.slice(0, S.shown);
    if (!list.length) {
      const [t, d] = S.q ? ['No matches', 'Try a different word, or clear the search.']
        : S.view === 'saved' ? ['Nothing saved yet', 'Press the bookmark on any story to keep it here.']
        : S.items.length && S.unreadOnly ? ['You’re all caught up', 'Switch to “All” to see stories you’ve already read.']
        : ['No stories yet', S.refreshing ? 'Checking your feeds now. Stories appear as they arrive.' : 'Press Refresh to pull the latest posts.'];
      $('list').innerHTML = `<div class="empty"><strong>${t}</strong><span>${d}</span></div>`;
      return;
    }
    let out = '', lastDay = '';
    for (const it of list) {
      const day = dayLabel(it.date);
      if (day !== lastDay) { if (lastDay) out += '</div>'; out += `<div class="daygroup"><h3>${esc(day)}</h3>`; lastDay = day; }
      const f = feedById(it.feed_id), open = S.openId === it.id;
      out += `<article class="story${it.read ? ' read' : ''}${open ? ' open' : ''}${S.selId === it.id ? ' sel' : ''}" data-id="${esc(it.id)}">
        <div class="meta"><span class="src">${esc(f ? f.title : '')}</span><time datetime="${esc(it.date)}">${ago(it.date)}</time></div>
        <button class="title" data-act="toggle" aria-expanded="${open}">${esc(it.title)}</button>
        <div class="acts">
          <button class="icon${it.saved ? ' on' : ''}" data-act="save" title="${it.saved ? 'Remove from saved' : 'Save for later'}" aria-label="${it.saved ? 'Remove from saved' : 'Save for later'}">${it.saved ? ICONS.saved : ICONS.save}</button>
          <button class="icon" data-act="read" title="${it.read ? 'Mark unread' : 'Mark read'}" aria-label="${it.read ? 'Mark unread' : 'Mark read'}">${it.read ? ICONS.read : ICONS.unread}</button>
        </div>
        ${it.summary ? `<div class="summary">${esc(it.summary)}</div>` : ''}
        ${open && isWeb(it.link) ? `<div class="open-row"><a href="${esc(it.link)}">Read the full post on ${esc(f ? f.title : 'the site')} →</a></div>` : ''}
      </article>`;
    }
    out += '</div>';
    if (all.length > list.length) out += `<button class="btn more" id="more">Show ${Math.min(60, all.length - list.length)} more</button>`;
    $('list').innerHTML = out;
  }
  function render() { renderRail(); renderHead(); renderList(); }

  function status(text, err) { const el = $('status'); el.textContent = text || ''; el.classList.toggle('err', !!err); }
  function showBanner(html, err, kind = 'feed-error') { const b = $('banner'); b.hidden = false; b.className = 'banner' + (err ? ' err' : ''); b.dataset.kind = kind; b.innerHTML = html; }
  function hideBanner() { const b = $('banner'); b.hidden = true; b.dataset.kind = ''; }

  // ------------------------------------------------------------ data
  async function load() {
    try {
      const s = await invoke('get_state');
      S.feeds = s.feeds; S.items = s.items; S.refreshing = s.refreshing; S.lastRefresh = s.lastRefresh;
      if (S.view !== 'all' && S.view !== 'saved' && !feedById(S.view)) S.view = 'all';
      render();
    } catch (e) { status(msg(e), true); }
  }

  async function mark(ids, patch) {
    ids = [].concat(ids);
    for (const it of S.items) if (ids.includes(it.id)) Object.assign(it, patch);
    render();
    try { await invoke('mark', { ids, ...patch }); } catch (e) { status(msg(e), true); load(); }
  }

  async function refresh() {
    if (S.refreshing) return;
    S.refreshing = true; renderHead(); status('');
    try { await invoke('refresh'); } catch (e) { S.refreshing = false; renderHead(); status(msg(e), true); }
  }

  // ------------------------------------------------------------ actions
  // Every web link opens in your normal browser, never inside the app.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); if (isWeb(a.href)) openUrl(a.href).catch(() => status('Couldn’t open your browser.', true)); return; }

    const v = e.target.closest('[data-view]');
    if (v) {
      S.view = /^\d+$/.test(v.dataset.view) ? Number(v.dataset.view) : v.dataset.view;
      S.openId = S.selId = null; S.shown = 60; hideBanner(); render(); $('main').scrollTo({ top: 0 });
      return;
    }
    if (e.target.id === 'more') { S.shown += 60; renderList(); return; }
    if (e.target.id === 'removeFeed') return confirmRemove();
    if (e.target.id === 'renameFeed') return startRename();

    const act = e.target.closest('[data-act]'); if (!act) return;
    const id = act.closest('.story').dataset.id, it = item(id); S.selId = id;
    if (act.dataset.act === 'toggle') { S.openId = S.openId === id ? null : id; if (S.openId && !it.read) mark(id, { read: true }); else render(); }
    if (act.dataset.act === 'save') mark(id, { saved: !it.saved });
    if (act.dataset.act === 'read') mark(id, { read: !it.read });
  });

  $('fAll').onclick = () => { S.unreadOnly = false; S.shown = 60; render(); };
  $('fUnread').onclick = () => { S.unreadOnly = true; S.shown = 60; render(); };
  let qt; $('q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); S.shown = 60; renderList(); }, 150); });
  $('refresh').onclick = refresh;

  $('markAll').onclick = () => {
    const ids = visible().filter(i => !i.read).map(i => i.id);
    if (!ids.length) { status('Nothing unread here.'); return; }
    showBanner(`<span>Mark ${ids.length} ${ids.length === 1 ? 'story' : 'stories'} as read?</span><button class="btn primary" id="yesAll">Mark read</button><button class="btn" id="noAll">Cancel</button>`, false, 'confirm');
    $('noAll').onclick = hideBanner;
    $('yesAll').onclick = () => { hideBanner(); mark(ids, { read: true }); status(`Marked ${ids.length} as read.`); };
  };

  function confirmRemove() {
    const f = feedById(S.view); if (!f) return;
    showBanner(`<span>Unfollow ${esc(f.title)}? Its stories leave your reader too, including saved ones.</span><button class="btn danger" id="yesRemove">Unfollow</button><button class="btn" id="noRemove">Cancel</button>`, false, 'confirm');
    $('noRemove').onclick = hideBanner;
    $('yesRemove').onclick = async () => {
      hideBanner();
      try { await invoke('remove_feed', { id: f.id }); S.view = 'all'; status(`Unfollowed ${f.title}.`); load(); }
      catch (e) { status(msg(e), true); }
    };
  }
  function startRename() {
    const f = feedById(S.view); if (!f) return;
    showBanner(`<input class="search" id="newName" value="${esc(f.title)}" aria-label="New name" style="flex:1;min-width:160px"><button class="btn primary" id="saveName">Rename</button><button class="btn" id="noName">Cancel</button>`, false, 'confirm');
    const input = $('newName'); input.focus(); input.select();
    $('noName').onclick = hideBanner;
    const go = async () => {
      const title = input.value.trim(); if (!title) return;
      hideBanner();
      try { await invoke('rename_feed', { id: f.id, title }); load(); } catch (e) { status(msg(e), true); }
    };
    $('saveName').onclick = go;
    input.onkeydown = ev => { if (ev.key === 'Enter') go(); if (ev.key === 'Escape') hideBanner(); };
  }

  // add a feed
  function openAdd() { $('addForm').hidden = false; $('showAdd').hidden = true; $('feedUrl').focus(); }
  $('showAdd').onclick = openAdd;
  $('cancelAdd').onclick = () => { $('addForm').hidden = true; $('showAdd').hidden = false; };
  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const note = $('addNote'), btn = $('addBtn');
    btn.disabled = true; btn.textContent = 'Finding feed…'; note.className = 'note'; note.textContent = 'Checking that address…';
    try {
      const r = await invoke('add_feed', { url: $('feedUrl').value.trim(), title: $('feedName').value.trim() || null });
      $('feedUrl').value = ''; $('feedName').value = '';
      note.textContent = `Now following ${r.title}.`;
      await load(); S.view = r.id; render();
    } catch (err) { note.className = 'note err'; note.textContent = msg(err); }
    finally { btn.disabled = false; btn.textContent = 'Add feed'; }
  });

  // OPML
  async function importOpml() {
    try {
      const n = await invoke('import_opml');
      if (n) status(`Added ${n} ${n === 1 ? 'feed' : 'feeds'}. Pulling their stories now.`);
      load();
    } catch (e) { status(msg(e), true); }
  }
  async function exportOpml() {
    try { if (await invoke('export_opml')) status('Saved your subscription list.'); }
    catch (e) { status(msg(e), true); }
  }
  $('importBtn').onclick = importOpml;
  $('exportBtn').onclick = exportOpml;

  // keyboard (⌘R and ⌘N come from the app menu)
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const list = visible().slice(0, S.shown); if (!list.length) return;
    let i = list.findIndex(x => x.id === S.selId);
    if (e.key === 'j' || e.key === 'k') {
      i = e.key === 'j' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      const it = list[i]; S.selId = S.openId = it.id;
      if (!it.read) mark(it.id, { read: true }); else render();
      document.querySelector(`.story[data-id="${CSS.escape(it.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (S.selId && e.key === 's') { const it = item(S.selId); if (it) mark(it.id, { saved: !it.saved }); }
    else if (S.selId && e.key === 'm') { const it = item(S.selId); if (it) mark(it.id, { read: !it.read }); }
    else if (S.selId && e.key === 'o') { const it = item(S.selId); if (it && isWeb(it.link)) openUrl(it.link); }
  });

  // events from the app: refresh finished, menu items
  listen('state-changed', load);
  listen('menu-refresh', refresh);
  listen('menu-add-feed', openAdd);
  listen('menu-import', importOpml);
  listen('menu-export', exportOpml);
  setInterval(renderHead, 60 * 1000); // keep "Checked 5m ago" current
  load();
})();
