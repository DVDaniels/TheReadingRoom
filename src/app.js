// The Reading Room — the window's behaviour. Talks to the Rust side through Tauri commands.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  const $ = id => document.getElementById(id);
  // view: 'today' | 'all' | 'saved' | 'annotated' | 'recent' | 'folder:<id>' | <feed id number>
  const S = { prefs: {}, kinds: new Map(), folders: [], feeds: [], items: [], highlights: [], mutes: [], also: new Map(), hiddenMuted: 0, readerId: null, view: 'today', unreadOnly: true, keep: new Set(), selId: null, q: '', shown: 60, refreshing: false, lastRefresh: null };
  // Discover's results (see the Discover section)
  const D = { report: null, running: false, done: 0, total: 0, open: new Set(), busy: new Set() };
  const ICONS = {
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    saved: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>',
    unread: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>',
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    later: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    recent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></svg>',
    discover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
  };
  const HUES = [162, 210, 28, 280, 340, 95, 190, 50];
  // Colour from the feed's address, so a feed looks the same on every Mac.
  const hueFor = key => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; };
  const feedById = id => S.feeds.find(f => String(f.id) === String(id));
  const folderById = id => S.folders.find(f => String(f.id) === String(id));
  const item = id => S.items.find(i => i.id === id);
  const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
  const isWeb = u => /^https?:\/\//i.test(u || '');
  const msg = e => (typeof e === 'string' ? e : e?.message) || 'Something went wrong. Try again.';
  const fmtCount = n => n > 999 ? '1K+' : (n || '');
  const folderOf = v => typeof v === 'string' && v.startsWith('folder:') ? folderById(v.slice(7)) : null;
  const DAY = 864e5;

  // ------------------------------------------------------------ iPhone and iPad
  // On iOS the page gets html.ios. On a phone-sized screen it shows one of three screens at a time:
  // feeds (the sidebar), list (the stories) or reader (an article).
  let IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const phoneSize = window.matchMedia('(max-width: 760px)');
  const isPhone = () => IOS && phoneSize.matches;
  function setScreen(name) { document.body.dataset.screen = name; }
  function applyPlatform() {
    document.documentElement.classList.toggle('ios', IOS);
    if (!document.body.dataset.screen) setScreen('list');
  }
  applyPlatform();
  invoke('app_info').then(info => { IOS = info.platform === 'ios'; applyPlatform(); render(); }).catch(() => {});

  // Which folders are collapsed is remembered between launches.
  const collapsed = new Set((() => { try { return JSON.parse(localStorage.getItem('collapsed') || '[]'); } catch { return []; } })());
  const saveCollapsed = () => { try { localStorage.setItem('collapsed', JSON.stringify([...collapsed])); } catch {} };

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
    if ((today - d) / DAY < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  // ------------------------------------------------------------ which stories show
  const isToday = i => Date.now() - new Date(i.date).getTime() < DAY;
  function inScope(i, view = S.view) {
    if (view === 'all') return true;
    if (view === 'today') return isToday(i);
    if (view === 'saved') return i.saved;
    if (view === 'recent') return !!i.read_at;
    if (view === 'annotated') return S.highlights.some(h => h.item_id === i.id);
    if (view === 'discover' || view === 'guide') return false;
    if (view === 'people') return isPerson(i.feed_id);
    const folder = folderOf(view);
    if (folder) { const f = feedById(i.feed_id); return !!f && f.folder_id === folder.id; }
    return String(i.feed_id) === String(view);
  }
  const usesUnreadFilter = () => !['saved', 'recent', 'annotated', 'discover', 'guide'].includes(S.view);
  // ---- muted words: stories mentioning them stay out of sight (not in Read later or Annotated)
  let muteRe = null;
  function buildMutes() {
    const parts = S.mutes.map(w => w.trim()).filter(Boolean).map(w => {
      const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return /^\w/.test(w) && /\w$/.test(w) ? `\\b${e}\\b` : e;
    });
    muteRe = parts.length ? new RegExp(parts.join('|'), 'i') : null;
  }
  const isMuted = i => !i.saved && ((!!muteRe && muteRe.test(i.title + ' ' + (i.summary || ''))) || hiddenSource(i));
  const mutesApply = (view = S.view) => !['saved', 'annotated'].includes(view);

  // ---- people first: each feed is a person (someone's own site) or a publication.
  // Automatic: a person posts a few times a week at most (12 or fewer in 30 days) and isn't named like an outlet.
  // News searches are always publications. You can change any feed, one at a time or all at once in People.
  const isNewsSearch = f => /news\.google\./.test(f?.url || '');
  const OUTLET = /\b(news|times|post|daily|magazine|tribune|gazette|herald|wire|press|media|insider|report|telegraph|today|weekly|tv|radio)\b/i;
  const PER_PERSON = 12;
  function buildKinds() {
    S.kinds = new Map(S.feeds.map(f => [f.id,
      isSocialFeed(f) ? 'person' : isNewsSearch(f) || (f.recent || 0) > PER_PERSON || OUTLET.test(f.title || '') ? 'pub' : 'person']));
  }
  const autoKind = f => S.kinds.get(f.id) || 'person';
  const kindOf = f => (f && (S.prefs.kinds || {})[f.url]) || (f ? autoKind(f) : 'pub');
  const isPerson = feedId => { const f = feedById(feedId); return !!f && kindOf(f) === 'person'; };
  // Stories from a news search name the real website at the end of the title: show that instead
  const viaNews = it => isNewsSearch(feedById(it.feed_id));
  const headline = it => viaNews(it) ? (it.title || '').replace(/\s[-–—|]\s[^-–—|]{2,60}$/, '') : (it.title || '');
  const srcLabel = it => viaNews(it) ? outletOf(it) : (feedById(it.feed_id)?.title || '');
  const viaTag = it => viaNews(it) ? '<span class="via">via Google News</span>' : '';
  function hiddenSource(it) {
    const h = S.prefs.hidden; if (!h?.length || !viaNews(it)) return false;
    const o = outletOf(it).toLowerCase(); return h.some(x => x.toLowerCase() === o);
  }
  async function savePrefs() {
    try { await invoke('set_prefs', { prefs: S.prefs }); } catch (e) { status(msg(e), true); }
  }

  // ---- the same story from several feeds (news searches especially): show it once
  const outletOf = i => { const m = /\s[-–—|]\s([^-–—|]{2,60})$/.exec(i.title || ''); return m ? m[1].trim() : (feedById(i.feed_id)?.title || ''); };
  const storyKey = i => (i.title || '').toLowerCase().replace(/\s[-–—|]\s[^-–—|]{2,60}$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
  function collapseDuplicates(list) {
    S.also = new Map();
    const seen = new Map(), out = [];
    for (const it of list) {
      const k = storyKey(it);
      if (k.length < 16) { out.push(it); continue; }
      const first = seen.get(k);
      if (first && Math.abs(new Date(first.date) - new Date(it.date)) < 3 * DAY) {
        const arr = S.also.get(first.id) || []; arr.push(outletOf(it)); S.also.set(first.id, arr);
        continue;
      }
      seen.set(k, it); out.push(it);
    }
    return out;
  }

  function visible() {
    let list = S.items.filter(i => inScope(i));
    S.hiddenMuted = 0;
    if (mutesApply()) { const before = list.length; list = list.filter(i => !isMuted(i)); S.hiddenMuted = before - list.length; }
    if (S.unreadOnly && usesUnreadFilter()) list = list.filter(i => !i.read || S.keep.has(i.id));
    if (S.q) { const q = S.q.toLowerCase(); list = list.filter(i => (i.title + ' ' + i.summary).toLowerCase().includes(q)); }
    if (S.view === 'recent') list = [...list].sort((a, b) => (b.read_at || '').localeCompare(a.read_at || ''));
    else if (usesUnreadFilter()) list = collapseDuplicates(list);
    else S.also = new Map();
    return list;
  }
  const unreadIn = view => S.items.filter(i => !i.read && inScope(i, view) && !(mutesApply(view) && isMuted(i))).length;

  // ------------------------------------------------------------ render: sidebar
  function navButton(view, label, count, { icon = '', fav = null, err = '', title = '' } = {}) {
    const lead = icon ? `<span class="navicon">${icon}</span>`
      : fav ? `<span class="fav" style="background:hsl(${hueFor(fav.url)} 45% 42%)">${esc((fav.title || '?').trim()[0] || '?')}</span>` : '';
    const tail = err ? '<span class="err" aria-label="Problem with this feed"></span>' : `<span class="count">${fmtCount(count)}</span>`;
    return `<button data-view="${esc(String(view))}" aria-current="${String(S.view) === String(view)}" title="${esc(title)}"${fav ? ` draggable="true" data-feed="${fav.id}"` : ''}>${lead}<span class="name">${esc(label)}</span>${tail}</button>`;
  }
  const feedButton = f => navButton(f.id, f.title, unreadIn(f.id), { fav: f, err: f.status === 'error', title: f.status === 'error' ? f.error : f.url });

  function renderRail() {
    $('views').innerHTML =
      navButton('today', 'Today', unreadIn('today'), { icon: ICONS.today }) +
      navButton('people', 'People', unreadIn('people'), { icon: ICONS.people }) +
      navButton('saved', 'Read later', S.items.filter(i => i.saved).length, { icon: ICONS.later }) +
      navButton('annotated', 'Annotated', new Set(S.highlights.map(h => h.item_id)).size, { icon: ICONS.notes }) +
      navButton('recent', 'Recently read', '', { icon: ICONS.recent }) +
      navButton('discover', 'Discover', D.report?.suggestions.length || '', { icon: ICONS.discover });

    let html = navButton('all', 'All', unreadIn('all'), { icon: ICONS.all });
    for (const folder of S.folders) {
      const open = !collapsed.has(folder.id);
      const inside = S.feeds.filter(f => f.folder_id === folder.id);
      html += `<div class="folder" data-folder="${folder.id}">
          <button class="chev" data-chev="${folder.id}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(folder.name)}">${ICONS.chev}</button>
          ${navButton('folder:' + folder.id, folder.name, unreadIn('folder:' + folder.id))}
        </div>`;
      if (open) html += `<div class="infolder" data-folder="${folder.id}">${inside.map(feedButton).join('') || '<span class="note" style="padding:2px 0 6px 34px;display:block">Drag feeds here</span>'}</div>`;
    }
    const loose = S.feeds.filter(f => !f.folder_id || !folderById(f.folder_id));
    if (loose.length && S.folders.length) html += '<hr>';
    html += loose.map(feedButton).join('');
    if (!S.feeds.length) html += '<span class="note" style="padding:0 10px">No feeds yet. Add one below.</span>';
    $('feeds').innerHTML = html;
  }

  // ------------------------------------------------------------ render: header
  function viewName() {
    const names = { today: 'Today', all: 'All stories', saved: 'Read later', annotated: 'Annotated', recent: 'Recently read', discover: 'Discover', people: 'People', guide: 'How to use The Reading Room' };
    if (names[S.view]) return names[S.view];
    const folder = folderOf(S.view); if (folder) return folder.name;
    return feedById(S.view)?.title || 'Feed';
  }
  function folderOptions(selected) {
    return `<option value="">No folder</option>` + S.folders.map(f => `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
  }

  function renderHead() {
    $('viewTitle').innerHTML = S.view === 'today'
      ? `<span class="sun" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg></span>Today`
      : esc(viewName());
    if ($('clock')) $('clock').hidden = S.view !== 'today';
    const a = S.lastRefresh ? ago(S.lastRefresh) : '';
    const when = S.refreshing ? 'Checking feeds…' : S.lastRefresh ? (a === 'now' ? 'Checked just now' : `Checked ${a} ago`) : 'Not checked yet';
    const lead = S.view === 'saved' ? `${S.items.filter(i => i.saved).length} saved`
      : S.view === 'recent' ? `${S.items.filter(i => i.read_at).length} read recently`
      : S.view === 'annotated' ? `${S.highlights.length} ${S.highlights.length === 1 ? 'highlight' : 'highlights'} in ${new Set(S.highlights.map(h => h.item_id)).size} stories`
      : S.view === 'today' ? `${unreadIn('today')} unread from the last 24 hours`
      : S.view === 'discover' ? discoverSub()
      : S.view === 'people' ? `${unreadIn('people')} unread from people you read`
      : S.view === 'guide' ? 'A five-minute introduction to RSS and this app'
      : `${unreadIn(S.view)} unread`;
    const muted = S.hiddenMuted ? ` · ${S.hiddenMuted} muted` : '';
    $('viewSub').textContent = ['discover', 'guide'].includes(S.view) ? lead : `${lead}${muted} · ${when}`;
    document.body.classList.toggle('discover-view', ['discover', 'guide'].includes(S.view));
    $('fAll').setAttribute('aria-pressed', String(!S.unreadOnly));
    $('fUnread').setAttribute('aria-pressed', String(S.unreadOnly));
    $('seg').hidden = !usesUnreadFilter();
    $('markAll').hidden = !usesUnreadFilter();
    $('refresh').disabled = S.refreshing;
    $('refresh').textContent = S.refreshing ? 'Refreshing…' : 'Refresh';

    const bar = $('feedBar'), f = feedById(S.view), folder = folderOf(S.view);
    bar.classList.add('feedbar');
    if (f) {
      bar.hidden = false;
      bar.innerHTML = `<select id="moveFeed" aria-label="Folder for this feed">${folderOptions(f.folder_id)}</select>
        ${isWeb(f.site) ? `<a class="btn" href="${esc(f.site)}">Visit site</a>` : ''}
        <label class="kindpick">This feed is <select id="kindFeed" aria-label="This feed is">
          <option value=""${(S.prefs.kinds || {})[f.url] ? '' : ' selected'}>${autoKind(f) === 'person' ? 'A person (automatic)' : 'A publication (automatic)'}</option>
          <option value="person"${(S.prefs.kinds || {})[f.url] === 'person' ? ' selected' : ''}>A person</option>
          <option value="pub"${(S.prefs.kinds || {})[f.url] === 'pub' ? ' selected' : ''}>A publication</option></select></label>
        <button class="btn" id="myFeedBtn">${myFeed()?.id === f.id ? 'Not my site' : 'This is my site'}</button>
        <button class="btn" id="renameFeed">Rename</button><button class="btn danger" id="removeFeed">Unfollow</button>`;
      $('moveFeed').onchange = e => moveFeed(f.id, e.target.value ? Number(e.target.value) : null);
      $('kindFeed').onchange = e => {
        S.prefs.kinds = { ...(S.prefs.kinds || {}) };
        if (e.target.value) S.prefs.kinds[f.url] = e.target.value; else delete S.prefs.kinds[f.url];
        savePrefs(); render();
        status(kindOf(f) === 'person' ? `${f.title} counts as a person: it shows in People and leads Today.` : `${f.title} counts as a publication.`);
      };
      if (f.status === 'error') showBanner(`This feed couldn't be read last time: ${esc(f.error)}`, true);
      else if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'annotated' && S.highlights.length) {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" data-export="all">${IOS ? 'Share all highlights' : 'Export all highlights'}</button>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'people') {
      bar.hidden = false;
      const n = S.feeds.filter(f => kindOf(f) === 'person').length;
      bar.innerHTML = `<button class="btn" id="choosePeople">Choose who’s here</button><span class="note">${n} of ${S.feeds.length} feeds count as people</span>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'discover') {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" data-disc="scan"${D.running ? ' disabled' : ''}>${D.running ? 'Looking…' : 'Look again'}</button>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (folder) {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" id="renameFolder">Rename folder</button><button class="btn danger" id="deleteFolder">Delete folder</button>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else {
      bar.hidden = true;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    }
  }

  // ------------------------------------------------------------ render: stories
  function emptyText() {
    if (S.q) return ['No matches', 'Try a different word, or clear the search.'];
    if (S.view === 'saved') return ['Nothing saved yet', 'Press the bookmark on any story to keep it here.'];
    if (S.view === 'recent') return ['Nothing read yet', 'Stories you open show up here, newest first.'];
    if (S.view === 'people' && !S.feeds.some(f => kindOf(f) === 'person')) return ['No people yet', 'Open any feed and set “This feed is” to A person. Discover finds more.'];
    if (S.view === 'annotated') return ['No highlights yet', 'Open a story, select a passage, and choose Highlight or Add note.'];
    if (!S.items.length) return ['No stories yet', S.refreshing ? 'Checking your feeds now. Stories appear as they arrive.' : 'Press Refresh to pull the latest posts.'];
    if (S.view === 'today' && S.unreadOnly) return ['You’re caught up for today', 'Nothing new in the last 24 hours. “All” in the sidebar has older stories.'];
    if (S.unreadOnly) return ['You’re all caught up', 'Switch to “All” to see stories you’ve already read.'];
    return ['Nothing here yet', 'New stories appear after the next refresh.'];
  }

  function alsoLine(it) {
    const names = [...new Set(S.also.get(it.id) || [])].filter(Boolean);
    if (!names.length) return '';
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');
    return `<div class="also">Also from ${esc(shown)}</div>`;
  }

  // ------------------------------------------------------------ Today's briefing
  // A short note at the top of Today: what's new since you were last here, which feeds are busiest,
  // and what's waiting in Read later. Close it and it stays away until tomorrow.
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const lastVisit = Number(store.get('lastVisit')) || 0;
  const leave = () => store.set('lastVisit', String(Date.now()));
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  window.addEventListener('pagehide', leave);
  setTimeout(leave, 5 * 60 * 1000); // after a few minutes this counts as a visit

  let ownerName = '';
  // Your own site: picked with "This is my site" on a feed, otherwise the feed whose address has your name in it
  function myFeed() {
    const pick = S.prefs.mine;
    if (pick === 'none') return null;
    const f = pick && S.feeds.find(x => x.url === pick);
    if (f) return f;
    const n = ownerName.toLowerCase();
    return n.length >= 3 ? S.feeds.find(f => (f.site + ' ' + f.url).toLowerCase().includes(n)) || null : null;
  }
  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return ownerName ? `${part}, ${ownerName}` : part;
  }
  // ------------------------------------------------------------ Today as a homepage (wide windows, no story open)
  // The briefing goes wide, then each folder gets a section of story cards with pictures.
  let briefShown = new Set();
  const isHome = () => isSplit() && S.view === 'today' && !S.readerId && !S.q;
  function syncHome() {
    document.body.classList.toggle('home', isHome() || isPeopleHome());
    document.body.classList.toggle('people-home', isPeopleHome());
    document.body.classList.toggle('today-view', S.view === 'today');
  }
  function cardHtml(it) {
    const f = feedById(it.feed_id);
    return `<article class="h-card${it.read ? ' read' : ''}" data-id="${esc(it.id)}">
      ${isWeb(it.image) ? `<img class="thumb" src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" data-act="open" data-tile="${esc(tileFor(f))}">` : tileHtml(f)}
      <div class="h-body">
        <div class="meta"><span class="src">${esc(srcLabel(it))}</span><time datetime="${esc(it.date)}">${ago(it.date)}</time>
          <button class="icon h-save${it.saved ? ' on' : ''}" data-act="save" title="${it.saved ? 'Remove from Read later' : 'Read later'}" aria-label="${it.saved ? 'Remove from Read later' : 'Read later'}">${it.saved ? ICONS.saved : ICONS.save}</button></div>
        <button class="title" data-act="open">${esc(headline(it))}</button>
        ${it.summary ? `<div class="summary">${esc(it.summary)}</div>` : ''}
      </div>
    </article>`;
  }
  function homeHtml(list) {
    const brief = briefHtml();
    const rest = list.filter(i => !briefShown.has(i.id));
    if (!rest.length && !brief) { const [t, d] = emptyText(); return `<div class="empty"><strong>${t}</strong><span>${d}</span></div>`; }
    const groups = new Map();
    for (const it of rest) {
      const fid = feedById(it.feed_id)?.folder_id;
      const key = fid && folderById(fid) ? fid : 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const order = [...S.folders.map(f => f.id).filter(id => groups.has(id)), ...(groups.has(0) ? [0] : [])];
    const sections = order.map(key => {
      const items = groups.get(key), shown = items.slice(0, 8);
      const folder = key ? folderById(key) : null;
      const view = folder ? `folder:${folder.id}` : 'all';
      const name = folder ? folder.name : 'More stories';
      return `<section class="h-sec" aria-label="${esc(name)}">
        <div class="h-head"><h2><button data-view="${view}">${esc(name)}</button></h2>
          <span class="h-count">${items.length} ${S.unreadOnly ? 'unread' : (items.length === 1 ? 'story' : 'stories')}</span>
          ${items.length > shown.length ? `<button class="linkish h-all" data-view="${view}">See all ${items.length}</button>` : ''}</div>
        <div class="h-grid">${shown.map(cardHtml).join('')}</div>
      </section>`;
    }).join('');
    return brief + sections;
  }

  function briefHtml() {
    if (S.view !== 'today' || S.q) return '';
    if (store.get('briefHidden') === new Date().toDateString()) {
      return `<div class="brief-off"><button class="linkish" id="briefShow" type="button">Show today’s briefing</button></div>`;
    }
    const seenStory = new Set();
    const unread = S.items.filter(i => isToday(i) && !i.read && !isMuted(i)).filter(i => {
      const k = storyKey(i);
      if (k.length < 16) return true;
      if (seenStory.has(k)) return false;
      seenStory.add(k); return true;
    });
    const fresh = lastVisit ? S.items.filter(i => new Date(i.date).getTime() > lastVisit && !isMuted(i)).length : 0;
    // People first: unread posts from people you read in the last few days, one per person (not your own site)
    const mine = myFeed();
    const peopleAll = S.items.filter(i => !i.read && !isMuted(i) && isPerson(i.feed_id) && i.feed_id !== mine?.id && Date.now() - Date.parse(i.date) < 4 * DAY)
      .sort((a, b) => b.date.localeCompare(a.date));
    const onePer = new Set(), people = peopleAll.filter(i => !onePer.has(i.feed_id) && onePer.add(i.feed_id));
    // The lead: a person's post with a picture from the last three days, otherwise the newest story with a picture
    // (news searches only if nothing else has one)
    const withPic = unread.filter(i => isWeb(i.image));
    const own = withPic.filter(i => !viaNews(i));
    const personLead = people.find(i => isWeb(i.image) && Date.now() - Date.parse(i.date) < 3 * DAY);
    const lead = personLead || own[0] || withPic[0] || unread[0];
    const peopleShown = people.filter(i => i !== lead).slice(0, isHome() ? 4 : 3);
    const seen = new Set([lead?.feed_id]);
    const more = [];
    const want = isHome() ? 4 : 3;
    for (const i of [...own, ...withPic, ...unread]) {
      if (more.length >= want) break;
      if (i === lead || more.includes(i) || seen.has(i.feed_id) || peopleShown.includes(i)) continue;
      seen.add(i.feed_id); more.push(i);
    }
    // Wide screens only: six more headlines as text, and a line about your reading
    const perFeed = new Map([[lead?.feed_id, 1]]);
    const inBrief = isHome() ? unread.filter(i => {
      if (i === lead || more.includes(i) || peopleShown.includes(i)) return false;
      const n = perFeed.get(i.feed_id) || 0;
      if (n >= 2) return false;
      perFeed.set(i.feed_id, n + 1); return true;
    }).slice(0, 6) : [];
    briefShown = new Set([lead, ...more, ...inBrief, ...peopleShown].filter(Boolean).map(i => i.id));
    const saved = S.items.filter(i => i.saved);

    const since = (() => {
      if (!lastVisit) return '';
      const h = (Date.now() - lastVisit) / 36e5, d = new Date(lastVisit);
      if (h < 3) return 'since you last looked';
      if (d.toDateString() === new Date().toDateString()) return 'since this morning';
      if (h < 30) return d.getHours() >= 17 ? 'since last night' : 'since yesterday';
      return `since ${d.toLocaleDateString(undefined, { weekday: 'long' })}`;
    })();
    let line;
    if (!unread.length) line = 'Nothing new waiting. You’re caught up for today.';
    else if (fresh && since) line = `${fresh} new ${fresh === 1 ? 'story' : 'stories'} ${since}, ${unread.length} unread today.`;
    else line = `${unread.length} unread ${unread.length === 1 ? 'story' : 'stories'} from the last day.`;
    // Point to the people, not to whoever posted the most
    if (peopleAll.length) line += ` <button class="b-link" data-view="people">${peopleAll.length} new from people you read</button>.`;

    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const src = it => esc(srcLabel(it));
    const leadHtml = lead ? `<button class="b-lead${isWeb(lead.image) ? '' : ' no-pic'}" data-open="${esc(lead.id)}">
        ${isWeb(lead.image) ? `<img src="${esc(lead.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}
        <span class="b-lead-text"><span class="b-src">${src(lead)}</span><span class="b-head">${esc(headline(lead))}</span></span>
      </button>` : '';
    const moreHtml = more.length ? `<div class="b-more">${more.map(i => `<button class="b-item" data-open="${esc(i.id)}">
        ${isWeb(i.image) ? `<img src="${esc(i.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : `<span class="b-tile" style="--h:${hueFor(feedById(i.feed_id)?.url || '')}">${esc((feedById(i.feed_id)?.title || '?')[0])}</span>`}
        <span><span class="b-src">${src(i)}</span><span class="b-title">${esc(headline(i))}</span></span></button>`).join('')}</div>` : '';
    const oldest = saved[saved.length - 1];
    const laterHtml = saved.length ? `<div class="b-later">
        <span class="b-later-k">Waiting in Read later</span>
        <button class="b-link" data-view="saved">${saved.length === 1 ? 'Open' : `All ${saved.length}`}</button>
        <button class="b-link b-oldest" data-open="${esc(oldest.id)}" title="The one that’s waited longest">${esc(oldest.title)}</button>
      </div>` : '';
    // Your own latest post, from the feed marked as your site
    const myPost = mine && S.items.filter(i => i.feed_id === mine.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const mineHtml = myPost && Date.now() - Date.parse(myPost.date) < 45 * DAY ? `<div class="b-mine">
        <span class="b-later-k">Latest on ${esc(mine.title)} · ${esc(ago(myPost.date))}${ago(myPost.date) === 'now' ? '' : ' ago'}</span>
        <button class="b-link b-oldest" data-open="${esc(myPost.id)}">${esc(myPost.title)}</button></div>` : '';
    const inBriefHtml = inBrief.length ? `<div class="b-brief">${inBrief.map(i => `<button class="b-hl" data-open="${esc(i.id)}">
        <span class="b-hl-src">${src(i)} <time>${esc(ago(i.date))}</time></span><span class="b-hl-t">${esc(headline(i))}</span></button>`).join('')}</div>` : '';
    // No counting how much you read: only the passages you kept
    let statsHtml = '';
    if (isHome()) {
      const hlWeek = S.highlights.filter(h => h.created_at && Date.now() - new Date(h.created_at).getTime() < 7 * DAY).length;
      if (hlWeek) statsHtml = `<p class="b-stats"><button class="b-link" data-view="annotated">${hlWeek} ${hlWeek === 1 ? 'passage' : 'passages'}</button> highlighted this week.</p>`;
    }
    const peopleHtml = peopleShown.length ? `<div class="b-people"><h3 class="b-sub">From people you read</h3><div class="b-pgrid">${peopleShown.map(i => {
        const f = feedById(i.feed_id);
        return `<button class="b-person" data-open="${esc(i.id)}">
          <span class="b-pwho"><span class="fav" style="background:hsl(${hueFor(f?.url || '')} 45% 42%)">${esc((f?.title || '?').trim()[0] || '?')}</span>${esc(f?.title || '')}<time>${esc(ago(i.date))}</time></span>
          <span class="b-ptitle">${esc(i.title)}</span>
          ${i.summary ? `<span class="b-psum">${esc(i.summary)}</span>` : ''}</button>`;
      }).join('')}</div></div>` : '';
    return `<section class="brief" aria-label="Today’s briefing">
      <div class="b-top"><h2>${esc(greeting())}</h2><p class="b-date">${esc(date)}</p>
        <button class="brief-x" id="briefClose" type="button" aria-label="Hide the briefing for today" title="Hide for today">×</button></div>
      <p class="b-line">${line}</p>
      ${inBriefHtml}${leadHtml}${peopleHtml}${moreHtml}<div class="b-foot">${statsHtml}${mineHtml}${laterHtml}</div>
    </section>`;
  }

  function renderList() {
    syncHome();
    if (S.view === 'discover') { $('list').innerHTML = discoverHtml(); return; }
    if (S.view === 'guide') { $('list').innerHTML = guideHtml(); store.set('guideSeen', '1'); return; }
    if (isHome()) { $('list').innerHTML = homeHtml(visible()); return; }
    if (isPeopleHome()) { $('list').innerHTML = peopleHomeHtml(visible()); return; }
    const all = visible(), list = all.slice(0, S.shown);
    const brief = briefHtml();
    if (!list.length) {
      const [t, d] = emptyText();
      $('list').innerHTML = brief + `<div class="empty"><strong>${t}</strong><span>${d}</span></div>`;
      return;
    }
    let out = brief, lastDay = '';
    const groupBy = S.view === 'recent' ? i => dayLabel(i.read_at) : i => dayLabel(i.date);
    for (const it of list) {
      const day = groupBy(it);
      if (day !== lastDay) { if (lastDay) out += '</div>'; out += `<div class="daygroup"><h3>${esc(day)}</h3>`; lastDay = day; }
      const f = feedById(it.feed_id);
      const quotes = S.view === 'annotated' ? S.highlights.filter(h => h.item_id === it.id).map(h =>
        `<div class="quote"><q>${esc(h.text)}</q>${h.note ? `<span class="note-text">${esc(h.note)}</span>` : ''}</div>`).join('') : '';
      out += `<article class="story${it.read ? ' read' : ''}${S.selId === it.id ? ' sel' : ''}" data-id="${esc(it.id)}">
        ${isWeb(it.image) ? `<img class="thumb" src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" data-act="open" data-tile="${esc(tileFor(f))}">` : tileHtml(f)}
        <div class="body">
          <div class="meta"><span class="src">${esc(srcLabel(it))}</span>${viaTag(it)}${kindTag(it)}<time datetime="${esc(it.date)}">${ago(it.date)}</time></div>
          ${alsoLine(it)}
          <button class="title" data-act="open">${esc(headline(it))}</button>
          ${it.summary && !quotes ? `<div class="summary">${esc(it.summary)}</div>` : ''}
          ${quotes ? `<div class="quotes">${quotes}</div>` : ''}
        </div>
        <div class="acts">
          ${viaNews(it) ? `<button class="icon" data-act="hidesrc" title="Hide stories from ${esc(outletOf(it))}" aria-label="Hide stories from ${esc(outletOf(it))}">${ICONS.hide}</button>` : ''}
          <button class="icon" data-act="share" title="Share" aria-label="Share" aria-haspopup="menu">${ICONS.share}</button>
          <button class="icon${it.saved ? ' on' : ''}" data-act="save" title="${it.saved ? 'Remove from Read later' : 'Read later'}" aria-label="${it.saved ? 'Remove from Read later' : 'Read later'}">${it.saved ? ICONS.saved : ICONS.save}</button>
          <button class="icon" data-act="read" title="${it.read ? 'Mark unread' : 'Mark read'}" aria-label="${it.read ? 'Mark unread' : 'Mark read'}">${it.read ? ICONS.read : ICONS.unread}</button>
        </div>
      </article>`;
    }
    out += '</div>';
    if (all.length > list.length) out += `<button class="btn more" id="more">Show ${Math.min(60, all.length - list.length)} more</button>`;
    $('list').innerHTML = out;
  }
  function render() { renderRail(); renderHead(); renderList(); renderAddFolders(); if (S.readerId) renderReaderChrome(); }

  // Stories without a picture get a tile in their feed's colour, with its first letter (like the sidebar).
  function tileFor(f) { return f ? `${hueFor(f.url)}|${(f.title || '?').trim()[0] || '?'}` : '210|•'; }
  function tileHtml(f) {
    const [h, letter] = tileFor(f).split('|');
    return `<div class="thumb tile" style="--h:${h}" data-act="open" aria-hidden="true"><span>${esc(letter.toUpperCase())}</span></div>`;
  }
  // A picture that fails to load turns into that tile.
  document.addEventListener('error', e => {
    const img = e.target;
    if (!img.classList?.contains('thumb') || img.tagName !== 'IMG') return;
    if (img.classList.contains('p-img')) { img.closest('.p-card')?.querySelector('.p-sum')?.classList.add('long'); img.remove(); return; }
    const [h, letter] = (img.dataset.tile || '210|•').split('|');
    const t = document.createElement('div');
    t.className = 'thumb tile'; t.style.setProperty('--h', h); t.dataset.act = 'open'; t.setAttribute('aria-hidden', 'true');
    t.innerHTML = `<span>${esc(letter.toUpperCase())}</span>`;
    img.replaceWith(t);
  }, true);

  function status(text, err) { const el = $('status'); el.textContent = text || ''; el.classList.toggle('err', !!err); }
  function showBanner(html, err, kind = 'feed-error') { const b = $('banner'); b.hidden = false; b.className = 'banner' + (err ? ' err' : ''); b.dataset.kind = kind; b.innerHTML = html; }
  function hideBanner() { const b = $('banner'); b.hidden = true; b.dataset.kind = ''; }

  // ------------------------------------------------------------ data
  function welcome() {
    if (store.get('guideSeen') || S.view !== 'today' || $('banner').dataset.kind === 'welcome') return;
    showBanner(`<span><b>New to RSS?</b> A five-minute guide shows how it works and where to find good writers.</span>
      <span class="row"><button class="btn primary" data-view="guide">Read the guide</button><button class="icon" id="welcomeX" aria-label="No thanks" title="No thanks">×</button></span>`, false, 'welcome');
  }
  async function load() {
    try {
      const s = await invoke('get_state');
      S.folders = s.folders; S.feeds = s.feeds; S.items = s.items; S.highlights = s.highlights; S.refreshing = s.refreshing; S.lastRefresh = s.lastRefresh;
      S.mutes = s.mutes || []; S.prefs = s.prefs && typeof s.prefs === 'object' ? s.prefs : {};
      buildKinds(); buildMutes(); renderMutes();
      const oldMine = store.get('myFeed'); // earlier builds kept this on one device only
      if (oldMine && !('mine' in S.prefs)) { const f = feedById(oldMine); S.prefs.mine = oldMine === 'none' ? 'none' : f ? f.url : undefined; if (S.prefs.mine) savePrefs(); store.set('myFeed', ''); }
      const valid = ['today', 'all', 'saved', 'annotated', 'recent', 'discover', 'people', 'guide'].includes(S.view) || folderOf(S.view) || feedById(S.view);
      if (!valid) S.view = 'all';
      render(); welcome();
    } catch (e) { status(msg(e), true); }
  }

  async function mark(ids, patch) {
    ids = [].concat(ids);
    const now = new Date().toISOString();
    for (const it of S.items) if (ids.includes(it.id)) {
      Object.assign(it, patch);
      if (patch.read === true && !it.read_at) it.read_at = now;
      if (patch.read === false) it.read_at = null;
    }
    render();
    try { await invoke('mark', { ids, ...patch }); } catch (e) { status(msg(e), true); load(); }
  }

  async function refresh() {
    if (S.refreshing) return;
    S.refreshing = true; renderHead(); status('');
    try { await invoke('refresh'); } catch (e) { S.refreshing = false; renderHead(); status(msg(e), true); }
  }

  async function moveFeed(feedId, folderId) {
    const f = feedById(feedId); if (!f || f.folder_id === folderId) return;
    f.folder_id = folderId; if (folderId) collapsed.delete(folderId);
    render();
    try {
      await invoke('set_feed_folder', { feedId, folderId });
      status(folderId ? `Moved ${f.title} to ${folderById(folderId)?.name}.` : `Took ${f.title} out of its folder.`);
    } catch (e) { status(msg(e), true); load(); }
  }

  function selectView(v) {
    S.view = /^\d+$/.test(v) ? Number(v) : v;
    S.keep.clear(); S.selId = null; S.shown = 60; hideBanner(); render(); $('main').scrollTo({ top: 0 }); $('listView').scrollTo({ top: 0 });
    if (isPhone()) setScreen('list');
    if (S.view === 'discover') openDiscover();
    if (S.view === 'today') welcome();
  }



  // ------------------------------------------------------------ People as a homepage (wide windows, no story open)
  // Like a street of front porches: a card for each person with their newest post, the busiest-lately first.
  const isPeopleHome = () => isSplit() && S.view === 'people' && !S.readerId && !S.q;
  function personCard(f, posts, total) {
    const [top, ...rest] = posts;
    const pic = isWeb(top.image);
    return `<article class="p-card${top.read ? ' read' : ''}" data-id="${esc(top.id)}">
      <header class="p-who"><span class="fav" style="background:hsl(${hueFor(f.url)} 45% 42%)">${esc((f.title || '?').trim()[0] || '?')}</span>
        <button class="p-name" data-view="${f.id}">${esc(f.title)}</button>
        ${isWeb(f.site) ? `<a class="p-site" href="${esc(f.site)}" title="Visit ${esc(f.title)}">${esc(f.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}</header>
      ${pic ? `<img class="thumb p-img" src="${esc(top.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" data-act="open" data-tile="${esc(tileFor(f))}">` : ''}
      <div class="p-meta"><time datetime="${esc(top.date)}">${esc(ago(top.date) === 'now' ? 'just now' : ago(top.date) + ' ago')}</time>
        <button class="icon h-save${top.saved ? ' on' : ''}" data-act="save" title="${top.saved ? 'Remove from Read later' : 'Read later'}" aria-label="${top.saved ? 'Remove from Read later' : 'Read later'}">${top.saved ? ICONS.saved : ICONS.save}</button></div>
      <button class="p-title" data-act="open">${esc(top.title)}</button>
      ${top.summary ? `<p class="p-sum${pic ? '' : ' long'}">${esc(top.summary)}</p>` : ''}
      ${rest.length ? `<ul class="p-more">${rest.slice(0, 2).map(i => `<li><button data-open="${esc(i.id)}">${esc(i.title)}</button><time>${esc(ago(i.date))}</time></li>`).join('')}</ul>` : ''}
      ${total > 3 ? `<button class="linkish p-all" data-view="${f.id}">${S.unreadOnly ? `${total} unread` : `All ${total}`} →</button>` : ''}
    </article>`;
  }
  function peopleHomeHtml(list) {
    const by = new Map();
    for (const it of list) { if (!by.has(it.feed_id)) by.set(it.feed_id, []); by.get(it.feed_id).push(it); }
    const people = S.feeds.filter(f => kindOf(f) === 'person');
    const active = people.filter(f => by.has(f.id)).sort((a, b) => by.get(b.id)[0].date.localeCompare(by.get(a.id)[0].date));
    const fresh = active.filter(f => Date.now() - Date.parse(by.get(f.id)[0].date) < 7 * DAY);
    const older = active.filter(f => !fresh.includes(f));
    const caught = people.filter(f => !by.has(f.id) && (f.recent || 0) > 0);
    const quiet = people.filter(f => !by.has(f.id) && !(f.recent || 0));
    const grid = fs => `<div class="p-grid">${fs.map(f => personCard(f, by.get(f.id), by.get(f.id).length)).join('')}</div>`;
    const names = fs => fs.map(f => `<button class="b-link" data-view="${f.id}">${esc(f.title)}</button>`).join(', ');
    let out = '';
    if (!active.length) { const [t, d] = emptyText(); out += `<div class="empty"><strong>${S.unreadOnly && people.length ? 'You’re caught up with everyone' : t}</strong><span>${S.unreadOnly && people.length ? 'Switch to “All” to see what they’ve written before.' : d}</span></div>`; }
    if (fresh.length) out += `<section class="h-sec"><div class="h-head"><h2>This week</h2><span class="h-count">${fresh.length} ${fresh.length === 1 ? 'person' : 'people'} wrote something</span></div>${grid(fresh)}</section>`;
    if (older.length) out += `<section class="h-sec"><div class="h-head"><h2>Earlier</h2><span class="h-count">${older.length} more</span></div>${grid(older)}</section>`;
    if (caught.length || quiet.length) out += `<section class="p-foot">
        ${caught.length ? `<p><span class="b-later-k">All caught up with</span> ${names(caught)}</p>` : ''}
        ${quiet.length ? `<p><span class="b-later-k">Quiet for a month</span> ${names(quiet)}</p>` : ''}</section>`;
    return out;
  }


  // ------------------------------------------------------------ The guide: RSS for people who've never used it
  const STARTERS = [
    ['blog.jim-nielsen.com', 'Jim Nielsen', 'Short, thoughtful posts about the web, design and making things.'],
    ['kevquirk.com', 'Kev Quirk', 'A personal blog about the small web, technology and life.'],
    ['manuelmoreale.com', 'Manuel Moreale', 'Home of People and Blogs, a weekly interview with someone who writes online.'],
    ['tracydurnell.com', 'Tracy Durnell', 'Weeknotes and a “mind garden” of ideas, books and making.'],
    ['rknight.me', 'Robb Knight', 'Small tools and notes for the independent web.'],
    ['daviddaniels.com', 'David Daniels', 'Personal essays since 2001, from the person who made this app.'],
  ];
  const followsDomain = d => S.feeds.some(f => [f.url, f.site].some(u => (u || '').replace(/^https?:\/\/(www\.)?/, '').startsWith(d)));
  function guideHtml() {
    const starter = ([d, name, about]) => {
      const on = followsDomain(d);
      return `<div class="g-start"><span class="fav" style="background:hsl(${hueFor('https://' + d + '/')} 45% 42%)">${esc(name[0])}</span>
        <div><strong>${esc(name)}</strong><span>${esc(about)}</span></div>
        <button class="btn${on ? '' : ' primary'}" data-guide-follow="${esc(d)}"${on ? ' disabled' : ''}>${on ? 'Following' : 'Follow'}</button></div>`;
    };
    const keys = IOS ? '' : `<section class="g-sec"><h2>Handy keys on the Mac</h2>
      <dl class="g-keys"><dt><kbd>j</kbd> <kbd>k</kbd></dt><dd>Next and previous story</dd><dt><kbd>o</kbd></dt><dd>Open the original page</dd>
      <dt><kbd>s</kbd></dt><dd>Save for Read later</dd><dt><kbd>m</kbd></dt><dd>Mark read or unread</dd><dt><kbd>⌘R</kbd></dt><dd>Check for new posts</dd><dt><kbd>⌘N</kbd></dt><dd>Add a feed</dd></dl></section>`;
    return `<article class="guide">
      <p class="g-kicker">The Reading Room Guide</p>
      <h2 class="g-hero">Read the web the way it was meant to be read: written by people, in the order they wrote it.</h2>
      <p class="g-lede">If you’ve never used an RSS reader, this is a five-minute introduction. Nothing to sign up for, nothing to learn by heart.</p>

      <section class="g-sec"><h2>What is RSS?</h2>
        <p>Almost every blog, newsletter and news site quietly publishes a list of its newest posts. That list is called a <b>feed</b> (RSS is the name of the format). A reader like this one checks the feeds you choose and shows you what’s new.</p>
        <div class="g-how" aria-hidden="true">
          <div><span class="g-dot">1</span><strong>A writer posts</strong><span>on their own website</span></div>
          <div class="g-arrow">→</div>
          <div><span class="g-dot">2</span><strong>Their feed updates</strong><span>a simple list of new posts</span></div>
          <div class="g-arrow">→</div>
          <div><span class="g-dot">3</span><strong>It shows up here</strong><span>for you, in order, nothing in between</span></div>
        </div>
        <p>Think of it as subscribing to a magazine, except it’s free, it’s every writer you like, and they all arrive in one place.</p></section>

      <section class="g-sec"><h2>Why read this way?</h2>
        <ul class="g-list">
          <li><b>You choose everything.</b> No algorithm decides what you see, and nothing is pushed in because it gets clicks.</li>
          <li><b>Nothing is hidden.</b> Every post from the people you follow shows up, newest first.</li>
          <li><b>No account, no ads, no tracking.</b> Your reading stays on your own devices.</li>
          <li><b>It supports real people.</b> Independent writers depend on readers who come to them directly.</li>
        </ul></section>

      <section class="g-sec"><h2>Start with a few people</h2>
        <p>Here are some friendly places to begin. Press Follow and their posts appear in Today and People. You can unfollow any time.</p>
        <div class="g-starts">${STARTERS.map(starter).join('')}</div></section>

      <section class="g-sec"><h2>Follow any site you like</h2>
        <ol class="g-steps">
          <li>Copy the address of a blog or site you enjoy, for example <code>kottke.org</code>.</li>
          <li>Press <b>+ Add a feed</b> at the bottom of the sidebar${IOS ? ' (tap Feeds first on iPhone)' : ''} and paste it in.</li>
          <li>The app finds the site’s feed for you. If it can’t, look on the site for a link called <b>RSS</b>, <b>Feed</b> or <b>Subscribe</b>, or the orange <span class="g-rss" aria-label="RSS icon"></span> icon, and paste that address instead.</li>
        </ol>
        <p><b>People post in other places too, and you can follow them there:</b></p>
        <ul class="g-list">
          <li><b>Mastodon:</b> type their handle, like <code>@name@mastodon.social</code>.</li>
          <li><b>Bluesky:</b> type <code>@name.bsky.social</code> or paste their profile link.</li>
          <li><b>YouTube:</b> paste a channel’s address. New videos play right in the app.</li>
          <li><b>Podcasts:</b> paste a show’s Apple Podcasts link or its feed. Episodes play in the app and remember where you stopped.</li>
        </ul>
        <p style="margin-top:12px">Type words instead of an address, like <code>space exploration</code>, and you’ll follow that topic through Google News. Moving from another reader? Use <b>Import OPML</b> to bring your whole list across.</p></section>

      <section class="g-sec"><h2>Finding more good writers</h2>
        <p>The best way to find people is through people. Many writers keep a <b>blogroll</b>, a list of other blogs they read. <button class="b-link" data-view="discover">Discover</button> reads the blogrolls of everyone you follow and suggests who they recommend.</p>
        <p>A few directories of personal sites, too: <a href="https://ooh.directory/">ooh.directory</a>, <a href="https://blogroll.org/">blogroll.org</a>, <a href="https://personalsit.es/">personalsit.es</a> and <a href="https://indieblog.page/">indieblog.page</a>.</p></section>

      <section class="g-sec"><h2>Getting around</h2>
        <dl class="g-defs">
          <dt>Today</dt><dd>A morning paper: a short briefing, then everything new from the last day.</dd>
          <dt>People</dt><dd>Only individuals writing on their own sites. Use “Choose who’s here” to say who counts.</dd>
          <dt>Read later</dt><dd>Press the bookmark on any story to keep it for later. It syncs to your other devices.</dd>
          <dt>Annotated</dt><dd>Select a passage in a story to highlight it or add a note. They’re all collected here.</dd>
          <dt>Discover</dt><dd>Blogs recommended by the people you already read.</dd>
          <dt>Folders</dt><dd>Drag feeds onto a folder in the sidebar to group them, like Tech or Friends.</dd>
          <dt>Write back</dt><dd>In any story, press Write back to reply to the writer: by email, in their comments, or on Mastodon or Bluesky, whichever they offer.</dd>
          <dt>Listen</dt><dd>In any story, press Listen to have it read aloud. Choose a voice you like.</dd>
          <dt>Aa</dt><dd>Change the text size, width and colors of the reading view.</dd>
        </dl></section>

      <section class="g-sec"><h2>Keeping it calm</h2>
        <ul class="g-list">
          <li><b>Unread isn’t a to-do list.</b> Skim what interests you and press <b>Mark all read</b> without guilt.</li>
          <li><b>Mute words</b> you’re tired of seeing, from <button class="b-link" id="guideMutes">Muted words</button> in the sidebar.</li>
          <li><b>Hide a website</b> from your news searches with the ⊘ button on its stories.</li>
          <li><b>Read on all your devices.</b> Turn on sync at the bottom of the sidebar and your feeds, Read later and highlights follow you through iCloud Drive.</li>
        </ul></section>
      ${keys}
      <section class="g-sec"><h2>A few words you’ll see</h2>
        <dl class="g-defs">
          <dt>Feed</dt><dd>A site’s list of new posts. Also called an RSS feed, Atom feed or JSON feed. This app reads them all.</dd>
          <dt>Follow, subscribe</dt><dd>The same thing: adding a feed to your reader.</dd>
          <dt>OPML</dt><dd>A file with a list of feeds, for moving between readers or sharing your list.</dd>
          <dt>Blogroll</dt><dd>A list of blogs a writer recommends.</dd>
        </dl></section>

      <p class="g-end">That’s all there is to it. Follow a handful of people, check in when you like, and enjoy the web written by people.</p>
    </article>`;
  }
  async function guideFollow(d, btn) {
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const r = await invoke('add_feed', { url: 'https://' + d + '/', title: null, folderId: null });
      status(`Following ${r.title}.`); await load();
    } catch (e) { btn.disabled = false; btn.textContent = 'Follow'; status(msg(e), true); }
  }

  // ------------------------------------------------------------ choosing who counts as a person
  function peopleRows() {
    const rate = f => isNewsSearch(f) ? 'news search' : `${f.recent || 0} ${f.recent === 1 ? 'post' : 'posts'} in 30 days`;
    const sorted = [...S.feeds].sort((a, b) => (kindOf(a) === kindOf(b) ? (b.recent || 0) - (a.recent || 0) : kindOf(a) === 'person' ? -1 : 1));
    return sorted.map(f => {
      const k = kindOf(f), set = (S.prefs.kinds || {})[f.url];
      return `<div class="prow"><span class="fav" style="background:hsl(${hueFor(f.url)} 45% 42%)">${esc((f.title || '?').trim()[0] || '?')}</span>
        <span class="pname">${esc(f.title)}<small>${rate(f)}${set ? '' : ' · automatic'}</small></span>
        <span class="seg"><button data-kind="person" data-url="${esc(f.url)}" aria-pressed="${k === 'person'}">Person</button><button data-kind="pub" data-url="${esc(f.url)}" aria-pressed="${k === 'pub'}">Publication</button></span></div>`;
    }).join('');
  }
  function openPeople() {
    let el = $('peoplePanel');
    if (!el) {
      el = document.createElement('div'); el.className = 'overlay'; el.id = 'peoplePanel';
      el.innerHTML = `<div class="sheet psheet" role="dialog" aria-modal="true" aria-labelledby="peopleTitle">
        <h2 id="peopleTitle">Who counts as a person</h2>
        <p>People are individuals writing on their own sites. They lead Today and fill the People list. Publications still show everywhere else. Your choices sync to your other devices.</p>
        <div class="plist" id="peopleList"></div>
        <div class="row sheet-foot"><button class="btn" type="button" id="peopleReset">Back to automatic</button><button class="btn primary" type="button" id="peopleDone">Done</button></div></div>`;
      document.body.appendChild(el);
      el.addEventListener('mousedown', e => { if (e.target === el) el.hidden = true; });
      el.addEventListener('click', e => {
        if (e.target.id === 'peopleDone') { el.hidden = true; render(); return; }
        if (e.target.id === 'peopleReset') { S.prefs.kinds = {}; savePrefs(); $('peopleList').innerHTML = peopleRows(); return; }
        const b = e.target.closest('[data-kind]'); if (!b) return;
        const f = S.feeds.find(x => x.url === b.dataset.url); if (!f) return;
        S.prefs.kinds = { ...(S.prefs.kinds || {}) };
        if (b.dataset.kind === autoKind(f)) delete S.prefs.kinds[f.url]; else S.prefs.kinds[f.url] = b.dataset.kind;
        savePrefs();
        b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        const small = b.closest('.prow').querySelector('small');
        small.textContent = small.textContent.replace(/ · automatic$/, '') + (S.prefs.kinds[f.url] ? '' : ' · automatic');
      });
    }
    $('peopleList').innerHTML = peopleRows(); el.hidden = false;
  }

  // ------------------------------------------------------------ Discover
  // Blogs the sites you follow recommend: in their blogrolls, or by linking to them again and again.
  // The looking happens on the Rust side (discover.rs); this draws the results.
  const WEEK = 7 * DAY;
  const names = list => list.length <= 1 ? list.join('') : list.length === 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const bold = list => names(list.slice(0, 3).map(n => `<b>${esc(n)}</b>`)) + (list.length > 3 ? ` and ${list.length - 3} more` : '');

  function discoverSub() {
    if (D.running) return D.total ? `Reading ${D.done} of ${D.total} sites…` : 'Looking through the sites you follow…';
    if (D.report) return `From the blogrolls and links of the ${D.report.sites} sites you follow · updated ${ago(D.report.at) === 'now' ? 'just now' : ago(D.report.at) + ' ago'}`;
    return 'Blogs recommended by the sites you follow';
  }
  function whyLine(s) {
    const parts = [];
    if (s.rolls.length) parts.push(`In the blogroll${s.rolls.length > 1 ? 's' : ''} of ${bold(s.rolls)}`);
    if (s.linkers.length) parts.push(`${s.rolls.length ? 'linked' : 'Linked'} ${s.links === 1 ? 'once' : `<b>${s.links} times</b>`} by ${bold(s.linkers)}`);
    return parts.join(' · ');
  }
  function sugHtml(s) {
    const latest = s.posts[0];
    const open = D.open.has(s.domain), busy = D.busy.has(s.domain);
    const d = esc(s.domain);
    return `<div class="sug" data-sug="${d}">
      <span class="fav" style="background:hsl(${hueFor(s.feed)} 45% 42%)">${esc((s.title || '?').trim()[0] || '?')}</span>
      <div class="sug-body">
        <h3>${isWeb(s.site) ? `<a href="${esc(s.site)}">${esc(s.title)}</a>` : esc(s.title)}</h3>
        <div class="dom">${d}</div>
        <div class="why">${whyLine(s)}</div>
        ${latest && !open ? `<div class="latest">Latest: <a href="${esc(latest.link)}">${esc(latest.title)}</a> · ${ago(latest.date) === 'now' ? 'just now' : ago(latest.date) + ' ago'}</div>` : ''}
        ${open ? `<ul class="posts">${s.posts.map(p => `<li><a href="${esc(p.link)}">${esc(p.title)}</a><time>${ago(p.date)}</time></li>`).join('')}</ul>` : ''}
      </div>
      <div class="sug-acts">
        <button class="btn" data-disc="preview" data-domain="${d}" aria-expanded="${open}">${open ? 'Less' : 'Preview'}</button>
        <button class="btn primary" data-disc="follow" data-domain="${d}"${busy ? ' disabled' : ''}>${busy ? 'Adding…' : 'Follow'}</button>
        <button class="icon sug-x" data-disc="hide" data-domain="${d}" title="Not for me" aria-label="Not for me">×</button>
      </div>
    </div>`;
  }
  function discoverHtml() {
    const intro = `<p class="disc-intro">The writers you read recommend these blogs, in their blogrolls or by linking to them often. The more of your sites that point to one, the higher it appears.</p>`;
    if (D.running && !D.report) {
      const pct = D.total ? Math.round(100 * D.done / D.total) : 5;
      return intro + `<div class="disc-wait"><strong>Reading the sites you follow</strong><span>Checking blogrolls and recent links. This takes a minute or so.</span><div class="disc-bar"><div style="width:${pct}%"></div></div></div>`;
    }
    if (!D.report) return intro + `<div class="empty"><strong>Find blogs to follow</strong><span>The app reads the blogrolls and recent posts of the sites you follow.</span><button class="btn primary" data-disc="scan">Look now</button></div>`;
    const list = D.report.suggestions;
    if (!list.length) return intro + `<div class="empty"><strong>Nothing new to suggest</strong><span>${S.feeds.length < 3 ? 'Follow a few more sites and look again.' : 'You may already follow everything they recommend. Look again in a week or so.'}</span></div>`;
    const rolled = list.filter(s => s.rolls.length), linked = list.filter(s => !s.rolls.length);
    let out = intro;
    if (D.running) out += `<div class="disc-note">Looking again: ${D.done} of ${D.total} sites…</div>`;
    if (rolled.length) out += `<h2 class="sec-h">From their blogrolls</h2>` + rolled.map(sugHtml).join('');
    if (linked.length) out += `<h2 class="sec-h">Linked often by your feeds</h2><p class="sec-p">Sites the stories you read keep pointing to lately.</p>` + linked.map(sugHtml).join('');
    const found = D.report.rolls_found || [];
    out += `<p class="disc-foot">${found.length
      ? `Blogrolls read from ${esc(names(found))}.`
      : 'None of the sites you follow publish a blogroll the app could read, so these come from links in their posts.'} Blogrolls are found through a site’s <code>rel="blogroll"</code> link, <code>/.well-known/recommendations.opml</code>, or a Blogroll page.</p>`;
    return out;
  }
  function paintDiscover() { if (S.view === 'discover') { renderHead(); renderList(); } renderRail(); }
  async function loadDiscover() {
    try { const r = await invoke('discover_get'); D.report = r.report; D.running = r.running; } catch {}
  }
  async function startDiscover() {
    if (D.running) return;
    D.running = true; D.done = 0; D.total = 0; paintDiscover();
    try { const r = await invoke('discover_scan'); if (r) { D.report = r; D.running = false; D.open.clear(); } }
    catch (e) { D.running = false; status(msg(e), true); }
    paintDiscover();
  }
  async function openDiscover() {
    await loadDiscover(); paintDiscover();
    if (!D.running && (!D.report || Date.now() - Date.parse(D.report.at) > WEEK)) startDiscover();
  }
  async function discoverAction(kind, domain) {
    const s = D.report?.suggestions.find(x => x.domain === domain);
    if (kind === 'scan') return startDiscover();
    if (!s) return;
    if (kind === 'preview') { D.open.has(domain) ? D.open.delete(domain) : D.open.add(domain); renderList(); return; }
    if (kind === 'hide') {
      D.report.suggestions = D.report.suggestions.filter(x => x !== s); paintDiscover();
      status(`You won’t see ${s.title} here again.`);
      invoke('discover_hide', { domain }).catch(e => status(msg(e), true));
      return;
    }
    if (kind === 'follow') {
      D.busy.add(domain); renderList();
      try {
        await invoke('add_feed', { url: s.feed, title: s.title, folderId: null });
        D.report.suggestions = D.report.suggestions.filter(x => x !== s);
        status(`Following ${s.title}. Its stories are in All.`);
        await load();
      } catch (e) { status(msg(e), true); }
      D.busy.delete(domain); paintDiscover();
    }
  }
  listen('discover-progress', e => { const [done, total] = e.payload; D.done = done; D.total = total; D.running = true; if (S.view === 'discover') { renderHead(); renderList(); } });
  listen('discover-done', async () => { await loadDiscover(); D.running = false; paintDiscover(); });
  loadDiscover().then(() => renderRail());


  // ------------------------------------------------------------ people everywhere: videos, podcasts, social posts
  const ytId = link => { const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(link || ''); return m ? m[1] : null; };
  const socialKind = link => /bsky\.app\/profile\/[^/]+\/post\//.test(link || '') ? 'Bluesky'
    : /^https?:\/\/[^/]+\/@[\w.]+\/\d+$/.test(link || '') ? 'Mastodon' : null;
  const isSocialFeed = f => /\/@[\w.]+\.rss$/.test(f?.url || '') || /bsky\.app\/profile\/[^/]+\/rss$/.test(f?.url || '');
  const kindTag = it => it.audio ? '<span class="via">Podcast</span>' : ytId(it.link) ? '<span class="via">Video</span>' : socialKind(it.link) ? `<span class="via">${socialKind(it.link)}</span>` : '';

  function paintMedia(it) {
    const box = $('rMedia'), yt = ytId(it.link);
    box.hidden = !(yt || it.audio); box.innerHTML = '';
    if (yt) {
      box.innerHTML = `<div class="r-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(it.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    } else if (it.audio) {
      const key = 'pos:' + it.id;
      box.innerHTML = `<div class="r-audio"><audio id="rAudio" controls preload="metadata" src="${esc(it.audio)}"></audio>
        <div class="seg r-rate" role="group" aria-label="Speed">${[1, 1.25, 1.5, 2].map(r => `<button type="button" data-rate="${r}" aria-pressed="${r === 1}">${r}×</button>`).join('')}</div></div>`;
      const a = $('rAudio');
      const saved = Number(store.get(key)) || 0;
      a.addEventListener('loadedmetadata', () => { if (saved > 5 && saved < a.duration - 10) a.currentTime = saved; }, { once: true });
      let last = 0;
      a.addEventListener('timeupdate', () => { if (Math.abs(a.currentTime - last) > 5) { last = a.currentTime; store.set(key, String(Math.floor(a.currentTime))); } });
      a.addEventListener('ended', () => store.set(key, '0'));
      box.querySelector('.r-rate').onclick = e => {
        const b = e.target.closest('[data-rate]'); if (!b) return;
        a.playbackRate = Number(b.dataset.rate);
        box.querySelectorAll('[data-rate]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      };
    }
  }
  // Short posts and videos come straight from the feed; their web pages aren't articles.
  function feedOnlyBody(it) {
    const kind = socialKind(it.link), yt = ytId(it.link);
    if (!kind && !yt) return null;
    const pic = !yt && isWeb(it.image) ? `<figure><img src="${esc(it.image)}" alt=""></figure>` : '';
    const text = it.summary ? `<p class="${kind ? 'r-post' : ''}">${esc(it.summary)}</p>` : '';
    return `${text}${pic}<p class="note">${kind ? `A post on ${kind}.` : 'A video on YouTube.'} <button class="b-link" id="rOnSite">${kind ? `Open it on ${kind}` : 'Watch on YouTube'}</button></p>`;
  }

  // ------------------------------------------------------------ Write back: reply to the writer, not the algorithm
  let replyFor = null;
  async function openReply(anchor) {
    const it = item(S.readerId); if (!it) return;
    hidePops(); $('shareMenu').hidden = true;
    const menu = $('replyMenu'); replyFor = it.id;
    const kind = socialKind(it.link);
    menu.innerHTML = kind ? replyItems(it, { social: [{ label: kind, url: it.link, post: true }] })
      : `<p class="menu-note">Looking for how ${esc(feedById(it.feed_id)?.title || 'the writer')} likes to hear from readers…</p>`;
    placeMenu(menu, anchor);
    if (kind) return;
    try {
      const o = await invoke('reply_options', { itemId: it.id });
      if (replyFor !== it.id || menu.hidden) return;
      menu.innerHTML = replyItems(it, o); placeMenu(menu, anchor);
    } catch (e) { menu.innerHTML = `<p class="menu-note">${esc(msg(e))}</p>`; }
  }
  function placeMenu(menu, anchor) {
    placeNear(menu, anchor.getBoundingClientRect());
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }
  const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  const ICON_TALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  const ICON_AT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>';
  const ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11 12 4l9 7v9H3z"/></svg>';
  function replyItems(it, o) {
    const who = feedById(it.feed_id)?.title || 'the writer', rows = [];
    if (o.email) {
      const subject = o.email.subject || `Re: ${headline(it)}`;
      const body = `\n\n\n—\nIn reply to “${headline(it)}”\n${it.link}`;
      rows.push(`<button type="button" role="menuitem" data-reply="${esc(`mailto:${o.email.address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)}">${ICON_MAIL}<span>Reply by email<small>${esc(o.email.address)}</small></span></button>`);
    }
    if (o.comments) rows.push(`<button type="button" role="menuitem" data-reply-web="${esc(o.comments)}">${ICON_TALK}<span>Leave a comment<small>on the post</small></span></button>`);
    for (const l of o.social || []) rows.push(`<button type="button" role="menuitem" data-reply-web="${esc(l.url)}">${ICON_AT}<span>${l.post ? `Reply on ${esc(l.label)}` : `Write to them on ${esc(l.label)}`}<small>${esc(l.post ? 'opens the post' : l.url.replace(/^https?:\/\//, ''))}</small></span></button>`);
    if (o.contact) rows.push(`<button type="button" role="menuitem" data-reply-web="${esc(o.contact)}">${ICON_HOME}<span>Contact page<small>${esc(who)}</small></span></button>`);
    const mine = myFeed();
    const wm = o.webmention ? `<p class="menu-note">This site accepts Webmentions: link to the post from ${mine ? esc(mine.title) : 'your own blog'} and your reply shows up there too.</p>` : '';
    if (!rows.length) {
      const site = feedById(it.feed_id)?.site;
      return `<p class="menu-note">${esc(who)} doesn’t list a way to reply on this post.${o.webmention ? '' : ' You could share it with a note, or say hello through their site.'}</p>${wm}
        ${isWeb(site) ? `<button type="button" role="menuitem" data-reply-web="${esc(site)}">${ICON_HOME}<span>Visit their site</span></button>` : ''}`;
    }
    return `<p class="menu-head">Write back to ${esc(who)}</p>${rows.join('')}${wm}`;
  }
  $('replyMenu').addEventListener('click', async e => {
    const b = e.target.closest('[data-reply], [data-reply-web]'); if (!b) return;
    $('replyMenu').hidden = true;
    try {
      if (b.dataset.reply) await invoke('open_external', { url: b.dataset.reply });
      else openWeb(b.dataset.replyWeb);
    } catch (err) { status(msg(err), true); }
  });

  // ------------------------------------------------------------ reader
  const openWeb = url => { if (isWeb(url)) invoke('open_web', { url }).catch(e => status(msg(e), true)); };
  let listScroll = 0, articleHtml = '', articleFor = null;

  // Wide windows show the list and the article side by side (the breakpoint matches styles.css).
  const wide = window.matchMedia('(min-width: 1280px)');
  const isSplit = () => wide.matches;
  wide.addEventListener('change', () => {
    if (S.readerId) $('listView').hidden = !isSplit() ? true : false;
    if (isSplit()) $('listView').hidden = false;
    renderList();
  });

  function openReader(id) {
    const it = item(id); if (!it) return;
    if (!S.readerId && !isSplit()) listScroll = $('main').scrollTop;
    S.readerId = S.selId = id; S.keep.add(id);
    hidePops();
    $('listView').hidden = !isSplit(); $('reader').hidden = false; $('readerEmpty').hidden = true;
    if (isPhone()) setScreen('reader');
    if (isSplit()) $('reader').scrollTo({ top: 0 }); else $('main').scrollTo({ top: 0 });
    if (!it.read) mark(id, { read: true }); else render();
    renderReaderChrome();
    loadArticle(it);
    if (isSplit()) document.querySelector(`.story[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function closeReader(silent) {
    if (!S.readerId) return;
    S.readerId = null; articleFor = null; hidePops();
    // A video stops when you leave it; a podcast that's playing keeps going until the next story
    const au = $('rAudio'); if (!au || au.paused) { $('rMedia').innerHTML = ''; $('rMedia').hidden = true; }
    $('reader').hidden = true; $('listView').hidden = false; $('readerEmpty').hidden = false;
    if (isPhone()) setScreen('list');
    if (!silent) { renderList(); if (!isSplit()) $('main').scrollTo({ top: listScroll }); }
  }

  function renderReaderChrome() {
    const it = item(S.readerId); if (!it) return closeReader();
    const f = feedById(it.feed_id);
    $('rBackLabel').textContent = viewName();
    $('rSave').textContent = isPhone() ? (it.saved ? 'Saved ✓' : 'Save') : (it.saved ? 'Saved ✓' : 'Read later');
    $('rOriginal').textContent = isPhone() ? 'Web' : 'View original';
    $('rReply').textContent = isPhone() ? 'Reply' : 'Write back';
    $('rSave').setAttribute('aria-pressed', String(!!it.saved));
    $('rTitle').textContent = headline(it);
    const when = new Date(it.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    $('rMeta').innerHTML = `<span class="src">${esc(f ? f.title : '')}</span><time datetime="${esc(it.date)}">${esc(when)}</time><span id="rByline"></span>`;
    const list = visible().slice(0, S.shown), i = list.findIndex(x => x.id === it.id);
    $('rPrev').disabled = i <= 0; $('rNext').disabled = i < 0 || i >= list.length - 1;
    renderNotes();
  }

  async function loadArticle(it, refetch = false) {
    articleFor = it.id;
    paintMedia(it);
    const only = feedOnlyBody(it);
    if (only) {
      articleHtml = only; paintArticle();
      $('rOnSite')?.addEventListener('click', () => openWeb(it.link));
      return;
    }
    $('rBody').innerHTML = `<p class="note">Loading the article…</p>`;
    try {
      const a = await invoke('get_article', { itemId: it.id, refetch });
      if (articleFor !== it.id) return; // moved on to another story
      articleHtml = a.html;
      if (a.byline && $('rByline')) $('rByline').textContent = a.byline;
      paintArticle();
    } catch (e) {
      if (articleFor !== it.id) return;
      articleHtml = '';
      $('rBody').innerHTML = `<div class="r-fallback">
          ${it.summary ? `<p class="summary-text">${esc(it.summary)}</p>` : ''}
          <p class="note">${esc(msg(e))}</p>
          <div class="row"><button class="btn primary" id="rFallbackOpen">View the original page</button><button class="btn" id="rRetry">Try again</button></div>
        </div>`;
      $('rFallbackOpen').onclick = () => openWeb(it.link);
      $('rRetry').onclick = () => loadArticle(it, true);
    }
  }

  // Story HTML comes from the Rust side already cleaned (no scripts, styles or event handlers).
  function paintArticle() {
    const body = $('rBody');
    body.innerHTML = articleHtml;
    body.querySelectorAll('img').forEach(img => {
      img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      // A picture that can't load leaves no empty frame behind (nor an empty figure around it).
      const drop = () => { const fig = img.closest('figure'); img.remove(); if (fig && !fig.querySelector('img, video')) fig.remove(); };
      if (!img.getAttribute('src') && !img.getAttribute('srcset')) drop(); else img.addEventListener('error', drop, { once: true });
    });
    for (const h of S.highlights.filter(h => h.item_id === S.readerId)) wrapHighlight(body, h);
  }

  // ---- highlights: find the passage by its position (or its text) and wrap it in <mark>
  function textNodes(root) {
    const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0, n;
    while ((n = w.nextNode())) { out.push({ node: n, start: pos, end: pos + n.data.length }); pos += n.data.length; }
    return { nodes: out, text: out.map(x => x.node.data).join('') };
  }
  function wrapHighlight(root, h) {
    const { nodes, text } = textNodes(root);
    let start = h.start >= 0 && text.substr(h.start, h.text.length) === h.text ? h.start : text.indexOf(h.text);
    if (start < 0) return false;
    const end = start + h.text.length;
    for (const { node, start: ns, end: ne } of nodes) {
      if (ne <= start || ns >= end || !node.data.trim()) continue;
      let target = node;
      const a = Math.max(start, ns) - ns, b = Math.min(end, ne) - ns;
      if (b < target.data.length) target.splitText(b);
      if (a > 0) target = target.splitText(a);
      const mark = document.createElement('mark');
      mark.dataset.h = h.id;
      if (h.note) mark.classList.add('has-note');
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
    }
    return true;
  }

  function renderNotes() {
    const mine = S.highlights.filter(h => h.item_id === S.readerId);
    const box = $('rNotes');
    box.hidden = !mine.length;
    box.innerHTML = mine.length ? `<div class="notes-head"><h2>Your highlights and notes</h2><button class="linkish" type="button" data-export="story">${IOS ? 'Share' : 'Export'}</button></div>` + mine.map(h =>
      `<div class="quote" data-jump="${h.id}"><q>${esc(h.text)}</q>${h.note ? `<span class="note-text">${esc(h.note)}</span>` : ''}</div>`).join('') : '';
  }

  function hidePops() {
    let any = false;
    for (const id of ['selPop', 'notePop', 'shareMenu', 'typeMenu', 'replyMenu']) if (!$(id).hidden) { $(id).hidden = true; any = true; }
    return any;
  }
  function placeNear(el, rect) {
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = rect.left + rect.width / 2 - w / 2, y = rect.top - h - 8;
    if (y < 44) y = rect.bottom + 8;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }

  let pending = null; // the selection waiting for "Highlight" / "Add note"
  function checkSelection() {
    if (!S.readerId) return;
    const sel = window.getSelection();
    const body = $('rBody');
    if (!sel || sel.isCollapsed || !articleHtml) { if (!$('selPop').hidden) $('selPop').hidden = true; return; }
    const range = sel.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return;
    const text = range.toString();
    if (!text.trim()) return;
    const before = document.createRange(); before.selectNodeContents(body); before.setEnd(range.startContainer, range.startOffset);
    pending = { text, start: before.toString().length };
    const r = range.getBoundingClientRect();
    placeNear($('selPop'), r);
    // On iPhone and iPad the system's own menu (Copy, Look Up…) sits above the selection, so go below it.
    if (IOS) { const p = $('selPop'); p.style.top = Math.min(r.bottom + 14, window.innerHeight - p.offsetHeight - 12) + 'px'; }
  }
  document.addEventListener('mouseup', e => {
    if (IOS || !S.readerId || e.target.closest('.pop, .menu')) return;
    setTimeout(checkSelection, 0);
  });
  // Touch: there's no mouseup when you finish dragging the selection handles, so wait for the selection to settle.
  let selTimer;
  document.addEventListener('selectionchange', () => { if (!IOS) return; clearTimeout(selTimer); selTimer = setTimeout(checkSelection, 350); });

  async function saveHighlight(withNote) {
    if (!pending || !S.readerId) return;
    const lead = pending.text.length - pending.text.trimStart().length;
    const h = { item_id: S.readerId, text: pending.text.trim(), start: pending.start + lead, note: '' };
    $('selPop').hidden = true; window.getSelection()?.removeAllRanges(); pending = null;
    try {
      h.id = await invoke('add_highlight', { itemId: h.item_id, text: h.text, note: null, start: h.start });
      h.created_at = new Date().toISOString();
      S.highlights.push(h);
      paintArticle(); renderNotes(); renderRail();
      if (withNote) openNoteEditor(h.id);
    } catch (e) { status(msg(e), true); }
  }
  $('selHighlight').onclick = () => saveHighlight(false);
  $('selNote').onclick = () => saveHighlight(true);
  // A tap would clear the selection before the click arrives, so act on the touch itself.
  for (const [id, note] of [['selHighlight', false], ['selNote', true]]) {
    $(id).addEventListener('touchstart', e => { e.preventDefault(); saveHighlight(note); }, { passive: false });
  }

  let editing = null;
  function openNoteEditor(id) {
    const h = S.highlights.find(x => x.id === id); if (!h) return;
    editing = h;
    const mark = $('rBody').querySelector(`mark[data-h="${id}"]`);
    $('noteText').value = h.note || '';
    placeNear($('notePop'), (mark || $('rBody')).getBoundingClientRect());
    $('noteText').focus();
  }
  $('noteSave').onclick = async () => {
    if (!editing) return;
    const note = $('noteText').value.trim();
    try { await invoke('set_note', { id: editing.id, note }); editing.note = note; $('notePop').hidden = true; paintArticle(); renderNotes(); renderList(); }
    catch (e) { status(msg(e), true); }
  };
  $('noteDelete').onclick = async () => {
    if (!editing) return;
    try {
      await invoke('delete_highlight', { id: editing.id });
      S.highlights = S.highlights.filter(x => x.id !== editing.id);
      $('notePop').hidden = true; paintArticle(); renderNotes(); renderRail(); renderList();
    } catch (e) { status(msg(e), true); }
  };
  $('noteText').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('noteSave').click(); };

  // ---- highlights as Markdown: one story, or everything in Annotated
  function storyMarkdown(it) {
    const f = feedById(it.feed_id);
    const when = new Date(it.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    const quotes = S.highlights.filter(h => h.item_id === it.id).map(h => `> ${h.text.replace(/\s*\n\s*/g, ' ')}${h.note ? `\n\n${h.note}` : ''}`).join('\n\n');
    return `## ${it.title}\n${[f?.title, when].filter(Boolean).join(' · ')}\n${it.link}\n\n${quotes}\n`;
  }
  function allMarkdown() {
    const ids = [...new Set(S.highlights.map(h => h.item_id))];
    const stories = ids.map(item).filter(Boolean).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    return `# Highlights from The Reading Room\n${today}\n\n` + stories.map(storyMarkdown).join('\n');
  }
  async function exportText(title, text) {
    if (IOS && navigator.share) {
      try { await navigator.share({ title, text }); } catch (e) { if (e?.name !== 'AbortError') status(msg(e), true); }
      return;
    }
    try { await navigator.clipboard.writeText(text); } catch {}
    try { if (await invoke('save_text', { name: title, text })) status('Saved your highlights (also copied to the clipboard).'); else status('Copied your highlights to the clipboard.'); }
    catch (e) { status('Copied your highlights to the clipboard.'); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-export]'); if (!b) return;
    if (b.dataset.export === 'story') { const it = item(S.readerId); if (it) exportText(`Highlights – ${it.title}`, storyMarkdown(it)); }
    else exportText('Highlights', allMarkdown());
  });

  // ---- Listen: read the article aloud
  // iPhone and iPad use the app's native speech (keeps playing with the screen locked, Lock Screen controls);
  // the Mac uses the system voices through the page.
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  const RATES = [0.8, 1, 1.25, 1.5, 2];
  const aloud = { id: null, title: '', text: '', source: '', state: 'idle', position: 0, rate: Number(store.get('listenRate')) || 1, voice: store.get('listenVoice') || '', poll: null, utter: null };
  const webSpeech = () => !IOS && 'speechSynthesis' in window;
  $('rListen').hidden = !(IOS || webSpeech());
  function bestWebVoice() {
    const vs = speechSynthesis.getVoices(), lang = (navigator.language || 'en-US').slice(0, 2);
    const mine = vs.filter(v => v.lang.startsWith(lang));
    const score = v => (/premium/i.test(v.name) ? 4 : 0) + (/enhanced/i.test(v.name) ? 3 : 0) + (/siri/i.test(v.name) ? 2 : 0) + (v.lang === navigator.language ? 1 : 0) + (v.localService ? 0.5 : 0);
    return mine.sort((a, b) => score(b) - score(a))[0] || null;
  }
  function webStart(offset) {
    speechSynthesis.cancel();
    let at = Math.max(0, Math.min(offset, aloud.text.length));
    while (at > 0 && !/\s/.test(aloud.text[at - 1])) at--;
    const u = new SpeechSynthesisUtterance(aloud.text.slice(at));
    const v = (aloud.voice && speechSynthesis.getVoices().find(x => x.voiceURI === aloud.voice)) || bestWebVoice(); if (v) u.voice = v;
    u.rate = aloud.rate;
    u.onboundary = e => { aloud.position = at + e.charIndex; paintPlayer(); };
    u.onend = () => { if (aloud.utter === u && aloud.state === 'playing') { aloud.state = 'done'; aloud.position = aloud.text.length; paintPlayer(); } };
    aloud.utter = u; aloud.position = at; aloud.state = 'playing';
    speechSynthesis.speak(u);
  }
  async function listenCmd(action, value) {
    try {
      if (IOS) { Object.assign(aloud, await invoke('speech_control', { action, value: value ?? null })); }
      else if (action === 'pause') { speechSynthesis.pause(); aloud.state = 'paused'; }
      else if (action === 'resume') { if (speechSynthesis.paused) speechSynthesis.resume(); else webStart(aloud.position); aloud.state = 'playing'; }
      else if (action === 'stop') { aloud.utter = null; speechSynthesis.cancel(); aloud.state = 'idle'; }
      else if (action === 'skip') webStart(aloud.position + Math.round(value * 15 * aloud.rate));
      else if (action === 'rate') { if (aloud.state === 'playing') webStart(aloud.position); }
    } catch (e) { status(msg(e), true); }
    paintPlayer();
  }
  async function startListening() {
    const it = item(S.readerId); if (!it) return;
    const body = $('rBody').innerText.replace(/\n{2,}/g, '\n').trim();
    if (!body || !articleHtml) { status('Open the article first: this story has no text to read yet.', true); return; }
    aloud.id = it.id; aloud.title = it.title; aloud.text = `${it.title}.\n${body}`; aloud.position = 0;
    const f = feedById(it.feed_id); aloud.source = f?.title || '';
    try {
      if (IOS) Object.assign(aloud, await invoke('speak', { text: aloud.text, title: it.title, source: f?.title || '', rate: aloud.rate, offset: 0, voice: aloud.voice || null }));
      else webStart(0);
    } catch (e) { status(msg(e), true); return; }
    $('player').hidden = false; document.body.classList.add('playing');
    paintPlayer();
    clearInterval(aloud.poll);
    if (IOS) aloud.poll = setInterval(async () => {
      if (document.hidden) return;
      try { Object.assign(aloud, await invoke('speech_status')); paintPlayer(); } catch {}
    }, 800);
  }
  function paintPlayer() {
    $('plTitle').textContent = aloud.title;
    $('plPlay').innerHTML = aloud.state === 'playing' ? PAUSE : PLAY;
    $('plPlay').setAttribute('aria-label', aloud.state === 'playing' ? 'Pause' : 'Play');
    $('plRate').textContent = `${aloud.rate}×`;
    const len = aloud.length || aloud.text.length || 1;
    $('plFill').style.width = `${Math.min(100, (aloud.position / len) * 100)}%`;
  }
  function closePlayer() { listenCmd('stop'); clearInterval(aloud.poll); $('player').hidden = true; document.body.classList.remove('playing'); }
  $('rListen').onclick = () => (aloud.id === S.readerId && aloud.state === 'playing') ? listenCmd('pause') : startListening();
  $('plPlay').onclick = () => {
    if (aloud.state === 'playing') listenCmd('pause');
    else if (aloud.state === 'done' || aloud.state === 'idle') { aloud.position = 0; IOS ? invoke('speak', { text: aloud.text, title: aloud.title, source: aloud.source, rate: aloud.rate, offset: 0, voice: aloud.voice || null }).then(s => { Object.assign(aloud, s); paintPlayer(); }) : webStart(0); }
    else listenCmd('resume');
  };
  $('plBack').onclick = () => listenCmd('skip', -15);
  $('plFwd').onclick = () => listenCmd('skip', 30);
  $('plRate').onclick = () => { aloud.rate = RATES[(RATES.indexOf(aloud.rate) + 1) % RATES.length] || 1; store.set('listenRate', String(aloud.rate)); listenCmd('rate', aloud.rate); };
  $('plClose').onclick = closePlayer;
  $('plTitle').onclick = () => { if (aloud.id && item(aloud.id)) openReader(aloud.id); };
  if (webSpeech()) speechSynthesis.onvoiceschanged = () => { if (!$('voicePanel').hidden) renderVoices(); };

  // ---- choosing the voice
  const QUALITY = { 3: 'Premium', 2: 'Enhanced' };
  let voiceList = [], bestVoice = '';
  async function loadVoices() {
    if (IOS) {
      try { const r = await invoke('speech_voices'); voiceList = r.voices || []; bestVoice = r.best || ''; } catch { voiceList = []; }
    } else if (webSpeech()) {
      const lang = (navigator.language || 'en-US').slice(0, 2);
      voiceList = speechSynthesis.getVoices().filter(v => v.lang.startsWith(lang))
        .map(v => ({ id: v.voiceURI, name: v.name.replace(/\s*\((Premium|Enhanced)\)/i, ''), language: v.lang, quality: /premium/i.test(v.name) ? 3 : /enhanced/i.test(v.name) ? 2 : 1 }))
        .sort((a, b) => b.quality - a.quality || a.name.localeCompare(b.name));
      bestVoice = bestWebVoice()?.voiceURI || '';
    }
  }
  function renderVoices() {
    const current = aloud.voice || bestVoice;
    $('voiceList').innerHTML = voiceList.length ? voiceList.map(v => `<button type="button" class="voice${v.id === current ? ' on' : ''}" data-voice="${esc(v.id)}">
        <span class="v-name">${esc(v.name)}</span>
        ${QUALITY[v.quality] ? `<span class="v-q q${v.quality}">${QUALITY[v.quality]}</span>` : ''}
        <span class="v-lang">${esc(v.language)}</span>
        ${v.id === current ? '<span class="v-on" aria-label="In use">✓</span>' : ''}
      </button>`).join('') : '<p class="note">No voices found.</p>';
    const hasGood = voiceList.some(v => v.quality >= 2);
    $('voiceHelp').textContent = IOS
      ? `${hasGood ? 'More voices:' : 'For natural voices,'} on your iPhone go to Settings › Accessibility › Spoken Content › Voices › English, and download a Premium voice (Ava, Zoe or Evan are good). Then come back here.`
      : `${hasGood ? 'More voices:' : 'For natural voices,'} go to System Settings › Accessibility › Spoken Content, click ⓘ next to System voice, and download a Premium voice. Then reopen this list.`;
  }
  async function openVoices() { hidePops(); await loadVoices(); renderVoices(); $('voicePanel').hidden = false; }
  async function pickVoice(id) {
    aloud.voice = id; store.set('listenVoice', id); renderVoices();
    const reading = aloud.id && (aloud.state === 'playing' || aloud.state === 'paused');
    try {
      if (reading) {
        // Carry on with the article in the new voice, from where it was
        if (IOS) Object.assign(aloud, await invoke('speak', { text: aloud.text, title: aloud.title, source: aloud.source, rate: aloud.rate, offset: aloud.position, voice: id }));
        else webStart(aloud.position);
        paintPlayer();
      } else {
        const v = voiceList.find(x => x.id === id);
        const sample = `Hi, I'm ${v ? v.name : 'this voice'}. I'll read your stories aloud in The Reading Room.`;
        if (IOS) await invoke('speak', { text: sample, title: 'Voice preview', source: '', rate: aloud.rate, offset: 0, voice: id });
        else { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(sample); const wv = speechSynthesis.getVoices().find(x => x.voiceURI === id); if (wv) u.voice = wv; u.rate = aloud.rate; speechSynthesis.speak(u); }
      }
    } catch (e) { status(msg(e), true); }
  }
  $('plVoice').onclick = openVoices;
  $('typeVoice').onclick = openVoices;
  $('voiceClose').onclick = () => { $('voicePanel').hidden = true; };
  $('voicePanel').addEventListener('mousedown', e => { if (e.target.id === 'voicePanel') $('voicePanel').hidden = true; });
  $('voiceList').addEventListener('click', e => { const b = e.target.closest('[data-voice]'); if (b) pickVoice(b.dataset.voice); });

  // ---- text size, width and appearance (remembered on this device)
  const TYPE_DEFAULT = { size: 18, width: 'medium', theme: 'auto' };
  let typePrefs = (() => { try { return { ...TYPE_DEFAULT, ...JSON.parse(localStorage.getItem('readerPrefs') || '{}') }; } catch { return { ...TYPE_DEFAULT }; } })();
  const WIDTHS = { narrow: ['58ch', '680px'], medium: ['68ch', '760px'], wide: ['82ch', '920px'] };
  function applyType() {
    const root = document.documentElement;
    root.style.setProperty('--read-size', typePrefs.size + 'px');
    root.style.setProperty('--measure', WIDTHS[typePrefs.width][0]);
    root.style.setProperty('--reader-max', WIDTHS[typePrefs.width][1]);
    if (typePrefs.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = typePrefs.theme;
    $('sizeNow').textContent = typePrefs.size;
    document.querySelectorAll('#widthSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.width === typePrefs.width)));
    document.querySelectorAll('#themeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === typePrefs.theme)));
    try { localStorage.setItem('readerPrefs', JSON.stringify(typePrefs)); } catch {}
  }
  applyType();
  $('rType').onclick = e => {
    const menu = $('typeMenu');
    if (!menu.hidden) { menu.hidden = true; return; }
    hidePops(); placeNear(menu, e.currentTarget.getBoundingClientRect());
    const r = e.currentTarget.getBoundingClientRect();
    menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + 'px';
  };
  $('typeMenu').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.size) typePrefs.size = Math.max(14, Math.min(28, typePrefs.size + Number(b.dataset.size)));
    if (b.dataset.width) typePrefs.width = b.dataset.width;
    if (b.dataset.theme) typePrefs.theme = b.dataset.theme;
    applyType();
  });

  // ---- sharing
  let shareItem = null;
  function openShareMenu(anchor, it) {
    if (!it) return;
    // iPhone and iPad: the system share sheet (Messages, Mail, X, LinkedIn, Copy and the rest).
    if (IOS && navigator.share && isWeb(it.link)) {
      navigator.share({ title: it.title, url: it.link }).catch(e => { if (e?.name !== 'AbortError') status(msg(e), true); });
      return;
    }
    shareItem = it; hidePops();
    const menu = $('shareMenu'); placeNear(menu, anchor.getBoundingClientRect());
    const r = anchor.getBoundingClientRect(); // menus drop down, not up
    menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + 'px';
    menu.querySelector('button')?.focus();
  }
  async function share(kind) {
    const it = shareItem; $('shareMenu').hidden = true; if (!it || !isWeb(it.link)) return;
    const u = encodeURIComponent(it.link), t = encodeURIComponent(it.title);
    try {
      if (kind === 'x') await invoke('open_share', { url: `https://x.com/intent/post?text=${t}&url=${u}` });
      if (kind === 'linkedin') await invoke('open_share', { url: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` });
      if (kind === 'email') await invoke('open_external', { url: `mailto:?subject=${t}&body=${t}%0A%0A${u}` });
      if (kind === 'browser') await invoke('open_external', { url: it.link });
      if (kind === 'copy') {
        try { await navigator.clipboard.writeText(it.link); status('Link copied.'); }
        catch { status(`Couldn’t copy automatically. The link is ${it.link}`, true); }
      }
    } catch (e) { status(msg(e), true); }
  }
  $('shareMenu').addEventListener('click', e => { const b = e.target.closest('[data-share]'); if (b) share(b.dataset.share); });
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('.pop, .menu, [data-act="share"], #rShare, #rType, #rReply')) { $('shareMenu').hidden = true; $('replyMenu').hidden = true; $('notePop').hidden = true; $('typeMenu').hidden = true; }
  });

  // reader toolbar and article clicks
  $('rBack').onclick = () => closeReader();
  $('rSave').onclick = () => { const it = item(S.readerId); if (it) mark(it.id, { saved: !it.saved }); };
  $('rShare').onclick = e => openShareMenu(e.currentTarget, item(S.readerId));
  $('rReply').onclick = e => openReply(e.currentTarget);
  $('rOriginal').onclick = () => { const it = item(S.readerId); if (it) openWeb(it.link); };
  const step = d => { const list = visible().slice(0, S.shown), i = list.findIndex(x => x.id === S.readerId); const n = list[i + d]; if (n) openReader(n.id); };
  $('rPrev').onclick = () => step(-1);
  $('rNext').onclick = () => step(1);
  $('reader').addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); openWeb(a.href); return; }
    const m = e.target.closest('mark[data-h]');
    if (m && window.getSelection()?.isCollapsed) { openNoteEditor(Number(m.dataset.h)); return; }
    const j = e.target.closest('[data-jump]');
    if (j) $('rBody').querySelector(`mark[data-h="${j.dataset.jump}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // ------------------------------------------------------------ clicks
  document.addEventListener('click', e => {
    if (e.target.closest('.reader, .pop, .menu')) return; // the reader handles its own clicks
    // Every web link opens inside the app, in its web window.
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); openWeb(a.href); return; }

    const chev = e.target.closest('[data-chev]');
    if (chev) { const id = Number(chev.dataset.chev); collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); saveCollapsed(); renderRail(); return; }

    const v = e.target.closest('[data-view]');
    if (v) { closeReader(true); selectView(v.dataset.view); return; }
    const gf = e.target.closest('[data-guide-follow]');
    if (gf) { guideFollow(gf.dataset.guideFollow, gf); return; }
    if (e.target.id === 'guideMutes') { openMutes(); return; }
    if (e.target.id === 'welcomeX') { store.set('guideSeen', '1'); hideBanner(); return; }
    const dz = e.target.closest('[data-disc]');
    if (dz) { discoverAction(dz.dataset.disc, dz.dataset.domain); return; }
    if (e.target.id === 'briefClose') { store.set('briefHidden', new Date().toDateString()); renderList(); return; }
    if (e.target.id === 'briefShow') { store.set('briefHidden', ''); renderList(); return; }
    const op = e.target.closest('[data-open]');
    if (op) { openReader(op.dataset.open); return; }
    if (e.target.id === 'more') { S.shown += 60; renderList(); return; }
    if (e.target.id === 'removeFeed') return confirmRemove();
    if (e.target.id === 'renameFeed') return startRename();
    if (e.target.id === 'choosePeople') return openPeople();
    if (e.target.id === 'myFeedBtn') {
      const f = feedById(S.view); if (!f) return;
      const mineNow = myFeed()?.id === f.id;
      S.prefs.mine = mineNow ? 'none' : f.url; savePrefs();
      status(mineNow ? `${f.title} won’t show on Today as your site.` : `Today will show your latest post from ${f.title}.`);
      renderHead(); return;
    }
    if (e.target.id === 'renameFolder') return startRenameFolder();
    if (e.target.id === 'deleteFolder') return confirmDeleteFolder();

    const act = e.target.closest('[data-act]'); if (!act) return;
    const id = act.closest('.story, .h-card, .p-card').dataset.id, it = item(id); S.selId = id;
    if (act.dataset.act === 'open') openReader(id);
    if (act.dataset.act === 'share') openShareMenu(act, it);
    if (act.dataset.act === 'hidesrc') {
      const name = outletOf(it);
      S.prefs.hidden = [...new Set([...(S.prefs.hidden || []), name])];
      savePrefs(); renderMutes(); render();
      status(`Stories from ${name} are hidden. Undo in Muted words.`);
    }
    if (act.dataset.act === 'save') mark(id, { saved: !it.saved });
    if (act.dataset.act === 'read') mark(id, { read: !it.read });
  });

  // Drag a feed onto a folder (or onto "All" to take it out of its folder).
  let dragFeed = null;
  document.addEventListener('dragstart', e => { const b = e.target.closest?.('[data-feed]'); if (b) { dragFeed = Number(b.dataset.feed); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFeed)); } });
  document.addEventListener('dragend', () => { dragFeed = null; document.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });
  const dropTarget = e => {
    const t = e.target.closest?.('[data-view]'); if (!t || dragFeed == null) return null;
    if (t.dataset.view === 'all') return { el: t, folder: null };
    const m = /^folder:(\d+)$/.exec(t.dataset.view); return m ? { el: t, folder: Number(m[1]) } : null;
  };
  document.addEventListener('dragover', e => { const d = dropTarget(e); document.querySelectorAll('.drop').forEach(x => x !== d?.el && x.classList.remove('drop')); if (d) { e.preventDefault(); d.el.classList.add('drop'); } });
  document.addEventListener('drop', e => { const d = dropTarget(e); if (d) { e.preventDefault(); moveFeed(dragFeed, d.folder); } });

  $('fAll').onclick = () => { S.unreadOnly = false; S.shown = 60; render(); };
  $('fUnread').onclick = () => { S.unreadOnly = true; S.shown = 60; render(); };
  let qt; $('q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); S.shown = 60; renderList(); }, 150); });
  $('refresh').onclick = refresh;

  $('markAll').onclick = () => {
    const ids = visible().filter(i => !i.read).map(i => i.id);
    if (!ids.length) { status('Nothing unread here.'); return; }
    showBanner(`<span>Mark ${ids.length} ${ids.length === 1 ? 'story' : 'stories'} in ${esc(viewName())} as read?</span><button class="btn primary" id="yesAll">Mark read</button><button class="btn" id="noAll">Cancel</button>`, false, 'confirm');
    $('noAll').onclick = hideBanner;
    $('yesAll').onclick = () => { hideBanner(); mark(ids, { read: true }); status(`Marked ${ids.length} as read.`); };
  };

  // ------------------------------------------------------------ feeds and folders
  function inlineRename(current, onSave) {
    showBanner(`<input class="search" id="newName" value="${esc(current)}" aria-label="New name" style="flex:1;min-width:160px"><button class="btn primary" id="saveName">Rename</button><button class="btn" id="noName">Cancel</button>`, false, 'confirm');
    const input = $('newName'); input.focus(); input.select();
    $('noName').onclick = hideBanner;
    const go = async () => { const v = input.value.trim(); if (!v) return; hideBanner(); try { await onSave(v); load(); } catch (e) { status(msg(e), true); } };
    $('saveName').onclick = go;
    input.onkeydown = ev => { if (ev.key === 'Enter') go(); if (ev.key === 'Escape') hideBanner(); };
  }
  function startRename() { const f = feedById(S.view); if (f) inlineRename(f.title, title => invoke('rename_feed', { id: f.id, title })); }
  function startRenameFolder() { const f = folderOf(S.view); if (f) inlineRename(f.name, name => invoke('rename_folder', { id: f.id, name })); }

  function confirmRemove() {
    const f = feedById(S.view); if (!f) return;
    showBanner(`<span>Unfollow ${esc(f.title)}? Its stories leave your reader too, including ones saved for later.</span><button class="btn danger" id="yesRemove">Unfollow</button><button class="btn" id="noRemove">Cancel</button>`, false, 'confirm');
    $('noRemove').onclick = hideBanner;
    $('yesRemove').onclick = async () => {
      hideBanner();
      try { await invoke('remove_feed', { id: f.id }); S.view = 'all'; status(`Unfollowed ${f.title}.`); load(); }
      catch (e) { status(msg(e), true); }
    };
  }
  function confirmDeleteFolder() {
    const f = folderOf(S.view); if (!f) return;
    const n = S.feeds.filter(x => x.folder_id === f.id).length;
    showBanner(`<span>Delete the ${esc(f.name)} folder? ${n ? `Its ${n} ${n === 1 ? 'feed stays' : 'feeds stay'} in your reader, just outside any folder.` : 'It has no feeds in it.'}</span><button class="btn danger" id="yesDel">Delete folder</button><button class="btn" id="noDel">Cancel</button>`, false, 'confirm');
    $('noDel').onclick = hideBanner;
    $('yesDel').onclick = async () => {
      hideBanner();
      try { await invoke('delete_folder', { id: f.id }); S.view = 'all'; status(`Deleted the ${f.name} folder.`); load(); }
      catch (e) { status(msg(e), true); }
    };
  }

  // new folder
  function openNewFolder() { $('folderForm').hidden = false; $('folderName').value = ''; $('folderName').focus(); }
  $('newFolderBtn').onclick = () => $('folderForm').hidden ? openNewFolder() : ($('folderForm').hidden = true);
  $('folderName').onkeydown = e => { if (e.key === 'Escape') $('folderForm').hidden = true; };
  $('folderForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('folderName').value.trim(); if (!name) return;
    try {
      const id = await invoke('create_folder', { name });
      $('folderForm').hidden = true; status(`Created ${name}. Drag feeds onto it, or pick it from a feed’s folder menu.`);
      await load(); selectView('folder:' + id);
    } catch (err) { status(msg(err), true); }
  });

  // add a feed
  function renderAddFolders() {
    const sel = $('feedFolder'); if (!sel || !$('addForm').hidden) return;
    const current = folderOf(S.view)?.id ?? feedById(S.view)?.folder_id ?? null;
    sel.innerHTML = folderOptions(current); sel.hidden = !S.folders.length;
  }
  function openAdd() { renderAddFolders(); $('addForm').hidden = false; $('showAdd').hidden = true; $('feedUrl').focus(); }
  $('showAdd').onclick = openAdd;
  $('cancelAdd').onclick = () => { $('addForm').hidden = true; $('showAdd').hidden = false; };
  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const note = $('addNote'), btn = $('addBtn');
    btn.disabled = true; btn.textContent = 'Finding feed…'; note.className = 'note'; note.textContent = 'Checking that address…';
    try {
      const folderId = $('feedFolder').value ? Number($('feedFolder').value) : null;
      const r = await invoke('add_feed', { url: $('feedUrl').value.trim(), title: $('feedName').value.trim() || null, folderId });
      $('feedUrl').value = ''; $('feedName').value = '';
      note.textContent = `Now following ${r.title}.`;
      await load(); selectView(r.id);
    } catch (err) { note.className = 'note err'; note.textContent = msg(err); }
    finally { btn.disabled = false; btn.textContent = 'Add feed'; }
  });

  // OPML
  async function importOpml() {
    try {
      const n = await invoke('import_opml');
      if (n) status(`Added ${n} ${n === 1 ? 'feed' : 'feeds'}, with their folders. Pulling their stories now.`);
      load();
    } catch (e) { status(msg(e), true); }
  }
  renderMutes();
  async function exportOpml() {
    try { if (await invoke('export_opml')) status('Saved your subscription list.'); }
    catch (e) { status(msg(e), true); }
  }
  $('importBtn').onclick = importOpml;
  $('exportBtn').onclick = exportOpml;

  // ------------------------------------------------------------ muted words
  function renderMutes() {
    $('muteList').innerHTML = S.mutes.length
      ? S.mutes.map((w, i) => `<span class="chip">${esc(w)}<button type="button" data-unmute="${i}" aria-label="Unmute ${esc(w)}">×</button></span>`).join('')
      : '<span class="note">Nothing muted yet.</span>';
    const hidden = S.prefs.hidden || [];
    $('hiddenList').innerHTML = hidden.length
      ? hidden.map((w, i) => `<span class="chip">${esc(w)}<button type="button" data-unhide="${i}" aria-label="Show ${esc(w)} again">×</button></span>`).join('')
      : '<span class="note">None. Use the ⊘ button on a news-search story to hide its website.</span>';
    const n = S.mutes.length + hidden.length;
    $('muteBtn').textContent = n ? `Muted words (${n})` : 'Muted words';
  }
  async function saveMutes(words) {
    try { S.mutes = await invoke('set_mutes', { words }); buildMutes(); renderMutes(); render(); }
    catch (e) { status(msg(e), true); }
  }
  function openMutes() { renderMutes(); $('mutePanel').hidden = false; $('muteInput').focus(); }
  $('muteBtn').onclick = openMutes;
  $('muteClose').onclick = () => { $('mutePanel').hidden = true; };
  $('mutePanel').addEventListener('mousedown', e => { if (e.target.id === 'mutePanel') $('mutePanel').hidden = true; });
  $('muteForm').addEventListener('submit', e => {
    e.preventDefault();
    const w = $('muteInput').value.trim(); if (!w) return;
    $('muteInput').value = ''; saveMutes([...S.mutes, w]);
  });
  $('hiddenList').addEventListener('click', e => {
    const b = e.target.closest('[data-unhide]'); if (!b) return;
    S.prefs.hidden = (S.prefs.hidden || []).filter((_, i) => i !== Number(b.dataset.unhide));
    savePrefs(); renderMutes(); render();
  });
  $('muteList').addEventListener('click', e => {
    const b = e.target.closest('[data-unmute]'); if (!b) return;
    saveMutes(S.mutes.filter((_, i) => i !== Number(b.dataset.unmute)));
  });

  // keyboard (⌘R, ⌘N, ⇧⌘N, ⌘[ come from the app menu)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('wxPanel').hidden) { $('wxPanel').hidden = true; return; } if (!$('voicePanel').hidden) { $('voicePanel').hidden = true; return; } if (!$('mutePanel').hidden) { $('mutePanel').hidden = true; return; } if (!$('syncPanel').hidden) { closeSync(); return; } if (hidePops()) return; if (S.readerId) { closeReader(); return; } }
    if (!$('syncPanel').hidden) return;
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const list = visible().slice(0, S.shown);
    const cur = S.readerId || S.selId;
    let i = list.findIndex(x => x.id === cur);
    if (e.key === 'j' || e.key === 'k') {
      if (!list.length) return;
      i = e.key === 'j' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      if (S.readerId) { openReader(list[i].id); return; }
      S.selId = list[i].id; renderList();
      document.querySelector(`.story[data-id="${CSS.escape(S.selId)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !S.readerId && S.selId) { openReader(S.selId); }
    else if (cur && e.key === 's') { const it = item(cur); if (it) mark(it.id, { saved: !it.saved }); }
    else if (cur && e.key === 'm') { const it = item(cur); if (it) mark(it.id, { read: !it.read }); }
    else if (cur && e.key === 'o') { const it = item(cur); if (it && isWeb(it.link)) openWeb(it.link); }
  });


  // ------------------------------------------------------------ sync between Macs
  let sync = null;
  function renderSyncButton() {
    if (!sync) return;
    $('syncDot').className = 'dot' + (sync.error ? ' err' : sync.on ? ' on' : '');
    $('syncLabel').textContent = !sync.on ? (IOS ? 'Sync with your Macs: off' : 'Sync between Macs: off')
      : sync.error ? 'Sync needs attention'
      : sync.lastSync ? `Synced ${ago(sync.lastSync) === 'now' ? 'just now' : ago(sync.lastSync) + ' ago'}` : 'Syncing…';
  }
  function renderSyncPanel() {
    if (!sync || $('syncPanel').hidden) return;
    const body = $('syncBody');
    $('syncTitle').textContent = IOS ? 'Sync with your Macs' : 'Sync between your Macs';
    if (!sync.on && IOS) {
      body.innerHTML = `
        <p>Keep your feeds, folders, read and Read later stories, highlights and notes the same here and on your Macs.</p>
        <ol class="steps">
          <li>Tap <strong>Choose the sync folder</strong>.</li>
          <li>In the Files window, tap <strong>iCloud Drive</strong>, then the <strong>The Reading Room</strong> folder your Macs use.</li>
          <li>Tap <strong>Open</strong>.</li>
        </ol>
        <div class="row"><button class="btn primary" id="syncICloud">Choose the sync folder</button></div>
        <p class="note">No folder yet? Turn on sync on a Mac first (Feeds › Sync Between Macs). Picking iCloud Drive itself also works: the app makes the folder.</p>`;
      $('syncICloud').onclick = () => syncAction('sync_use_icloud');
      return;
    }
    if (!sync.on) {
      body.innerHTML = `
        <p>Keep your feeds, folders, read and Read later stories, highlights and notes the same on all your Macs. Each Mac still downloads the stories itself.</p>
        <div class="row">
          <button class="btn primary" id="syncICloud" ${sync.icloudAvailable ? '' : 'disabled'}>Sync with iCloud Drive</button>
          <button class="btn" id="syncPick">Choose another folder…</button>
        </div>
        ${sync.icloudAvailable ? '' : '<p class="note err">iCloud Drive is off for this Mac. Turn it on in System Settings › your name › iCloud › iCloud Drive.</p>'}
        <p>Then do the same on your other Mac, so both use the same folder.</p>`;
      $('syncICloud').onclick = () => syncAction('sync_use_icloud');
      $('syncPick').onclick = () => syncAction('sync_choose_folder');
      return;
    }
    const peers = sync.peers.length
      ? sync.peers.map(p => `<span class="peer">${esc(p.name)} <small>· updated ${esc(ago(p.lastSeen) === 'now' ? 'just now' : ago(p.lastSeen) + ' ago')}</small></span>`).join('')
      : '<span class="peer"><small>None yet. Turn on sync on your other Mac and pick this same folder.</small></span>';
    body.innerHTML = `
      <dl class="facts">
        <dt>Folder</dt><dd>${esc(sync.label || sync.folder)}</dd>
        <dt>${IOS ? 'This device' : 'This Mac'}</dt><dd>${esc(sync.thisMac)}</dd>
        <dt>${IOS ? 'Your Macs' : 'Other Macs'}</dt><dd>${peers}</dd>
        <dt>Last synced</dt><dd>${sync.lastSync ? esc(ago(sync.lastSync) === 'now' ? 'Just now' : ago(sync.lastSync) + ' ago') : 'Not yet'}</dd>
      </dl>
      ${sync.error ? `<p class="note err">${esc(sync.error)}</p>` : ''}
      <p>Changes sync within about half a minute while the app is open.</p>
      <div class="row">
        <button class="btn primary" id="syncNowBtn">Sync now</button>
        <button class="btn" id="syncOff">Turn off sync</button>
      </div>`;
    $('syncNowBtn').onclick = () => syncAction('sync_now');
    $('syncOff').onclick = () => syncAction('sync_turn_off', IOS ? 'Sync is off here. Your stories stay on this device.' : 'Sync is off for this Mac. Your stories stay here.');
  }
  async function loadSync() { try { sync = await invoke('sync_status');
    const names = [sync.thisMac, ...(sync.peers || []).map(p => p.name)].join('|');
    const m = /(?:^|\|)([A-Z][\p{L}-]{1,20})[’']s\s/u.exec(names);
    if (m && m[1] !== ownerName) { ownerName = m[1]; if (S.view === 'today') renderList(); } renderSyncButton(); renderSyncPanel(); } catch {} }
  async function syncAction(cmd, done) {
    try {
      const s = await invoke(cmd);
      if (s) { sync = s; renderSyncButton(); renderSyncPanel(); if (done) status(done); load(); }
    } catch (e) {
      $('syncBody').insertAdjacentHTML('beforeend', `<p class="note err">${esc(msg(e))}</p>`);
    }
  }
  function openSync() { $('syncPanel').hidden = false; renderSyncPanel(); loadSync(); $('syncClose').focus(); }
  function closeSync() { $('syncPanel').hidden = true; }
  $('syncBtn').onclick = openSync;
  $('syncClose').onclick = closeSync;
  $('syncPanel').addEventListener('mousedown', e => { if (e.target.id === 'syncPanel') closeSync(); });
  listen('sync-changed', loadSync);
  // Opening the app (or switching back to it) and leaving it both sync right away. On iPhone and iPad the app
  // is paused soon after you leave, so this is what gets your last changes to your other devices.
  // Coming back to the app after a while: check the feeds (iPhone and iPad don't run the app in the background).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || S.refreshing) return;
    const last = S.lastRefresh ? new Date(S.lastRefresh).getTime() : 0;
    if (Date.now() - last > 15 * 60 * 1000) refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!sync?.on) return;
    invoke('sync_now').then(s => { sync = s; renderSyncButton(); renderSyncPanel(); }).catch(() => {});
  });
  listen('menu-sync', openSync);
  setInterval(renderSyncButton, 30 * 1000);
  loadSync();

  // ------------------------------------------------------------ iPhone gestures
  $('toFeeds').onclick = () => { hidePops(); setScreen('feeds'); };
  // Swipe in from the left edge to go back: article → stories → feeds.
  let swipe = null;
  document.addEventListener('touchstart', e => {
    if (!isPhone() || e.touches.length !== 1) return;
    const t = e.touches[0];
    swipe = t.clientX < 28 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!swipe) return;
    const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = Math.abs(t.clientY - swipe.y);
    swipe = null;
    if (dx < 70 || dy > 60) return;
    if (document.body.dataset.screen === 'reader') closeReader();
    else if (document.body.dataset.screen === 'list') setScreen('feeds');
  }, { passive: true });
  // Pull the story list down from the top to refresh.
  let pullY = null;
  const mainEl = $('main');
  mainEl.addEventListener('touchstart', e => {
    pullY = isPhone() && document.body.dataset.screen === 'list' && mainEl.scrollTop <= 0 ? e.touches[0].clientY : null;
  }, { passive: true });
  mainEl.addEventListener('touchmove', e => {
    if (pullY == null) return;
    const d = e.touches[0].clientY - pullY;
    $('pull').classList.toggle('show', d > 20);
    $('pull').textContent = d > 80 ? 'Release to refresh' : 'Pull to refresh';
  }, { passive: true });
  mainEl.addEventListener('touchend', e => {
    if (pullY == null) return;
    const d = e.changedTouches[0].clientY - pullY; pullY = null;
    $('pull').classList.remove('show');
    if (d > 80) refresh();
  }, { passive: true });
  phoneSize.addEventListener('change', () => { if (!isPhone()) return; setScreen(S.readerId ? 'reader' : 'list'); });

  // Swipe a story: right to save it for later, left to mark it read (or unread), like Mail.
  let sw = null;
  const SW_GO = 90;
  $('list').addEventListener('touchstart', e => {
    if (!IOS || e.touches.length !== 1) return;
    const story = e.target.closest('.story'), t = e.touches[0];
    if (!story || t.clientX < 28) return; // the left edge is for going back
    sw = { story, x: t.clientX, y: t.clientY, dx: 0, on: false, bg: null };
  }, { passive: true });
  $('list').addEventListener('touchmove', e => {
    if (!sw) return;
    const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // scrolling
      if (Math.abs(dx) < 12) return;
      sw.on = true;
      const it = item(sw.story.dataset.id);
      sw.bg = document.createElement('div');
      sw.bg.className = 'swipe-bg';
      sw.bg.style.top = sw.story.offsetTop + 'px'; sw.bg.style.height = sw.story.offsetHeight + 'px';
      sw.bg.innerHTML = `<span class="l">${it?.saved ? 'Unsave' : 'Read later'}</span><span class="r">${it?.read ? 'Unread' : 'Read'}</span>`;
      sw.story.parentElement.insertBefore(sw.bg, sw.story);
      sw.story.classList.add('swiping');
    }
    e.preventDefault();
    sw.dx = Math.max(-160, Math.min(160, dx));
    sw.story.style.transform = `translateX(${sw.dx}px)`;
    sw.bg.dataset.side = sw.dx > 0 ? 'save' : 'read';
    sw.bg.classList.toggle('go', Math.abs(sw.dx) >= SW_GO);
  }, { passive: false });
  const endSwipe = () => {
    if (!sw) return;
    const { story, dx, bg, on } = sw; sw = null;
    if (!on) return;
    story.style.transition = 'transform .18s ease'; story.style.transform = '';
    setTimeout(() => { story.style.transition = ''; story.classList.remove('swiping'); bg?.remove(); }, 200);
    const it = item(story.dataset.id); if (!it) return;
    if (dx >= SW_GO) mark(it.id, { saved: !it.saved });
    else if (dx <= -SW_GO) { S.keep.add(it.id); mark(it.id, { read: !it.read }); }
  };
  $('list').addEventListener('touchend', endSwipe, { passive: true });
  $('list').addEventListener('touchcancel', endSwipe, { passive: true });

  // events from the app: refresh finished, menu items
  listen('state-changed', load);
  listen('menu-refresh', refresh);
  listen('menu-add-feed', openAdd);
  listen('menu-new-folder', openNewFolder);
  listen('menu-import', importOpml);
  listen('menu-export', exportOpml);
  listen('menu-back', () => closeReader());
  listen('menu-help', () => { closeReader(true); selectView('guide'); });
  listen('menu-forward', () => {});
  listen('menu-browser', () => { const it = item(S.readerId || S.selId); if (it && isWeb(it.link)) invoke('open_external', { url: it.link }); });
  setInterval(renderHead, 60 * 1000); // keep "Checked 5m ago" current

  // ------------------------------------------------------------ Today: clock and date, and the pinned top bar
  function tick() {
    const now = new Date();
    // Hours and minutes, then the seconds a little lighter so they tick without shouting.
    const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).formatToParts(now);
    $('clockTime').innerHTML = parts.map(p => p.type === 'second' ? `<span class="sec">${p.value}</span>`
      : p.type === 'dayPeriod' ? `<span class="ampm">${p.value}</span>` : esc(p.value)).join('');
    $('clockDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('clock').hidden = S.view !== 'today';
  }
  tick(); setInterval(tick, 1000);
  // ---- weather under the date (Open-Meteo, for the town you choose)
  const WX = [[[0], '☀️', '🌙', 'Clear'], [[1], '🌤️', '🌙', 'Mostly clear'], [[2], '⛅', '☁️', 'Partly cloudy'], [[3], '☁️', '☁️', 'Cloudy'],
    [[45, 48], '🌫️', '🌫️', 'Fog'], [[51, 53, 55, 56, 57], '🌦️', '🌧️', 'Drizzle'], [[61, 63, 65, 66, 67], '🌧️', '🌧️', 'Rain'],
    [[71, 73, 75, 77], '🌨️', '🌨️', 'Snow'], [[80, 81, 82], '🌦️', '🌧️', 'Showers'], [[85, 86], '🌨️', '🌨️', 'Snow showers'], [[95, 96, 99], '⛈️', '⛈️', 'Thunderstorms']];
  const useF = /-(US|LR|MM)$/i.test(navigator.language || 'en-US') || !/-/.test(navigator.language || '');
  const wxPlace = () => { try { return JSON.parse(store.get('weatherPlace') || 'null'); } catch { return null; } };
  let wxData = (() => { try { return JSON.parse(store.get('weatherNow') || 'null'); } catch { return null; } })();
  function paintWeather() {
    const place = wxPlace(), el = $('wx');
    if (!place) { el.innerHTML = '<span class="wx-add">Add weather</span>'; el.title = 'Show the weather for your town'; return; }
    if (!wxData || wxData.key !== `${place.lat},${place.lon}`) { el.textContent = place.name; return; }
    const w = WX.find(([codes]) => codes.includes(Number(wxData.code))) || [[], '🌡️', '🌡️', ''];
    const r = n => Math.round(Number(n));
    el.innerHTML = `<span class="wx-i" aria-hidden="true">${wxData.day === 0 ? w[2] : w[1]}</span><b>${r(wxData.temp)}°</b> ${esc(w[3])}<span class="wx-hl"> · H ${r(wxData.high)}° L ${r(wxData.low)}°</span>`;
    el.title = `${place.label}. Click to change.`;
  }
  async function loadWeather(force) {
    const place = wxPlace(); if (!place) { paintWeather(); return; }
    const key = `${place.lat},${place.lon}`;
    if (!force && wxData && wxData.key === key && Date.now() - wxData.at < 30 * 60 * 1000) { paintWeather(); return; }
    try {
      const w = await invoke('weather_now', { lat: place.lat, lon: place.lon, fahrenheit: useF });
      wxData = { ...w, key, at: Date.now() }; store.set('weatherNow', JSON.stringify(wxData));
    } catch {}
    paintWeather();
  }
  function openWeather() {
    $('wxResults').innerHTML = ''; $('wxInput').value = wxPlace()?.label || '';
    $('wxRemove').hidden = !wxPlace(); $('wxPanel').hidden = false; $('wxInput').focus(); $('wxInput').select();
  }
  $('wx').onclick = openWeather;
  $('wxClose').onclick = () => { $('wxPanel').hidden = true; };
  $('wxPanel').addEventListener('mousedown', e => { if (e.target.id === 'wxPanel') $('wxPanel').hidden = true; });
  $('wxRemove').onclick = () => { store.set('weatherPlace', ''); wxData = null; store.set('weatherNow', ''); paintWeather(); $('wxPanel').hidden = true; };
  let wxFound = [];
  $('wxForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('wxResults').innerHTML = '<p class="note">Looking…</p>';
    try {
      wxFound = await invoke('weather_place', { query: $('wxInput').value });
      $('wxResults').innerHTML = wxFound.map((p, i) => `<button type="button" class="voice" data-place="${i}"><span class="v-name">${esc(p.label)}</span></button>`).join('');
    } catch (err) { $('wxResults').innerHTML = `<p class="note err">${esc(msg(err))}</p>`; }
  });
  $('wxResults').addEventListener('click', e => {
    const b = e.target.closest('[data-place]'); if (!b) return;
    const p = wxFound[Number(b.dataset.place)];
    store.set('weatherPlace', JSON.stringify({ name: p.name, label: p.label, lat: p.lat, lon: p.lon }));
    $('wxPanel').hidden = true; loadWeather(true);
  });
  loadWeather();
  setInterval(() => loadWeather(), 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadWeather(); });

  // A thin line under the top bar once stories are scrolling beneath it.
  const scrollerOf = () => (isSplit() ? $('listView') : $('main'));
  const markStuck = () => $('listTop').classList.toggle('stuck', scrollerOf().scrollTop > 4);
  $('main').addEventListener('scroll', markStuck, { passive: true });
  $('listView').addEventListener('scroll', markStuck, { passive: true });
  load();
})();
