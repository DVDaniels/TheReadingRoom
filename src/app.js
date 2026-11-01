// The Reading Room — the window's behaviour. Talks to the Rust side through Tauri commands.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  const $ = id => document.getElementById(id);
  // view: 'today' | 'all' | 'saved' | 'annotated' | 'recent' | 'folder:<id>' | <feed id number>
  const S = { prefs: {}, kinds: new Map(), folders: [], feeds: [], items: [], highlights: [], mutes: [], also: new Map(), hiddenMuted: 0, readerId: null, view: 'today', unreadOnly: true, keep: new Set(), selId: null, q: '', shown: 60, refreshing: false, lastRefresh: null };
  // Mastodon and Bluesky (see that section)
  const SOC = { accounts: {}, conv: null, loading: false, open: new Set(), threads: new Map(), err: [], tab: 'shared', profiles: null, followers: null, shared: null, mentions: null, readers: null, theirBlogs: null };
  const NET = { bluesky: 'Bluesky', mastodon: 'Mastodon' };
  const anySocial = () => !!(SOC.accounts.bluesky || SOC.accounts.mastodon);
  const socialSeen = () => { try { return Number(localStorage.getItem('socialSeen')) || 0; } catch { return 0; } };
  const newReplies = () => (SOC.conv?.replies || []).filter(r => Date.parse(r.created_at) > socialSeen()).length;
  // Discover's results (see the Discover section)
  const D = { report: null, running: false, done: 0, total: 0, open: new Set(), busy: new Set(), q: '', searching: false, res: null, added: new Map(), imgs: new Map() };
  const ICONS = {
    jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/></svg>',
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
    talk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5" stroke-linecap="round"/></svg>',
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
    if (view === 'jobs') return isJobItem(i);
    if ((view === 'all' || view === 'today' || view === 'people') && isJobItem(i)) return false;
    if (view === 'all') return true;
    if (view === 'today') return isToday(i);
    if (view === 'saved') return i.saved;
    if (view === 'recent') return !!i.read_at;
    if (view === 'annotated') return S.highlights.some(h => h.item_id === i.id);
    if (view === 'discover' || view === 'guide' || view === 'talk') return false;
    if (view === 'people') return isPerson(i.feed_id);
    const folder = folderOf(view);
    if (folder) { const f = feedById(i.feed_id); return !!f && f.folder_id === folder.id; }
    return String(i.feed_id) === String(view);
  }
  const usesUnreadFilter = () => !['saved', 'recent', 'annotated', 'discover', 'guide', 'talk', 'jobs'].includes(S.view);
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
      isSocialFeed(f) ? 'person' : isJobFeed(f) || isNewsSearch(f) || (f.recent || 0) > PER_PERSON || OUTLET.test(f.title || '') ? 'pub' : 'person']));
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

  // ---- one person, several feeds. Someone's blog, their Mastodon and their Bluesky are the same person when their
  // site says so (rel="me" links, fediverse:creator) or their Bluesky handle is their own domain.
  const hostOfU = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  const bareHost = h => h.replace(/^(blog|www|en)\./, '');
  const socialNet = f => /bsky\.app\/profile\//.test(f?.url || '') ? 'bluesky' : isSocialFeed(f) ? 'mastodon' : '';
  const profileOf = f => (f.url || '').replace(/\/rss$/, '').replace(/\.rss$/, '');
  const siteOf = f => { try { return new URL(isWeb(f.site) ? f.site : f.url).origin + '/'; } catch { return ''; } };
  let PL = (() => { try { return JSON.parse(store.get('plinks') || '{}') || {}; } catch { return {}; } })(); // site → {at, links}
  let PV = 0; // bumps when the people map changes
  function buildPersons() {
    S.personOf = new Map(); S.alsoFeeds = new Map();
    const blogs = S.feeds.filter(f => !isSocialFeed(f) && !isNewsSearch(f));
    const byHost = new Map(), byProfile = new Map();
    for (const b of blogs) for (const h of [hostOfU(b.site), hostOfU(b.url)]) if (h) { byHost.set(h, b); if (!byHost.has(bareHost(h))) byHost.set(bareHost(h), b); }
    for (const b of blogs) for (const l of (PL[siteOf(b)]?.links || [])) byProfile.set(l.url.toLowerCase().replace(/\/$/, ''), b);
    for (const f of S.feeds) {
      if (!isSocialFeed(f)) continue;
      let b = byProfile.get(profileOf(f).toLowerCase());
      if (!b && socialNet(f) === 'bluesky') {
        const h = (f.url.split('/profile/')[1] || '').split('/')[0].toLowerCase();
        if (h.includes('.') && !h.endsWith('.bsky.social')) b = byHost.get(h) || byHost.get(bareHost(h));
      }
      if (b) { S.personOf.set(f.id, b.id); if (!S.alsoFeeds.has(b.id)) S.alsoFeeds.set(b.id, []); S.alsoFeeds.get(b.id).push(f); }
    }
    PV++;
  }
  const personId = feedId => S.personOf?.get(feedId) || feedId;
  // Look at the sites of the people you read (once a week each) for their Mastodon and Bluesky accounts
  let scanningSites = false;
  async function scanSites() {
    if (scanningSites) return;
    const weekAgo = Date.now() - 7 * DAY;
    const sites = [...new Set(S.feeds.filter(f => !isSocialFeed(f) && !isNewsSearch(f) && kindOf(f) === 'person').map(siteOf).filter(Boolean))]
      .filter(site => !(PL[site]?.at > weekAgo));
    if (!sites.length) return;
    scanningSites = true;
    try {
      const res = await invoke('site_accounts', { sites });
      for (const r of res) PL[r.site] = { at: Date.now(), links: r.links };
      store.set('plinks', JSON.stringify(PL));
      buildPersons(); render();
      if (S.view === 'talk') loadReaders();
    } catch {} finally { scanningSites = false; }
  }

  // ---- POSSE copies: a toot or skeet that only shares a post you already get from the writer's blog folds into it.
  // Someone else sharing it with a few words of their own stays; a bare share by someone else folds too.
  const normU = u => (u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  let FOLD = { items: null };
  function folds() {
    if (FOLD.items === S.items && FOLD.feeds === S.feeds && FOLD.pv === PV) return FOLD;
    const idx = new Map();
    for (const i of S.items) { const f = feedById(i.feed_id); if (f && !isSocialFeed(f) && i.link) idx.set(normU(i.link), i); }
    const keys = [...idx.keys()], hidden = new Map(), on = new Map();
    for (const c of S.items) {
      const sf = feedById(c.feed_id);
      if (!c.shares || !sf || !isSocialFeed(sf)) continue;
      const k = normU(c.shares);
      let orig = idx.get(k);
      if (!orig && !/^https?:/i.test(c.shares) && k.length > 8) { const hit = keys.find(x => x.startsWith(k)); if (hit) orig = idx.get(hit); }
      if (!orig) continue;
      const same = personId(sf.id) === orig.feed_id;
      if (!same) {
        const extra = (c.summary || '').replace(/(https?:\/\/)?[\w-]+(\.[\w-]+)+\/\S*/g, '').replace(orig.title || '', '').replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
        if (extra.length > 40) continue;
      }
      hidden.set(c.id, orig.id);
      if (!on.has(orig.id)) on.set(orig.id, []);
      on.get(orig.id).push({ item: c, feed: sf, same });
    }
    FOLD = { items: S.items, feeds: S.feeds, pv: PV, hidden, on };
    return FOLD;
  }
  const foldsIn = view => !(typeof view === 'number' && isSocialFeed(feedById(view)));
  const isFolded = (i, view = S.view) => foldsIn(view) && folds().hidden.has(i.id);

  function visible() {
    let list = S.items.filter(i => inScope(i));
    if (foldsIn(S.view)) { const F = folds(); list = list.filter(i => !F.hidden.has(i.id)); }
    S.hiddenMuted = 0;
    if (mutesApply()) { const before = list.length; list = list.filter(i => !isMuted(i)); S.hiddenMuted = before - list.length; }
    if (S.unreadOnly && usesUnreadFilter()) list = list.filter(i => !i.read || S.keep.has(i.id));
    if (S.q) { const q = S.q.toLowerCase(); list = list.filter(i => (i.title + ' ' + i.summary).toLowerCase().includes(q)); }
    if (S.view === 'recent') list = [...list].sort((a, b) => (b.read_at || '').localeCompare(a.read_at || ''));
    else if (usesUnreadFilter()) list = collapseDuplicates(list);
    else S.also = new Map();
    return list;
  }
  const unreadIn = view => S.items.filter(i => !i.read && inScope(i, view) && !(mutesApply(view) && isMuted(i)) && !isFolded(i, view)).length;

  // ------------------------------------------------------------ render: sidebar
  function navButton(view, label, count, { icon = '', fav = null, err = '', title = '' } = {}) {
    const lead = icon ? `<span class="navicon">${icon}</span>`
      : fav ? `<span class="fav" style="background:hsl(${hueFor(fav.url)} 45% 42%)">${esc((fav.title || '?').trim()[0] || '?')}</span>` : '';
    const tail = err ? '<span class="err" aria-label="Problem with this feed"></span>' : `<span class="count">${fmtCount(count)}</span>`;
    return `<button data-view="${esc(String(view))}" aria-current="${String(S.view) === String(view)}" title="${esc(title)}"${fav ? ` draggable="true" data-feed="${fav.id}"` : ''}>${lead}<span class="name">${esc(label)}</span>${tail}</button>`;
  }
  const feedButton = f => navButton(f.id, f.title, unreadIn(f.id), { fav: f, err: f.status === 'error', title: f.status === 'error' ? f.error : f.url });

  function renderRail() {
    // Read · Find and talk · Your library
    $('views').innerHTML =
      navButton('today', 'Today', unreadIn('today'), { icon: ICONS.today }) +
      navButton('people', 'People', unreadIn('people'), { icon: ICONS.people }) +
      '<hr class="nav-gap">' +
      navButton('discover', 'Discover', newSuggestions() || '', { icon: ICONS.discover }) +
      (anySocial() ? navButton('talk', 'Conversations', newReplies() || '', { icon: ICONS.talk }) : '') +
      '<hr class="nav-gap">' +
      navButton('saved', 'Read later', S.items.filter(i => i.saved).length, { icon: ICONS.later }) +
      navButton('annotated', 'Annotated', new Set(S.highlights.map(h => h.item_id)).size, { icon: ICONS.notes }) +
      navButton('recent', 'Recently read', '', { icon: ICONS.recent }) +
      '<hr class="nav-gap">' +
      navButton('jobs', 'Help Wanted', newJobs() || '', { icon: ICONS.jobs });

    let html = navButton('all', 'All', unreadIn('all'), { icon: ICONS.all });
    for (const folder of S.folders) {
      const open = !collapsed.has(folder.id);
      const inside = S.feeds.filter(f => f.folder_id === folder.id && !isJobFeed(f));
      html += `<div class="folder" data-folder="${folder.id}">
          <button class="chev" data-chev="${folder.id}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(folder.name)}">${ICONS.chev}</button>
          ${navButton('folder:' + folder.id, folder.name, unreadIn('folder:' + folder.id))}
        </div>`;
      if (open) html += `<div class="infolder" data-folder="${folder.id}">${inside.map(feedButton).join('') || '<span class="note" style="padding:2px 0 6px 34px;display:block">Drag feeds here</span>'}</div>`;
    }
    const loose = S.feeds.filter(f => (!f.folder_id || !folderById(f.folder_id)) && !isJobFeed(f));
    if (loose.length && S.folders.length) html += '<hr>';
    html += loose.map(feedButton).join('');
    if (!S.feeds.length) html += '<span class="note" style="padding:0 10px">No feeds yet. Add one below.</span>';
    $('feeds').innerHTML = html;
  }

  // ------------------------------------------------------------ render: header
  function viewName() {
    const names = { today: 'Today', all: 'All stories', saved: 'Read later', annotated: 'Annotated', recent: 'Recently read', discover: 'Discover', people: 'People', guide: 'How to use The Reading Room', talk: 'Conversations', jobs: 'Help Wanted' };
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
      : S.view === 'jobs' ? jobsSub()
      : S.view === 'talk' ? `What the people you follow share, and your conversations on ${['bluesky', 'mastodon'].filter(n => SOC.accounts[n]).map(n => NET[n]).join(' and ')}`
      : `${unreadIn(S.view)} unread`;
    const muted = S.hiddenMuted ? ` · ${S.hiddenMuted} muted` : '';
    $('viewSub').textContent = ['discover', 'guide', 'talk'].includes(S.view) ? lead : S.view === 'jobs' ? `${lead} · ${when}` : `${lead}${muted} · ${when}`;
    document.body.classList.toggle('discover-view', ['discover', 'guide', 'talk', 'jobs'].includes(S.view));
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
        ${anySocial() ? followButtons(f) : ''}
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
    } else if (S.view === 'talk' && anySocial()) {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn primary" data-talk="newpost">New post</button><button class="btn" data-talk="tab" data-tab="${SOC.tab || 'shared'}" id="talkRefresh">Check again</button>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'jobs') {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" data-job="manage">Manage job feeds</button>`;
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
    let out = '';
    const names = [...new Set(S.also.get(it.id) || [])].filter(Boolean);
    if (names.length) {
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');
      out += `<div class="also">Also from ${esc(shown)}</div>`;
    }
    const copies = foldsIn(S.view) ? folds().on.get(it.id) || [] : [];
    if (copies.length) {
      const own = copies.filter(c => c.same), others = copies.filter(c => !c.same);
      const chip = c => `<button class="also-on" data-open="${esc(c.item.id)}" title="Open the ${NET[socialNet(c.feed)]} post">${ICON_NET[socialNet(c.feed)]}${esc(c.same ? NET[socialNet(c.feed)] : c.feed.title)}</button>`;
      const ownChips = [...new Map(own.map(c => [socialNet(c.feed), c])).values()];
      out += `<div class="also also-social">${ownChips.length ? `Also shared on ${ownChips.map(chip).join(' ')}` : ''}${ownChips.length && others.length ? ' · ' : ''}${others.length ? `Shared by ${others.slice(0, 3).map(chip).join(' ')}` : ''}</div>`;
    }
    return out;
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
    const byName = n.length >= 3 ? S.feeds.find(f => (f.site + ' ' + f.url).toLowerCase().includes(n)) : null;
    if (byName) return byName;
    // A Bluesky handle on your own domain (@daviddaniels.com) names your site
    const h = (SOC.accounts.bluesky?.handle || '').replace(/^@/, '').toLowerCase();
    if (!h || h.endsWith('.bsky.social')) return null;
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    return S.feeds.find(f => host(f.site) === h || host(f.url) === h) || null;
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
    if (S.view === 'talk') { $('list').innerHTML = talkHtml(); return; }
    if (S.view === 'jobs') { $('list').innerHTML = jobsHtml(); return; }
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
    if (img.tagName === 'IMG' && img.closest?.('.newpost, .pav')) { img.replaceWith(Object.assign(document.createElement('span'), { className: 'ph' })); return; }
    if (img.tagName === 'IMG' && img.closest?.('.tcols') && img.classList.contains('av')) { img.style.visibility = 'hidden'; return; }
    if (img.tagName === 'IMG' && img.closest?.('.c-card, .n-note')) { img.classList.contains('n-av') ? img.replaceWith(Object.assign(document.createElement('span'), { className: 'n-av fav', textContent: '•' })) : img.remove(); return; }
    if (!img.classList?.contains('thumb') || img.tagName !== 'IMG') return;
    if (img.classList.contains('p-img')) { img.closest('.p-card')?.querySelector('.p-sum')?.classList.add('long'); img.remove(); return; }
    const [h, letter] = (img.dataset.tile || '210|•').split('|');
    const t = document.createElement('div');
    t.className = 'thumb tile'; t.style.setProperty('--h', h); t.dataset.act = 'open'; t.setAttribute('aria-hidden', 'true');
    t.innerHTML = `<span>${esc(letter.toUpperCase())}</span>`;
    img.replaceWith(t);
  }, true);

  // Notes fade on their own after a few seconds; problems stay until the next note.
  let statusTimer = 0;
  function status(text, err) {
    const el = $('status'); el.textContent = text || ''; el.classList.toggle('err', !!err);
    clearTimeout(statusTimer);
    if (text && !err) statusTimer = setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 6000);
  }
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
      buildKinds(); buildPersons(); buildMutes(); renderMutes();
      setTimeout(scanSites, 4000);
      const oldMine = store.get('myFeed'); // earlier builds kept this on one device only
      if (oldMine && !('mine' in S.prefs)) { const f = feedById(oldMine); S.prefs.mine = oldMine === 'none' ? 'none' : f ? f.url : undefined; if (S.prefs.mine) savePrefs(); store.set('myFeed', ''); }
      const valid = ['today', 'all', 'saved', 'annotated', 'recent', 'discover', 'people', 'guide', 'talk', 'jobs'].includes(S.view) || folderOf(S.view) || feedById(S.view);
      if (!valid) S.view = 'all';
      render(); welcome();
    } catch (e) { status(msg(e), true); }
  }

  async function mark(ids, patch) {
    ids = [].concat(ids);
    if ('read' in patch) { const F = folds(); ids = [...new Set(ids.flatMap(id => [id, ...(F.on.get(id) || []).map(c => c.item.id)]))]; }
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
    if (S.view === 'talk') loadTalk();
    if (typeof S.view === 'number' && anySocial()) loadReaders();
    if (S.view === 'jobs') { store.set('jobsSeen', String(Date.now())); setTimeout(renderRail, 50); upgradeLocalSearch(); }
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
        ${(S.alsoFeeds?.get(f.id) || []).map(sf => `<button class="p-net" data-view="${sf.id}" title="${esc(f.title)} on ${NET[socialNet(sf)]}" aria-label="${NET[socialNet(sf)]}">${ICON_NET[socialNet(sf)]}</button>`).join('')}
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
    for (const it of list) { const k = personId(it.feed_id); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    const people = S.feeds.filter(f => kindOf(f) === 'person' && personId(f.id) === f.id);
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

      <section class="g-sec" id="g-posse"><h2>Start your own site</h2>
        <p>Reading people is half of it. The other half is being one of them. The indie web has a simple habit for this called <b>POSSE</b>: <b>P</b>ublish on your <b>O</b>wn <b>S</b>ite, <b>S</b>yndicate <b>E</b>lsewhere. You post on your own site first, then share a copy everywhere else, each one linking back home.</p>
        <div class="g-how" aria-hidden="true">
          <div><span class="g-dot">1</span><strong>Post on your site</strong><span>the original lives at your address</span></div>
          <div class="g-arrow">→</div>
          <div><span class="g-dot">2</span><strong>Share copies</strong><span>Bluesky, Mastodon, email, anywhere, each linking home</span></div>
          <div class="g-arrow">→</div>
          <div><span class="g-dot">3</span><strong>Talk comes back</strong><span>replies find you, and your readers follow your feed</span></div>
        </div>
        <ul class="g-list">
          <li><b>You own it.</b> Apps close, change their rules or lock accounts. Your site stays, and so does everything you wrote there.</li>
          <li><b>No algorithm in the way.</b> People who follow your feed see every post, in order.</li>
          <li><b>It looks like you.</b> Your own colors, your own layout, your own address.</li>
          <li><b>Move freely.</b> When a new app comes along, share your same posts there too. You never start over.</li>
        </ul>
        <p style="margin-top:12px"><b>Your first post in an afternoon:</b></p>
        <ol class="g-steps">
          <li>Pick a home. Simple, free places to start include <a href="https://bearblog.dev/">Bear Blog</a>, <a href="https://neocities.org/">Neocities</a> and <a href="https://wordpress.com/">WordPress.com</a>. A domain of your own, like <code>yourname.com</code>, can come later.</li>
          <li>Write a short About page: who you are and what you’ll write about.</li>
          <li>Publish one post. A review, a recipe, something you learned this week. Short is fine.</li>
          <li>Follow your own site here with <b>+ Add a feed</b>, open it and choose <b>This is my site</b>.</li>
          <li>Connect Mastodon or Bluesky in <button class="b-link" data-view="talk">Conversations</button>. When you post something new, it offers to share it there for you, with a link back home, and the replies show up in the app.</li>
        </ol>
        <p style="margin-top:12px">Keep private things private: a site is public, so leave out your home address, phone number and anything you wouldn’t put on a postcard. For more on why personal sites matter, read <a href="https://daviddaniels.com/">daviddaniels.com</a> and the <a href="https://indieweb.org/POSSE">IndieWeb’s page on POSSE</a>.</p></section>

      <section class="g-sec" id="g-habits"><h2>What indie bloggers do</h2>
        <p>Personal sites have a culture of small, friendly habits. None are required, but they’re a good way to start writing, and they’re why personal sites feel so human.</p>
        <p><b>Pages most sites have</b>, called <b>slash pages</b> after their addresses:</p>
        <dl class="g-defs">
          <dt>/now</dt><dd>What you’re focused on this month. Thousands of people keep one; <a href="https://nownownow.com/">nownownow.com</a> lists them.</dd>
          <dt>/about</dt><dd>Who you are and what you write about.</dd>
          <dt>/blogroll</dt><dd>Blogs you recommend. <button class="b-link" data-view="discover">Discover</button> reads these to suggest new writers.</dd>
          <dt>/uses</dt><dd>Your gear, apps and setup.</dd>
          <dt>/colophon</dt><dd>How your site is made.</dd>
        </dl>
        <p style="margin-top:12px"><b>Kinds of posts you’ll see:</b></p>
        <ul class="g-list">
          <li><b>Weeknotes:</b> a short post each week about what happened, what you read and what you’re looking forward to.</li>
          <li><b>Link posts:</b> “Things I read this week,” with a line on why each one is worth it.</li>
          <li><b>Notes:</b> short, tweet-length posts that live on your own site.</li>
          <li><b>Reply posts:</b> answering another blogger on your own blog, linking to theirs. Whole conversations happen this way.</li>
        </ul>
        <p style="margin-top:12px"><b>Talking to each other:</b></p>
        <ul class="g-list">
          <li><b>Reply by email.</b> Many bloggers prefer email to comments. <b>Write back</b> in any story finds their address for you.</li>
          <li><b>Webmentions.</b> When you link to someone’s post, their site is told and can show your reply under theirs (<a href="https://indieweb.org/Webmention">how they work</a>).</li>
          <li><b>Guestbooks, webrings and little 88×31 buttons</b> linking friends’ sites, revived from the early web.</li>
        </ul>
        <p style="margin-top:12px"><b>Join in:</b></p>
        <ul class="g-list">
          <li><a href="https://indieweb.org/IndieWeb_Carnival">IndieWeb Carnival</a>: a monthly theme everyone writes about.</li>
          <li><a href="https://100daystooffload.com/">100 Days to Offload</a>: a challenge to publish 100 posts in a year.</li>
          <li><a href="https://peopleandblogs.com/">People and Blogs</a>: weekly interviews with people who write online.</li>
          <li><a href="https://indieweb.org/Homebrew_Website_Club">Homebrew Website Club</a>: small meetups, online and in person, to work on your own site.</li>
        </ul>
        <p style="margin-top:12px">An easy first step: write a /now page. It takes ten minutes, and you’ll update it whenever life changes.</p></section>

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
          <dt>POSSE</dt><dd>Publish on your Own Site, Syndicate Elsewhere: post on your own site first, then share copies that link back to it.</dd>
          <dt>Weeknote</dt><dd>A short weekly post about what happened that week.</dd>
          <dt>Slash page</dt><dd>A standard page on a personal site, named by its address: /now, /about, /blogroll, /uses.</dd>
          <dt>Webmention</dt><dd>A note one site sends another when it links to it, so replies can show up under the original post.</dd>
          <dt>Indie web</dt><dd>People making and reading their own websites, instead of living only on big apps.</dd>
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
    if (D.report) return `Search any topic, or see what the ${D.report.sites} sites you follow recommend · updated ${ago(D.report.at) === 'now' ? 'just now' : ago(D.report.at) + ' ago'}`;
    return 'Search any topic, or see blogs recommended by the sites you follow';
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
  // ------------------------------------------------------------ Help Wanted: job feeds as newspaper classifieds
  // Job feeds live apart from your reading (never in Today, People or All). Circle an ad to clip it and track it.
  const JOB_FEEDS = [
    ['We Work Remotely · all jobs', 'https://weworkremotely.com/remote-jobs.rss', 'Remote jobs of every kind'],
    ['We Work Remotely · customer support', 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss', ''],
    ['We Work Remotely · sales and marketing', 'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss', ''],
    ['We Work Remotely · management and finance', 'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss', ''],
    ['We Work Remotely · design', 'https://weworkremotely.com/categories/remote-design-jobs.rss', ''],
    ['We Work Remotely · programming', 'https://weworkremotely.com/categories/remote-programming-jobs.rss', ''],
    ['Remotive', 'https://remotive.com/remote-jobs/feed', 'Remote jobs, many outside tech'],
    ['Remote OK', 'https://remoteok.com/remote-jobs.rss', 'Remote jobs, mostly tech'],
    ['Authentic Jobs', 'https://authenticjobs.com/?feed=job_feed', 'Design and web jobs'],
    ['Hacker News: Who is hiring?', 'https://hnrss.org/whoishiring/jobs', 'Companies posting openings themselves, monthly'],
  ];
  const JOB_STARTERS = [JOB_FEEDS[0][1], JOB_FEEDS[6][1], JOB_FEEDS[9][1]];
  const JOB_HOSTS = /weworkremotely\.com|remotive\.com|remoteok\.(com|io)|authenticjobs\.com|hnrss\.org\/whoishiring/;
  const isJobFeed = f => !!f && (!!(S.prefs.jobs || {})[f.url] || !!(S.prefs.jobs || {})['id:' + f.id] || JOB_HOSTS.test(f.url || ''));
  const isJobItem = i => isJobFeed(feedById(i.feed_id));
  const J = { filter: 'all', anim: null };
  const CATS = [
    ['gov', 'Government', /\b(federal|government|county|city of|state of|usajobs|park ranger|gs-\d+)\b/i],
    ['tech', 'Tech', /\b(developer|engineer|engineering|programmer|devops|sysadmin|software|data|it specialist|security|qa|full[- ]stack|front[- ]end|back[- ]end|ios|android|machine learning|ai)\b/i],
    ['design', 'Design', /\b(design|designer|ux|ui|graphic|illustrat|creative|brand)\b/i],
    ['support', 'Customer service', /\b(support|customer|success|service|front desk|receptionist|help ?desk|concierge|call center)\b/i],
    ['sales', 'Sales', /\b(sales|account executive|business development|bdr|sdr|marketing|growth|partnerships|retail associate)\b/i],
    ['mgmt', 'Management', /\b(manager|management|director|lead|head of|finance|accountant|accounting|bookkeep|operations|coordinator|administrator|hr|recruit)\b/i],
  ];
  const CAT_HUE = { gov: 215, tech: 265, design: 330, support: 172, sales: 24, mgmt: 140, local: 44, other: 220 };
  const CAT_NAME = Object.fromEntries([...CATS.map(([k, n]) => [k, n]), ['local', 'Around town'], ['other', 'All other']]);
  const FEED_CAT = [[/customer-support/, 'support'], [/sales-and-marketing/, 'sales'], [/management-and-finance/, 'mgmt'], [/design/, 'design'], [/programming|devops/, 'tech']];
  function jobVia(f) {
    const p = JOB_FEEDS.find(x => x[1] === f.url);
    if (p) return p[0].split(/ · |: /)[0];
    return isNewsSearch(f) ? 'News search' : f.title;
  }
  // One ad from a feed item: title, company, place, a line about it, and its section
  function adOf(it) {
    const f = feedById(it.feed_id) || {};
    let title = (it.title || '').trim(), company = '', loc = '';
    const sum = (it.summary || '').replace(/\s+/g, ' ').trim();
    let m;
    if (isNewsSearch(f)) { title = headline(it); company = outletOf(it); loc = S.prefs.jobPlace || ''; }
    else if (/hnrss\.org/.test(f.url) || / \| .+ \| /.test(title)) {
      const parts = (/ \| /.test(title) ? title : sum.slice(0, 300)).split(/\s+\|\s+/).map(x => x.trim()).filter(Boolean);
      company = parts[0] || '';
      title = parts.find((p, i) => i > 0 && CATS.some(c => c[2].test(p))) || parts[1] || title;
      loc = parts.find(p => /remote|on-?site|hybrid|,\s*[A-Z]{2}\b|\b(NYC|SF|London|Berlin)\b/i.test(p) && p !== title) || '';
    } else if ((m = /^([^:]{2,60}):\s+(.+)$/.exec(title))) { company = m[1]; title = m[2]; }
    else if ((m = /^(.+?)\s+at\s+([^,]{2,60})$/.exec(title))) { title = m[1]; company = m[2]; }
    if (!loc) {
      const hay = `${it.title} ${sum}`;
      loc = (m = /\b([A-Z][a-zA-Z .'-]{2,24},\s*(?:[A-Z]{2}|[A-Z][a-z]+))\b/.exec(hay)) ? m[1]
        : /\bhybrid\b/i.test(hay) ? 'Hybrid'
        : /weworkremotely|remotive|remoteok/.test(f.url || '') || /\bremote\b/i.test(hay) ? 'Remote' : '';
    }
    title = title.replace(/\s*\((remote|hybrid)\)\s*$/i, '');
    let blurb = sum.replace(title, '').replace(company, '').replace(/^[\s|:·,-]+/, '');
    if (blurb.length > 160) blurb = blurb.slice(0, 157).replace(/\s+\S*$/, '') + '…';
    const fc = FEED_CAT.find(([re]) => re.test(f.url || ''));
    const cat = isNewsSearch(f) ? 'local' : fc ? fc[1] : (CATS.find(c => c[2].test(title)) || CATS.find(c => c[2].test(`${title} ${sum.slice(0, 200)}`)) || ['other'])[0];
    return { id: it.id, title: title || 'Untitled listing', company, loc, blurb, cat, date: it.date, link: it.link, via: jobVia(f), feedId: f.id };
  }
  const circled = () => S.prefs.circled || {};
  const jobHidden = () => new Set(S.prefs.jobHidden || []);
  function jobAds() {
    const hid = jobHidden(), seen = new Set(), out = [];
    for (const it of S.items) {
      if (!isJobItem(it)) continue;
      if (isNewsSearch(feedById(it.feed_id)) && !goodLocal(it)) continue;
      const a = adOf(it);
      if (a.company && hid.has(a.company.toLowerCase())) continue;
      const k = (a.title + '|' + a.company).toLowerCase(); // the same job from two feeds, once
      if (seen.has(k)) continue; seen.add(k); out.push(a);
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }
  // Local hiring news: the town by name, hiring words, no sports hires, the last month only
  const localJobsQuery = place => `"${place.split(',')[0].trim()}" ("now hiring" OR "hiring event" OR "job fair" OR "new jobs" OR hiring OR jobs) -coach -quarterback -football -basketball -baseball -hockey -NFL -NBA -MLB -NHL -NCAA -athletics when:30d`;
  const HIRING_WORDS = /\b(hir(e|es|ed|ing)|jobs?|job fair|openings?|positions|workers|workforce|employ(er|ers|ees|ment)?|recruit(ing|s)?|staffing|layoffs?|expan(d|ds|sion))\b/i;
  const SPORTS_WORDS = /\b(coach(es|ing)?|quarterback|coordinator|athletic director|draft|roster|playoffs?|NFL|NBA|MLB|NHL|NCAA|basketball|football|baseball|hockey|soccer|panthers|hornets|knights)\b/i;
  function goodLocal(it) {
    const text = `${it.title} ${it.summary || ''}`, town = nearPlace();
    if (Date.now() - Date.parse(it.date) > 45 * DAY) return false;
    if (SPORTS_WORDS.test(it.title) || !HIRING_WORDS.test(it.title)) return false;
    return !town || text.toLowerCase().includes(town);
  }
  // Earlier builds searched just “hiring <town>”: swap it for the tighter search once
  let localChecked = false;
  async function upgradeLocalSearch() {
    if (localChecked || !S.prefs.jobPlace) return; localChecked = true;
    const old = S.feeds.filter(f => isJobFeed(f) && isNewsSearch(f) && /[?&]q=hiring(\+|%20)/.test(f.url));
    if (!old.length) return;
    for (const f of old) { try { await invoke('remove_feed', { id: f.id }); } catch {} }
    await addJobFeeds([localJobsQuery(S.prefs.jobPlace)]);
  }
  // "3h ago", "just now", or a plain date for older things (never "Sep 26 ago")
  const agoWords = d => { const a = ago(d); return a === 'now' ? 'just now' : /^\d+[a-z]+$/.test(a) ? a + ' ago' : a; };
  const nearPlace = () => (S.prefs.jobPlace || '').split(',')[0].trim().toLowerCase();
  const newJobs = () => { const t = Number(store.get('jobsSeen')) || 0; return S.items.filter(i => isJobItem(i) && Date.parse(i.date) > t).length; };
  const RING = (anim) => `<svg class="ring${anim ? ' draw' : ''}" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M40 8C100 0 186 4 196 42C202 82 132 98 72 95C22 92 0 72 4 46C8 20 44 6 104 4" fill="none" stroke="var(--pen)" stroke-width="2.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  function adHtml(a) {
    const c = circled()[a.id];
    return `<article class="ad${c ? ' circled' : ''}">${c ? RING(J.anim === a.id) : ''}
      <h4>${Date.now() - Date.parse(a.date) < DAY ? '<span class="hl-new">New</span> ' : ''}<button class="ad-t" data-job="open" data-id="${esc(a.id)}">${esc(a.title)}</button></h4>
      ${a.company || a.loc ? `<p class="co">${esc(a.company)}${a.company && a.loc ? ' · ' : ''}<span class="loc">${esc(a.loc)}</span></p>` : ''}
      ${a.blurb ? `<p class="blurb">${esc(a.blurb)}</p>` : ''}
      <p class="meta">${esc(agoWords(a.date))} · via ${esc(a.via)}
        ${a.company ? `<button class="ad-x" data-job="hide" data-company="${esc(a.company)}" title="Hide ads from ${esc(a.company)}" aria-label="Hide ads from ${esc(a.company)}">⊘</button>` : ''}
        <button class="circ" data-job="circle" data-id="${esc(a.id)}" aria-pressed="${!!c}">${c ? '✓ Circled' : '◯ Circle'}</button></p></article>`;
  }
  function jobsSub() {
    const c = circled(), due = Object.values(c).filter(x => x.s === 'applied' && x.applied && Date.now() - Date.parse(x.applied) > 7 * DAY).length;
    const n = jobAds().length;
    return `${n} ${n === 1 ? 'opening' : 'openings'} from ${S.feeds.filter(isJobFeed).length} job feeds${due ? ` · ${due} follow-up${due === 1 ? '' : 's'} due` : ''}`;
  }
  function jobsHtml() {
    const feeds = S.feeds.filter(isJobFeed);
    if (!feeds.length) return `<div class="mast"><h2>Help Wanted</h2><p>${esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))} · Classifieds</p></div>
      <div class="empty"><strong>The classifieds, from job feeds</strong><span>Turn on a few job boards that still publish feeds. Their ads stay here, apart from your reading. Circle the ones you like to keep track of them.</span>
      <div class="row" style="justify-content:center;gap:8px"><button class="btn primary" data-job="starter">Start with three job boards</button><button class="btn" data-job="manage">Choose job feeds</button></div></div>`;
    const ads = jobAds(), c = circled();
    const head = `<div class="mast"><h2>Help Wanted</h2><p>${esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))} · Classifieds</p></div>`;
    const n = Object.keys(c).filter(k => c[k].s !== 'no').length;
    const present = new Set(ads.map(a => a.cat));
    const chip = (k, label) => `<button data-job="filter" data-f="${k}" aria-pressed="${J.filter === k}"${CAT_HUE[k] != null ? ` class="c-chip" style="--c:${CAT_HUE[k]}"` : ''}>${esc(label)}</button>`;
    const filters = `<div class="hw-filters">${chip('all', 'All')}${chip('remote', 'Remote')}${S.prefs.jobPlace ? chip('near', 'Near ' + S.prefs.jobPlace.split(',')[0]) : ''}<span class="sep"></span>
      ${[...CATS.map(x => x[0]), 'local', 'other'].filter(k => present.has(k)).map(k => chip(k, CAT_NAME[k])).join('')}
      <button class="circled-btn" data-job="filter" data-f="circled" aria-pressed="${J.filter === 'circled'}">◯ Circled${n ? ` (${n})` : ''}</button></div>`;
    if (J.filter === 'circled') return head + filters + boardHtml();
    const near = nearPlace();
    const shown = ads.filter(a => J.filter === 'all' ? true : J.filter === 'remote' ? /remote/i.test(a.loc) : J.filter === 'near' ? (near && `${a.loc} ${a.blurb} ${a.title}`.toLowerCase().includes(near)) || a.cat === 'local' : a.cat === J.filter);
    if (!shown.length) return head + filters + `<div class="empty"><strong>No ads here right now</strong><span>${ads.length ? 'Try another section, or check back after the next refresh.' : S.refreshing ? 'Checking your job feeds now.' : 'Press Refresh to pull the latest listings.'}</span></div>`;
    const order = [...CATS.map(x => x[0]), 'local', 'other'];
    const groups = order.map(k => [k, shown.filter(a => a.cat === k).slice(0, 40)]).filter(([, l]) => l.length);
    return head + filters + `<div class="classifieds">${groups.map(([k, l]) => `<section class="cat" style="--c:${CAT_HUE[k]}"><h3>${esc(CAT_NAME[k].toUpperCase())}</h3>${l.map(adHtml).join('')}</section>`).join('')}</div>
      <p class="hw-foot">Listings come from the job feeds you turn on (<button class="b-link" data-job="manage">Manage job feeds</button>). Ads open on the original site. Always check a job on the company’s own site before applying, and never pay to apply.</p>`;
  }
  // ---- Circled: your clippings, moved along as things happen
  const LANES = [['circled', 'Circled', 'Interested'], ['applied', 'Applied', 'Waiting to hear'], ['heard', 'Heard back', 'Interviews and calls'], ['offer', 'Offer', 'Decisions']];
  const fmtDay = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  function clipHtml(id, c) {
    const a = c.ad, live = S.items.some(i => i.id === id), days = c.applied ? Math.floor((Date.now() - Date.parse(c.applied)) / DAY) : 0;
    const flag = !live ? 'Listing is gone from the feed. You still have the clipping.' : c.s === 'applied' && days >= 7 ? `It’s been ${days} days. Follow up?` : '';
    const foot = c.s === 'circled' ? `Circled ${fmtDay(c.at)} · via ${esc(a.via)}` : c.s === 'applied' ? `Applied ${fmtDay(c.applied)} · ${days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago'}`
      : c.s === 'heard' ? `Applied ${fmtDay(c.applied)} · heard back ${fmtDay(c.heard)}` : c.s === 'offer' ? `Offer ${fmtDay(c.offer)}` : `Closed ${fmtDay(c.closed)}`;
    const btn = (s, label, cls = '') => `<button class="btn sm ${cls}" data-job="status" data-id="${esc(id)}" data-s="${s}">${label}</button>`;
    const acts = c.s === 'circled' ? `<button class="btn primary sm" data-job="apply" data-id="${esc(id)}">Apply on their site</button>${btn('applied', 'I applied')}<button class="btn sm ghost" data-job="circle" data-id="${esc(id)}">Erase</button>`
      : c.s === 'applied' ? btn('heard', 'Heard back') + btn('no', 'Not this time', 'ghost')
      : c.s === 'heard' ? btn('offer', 'Offer') + btn('no', 'Not this time', 'ghost')
      : c.s === 'offer' ? btn('no', 'Archive', 'ghost') : btn('circled', 'Bring back', 'ghost');
    return `<article class="clip">${RING(false).replace('class="ring"', 'class="mini-ring"')}
      <h4><button class="ad-t" data-job="apply" data-id="${esc(id)}">${esc(a.title)}</button></h4>
      ${a.company || a.loc ? `<p class="co">${esc(a.company)}${a.company && a.loc ? ' · ' : ''}<span class="loc">${esc(a.loc)}</span></p>` : ''}
      ${a.blurb ? `<p class="ln">${esc(a.blurb)}</p>` : ''}
      ${c.note ? `<p class="ln note">“${esc(c.note)}”</p>` : ''}
      ${flag ? `<p class="flag">${esc(flag)}</p>` : ''}
      <p class="foot">${foot} · <button class="b-link" data-job="note" data-id="${esc(id)}">${c.note ? 'Edit note' : 'Add a note'}</button></p>
      <div class="acts">${acts}</div></article>`;
  }
  function boardHtml() {
    const c = circled(), ids = Object.keys(c).sort((x, y) => (c[y].at || '').localeCompare(c[x].at || ''));
    if (!ids.length) return `<div class="empty"><strong>Nothing circled yet</strong><span>Press ◯ Circle on any ad. It’s clipped and kept here, even after the listing disappears, so you can track it from applying to an offer.</span></div>`;
    const closed = ids.filter(id => c[id].s === 'no');
    return `<div class="board">${LANES.map(([s, name, sub]) => { const l = ids.filter(id => c[id].s === s); return `<section class="lane"><header><h3>${name}</h3><span>${l.length}</span></header><p class="lane-s">${sub}</p>${l.map(id => clipHtml(id, c[id])).join('') || '<p class="empty-lane">Nothing here yet.</p>'}</section>`; }).join('')}</div>
      ${closed.length ? `<details class="archive"><summary>Not this time (${closed.length}) · your record of everywhere you’ve applied</summary><div class="board">${closed.map(id => clipHtml(id, c[id])).join('')}</div></details>` : ''}`;
  }
  function saveCircled(next) { S.prefs.circled = next; savePrefs(); renderList(); renderRail(); }
  function jobAction(b) {
    const k = b.dataset.job, id = b.dataset.id, c = { ...circled() };
    if (k === 'filter') { J.filter = b.dataset.f; renderList(); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'manage') return openJobFeeds();
    if (k === 'starter') return addJobFeeds(JOB_STARTERS, b);
    if (k === 'open') { const it = item(id); if (it) openReader(id); return; }
    if (k === 'apply') { const a = c[id]?.ad || (item(id) && adOf(item(id))); if (a?.link) openWeb(a.link); return; }
    if (k === 'hide') {
      S.prefs.jobHidden = [...jobHidden(), b.dataset.company.toLowerCase()];
      savePrefs(); renderList(); status(`Ads from ${b.dataset.company} are hidden. Undo in Manage job feeds.`); return;
    }
    if (k === 'circle') {
      if (c[id]) { delete c[id]; J.anim = null; }
      else { const it = item(id); if (!it) return; c[id] = { s: 'circled', at: new Date().toISOString(), ad: adOf(it) }; J.anim = id; }
      saveCircled(c); setTimeout(() => { J.anim = null; }, 900); return;
    }
    if (k === 'status') {
      const s = b.dataset.s, now = new Date().toISOString(), cur = { ...c[id], s };
      if (s === 'applied' && !cur.applied) cur.applied = now;
      if (s === 'heard') cur.heard = now;
      if (s === 'offer') cur.offer = now;
      if (s === 'no') cur.closed = now;
      c[id] = cur; saveCircled(c);
      if (s === 'applied') status('Good luck. It’s in Applied; the app will nudge you if a week goes by.');
      return;
    }
    if (k === 'note') {
      const el = sheet('jobNote', `<h2>A note about this job</h2><p>${esc(c[id].ad.title)}${c[id].ad.company ? ' · ' + esc(c[id].ad.company) : ''}</p>
        <textarea id="jobNoteText" rows="4" placeholder="Who you talked to, when the interview is, what to ask…">${esc(c[id].note || '')}</textarea>
        <div class="row sheet-foot"><button class="btn" type="button" id="jnCancel">Cancel</button><button class="btn primary" type="button" id="jnSave">Save note</button></div>`, 'Note');
      $('jobNoteText').focus();
      $('jnCancel').onclick = () => { el.hidden = true; };
      $('jnSave').onclick = () => { el.hidden = true; c[id] = { ...c[id], note: $('jobNoteText').value.trim() }; saveCircled(c); };
    }
  }
  async function addJobFeeds(urls, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    const jobs = { ...(S.prefs.jobs || {}) }; let added = 0, last = '';
    for (const u of urls) {
      try { const r = await invoke('add_feed', { url: u, title: JOB_FEEDS.find(x => x[1] === u)?.[0] || (S.prefs.jobPlace && u === localJobsQuery(S.prefs.jobPlace) ? `Jobs around ${S.prefs.jobPlace.split(',')[0]}` : null), folderId: null }); jobs[u] = 1; jobs['id:' + r.id] = 1; added++; }
      catch (e) { last = msg(e); }
    }
    S.prefs.jobs = jobs; await savePrefs(); await load();
    // The feed's address can change when it's found; mark the saved address too
    for (const f of S.feeds) if (jobs['id:' + f.id] && !jobs[f.url]) jobs[f.url] = 1;
    S.prefs.jobs = jobs; savePrefs();
    status(added ? `Added ${added} job ${added === 1 ? 'feed' : 'feeds'}. New ads arrive with the next refresh.` : last, !added);
    if (added) refresh();
    if ($('jobFeeds') && !$('jobFeeds').hidden) openJobFeeds();
    renderList(); renderRail();
  }
  function openJobFeeds() {
    const on = u => S.feeds.find(f => f.url === u || f.url === u.replace('remoteok.com', 'remoteok.io'));
    const mine = S.feeds.filter(f => isJobFeed(f) && !JOB_FEEDS.some(x => x[1] === f.url));
    const hid = [...jobHidden()];
    const el = sheet('jobFeeds', `<h2>Job feeds</h2>
      <p>Job boards that still publish feeds. Indeed and LinkedIn don’t, so local jobs come from news searches for your area.</p>
      <div class="jf-list">${JOB_FEEDS.map(([name, u, about]) => { const f = on(u); return `<div class="jf"><div><b>${esc(name)}</b>${about ? `<span>${esc(about)}</span>` : ''}</div>
        ${f ? `<button class="btn sm" data-jf="remove" data-id="${f.id}">Turn off</button>` : `<button class="btn sm primary" data-jf="add" data-url="${esc(u)}">Turn on</button>`}</div>`; }).join('')}
      ${mine.map(f => `<div class="jf"><div><b>${esc(f.title)}</b><span>${isNewsSearch(f) ? 'News search' : esc(f.url)}</span></div><button class="btn sm" data-jf="remove" data-id="${f.id}">Turn off</button></div>`).join('')}</div>
      <h3 class="jf-h">Jobs near you</h3>
      <p>Type your town and the app follows local hiring news for it, under “Around town.”</p>
      <form class="acct-form" id="jobPlaceForm"><input id="jobPlace" placeholder="Fort Mill, SC" value="${esc(S.prefs.jobPlace || '')}"><button class="btn primary" type="submit">Save</button></form>
      ${hid.length ? `<h3 class="jf-h">Hidden companies</h3><div class="t-recent">${hid.map(h => `<button class="chip" data-jf="unhide" data-c="${esc(h)}">${esc(h)} ×</button>`).join('')}</div>` : ''}
      <div class="row sheet-foot"><button class="btn primary" type="button" id="jfDone">Done</button></div>`, 'Job feeds');
    el.onclick = async e => {
      if (e.target.id === 'jfDone') { el.hidden = true; return; }
      const b = e.target.closest('[data-jf]'); if (!b) return;
      if (b.dataset.jf === 'add') return addJobFeeds([b.dataset.url], b);
      if (b.dataset.jf === 'unhide') { S.prefs.jobHidden = [...jobHidden()].filter(x => x !== b.dataset.c); savePrefs(); openJobFeeds(); renderList(); return; }
      if (b.dataset.jf === 'remove') {
        b.disabled = true;
        try { await invoke('remove_feed', { id: Number(b.dataset.id) }); await load(); } catch (err) { status(msg(err), true); }
        openJobFeeds(); renderList(); renderRail();
      }
    };
    $('jobPlaceForm').onsubmit = async e => {
      e.preventDefault();
      const place = $('jobPlace').value.trim(); if (!place) return;
      S.prefs.jobPlace = place; savePrefs();
      await addJobFeeds([localJobsQuery(place)]);
      J.filter = 'near';
    };
  }

  // ---- Search a topic: personal sites first (Marginalia, a search engine for the independent web), then the news.
  const recentSearches = () => { try { return JSON.parse(store.get('topicSearches') || '[]'); } catch { return []; } };
  async function topicSearch(q) {
    q = (q || '').trim(); if (q.length < 2) return;
    D.q = q; D.searching = true; D.res = null; renderList();
    store.set('topicSearches', JSON.stringify([q, ...recentSearches().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)));
    try { D.res = await invoke('topic_search', { query: q }); } catch (e) { D.res = { query: q, news: [], web: [], news_error: msg(e), web_error: '' }; }
    D.searching = false; if (S.view === 'discover') renderList();
    // Featured pictures fill in as they arrive
    const want = (D.res.web || []).map(w => w.url).filter(u => !D.imgs.has(u));
    if (want.length) invoke('page_images', { urls: want }).then(list => {
      for (const [u, img] of list) D.imgs.set(u, img || '');
      if (S.view === 'discover' && D.res?.query === q) renderList();
    }).catch(() => {});
  }
  const followsHost = h => S.feeds.some(f => [hostOfU(f.site), hostOfU(f.url)].some(x => x && bareHost(x) === bareHost(h)));
  function searchHtml() {
    const recent = recentSearches();
    let out = `<form class="t-search" id="topicForm" role="search"><input id="topicQ" type="search" placeholder="Search a topic, like slow travel or home espresso" value="${esc(D.q)}" autocomplete="off" aria-label="Search a topic">
      <button class="btn primary" type="submit"${D.searching ? ' disabled' : ''}>${D.searching ? 'Searching…' : 'Search'}</button></form>`;
    if (recent.length && !D.res && !D.searching) out += `<div class="t-recent">${recent.map(r => `<button class="chip" data-topic="again" data-q="${esc(r)}">${esc(r)}</button>`).join('')}<button class="linkish" data-topic="clear">Clear</button></div>`;
    if (D.searching) return out + `<p class="note">Looking for personal sites and news about “${esc(D.q)}”…</p>`;
    const r = D.res; if (!r) return out;
    const topicOn = S.feeds.some(f => f.url === r.feed);
    // Personal sites first when there are some; otherwise the news leads and a quiet note follows
    let webPart = `<div class="t-head"><h2 class="sec-h">Personal sites about “${esc(r.query)}”</h2></div>`;
    if (r.web.length) webPart += `<div class="t-results">${r.web.map(w => {
      const on = followsHost(w.site) || D.added.has(w.site);
      return `<article class="t-hit">${tThumb(D.imgs.get(w.url), w.site, w.url, !D.imgs.has(w.url))}<div class="t-body"><a class="t-title" href="${esc(w.url)}">${esc(w.title || w.site)}</a><span class="t-site">${esc(w.site)}</span>
        ${w.description ? `<p>${esc(w.description)}</p>` : ''}
        <div class="t-acts">${on ? `<span class="t-on">✓ Following</span>` : `<button class="btn" data-topic="site" data-url="${esc('https://' + w.site + '/')}" data-site="${esc(w.site)}">Follow ${esc(w.site)}</button>`}
          ${D.err?.[w.site] ? `<span class="fol-err">${esc(D.err[w.site])}</span>` : ''}</div></div></article>`;
    }).join('')}</div><p class="disc-foot">Personal sites found with <a href="https://marginalia-search.com/">Marginalia Search</a>, a search engine for the small, independent web.</p>`;
    else webPart = `<p class="note t-webnote">${esc(r.web_error || 'No personal sites came up for this one. Try fewer or different words.')}</p>`;
    if (r.web.length) out += webPart;
    // News
    out += `<div class="t-head"><h2 class="sec-h">In the news</h2>${r.news.length ? (topicOn ? '<span class="t-on">✓ Following this topic</span>' : `<button class="btn primary" data-topic="topic" data-q="${esc(r.query)}">Follow this topic</button>`) : ''}</div>`;
    if (r.news.length) out += `<p class="sec-p">Following the topic adds a news search to your feeds, so new stories about it arrive with everything else.</p><div class="t-results">${r.news.slice(0, 15).map(n => {
      const h = hostOfU(n.source_url), on = h && (followsHost(h) || D.added.has(h));
      return `<article class="t-hit">${tThumb('', n.source || h, n.link)}<div class="t-body"><a class="t-title" href="${esc(n.link)}">${esc(n.title)}</a><span class="t-site">${esc(n.source)}${n.date ? ` · ${esc(agoWords(n.date))}` : ''}</span>
        ${h ? `<div class="t-acts">${on ? '<span class="t-on">✓ Following</span>' : `<button class="linkish" data-topic="site" data-url="${esc(n.source_url)}" data-site="${esc(h)}">Follow ${esc(n.source)}</button>`}${D.err?.[h] ? `<span class="fol-err">${esc(D.err[h])}</span>` : ''}</div>` : ''}</div></article>`;
    }).join('')}</div>`;
    else out += `<p class="note">${esc(r.news_error || 'No news stories came up.')}</p>`;
    if (!r.web.length) out += webPart;
    return out + `<hr class="t-rule">`;
  }
  // A result's picture: the page's featured image, a soft placeholder while it loads, or a tile with the site's initial
  function tThumb(img, name, href, loading) {
    const letter = esc(((name || '•').replace(/^www\./, '')[0] || '•').toUpperCase()), hue = hueFor((name || '').toLowerCase());
    if (isWeb(img)) return `<a class="t-thumb" href="${esc(href)}" tabindex="-1" aria-hidden="true"><img class="thumb" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-tile="${hue}|${letter}"></a>`;
    return `<a class="t-thumb" href="${esc(href)}" tabindex="-1" aria-hidden="true"><div class="thumb tile${loading ? ' t-loading' : ''}" style="--h:${hue}"><span>${loading ? '' : letter}</span></div></a>`;
  }
  async function topicAction(b) {
    const k = b.dataset.topic;
    if (k === 'again') return topicSearch(b.dataset.q);
    if (k === 'clear') { store.set('topicSearches', '[]'); renderList(); return; }
    const site = b.dataset.site || '';
    b.disabled = true; b.textContent = 'Adding…';
    try {
      const r = await invoke('add_feed', { url: k === 'topic' ? b.dataset.q : b.dataset.url, title: null, folderId: null });
      if (site) D.added.set(site, r.id);
      status(`Following ${r.title}.`); await load();
    } catch (e) { D.err = { ...(D.err || {}), [site || 'topic']: msg(e) }; status(msg(e), true); }
    renderList();
  }

  function discoverHtml() {
    return searchHtml() + blogrollHtml();
  }
  function blogrollHtml() {
    const intro = `<h2 class="sec-h">Recommended by the writers you read</h2><p class="disc-intro">The writers you read recommend these blogs, in their blogrolls or by linking to them often. The more of your sites that point to one, the higher it appears.</p>`;
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
  // Discover's count: suggestions you haven't seen yet, not every suggestion
  const seenSuggestions = () => { try { return new Set(JSON.parse(store.get('discoverSeen') || '[]')); } catch { return new Set(); } };
  const newSuggestions = () => { const seen = seenSuggestions(); return (D.report?.suggestions || []).filter(x => !seen.has(x.domain)).length; };
  function markSuggestionsSeen() {
    const all = [...seenSuggestions(), ...(D.report?.suggestions || []).map(x => x.domain)];
    store.set('discoverSeen', JSON.stringify([...new Set(all)].slice(-1000)));
  }
  function paintDiscover() {
    if (S.view === 'discover') markSuggestionsSeen(); if (S.view === 'discover') { renderHead(); renderList(); } renderRail(); }
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


  // ------------------------------------------------------------ Mastodon and Bluesky: share with a note, and talk
  // Accounts belong to the person: they sign in to their own server, and the sign-in stays in this device's Keychain.
  async function loadAccounts() { try { SOC.accounts = await invoke('social_accounts'); } catch { SOC.accounts = {}; } }
  async function loadConversations(quiet) {
    if (!anySocial() || SOC.loading) return;
    SOC.loading = true; if (!quiet && S.view === 'talk') renderList();
    try { const c = await invoke('social_conversations'); SOC.conv = c; SOC.err = c.errors || []; } catch (e) { SOC.err = [msg(e)]; }
    SOC.loading = false;
    renderRail(); if (S.view === 'talk') { renderHead(); renderList(); }
  }

  // ---- connecting accounts
  function accountsHtml() {
    const row = (net, a, body) => `<section class="acct"><h3>${ICON_NET[net]}${NET[net]}</h3>${a
      ? `<p>Connected as <b>${esc(a.handle)}</b>.</p><div class="row"><button class="btn" data-disconnect="${net}">Disconnect</button></div>`
      : body}</section>`;
    return `<h2 id="socialTitle">Mastodon &amp; Bluesky</h2>
      <p>Connect your own accounts to post stories with your thoughts, and to see and answer the replies in Conversations. You sign in to your own server; the app keeps the sign-in in this device’s Keychain and sends it nowhere else. Connect on each of your devices.</p>
      ${row('bluesky', SOC.accounts.bluesky, `<p>Use an <b>App Password</b>, not your real password. Make one in Bluesky under Settings › Privacy and security › <button class="b-link" data-open-url="https://bsky.app/settings/app-passwords">App passwords</button>. You can revoke it anytime.</p>
        <form class="acct-form" id="bskyForm"><input id="bskyHandle" placeholder="you.bsky.social" autocomplete="username" autocapitalize="off" spellcheck="false">
        <input id="bskyPass" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="off"><button class="btn primary" type="submit">Connect</button></form>`)}
      ${row('mastodon', SOC.accounts.mastodon, `<p>Type your server, then approve The Reading Room in the page that opens. Your server shows a code: paste it here.</p>
        <form class="acct-form" id="mastoForm"><input id="mastoServer" placeholder="mastodon.social" autocapitalize="off" spellcheck="false"><button class="btn primary" type="submit">Continue</button></form>
        <form class="acct-form" id="mastoCodeForm" hidden><input id="mastoCode" placeholder="Paste the code" autocapitalize="off" spellcheck="false"><button class="btn primary" type="submit">Connect</button></form>`)}
      <p class="acct-note" id="acctNote" aria-live="polite"></p>
      <div class="row sheet-foot"><button class="btn primary" type="button" id="socialDone">Done</button></div>`;
  }
  const ICON_NET = {
    bluesky: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6.3 4.2C8.6 5.9 11 9.4 12 11.4c1-2 3.4-5.5 5.7-7.2 1.6-1.2 4.3-2.2 4.3.9 0 .6-.4 5.2-.6 5.9-.7 2.5-3.2 3.1-5.5 2.7 4 .7 5 2.9 2.8 5.2-4.2 4.3-6-1.1-6.5-2.5l-.2-.5-.2.5c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.3-1.2-4.5 2.8-5.2-2.3.4-4.8-.2-5.5-2.7C2.4 10.3 2 5.7 2 5.1c0-3.1 2.7-2.1 4.3-.9z"/></svg>',
    mastodon: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M21.3 13.8c-.3 1.5-2.6 3.1-5.3 3.4-1.4.2-2.8.3-4.3.3-2.4-.1-4.3-.6-4.3-.6v.7c.3 2.4 2.4 2.5 4.3 2.6 2 .1 3.7-.5 3.7-.5l.1 1.8s-1.4.7-3.8.9c-1.4.1-3.1-.1-5.1-.6-4.3-1.1-5-5.5-5.2-10V7.6C1.4 3 4.4 1.7 4.4 1.7 5.9 1 8.6.7 11.3.7h.1c2.7 0 5.4.3 6.9 1 0 0 3 1.3 3 5.9 0 0 .1 3.4-.4 5.7zM18.2 8.4c0-1.2-.3-2.1-.9-2.8-.6-.7-1.4-1-2.4-1-1.2 0-2 .4-2.6 1.3l-.6 1-.6-1c-.6-.9-1.4-1.3-2.6-1.3-1 0-1.8.4-2.4 1-.6.7-.9 1.6-.9 2.8v5.6h2.2V8.6c0-1.1.5-1.7 1.4-1.7 1 0 1.6.7 1.6 2v3h2.2v-3c0-1.3.5-2 1.6-2 .9 0 1.4.6 1.4 1.7V14h2.2z"/></svg>',
  };
  function sheet(id, html, label) {
    let el = $(id);
    if (!el) {
      el = document.createElement('div'); el.className = 'overlay'; el.id = id;
      el.addEventListener('mousedown', e => { if (e.target === el) el.hidden = true; });
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
    el.hidden = false; return el;
  }
  async function openAccounts() {
    await loadAccounts();
    const el = sheet('socialPanel', accountsHtml(), 'Mastodon and Bluesky');
    const note = (t, err) => { $('acctNote').textContent = t; $('acctNote').classList.toggle('err', !!err); };
    el.onclick = async e => {
      if (e.target.id === 'socialDone') { el.hidden = true; return; }
      const u = e.target.closest('[data-open-url]'); if (u) { invoke('open_external', { url: u.dataset.openUrl }).catch(() => {}); return; }
      const d = e.target.closest('[data-disconnect]');
      if (d) { SOC.accounts = await invoke('social_disconnect', { network: d.dataset.disconnect }); SOC.conv = null; openAccounts(); renderRail(); }
    };
    $('bskyForm')?.addEventListener('submit', async e => {
      e.preventDefault(); note('Connecting to Bluesky…');
      try { SOC.accounts = await invoke('bsky_connect', { handle: $('bskyHandle').value, password: $('bskyPass').value }); openAccounts(); renderRail(); loadConversations(true); }
      catch (err) { note(msg(err), true); }
    });
    $('mastoForm')?.addEventListener('submit', async e => {
      e.preventDefault(); note('Asking your server…');
      try {
        const url = await invoke('masto_begin', { server: $('mastoServer').value });
        await invoke('open_external', { url });
        $('mastoForm').hidden = true; $('mastoCodeForm').hidden = false; $('mastoCode').focus();
        note('Approve The Reading Room on the page that opened, then paste the code it shows.');
      } catch (err) { note(msg(err), true); }
    });
    $('mastoCodeForm')?.addEventListener('submit', async e => {
      e.preventDefault(); note('Connecting to Mastodon…');
      try { SOC.accounts = await invoke('masto_finish', { code: $('mastoCode').value }); openAccounts(); renderRail(); loadConversations(true); }
      catch (err) { note(msg(err), true); }
    });
  }
  $('socialBtn').onclick = openAccounts;

  // ---- posting a story with your note
  const LIMIT = { bluesky: 300, mastodon: 500 };
  function openCompose(it, prefer, all) {
    if (!anySocial()) { openAccounts(); return; }
    const nets = ['bluesky', 'mastodon'].filter(n => SOC.accounts[n]);
    const chosen = new Set(all ? nets : prefer && SOC.accounts[prefer] ? [prefer] : nets.slice(0, 1));
    const f = it && feedById(it.feed_id);
    const quote = it ? S.highlights.find(h => h.item_id === it.id)?.text || '' : '';
    const el = sheet('composePanel', `<h2>${it ? 'Share with your thoughts' : 'New post'}</h2>
      ${it ? `<div class="c-card">${isWeb(it.image) ? `<img src="${esc(it.image)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(headline(it))}</b><span>${esc(srcLabel(it) || f?.title || '')}</span></div></div>` : ''}
      <textarea id="cText" rows="5" placeholder="${it ? 'What did you think? Mention the writer to let them know.' : 'What’s on your mind?'}"></textarea>
      ${quote ? `<button class="b-link c-quote" id="cQuote" type="button">Add your highlight as a quote</button>` : ''}
      <div class="c-nets">${nets.map(n => `<label class="c-net"><input type="checkbox" value="${n}"${chosen.has(n) ? ' checked' : ''}>${ICON_NET[n]}${NET[n]} <small>${esc(SOC.accounts[n].handle)}</small></label>`).join('')}
        <span class="c-count" id="cCount"></span></div>
      <p class="acct-note" id="cNote" aria-live="polite"></p>
      <div class="row sheet-foot"><button class="btn" type="button" id="cCancel">Cancel</button><button class="btn primary" type="button" id="cPost">Post</button></div>`, 'Share with your thoughts');
    const text = $('cText'), boxes = () => [...el.querySelectorAll('.c-net input:checked')].map(x => x.value);
    const count = () => {
      const n = [...text.value].length, picks = boxes();
      const room = Math.min(...picks.map(p => LIMIT[p] - (p === 'mastodon' && it ? 25 : 0)), 999);
      $('cCount').textContent = picks.length ? `${room - n}` : '';
      $('cCount').classList.toggle('over', n > room);
      $('cPost').disabled = !picks.length || n > room;
    };
    text.addEventListener('input', count); el.querySelectorAll('.c-net input').forEach(x => x.addEventListener('change', count)); count();
    $('cQuote')?.addEventListener('click', () => { text.value = `“${quote}”\n\n${text.value}`.trim() + (text.value ? '' : '\n\n'); text.focus(); count(); });
    $('cCancel').onclick = () => { el.hidden = true; };
    $('cPost').onclick = async () => {
      $('cPost').disabled = true; $('cNote').textContent = 'Posting…'; $('cNote').classList.remove('err');
      const res = await invoke('social_post', { networks: boxes(), text: text.value, link: it ? it.link : '', title: it ? headline(it) : '', description: it ? (it.summary || '').slice(0, 280) : '', image: it && isWeb(it.image) ? it.image : '' });
      const bad = res.filter(r => r.error);
      if (!bad.length) {
        el.hidden = true; if (it) store.set('shared:' + it.id, '1');
        status(`Posted to ${res.map(r => NET[r.network]).join(' and ')}. Replies will show in Conversations.`);
        setTimeout(() => { loadConversations(true); if (S.view === 'talk') renderList(); }, 4000); return;
      }
      $('cNote').textContent = bad.map(r => `${NET[r.network]}: ${r.error}`).join(' ') + (res.length > bad.length ? ` Posted to ${res.filter(r => !r.error).map(r => NET[r.network]).join(' and ')}.` : '');
      $('cNote').classList.add('err'); $('cPost').disabled = false;
    };
    text.focus();
  }

  // ---- Conversations: your shared stories and the replies to them
  const fmtWhen = d => { const a = ago(d); return a === 'now' ? 'just now' : `${a} ago`; };
  const isMe = a => [SOC.accounts.bluesky?.handle, SOC.accounts.mastodon?.handle].some(h => h && (h === a.handle || h.startsWith(a.handle + '@')));
  function noteHtml(n, opts = {}) {
    const a = n.author; opts.mine = opts.mine || isMe(a);
    return `<div class="n-note${opts.reply ? ' n-reply' : ''}" style="--d:${Math.min(n.depth || 0, 6)}">
      ${isWeb(a.avatar) ? `<img class="n-av" src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="n-av fav" style="background:hsl(${hueFor(a.handle)} 45% 42%)">${esc((a.name || '?')[0])}</span>`}
      <div class="n-main">
        <div class="n-who"><b>${esc(a.name)}</b> <span>${esc(a.handle)}</span> <span class="n-net">${ICON_NET[n.network]}</span> <time>${esc(fmtWhen(n.created_at))}</time></div>
        <div class="n-text">${esc(n.text)}</div>
        ${opts.actions === false ? '' : `<div class="n-acts">
          <button class="linkish" data-talk="reply" data-net="${n.network}" data-id="${esc(n.id)}" data-cid="${esc(n.cid)}" data-root="${esc(n.root_id || opts.rootId || '')}" data-rootcid="${esc(n.root_cid || opts.rootCid || '')}" data-handle="${esc(a.handle)}">Reply</button>
          <button class="linkish" data-talk="open" data-url="${esc(n.url)}">Open on ${NET[n.network]}</button>
          ${opts.mine ? '' : `<button class="linkish n-more" data-talk="more" data-net="${n.network}" data-person="${esc(a.id)}" data-name="${esc(a.handle)}" data-id="${esc(n.id)}" data-cid="${esc(n.cid)}">⋯</button>`}
        </div>`}
        <div class="n-box" data-box="${esc(n.id)}"></div>
      </div></div>`;
  }
  function postHtml(p) {
    const open = SOC.open.has(p.id), thread = SOC.threads.get(p.id);
    const it = S.items.find(i => i.link && p.link && i.link.replace(/\/$/, '') === p.link.replace(/\/$/, ''));
    return `<article class="t-post">
      <div class="t-story">${!p.link ? `<span class="t-plain">${ICON_NET[p.network]}</span>` : ''}${p.link ? `<button class="t-link" ${it ? `data-open="${esc(it.id)}"` : `data-talk="open" data-url="${esc(p.link)}"`}>${esc(p.link_title || p.link.replace(/^https?:\/\//, ''))}</button>` : ''}
        <span class="t-when">${ICON_NET[p.network]} ${esc(fmtWhen(p.created_at))}</span></div>
      ${p.text ? `<p class="t-note">${esc(p.text)}</p>` : ''}
      <div class="t-meta"><button class="t-count linkish" data-talk="thread" data-net="${p.network}" data-id="${esc(p.id)}">${p.replies ? `${p.replies} ${p.replies === 1 ? 'reply' : 'replies'}` : 'No replies yet'}${p.replies ? (open ? ' ▴' : ' ▾') : ''}</button>
        ${p.reposts ? `<span>${p.reposts} ${p.network === 'mastodon' ? (p.reposts === 1 ? 'boost' : 'boosts') : (p.reposts === 1 ? 'repost' : 'reposts')}</span>` : ''}${p.likes ? `<span>${p.likes} ${p.network === 'mastodon' ? (p.likes === 1 ? 'favorite' : 'favorites') : (p.likes === 1 ? 'like' : 'likes')}</span>` : ''}
        <button class="linkish" data-talk="open" data-url="${esc(p.url)}">Open on ${NET[p.network]}</button></div>
      <div class="n-box" data-box="${esc(p.id)}"></div>
      ${open ? `<div class="t-thread">${thread === undefined ? '<p class="note">Loading the replies…</p>' : thread.length ? thread.map(n => noteHtml(n, { reply: true, rootId: p.id, rootCid: p.cid })).join('') : '<p class="note">No replies yet.</p>'}</div>` : ''}
    </article>`;
  }
  // ---- The people you read, on Mastodon and Bluesky: their accounts come from their sites, the social feeds you
  // already follow, and Bluesky handles on their own domain. Looked up through your accounts to see if you follow them.
  function readerCandidates() {
    const want = new Map(); // profile url → feed id (the person)
    const add = (u, fid) => { if (u && !want.has(u)) want.set(u, fid); };
    const nets = new Set(['bluesky', 'mastodon'].filter(n => SOC.accounts[n]));
    for (const f of S.feeds) {
      if (kindOf(f) !== 'person' || isNewsSearch(f)) continue;
      const who = personId(f.id);
      if (isSocialFeed(f)) { if (nets.has(socialNet(f))) add(profileOf(f), who); continue; }
      for (const l of (PL[siteOf(f)]?.links || [])) if (nets.has(l.label.toLowerCase())) add(l.url.replace(/\/$/, ''), who);
      const h = bareHost(hostOfU(f.site) || hostOfU(f.url));
      if (nets.has('bluesky') && h && h.includes('.')) add('https://bsky.app/profile/' + h, who);
    }
    return want;
  }
  let readersAt = 0;
  async function loadReaders(force) {
    if (!anySocial() || (!force && Date.now() - readersAt < 10 * 60 * 1000 && SOC.readers)) return;
    readersAt = Date.now();
    const want = readerCandidates();
    const tasks = [
      invoke('social_lookup', { urls: [...want.keys()] }).then(list => {
        // Once per person and network
        const seen = new Set();
        SOC.readers = list.map(l => ({ ...l, feedId: want.get(l.url) })).filter(r => r.feedId && !seen.has(r.feedId + r.network) && seen.add(r.feedId + r.network));
      }).catch(() => { SOC.readers = SOC.readers || []; }),
      invoke('social_following_blogs').then(b => { SOC.theirBlogs = b; }).catch(() => { SOC.theirBlogs = SOC.theirBlogs || []; }),
    ];
    for (const t of tasks) t.then(() => { if (S.view === 'talk') renderList(); if (typeof S.view === 'number') renderHead(); });
    await Promise.allSettled(tasks);
  }
  // Taking people off the Conversations lists (a spam follower, a writer you don't want to follow there). Synced.
  const hiddenIn = k => new Set(((S.prefs.dismissed || {})[k]) || []);
  function setHidden(k, key, on) {
    const d = S.prefs.dismissed = { ...(S.prefs.dismissed || {}) };
    const set = new Set(d[k] || []); on ? set.add(key) : set.delete(key); d[k] = [...set].slice(-500);
    savePrefs(); renderList();
  }
  const xBtn = (k, key, label, extra = '') => `<button class="fx" data-talk="${k === 'f' ? 'folmenu' : 'dismiss'}" data-k="${k}" data-key="${esc(key)}" ${extra} title="${esc(label)}" aria-label="${esc(label)}">×</button>`;
  const hiddenFoot = (k, n) => n ? `<button class="linkish more-r" data-talk="showhidden" data-k="${k}">${SOC.showHidden === k ? 'Done' : `${n} hidden`}</button>` : '';
  const readersFor = feedId => (SOC.readers || []).filter(r => r.feedId === personId(feedId));
  function followButtons(f) {
    return readersFor(f.id).map(r => r.following
      ? `<span class="btn ghost-done" title="You follow ${esc(r.person.handle)}">${ICON_NET[r.network]} Following on ${NET[r.network]}</span>`
      : `<button class="btn" data-talk="follow" data-net="${r.network}" data-person="${esc(r.person.id)}" title="${esc(r.person.handle)}">${ICON_NET[r.network]} Follow on ${NET[r.network]}</button>`).join('');
  }

  // Tabs: what people share, replies to you, your posts, and people linking to your blog
  const TALK_TABS = [['shared', 'From people you follow'], ['replies', 'Replies'], ['posts', 'Your posts'], ['blog', 'About your blog']];
  const WEEK_MS = 7 * DAY;
  const myDomain = () => {
    const f = myFeed(); if (!f) return '';
    const h = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    return (isWeb(f.site) && h(f.site)) || h(f.url);
  };
  async function loadTalk() {
    if (!anySocial()) return;
    const tasks = [
      loadConversations(true),
      invoke('social_profiles').then(p => { SOC.profiles = p; }).catch(() => {}),
      invoke('social_followers').then(f => { SOC.followers = f; }).catch(() => {}),
      invoke('social_shared').then(c => { SOC.shared = c; }).catch(e => { SOC.shared = { posts: [], errors: [msg(e)] }; }),
    ];
    const d = myDomain();
    if (d) tasks.push(invoke('social_blog_mentions', { domain: d }).then(m => { SOC.mentions = m; }).catch(() => { SOC.mentions = []; }));
    else SOC.mentions = [];
    for (const t of tasks) t.then(() => { if (S.view === 'talk') { renderHead(); renderList(); } });
    loadReaders();
    await Promise.allSettled(tasks);
  }
  const fmtN = n => n >= 10000 ? (n / 1000).toFixed(0) + 'K' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n || 0);
  function profilesHtml() {
    const ps = SOC.profiles || [];
    if (!ps.length) return '';
    return `<div class="pstrip">${ps.map(p => {
      const fresh = (SOC.followers || []).filter(f => f.network === p.network && Date.now() - Date.parse(f.followed_at) < WEEK_MS).length;
      return `<button class="pcard" data-talk="open" data-url="${esc(p.url)}" title="Open your ${NET[p.network]} profile">
        <span class="pav">${isWeb(p.avatar) ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer">` : esc((p.name || '?')[0])}<span class="net">${ICON_NET[p.network]}</span></span>
        <span class="pwho"><b>${esc(p.name)}</b><span>${esc(p.handle)}</span></span>
        <span class="pnums"><span class="pnum"><strong>${fmtN(p.followers)}</strong><small>Followers</small>${fresh ? `<em>+${fresh} this week</em>` : ''}</span>
          <span class="pnum"><strong>${fmtN(p.following)}</strong><small>Following</small></span><span class="pnum"><strong>${fmtN(p.posts)}</strong><small>Posts</small></span></span></button>`;
    }).join('')}</div>`;
  }
  const normLink = u => (u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  function sharedHtml() {
    const c = SOC.shared;
    if (!c) return '<p class="note">Looking at what the people you follow are sharing…</p>';
    const groups = new Map();
    for (const n of c.posts) {
      const k = normLink(n.link); if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    let out = (c.errors || []).map(e => `<div class="banner err">${esc(e)}</div>`).join('');
    if (!groups.size) return out + '<p class="note">Nobody you follow has shared a link lately. As they do, the stories collect here.</p>';
    out += [...groups.values()].slice(0, 40).map(g => {
      const n = g.find(x => x.text && x.text.replace(/https?:\/\/\S+/g, '').trim()) || g[0];
      const people = [...new Map(g.map(x => [x.author.handle, x])).values()];
      const who = people[0], more = people.length - 1;
      const comment = (n.text || '').replace(/https?:\/\/\S+/g, '').trim();
      const site = hostOf(n.link);
      const it = S.items.find(i => normLink(i.link) === normLink(n.link));
      const followed = S.feeds.some(f => [hostOf(f.site || f.url), hostOf(f.url)].some(h => h && bareHost(h) === bareHost(site)));
      const own = who.author.handle.replace(/^@/, '').toLowerCase() === site;
      const thumb = isWeb(n.image) ? `<img class="thumb" src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-tile="${hueFor(site)}|${esc((site[0] || '•').toUpperCase())}">`
        : `<div class="thumb tile" style="--h:${hueFor(site)}"><span>${esc((site[0] || '•').toUpperCase())}</span></div>`;
      return `<article class="shared">${thumb}<div class="sh-body">
        <div class="sby">${isWeb(who.author.avatar) ? `<img class="av" src="${esc(who.author.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="av" style="background:hsl(${hueFor(who.author.handle)} 45% 42%)">${esc((who.author.name || '?')[0])}</span>`}
          <b>${esc(who.author.name)}</b>${more ? ` and <b>${more} other${more > 1 ? 's' : ''}</b>` : ''} ${who.via ? `(via ${esc(who.via)})` : 'shared'} · ${esc(fmtWhen(who.created_at))} <span class="n-net">${ICON_NET[who.network]}</span></div>
        <span class="site">${esc(site)}</span>
        <button class="sh-title" ${it ? `data-open="${esc(it.id)}"` : `data-talk="open" data-url="${esc(n.link)}"`}>${esc(n.link_title || site)}</button>
        ${n.link_description && !comment ? `<p class="sh-desc">${esc(n.link_description)}</p>` : ''}
        ${comment ? `<q>${esc(comment.length > 280 ? comment.slice(0, 280) + '…' : comment)}</q>` : ''}
        <div class="sacts"><button class="linkish" ${it ? `data-open="${esc(it.id)}"` : `data-talk="open" data-url="${esc(n.link)}"`}>Read</button>
          <button class="linkish" data-talk="reply" data-net="${n.network}" data-id="${esc(n.id)}" data-cid="${esc(n.cid)}" data-root="${esc(n.root_id)}" data-rootcid="${esc(n.root_cid)}" data-handle="${esc(n.author.handle)}">Reply</button>
          ${followed ? '<span class="sh-following">You follow this site</span>' : `<button class="linkish" data-talk="site" data-url="${esc('https://' + site + '/')}">${own ? 'Follow their blog' : 'Follow this site'}</button>`}
          <button class="linkish" data-talk="open" data-url="${esc(n.url)}">Open on ${NET[n.network]}</button></div>
        <div class="n-box" data-box="${esc(n.id)}"></div></div></article>`;
    }).join('');
    return out;
  }
  function repliesHtml() {
    const c = SOC.conv; if (!c) return '<p class="note">Checking Mastodon and Bluesky…</p>';
    const seen = socialSeen();
    return (SOC.err || []).map(e => `<div class="banner err">${esc(e)}</div>`).join('') + (c.replies.length
      ? `<div class="t-replies">${c.replies.slice(0, 40).map(n => `<div class="${Date.parse(n.created_at) > seen ? 't-new' : ''}">${noteHtml(n)}</div>`).join('')}</div>`
      : '<p class="note">No replies or mentions yet. When someone answers you, it shows up here.</p>');
  }
  function postsHtml() {
    const c = SOC.conv; if (!c) return '<p class="note">Checking Mastodon and Bluesky…</p>';
    return c.posts.length ? c.posts.map(postHtml).join('') : '<p class="note">Nothing posted yet. Open a story and choose Share › Post to Bluesky or Mastodon, or press New post.</p>';
  }
  function blogHtml(limit) {
    const d = myDomain();
    if (!d) return '<p class="note">Mark your own site first: open its feed and choose “This is my site.”</p>';
    const m = SOC.mentions;
    if (!m) return '<p class="note">Looking for people linking to your site…</p>';
    if (!m.length) return `<p class="note">Nobody has linked to ${esc(d)} lately${SOC.accounts.mastodon && !SOC.accounts.bluesky ? ' (Mastodon’s search only finds some posts)' : ''}.</p>`;
    return `<div class="t-replies">${m.slice(0, limit || 40).map(n => `<div>${noteHtml(n)}</div>`).join('')}</div>`;
  }
  function sideHtml() {
    let out = '';
    // Your newest post on your own site, ready to share
    const mine = myFeed();
    const post = mine && S.items.filter(i => i.feed_id === mine.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const shared = post && (store.get('shared:' + post.id) || (SOC.conv?.posts || []).some(p => normLink(p.link) === normLink(post.link)));
    if (post && !shared && Date.now() - Date.parse(post.date) < 4 * DAY) {
      out += `<div class="box"><h3>Your new post</h3><p>Published on ${esc(mine.title)} ${esc(fmtWhen(post.date))}. Share a copy that links home. <button class="b-link" data-guide-posse>What’s this?</button></p>
        <div class="newpost">${isWeb(post.image) ? `<img src="${esc(post.image)}" alt="" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}<b>${esc(post.title)}</b></div>
        <button class="btn primary" data-talk="sharemine" data-id="${esc(post.id)}">Share to ${['bluesky', 'mastodon'].filter(n => SOC.accounts[n]).map(n => NET[n]).join(' & ')}</button></div>`;
    }
    // New followers, with their blogs
    const hidF = hiddenIn('f'), fkey = f => f.network + ':' + f.person.id;
    const fol = (SOC.followers || []).filter(f => SOC.showHidden === 'f' ? hidF.has(fkey(f)) : !hidF.has(fkey(f))).slice(0, SOC.showHidden === 'f' ? 50 : 8);
    const folHidden = (SOC.followers || []).filter(f => hidF.has(fkey(f))).length;
    if (fol.length || folHidden) {
      const week = (SOC.followers || []).filter(f => Date.now() - Date.parse(f.followed_at) < WEEK_MS && !hidF.has(fkey(f)));
      const blogs = week.filter(f => f.blog).length;
      out += `<div class="box"><h3>New followers</h3><p>${week.length ? `${week.length} this week${blogs ? `. ${blogs === 1 ? 'One of them writes a blog' : `${blogs} of them write blogs`}.` : '.'}` : 'Your most recent followers.'}</p>
        ${fol.map(f => {
          const a = f.person, fh = f.blog && bareHost(hostOfU(f.blog)), followingSite = f.blog && S.feeds.some(x => [hostOfU(x.site), hostOfU(x.url)].some(h => h && bareHost(h) === fh));
          const btn = f.blog && SOC.added?.has(fh) ? `<button class="fbtn done-open" data-view="${SOC.added.get(fh)}">✓ Following · Open</button>`
            : f.blog && !followingSite ? `<button class="fbtn p" data-talk="blog" data-url="${esc(f.blog)}">Read their blog</button>`
            : !f.following ? `<button class="fbtn" data-talk="follow" data-net="${f.network}" data-person="${esc(a.id)}">Follow back</button>`
            : '<span class="fbtn done">Following</span>';
          return `<div class="fol">${isWeb(a.avatar) ? `<img class="av" src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="av" style="background:hsl(${hueFor(a.handle)} 45% 42%)">${esc((a.name || '?')[0])}</span>`}
            <button class="fol-who" data-talk="open" data-url="${esc(a.url)}">${esc(a.name)}<small class="${f.blog ? 'blog' : ''}">${f.blog ? `writes at ${esc(hostOf(f.blog))}` : esc(a.handle)}</small></button>${SOC.showHidden === 'f' ? `<button class="fbtn" data-talk="unhide" data-k="f" data-key="${esc(fkey(f))}">Show again</button>` : btn + xBtn('f', fkey(f), `Remove ${a.handle} from this list`, `data-net="${f.network}" data-person="${esc(a.id)}" data-name="${esc(a.handle)}"`)}</div>`;
        }).join('')}${hiddenFoot('f', folHidden)}</div>`;
    }
    // People you read who are on Mastodon or Bluesky and you don't follow there yet
    const hidR = hiddenIn('r');
    const allNotYet = (SOC.readers || []).filter(r => !r.following && feedById(r.feedId));
    const notYet = allNotYet.filter(r => SOC.showHidden === 'r' ? hidR.has(String(r.feedId)) : !hidR.has(String(r.feedId)));
    const readersHidden = new Set(allNotYet.filter(r => hidR.has(String(r.feedId))).map(r => r.feedId)).size;
    if (notYet.length || readersHidden) {
      const byPerson = new Map();
      for (const r of notYet) { if (!byPerson.has(r.feedId)) byPerson.set(r.feedId, []); byPerson.get(r.feedId).push(r); }
      const people = [...byPerson.entries()], show = SOC.allReaders ? people : people.slice(0, 6);
      out += `<div class="box"><h3>People you read</h3><p>${!people.length ? 'Nobody new to follow.' : people.length === 1 ? 'One writer you read is' : `${people.length} writers you read are`} on ${['bluesky', 'mastodon'].filter(n => SOC.accounts[n]).map(n => NET[n]).join(' or ')}. Follow them there to talk with them.</p>
        ${show.map(([fid, rs]) => { const f = feedById(fid), a = rs[0].person; return `<div class="fol">${isWeb(a.avatar) ? `<img class="av" src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="av" style="background:hsl(${hueFor(f.url)} 45% 42%)">${esc((f.title || '?')[0])}</span>`}
          <button class="fol-who" data-view="${f.id}">${esc(f.title)}<small>${rs.map(r => esc(r.person.handle)).join(' · ')}</small></button>
          ${SOC.showHidden === 'r' ? `<button class="fbtn" data-talk="unhide" data-k="r" data-key="${fid}">Show again</button>`
            : `<span class="fbtns">${rs.map(r => `<button class="fbtn" data-talk="follow" data-net="${r.network}" data-person="${esc(r.person.id)}" title="Follow ${esc(r.person.handle)} on ${NET[r.network]}">${ICON_NET[r.network]} Follow</button>`).join('')}</span>${xBtn('r', String(fid), `Don’t suggest ${f.title}`)}`}</div>`; }).join('')}
        ${people.length > 6 ? `<button class="linkish more-r" data-talk="allreaders">${SOC.allReaders ? 'Show fewer' : `Show all ${people.length}`}</button>` : ''}${hiddenFoot('r', readersHidden)}</div>`;
    }
    // People you follow there who keep a blog you don't read yet
    const have = new Set(S.feeds.flatMap(f => [hostOfU(f.site), hostOfU(f.url)].filter(Boolean).map(bareHost)));
    const hidB = hiddenIn('b'), bkey = b => bareHost(hostOfU(b.blog));
    const allBlogs = (SOC.theirBlogs || []).filter(b => !have.has(bkey(b)) || SOC.added?.has(bkey(b)));
    const blogs = allBlogs.filter(b => SOC.showHidden === 'b' ? hidB.has(bkey(b)) : !hidB.has(bkey(b)));
    const blogsHidden = allBlogs.filter(b => hidB.has(bkey(b))).length;
    if (blogs.length || blogsHidden) {
      const show = SOC.allBlogs ? blogs : blogs.slice(0, 6);
      out += `<div class="box"><h3>Their blogs</h3><p>${!blogs.length ? 'Nothing new to suggest.' : blogs.length === 1 ? 'Someone you follow keeps a blog' : `${blogs.length} people you follow keep blogs`} you don’t read here yet.</p>
        ${show.map(b => { const a = b.person; return `<div class="fol">${isWeb(a.avatar) ? `<img class="av" src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="av" style="background:hsl(${hueFor(a.handle)} 45% 42%)">${esc((a.name || '?')[0])}</span>`}
          <button class="fol-who" data-talk="open" data-url="${esc(b.blog)}">${esc(a.name)}<small class="blog">${esc(hostOfU(b.blog))}</small>${SOC.blogErr?.has(bkey(b)) ? `<small class="fol-err">${esc(SOC.blogErr.get(bkey(b)))}</small>` : ''}</button>
          ${SOC.added?.has(bkey(b)) ? `<button class="fbtn done-open" data-view="${SOC.added.get(bkey(b))}">✓ Following · Open</button>` : SOC.showHidden === 'b' ? `<button class="fbtn" data-talk="unhide" data-k="b" data-key="${esc(bkey(b))}">Show again</button>`
            : `<button class="fbtn p" data-talk="blog" data-url="${esc(b.blog)}">Read their blog</button>${xBtn('b', bkey(b), `Don’t suggest ${hostOfU(b.blog)}`)}`}</div>`; }).join('')}
        ${blogs.length > 6 ? `<button class="linkish more-r" data-talk="allblogs">${SOC.allBlogs ? 'Show fewer' : `Show all ${blogs.length}`}</button>` : ''}${hiddenFoot('b', blogsHidden)}</div>`;
    }
    // People linking to your blog
    if (myDomain() && SOC.mentions && SOC.mentions.length) out += `<div class="box"><h3>About your blog</h3><p>People linking to ${esc(myDomain())}</p>
      ${SOC.mentions.slice(0, 3).map(n => `<button class="talk" data-talk="tab" data-tab="blog"><small>${esc(n.author.name)} · ${NET[n.network]} · ${esc(fmtWhen(n.created_at))}</small>${esc(n.text.length > 160 ? n.text.slice(0, 160) + '…' : n.text)}</button>`).join('')}</div>`;
    return out;
  }
  function talkHtml() {
    if (!anySocial()) return `<div class="empty"><strong>Talk about what you read</strong><span>Connect your Mastodon or Bluesky account to share stories with your thoughts, see what the people you follow are sharing, and answer replies here.</span><span>Have a site of your own? Post there first, then share it here. <button class="b-link" data-guide-posse>How that works</button></span><button class="btn primary" id="talkConnect">Connect an account</button></div>`;
    const tab = SOC.tab || 'shared';
    const counts = { replies: newReplies(), blog: (SOC.mentions || []).filter(n => Date.parse(n.created_at) > socialSeen()).length };
    const body = tab === 'replies' ? repliesHtml() : tab === 'posts' ? postsHtml() : tab === 'blog' ? blogHtml() : sharedHtml();
    const titles = { shared: ['Shared by people you follow', 'Only the posts that share something to read. No doom-scrolling.'], replies: ['Replies and mentions', ''], posts: ['Your posts', 'Open one to read and answer the replies.'], blog: ['About your blog', `People linking to ${esc(myDomain() || 'your site')}.`] };
    return `${profilesHtml()}
      <div class="ttabs" role="tablist">${TALK_TABS.map(([k, label]) => `<button role="tab" data-talk="tab" data-tab="${k}" aria-pressed="${tab === k}">${label}${counts[k] ? `<span class="tcount">${counts[k]}</span>` : ''}</button>`).join('')}</div>
      <div class="tcols"><div class="tmain"><h2 class="sec-t">${titles[tab][0]}</h2>${titles[tab][1] ? `<p class="sec-s">${titles[tab][1]}</p>` : ''}${body}</div>
        <aside class="tside">${sideHtml()}</aside></div>`;
  }
  async function toggleThread(net, id) {
    if (SOC.open.has(id)) { SOC.open.delete(id); renderList(); return; }
    SOC.open.add(id); renderList();
    try { SOC.threads.set(id, await invoke('social_thread', { network: net, id })); }
    catch (e) { SOC.threads.set(id, []); status(msg(e), true); }
    renderList();
  }
  function replyBox(b) {
    document.querySelectorAll('.n-box').forEach(x => { x.innerHTML = ''; });
    const box = [...document.querySelectorAll('.n-box')].find(x => x.dataset.box === b.dataset.id); if (!box) return;
    const net = b.dataset.net, start = net === 'mastodon' && b.dataset.handle ? `${b.dataset.handle} ` : '';
    box.innerHTML = `<form class="n-form"><textarea rows="3" maxlength="${LIMIT[net]}">${esc(start)}</textarea><div class="row"><button class="btn" type="button" data-talk="cancel">Cancel</button><button class="btn primary" type="submit">Reply on ${NET[net]}</button></div></form>`;
    const ta = box.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    box.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const btn = box.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await invoke('social_reply', { network: net, text: ta.value, parentId: b.dataset.id, parentCid: b.dataset.cid || '', rootId: b.dataset.root || '', rootCid: b.dataset.rootcid || '' });
        status('Reply sent.'); box.innerHTML = '';
        const root = b.dataset.root || b.dataset.id; if (SOC.open.has(root)) { SOC.threads.delete(root); SOC.open.delete(root); toggleThread(net, root); }
      } catch (err) { status(msg(err), true); btn.disabled = false; btn.textContent = `Reply on ${NET[net]}`; }
    };
  }
  function moreMenu(b) {
    const menu = $('replyMenu');
    menu.innerHTML = `<p class="menu-head">${esc(b.dataset.name)}</p>
      <button type="button" data-mod="mute">Mute ${esc(b.dataset.name)}</button>
      <button type="button" data-mod="block">Block ${esc(b.dataset.name)}</button>
      <button type="button" data-mod="report">Report this post…</button>`;
    placeMenu(menu, b);
    menu.onclick = async e => {
      const m = e.target.closest('[data-mod]'); if (!m) return; menu.hidden = true; menu.onclick = null;
      let reason = '';
      if (m.dataset.mod === 'report') { reason = await askReason(b.dataset.name); if (reason === null) return; }
      try {
        await invoke('social_moderate', { network: b.dataset.net, action: m.dataset.mod, person: b.dataset.person, postId: b.dataset.id, postCid: b.dataset.cid || '', reason });
        status(m.dataset.mod === 'report' ? 'Reported. Thank you.' : `${m.dataset.mod === 'mute' ? 'Muted' : 'Blocked'} ${b.dataset.name}.`);
        loadConversations(true);
      } catch (err) { status(msg(err), true); }
    };
  }
  // A follower you don't want: just hide them, block them (which also stops them following you), or report as spam
  function followerMenu(b) {
    const menu = $('replyMenu'), name = b.dataset.name, net = b.dataset.net;
    menu.innerHTML = `<p class="menu-head">${esc(name)}</p>
      <button type="button" data-fm="hide">Hide from this list</button>
      <button type="button" data-fm="block">Block ${esc(name)}</button>
      <button type="button" data-fm="spam">Report as spam and block</button>`;
    placeMenu(menu, b);
    menu.onclick = async e => {
      const m = e.target.closest('[data-fm]'); if (!m) return; menu.hidden = true; menu.onclick = null;
      setHidden('f', b.dataset.key, true);
      if (m.dataset.fm === 'hide') { status(`Hid ${name}.`); return; }
      try {
        if (m.dataset.fm === 'spam') await invoke('social_moderate', { network: net, action: 'report', person: b.dataset.person, postId: '', postCid: '', reason: 'spam' });
        await invoke('social_moderate', { network: net, action: 'block', person: b.dataset.person, postId: '', postCid: '', reason: '' });
        status(m.dataset.fm === 'spam' ? `Reported ${name} as spam and blocked them. They no longer follow you.` : `Blocked ${name}. They no longer follow you.`);
      } catch (err) { status(msg(err), true); }
    };
  }
  function askReason(name) {
    return new Promise(done => {
      const el = sheet('reportPanel', `<h2>Report a post by ${esc(name)}</h2>
        <p>Your report goes to the moderators of that network, who decide what happens. Say briefly what’s wrong.</p>
        <textarea id="repText" rows="3" placeholder="Spam, harassment, something else…"></textarea>
        <div class="row sheet-foot"><button class="btn" type="button" id="repCancel">Cancel</button><button class="btn primary" type="button" id="repSend">Send report</button></div>`, 'Report a post');
      $('repText').focus();
      $('repCancel').onclick = () => { el.hidden = true; done(null); };
      $('repSend').onclick = () => { el.hidden = true; done($('repText').value.trim() || 'Reported from The Reading Room'); };
    });
  }
  document.addEventListener('click', e => {
    if (e.target.id === 'talkConnect') { openAccounts(); return; }
    if (e.target.id === 'talkRefresh') { SOC.shared = null; SOC.mentions = null; loadTalk(); return; }
    const b = e.target.closest('[data-talk]'); if (!b) return;
    const k = b.dataset.talk;
    if (k === 'thread') toggleThread(b.dataset.net, b.dataset.id);
    if (k === 'open' && isWeb(b.dataset.url)) openWeb(b.dataset.url);
    if (k === 'reply') replyBox(b);
    if (k === 'cancel') b.closest('.n-box').innerHTML = '';
    if (k === 'more') moreMenu(b);
    if (k === 'tab') { SOC.tab = b.dataset.tab; renderList(); $('main').scrollTo({ top: 0 }); if (b.dataset.tab === 'replies' || b.dataset.tab === 'blog') setTimeout(() => { store.set('socialSeen', String(Date.now())); renderRail(); }, 3000); }
    if (k === 'newpost') openCompose(null);
    if (k === 'sharemine') { const it = item(b.dataset.id); if (it) openCompose(it, null, true); }
    if (k === 'dismiss') { setHidden(b.dataset.k, b.dataset.key, true); status('Removed from the list. “Hidden” at the bottom of the box brings it back.'); }
    if (k === 'unhide') setHidden(b.dataset.k, b.dataset.key, false);
    if (k === 'showhidden') { SOC.showHidden = SOC.showHidden === b.dataset.k ? null : b.dataset.k; renderList(); }
    if (k === 'folmenu') followerMenu(b);
    if (k === 'allreaders') { SOC.allReaders = !SOC.allReaders; renderList(); }
    if (k === 'allblogs') { SOC.allBlogs = !SOC.allBlogs; renderList(); }
    if (k === 'follow') {
      const was = b.innerHTML;
      b.disabled = true; b.textContent = 'Following…';
      invoke('social_follow', { network: b.dataset.net, person: b.dataset.person })
        .then(() => {
          const id = b.dataset.person;
          for (const x of SOC.followers || []) if (x.person.id === id) x.following = true;
          for (const x of SOC.readers || []) if (x.person.id === id) x.following = true;
          renderList(); renderHead(); status('Following.');
        })
        .catch(e => { b.disabled = false; b.innerHTML = was; status(msg(e), true); });
    }
    if (k === 'blog' || k === 'site') {
      const host = bareHost(hostOfU(b.dataset.url));
      b.disabled = true; b.textContent = 'Adding…'; SOC.blogErr?.delete(host);
      invoke('add_feed', { url: b.dataset.url, title: null, folderId: null })
        .then(r => { (SOC.added = SOC.added || new Map()).set(host, r.id); status(`Following ${r.title}. Their posts are in All${k === 'blog' ? ' and People' : ''}.`); return load(); })
        .then(() => renderList())
        .catch(e => { (SOC.blogErr = SOC.blogErr || new Map()).set(host, msg(e)); b.disabled = false; b.textContent = k === 'blog' ? 'Read their blog' : 'Follow this site'; status(msg(e), true); renderList(); });
    }
  });
  loadAccounts().then(() => { renderRail(); loadConversations(true); });
  setInterval(() => { if (!document.hidden) loadConversations(true); }, 15 * 60 * 1000);

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
  let typePrefs = (() => {
    // Big screens start with bigger article text
    const base = { ...TYPE_DEFAULT, font: 'serif', ui: 1, ...(window.innerWidth >= 1700 ? { size: Math.max(TYPE_DEFAULT.size, 20) } : {}) };
    try { return { ...base, ...JSON.parse(localStorage.getItem('readerPrefs') || '{}') }; } catch { return base; }
  })();
  const WIDTHS = { narrow: ['58ch', '680px'], medium: ['68ch', '760px'], wide: ['82ch', '920px'] };
  function applyType() {
    const root = document.documentElement;
    root.style.setProperty('--read-size', typePrefs.size + 'px');
    root.style.setProperty('--measure', WIDTHS[typePrefs.width][0]);
    root.style.setProperty('--reader-max', WIDTHS[typePrefs.width][1]);
    if (typePrefs.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = typePrefs.theme;
    root.dataset.readFont = typePrefs.font;
    root.style.zoom = typePrefs.ui === 1 ? '' : String(typePrefs.ui); // text size for the whole app
    document.querySelectorAll('#fontSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.font === typePrefs.font)));
    document.querySelectorAll('#uiSeg button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.ui) === typePrefs.ui)));
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
    if (b.dataset.font) typePrefs.font = b.dataset.font;
    if (b.dataset.ui) typePrefs.ui = Number(b.dataset.ui);
    applyType();
  });

  // ---- sharing
  let shareItem = null;
  function openShareMenu(anchor, it) {
    if (!it) return;
    // iPhone and iPad: the system share sheet (Messages, Mail, X, LinkedIn, Copy and the rest).
    if (IOS && navigator.share && isWeb(it.link) && !anySocial()) {
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
    if (kind === 'bluesky' || kind === 'mastodon') { openCompose(it, kind); return; }
    if (kind === 'sheet') { navigator.share?.({ title: it.title, url: it.link }).catch(() => {}); return; }
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
    if (e.target.closest('[data-guide-posse]')) { closeReader(true); selectView('guide'); setTimeout(() => document.getElementById('g-posse')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); return; }
    const gf = e.target.closest('[data-guide-follow]');
    if (gf) { guideFollow(gf.dataset.guideFollow, gf); return; }
    if (e.target.id === 'guideMutes') { openMutes(); return; }
    if (e.target.id === 'welcomeX') { store.set('guideSeen', '1'); hideBanner(); return; }
    const jz = e.target.closest('[data-job]');
    if (jz) { jobAction(jz); return; }
    const tz = e.target.closest('[data-topic]');
    if (tz) { topicAction(tz); return; }
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
  document.addEventListener('submit', e => {
    if (e.target.id !== 'topicForm') return;
    e.preventDefault(); topicSearch($('topicQ').value);
  });
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
  // View › Bigger / Smaller / Actual Size text (⌘+ ⌘− ⌘0)
  const UI_STEPS = [0.92, 1, 1.1, 1.2, 1.3];
  const uiStep = d => { const i = UI_STEPS.indexOf(typePrefs.ui); typePrefs.ui = d === 0 ? 1 : UI_STEPS[Math.max(0, Math.min(UI_STEPS.length - 1, (i < 0 ? 1 : i) + d))]; applyType(); };
  listen('menu-text-bigger', () => uiStep(1));
  listen('menu-text-smaller', () => uiStep(-1));
  listen('menu-text-reset', () => uiStep(0));
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
