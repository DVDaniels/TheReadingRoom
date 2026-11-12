// The Reading Room — the window's behaviour. Talks to the Rust side through Tauri commands.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  const $ = id => document.getElementById(id);
  // view: 'today' | 'all' | 'saved' | 'annotated' | 'recent' | 'folder:<id>' | <feed id number>
  const S = { prefs: {}, kinds: new Map(), folders: [], feeds: [], items: [], highlights: [], mutes: [], lists: [], also: new Map(), hiddenMuted: 0, readerId: null, view: 'today', unreadOnly: true, keep: new Set(), selId: null, q: '', shown: 60, refreshing: false, lastRefresh: null };
  // Mastodon and Bluesky (see that section)
  const SOC = { accounts: {}, conv: null, loading: false, open: new Set(), threads: new Map(), whole: new Map(), rootOf: new Map(), wideOpen: new Set(), err: [], tab: 'blogs', profiles: null, followers: null, shared: null, mentions: null, readers: null, theirBlogs: null };
  const NET = { bluesky: 'Bluesky', mastodon: 'Mastodon' };
  const anySocial = () => !!(SOC.accounts.bluesky || SOC.accounts.mastodon);
  const socialSeen = () => { try { return Number(localStorage.getItem('socialSeen')) || 0; } catch { return 0; } };
  const newReplies = () => (SOC.conv?.replies || []).filter(r => Date.parse(r.created_at) > socialSeen()).length;
  // Discover's results (see the Discover section)
  const D = { report: null, running: false, done: 0, total: 0, open: new Set(), busy: new Set(), q: '', searching: false, res: null, added: new Map(), imgs: new Map(), small: null, smallErr: '', smallMore: false };
  const ICONS = {
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>',
    site: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" width="18" height="18"><path d="M4 11l8-6.5 8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>',
    books: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5z"/><path d="M12 6v13.5"/></svg>',
    jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    saved: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>',
    unread: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>',
    edition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2h-1M7.5 8.5h6M7.5 12h6M7.5 15.5h4"/></svg>',
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
  // Folders go two levels deep: top-level folders, and folders inside them (inside a folder, its folders come first, then its feeds)
  const parentOf = f => (f && f.parent_id ? folderById(f.parent_id) : null);
  const isTopFolder = f => !parentOf(f);
  const subfoldersOf = f => S.folders.filter(x => x.parent_id === f.id && x.id !== f.id);
  const folderIdsIn = f => [f.id, ...subfoldersOf(f).map(x => x.id)];
  const folderLabel = f => (parentOf(f) ? `${parentOf(f).name} › ${f.name}` : f.name);
  // Followed lists (dynamic OPML): each keeps its feeds in a folder of its own.
  const listOfFolder = id => S.lists.find(l => l.folder_id === id) || null;
  const LIST_MARK = '<span class="listmark" title="A followed list: feeds that join it are added for you" aria-label="Followed list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12M8 12h12M8 18h7"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg></span>';
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
  // Sidebar groups (Read, Explore, Library) can be folded too; also remembered between launches.
  const foldedGroups = new Set((() => { try { return JSON.parse(localStorage.getItem('foldedGroups') || '[]'); } catch { return []; } })());
  const saveFoldedGroups = () => { try { localStorage.setItem('foldedGroups', JSON.stringify([...foldedGroups])); } catch {} };

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
  // Email: one mailbox of your own, read in its own tab. Its stories live in a feed of their own, kept out of the sidebar's feeds.
  const EMAIL_FEED = 'saved:email';
  const isEmailFeed = f => !!f && f.url === EMAIL_FEED;
  const isEmailItem = i => isEmailFeed(feedById(i.feed_id));
  const MAIL = { account: null, checking: false, last: 0, error: '' };
  function inScope(i, view = S.view) {
    if (view === 'email') return isEmailItem(i);
    if ((view === 'all' || view === 'today' || view === 'people') && isEmailItem(i)) return false; // your mail stays in Email
    if (view === 'jobs') return isJobItem(i);
    if ((view === 'all' || view === 'today' || view === 'people') && isJobItem(i)) return false;
    if (view === 'all') return true;
    if (view === 'today') return isToday(i);
    if (view === 'saved') return i.saved;
    if (view === 'recent') return !!i.read_at;
    if (view === 'annotated') return S.highlights.some(h => h.item_id === i.id);
    if (view === 'discover' || view === 'guide' || view === 'talk' || view === 'books') return false;
    if (view === 'people') return isPerson(i.feed_id);
    const folder = folderOf(view);
    if (folder) { const f = feedById(i.feed_id); return !!f && folderIdsIn(folder).includes(f.folder_id); }
    return String(i.feed_id) === String(view);
  }
  const usesUnreadFilter = () => !['saved', 'recent', 'annotated', 'discover', 'guide', 'talk', 'jobs', 'books', 'edition'].includes(S.view);
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
  const srcLabel = it => isEmailItem(it) ? (it.byline || 'Email') : viaNews(it) ? outletOf(it) : (feedById(it.feed_id)?.title || '');
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

  // ---- posts behind a paywall: a lock tag, unless you've said you subscribe to that site
  // Sites that usually need a subscription. Posts the feed itself marks as paid (Substack, Ghost…) come with it.paid.
  const PAYWALLED = ['nytimes.com', 'wsj.com', 'washingtonpost.com', 'ft.com', 'economist.com', 'theatlantic.com', 'newyorker.com',
    'bloomberg.com', 'wired.com', 'theinformation.com', 'businessinsider.com', 'technologyreview.com', 'latimes.com', 'bostonglobe.com',
    'theathletic.com', 'foreignaffairs.com', 'harpers.org', 'hbr.org', 'barrons.com', 'newscientist.com', 'thetimes.co.uk',
    'telegraph.co.uk', 'charlotteobserver.com', 'seattletimes.com', 'chicagotribune.com', 'nymag.com', 'vanityfair.com'];
  const onList = (h, list) => !!h && list.some(d => h === d || h.endsWith('.' + d));
  const paidHosts = f => [...new Set([hostOfU(f?.site || ''), hostOfU(f?.url || '')].filter(Boolean))];
  const subscribedTo = hosts => hosts.some(h => onList(h, S.prefs.subscribed || []));
  /** '' when free to read; otherwise the tag's word */
  function paywall(it) {
    if (!it || isEmailItem(it)) return '';
    const f = feedById(it.feed_id), hosts = [hostOfU(it.link), ...paidHosts(f)].filter(Boolean);
    if (subscribedTo(hosts)) return '';
    if (it.paid) return 'Members';
    return hosts.some(h => onList(h, PAYWALLED)) && !viaNewsLink(it) ? 'Subscribers' : '';
  }
  const viaNewsLink = it => hostOfU(it.link) === 'news.google.com';
  const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="2.5" y="7" width="11" height="8" rx="2" fill="currentColor"/></svg>';
  const paidTag = it => { const w = paywall(it); return w ? `<span class="paid" title="${w === 'Members' ? 'This post is for paying members' : 'This site usually needs a subscription'}">${LOCK}${w}</span>` : ''; };
  /** Does this feed's site need a subscription (so the feed bar offers "I subscribe")? */
  const feedPaywalled = f => paidHosts(f).some(h => onList(h, PAYWALLED)) || S.items.some(i => i.feed_id === f.id && i.paid);
  const feedSubscribed = f => subscribedTo(paidHosts(f));
  function toggleSubscribed(f) {
    const hosts = paidHosts(f), on = feedSubscribed(f);
    const list = S.prefs.subscribed || [];
    S.prefs.subscribed = on ? list.filter(d => !hosts.some(h => h === d || h.endsWith('.' + d))) : [...new Set([...list, hosts[0]])];
    savePrefs();
    status(on ? `Posts from ${f.title} will show the lock again.` : `No more locks on ${f.title}. Its posts open where you're signed in.`);
    render();
  }
  const bareHost = h => h.replace(/^(blog|www|en)\./, '');
  const socialNet = f => /bsky\.app\/profile\//.test(f?.url || '') ? 'bluesky' : isSocialFeed(f) ? 'mastodon' : '';
  const profileOf = f => (f.url || '').replace(/\/rss$/, '').replace(/\.rss$/, '');
  const siteOf = f => { try { return new URL(isWeb(f.site) ? f.site : f.url).origin + '/'; } catch { return ''; } };
  // (localStorage directly: the store helper is defined further down, after this runs)
  let PL = (() => { try { return JSON.parse(localStorage.getItem('plinks') || '{}') || {}; } catch { return {}; } })(); // site → {at, links}
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
      .filter(site => !(PL[site]?.at > weekAgo && 'icon' in PL[site])); // (icon: looked for since 1.2.4)
    if (!sites.length) return;
    scanningSites = true;
    try {
      const res = await invoke('site_accounts', { sites });
      for (const r of res) PL[r.site] = { at: Date.now(), links: r.links, icon: r.icon || '' };
      store.set('plinks', JSON.stringify(PL));
      buildPersons(); render();
      if (S.view === 'talk') loadReaders(true);
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
    if (S.freeOnly && usesUnreadFilter() && S.view !== 'email') list = list.filter(i => !paywall(i) || S.keep.has(i.id));
    if (S.q) { const q = S.q.toLowerCase(); list = list.filter(i => (i.title + ' ' + i.summary).toLowerCase().includes(q)); }
    if (S.view === 'recent') list = [...list].sort((a, b) => (b.read_at || '').localeCompare(a.read_at || ''));
    else if (usesUnreadFilter()) list = collapseDuplicates(list);
    else S.also = new Map();
    return list;
  }
  const unreadIn = view => S.items.filter(i => !i.read && inScope(i, view) && !(mutesApply(view) && isMuted(i)) && !isFolded(i, view)).length;

  // ------------------------------------------------------------ render: sidebar
  function navButton(view, label, count, { icon = '', fav = null, err = '', title = '', ini = '', mark = '' } = {}) {
    const lead = ini ? `<span class="slim-ini" style="background:hsl(${hueFor(ini)} 35% 40%)">${esc((ini.trim()[0] || '?').toUpperCase())}</span>`
      : icon ? `<span class="navicon">${icon}</span>`
      : fav ? `<span class="fav" style="background:hsl(${hueFor(fav.url)} 45% 42%)">${esc((fav.title || '?').trim()[0] || '?')}</span>` : '';
    const tail = err ? '<span class="err" aria-label="Problem with this feed"></span>' : `<span class="count">${fmtCount(count)}</span>`;
    return `<button data-view="${esc(String(view))}" aria-current="${String(S.view) === String(view)}" title="${esc(title || label)}"${fav ? ` draggable="true" data-feed="${fav.id}"` : ''}>${lead}<span class="name">${esc(label)}</span>${mark}${tail}</button>`;
  }
  const feedButton = f => navButton(f.id, f.title, unreadIn(f.id), { fav: f, err: f.status === 'error', title: f.status === 'error' ? f.error : f.url });

  let lastBadge = -1;
  function renderRail() {
    // The Dock icon shows the same number as Today
    const todayN = unreadIn('today');
    if (todayN !== lastBadge) { lastBadge = todayN; invoke('set_badge', { n: todayN }).catch(() => {}); }
    // Read · Explore · Library, each under a heading that folds it away. A folded heading shows the
    // group's total, and the view you're on stays visible even when its group is folded.
    // Folding is off in the icon-only sidebar and the narrow chip strip, which show every view.
    const canFold = !document.body.classList.contains('rail-slim') && !(phoneSize.matches && !document.documentElement.classList.contains('ios'));
    const group = (id, name, items) => {
      const open = !canFold || !foldedGroups.has(id);
      const total = items.reduce((n, it) => n + (Number(it.count) || 0), 0);
      const shown = open ? items : items.filter(it => String(S.view) === it.view);
      return `<button class="grp" type="button" data-group="${id}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${name}">`
        + `<span class="grp-chev">${ICONS.chev}</span><span class="grp-name">${name}</span>`
        + `<span class="count">${open || !total ? '' : fmtCount(total)}</span></button>`
        + shown.map(it => navButton(it.view, it.label, it.count, { icon: it.icon })).join('');
    };
    $('views').innerHTML =
      group('read', 'Read', [
        { view: 'today', label: 'Today', count: unreadIn('today'), icon: ICONS.today },
        { view: 'people', label: 'People', count: unreadIn('people'), icon: ICONS.people },
        { view: 'edition', label: 'Morning Edition', count: '', icon: ICONS.edition },
        { view: 'email', label: 'Email', count: unreadIn('email'), icon: ICONS.email }]) +
      '<hr class="nav-gap">' +
      group('explore', 'Explore', [
        { view: 'discover', label: 'Discover', count: newSuggestions() || '', icon: ICONS.discover },
        { view: 'talk', label: 'Conversations', count: (newYou() + newAnswers() + nbUnread().length) || '', icon: ICONS.talk },
        { view: 'jobs', label: 'Help Wanted', count: newJobs() || '', icon: ICONS.jobs }]) +
      '<hr class="nav-gap">' +
      group('library', 'Library', [
        { view: 'books', label: 'Books', count: '', icon: ICONS.books },
        { view: 'saved', label: 'Read later', count: S.items.filter(i => i.saved).length, icon: ICONS.later },
        { view: 'annotated', label: 'Annotated', count: new Set(S.highlights.map(h => h.item_id)).size, icon: ICONS.notes },
        { view: 'recent', label: 'Recently read', count: '', icon: ICONS.recent }]);

    // The Feeds heading folds the whole list away like the groups above; the feed or folder you're on stays
    const feedsOpen = !canFold || !foldedGroups.has('feeds');
    const fg = $('feedsGrp');
    if (fg) {
      fg.setAttribute('aria-expanded', String(feedsOpen));
      fg.setAttribute('aria-label', `${feedsOpen ? 'Collapse' : 'Expand'} Feeds`);
      const total = unreadIn('all');
      fg.querySelector('.count').textContent = feedsOpen || !total ? '' : fmtCount(total);
    }
    if (!feedsOpen) {
      const v = String(S.view), f = folderOf(S.view);
      $('feeds').innerHTML = v === 'all' ? navButton('all', 'All', unreadIn('all'), { icon: ICONS.all })
        : f ? navButton('folder:' + f.id, f.name, unreadIn('folder:' + f.id), { ini: f.name })
        : feedById(S.view) && !isJobFeed(feedById(S.view)) ? feedButton(feedById(S.view)) : '';
      return;
    }
    let html = navButton('all', 'All', unreadIn('all'), { icon: ICONS.all });
    const folderBlock = (folder, sub) => {
      const open = !collapsed.has(folder.id);
      const inside = S.feeds.filter(f => f.folder_id === folder.id && !isJobFeed(f) && !isEmailFeed(f));
      const subs = sub ? [] : subfoldersOf(folder);
      const fl = listOfFolder(folder.id);
      let h = `<div class="folder${fl ? ' is-list' : ''}${sub ? ' subfolder' : ''}" data-folder="${folder.id}">
          <button class="chev" data-chev="${folder.id}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(folder.name)}">${ICONS.chev}</button>
          ${navButton('folder:' + folder.id, folder.name, unreadIn('folder:' + folder.id), { ini: folder.name, mark: fl ? LIST_MARK : '', title: fl ? `${folder.name}: a followed list` : folderLabel(folder) }).replace('<button ', '<button draggable="true" ')}
        </div>`;
      if (open) h += `<div class="infolder${sub ? ' insub' : ''}" data-folder="${folder.id}">${subs.map(x => folderBlock(x, true)).join('')}${inside.map(feedButton).join('')}`
        + (!inside.length && !subs.length ? `<span class="note" style="padding:2px 0 6px ${sub ? 60 : 34}px;display:block">Drag feeds here</span>` : '') + '</div>';
      return h;
    };
    for (const folder of S.folders.filter(isTopFolder)) html += folderBlock(folder, false);
    const loose = S.feeds.filter(f => (!f.folder_id || !folderById(f.folder_id)) && !isJobFeed(f) && !isEmailFeed(f));
    if (loose.length && S.folders.length) html += '<hr>';
    html += loose.map(feedButton).join('');
    if (!S.feeds.length) html += '<span class="note" style="padding:0 10px">No feeds yet. Add one below.</span>';
    $('feeds').innerHTML = html;
  }

  // ------------------------------------------------------------ render: header
  function viewName() {
    const names = { today: 'Today', all: 'All stories', saved: 'Read later', annotated: 'Annotated', recent: 'Recently read', discover: 'Discover', people: 'People', guide: 'How to use The Reading Room', edition: 'The Morning Edition', talk: 'Conversations', jobs: 'Help Wanted', books: 'Books', email: 'Email' };
    if (names[S.view]) return names[S.view];
    const folder = folderOf(S.view); if (folder) return folder.name;
    return feedById(S.view)?.title || 'Feed';
  }
  function folderOptions(selected) {
    const opt = f => `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>${esc(folderLabel(f))}</option>`;
    return `<option value="">No folder</option>` + S.folders.filter(isTopFolder).map(f => opt(f) + subfoldersOf(f).map(opt).join('')).join('');
  }

  // Full-window pages: Discover, the guide and Conversations always; Help Wanted until you open an ad,
  // then it sits beside the reader like any list, with Back to close the ad.
  function syncWide() {
    document.body.classList.toggle('discover-view', ['discover', 'guide', 'talk', 'books'].includes(S.view) || ((S.view === 'jobs' || S.view === 'edition') && !S.readerId));
    document.body.classList.toggle('books-view', S.view === 'books');
    document.body.classList.toggle('jobs-view', S.view === 'jobs');
    // a post opened from Conversations takes the whole window; Back returns to the stream where you were
    document.body.classList.toggle('talk-reading', S.view === 'talk' && !!S.readerId);
    document.body.classList.toggle('talk-view', S.view === 'talk');
  }
  // Conversations' title row: the tabs, New note and a refresh icon, pinned as you scroll
  function talkTabsInfo() {
    const tabsOn = TALK_TABS.filter(([k]) => k !== 'shared' || anySocial());
    let tab = SOC.tab || 'blogs';
    if (!tabsOn.some(([k]) => k === tab)) tab = 'blogs';
    return { tabsOn, tab };
  }
  function paintTalkHead() {
    const el = $('talkHead'); if (!el) return;
    el.hidden = S.view !== 'talk';
    if (el.hidden) { el.innerHTML = ''; return; }
    const { tabsOn, tab } = talkTabsInfo(), counts = { you: newYou() };
    const checked = SOC.checkedAt ? (ago(SOC.checkedAt) === 'now' ? 'Checked just now' : `Checked ${ago(SOC.checkedAt)} ago`) : '';
    el.innerHTML = `<div class="ttabs" role="tablist">${tabsOn.map(([k, label]) => `<button role="tab" data-talk="tab" data-tab="${k}" aria-pressed="${tab === k && !SOC.person}">${label}${counts[k] ? `<span class="tcount">${counts[k]}</span>` : ''}</button>`).join('')}</div>
      <div class="th-acts">${anySocial() || SOC.accounts.wordpress ? `<button class="btn primary" data-talk="newpost">${SOC.accounts.wordpress ? 'New note' : 'New post'}</button>` : ''}
        <button class="btn icon-only" id="talkRefresh" type="button" title="Check again${checked ? ' · ' + checked : ''}" aria-label="Check again"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></div>`;
  }

  function renderHead() {
    $('viewTitle').innerHTML = S.view === 'today'
      ? `<span class="sun" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg></span>Today`
      : esc(viewName());
    if ($('clock')) $('clock').hidden = S.view !== 'today';
    if (S.view === 'today') paintGoalChip();
    const a = S.lastRefresh ? ago(S.lastRefresh) : '';
    const when = S.refreshing ? 'Checking feeds…' : S.lastRefresh ? (a === 'now' ? 'Checked just now' : `Checked ${a} ago`) : 'Not checked yet';
    const lead = S.view === 'saved' ? `${S.items.filter(i => i.saved).length} saved`
      : S.view === 'recent' ? `${S.items.filter(i => i.read_at).length} read recently`
      : S.view === 'annotated' ? `${S.highlights.length} ${S.highlights.length === 1 ? 'highlight' : 'highlights'} in ${new Set(S.highlights.map(h => h.item_id)).size} stories`
      : S.view === 'today' ? `${unreadIn('today')} unread from the last 24 hours`
      : S.view === 'discover' ? discoverSub()
      : S.view === 'people' ? `${unreadIn('people')} unread from people you read`
      : S.view === 'guide' ? 'A five-minute introduction to RSS and this app'
      : S.view === 'edition' ? 'Yesterday’s reading as a front page, made at 6 every morning'
      : S.view === 'email' ? mailSub()
      : S.view === 'jobs' ? jobsSub()
      : S.view === 'books' ? (B.open ? `${bookOf(B.open).title} · ${bookOf(B.open).author}` : `${allBooks().length} books · ${allAudio().length} audiobooks`)
      : S.view === 'talk' ? (anySocial() ? `The blogs you read, and your conversations on ${['bluesky', 'mastodon'].filter(n => SOC.accounts[n]).map(n => NET[n]).join(' and ')}` : 'The blogs you read, and the conversations between them')
      : `${parentOf(folderOf(S.view)) ? `In ${parentOf(folderOf(S.view)).name} · ` : ''}${unreadIn(S.view)} unread`;
    const muted = S.hiddenMuted ? ` · ${S.hiddenMuted} muted` : '';
    const onMail = S.view === 'email' && !!MAIL.account;
    $('mailActs').hidden = !onMail; $('refresh').hidden = onMail;
    document.body.classList.toggle('mail-view', onMail);
    $('q').placeholder = onMail ? 'Search email' : 'Search stories';
    $('mailCheck').disabled = !!MAIL.checking || S.refreshing; $('mailCheck').classList.toggle('spinning', !!MAIL.checking);
    $('viewSub').textContent = ['discover', 'guide', 'talk', 'books', 'edition', 'email'].includes(S.view) ? lead : S.view === 'jobs' ? `${lead} · ${when}` : `${lead}${muted} · ${when}`;
    paintTalkHead();
    syncWide();
    $('fAll').setAttribute('aria-pressed', String(!S.unreadOnly));
    $('fUnread').setAttribute('aria-pressed', String(S.unreadOnly));
    $('fFree').setAttribute('aria-pressed', String(!!S.freeOnly));
    $('fFree').hidden = onMail;
    $('seg').hidden = !usesUnreadFilter();
    $('markAll').hidden = !usesUnreadFilter() || onMail; // in Email, mark read one at a time (or with m)
    $('refresh').disabled = S.refreshing;
    $('refresh').textContent = S.refreshing ? 'Refreshing…' : 'Refresh';

    const bar = $('feedBar'), f = feedById(S.view), folder = folderOf(S.view);
    bar.classList.add('feedbar');
    if (f) {
      bar.hidden = false;
      bar.innerHTML = `<select id="moveFeed" aria-label="Folder for this feed">${folderOptions(f.folder_id)}</select>
        ${isWeb(f.site) ? `<a class="btn" href="${esc(f.site)}">Visit site</a>` : ''}
        ${kindOf(f) === 'person' ? `<button class="btn" data-view="talk" data-person-page="${personId(f.id)}">Their page</button>` : ''}
        ${anySocial() ? followButtons(f) : ''}
        <label class="kindpick">This feed is <select id="kindFeed" aria-label="This feed is">
          <option value=""${(S.prefs.kinds || {})[f.url] ? '' : ' selected'}>${autoKind(f) === 'person' ? 'A person (automatic)' : 'A publication (automatic)'}</option>
          <option value="person"${(S.prefs.kinds || {})[f.url] === 'person' ? ' selected' : ''}>A person</option>
          <option value="pub"${(S.prefs.kinds || {})[f.url] === 'pub' ? ' selected' : ''}>A publication</option></select></label>
        <button class="btn" id="myFeedBtn">${myFeed()?.id === f.id ? 'Not my site' : 'This is my site'}</button>
        ${feedPaywalled(f) || feedSubscribed(f) ? `<button class="btn${feedSubscribed(f) ? ' on' : ''}" id="subFeedBtn" aria-pressed="${feedSubscribed(f)}" title="Hides the lock on this site's posts">${feedSubscribed(f) ? '✓ I subscribe' : `${LOCK} I subscribe to this site`}</button>` : ''}
        <button class="btn" id="renameFeed">Rename</button><button class="btn danger" id="removeFeed">Unfollow</button>`;
      $('moveFeed').onchange = e => moveFeed(f.id, e.target.value ? Number(e.target.value) : null);
      $('kindFeed').onchange = e => {
        S.prefs.kinds = { ...(S.prefs.kinds || {}) };
        if (e.target.value) S.prefs.kinds[f.url] = e.target.value; else delete S.prefs.kinds[f.url];
        savePrefs(); render();
        status(kindOf(f) === 'person' ? `${f.title} counts as a person: it shows in People and leads Today.` : `${f.title} counts as a publication.`);
      };
      const leftList = S.lists.find(l => l.gone.includes(f.url));
      if (f.status === 'error') showBanner(`This feed couldn't be read last time: ${esc(f.error)}`, true);
      else if (leftList) showBanner(`<span>${esc(f.title)} is no longer in the ${esc(leftList.title)} list. Keep following it?</span><button class="btn primary" id="listKeep" data-list="${esc(leftList.url)}" data-feedurl="${esc(f.url)}">Keep following</button><button class="btn danger" id="removeFeed">Unfollow</button>`, false, 'feed-error');
      else if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'annotated' && S.highlights.length) {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" data-export="all">${IOS ? 'Share all highlights' : 'Export all highlights'}</button>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'people') {
      bar.hidden = false;
      const n = S.feeds.filter(f => kindOf(f) === 'person').length;
      bar.innerHTML = `<button class="btn" id="choosePeople">Choose who’s here</button><button class="btn" data-view="talk">See them as a conversation →</button><span class="note">${n} of ${S.feeds.length} feeds count as people</span>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'talk') {
      bar.hidden = true; // tabs and actions live in the pinned title row (talkHead)
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'books') {
      bar.hidden = true;
    } else if (S.view === 'jobs') {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" data-job="manage">Manage job feeds</button>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (S.view === 'discover') {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" data-disc="scan"${D.running ? ' disabled' : ''}>${D.running ? 'Looking…' : 'Look again'}</button>`;
      if ($('banner').dataset.kind === 'feed-error') hideBanner();
    } else if (folder && listOfFolder(folder.id)) {
      const l = listOfFolder(folder.id);
      bar.hidden = false;
      const when = l.checked ? agoWords(l.checked) : 'not yet';
      bar.innerHTML = `<span class="note listinfo">${LIST_MARK}Followed list · ${l.count} ${l.count === 1 ? 'feed' : 'feeds'} · checked ${esc(when)}</span>
        <button class="btn" id="listCheck" data-list="${esc(l.url)}">Check list now</button>
        <label class="kindpick"><input type="checkbox" id="listAuto" data-list="${esc(l.url)}"${l.auto_add ? ' checked' : ''}> Add new feeds automatically</label>
        <button class="btn" id="listCopy" data-list="${esc(l.url)}">Copy list address</button>
        <button class="btn" id="renameFolder">Rename</button><button class="btn danger" id="listUnfollow" data-list="${esc(l.url)}">Unfollow list</button>`;
      if (l.error) showBanner(`<span>The list couldn’t be checked last time: ${esc(l.error)} Your feeds from it are unchanged.</span>`, true, 'feed-error');
      else if (l.pending.length) {
        const names = l.pending.slice(0, 3).map(p => p.title).join(', ') + (l.pending.length > 3 ? ` and ${l.pending.length - 3} more` : '');
        showBanner(`<span>${l.pending.length} new ${l.pending.length === 1 ? 'feed' : 'feeds'} joined ${esc(l.title)}: ${esc(names)}.</span><button class="btn primary" id="listTake" data-list="${esc(l.url)}">Follow ${l.pending.length === 1 ? 'it' : 'them'}</button><button class="btn" id="listSkip" data-list="${esc(l.url)}">Not now</button>`, false, 'feed-error');
      } else if ($('banner').dataset.kind === 'feed-error') hideBanner();
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
    if (S.view === 'email') return MAIL.account ? (S.unreadOnly ? ['No unread email', 'Switch to “All” to see email you’ve read, or press Refresh.'] : ['No email yet', 'Press Refresh to check your inbox.']) : ['', ''];
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
  // Every feed from your own site counts as you (your blog, your Notes feed, a category feed): not just the one
  // picked as "my site". Same host, or one a subdomain of the other (notes.example.com).
  let ownCache = { k: '', ids: new Set() };
  function ownIds() {
    const mine = myFeed(), k = `${S.feeds.length}|${mine?.id}|${SOC.accounts.wordpress?.site || ''}`;
    if (ownCache.k === k) return ownCache.ids;
    const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
    const homes = new Set([mine && (hostOf(mine.site) || hostOf(mine.url)), hostOf(SOC.accounts.wordpress?.site || '')].filter(Boolean));
    const same = h => !!h && [...homes].some(m => h === m || h.endsWith('.' + m) || m.endsWith('.' + h));
    const ids = new Set(homes.size ? S.feeds.filter(f => f.id === mine?.id || same(hostOf(f.site)) || same(hostOf(f.url))).map(f => f.id) : []);
    ownCache = { k, ids }; return ids;
  }
  const isOwn = id => id != null && ownIds().has(Number(id));
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
    const unread = S.items.filter(i => isToday(i) && !i.read && !isMuted(i) && !isJobItem(i) && !isEmailItem(i)).filter(i => {
      const k = storyKey(i);
      if (k.length < 16) return true;
      if (seenStory.has(k)) return false;
      seenStory.add(k); return true;
    });
    const fresh = lastVisit ? S.items.filter(i => new Date(i.date).getTime() > lastVisit && !isMuted(i) && !isJobItem(i) && !isEmailItem(i)).length : 0;
    // People first: unread posts from people you read in the last few days, one per person (not your own site)
    const mine = myFeed();
    const peopleAll = S.items.filter(i => !i.read && !isMuted(i) && !isEmailItem(i) && isPerson(i.feed_id) && !isOwn(i.feed_id) && Date.now() - Date.parse(i.date) < 4 * DAY)
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
    if (S.view === 'guide') { $('list').innerHTML = guideHtml(); buildGuideToc(); store.set('guideSeen', '1'); return; }
    if (S.view === 'talk') {
      // background redraws (pictures, accounts, new replies) must not wipe a reply you're writing
      const nform = document.querySelector('#list .n-form textarea');
      if (nform && nform.value.trim()) return;
      const open = document.querySelector('#list .nb-rbox textarea');
      const keep = open && { id: open.closest('.n-box').dataset.box.slice(3), text: open.value, focus: document.activeElement === open, at: open.selectionStart };
      $('list').innerHTML = talkHtml();
      if (keep) { const it = item(keep.id); if (it) nbReplyBox(null, it, keep); }
      return;
    }
    if (S.view === 'jobs') { $('list').innerHTML = jobsHtml(); return; }
    if (S.view === 'edition') { $('list').innerHTML = editionHtml(); return; }
    if (S.view === 'books') { $('list').innerHTML = booksHtml(); if (B.open) requestAnimationFrame(B.chapters && !B.loading ? layoutBook : () => bookGeom()); return; }
    if (isHome()) { $('list').innerHTML = homeHtml(visible()); return; }
    if (isPeopleHome()) { $('list').innerHTML = peopleHomeHtml(visible()); return; }
    const all = visible(), list = all.slice(0, S.shown);
    const brief = S.view === 'email' ? mailBarHtml() : briefHtml();
    const older = S.view === 'email' ? '' : olderHtml(new Set(all.map(i => i.id)));
    if (!list.length) {
      const [t, d] = emptyText();
      $('list').innerHTML = brief + (older || !t ? '' : `<div class="empty"><strong>${t}</strong><span>${d}</span></div>`) + older;
      return;
    }
    if (S.view === 'email') {
      $('list').innerHTML = brief + `<div class="mail-list">${list.map(mailRow).join('')}</div>`
        + (all.length > list.length ? `<button class="btn more" id="more">Show ${Math.min(60, all.length - list.length)} more</button>` : '');
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
        ${isWeb(it.image) ? `<img class="thumb" src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" data-act="open" data-tile="${esc(tileFor(f))}">` : isEmailItem(it) ? tileHtml({ url: "mail:" + srcLabel(it), title: srcLabel(it) }) : tileHtml(f)}
        <div class="body">
          <div class="meta"><span class="src">${esc(srcLabel(it))}</span>${viaTag(it)}${kindTag(it)}${paidTag(it)}<time datetime="${esc(it.date)}">${ago(it.date)}</time></div>
          ${alsoLine(it)}
          <button class="title" data-act="open">${esc(headline(it))}</button>
          ${it.summary && !quotes ? `<div class="summary">${esc(it.summary)}</div>` : ''}
          ${quotes ? `<div class="quotes">${quotes}</div>` : ''}
        </div>
        <div class="acts">
          ${viaNews(it) ? `<button class="icon" data-act="hidesrc" title="Hide stories from ${esc(outletOf(it))}" aria-label="Hide stories from ${esc(outletOf(it))}">${ICONS.hide}</button>` : ''}
          ${isEmailItem(it) ? "" : `<button class="icon" data-act="share" title="Share" aria-label="Share" aria-haspopup="menu">${ICONS.share}</button>`}
          <button class="icon${it.saved ? ' on' : ''}" data-act="save" title="${it.saved ? 'Remove from Read later' : 'Read later'}" aria-label="${it.saved ? 'Remove from Read later' : 'Read later'}">${it.saved ? ICONS.saved : ICONS.save}</button>
          <button class="icon" data-act="read" title="${it.read ? 'Mark unread' : 'Mark read'}" aria-label="${it.read ? 'Mark unread' : 'Mark read'}">${it.read ? ICONS.read : ICONS.unread}</button>
        </div>
      </article>`;
    }
    out += '</div>';
    if (all.length > list.length) out += `<button class="btn more" id="more">Show ${Math.min(60, all.length - list.length)} more</button>`;
    $('list').innerHTML = out + older;
  }
  function render() { renderRail(); renderHead(); renderList(); renderAddFolders(); if (S.readerId) renderReaderChrome(); updateWidget(); }

  // Stories without a picture get a tile in their feed's colour, with its first letter (like the sidebar).
  function tileFor(f) { return f ? `${hueFor(f.url)}|${(f.title || '?').trim()[0] || '?'}` : '210|•'; }
  function tileHtml(f) {
    const [h, letter] = tileFor(f).split('|');
    return `<div class="thumb tile" style="--h:${h}" data-act="open" aria-hidden="true"><span>${esc(letter.toUpperCase())}</span></div>`;
  }
  // A picture that fails to load turns into that tile.
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.closest?.('.cover')) { img.remove(); return; }
    if (img.tagName === 'IMG' && img.classList.contains('nb-tile-img')) { img.closest('.nb-tile')?.classList.add('no-pic'); return; }
    if (img.tagName === 'IMG' && img.classList.contains('ed-hero')) { img.closest('.ed-lead')?.classList.add('no-pic'); img.remove(); return; }
    if (img.tagName === 'IMG' && img.classList.contains('ed-pic')) {
      const [h, letter] = (img.dataset.tile || '210|•').split('|');
      const t = Object.assign(document.createElement('span'), { className: img.className.replace('ed-pic', 'ed-pic ed-tile') });
      t.style.setProperty('--h', h); t.setAttribute('aria-hidden', 'true'); t.innerHTML = `<span>${esc(letter.toUpperCase())}</span>`;
      img.replaceWith(t); return;
    }
    if (img.tagName === 'IMG' && img.classList.contains('nb-face-img')) { img.remove(); return; }
    if (img.tagName === 'IMG' && img.classList.contains('nb-pic')) { img.closest('.nb-picb')?.remove(); return; }
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
      S.mutes = s.mutes || []; S.lists = s.lists || []; S.prefs = s.prefs && typeof s.prefs === 'object' ? s.prefs : {};
      buildKinds(); buildPersons(); buildMutes(); renderMutes();
      setTimeout(scanSites, 4000);
      const oldMine = store.get('myFeed'); // earlier builds kept this on one device only
      if (oldMine && !('mine' in S.prefs)) { const f = feedById(oldMine); S.prefs.mine = oldMine === 'none' ? 'none' : f ? f.url : undefined; if (S.prefs.mine) savePrefs(); store.set('myFeed', ''); }
      const valid = ['today', 'edition', 'email', 'all', 'saved', 'annotated', 'recent', 'discover', 'people', 'guide', 'talk', 'jobs', 'books'].includes(S.view) || folderOf(S.view) || feedById(S.view);
      if (!valid) S.view = 'all';
      render(); welcome(); processNew();
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
    checkMail();
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
    const was = S.view;
    S.view = /^\d+$/.test(v) ? Number(v) : v;
    if (was === 'talk' && S.view !== 'talk') SOC.nbLeft = Date.now();
    // Back within half an hour is the same visit: "Since you were here" and the faces stay as they were
    if (S.view === 'talk' && was !== 'talk') { if (!SOC.nbLeft || Date.now() - SOC.nbLeft > 30 * 60e3) SOC.nbVisit = undefined; if (!SOC.keepPerson) SOC.person = null; SOC.keepPerson = false; }
    S.keep.clear(); S.selId = null; S.shown = 60; hideBanner(); render(); $('main').scrollTo({ top: 0 }); $('listView').scrollTo({ top: 0 });
    if (isPhone()) setScreen('list');
    if (S.view === 'discover') openDiscover();
    if (S.view === 'today') welcome();
    if (S.view === 'talk') loadTalk();
    if (typeof S.view === 'number' && anySocial()) loadReaders();
    if (S.view === 'books') B.open = null;
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
    ['daviddaniels.com', 'David Daniels', 'Personal essays since 2001.'],
  ];
  const followsDomain = d => S.feeds.some(f => [f.url, f.site].some(u => (u || '').replace(/^https?:\/\/(www\.)?/, '').startsWith(d)));
  // The guide's contents: one link per section, built from its headings, and a way back up from each section
  function buildGuideToc() {
    const toc = $('gToc'); if (!toc) return;
    const secs = [...document.querySelectorAll('.guide .g-sec')];
    secs.forEach((sec, i) => {
      if (!sec.id) sec.id = 'g-s' + i;
      const h = sec.querySelector('h2');
      if (h && !h.querySelector('.g-up')) h.insertAdjacentHTML('beforeend', '<button class="g-up" type="button" data-guide-jump="gToc" title="Back to contents" aria-label="Back to contents">↑ Contents</button>');
    });
    toc.innerHTML = '<p class="g-toc-h">On this page</p><ol>' + secs.map(sec => {
      const h = sec.querySelector('h2'); const label = h ? h.firstChild.textContent.trim() : '';
      return `<li><button type="button" class="b-link" data-guide-jump="${sec.id}">${esc(label)}</button></li>`;
    }).join('') + '</ol>';
  }
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
      <nav class="g-toc" id="gToc" aria-label="On this page"></nav>

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
        <p style="margin-top:12px">Type words instead of an address, like <code>space exploration</code>, and you’ll follow that topic through Google News. Moving from another reader? Use <b>Import OPML</b> in Settings to bring your whole list across. Someone shares a link to a list of feeds, like a blogroll or a club? Choose <b>+ Add a feed</b>, then <b>Follow a list of feeds</b>: you get every feed in it, and new ones as the list grows.</p></section>

      <section class="g-sec" id="g-newsletters"><h2>Newsletters, out of your inbox</h2>
        <p>Read newsletters here, beside everything else, instead of in your email. The app makes you a private email address; you sign up for newsletters with it, and each issue arrives as a story.</p>
        <ol class="g-steps">
          <li>Press <b>+ Add a feed</b> at the bottom of the sidebar${IOS ? ' (tap Feeds first on iPhone)' : ''}, then <b>Read newsletters here</b>.</li>
          <li>Under <b>Name this address</b>, type a name, like the newsletter’s name, and press <b>Make an address</b>. A feed with that name appears in a <b>Newsletters</b> folder, made the first time, or in the folder you pick under <b>Put its feed in</b>.</li>
          <li>Press <b>Copy address</b>, go to the newsletter’s sign-up page, and paste it in place of your own email.</li>
          <li>Refresh after a minute. The newsletter’s welcome email arrives as a story. If it asks you to confirm, open it and tap the confirm link.</li>
        </ol>
        <p>One address can take many newsletters, and they’ll share one feed. Make one per newsletter to keep them apart. Your addresses are listed under <b>Read newsletters here</b> whenever you need to copy one again. To stop a newsletter, use the unsubscribe link in any issue. To get rid of an address, choose <b>Remove</b> next to it there; its feed is unfollowed too.</p>
        <p>The addresses come from Kill the Newsletter, a free, open-source service; your own email is never used. Anyone who knows an address can send to it, so use it only for newsletters.</p>
        <p style="margin-top:12px"><button class="btn primary" type="button" id="guideNewsletters">Make a newsletter address</button></p></section>

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
        <p style="margin-top:12px">Keep private things private: a site is public, so leave out your home address, phone number and anything you wouldn’t put on a postcard. For more on why personal sites matter, read <a href="https://readingroomapp.com/#why">why The Reading Room exists</a> and the <a href="https://indieweb.org/POSSE">IndieWeb’s page on POSSE</a>.</p></section>

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
          <dt>Settings</dt><dd>At the bottom of the sidebar: importing and exporting feeds, Feed checkup, Muted words, Rules &amp; alerts, Your year, your accounts and sync.</dd>
          <dt>Aa</dt><dd>Change the text size, width and colors of the reading view.</dd>
        </dl></section>

      <section class="g-sec"><h2>Keeping it calm</h2>
        <ul class="g-list">
          <li><b>Unread isn’t a to-do list.</b> Skim what interests you and press <b>Mark all read</b> without guilt.</li>
          <li><b>Mute words</b> you’re tired of seeing, from <button class="b-link" id="guideMutes">Muted words</button> in Settings, at the bottom of the sidebar.</li>
          <li><b>Hide a website</b> from your news searches with the ⊘ button on its stories.</li>
          <li><b>Read on all your devices.</b> Turn on sync in Settings, at the bottom of the sidebar, and your feeds, Read later and highlights follow you through iCloud Drive.</li>
        </ul></section>
      ${keys}
      <section class="g-sec"><h2>A few words you’ll see</h2>
        <dl class="g-defs">
          <dt>Feed</dt><dd>A site’s list of new posts. Also called an RSS feed, Atom feed or JSON feed. This app reads them all.</dd>
          <dt>Follow, subscribe</dt><dd>The same thing: adding a feed to your reader.</dd>
          <dt>OPML</dt><dd>A file with a list of feeds, for moving between readers or sharing your list. Follow one by its link and the app keeps up as the list changes.</dd>
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
  // ------------------------------------------------------------ Books: free classics from Standard Ebooks
  // Public domain in the US, carefully produced, and free. Each downloads once, then reads offline.
  const BOOKS = [
    { slug: 'marcus-aurelius/meditations/george-long', title: 'Meditations', author: 'Marcus Aurelius', why: 'A Roman emperor’s private notes to himself on living well. Read a page a day.' },
    { slug: 'henry-david-thoreau/walden', title: 'Walden', author: 'Henry David Thoreau', why: 'Two years in a cabin by a pond, and what a simpler life taught him.' },
    { slug: 'benjamin-franklin/the-autobiography-of-benjamin-franklin', title: 'The Autobiography of Benjamin Franklin', author: 'Benjamin Franklin', why: 'A printer’s apprentice becomes a founder, with his famous plan of thirteen virtues.' },
    { slug: 'jane-austen/pride-and-prejudice', title: 'Pride and Prejudice', author: 'Jane Austen', why: 'The sharpest, funniest love story in English, and still the one to beat.' },
    { slug: 'arthur-conan-doyle/the-adventures-of-sherlock-holmes', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', why: 'Twelve short mysteries. Each one is perfect for an evening.' },
  ];
  const B = { open: null, chapters: null, ch: 0, loading: false, err: '', toc: false, adding: false, addErr: '', mode: store.get('booksMode') || 'read' };
  // Your own additions: any Standard Ebooks book, by its link. Synced.
  const allBooks = () => [...BOOKS, ...((S.prefs.myBooks || []).filter(m => !BOOKS.some(b => b.slug === m.slug)))];
  const bookOf = slug => allBooks().find(b => b.slug === slug);
  const titleCase = t => t.replace(/-/g, ' ').replace(/\b(a|an|and|the|of|in|on|to|for|at|by)\b/g, w => '\u0000' + w).replace(/\b\w/g, c => c.toUpperCase()).replace(/\u0000(\w)/g, '$1').replace(/^\w/, c => c.toUpperCase());
  function slugFrom(input) {
    const m = /standardebooks\.org\/ebooks\/([a-z0-9-]+(?:\/[a-z0-9-]+){1,3}?)(?:\/(?:text|downloads|images)\b.*)?\/?(?:[?#].*)?$/i.exec((input || '').trim());
    return m ? m[1].toLowerCase().replace(/\/$/, '') : '';
  }
  async function addBook(input) {
    const slug = slugFrom(input);
    if (!slug) { B.addErr = 'Paste the link of a book’s page on standardebooks.org, like standardebooks.org/ebooks/mark-twain/the-adventures-of-tom-sawyer'; renderList(); return; }
    if (bookOf(slug)) { B.addErr = 'That book is already on your shelf.'; renderList(); return; }
    B.adding = true; B.addErr = ''; renderList();
    try {
      const html = await invoke('book_text', { slug });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const [authorSlug, titleSlug] = slug.split('/');
      const title = (doc.querySelector('#titlepage h1, section[epub\\:type~="titlepage"] h1')?.textContent || '').trim() || titleCase(titleSlug);
      const author = (doc.querySelector('#titlepage [epub\\:type~="z3998:author"], #titlepage b')?.textContent || '').trim() || titleCase(authorSlug);
      S.prefs.myBooks = [...(S.prefs.myBooks || []), { slug, title, author, why: 'Added by you.' }];
      savePrefs(); status(`${title} is on your shelf.`);
    } catch (e) { B.addErr = msg(e).replace('the book', 'that book'); }
    B.adding = false; renderList();
  }
  const coverOf = b => `https://standardebooks.org/ebooks/${b.slug}/downloads/cover.jpg`;
  const bookPos = slug => (S.prefs.books || {})[slug] || null;
  const SKIP_PARTS = /\b(imprint|colophon|copyright-page|toc|landmarks|loi|halftitlepage)\b/;
  // The one-page book → chapters: each top-level section of the body, its first heading as its name
  function parseBook(html, slug) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, link, iframe, object, embed, form').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(n => { for (const a of [...n.attributes]) if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
    const base = `https://standardebooks.org/ebooks/${slug}/text/`;
    doc.querySelectorAll('img[src]').forEach(i => { try { i.src = new URL(i.getAttribute('src'), base).href; } catch {} });
    const body = doc.querySelector('main') || doc.body;
    let parts = [...body.children].filter(n => /^(SECTION|ARTICLE)$/.test(n.tagName));
    if (parts.length === 1 && parts[0].querySelectorAll(':scope > section, :scope > article').length > 1) parts = [...parts[0].querySelectorAll(':scope > section, :scope > article')];
    const out = [];
    for (const p of parts) {
      const type = (p.getAttribute('epub:type') || p.getAttribute('data-epub-type') || '') + ' ' + (p.id || '');
      if (SKIP_PARTS.test(type)) continue;
      const h = p.querySelector('h1, h2, h3, h4, hgroup');
      let name = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
      if (/titlepage/.test(type)) name = 'Title page';
      if (/uncopyright/.test(type)) name = 'About this edition';
      if (!name) name = (p.id || 'Part').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
      out.push({ id: p.id, name: name.length > 70 ? name.slice(0, 67) + '…' : name, html: p.innerHTML });
    }
    return out;
  }
  async function openBook(slug, ch) {
    const b = bookOf(slug); if (!b) return;
    B.open = slug; B.chapters = null; B.loading = true; B.err = ''; B.toc = false;
    renderHead(); renderList(); $('main').scrollTo({ top: 0 });
    try {
      const html = await invoke('book_text', { slug });
      B.chapters = parseBook(html, slug);
      const pos = bookPos(slug);
      B.ch = Math.min(ch ?? (pos ? pos.ch : Math.max(0, B.chapters.findIndex(c => c.name !== 'Title page'))), B.chapters.length - 1);
    } catch (e) { B.err = msg(e); }
    B.loading = false;
    if (B.open !== slug) return;
    B.page = 0; B.want = Number(store.get(`bookPage:${slug}:${B.ch}`)) || 0;
    renderHead(); renderList();
  }
  // ---- Pages: the chapter is set in columns exactly one screen tall, and you flip from one to the next.
  // Wide windows show two pages side by side, like an open book.
  const BOOK_GAP = 64;
  const bookSize = () => Number(store.get('bookSize')) || (isPhone() ? 18 : 20);
  function bookGeom() {
    const st = $('bkStage'); if (!st) return null;
    const r = $('main').getBoundingClientRect();
    Object.assign(st.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const vp = $('bkVp'), pg = $('bkPages'); if (!vp || !pg) return null;
    const cs = getComputedStyle(vp), W = vp.clientWidth, H = vp.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 6;
    const spread = W >= 1000;
    const colW = spread ? Math.min(560, (W - BOOK_GAP) / 2) : Math.min(W, 680);
    const pageW = spread ? colW * 2 + BOOK_GAP : colW;
    return { W, H, colW, pageW, pg, vp, spread };
  }
  function layoutBook() {
    const g = bookGeom(); if (!g) return;
    const { H, colW, pageW, pg, spread } = g;
    Object.assign(pg.style, { height: H + 'px', width: pageW + 'px', columnWidth: colW + 'px', columnGap: BOOK_GAP + 'px', fontSize: bookSize() + 'px', transition: 'none' });
    // Only the page (or the two-page spread) shows; the pages before and after stay out of sight
    Object.assign($('bkClip').style, { width: pageW + 'px', height: H + 'px' });
    pg.classList.toggle('spread', spread);
    const step = pageW + BOOK_GAP;
    B.pages = Math.max(1, Math.ceil((pg.scrollWidth + BOOK_GAP - 4) / step));
    if (B.want != null) { B.page = B.want === 'last' ? B.pages - 1 : Math.round(B.want * (B.pages - 1)); B.want = null; }
    B.page = Math.max(0, Math.min(B.pages - 1, B.page || 0));
    pg.style.transform = `translateX(${-B.page * step}px)`;
    requestAnimationFrame(() => { pg.style.transition = ''; });
    paintBookFoot(); paintBookGoal();
  }
  function paintBookFoot() {
    const c = B.chapters[B.ch];
    if ($('bkWhere')) $('bkWhere').innerHTML = `<b>${esc(c.name)}</b><span>Page ${B.page + 1} of ${B.pages}${B.chapters.length > 1 ? ` · part ${B.ch + 1} of ${B.chapters.length}` : ''}</span>`;
    if ($('bkPrev')) $('bkPrev').disabled = B.page === 0 && B.ch === 0;
    if ($('bkNext')) { const end = B.page >= B.pages - 1 && B.ch >= B.chapters.length - 1; $('bkNext').disabled = end; $('bkNext').textContent = end ? 'The end' : B.page >= B.pages - 1 ? 'Next chapter →' : 'Next →'; }
    const frac = B.pages > 1 ? B.page / (B.pages - 1) : 0;
    store.set(`bookPage:${B.open}:${B.ch}`, frac.toFixed(4));
    // The last page of the last real chapter (before the endnotes and the note about this edition) finishes the book
    const lastReal = B.chapters.reduce((k, c, i) => /endnotes|about this edition|colophon/i.test(c.name) ? k : i, 0);
    if (B.ch >= lastReal && B.page >= B.pages - 1 && B.ch > 0) markFinished(B.open);
  }
  function flip(d) {
    if (!B.chapters || B.loading) return;
    const g = bookGeom(); if (!g) return;
    if (d > 0 && B.page < B.pages - 1) B.page++;
    else if (d < 0 && B.page > 0) B.page--;
    else if (d > 0 && B.ch < B.chapters.length - 1) return goChapter(B.ch + 1, 0);
    else if (d < 0 && B.ch > 0) return goChapter(B.ch - 1, 'last');
    else return;
    g.pg.style.transform = `translateX(${-B.page * (g.pageW + BOOK_GAP)}px)`;
    paintBookFoot();
  }
  function goChapter(i, at) {
    if (!B.chapters) return;
    B.ch = Math.max(0, Math.min(B.chapters.length - 1, i)); B.toc = false;
    B.page = 0; B.want = at === 'last' ? 'last' : at === undefined ? (Number(store.get(`bookPage:${B.open}:${B.ch}`)) || 0) : at;
    const books = { ...(S.prefs.books || {}) };
    books[B.open] = { ch: B.ch, of: B.chapters.length, at: new Date().toISOString() };
    S.prefs.books = books; savePrefs();
    renderList();
  }
  function bookFont(d) {
    const size = Math.max(14, Math.min(32, bookSize() + d));
    store.set('bookSize', String(size));
    B.want = B.pages > 1 ? B.page / (B.pages - 1) : 0; // stay at the same place in the chapter
    layoutBook();
  }
  window.addEventListener('resize', () => { if (S.view === 'books' && B.open && B.chapters) { B.want = B.pages > 1 ? B.page / (B.pages - 1) : 0; layoutBook(); } });
  document.addEventListener('keydown', e => {
    if (S.view !== 'books' || !B.open || !B.chapters || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); flip(e.shiftKey && e.key === ' ' ? -1 : 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); flip(-1); }
    else if (e.key === 'Escape') { e.stopPropagation(); B.open = null; renderHead(); renderList(); }
  }, true);
  // Tap the right or left edge of the page, or swipe, to turn it
  let touchX = null;
  document.addEventListener('touchstart', e => { if (e.target.closest('#bkVp')) touchX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 45) flip(dx < 0 ? 1 : -1);
  }, { passive: true });
  // The book you're reading now: the one you chose, or else the one you opened last (and haven't finished)
  function currentBook() {
    const pick = S.prefs.reading && bookOf(S.prefs.reading) ? S.prefs.reading : null;
    if (pick) return pick;
    const opened = Object.entries(S.prefs.books || {}).filter(([slug]) => bookOf(slug) && !(S.prefs.finished || {})[slug]).sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
    return opened.length ? opened[0][0] : null;
  }
  function currentHtml(slug) {
    const b = bookOf(slug), p = bookPos(slug), pct = p && p.of ? Math.round(100 * (p.ch + 1) / p.of) : 0;
    const when = p?.at ? (() => { const d = Math.floor((Date.now() - Date.parse(p.at)) / DAY); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; })() : '';
    return `<section class="now-reading">
      <button class="cover big" data-book="open" data-slug="${esc(slug)}" aria-label="Continue ${esc(b.title)}"><img src="${esc(coverOf(b))}" alt="" referrerpolicy="no-referrer"><span class="cv-fallback"><b>${esc(b.title)}</b><i>${esc(b.author)}</i></span></button>
      <div class="nr-body"><p class="nr-k">Currently reading <button class="nr-change" data-book="choose" aria-haspopup="menu">Change</button></p><h2>${esc(b.title)}</h2><p class="by">${esc(b.author)}</p>
        <p class="why">${esc(b.why)}</p>
        ${p ? `<div class="bk-prog nr-prog"><span style="width:${pct}%"></span></div><p class="bk-pos">Part ${p.ch + 1} of ${p.of} · ${pct}%${when ? ` · last read ${when}` : ''}</p>` : '<p class="bk-pos">Not started yet</p>'}
        <div class="bk-acts"><button class="btn primary" data-book="open" data-slug="${esc(slug)}">${p ? 'Continue reading' : 'Start reading'}</button>
          ${p ? `<button class="btn" data-book="toc-open" data-slug="${esc(slug)}">Contents</button>` : ''}</div></div></section>`;
  }
  function shelfHtml() {
    const sw = `<div class="seg2" role="tablist"><button data-book="mode" data-m="read" aria-pressed="${B.mode !== 'listen'}">Read</button><button data-book="mode" data-m="listen" aria-pressed="${B.mode === 'listen'}">Listen</button></div>`;
    if (B.mode === 'listen') return goalHtml() + sw + listenHtml();
    const cur = currentBook();
    return goalHtml() + sw + (cur ? currentHtml(cur) : '') + `<div class="shelf-intro"><p>Free classics, beautifully produced by <a href="https://standardebooks.org/">Standard Ebooks</a> and free of copyright in the US. Each one downloads the first time you open it and then reads without a connection. The app remembers your place.</p></div>
      ${cur ? '<h2 class="sec-h shelf-h">Your shelf</h2>' : ''}<div class="shelf">${allBooks().filter(b => b.slug !== cur).map(b => {
        const p = bookPos(b.slug), pct = p && p.of ? Math.round(100 * (p.ch + 1) / p.of) : 0;
        return `<article class="book"><button class="cover" data-book="open" data-slug="${esc(b.slug)}" aria-label="Read ${esc(b.title)}">
            <img src="${esc(coverOf(b))}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="cv-fallback"><b>${esc(b.title)}</b><i>${esc(b.author)}</i></span></button>
          <div class="book-body"><h3>${(S.prefs.finished || {})[b.slug] ? '<span class="bk-fin" title="Finished">✓</span> ' : ''}${esc(b.title)}</h3><p class="by">${esc(b.author)}</p><p class="why">${esc(b.why)}</p>
          ${p ? `<div class="bk-prog"><span style="width:${pct}%"></span></div><p class="bk-pos">Part ${p.ch + 1} of ${p.of} · ${pct}%</p>` : ''}
          <div class="bk-acts"><button class="btn ${p ? '' : 'primary'}" data-book="open" data-slug="${esc(b.slug)}">${p ? 'Continue reading' : 'Read'}</button>
          ${cur ? `<button class="btn ghost-x" data-book="current" data-slug="${esc(b.slug)}" title="Show this book at the top of your shelf">Set as currently reading</button>` : ''}
          ${BOOKS.some(x => x.slug === b.slug) ? '' : `<button class="btn ghost-x" data-book="remove" data-slug="${esc(b.slug)}" title="Take it off your shelf">Remove</button>`}</div></div></article>`;
      }).join('')}</div>
      <form class="add-book" id="addBookForm"><label for="addBook"><b>Add a book</b> Find one at <a href="https://standardebooks.org/ebooks">standardebooks.org</a>, copy the link of its page, and paste it here.</label>
        <div class="row"><input id="addBook" placeholder="standardebooks.org/ebooks/mark-twain/the-adventures-of-tom-sawyer" autocomplete="off" autocapitalize="off" spellcheck="false"${B.adding ? ' disabled' : ''}>
        <button class="btn primary" type="submit"${B.adding ? ' disabled' : ''}>${B.adding ? 'Adding…' : 'Add to shelf'}</button></div>
        ${B.addErr ? `<p class="fol-err">${esc(B.addErr)}</p>` : ''}</form>
      <p class="hw-foot">More free books: <a href="https://standardebooks.org/ebooks">Standard Ebooks</a> and <a href="https://www.gutenberg.org/">Project Gutenberg</a>. Standard Ebooks’ editions are dedicated to the public domain (CC0). Outside the US, check your country’s copyright rules.</p>`;
  }
  function bookHtml() {
    const b = bookOf(B.open);
    const bar = `<div class="bk-bar"><button class="btn" data-book="shelf">← Books</button><div class="bk-name"><b>${esc(b.title)}</b><span>${esc(b.author)}</span></div>
      <div class="bk-tools">${B.chapters ? `<span class="bk-goal-t" id="bkGoalT" title="Today’s reading goal"></span><button class="btn bk-a" data-book="font" data-d="-2" title="Smaller text" aria-label="Smaller text">A<small>−</small></button><button class="btn bk-a big" data-book="font" data-d="2" title="Larger text" aria-label="Larger text">A<small>+</small></button>
        <button class="btn" data-book="toc" aria-expanded="${B.toc}">Contents</button>` : ''}</div><div class="bk-goal" aria-hidden="true"><span id="bkGoalFill"></span></div></div>`;
    let inner;
    if (B.loading) inner = `<div class="empty"><strong>Opening ${esc(b.title)}…</strong><span>Downloading the book once. After this it opens without a connection.</span></div>`;
    else if (B.err) inner = `<div class="empty"><strong>Couldn’t open the book</strong><span>${esc(B.err)}</span><button class="btn primary" data-book="open" data-slug="${esc(b.slug)}">Try again</button></div>`;
    else inner = `${B.toc ? `<nav class="bk-toc">${B.chapters.map((x, i) => `<button data-book="ch" data-i="${i}" aria-current="${i === B.ch}">${esc(x.name)}</button>`).join('')}</nav>` : ''}
      <div class="bk-vp" id="bkVp"><div class="bk-clip" id="bkClip"><div class="bk-text bk-pages" id="bkPages">${B.chapters[B.ch].html}</div></div></div>
      <div class="bk-foot"><button class="btn" id="bkPrev" data-book="flip" data-d="-1">← Previous</button><div class="bk-where" id="bkWhere"></div><button class="btn primary" id="bkNext" data-book="flip" data-d="1">Next →</button></div>`;
    return `<div class="bk-stage" id="bkStage">${bar}${inner}</div>`;
  }
  function booksHtml() { return B.open ? bookHtml() : shelfHtml(); }
  function bookAction(b) {
    const k = b.dataset.book;
    if (k === 'open') return openBook(b.dataset.slug);
    if (k === 'shelf') { B.open = null; renderHead(); renderList(); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'toc') { B.toc = !B.toc; renderList(); return; }
    if (k === 'mode') { B.mode = b.dataset.m; store.set('booksMode', B.mode); renderHead(); renderList(); return; }
    if (k === 'choose') {
      const menu = $('replyMenu'), cur = currentBook();
      menu.innerHTML = `<p class="menu-head">Currently reading</p>${allBooks().map(x => `<button type="button" data-pick="${esc(x.slug)}"${x.slug === cur ? ' aria-current="true"' : ''}>${x.slug === cur ? '✓ ' : ''}${esc(x.title)}${(S.prefs.finished || {})[x.slug] ? ' (finished)' : ''}</button>`).join('')}`;
      placeMenu(menu, b);
      menu.onclick = e => { const p = e.target.closest('[data-pick]'); if (!p) return; menu.hidden = true; menu.onclick = null; S.prefs.reading = p.dataset.pick; savePrefs(); renderList(); };
      return;
    }
    if (k === 'current') { S.prefs.reading = b.dataset.slug; savePrefs(); renderList(); $('main').scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (k === 'toc-open') { openBook(b.dataset.slug).then(() => { B.toc = true; renderList(); }); return; }
    if (k === 'remove') {
      const slug = b.dataset.slug, t = bookOf(slug)?.title || 'The book';
      S.prefs.myBooks = (S.prefs.myBooks || []).filter(m => m.slug !== slug);
      const books = { ...(S.prefs.books || {}) }; delete books[slug]; S.prefs.books = books;
      savePrefs(); renderList(); status(`${t} is off your shelf.`); return;
    }
    if (k === 'ch') return goChapter(Number(b.dataset.i), 0);
    if (k === 'flip') return flip(Number(b.dataset.d));
    if (k === 'font') return bookFont(Number(b.dataset.d));
  }
  // Footnote links inside a book jump to the chapter that holds the note
  function bookLink(a) {
    const href = a.getAttribute('href') || '';
    const m = /#(.+)$/.exec(href); if (!m || !B.chapters) return false;
    const id = m[1], i = B.chapters.findIndex(c => c.id === id || c.html.includes(`id="${id}"`));
    if (i < 0) return false;
    const toNote = () => {
      const g = bookGeom(), el = document.getElementById(id); if (!g || !el) return;
      const x = el.getBoundingClientRect().left - g.pg.getBoundingClientRect().left;
      B.page = Math.max(0, Math.min(B.pages - 1, Math.floor(x / (g.pageW + BOOK_GAP))));
      g.pg.style.transform = `translateX(${-B.page * (g.pageW + BOOK_GAP)}px)`; paintBookFoot();
    };
    if (i !== B.ch) { goChapter(i, 0); setTimeout(toNote, 80); } else toNote();
    return true;
  }

  // ------------------------------------------------------------ Reading goal: minutes a day, a streak, books a year
  // Only real reading counts: a story or a book open, with a scroll, a page turn or a key in the last two minutes.
  // Each device keeps its own minutes per day in the synced prefs, so a day's reading on Mac and iPhone adds up.
  const deviceId = (() => { let d = store.get('deviceId'); if (!d) { d = Math.random().toString(36).slice(2, 10); store.set('deviceId', d); } return d; })();
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const goalCfg = () => ({ mins: 15, books: 12, booksOnly: false, ...(S.prefs.goal || {}) });
  // Off until you set one: nothing is counted or shown before that
  const goalOn = () => !!S.prefs.goal && S.prefs.goal.on !== false;
  const dayMins = key => Object.values((S.prefs.readLog || {})[key] || {}).reduce((a, b) => a + b, 0) / 60;
  let unsaved = 0, lastActive = 0, celebrated = store.get('goalDone') || '';
  const READ_IDLE = 120 * 1000;
  const markActive = () => { lastActive = Date.now(); };
  ['scroll', 'wheel', 'keydown', 'pointerdown', 'touchstart'].forEach(t => document.addEventListener(t, markActive, { capture: true, passive: true }));
  function readingNow() {
    if (!goalOn()) return false;
    if (AB.id && !abAudio.paused && goalCfg().listen !== false) return 'listen';
    if (document.hidden || Date.now() - lastActive > READ_IDLE) return false;
    if (S.view === 'books' && B.open && B.chapters && !B.loading) return 'book';
    if (!goalCfg().booksOnly && S.readerId && !$('reader').hidden) return 'article';
    return false;
  }
  function streak() {
    const goal = goalCfg().mins; let n = 0; const d = new Date();
    if (dayMins(dayKey(d)) < goal) d.setDate(d.getDate() - 1); // today still counts toward the streak until midnight
    while (dayMins(dayKey(d)) >= goal) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const finishedThisYear = () => Object.values(S.prefs.finished || {}).filter(at => (at || '').startsWith(String(new Date().getFullYear()))).length;
  function saveReading() {
    if (!unsaved) return;
    const key = dayKey(), log = { ...(S.prefs.readLog || {}) };
    log[key] = { ...(log[key] || {}), [deviceId]: Math.round(((log[key] || {})[deviceId] || 0) + unsaved) };
    unsaved = 0;
    // Keep about a year and a half of days
    const keys = Object.keys(log).sort(); while (keys.length > 550) delete log[keys.shift()];
    S.prefs.readLog = log; savePrefs();
  }
  setInterval(() => {
    if (!readingNow()) return;
    unsaved += 5;
    const today = dayKey(), goal = goalCfg().mins;
    const before = dayMins(today) + (unsaved - 5) / 60, after = dayMins(today) + unsaved / 60;
    if (before < goal && after >= goal && celebrated !== today) {
      celebrated = today; store.set('goalDone', today); saveReading();
      const s = streak();
      status(`You hit today’s reading goal: ${goal} minutes.${s > 1 ? ` That’s a ${s}-day streak.` : ' Come back tomorrow to start a streak.'}`);
      document.body.classList.add('goal-hit'); setTimeout(() => document.body.classList.remove('goal-hit'), 2600);
    }
    if (unsaved >= 60) saveReading();
    if (S.view === 'today') paintGoalChip();
    if (S.view === 'books' && B.open) paintBookGoal();
    if (S.view === 'books' && !B.open) renderList();
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveReading(); });
  window.addEventListener('pagehide', saveReading);
  function markFinished(slug) {
    if ((S.prefs.finished || {})[slug]) return;
    S.prefs.finished = { ...(S.prefs.finished || {}), [slug]: new Date().toISOString() };
    if (S.prefs.reading === slug) delete S.prefs.reading;
    savePrefs();
    const n = finishedThisYear(), g = goalOn() ? goalCfg().books : 0;
    status(`Finished ${bookOf(slug)?.title || 'the book'}.${goalOn() ? ` That’s ${n} ${n === 1 ? 'book' : 'books'} this year${g ? ` of your ${g}` : ''}.` : ''}`);
  }
  const ring = (frac, size = 76, sw = 7) => {
    const r = size / 2 - sw / 2 - 1, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
    return `<svg class="g-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  };
  // On Today, under the clock: a small ring with today's minutes and the streak. Opens Books.
  // While a book is open: a hairline along the top that fills toward today's goal, and a tiny count
  function paintBookGoal() {
    const fill = $('bkGoalFill'), t = $('bkGoalT'); if (!fill) return;
    fill.parentNode.hidden = !goalOn(); if (t) t.hidden = !goalOn();
    if (!goalOn()) return;
    const g = goalCfg(), today = dayMins(dayKey()) + unsaved / 60, hit = today >= g.mins;
    fill.style.width = `${Math.min(100, (today / g.mins) * 100).toFixed(1)}%`;
    fill.parentNode.classList.toggle('done', hit);
    if (t) t.textContent = hit ? '✓ Goal done' : `${Math.floor(today)} of ${g.mins} min`;
  }
  function paintGoalChip() {
    const el = $('goalChip'); if (!el) return;
    if (!goalOn()) { el.hidden = true; return; }
    const g = goalCfg(), today = dayMins(dayKey()) + unsaved / 60, s = streak(), hit = today >= g.mins;
    el.hidden = false;
    el.title = hit ? `Today’s reading goal is done: ${Math.floor(today)} minutes` : `Reading goal: ${Math.floor(today)} of ${g.mins} minutes today`;
    el.innerHTML = `${ring(today / g.mins, 16, 3)}<span>${hit ? 'Goal done' : `${Math.floor(today)} of ${g.mins} min`}</span>${s ? `<span class="gc-streak">· ${s}-day streak</span>` : ''}`;
  }
  function goalHtml() {
    if (!goalOn()) return `<section class="goal goal-off"><div class="g-text"><h3>Set a reading goal</h3><p>Choose minutes a day and books a year, and keep a streak going. Only real reading counts, and nothing is tracked until you turn it on.</p></div><button class="btn" data-goal="edit">Set a goal</button></section>`;
    const g = goalCfg(), today = dayMins(dayKey()) + unsaved / 60, s = streak(), done = finishedThisYear();
    const mins = Math.floor(today), hit = today >= g.mins;
    // The week: a dot per day, filled when the goal was met
    const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); const m = dayMins(dayKey(d)) + (i === 6 ? unsaved / 60 : 0);
      return `<span class="g-day${m >= g.mins ? ' on' : m > 0 ? ' some' : ''}" title="${d.toLocaleDateString('en-US', { weekday: 'long' })}: ${Math.floor(m)} min">${d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>`; }).join('');
    return `<section class="goal" aria-label="Reading goal">
      <div class="g-today">${ring(today / g.mins)}<div class="g-num"><b>${mins}</b><span>of ${g.mins} min</span></div></div>
      <div class="g-text"><h3>${hit ? 'Today’s goal: done' : 'Reading goal'}</h3>
        <p>${hit ? `${mins} minutes today.` : `${Math.max(1, Math.ceil(g.mins - today))} more ${Math.ceil(g.mins - today) === 1 ? 'minute' : 'minutes'} to reach today’s goal.`} ${s ? `<b class="g-streak">${s}-day streak</b>` : ''}</p>
        <div class="g-week">${week}</div>
        <p class="g-small">${g.booksOnly ? 'Counting time in books' : 'Counting time in books and stories'}${g.listen !== false ? ' and listening.' : '.'} Books this year: <b>${done}${g.books ? ` of ${g.books}` : ''}</b></p></div>
      <button class="btn" data-goal="edit">Change goal</button></section>`;
  }
  function editGoal() {
    const g = goalCfg();
    const el = sheet('goalPanel', `<h2>Reading goal</h2>
      <p>Only real reading counts: time with a book or a story open while you’re turning pages or scrolling.</p>
      <label class="g-field">Minutes a day <input id="gMins" type="number" min="1" max="600" value="${g.mins}"></label>
      <label class="g-field">Books this year <input id="gBooks" type="number" min="0" max="365" value="${g.books}"></label>
      <label class="g-check"><input id="gBooksOnly" type="checkbox"${g.booksOnly ? ' checked' : ''}> Count books only, not stories</label>
      <label class="g-check"><input id="gListen" type="checkbox"${g.listen !== false ? ' checked' : ''}> Count listening to audiobooks</label>
      <div class="row sheet-foot">${goalOn() ? '<button class="btn ghost-x" type="button" id="gOff" style="margin-right:auto">Turn off</button>' : ''}<button class="btn" type="button" id="gCancel">Cancel</button><button class="btn primary" type="button" id="gSave">${goalOn() ? 'Save' : 'Start'}</button></div>`, 'Reading goal');
    $('gCancel').onclick = () => { el.hidden = true; };
    if ($('gOff')) $('gOff').onclick = () => { S.prefs.goal = { ...goalCfg(), on: false }; savePrefs(); el.hidden = true; renderList(); renderHead(); status('Reading goal turned off. Nothing is counted until you turn it on again.'); };
    $('gSave').onclick = () => {
      const mins = Math.max(1, Math.min(600, Number($('gMins').value) || 15)), books = Math.max(0, Math.min(365, Number($('gBooks').value) || 0));
      S.prefs.goal = { mins, books, booksOnly: $('gBooksOnly').checked, listen: $('gListen').checked, on: true }; savePrefs(); el.hidden = true; renderList(); renderHead();
    };
  }

  // ------------------------------------------------------------ Audiobooks: free LibriVox recordings, read by volunteers
  const AUDIOBOOKS = [
    { id: '549', title: 'Walden', author: 'Henry David Thoreau', why: 'Two years in a cabin by a pond, read aloud.' },
    { id: '1095', title: 'Meditations', author: 'Marcus Aurelius', why: 'A Roman emperor’s notes to himself, in short sections.' },
    { id: '1143', title: 'The Autobiography of Benjamin Franklin', author: 'Benjamin Franklin', why: 'A founder’s own story, plain spoken.' },
    { id: '253', title: 'Pride and Prejudice', author: 'Jane Austen', why: 'The great love story, chapter by chapter.' },
    { id: '314', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', why: 'Twelve mysteries, each about an hour.' },
  ];
  const ABK = new Map(); // id → the book's details from LibriVox (chapters, reader, cover)
  const abFetching = new Set();
  const allAudio = () => [...AUDIOBOOKS, ...((S.prefs.myAudio || []).filter(m => !AUDIOBOOKS.some(b => b.id === m.id)))];
  const abOf = id => allAudio().find(b => b.id === id);
  const abPos = id => (S.prefs.audio || {})[id] || null;
  const abDone = id => !!(S.prefs.finished || {})['ab:' + id];
  const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const fmtDur = s => { const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`; };
  async function abInfo(id) {
    if (ABK.has(id)) return ABK.get(id);
    if (abFetching.has(id)) return null;
    abFetching.add(id);
    try { const b = await invoke('audiobook', { input: id }); ABK.set(id, b); return b; }
    catch (e) { ABK.set(id, { error: msg(e) }); return null; }
    finally { abFetching.delete(id); if (S.view === 'books' && B.mode === 'listen' && !B.open) renderList(); }
  }
  // Where you are: chapter and seconds into it; how far through the whole book
  function abProgress(id) {
    const b = ABK.get(id), p = abPos(id);
    if (!b?.chapters || !p) return { frac: 0, done: 0 };
    const before = b.chapters.slice(0, p.ch).reduce((a, c) => a + c.secs, 0);
    const total = b.secs || b.chapters.reduce((a, c) => a + c.secs, 0) || 1;
    return { frac: Math.min(1, (before + (p.t || 0)) / total), done: before + (p.t || 0), total };
  }
  // ---- The player: one audio element for audiobooks, a bar at the bottom while one is loaded
  const AB = { id: null, ch: 0 };
  const abAudio = Object.assign(document.createElement('audio'), { preload: 'metadata', id: 'abAudio' });
  document.body.appendChild(abAudio);
  const abBar = document.createElement('div'); abBar.className = 'abp'; abBar.id = 'abBar'; abBar.hidden = true; abBar.setAttribute('role', 'region'); abBar.setAttribute('aria-label', 'Audiobook player');
  document.body.appendChild(abBar);
  const abPlaying = () => !!AB.id && !abAudio.paused && !abAudio.ended;
  const AB_RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];
  const abRate = () => Number(store.get('abRate')) || 1;
  function saveAbPos(force) {
    if (!AB.id) return;
    const t = Math.floor(abAudio.currentTime || 0), prev = abPos(AB.id);
    if (!force && prev && prev.ch === AB.ch && Math.abs((prev.t || 0) - t) < 15) return;
    S.prefs.audio = { ...(S.prefs.audio || {}), [AB.id]: { ch: AB.ch, t, at: new Date().toISOString() } };
    savePrefs();
  }
  async function abPlay(id, ch, t) {
    const b = ABK.get(id) || await abInfo(id);
    if (!b?.chapters) { status(ABK.get(id)?.error || 'Couldn’t load that audiobook. Try again.', true); return; }
    const p = abPos(id);
    if (ch == null) { ch = p && !abDone(id) ? p.ch : 0; t = p && !abDone(id) ? p.t : 0; }
    if (AB.id && AB.id !== id) saveAbPos(true);
    AB.id = id; AB.ch = Math.max(0, Math.min(b.chapters.length - 1, ch));
    const c = b.chapters[AB.ch];
    if (abAudio.dataset.src !== c.url) { abAudio.src = c.url; abAudio.dataset.src = c.url; }
    abAudio.playbackRate = abRate();
    const start = () => { if (t) try { abAudio.currentTime = t; } catch {} abAudio.playbackRate = abRate(); abAudio.play().catch(e => status('Couldn’t play: ' + (e.message || 'the recording didn’t load'), true)); };
    if (abAudio.readyState >= 1) start(); else abAudio.addEventListener('loadedmetadata', start, { once: true });
    if (abDone(id) && AB.ch === 0) { const f = { ...(S.prefs.finished || {}) }; delete f['ab:' + id]; S.prefs.finished = f; } // listening again
    S.prefs.listening = S.prefs.listening || id;
    saveAbPos(true);
    if ('mediaSession' in navigator) {
      const art = b.cover ? [{ src: b.cover, sizes: '512x512', type: 'image/jpeg' }] : [];
      navigator.mediaSession.metadata = new MediaMetadata({ title: c.title || b.title, artist: b.author, album: b.title, artwork: art });
    }
    paintAbBar(); if (S.view === 'books' && B.mode === 'listen' && !B.open) renderList();
  }
  function abToggle() { if (!AB.id) return; abAudio.paused ? abAudio.play().catch(() => {}) : abAudio.pause(); }
  function abSkip(d) { if (!AB.id) return; abAudio.currentTime = Math.max(0, Math.min((abAudio.duration || 1e9) - 1, abAudio.currentTime + d)); paintAbBar(); }
  function abNextRate() { const r = AB_RATES[(AB_RATES.indexOf(abRate()) + 1) % AB_RATES.length]; store.set('abRate', String(r)); abAudio.playbackRate = r; paintAbBar(); paintAbNow(); }
  function abStop() { saveAbPos(true); abAudio.pause(); AB.id = null; abBar.hidden = true; document.body.classList.remove('ab-on'); if (S.view === 'books') renderList(); }
  if ('mediaSession' in navigator) {
    const h = { play: () => abAudio.play(), pause: () => abAudio.pause(), seekbackward: () => abSkip(-15), seekforward: () => abSkip(30),
      previoustrack: () => AB.id && abPlay(AB.id, AB.ch - 1, 0), nexttrack: () => AB.id && abPlay(AB.id, AB.ch + 1, 0) };
    for (const [k, f] of Object.entries(h)) try { navigator.mediaSession.setActionHandler(k, f); } catch {}
  }
  abAudio.addEventListener('timeupdate', () => { saveAbPos(); paintAbBar(true); paintAbNow(); });
  abAudio.addEventListener('play', () => { markActive(); paintAbBar(); paintAbNow(); });
  abAudio.addEventListener('pause', () => { saveAbPos(true); paintAbBar(); paintAbNow(); });
  abAudio.addEventListener('ended', () => {
    const b = ABK.get(AB.id); if (!b) return;
    if (AB.ch < b.chapters.length - 1) { abPlay(AB.id, AB.ch + 1, 0); return; }
    const id = AB.id;
    S.prefs.finished = { ...(S.prefs.finished || {}), ['ab:' + id]: new Date().toISOString() };
    if (S.prefs.listening === id) delete S.prefs.listening;
    S.prefs.audio = { ...(S.prefs.audio || {}), [id]: { ch: b.chapters.length - 1, t: 0, at: new Date().toISOString() } };
    savePrefs(); const n = finishedThisYear();
    status(`Finished listening to ${b.title}.${goalOn() ? ` That’s ${n} ${n === 1 ? 'book' : 'books'} this year.` : ''}`);
    abStop();
  });
  const PLAY_I = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>', PAUSE_I = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  function paintAbBar(timeOnly) {
    if (!AB.id) { abBar.hidden = true; return; }
    const b = ABK.get(AB.id), c = b?.chapters?.[AB.ch]; if (!c) return;
    const dur = abAudio.duration || c.secs || 0, now = abAudio.currentTime || 0;
    if (timeOnly && $('abT')) { $('abT').textContent = `${fmtT(now)} of ${fmtT(dur)}`; $('abFill').style.width = `${dur ? (100 * now / dur).toFixed(2) : 0}%`; return; }
    abBar.hidden = false; document.body.classList.add('ab-on');
    abBar.innerHTML = `<div class="abp-track"><span id="abFill" style="width:${dur ? (100 * now / dur).toFixed(2) : 0}%"></span></div>
      <div class="abp-row">${b.cover ? `<img class="abp-cv" src="${esc(b.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="abp-cv"></span>'}
        <button class="abp-t" data-ab="show"><b>${esc(b.title)} · ${esc(c.title || 'Part ' + (AB.ch + 1))}</b><span id="abT">${fmtT(now)} of ${fmtT(dur)}</span></button>
        <button class="abp-b" data-ab="back" title="Back 15 seconds" aria-label="Back 15 seconds">↺ 15</button>
        <button class="abp-play" data-ab="toggle" aria-label="${abAudio.paused ? 'Play' : 'Pause'}">${abAudio.paused ? PLAY_I : PAUSE_I}</button>
        <button class="abp-b" data-ab="fwd" title="Ahead 30 seconds" aria-label="Ahead 30 seconds">30 ↻</button>
        <button class="abp-rate" data-ab="rate" title="Speed">${abRate()}×</button>
        <button class="abp-x" data-ab="stop" title="Close the player" aria-label="Close the player">×</button></div>`;
  }
  // Live numbers on the Currently listening card while it plays
  function paintAbNow() {
    const el = $('nlPos'); if (!el || el.dataset.id !== AB.id) return;
    const b = ABK.get(AB.id), c = b?.chapters?.[AB.ch]; if (!c) return;
    const now = abAudio.currentTime || 0, dur = abAudio.duration || c.secs;
    const before = b.chapters.slice(0, AB.ch).reduce((a, x) => a + x.secs, 0), total = b.secs || 1;
    el.textContent = `Chapter ${AB.ch + 1} of ${b.chapters.length} · ${fmtT(dur - now)} left in this chapter · ${fmtDur(Math.max(0, total - before - now))} left in the book`;
    if ($('nlFill')) $('nlFill').style.width = `${(100 * (before + now) / total).toFixed(1)}%`;
    if ($('nlPlay')) $('nlPlay').innerHTML = abPlaying() ? PAUSE_I : PLAY_I;
    if ($('nlRate')) $('nlRate').textContent = abRate() + '×';
  }
  // ---- The Listen side of Books
  function currentListen() {
    if (S.prefs.listening && abOf(S.prefs.listening)) return S.prefs.listening;
    const opened = Object.entries(S.prefs.audio || {}).filter(([id]) => abOf(id) && !abDone(id)).sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
    return opened.length ? opened[0][0] : null;
  }
  function abCover(id, big) {
    const s = abOf(id), b = ABK.get(id), hue = hueFor(s.title);
    return `<button class="cover${big ? ' big' : ''}" data-ab="play" data-id="${esc(id)}" aria-label="Listen to ${esc(s.title)}">${b?.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <span class="cv-fallback" style="background:linear-gradient(160deg,hsl(${hue} 40% 34%),hsl(${(hue + 40) % 360} 40% 22%))"><b>${esc(s.title)}</b><i>${esc(s.author)}</i></span><span class="cv-ear" aria-hidden="true">🎧</span></button>`;
  }
  function nowListeningHtml(id) {
    const s = abOf(id), b = ABK.get(id), p = abPos(id), pr = abProgress(id), mine = AB.id === id;
    if (!b?.chapters) abInfo(id);
    const ch = mine ? AB.ch : p ? p.ch : 0;
    const chapters = b?.chapters ? `<ol class="chapters">${b.chapters.map((c, i) => `<li><button class="ch${i < ch ? ' done' : ''}${i === ch ? ' now' : ''}" data-ab="ch" data-id="${esc(id)}" data-i="${i}"><span class="ch-n">${i < ch ? '✓' : i === ch ? '▶' : i + 1}</span><span class="ch-t">${esc(c.title || 'Part ' + (i + 1))}</span><span class="ch-d">${fmtT(c.secs)}</span></button></li>`).join('')}</ol>` : `<p class="bk-pos">${esc(b?.error || 'Getting the chapters from LibriVox…')}</p>`;
    const pos = b?.chapters ? (p ? `Chapter ${ch + 1} of ${b.chapters.length} · ${fmtDur(Math.max(0, (b.secs || 0) - pr.done))} left in the book` : `${b.chapters.length} chapters · ${fmtDur(b.secs)}`) : '';
    return `<section class="now-reading listen">${abCover(id, true)}
      <div class="nr-body"><p class="nr-k">Currently listening <button class="nr-change" data-ab="choose" aria-haspopup="menu">Change</button></p><h2>${esc(s.title)}</h2>
        <p class="by">${esc(s.author)}${b?.reader ? ` · read by ${esc(b.reader)}` : ''}</p>
        ${b?.chapters ? `<div class="bk-prog nr-prog"><span id="nlFill" style="width:${(100 * pr.frac).toFixed(1)}%"></span></div><p class="bk-pos" id="nlPos" data-id="${esc(id)}">${pos}</p>` : ''}
        <div class="nr-play"><button class="skip" data-ab="back" ${mine ? '' : 'disabled'}>↺ 15</button>
          <button class="bigplay" id="nlPlay" data-ab="${mine ? 'toggle' : 'play'}" data-id="${esc(id)}" aria-label="Play">${mine && abPlaying() ? PAUSE_I : PLAY_I}</button>
          <button class="skip" data-ab="fwd" ${mine ? '' : 'disabled'}>30 ↻</button><button class="speed" id="nlRate" data-ab="rate">${abRate()}×</button>
          ${goalOn() && goalCfg().listen !== false ? '<span class="goal-chip-lite">Counts toward your reading goal</span>' : ''}</div>
        ${chapters}</div></section>`;
  }
  function listenHtml() {
    const cur = currentListen(), list = allAudio();
    list.forEach(b => { if (!ABK.has(b.id)) abInfo(b.id); });
    const card = s => {
      const b = ABK.get(s.id), p = abPos(s.id), done = abDone(s.id), pr = abProgress(s.id);
      const info = done ? 'Finished' : p && b?.chapters ? `Chapter ${p.ch + 1} of ${b.chapters.length} · ${Math.round(100 * pr.frac)}%` : b?.secs ? `Not started · ${fmtDur(b.secs)}` : b?.error ? 'Couldn’t load' : '';
      return `<article class="book">${abCover(s.id)}<div class="book-body"><h3>${done ? '<span class="bk-fin" title="Finished">✓</span> ' : ''}${esc(s.title)}</h3><p class="by">${esc(s.author)}</p>
        ${b?.reader ? `<p class="by reader">Read by ${esc(b.reader)}</p>` : `<p class="why">${esc(s.why || '')}</p>`}
        ${p && !done ? `<div class="bk-prog"><span style="width:${Math.max(3, Math.round(100 * pr.frac))}%"></span></div>` : ''}<p class="bk-pos">${info}</p>
        <div class="bk-acts"><button class="btn ${p ? '' : 'primary'}" data-ab="play" data-id="${esc(s.id)}">${done ? 'Listen again' : p ? '▶ Resume' : '▶ Listen'}</button>
          ${cur ? `<button class="btn ghost-x" data-ab="current" data-id="${esc(s.id)}">Set as currently listening</button>` : ''}
          ${AUDIOBOOKS.some(x => x.id === s.id) ? '' : `<button class="btn ghost-x" data-ab="remove" data-id="${esc(s.id)}">Remove</button>`}</div></div></article>`;
    };
    return (cur ? nowListeningHtml(cur) : '') + `${cur ? '<h2 class="sec-h shelf-h">Your audiobooks</h2>' : ''}<div class="shelf">${list.filter(s => s.id !== cur).map(card).join('')}</div>
      <form class="add-book" id="addAbForm"><label for="addAb"><b>Add an audiobook</b> Find one at <a href="https://librivox.org/">librivox.org</a>, copy the link of its page, and paste it here.</label>
        <div class="row"><input id="addAb" placeholder="librivox.org/walden-by-henry-david-thoreau/" autocomplete="off" autocapitalize="off" spellcheck="false"${B.abAdding ? ' disabled' : ''}>
        <button class="btn primary" type="submit"${B.abAdding ? ' disabled' : ''}>${B.abAdding ? 'Adding…' : 'Add to shelf'}</button></div>${B.abErr ? `<p class="fol-err">${esc(B.abErr)}</p>` : ''}</form>
      <p class="hw-foot">Free audiobooks from <a href="https://librivox.org/">LibriVox</a>, read by volunteers around the world and in the public domain in the US. Playing needs a connection; the app remembers where you stopped.</p>`;
  }
  async function addAudiobook(input) {
    B.abAdding = true; B.abErr = ''; renderList();
    try {
      const b = await invoke('audiobook', { input });
      ABK.set(b.id, b);
      if (abOf(b.id)) B.abErr = 'That audiobook is already on your shelf.';
      else { S.prefs.myAudio = [...(S.prefs.myAudio || []), { id: b.id, title: b.title, author: b.author }]; savePrefs(); status(`${b.title} is on your shelf.`); }
    } catch (e) { B.abErr = msg(e); }
    B.abAdding = false; renderList();
  }
  function abAction(b) {
    const k = b.dataset.ab, id = b.dataset.id;
    if (k === 'play') return abPlay(id);
    if (k === 'toggle') return abToggle();
    if (k === 'back') return abSkip(-15);
    if (k === 'fwd') return abSkip(30);
    if (k === 'rate') return abNextRate();
    if (k === 'stop') return abStop();
    if (k === 'ch') return abPlay(id, Number(b.dataset.i), 0);
    if (k === 'show') { closeReader(true); B.mode = 'listen'; store.set('booksMode', 'listen'); B.open = null; selectView('books'); return; }
    if (k === 'current') { S.prefs.listening = id; savePrefs(); renderList(); $('main').scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (k === 'remove') { S.prefs.myAudio = (S.prefs.myAudio || []).filter(m => m.id !== id); const a = { ...(S.prefs.audio || {}) }; delete a[id]; S.prefs.audio = a; if (AB.id === id) abStop(); savePrefs(); renderList(); return; }
    if (k === 'choose') {
      const menu = $('replyMenu'), cur = currentListen();
      menu.innerHTML = `<p class="menu-head">Currently listening</p>${allAudio().map(x => `<button type="button" data-pick="${esc(x.id)}">${x.id === cur ? '✓ ' : ''}${esc(x.title)}${abDone(x.id) ? ' (finished)' : ''}</button>`).join('')}`;
      placeMenu(menu, b);
      menu.onclick = e => { const p = e.target.closest('[data-pick]'); if (!p) return; menu.hidden = true; menu.onclick = null; S.prefs.listening = p.dataset.pick; savePrefs(); renderList(); };
    }
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
    const remoteBoard = /weworkremotely|remotive|remoteok/.test(f.url || '');
    if (!loc && remoteBoard) loc = 'Remote';
    if (!loc) {
      const hay = `${it.title} ${sum}`;
      loc = (m = /\b([A-Z][a-zA-Z .'-]{2,24},\s*[A-Z]{2})\b/.exec(hay)) ? m[1]
        : /\bhybrid\b/i.test(hay) ? 'Hybrid'
        : /weworkremotely|remotive|remoteok/.test(f.url || '') || /\bremote\b/i.test(hay) ? 'Remote' : '';
    }
    title = title.replace(/\s*\((remote|hybrid)\)\s*$/i, '');
    let blurb = sum.replace(title, '').replace(company, '')
      .replace(/Headquarters:\s*[^:]*?(?=\s+URL:)/i, '').replace(/Headquarters:\s*[A-Z][\w ,.'-]*?\b(United States|USA|Canada|United Kingdom|Remote|Worldwide|Anywhere)\b/i, '').replace(/Headquarters:\s*/gi, '').replace(/URL:\s*\S+/gi, '')
      .replace(/\b(Job Description|About the (Role|Company|Job)|Position|Primary Location|Description)\s*:\s*/gi, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s|:·,.-]+/, '').trim();
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
    // One section (a category picked, or only one has ads): its ads flow across the whole page
    const body = groups.length === 1
      ? `<section class="cat solo" style="--c:${CAT_HUE[groups[0][0]]}"><h3>${esc(CAT_NAME[groups[0][0]].toUpperCase())}</h3><div class="solo-cols">${groups[0][1].map(adHtml).join('')}</div></section>`
      : `<div class="classifieds">${groups.map(([k, l]) => `<section class="cat" style="--c:${CAT_HUE[k]}"><h3>${esc(CAT_NAME[k].toUpperCase())}</h3>${l.map(adHtml).join('')}</section>`).join('')}</div>`;
    return head + filters + body + `
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
  // Back to Discover as it was: no search, no results
  function clearTopic() { D.q = ''; D.res = null; D.searching = false; renderList(); setTimeout(() => $('topicQ')?.focus(), 0); }
  async function topicSearch(q) {
    q = (q || '').trim(); if (!q) return clearTopic(); if (q.length < 2) return;
    D.q = q; D.searching = true; D.res = null; renderList();
    store.set('topicSearches', JSON.stringify([q, ...recentSearches().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)));
    try { D.res = await invoke('topic_search', { query: q }); } catch (e) { D.res = { query: q, news: [], web: [], news_error: msg(e), web_error: '' }; }
    D.searching = false; if (S.view === 'discover') renderList();
    // Featured pictures fill in as they arrive
    const want = [...(D.res.web || []).map(w => w.url), ...(D.res.small || []).map(p => p.link)].filter(u => !D.imgs.has(u));
    if (want.length) invoke('page_images', { urls: want }).then(list => {
      for (const [u, img] of list) D.imgs.set(u, img || '');
      if (S.view === 'discover' && D.res?.query === q) renderList();
    }).catch(() => {});
  }
  const followsHost = h => S.feeds.some(f => [hostOfU(f.site), hostOfU(f.url)].some(x => x && bareHost(x) === bareHost(h)));
  function searchHtml() {
    const recent = recentSearches();
    let out = `<form class="t-search" id="topicForm" role="search"><span class="t-field"><input id="topicQ" type="search" placeholder="Search a topic, like slow travel or home espresso" value="${esc(D.q)}" autocomplete="off" aria-label="Search a topic">
      ${D.q || D.res ? '<button class="t-clear" type="button" data-topic="reset" title="Clear the search" aria-label="Clear the search">×</button>' : ''}</span>
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
    if (r.small?.length) out += `<div class="t-head"><h2 class="sec-h">Fresh from personal sites</h2></div><p class="sec-p">Recent posts about “${esc(r.query)}” from the small web.</p><div class="t-results">${r.small.map(smallHit).join('')}</div>
      <p class="disc-foot">From <a href="https://kagi.com/smallweb">Kagi Small Web</a>, an open list of personal sites and their newest posts.</p>`;
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
    if (k === 'reset') return clearTopic();
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
    return searchHtml() + (D.res || D.searching ? '' : smallWebHtml()) + blogrollHtml();
  }
  // ---- Kagi Small Web: the newest posts from an open list of personal sites, with a Follow button for each site
  function smallHit(p) {
    const on = followsHost(p.site) || D.added.has(p.site);
    return `<article class="t-hit">${tThumb(D.imgs.get(p.link), p.site, p.link, !D.imgs.has(p.link))}<div class="t-body"><a class="t-title" href="${esc(p.link)}">${esc(p.title)}</a>
      <span class="t-site">${esc(p.site)}${p.date ? ` · ${esc(agoWords(p.date))}` : ''}</span>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
      <div class="t-acts">${on ? '<span class="t-on">✓ Following</span>' : `<button class="btn" data-topic="site" data-url="${esc('https://' + p.site + '/')}" data-site="${esc(p.site)}">Follow ${esc(p.site)}</button>`}
        ${D.err?.[p.site] ? `<span class="fol-err">${esc(D.err[p.site])}</span>` : ''}</div></div></article>`;
  }
  let smallLoading = false;
  async function loadSmallWeb() {
    if (smallLoading || D.small) return; smallLoading = true;
    try { D.small = await invoke('smallweb_feed'); D.smallErr = ''; } catch (e) { D.smallErr = msg(e); }
    smallLoading = false;
    if (S.view === 'discover') renderList();
    const want = (D.small || []).slice(0, 24).map(p => p.link).filter(u => !D.imgs.has(u));
    if (want.length) invoke('page_images', { urls: want }).then(list => {
      for (const [u, img] of list) D.imgs.set(u, img || '');
      if (S.view === 'discover') renderList();
    }).catch(() => {});
  }
  function smallWebHtml() {
    const head = `<h2 class="sec-h">Fresh from the small web</h2><p class="disc-intro">The newest posts from personal sites, people writing on their own corner of the web. Follow the ones you like.</p>`;
    if (!D.small) {
      if (D.smallErr) return head + `<p class="note">${esc(D.smallErr)} <button class="linkish" data-small="retry">Try again</button></p><hr class="t-rule">`;
      setTimeout(loadSmallWeb, 0);
      return head + `<p class="note">Loading the newest posts…</p><hr class="t-rule">`;
    }
    const fresh = D.small.filter(p => !followsHost(p.site) || D.added.has(p.site));
    const show = fresh.slice(0, D.smallMore ? 24 : 6);
    return head + `<div class="t-results">${show.map(smallHit).join('')}</div>
      ${!D.smallMore && fresh.length > 6 ? '<button class="btn" data-small="more">Show more</button>' : ''}
      <p class="disc-foot">From <a href="https://kagi.com/smallweb">Kagi Small Web</a>, an open list of personal sites. Anyone can suggest a site, including yours.</p><hr class="t-rule">`;
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
  // YouTube won't play inside the app directly (Error 153: the app isn't a website), so videos play through
  // a small player page on readingroomapp.com, which hosts YouTube's privacy-enhanced player.
  const ytPlayer = (id, title) => `<iframe src="https://readingroomapp.com/play/?v=${encodeURIComponent(id)}&title=${encodeURIComponent(title || '')}" title="${esc(title || 'Video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
  const ytId = link => { const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(link || ''); return m ? m[1] : null; };
  const socialKind = link => /bsky\.app\/profile\/[^/]+\/post\//.test(link || '') ? 'Bluesky'
    : /^https?:\/\/[^/]+\/@[\w.]+\/\d+$/.test(link || '') ? 'Mastodon' : null;
  const isSocialFeed = f => /\/@[\w.]+\.rss$/.test(f?.url || '') || /bsky\.app\/profile\/[^/]+\/rss$/.test(f?.url || '');
  const kindTag = it => it.audio ? '<span class="via">Podcast</span>' : ytId(it.link) ? '<span class="via">Video</span>' : socialKind(it.link) ? `<span class="via">${socialKind(it.link)}</span>` : '';

  function paintMedia(it) {
    const box = $('rMedia'), yt = ytId(it.link);
    box.hidden = !(yt || it.audio); box.innerHTML = '';
    if (yt) {
      box.innerHTML = `<div class="r-video">${ytPlayer(yt, it.title)}</div>`;
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
    youAlerts();
    renderRail(); if (S.view === 'talk') { renderHead(); renderList(); }
  }

  // ---- connecting accounts
  function accountsHtml() {
    const row = (net, a, body) => `<section class="acct"><h3>${ICON_NET[net]}${NET[net]}</h3>${a
      ? `<p>Connected as <b>${esc(a.handle)}</b>.</p><div class="row"><button class="btn" data-disconnect="${net}">Disconnect</button></div>`
      : body}</section>`;
    const wp = SOC.accounts.wordpress;
    return `<h2 id="socialTitle">Your site, Mastodon &amp; Bluesky</h2>
      <p>Connect your own site and accounts to post notes and stories with your thoughts, and to see and answer the replies in Conversations. Sign-ins are kept in Apple’s Keychain and sync to your other Apple devices through iCloud Keychain; they’re sent only to your own site and servers.</p>
      <section class="acct"><h3>${ICONS.site}Your site <small class="acct-sub">WordPress</small></h3>${wp
        ? `<p>Connected to <b>${esc(wp.name)}</b> (${esc(wp.site.replace(/^https?:\/\//, ''))}) as ${esc(wp.user)}. Notes go in a Notes category there.</p><div class="row"><button class="btn" data-disconnect="wordpress">Disconnect</button></div>`
        : `<p>Post short notes to your own site first, then share copies that link back to it. Use an <b>Application Password</b>, not your real password: in WordPress open <button class="b-link" id="wpAppPw" type="button">Users › Profile › Application Passwords</button>, type “The Reading Room” and press Add. You can revoke it anytime.</p>
        <form class="acct-form" id="wpForm"><input id="wpSite" placeholder="yoursite.com" autocapitalize="off" spellcheck="false" autocomplete="url">
        <input id="wpUser" placeholder="WordPress username" autocapitalize="off" spellcheck="false" autocomplete="username">
        <input id="wpPass" type="password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" autocomplete="off"><button class="btn primary" type="submit">Connect</button></form>`}</section>
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
    const el = sheet('socialPanel', accountsHtml(), 'Your site, Mastodon and Bluesky');
    const note = (t, err) => { $('acctNote').textContent = t; $('acctNote').classList.toggle('err', !!err); };
    el.onclick = async e => {
      if (e.target.id === 'socialDone') { el.hidden = true; return; }
      const u = e.target.closest('[data-open-url]'); if (u) { invoke('open_external', { url: u.dataset.openUrl }).catch(() => {}); return; }
      const d = e.target.closest('[data-disconnect]');
      if (d) { SOC.accounts = await invoke('social_disconnect', { network: d.dataset.disconnect }); SOC.conv = null; openAccounts(); renderRail(); }
    };
    $('wpAppPw')?.addEventListener('click', () => {
      const raw = ($('wpSite')?.value || '').trim().replace(/\/+$/, '');
      if (!raw) { note('Type your site’s address first, then press the link again.', true); $('wpSite').focus(); return; }
      invoke('open_external', { url: `${raw.includes('://') ? raw : 'https://' + raw}/wp-admin/profile.php#application-passwords-section` }).catch(() => {});
    });
    $('wpForm')?.addEventListener('submit', async e => {
      e.preventDefault(); note('Checking your site…');
      try { SOC.accounts = await invoke('site_connect', { site: $('wpSite').value, user: $('wpUser').value, password: $('wpPass').value }); openAccounts(); renderRail(); }
      catch (err) { note(msg(err), true); }
    });
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

  // ------------------------------------------------------------ Settings
  // The links that used to fill the bottom of the sidebar live here now. Each keeps its own handler;
  // choosing one closes Settings and opens that panel.
  const closeSettings = () => { $('settingsPanel').hidden = true; };
  $('settingsBtn').onclick = () => { $('settingsPanel').hidden = false; $('settingsDone').focus(); };
  $('settingsPanel').addEventListener('mousedown', e => { if (e.target.id === 'settingsPanel') closeSettings(); });
  $('settingsDone').onclick = e => { e.stopPropagation(); closeSettings(); };
  $('settingsPanel').addEventListener('click', e => {
    const t = e.target.closest('[data-theme]');
    if (t) { typePrefs.theme = t.dataset.theme; applyType(); return; } // Appearance changes in place; Settings stays open
    if (e.target.closest('button')) closeSettings();
  });

  // ------------------------------------------------------------ Email: one mailbox of your own
  // The app reads its inbox (IMAP) into the Email tab and sends replies from it (SMTP), like Mail does.
  // Best with an address on your own domain used only for the app. The sign-in is kept in the Keychain.
  const MAIL_HOSTS = {
    ionos: { label: 'IONOS', imap: 'imap.ionos.com', imapPort: 993, smtp: 'smtp.ionos.com', smtpPort: 465 },
    gmail: { label: 'Gmail', imap: 'imap.gmail.com', imapPort: 993, smtp: 'smtp.gmail.com', smtpPort: 465 },
    icloud: { label: 'iCloud Mail', imap: 'imap.mail.me.com', imapPort: 993, smtp: 'smtp.mail.me.com', smtpPort: 587 },
    fastmail: { label: 'Fastmail', imap: 'imap.fastmail.com', imapPort: 993, smtp: 'smtp.fastmail.com', smtpPort: 465 },
    yahoo: { label: 'Yahoo Mail', imap: 'imap.mail.yahoo.com', imapPort: 993, smtp: 'smtp.mail.yahoo.com', smtpPort: 465 },
    proton: { label: 'Proton Mail (with Bridge, on a Mac)', imap: '127.0.0.1', imapPort: 1143, smtp: '127.0.0.1', smtpPort: 1025 },
    other: { label: 'Another provider', imap: '', imapPort: 993, smtp: '', smtpPort: 465 },
  };
  function mailProviderFor(addr) {
    const d = (addr.split('@')[1] || '').toLowerCase();
    if (/^(gmail|googlemail)\.com$/.test(d)) return 'gmail';
    if (/^(icloud|me|mac)\.com$/.test(d)) return 'icloud';
    if (/^fastmail\.(com|fm)$/.test(d)) return 'fastmail';
    if (/^yahoo\./.test(d)) return 'yahoo';
    if (/^(proton\.me|protonmail\.(com|ch)|pm\.me)$/.test(d)) return 'proton';
    return null;
  }
  async function loadMailAccount() {
    try { MAIL.account = await invoke('email_account'); } catch { MAIL.account = null; }
    const n = $('mailSetNote'); if (n) n.textContent = MAIL.account ? `Connected: ${MAIL.account.address}` : 'Read and answer one mailbox of your own in the Email tab';
  }
  // New mail: on start, with Refresh, and when you come back to the app (at most every 2 minutes)
  // A Proton mailbox comes through Bridge on the Mac; iPhone and iPad have no Bridge to reach
  const bridgeAway = () => !!MAIL.account && IOS && /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(MAIL.account.imap_host);
  async function checkMail(quiet) {
    if (!MAIL.account || MAIL.checking || bridgeAway()) return;
    if (quiet && Date.now() - MAIL.last < 120e3) return;
    MAIL.checking = true; MAIL.last = Date.now();
    if (S.view === 'email') { renderList(); renderHead(); }
    try {
      const r = await invoke('email_refresh'), n = r?.added || 0;
      MAIL.error = ''; MAIL.inbox = r?.inbox ?? null; MAIL.checkedAt = new Date();
      if (n && !quiet) status(`${n} new ${n === 1 ? 'email' : 'emails'}.`);
    } catch (e) { MAIL.error = msg(e); }
    MAIL.checking = false;
    if (S.view === 'email') { renderList(); renderHead(); }
  }
  function mailBarHtml() {
    if (!MAIL.account) return `<div class="mailbar mail-intro"><div><strong>Read your email here</strong>
      <span>Connect one mailbox and its inbox shows up in this tab, beside your reading. Replies go out from the same address. It works best with an address on your own domain that you use only for this app, like reading@yoursite.com.</span></div>
      <span class="mb-acts"><button class="btn primary" type="button" data-mailbar="setup">Connect your email</button></span></div>`;
    const domain = MAIL.account.address.split('@')[1];
    if (bridgeAway()) return `<div class="mailbar"><div><span class="mb-lbl">This mailbox is read through Proton Mail Bridge on your Mac, so it can only be used there. On this device, connect a mailbox from another provider in Email settings.</span></div><span class="mb-acts"><button class="btn" type="button" data-mailbar="setup">Email settings</button></span></div>`;
    const problems = [
      MAIL.error && `<span class="mb-err">${esc(MAIL.error)}</span>`,
      MAIL.elsewhere && `<span class="mb-err">Mail for ${esc(domain)} is delivered to ${esc(MAIL.elsewhere)}, not to this mail server, so mail sent to this address won’t arrive here.</span>`,
    ].filter(Boolean);
    if (!problems.length) return '';
    return `<div class="mailbar mail-problem"><div>${problems.join('')}</div>
      <span class="mb-acts"><button class="btn" type="button" data-mailbar="check"${MAIL.checking ? ' disabled' : ''}>Try again</button><button class="btn" type="button" data-mailbar="setup">Email settings</button></span></div>`;
  }
  $('list').addEventListener('click', e => {
    const b = e.target.closest('[data-mailbar]'); if (!b) return;
    if (b.dataset.mailbar === 'setup') openMailSettings();
    if (b.dataset.mailbar === 'check') checkMail();
  });
  $('mailBtn').onclick = () => openMailSettings();

  function openMailSettings() {
    const a = MAIL.account;
    const pick = a ? (Object.keys(MAIL_HOSTS).find(k => MAIL_HOSTS[k].imap === a.imap_host) || 'other') : 'ionos';
    const opts = Object.entries(MAIL_HOSTS).map(([k, v]) => `<option value="${k}"${k === pick ? ' selected' : ''}>${v.label}</option>`).join('');
    const el = sheet('mailPanel', `<h2>Email</h2>
      <p>Connect one mailbox to read its inbox in the Email tab and reply from it. Best: an address on your own domain that you use only for this app, like reading@yoursite.com. The app reads the inbox; it only moves an email (to the Trash) when you delete it.</p>
      <form class="mail-form" id="mailForm" autocomplete="off">
        <label>Email provider<select id="mailProv">${opts}</select></label>
        <label>Your name <span class="hint">(shown on replies)</span><input id="mailName" type="text" maxlength="80" value="${esc(a?.name || '')}" placeholder="David Daniels"></label>
        <label>Email address<input id="mailAddr" type="email" required value="${esc(a?.address || '')}" placeholder="reading@yoursite.com" spellcheck="false" autocapitalize="off"></label>
        <label>Password<input id="mailPw" type="password" ${a ? 'placeholder="Saved (leave empty to keep it)"' : 'required'} autocomplete="new-password"></label>
        <p class="note" id="mailPwNote"></p>
        <details id="mailServers"${pick === 'other' ? ' open' : ''}><summary>Mail servers</summary>
          <div class="mail-srv"><label>Incoming (IMAP)<input id="mailImap" type="text" spellcheck="false" autocapitalize="off"></label><label>Port<input id="mailImapPort" type="number" min="1" max="65535"></label></div>
          <div class="mail-srv"><label>Outgoing (SMTP)<input id="mailSmtp" type="text" spellcheck="false" autocapitalize="off"></label><label>Port<input id="mailSmtpPort" type="number" min="1" max="65535"></label></div>
        </details>
        <label>Signature <span class="hint">(added to every email you send; leave empty for none)</span><textarea id="mailSig" rows="3">${esc(mailSig())}</textarea></label>
        <p class="note" id="mailNote">${a ? `Connected to ${esc(a.address)}.` : 'Each device connects its own mailbox (so your Mac can use one and your iPhone another). Your password stays in this device’s Keychain, and nothing goes through The Reading Room’s servers.'}</p>
        <div class="row sheet-foot">${a ? '<button class="btn danger" type="button" id="mailOff">Disconnect</button>' : ''}<button class="btn" type="button" id="mailCancel">${a ? 'Done' : 'Cancel'}</button><button class="btn primary" type="submit" id="mailGo">${a ? 'Save' : 'Connect'}</button></div>
      </form>`, 'Email');
    const note = (t, err) => { $('mailNote').textContent = t; $('mailNote').classList.toggle('err', !!err); };
    const fill = k => {
      const h = MAIL_HOSTS[k];
      if (k !== 'other') { $('mailImap').value = h.imap; $('mailImapPort').value = h.imapPort; $('mailSmtp').value = h.smtp; $('mailSmtpPort').value = h.smtpPort; }
      else if (!$('mailImap').value) { $('mailImapPort').value = h.imapPort; $('mailSmtpPort').value = h.smtpPort; }
      $('mailPwNote').textContent = { gmail: 'Gmail needs an app password: in your Google Account, turn on 2-Step Verification, then make one under App passwords.', icloud: 'iCloud needs an app-specific password: make one at account.apple.com under Sign-In and Security.', yahoo: 'Yahoo needs an app password: make one in your Yahoo account’s security settings.', fastmail: 'Fastmail needs an app password: make one under Settings › Privacy & Security.', ionos: 'The mailbox password you set in your IONOS control panel.', proton: 'Proton works through Proton Mail Bridge on this Mac (a paid Proton plan). Keep Bridge open, choose your account in it, and copy the password it shows under Mailbox details (not your Proton password). If Bridge shows other ports, change them under Mail servers. Proton mail can only be read on a Mac that runs Bridge.', other: 'Your mailbox password. Your provider’s help pages list its IMAP and SMTP servers.' }[k] || '';
    };
    fill(pick);
    if (a) { $('mailImap').value = a.imap_host; $('mailImapPort').value = a.imap_port; $('mailSmtp').value = a.smtp_host; $('mailSmtpPort').value = a.smtp_port; }
    $('mailProv').onchange = () => { fill($('mailProv').value); if ($('mailProv').value === 'other') $('mailServers').open = true; };
    $('mailAddr').onchange = () => { const k = mailProviderFor($('mailAddr').value.trim()); if (k && k !== $('mailProv').value) { $('mailProv').value = k; fill(k); } };
    $('mailCancel').onclick = () => { el.hidden = true; };
    if ($('mailOff')) $('mailOff').onclick = async () => {
      const btn = $('mailOff');
      if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Disconnect this mailbox?'; return; }
      await invoke('email_disconnect').catch(() => {});
      await loadMailAccount(); el.hidden = true; render();
      status('Email disconnected on this device. Your other devices keep theirs, and mail already in the Email tab stays.');
    };
    $('mailForm').onsubmit = async e => {
      e.preventDefault();
      const account = { address: $('mailAddr').value.trim(), name: $('mailName').value.trim(), password: $('mailPw').value,
        imap_host: $('mailImap').value.trim(), imap_port: Number($('mailImapPort').value) || 993, smtp_host: $('mailSmtp').value.trim(), smtp_port: Number($('mailSmtpPort').value) || 465 };
      const sig = $('mailSig').value;
      if (sig !== mailSig()) { S.prefs.mailSig = sig; savePrefs(); }
      const go = $('mailGo'); go.disabled = true; go.textContent = 'Signing in…'; note('');
      try {
        const res = await invoke('email_connect', { account });
        MAIL.elsewhere = res?.elsewhere || '';
        await loadMailAccount();
        el.hidden = true;
        await load();
        selectView('email');
        checkMail();
      } catch (err) { note(msg(err), true); go.disabled = false; go.textContent = a ? 'Save' : 'Connect'; }
    };
  }

  // ---- writing: one sheet for new emails, replies and Write back. Your signature goes at the end.
  const DEFAULT_SIG = '—\nSent from The Reading Room\nhttps://readingroomapp.com';
  const mailSig = () => (typeof S.prefs.mailSig === 'string' ? S.prefs.mailSig : DEFAULT_SIG);
  const withSig = body => { const sig = mailSig().trim(); return `${body || ''}${sig ? `\n\n${sig}` : ''}`; };

  async function openMailReply(it) {
    try {
      const r = await invoke('email_reply_to', { itemId: it.id });
      openMailCompose({ to: r.to, toName: r.name, subject: r.subject, replyTo: it.id });
    } catch (e) { status(msg(e), true); }
  }

  function openMailCompose({ to = '', toName = '', subject = '', body = '', replyTo = null } = {}) {
    if (!MAIL.account) { openMailSettings(); status('Connect your email first.'); return; }
    const fixedTo = !!replyTo;
    const el = sheet('mailComposePanel', `<h2>${replyTo ? 'Reply' : 'New email'}</h2>
      <div class="mail-form mc-fields">
        <label class="mc-line"><span>To</span>${fixedTo ? `<span class="mc-fixed">${esc(toName && toName !== to ? `${toName} <${to}>` : to)}</span>` : `<input id="mcTo" type="email" value="${esc(to)}" placeholder="name@example.com" spellcheck="false" autocapitalize="off">`}</label>
        <label class="mc-line"><span>Subject</span>${fixedTo ? `<span class="mc-fixed">${esc(subject)}</span>` : `<input id="mcSubj" type="text" value="${esc(subject)}">`}</label>
        <div class="mc-line"><span>From</span><span class="mc-fixed">${esc(MAIL.account.name ? `${MAIL.account.name} <${MAIL.account.address}>` : MAIL.account.address)}</span></div>
      </div>
      <textarea id="mcBody" rows="11"></textarea>
      <p class="note" id="mcNote">Sent from your mailbox and filed in its Sent folder. Change the signature in Email settings.</p>
      <div class="row sheet-foot"><button class="btn" type="button" id="mcCancel">Cancel</button><button class="btn primary" type="button" id="mcSend">Send</button></div>`, replyTo ? 'Reply' : 'New email');
    const box = $('mcBody');
    box.value = withSig(body.startsWith('\n') ? body : body ? `\n\n${body}` : '');
    const note = (t, err) => { $('mcNote').textContent = t; $('mcNote').classList.toggle('err', !!err); };
    $('mcCancel').onclick = () => { el.hidden = true; };
    setTimeout(() => { if (!fixedTo && !$('mcTo').value) $('mcTo').focus(); else { box.focus(); box.setSelectionRange(0, 0); box.scrollTop = 0; } }, 30);
    $('mcSend').onclick = async () => {
      const text = box.value, b = $('mcSend');
      if (!text.replace(mailSig(), '').trim()) { note('Write something first.', true); return; }
      b.disabled = true; b.textContent = 'Sending…'; note('');
      try {
        const sentTo = replyTo
          ? await invoke('email_reply', { itemId: replyTo, body: text })
          : await invoke('email_send', { to: $('mcTo').value, subject: $('mcSubj').value, body: text });
        el.hidden = true; status(`Sent to ${sentTo}.`);
      } catch (e) { note(msg(e), true); b.disabled = false; b.textContent = 'Send'; }
    };
  }
  $('mailNew').onclick = () => openMailCompose();
  $('rDelete').onclick = () => { const it = item(S.readerId); if (it) deleteMail(it); };
  // Delete: the email goes to the mailbox's Trash and leaves the Email tab at once (put back if the server says no)
  async function deleteMail(it) {
    if (!it || !isEmailItem(it)) return;
    const list = visible(), i = list.findIndex(x => x.id === it.id), next = list[i + 1] || list[i - 1];
    const wasOpen = S.readerId === it.id;
    S.items = S.items.filter(x => x.id !== it.id);
    if (wasOpen) { if (next && isSplit()) openReader(next.id); else closeReader(); }
    render();
    try {
      const folder = await invoke('email_delete', { itemId: it.id });
      status(folder ? `Moved to ${folder}.` : 'Deleted.');
    } catch (e) { status(msg(e), true); load(); }
  }
  $('mailSet').onclick = () => openMailSettings();
  $('mailCheck').onclick = () => { refresh(); };

  function mailSub() {
    if (!MAIL.account) return 'Read and answer one mailbox of your own here';
    const n = unreadIn('email'), parts = [MAIL.account.address];
    if (n) parts.push(`${n} unread`);
    if (MAIL.inbox === 0) parts.push('the inbox is empty');
    parts.push(MAIL.checking ? 'checking…' : MAIL.checkedAt ? `checked ${MAIL.checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'not checked yet');
    return parts.join(' · ');
  }
  // When: the time today, the day this week, otherwise the date
  function mailWhen(d) {
    const t = new Date(d), now = new Date();
    if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (now - t < 6 * DAY) return t.toLocaleDateString([], { weekday: 'short' });
    return t.toLocaleDateString([], t.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function mailRow(it) {
    const from = srcLabel(it);
    return `<article class="story mail-row${it.read ? ' read' : ''}${S.selId === it.id ? ' sel' : ''}${S.readerId === it.id ? ' open' : ''}" data-id="${esc(it.id)}">
      <span class="mr-av" style="--h:${hueFor('mail:' + from)}" aria-hidden="true">${esc((from.trim()[0] || '?').toUpperCase())}</span>
      <button class="mr-main title" data-act="open"><span class="mr-top"><span class="mr-from">${esc(from)}</span><time datetime="${esc(it.date)}">${esc(mailWhen(it.date))}</time></span>
        <span class="mr-subj">${esc(headline(it))}</span>${it.summary ? `<span class="mr-snip">${esc(it.summary)}</span>` : ''}</button>
      <div class="acts mr-acts">
        <button class="icon" data-act="mdel" title="Move to the Trash" aria-label="Move to the Trash">${ICONS.trash}</button>
        <button class="icon${it.saved ? ' on' : ''}" data-act="save" title="${it.saved ? 'Remove from Read later' : 'Read later'}" aria-label="${it.saved ? 'Remove from Read later' : 'Read later'}">${it.saved ? ICONS.saved : ICONS.save}</button>
        <button class="icon" data-act="read" title="${it.read ? 'Mark unread' : 'Mark read'}" aria-label="${it.read ? 'Mark unread' : 'Mark read'}">${it.read ? ICONS.read : ICONS.unread}</button>
      </div></article>`;
  }
  loadMailAccount().then(() => { if (MAIL.account) { if (S.view === 'email') render(); setTimeout(() => checkMail(true), 2500); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkMail(true); });

  // ---- posting a story with your note
  const LIMIT = { bluesky: 300, mastodon: 500 };

  // ---- Notes: short posts that go to your own site first, then copies to Bluesky and Mastodon that link home.
  // A photo is shrunk here (Bluesky takes pictures under 1 MB), goes in the note and becomes its featured image.
  async function shrinkPhoto(file) {
    // Decode without a blob: address (the app's content rules don't allow those for images):
    // createImageBitmap where it works, otherwise a data: address, which is allowed.
    let img, w, h;
    try { img = await createImageBitmap(file); w = img.width; h = img.height; }
    catch {
      const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
      img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = data; });
      w = img.naturalWidth; h = img.naturalHeight;
    }
    if (!w || !h) throw new Error('unreadable');
    let scale = Math.min(1, 2000 / Math.max(w, h));
    for (let tries = 0; tries < 6; tries++) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // see-through PNGs get a white background, not black
      g.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.86, 0.76, 0.66]) {
        const url = c.toDataURL('image/jpeg', q);
        if (url.length * 0.75 < 940_000) { img.close?.(); return url; }
      }
      scale *= 0.8;
    }
    img.close?.();
    throw new Error('too big');
  }
  function openNote(it) {
    const wp = SOC.accounts.wordpress; if (!wp) { openAccounts(); return; }
    const nets = ['bluesky', 'mastodon'].filter(n => SOC.accounts[n]);
    const quote = it ? S.highlights.find(h => h.item_id === it.id)?.text || '' : '';
    const f = it && feedById(it.feed_id);
    let photo = '';
    const el = sheet('notePanel', `<h2>${it ? 'Note about this' : 'New note'}</h2>
      ${it ? `<div class="c-card">${isWeb(it.image) ? `<img src="${esc(it.image)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(headline(it))}</b><span>${esc(srcLabel(it) || f?.title || '')}</span></div></div>` : ''}
      <input class="n-field n-title" id="nTitle" type="text" placeholder="Title (optional)" maxlength="200" autocomplete="off">
      <textarea id="nText" rows="5" placeholder="${it ? 'What did you think? Mention the writer to let them know.' : 'What’s on your mind?'}"></textarea>
      <div class="n-tools">${quote ? '<button class="b-link" id="nQuote" type="button">Add your highlight as a quote</button>' : ''}
        <button class="b-link" id="nPhotoBtn" type="button">+ Add a photo</button>${it ? '' : '<button class="b-link" id="nLinkBtn" type="button">+ Add a link</button>'}
        <span class="n-room" id="nRoom"></span><input id="nPhoto" type="file" accept="image/*" hidden></div>
      <input class="n-field" id="nLink" type="url" placeholder="https:// a link to add" hidden autocapitalize="off" spellcheck="false">
      <div class="n-photo" id="nPhotoBox" hidden><img id="nPrev" alt=""><div><input class="n-field" id="nAlt" placeholder="Describe the photo for people who can’t see it" maxlength="1000"><button class="b-link" id="nPhotoX" type="button">Remove photo</button></div></div>
      <label class="n-home"><input type="checkbox" id="nSite" checked><span class="slim-ini n-ini" style="background:hsl(${hueFor(wp.site)} 45% 42%)">${esc((wp.name || '?').trim()[0].toUpperCase())}</span>
        <span><b>Post to ${esc(wp.site.replace(/^https?:\/\//, ''))}</b><small>As a note: without a title, its first words are used. It goes on your Notes page and in its feed.</small></span></label>
      ${nets.length ? `<p class="n-also" id="nAlso">Also share a copy that links back to it</p>
      <div class="c-nets">${nets.map(n => `<label class="c-net"><input type="checkbox" value="${n}" checked>${ICON_NET[n]}${NET[n]} <small>${esc(SOC.accounts[n].handle)}</small></label>`).join('')}</div>` : ''}
      <label class="c-net n-x"><input type="checkbox" id="nX"${store.get('noteX') === '1' ? ' checked' : ''}><span class="x-mark" aria-hidden="true">X</span>Then open X with a copy <small>you press Post there</small></label>
      <p class="acct-note" id="nNote" aria-live="polite"></p>
      <div class="row sheet-foot"><button class="btn" type="button" id="nCancel">Cancel</button><button class="btn" type="button" id="nDraft">Save as draft</button><button class="btn primary" type="button" id="nPost">Post</button></div>`, it ? 'Note about this' : 'New note');
    const text = $('nText'), boxes = () => [...el.querySelectorAll('.c-net input:checked:not(#nX)')].map(x => x.value);
    $('nX').onchange = () => store.set('noteX', $('nX').checked ? '1' : '');
    const toSite = () => $('nSite').checked;
    const link = () => it ? it.link : ($('nLink').hidden ? '' : $('nLink').value.trim());
    const count = () => {
      const n = [...text.value].length, picks = boxes();
      const room = Math.min(...picks.map(p => LIMIT[p] - (toSite() || link() ? (p === 'mastodon' ? 25 : 40) : 0)), 99999);
      const over = picks.length && n > room;
      $('nRoom').textContent = !picks.length ? '' : toSite() ? (over ? 'Copies will be shortened, with the link to the full note' : `${room - n}`) : `${room - n}`;
      $('nRoom').classList.toggle('over', !toSite() && over);
      $('nAlso').textContent = toSite() ? 'Also share a copy that links back to it' : 'Post only to';
      $('nDraft').hidden = !toSite();
      $('nPost').disabled = (!toSite() && !picks.length && !$('nX').checked) || (!toSite() && over) || (!text.value.trim() && !photo);
    };
    if (!nets.length) $('nAlso')?.remove();
    const also = $('nAlso'); if (!also) { const p = document.createElement('p'); p.id = 'nAlso'; p.hidden = true; el.querySelector('.n-home').after(p); }
    text.addEventListener('input', count); el.querySelectorAll('.c-net input, #nSite').forEach(x => x.addEventListener('change', count));
    $('nLink').addEventListener('input', count);
    $('nQuote')?.addEventListener('click', () => { text.value = `“${quote}”\n\n${text.value}`.trim() + (text.value ? '' : '\n\n'); text.focus(); count(); });
    $('nLinkBtn')?.addEventListener('click', () => { $('nLink').hidden = false; $('nLinkBtn').hidden = true; $('nLink').focus(); });
    $('nPhotoBtn').onclick = () => $('nPhoto').click();
    $('nPhoto').onchange = async () => {
      const file = $('nPhoto').files[0]; if (!file) return;
      $('nNote').textContent = 'Getting the photo ready…'; $('nNote').classList.remove('err');
      try { photo = await shrinkPhoto(file); $('nPrev').src = photo; $('nPhotoBox').hidden = false; $('nPhotoBtn').hidden = true; $('nNote').textContent = ''; $('nAlt').focus(); }
      catch { photo = ''; $('nNote').textContent = 'Couldn’t open that picture. Try another one, or save it as a JPEG first.'; $('nNote').classList.add('err'); }
      $('nPhoto').value = ''; count();
    };
    $('nPhotoX').onclick = () => { photo = ''; $('nPhotoBox').hidden = true; $('nPhotoBtn').hidden = false; $('nAlt').value = ''; count(); };
    $('nCancel').onclick = () => { el.hidden = true; };
    const say = (t, err) => { $('nNote').textContent = t; $('nNote').classList.toggle('err', !!err); };
    const go = async draft => {
      const words = text.value.trim(), alt = $('nAlt').value.trim(), picks = boxes();
      if (photo && !alt && !draft && !confirm('Post the photo without a description? People using screen readers won’t know what it shows.')) { $('nAlt').focus(); return; }
      $('nPost').disabled = $('nDraft').disabled = true;
      let home = '';
      try {
        if (toSite()) {
          say(draft ? 'Saving the draft…' : `Posting to ${wp.site.replace(/^https?:\/\//, '')}…`);
          const r = await invoke('site_note', { title: $('nTitle').value.trim(), text: words, link: link(), linkTitle: it ? headline(it) : '', photo, alt, draft, linkImage: it && isWeb(it.image) ? it.image : '', linkSite: it ? (srcLabel(it) || f?.title || '') : '' });
          if (draft) { el.hidden = true; status('Saved as a draft on your site. Finish it in WordPress whenever you like.'); return; }
          home = r.url;
        }
        let shared = [], bad = [], warned = [];
        if (picks.length) {
          say(home ? 'Posted on your site. Sharing the copies…' : 'Posting…');
          const t = $('nTitle').value.trim();
          const res = await invoke('social_share_note', { networks: picks, text: words, link: home || link(), title: home ? (t || `A note on ${wp.name || 'my site'}`) : (it ? headline(it) : ''), photo, alt, video: home ? link() : '' });
          shared = res.filter(r => !r.error).map(r => NET[r.network]); bad = res.filter(r => r.error);
          warned = res.filter(r => !r.error && r.warning).map(r => `${NET[r.network]}: ${r.warning}`);
        }
        if (it) store.set('shared:' + it.id, '1');
        // X: free, because X's own compose window does the posting and you press Post (no API, no charge)
        const toX = !draft && $('nX').checked && (home || words || link());
        if (toX) await openXCopy(words || $('nTitle').value.trim(), home || link());
        const where = [home ? wp.site.replace(/^https?:\/\//, '') : '', ...shared].filter(Boolean);
        if (bad.length) {
          say(`${where.length ? `Posted to ${where.join(', ')}. ` : ''}${bad.map(r => `${NET[r.network]}: ${r.error}`).join(' ')}${warned.length ? ' ' + warned.join(' ') : ''}`, true);
          $('nPost').disabled = true; $('nCancel').textContent = 'Close'; return;
        }
        if (warned.length) { say(`Posted to ${where.join(', ')}. ${warned.join(' ')}`, true); $('nPost').disabled = true; $('nCancel').textContent = 'Close'; return; }
        el.hidden = true;
        const hostName = wp.site.replace(/^https?:\/\//, '');
        const xNote = toX ? ' X is open with your copy: press Post there.' : '';
        status(home ? `Posted to ${hostName}${shared.length ? `, then shared to ${shared.join(' and ')}` : ''}.${shared.length ? ' Replies will show in Conversations.' : ''}${xNote}` : shared.length ? `Posted to ${shared.join(' and ')}. Replies will show in Conversations.${xNote}` : xNote.trim());
        if (shared.length) setTimeout(() => { loadConversations(true); if (S.view === 'talk') renderList(); }, 4000);
      } catch (err) { say(msg(err), true); $('nPost').disabled = $('nDraft').disabled = false; }
    };
    $('nPost').onclick = () => go(false);
    $('nDraft').onclick = () => go(true);
    text.focus(); count();
  }
  /** Open X's compose window with the note's words and its link. A link counts as 23 characters on X. */
  async function openXCopy(words, url) {
    const room = 280 - (url ? 24 : 0);
    const chars = [...words.replace(/\s+/g, ' ').trim()];
    const t = chars.length > room ? chars.slice(0, room - 1).join('').replace(/\s+\S*$/, '') + '…' : chars.join('');
    const q = `text=${encodeURIComponent(t)}${url ? `&url=${encodeURIComponent(url)}` : ''}`;
    try { await invoke('open_share', { url: `https://x.com/intent/post?${q}` }); } catch (e) { status(msg(e), true); }
  }
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
  // Web addresses in a post become links that open in the web window
  function linkText(t) {
    return esc(t || '').replace(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g, u => {
      const raw = u.replace(/&amp;/g, '&');
      const shown = raw.replace(/^https?:\/\/(www\.)?/, '');
      return `<button class="linkish n-url" data-talk="open" data-url="${esc(raw)}">${esc(shown.length > 42 ? shown.slice(0, 40) + '…' : shown)}</button>`;
    });
  }
  function noteHtml(n, opts = {}) {
    const a = n.author; opts.mine = opts.mine || isMe(a);
    return `<div class="n-note${opts.reply ? ' n-reply' : ''}" style="--d:${Math.min(n.depth || 0, 6)}">
      ${isWeb(a.avatar) ? `<img class="n-av" src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="n-av fav" style="background:hsl(${hueFor(a.handle)} 45% 42%)">${esc((a.name || '?')[0])}</span>`}
      <div class="n-main">
        <div class="n-who"><b>${esc(a.name)}</b> <span>${esc(a.handle)}</span> <span class="n-net">${ICON_NET[n.network]}</span> <time>${esc(fmtWhen(n.created_at))}</time></div>
        <div class="n-text">${linkText(n.text)}</div>
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

  // ---- The Neighborhood: the people you read, as a stream you can talk back to. No account needed.
  // Their blog posts, and (with Mastodon or Bluesky connected) their short posts there, under one face.
  // Posts that link to another post you get, to another writer's blog, or to your own site are shown as the
  // conversations they are: "Tracy Durnell replied to Jason Kottke". That's how blogs have always talked.
  const NB_DAYS = 14;
  const NB_TALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  const NB_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
  // Sites everyone links to: not "writers" to suggest
  const NB_BIG = ['wikipedia.org', 'github.com', 'youtube.com', 'google.com', 'apple.com', 'microsoft.com', 'amazon.com', 'reddit.com', 'news.ycombinator.com',
    'medium.com', 'substack.com', 'archive.org', 'imdb.com', 'goodreads.com', 'spotify.com', 'npr.org', 'bbc.co.uk', 'bbc.com', 'cnn.com', 'theguardian.com',
    'theverge.com', 'wired.com', 'arstechnica.com', 'techcrunch.com', 'mozilla.org', 'w3.org', 'wordpress.org', 'flickr.com', 'vimeo.com', 'bandcamp.com',
    'letterboxd.com', 'kickstarter.com', 'gofundme.com', 'eventbrite.com', 'bit.ly', 'buff.ly', 'tinyurl.com', 'openai.com', 'anthropic.com', 'indieweb.org',
    'apnews.com', 'reuters.com', 'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'usatoday.com', 'forbes.com', 'businessinsider.com', 'bloomberg.com',
    'docs.google.com', 'drive.google.com', 'maps.google.com', 'apps.apple.com', 'podcasts.apple.com', 'music.apple.com', 'open.spotify.com', 'twitch.tv',
    'discord.com', 'discord.gg', 'stackoverflow.com', 'npmjs.com', 'pinboard.in', 'ebay.com', 'etsy.com', 'zoom.us', 'mailchimp.com', 'buttondown.email', 'ghost.org'];
  const nbBig = h => !h || NB_BIG.some(b => h === b || h.endsWith('.' + b)) || PAYWALLED.some(b => h === b || h.endsWith('.' + b));
  let NBX = { items: null };
  function nbIndex() {
    if (NBX.items === S.items && NBX.feeds === S.feeds && NBX.pv === PV) return NBX;
    const byLink = new Map();
    for (const i of S.items) { if (i.link && isWeb(i.link) && !isEmailItem(i)) byLink.set(normU(i.link), i); }
    // Every host you follow, and which of them belong to people (their blogs)
    const followed = new Set(), personHost = new Map();
    for (const f of S.feeds) {
      for (const h of [hostOfU(f.site), hostOfU(f.url)].filter(Boolean).map(bareHost)) {
        followed.add(h);
        if (kindOf(f) === 'person' && !isSocialFeed(f) && !isEmailFeed(f) && !personHost.has(h)) personHost.set(h, feedById(personId(f.id)) || f);
      }
    }
    const answers = new Map(), replyTo = new Map(), toMe = new Set(), mentions = new Map(), back = new Map(), out = new Map();
    const mine = myFeed(), myHost = mine ? bareHost(hostOfU(isWeb(mine.site) ? mine.site : mine.url)) : '';
    for (const i of S.items) {
      if (!i.links || isEmailItem(i)) continue;
      const from = personId(i.feed_id), person = isPerson(i.feed_id);
      for (const l of i.links.split(' ')) {
        if (!l) continue;
        const h = bareHost(hostOfU(l));
        const o = byLink.get(normU(l));
        if (o && o.id !== i.id && personId(o.feed_id) !== from) {
          if (!replyTo.has(i.id)) replyTo.set(i.id, o);
          if (!answers.has(o.id)) answers.set(o.id, []);
          if (!answers.get(o.id).includes(i)) answers.get(o.id).push(i);
        } else if (!o && personHost.has(h) && personHost.get(h).id !== from && !mentions.has(i.id)) mentions.set(i.id, { f: personHost.get(h), url: l });
        if (myHost && !isOwn(i.feed_id) && h === myHost) toMe.add(i.id);
        // Writers your writers link to: blogs you don't follow yet
        if (person && h && !o && !followed.has(h) && !nbBig(h) && h !== myHost && !/\.(social|bsky)/.test(h)) {
          if (!out.has(h)) out.set(h, { host: h, by: new Set(), links: 0, url: l, date: i.date });
          const w = out.get(h); w.by.add(from); w.links++;
          if (i.date > w.date) { w.date = i.date; w.url = l; }
        }
      }
    }
    for (const a of answers.values()) a.sort((x, y) => x.date.localeCompare(y.date));
    // "Back after four months": a writer's first post after a long quiet spell
    const byFeed = new Map();
    for (const i of S.items) { if (isEmailItem(i)) continue; if (!byFeed.has(i.feed_id)) byFeed.set(i.feed_id, []); byFeed.get(i.feed_id).push(i); }
    for (const list of byFeed.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
      for (let k = 1; k < list.length; k++) {
        const gap = (Date.parse(list[k].date) - Date.parse(list[k - 1].date)) / DAY;
        if (gap >= 60) back.set(list[k].id, Math.round(gap / 30));
      }
    }
    const writers = [...out.values()].filter(w => w.by.size >= 2 || w.links >= 3)
      .sort((a, b) => (b.by.size * 2 + b.links) - (a.by.size * 2 + a.links) || b.date.localeCompare(a.date));
    NBX = { items: S.items, feeds: S.feeds, pv: PV, replyTo, answers, toMe, mentions, back, writers };
    return NBX;
  }
  const nbWho = i => feedById(personId(i.feed_id)) || feedById(i.feed_id);
  const nbFeedName = f => esc(f?.title || '');
  const nbName = i => esc(nbWho(i)?.title || srcLabel(i) || hostOfU(i.link));
  // A writer's face: their Bluesky or Mastodon picture, else their site's own icon, else their coloured letter
  // Your own picture: Bluesky/Mastodon profile, then your WordPress profile picture (Gravatar), then your site icon.
  // Fetched once when first needed (Conversations may open before its own loading has run).
  let myPics = null;
  function myPicture() {
    if (!myPics) {
      myPics = { social: '', wp: '' };
      const redraw = () => { PV++; if (S.view === 'talk') renderList(); };
      if (anySocial()) (SOC.profiles ? Promise.resolve(SOC.profiles) : invoke('social_profiles')).then(p => { SOC.profiles = SOC.profiles || p; myPics.social = (p || []).find(x => isWeb(x.avatar))?.avatar || ''; if (myPics.social) redraw(); }).catch(() => {});
      if (SOC.accounts.wordpress) invoke('site_avatar').then(u => { myPics.wp = isWeb(u) ? u : ''; if (myPics.wp) redraw(); }).catch(() => {});
    }
    return (SOC.profiles || []).find(p => isWeb(p.avatar))?.avatar || myPics.social || myPics.wp || '';
  }
  function avatarOf(f) {
    if (!f || !f.id) return '';
    if (isOwn(f.id)) return myPicture() || PL[siteOf(f)]?.icon || '';
    const r = (SOC.readers || []).find(r => r.feedId === personId(f.id) && isWeb(r.person.avatar));
    return r?.person.avatar || PL[siteOf(f)]?.icon || '';
  }
  const nbFace = (f, cls = 'nb-av', pic) => {
    const [h, l] = tileFor(f).split('|'), src = pic || avatarOf(f);
    return `<span class="${cls}" style="--h:${h}" aria-hidden="true">${esc(l.toUpperCase())}${isWeb(src) ? `<img class="nb-face-img" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
  };
  // A short post (a note, a microblog post) has no title of its own: the feed's title is just its first words
  const isShort = i => !i.title || i.title === '(untitled)' || (i.summary && i.summary.startsWith(i.title.replace(/…$/, '').slice(0, 60)) && i.summary.length < 600);
  // The Mastodon and Bluesky side: which accounts are the writers you read, and who shared which link
  function nbSocial() {
    const posts = SOC.shared?.posts || [];
    const acct = new Map();
    for (const r of SOC.readers || []) { const f = feedById(r.feedId); if (!f) continue; acct.set(r.network + ':' + r.person.id, f); if (r.person.handle) acct.set(r.network + ':' + r.person.handle.toLowerCase(), f); }
    const whose = n => acct.get(n.network + ':' + n.author.id) || acct.get(n.network + ':' + (n.author.handle || '').toLowerCase());
    const byLink = new Map();
    for (const i of S.items) if (i.link && isWeb(i.link)) byLink.set(normU(i.link), i);
    const shares = new Map(), notes = [], since = Date.now() - NB_DAYS * DAY;
    for (const n of posts) {
      const it = n.link ? byLink.get(normU(n.link)) : null;
      if (it) { if (!shares.has(it.id)) shares.set(it.id, []); shares.get(it.id).push(n); continue; } // shown on the post's own card
      const f = whose(n);
      if (f && Date.parse(n.created_at) > since && !byLink.has(normU(n.url))) notes.push({ n, f });
    }
    const cross = crossPosts(notes, since);
    return { shares, notes: notes.filter(s => !cross.hidden.has(noteKey(s.n))), hidden: cross.hidden };
  }
  // ---- Cross-posts: the same words posted to Mastodon and Bluesky (or a short note on the blog copied to both) show
  // once. The copy kept is the blog's own if there is one, then the Mastodon/Bluesky post (Like and Reply work there),
  // then a copy from a Mastodon/Bluesky feed; ties go to the first posted. The kept card says where else it went.
  const noteKey = n => 'n:' + n.network + ':' + n.id;
  const crossText = t => (t || '').replace(/https?:\/\/\S+/g, ' ').replace(/(^|\s)[@#][\w.@-]+/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Mostly the same words, in any order: each network has its own @handles ("@unbreaking.org" on Bluesky is
  // "Unbreaking" on Mastodon), and one may cut the post short. Short posts must match word for word.
  function sameWords(a, b) {
    if (a.length < 12 || b.length < 12) return false;
    const A = new Set(a.split(' ')), B = new Set(b.split(' '));
    const small = A.size <= B.size ? A : B, big = small === A ? B : A;
    if (small.size < 6) return a === b;
    let hit = 0; for (const w of small) if (big.has(w)) hit++;
    return hit / small.size >= 0.75;
  }
  // The same outside page linked from both copies (its address, cut short or not)
  const crossLink = u => normU(u).replace(/(…|\.\.\.)$/, '');
  const sameLink = (a, b) => a.some(x => x.length > 12 && b.some(y => y.length > 12 && (x === y || x.startsWith(y) || y.startsWith(x))));
  let CROSS = {}, ALSO = new Map();
  function crossPosts(notes, since) {
    if (CROSS.items === S.items && CROSS.feeds === S.feeds && CROSS.shared === SOC.shared && CROSS.readers === SOC.readers && CROSS.pv === PV) return CROSS;
    const byWho = new Map(), add = e => { if (!e.who || e.text.length < 12) return; if (!byWho.has(e.who)) byWho.set(e.who, []); byWho.get(e.who).push(e); };
    for (const i of S.items) {
      if (Date.parse(i.date) <= since || !isShort(i)) continue;
      const f = feedById(i.feed_id); if (!f || isEmailItem(i)) continue;
      const net = socialNet(f);
      add({ key: 'i:' + i.id, who: nbWho(i)?.id, src: net || 'blog', rank: net ? 2 : 0, at: Date.parse(i.date), url: i.link, out: (i.links || '').split(' ').filter(Boolean).map(crossLink), text: crossText(i.summary || i.title) });
    }
    for (const { n, f } of notes) add({ key: noteKey(n), who: f.id, src: n.network, rank: 1, at: Date.parse(n.created_at), url: n.url, out: [n.link, ...((n.text || '').match(/https?:\/\/\S+/g) || [])].filter(Boolean).map(crossLink), text: crossText(n.text) });
    const hidden = new Set(), also = new Map();
    for (const list of byWho.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.rank - b.rank || a.at - b.at);
      const kept = [];
      for (const e of list) {
        const k = kept.find(x => x.src !== e.src && !x.srcs.has(e.src) && Math.abs(x.at - e.at) < 36 * 3600e3 && (sameWords(x.text, e.text) || sameLink(x.out, e.out)));
        if (!k) { kept.push({ ...e, srcs: new Set([e.src]) }); continue; }
        hidden.add(e.key); k.srcs.add(e.src);
        if (!also.has(k.key)) also.set(k.key, []);
        also.get(k.key).push({ net: e.src, url: e.url });
      }
    }
    ALSO = also;
    CROSS = { items: S.items, feeds: S.feeds, shared: SOC.shared, readers: SOC.readers, pv: PV, hidden, also };
    return CROSS;
  }
  // "Also on Bluesky" under a card that was posted in more than one place
  const alsoHtml = key => (ALSO.get(key) || []).map(a => `<button class="linkish" data-talk="open" data-url="${esc(a.url)}">Also on ${a.net === 'blog' ? 'their blog' : NET[a.net] || a.net}</button>`).join('');
  function sharesHtml(i, soc) {
    const people = new Map();
    for (const n of soc.shares.get(i.id) || []) if (!people.has(n.author.handle)) people.set(n.author.handle, { name: n.author.name, url: n.url, net: n.network });
    for (const { item: c, feed: f } of folds().on?.get(i.id) || []) { if (f && !people.has(f.url)) people.set(f.url, { name: f.title, url: c.link, net: socialNet(f) }); }
    if (!people.size) return '';
    const list = [...people.values()], first = list[0], nets = [...new Set(list.map(p => p.net).filter(Boolean))];
    return `<div class="nb-shared">${NB_SHARE}<span>Shared by <button class="linkish" data-talk="open" data-url="${esc(first.url)}">${esc(first.name)}</button>${list.length > 1 ? ` and ${list.length - 1} other${list.length > 2 ? 's' : ''}` : ''}${nets.length ? ` on ${nets.map(n => NET[n] || n).join(' and ')}` : ''}</span></div>`;
  }
  function nbCard(i, x, soc, mode = '') {
    const f = nbWho(i), to = x.replyTo.get(i.id), ans = x.answers.get(i.id) || [], short = isShort(i), mention = !to && x.mentions.get(i.id);
    const mine = isOwn(i.feed_id);
    const sum = (i.summary || '').trim();
    const text = short ? sum : sum.length > 260 ? sum.slice(0, 250).replace(/\s+\S*$/, '') + '…' : sum;
    const pic = isWeb(i.image) ? `<button class="nb-picb" data-open="${esc(i.id)}" aria-label="Open the post"><img class="nb-pic" src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>` : '';
    const myR = mode !== 'reply' && answerOf(i);
    const reply = mode === 'reply' ? '' : myR ? `<button class="nb-to" data-talk="open" data-url="${esc(myR.url)}">${NB_TALK}<span>Answers <b>your reply</b> to ${esc(myR.title)}</span></button>` : to ? `<button class="nb-to" data-open="${esc(to.id)}">${NB_TALK}<span>Replying to <b>${nbName(to)}</b>: ${esc(headline(to))}</span></button>`
      : mention ? `<button class="nb-to" data-talk="open" data-url="${esc(mention.url)}">${NB_TALK}<span>Mentions <b>${nbFeedName(mention.f)}</b>’s blog</span></button>` : '';
    const answered = ans.length && !mode ? `<div class="nb-ans"><span class="nb-ans-k">${ans.length === 1 ? 'An answer' : `${ans.length} answers`} from blogs you read</span>
        ${ans.slice(0, 4).map(a => `<button class="nb-ans-r" data-open="${esc(a.id)}">${nbFace(nbWho(a), 'nb-av sm')}<span><b>${nbName(a)}</b> ${esc(headline(a))} <time>${esc(fmtWhen(a.date))}</time></span></button>`).join('')}</div>` : '';
    // Your own posts: the replies they got on Mastodon and Bluesky
    const yours = mine ? (SOC.conv?.posts || []).filter(p => p.link && normU(p.link) === normU(i.link)) : [];
    const yourReplies = yours.reduce((s, p) => s + (p.replies || 0), 0);
    const back = x.back.get(i.id);
    if (mode === 'reply') {
      const t = sum.length > 200 ? sum.slice(0, 190).replace(/\s+\S*$/, '') + '…' : sum;
      return `<article class="nb-post nb-reply${i.read || mine ? '' : ' unread'}" data-id="${esc(i.id)}">
        ${f ? `<button class="nb-avb" data-talk="nbwho" data-feed="${esc(f.id)}" title="Only ${esc(f.title)}">${nbFace(f, 'nb-av md')}</button>` : nbFace(null, 'nb-av md')}
        <div class="nb-main">
          <div class="nb-by"><button class="nb-name" data-talk="nbwho" data-feed="${esc(f?.id || '')}">${nbName(i)}</button>${mine ? '<span class="nb-tag you">You</span>' : ''}<span>replied</span><time>${esc(fmtWhen(i.date))}</time></div>
          ${short ? '' : `<button class="nb-title sm" data-open="${esc(i.id)}">${esc(headline(i))}</button>`}
          ${t ? `<p class="nb-text">${esc(t)}</p>` : ''}
          ${likedByHtml(i)}
          ${reactionsHtml(i)}
          <div class="nb-acts"><button class="linkish" data-open="${esc(i.id)}">Read</button>${mine ? '' : `<button class="linkish" data-talk="nbrbox" data-id="${esc(i.id)}">${replyLbl(i.id)}</button>${likeBtn(i)}${repostBtn(i)}`}${commentsBtn(i)}</div>
          ${cmtsHtml(i)}
          <div class="n-box" data-box="nb:${esc(i.id)}"></div>
        </div></article>`;
    }
    return `<article class="nb-post${i.read || mine ? '' : ' unread'}${short ? ' short' : ''}${mine ? ' mine' : ''}" data-id="${esc(i.id)}">
      ${f ? `<button class="nb-avb" data-talk="nbwho" data-feed="${esc(f.id)}" title="Only ${esc(f.title)}">${nbFace(f)}</button>` : nbFace(null)}
      <div class="nb-main">
        <div class="nb-by"><button class="nb-name" data-talk="nbwho" data-feed="${esc(f?.id || '')}">${nbName(i)}</button>${mine ? '<span class="nb-tag you">You</span>' : ''}${isFriend(f) ? `<span class="nb-star" title="Close friend">${NB_STAR}</span>` : ''}<span>${esc(hostOfU(i.link))}</span><time>${esc(fmtWhen(i.date))}</time>${x.toMe.has(i.id) ? '<span class="nb-tag">Links to you</span>' : readsYou(f) ? READS_YOU : ''}${back ? `<span class="nb-tag back">Back after ${back} month${back === 1 ? '' : 's'}</span>` : ''}</div>
        ${reply}
        ${short ? '' : `<button class="nb-title" data-open="${esc(i.id)}">${esc(headline(i))}</button>`}
        ${text ? `<p class="nb-text">${esc(text)}</p>` : ''}
        ${pic}
        ${topicsHtml(i)}
        ${sharesHtml(i, soc)}
        ${likedByHtml(i)}
        ${reactionsHtml(i)}
        <div class="nb-acts">
          <button class="linkish" data-open="${esc(i.id)}">${short ? 'Open' : 'Read'}</button>
          ${mine ? (yours.length ? `<button class="linkish" data-talk="tab" data-tab="posts">${yourReplies ? `${yourReplies} ${yourReplies === 1 ? 'reply' : 'replies'}` : 'No replies yet'} on ${[...new Set(yours.map(p => NET[p.network]))].join(' and ')}</button>`
              : anySocial() ? `<button class="linkish" data-talk="sharemine" data-id="${esc(i.id)}">Share to ${['bluesky', 'mastodon'].filter(n => SOC.accounts[n]).map(n => NET[n]).join(' & ')}</button>` : '')
            : `<button class="linkish" data-talk="nbrbox" data-id="${esc(i.id)}">${replyLbl(i.id)}</button>
          ${likeBtn(i)}
          ${repostBtn(i)}
          ${SOC.moreOpen === i.id ? `<button class="linkish" data-talk="nbshare" data-id="${esc(i.id)}" aria-haspopup="menu">Share</button>
          <button class="linkish" data-talk="nbsave" data-id="${esc(i.id)}">${i.saved ? 'Saved ✓' : 'Read later'}</button>
          <button class="linkish" data-talk="open" data-url="${esc(i.link)}">Open their site</button>`
            : `${alsoHtml('i:' + i.id)}<button class="linkish nb-dots" data-talk="nbdots" data-id="${esc(i.id)}" aria-label="More: Share, Read later, Open their site" title="More">⋯</button>`}`}
          ${commentsBtn(i)}
        </div>
        ${cmtsHtml(i)}
        <div class="n-box" data-box="nb:${esc(i.id)}"></div>
        ${answered}
      </div></article>`;
  }
  // A short post on Mastodon or Bluesky by a writer you read, under their face
  function nbNote({ n, f }) {
    const pic = isWeb(n.image) ? `<button class="nb-picb" data-talk="open" data-url="${esc(n.link || n.url)}" aria-label="Open"><img class="nb-pic" src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>` : '';
    const card = n.link ? `<button class="nb-link" data-talk="open" data-url="${esc(n.link)}"><b>${esc(n.link_title || hostOfU(n.link))}</b><small>${esc(hostOfU(n.link))}</small></button>` : '';
    return `<article class="nb-post short social">
      <button class="nb-avb" data-talk="nbwho" data-feed="${esc(f.id)}" title="Only ${esc(f.title)}">${nbFace(f, 'nb-av', avatarOf(f) || n.author.avatar)}</button>
      <div class="nb-main">
        <div class="nb-by"><button class="nb-name" data-talk="nbwho" data-feed="${esc(f.id)}">${nbFeedName(f)}</button><span class="nb-net">${ICON_NET[n.network] || ''} ${esc(n.author.handle)}</span><time>${esc(fmtWhen(n.created_at))}</time>${n.via ? `<span>boosted by ${esc(n.via)}</span>` : ''}</div>
        <p class="nb-text">${linkText(n.text)}</p>
        ${card}${pic}
        <div class="nb-acts">
          <button class="linkish" data-talk="reply" data-net="${n.network}" data-id="${esc(n.id)}" data-cid="${esc(n.cid)}" data-root="${esc(n.root_id || '')}" data-rootcid="${esc(n.root_cid || '')}" data-handle="${esc(n.author.handle)}">Reply</button>
          ${noteLikeBtn(n)}
          <button class="linkish" data-talk="open" data-url="${esc(n.url)}">Open on ${NET[n.network]}</button>${alsoHtml(noteKey(n))}
          ${n.replies ? `<span class="nb-count">${n.replies} ${n.replies === 1 ? 'reply' : 'replies'}</span>` : ''}${n.likes ? `<span class="nb-count">${n.likes} ${n.network === 'mastodon' ? 'favorites' : 'likes'}</span>` : ''}
        </div>
        <div class="n-box" data-box="${esc(n.id)}"></div>
      </div></article>`;
  }
  // Suggestions: blogs that several of the people you read link to, and you don't follow yet
  function nbWriters(limit) {
    const hid = hiddenIn('w');
    return nbIndex().writers.filter(w => !hid.has(w.host) || SOC.added?.has(w.host)).slice(0, limit);
  }
  function writerRow(w) {
    const names = [...w.by].map(id => feedById(id)?.title).filter(Boolean);
    const by = names.length > 2 ? `${esc(names[0])}, ${esc(names[1])} and ${names.length - 2} more` : names.map(esc).join(' and ');
    const path = w.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    return `<div class="nb-writer">${nbFace({ url: w.host, title: w.host }, 'nb-av sm')}
      <span class="nb-w-who"><button class="linkish nb-w-host" data-talk="open" data-url="${esc(w.url)}">${esc(w.host)}</button><small>${w.by.size < 2 ? `Linked ${w.links === 1 ? 'once' : `${w.links} times`} by ${by}` : `Linked by ${by}`}</small><small class="nb-w-path">${esc(path.length > 60 ? path.slice(0, 58) + '…' : path)}</small></span>
      ${SOC.added?.has(w.host) ? `<button class="fbtn done-open" data-view="${SOC.added.get(w.host)}">✓ Following · Open</button>`
        : `<span class="nb-w-acts"><button class="fbtn p" data-talk="site" data-url="${esc('https://' + w.host + '/')}">Follow</button>${xBtn('w', w.host, `Don’t suggest ${w.host}`)}</span>`}${SOC.blogErr?.has(w.host) ? `<small class="fol-err">${esc(SOC.blogErr.get(w.host))}</small>` : ''}</div>`;
  }
  // The top of the root post a reply chain goes back to (a reply to a reply goes back to the first post)
  function nbRoot(i, x) { let r = i, k = 0; while (x.replyTo.has(r.id) && k++ < 4) r = x.replyTo.get(r.id); return r; }
  // ---- Close friends: a few people pinned to the top of the Neighborhood, with an alert when they post.
  // Kept by their blog's feed address (synced; feed ids differ between devices).
  const friendKey = f => (feedById(personId(f.id)) || f).url;
  const isFriend = f => !!f && (S.prefs.friends || []).includes(friendKey(f));
  const friendIds = () => new Set(S.feeds.filter(isFriend).map(f => (feedById(personId(f.id)) || f).id));
  function setFriend(f, on) {
    const k = friendKey(f), list = S.prefs.friends || [];
    S.prefs.friends = on ? [...new Set([...list, k])] : list.filter(x => x !== k);
    savePrefs(); PV++; renderList();
    status(on ? `${f.title} is a close friend. Their new posts sit at the top of the Neighborhood${S.prefs.friendAlerts === false ? '' : ', and you get an alert when they post'}.` : `${f.title} is no longer pinned.`);
  }
  // ---- Reply drafts: what you've started writing stays (per post, on this device) until you send or cancel it
  const DRAFTS = (() => { try { return JSON.parse(localStorage.getItem('replyDrafts') || '{}'); } catch { return {}; } })();
  function setDraft(key, text) {
    if (text && text.trim()) DRAFTS[key] = { text, at: Date.now() }; else delete DRAFTS[key];
    for (const [k, v] of Object.entries(DRAFTS)) if (Date.now() - v.at > 30 * DAY) delete DRAFTS[k];
    try { localStorage.setItem('replyDrafts', JSON.stringify(DRAFTS)); } catch {}
  }
  const hasDraft = key => !!DRAFTS[key];
  const replyLbl = id => hasDraft('nb:' + id) ? 'Reply <span class="nb-draft">· draft</span>' : 'Reply';

  // ---- Mentions: type @ and a name in a reply from your site. The name becomes a link to their site, so the
  // Webmention plugin tells them they were mentioned.
  function mentionPicker(ta) {
    const pop = document.createElement('div'); pop.className = 'mn-pop'; pop.hidden = true; ta.after(pop);
    let hits = [], sel = 0, at = -1;
    const people = () => S.feeds.filter(f => kindOf(f) === 'person' && !isEmailFeed(f) && !isSocialFeed(f) && !isOwn(f.id) && personId(f.id) === f.id);
    const close = () => { pop.hidden = true; hits = []; at = -1; };
    const paint = () => {
      pop.innerHTML = hits.map((f, k) => `<button type="button" class="mn-row${k === sel ? ' on' : ''}" data-k="${k}">${nbFace(f, 'nb-av sm')}<span><b>${esc(f.title)}</b><small>${esc(hostOfU(isWeb(f.site) ? f.site : f.url))}</small></span></button>`).join('');
      pop.hidden = !hits.length;
    };
    const pick = f => {
      const name = f.title.replace(/[\[\]]/g, '');
      const v = ta.value, end = ta.selectionStart;
      ta.value = v.slice(0, at) + '@' + name + ' ' + v.slice(end);
      const pos = at + name.length + 2; ta.setSelectionRange(pos, pos); ta.focus();
      (ta._mentions = ta._mentions || new Map()).set(name, isWeb(f.site) ? f.site : 'https://' + bareHost(hostOfU(f.url)) + '/');
      close(); ta.dispatchEvent(new Event('input'));
    };
    ta.addEventListener('input', () => {
      const v = ta.value.slice(0, ta.selectionStart), m = /(^|\s)@([^\s@]{0,30})$/.exec(v);
      if (!m) { close(); return; }
      at = v.length - m[2].length - 1;
      const q = m[2].toLowerCase();
      hits = people().filter(f => !q || f.title.toLowerCase().split(/\s+/).some(w => w.startsWith(q)) || f.title.toLowerCase().startsWith(q) || hostOfU(f.site || f.url).startsWith(q)).slice(0, 6);
      sel = 0; paint();
    });
    ta.addEventListener('keydown', e => {
      if (pop.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; paint(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(hits[sel]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    pop.addEventListener('mousedown', e => { const r = e.target.closest('[data-k]'); if (r) { e.preventDefault(); pick(hits[Number(r.dataset.k)]); } });
    ta.addEventListener('blur', () => setTimeout(close, 150));
  }
  // Before posting: each @Name you picked becomes [Name](their site)
  // (also after a draft comes back: any @Name of someone you read, longest names first)
  function withMentions(ta) {
    let t = ta.value;
    const known = new Map(ta._mentions || []);
    for (const f of S.feeds.filter(f => kindOf(f) === 'person' && !isEmailFeed(f) && !isSocialFeed(f) && !isOwn(f.id))) {
      const name = f.title.replace(/[\[\]]/g, '');
      if (!known.has(name)) known.set(name, isWeb(f.site) ? f.site : 'https://' + bareHost(hostOfU(f.url)) + '/');
    }
    for (const [name, url] of [...known].sort((x, y) => y[0].length - x[0].length)) t = t.split('@' + name).join(`[${name}](${url})`);
    return t;
  }

  // ---- Your conversations: the replies you've posted from your site, and whether they answered. Kept in prefs
  // (synced): the post you answered, your reply's address. An answer is a newer post of theirs that links to your
  // reply (or, failing that, to your site after you replied).
  const myReplies = () => S.prefs.myReplies || [];
  function rememberReply(it, url) {
    const f = nbWho(it);
    const r = { to: it.link, title: headline(it), who: f ? friendKey(f) : '', name: f?.title || srcLabel(it) || '', url, at: new Date().toISOString() };
    S.prefs.myReplies = [r, ...myReplies().filter(x => x.url !== url)].slice(0, 150); savePrefs();
  }
  function answersTo(r) {
    const mine = ownIds(), myHost = bareHost(hostOfU(SOC.accounts.wordpress?.site || myFeed()?.site || ''));
    const theirs = S.feeds.filter(f => friendKey(f) === r.who || (r.who && f.url === r.who)).map(f => f.id);
    const ids = new Set(S.feeds.filter(f => theirs.includes(f.id) || theirs.includes(personId(f.id))).map(f => f.id));
    const u = normU(r.url);
    return S.items.filter(i => !mine.has(i.feed_id) && Date.parse(i.date) > Date.parse(r.at) - 60e3 && (
      (i.links || '').split(' ').some(l => normU(l) === u) ||
      (ids.has(i.feed_id) && myHost && (i.links || '').split(' ').some(l => bareHost(hostOfU(l)) === myHost))))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  // Which of your replies a post answers (built once per redraw)
  let ansIdx = { k: -1, m: new Map() };
  function answerOf(i) {
    const k = PV + ':' + S.items.length + ':' + myReplies().length;
    if (ansIdx.k !== k) { const m = new Map(); for (const r of myReplies()) for (const a of answersTo(r)) if (!m.has(a.id)) m.set(a.id, r); ansIdx = { k, m }; }
    return ansIdx.m.get(i.id);
  }
  const newAnswers = () => myReplies().reduce((n, r) => n + answersTo(r).filter(i => !i.read).length, 0);
  function myRepliesHtml() {
    const list = myReplies();
    if (!list.length) return `<p class="note">Replies you post from your site show up here, with a note when the other person writes back on their blog.</p>`;
    return list.slice(0, SOC.myRepShown || 20).map(r => {
      const ans = answersTo(r);
      return `<article class="yu-ev mr${ans.some(i => !i.read) ? ' new' : ''}">
        <div class="nb-main"><div class="nb-by"><b>You</b><span>replied to ${esc(r.name || hostOfU(r.to))}</span><time>${esc(fmtWhen(r.at))}</time></div>
        <button class="linkish mr-to" data-talk="open" data-url="${esc(r.to)}">${esc(r.title || r.to)}</button>
        ${ans.length ? ans.map(i => `<button class="mr-ans" data-open="${esc(i.id)}">${nbFace(nbWho(i), 'nb-av sm')}<span><b>${nbName(i)} answered</b> ${esc(headline(i))} <time>${esc(fmtWhen(i.date))}</time></span></button>`).join('')
          : '<p class="mr-wait">No answer yet</p>'}
        <div class="nb-acts"><button class="linkish" data-talk="open" data-url="${esc(r.url)}">Your reply</button></div></div></article>`;
    }).join('') + (list.length > (SOC.myRepShown || 20) ? `<button class="btn nb-more" data-talk="myrepmore">Show more</button>` : '');
  }

  // ---- Unread in the Neighborhood (for the count on Conversations) and Mark all as read
  function nbUnread() {
    const since = Date.now() - NB_DAYS * DAY;
    const hid = nbSocial().hidden;
    return S.items.filter(i => !i.read && Date.parse(i.date) > since && inScope(i, 'people') && !isOwn(i.feed_id) && !isMuted(i) && !isFolded(i, 'people') && !topicMuted(i) && !hid.has('i:' + i.id));
  }

  // ---- Groups: your own circles of people (Photographers, Tech…), as chips in the Neighborhood. Kept like close
  // friends, by each person's blog feed address (synced).
  const groupsOf = () => S.prefs.groups || [];
  const inGroup = (g, f) => !!f && (g.people || []).includes(friendKey(f));
  const groupIds = g => new Set(S.feeds.filter(f => inGroup(g, f)).map(f => (feedById(personId(f.id)) || f).id));
  function saveGroups(list) { S.prefs.groups = list; savePrefs(); PV++; }
  function groupMenu(f) {
    const paint = () => {
      const el = sheet('groupPanel', `<h2>Groups for ${esc(f.title)}</h2>
        <p>Read one circle of people at a time. Groups show up as chips at the top of the Neighborhood.</p>
        <div class="gp-list">${groupsOf().map(g => `<label class="gp-row"><input type="checkbox" data-g="${esc(g.id)}"${inGroup(g, f) ? ' checked' : ''}><span>${esc(g.name)}</span><small>${groupIds(g).size} ${groupIds(g).size === 1 ? 'person' : 'people'}</small></label>`).join('') || '<p class="note">No groups yet. Make your first one below.</p>'}</div>
        <form class="gp-new"><input id="gpName" maxlength="30" placeholder="New group, like Photographers" autocomplete="off"><button class="btn" type="submit">Add</button></form>
        <div class="row sheet-foot"><button class="btn primary" type="button" id="gpDone">Done</button></div>`, `Groups for ${f.title}`);
      el.querySelectorAll('[data-g]').forEach(c => c.onchange = () => {
        const k = friendKey(f);
        saveGroups(groupsOf().map(g => g.id !== c.dataset.g ? g : { ...g, people: c.checked ? [...new Set([...(g.people || []), k])] : (g.people || []).filter(x => x !== k) }));
        renderList(); paint();
      });
      el.querySelector('.gp-new').onsubmit = e => {
        e.preventDefault(); const name = $('gpName').value.trim(); if (!name) return;
        if (groupsOf().some(g => g.name.toLowerCase() === name.toLowerCase())) { status(`There’s already a group called ${name}.`); return; }
        saveGroups([...groupsOf(), { id: 'g' + Date.now().toString(36), name, people: [friendKey(f)] }]);
        renderList(); paint(); status(`${f.title} is in ${name}.`);
      };
      $('gpDone').onclick = () => { el.hidden = true; };
    };
    paint();
  }
  function groupEdit(g) {
    const el = sheet('groupPanel', `<h2>${esc(g.name)}</h2>
      <form class="gp-new" id="gpRename"><input id="gpName" maxlength="30" value="${esc(g.name)}" autocomplete="off"><button class="btn" type="submit">Rename</button></form>
      <p>${groupIds(g).size} ${groupIds(g).size === 1 ? 'person' : 'people'}. Add or take people out from their page (tap a face, then Groups).</p>
      <div class="row sheet-foot"><button class="btn danger" type="button" id="gpDel">Delete group</button><button class="btn primary" type="button" id="gpDone">Done</button></div>`, g.name);
    $('gpRename').onsubmit = e => { e.preventDefault(); const name = $('gpName').value.trim(); if (!name) return; saveGroups(groupsOf().map(x => x.id === g.id ? { ...x, name } : x)); el.hidden = true; renderList(); };
    $('gpDel').onclick = () => { saveGroups(groupsOf().filter(x => x.id !== g.id)); if (SOC.nbGroup === g.id) SOC.nbGroup = ''; el.hidden = true; renderList(); status(`${g.name} is gone. The people in it are still in your feeds.`); };
    $('gpDone').onclick = () => { el.hidden = true; };
  }

  // ---- Topics: the categories writers give their own posts. Tap one to read everyone on it; mute the ones you don't want.
  const tagsOf = i => (i && i.tags ? i.tags.split('\t').filter(Boolean) : []);
  const mutedTopics = () => new Set((S.prefs.mutedTopics || []).map(t => t.toLowerCase()));
  const topicMuted = i => { const m = mutedTopics(); return m.size > 0 && tagsOf(i).some(t => m.has(t.toLowerCase())); };
  const hasTopic = (i, t) => tagsOf(i).some(x => x.toLowerCase() === t);
  function topicsHtml(i) {
    const tags = tagsOf(i).slice(0, 3); if (!tags.length) return '';
    return `<div class="nb-topics">${tags.map(t => `<button class="nb-topic" data-talk="topic" data-t="${esc(t.toLowerCase())}" title="Everyone’s posts about ${esc(t)}">#${esc(t)}</button>`).join('')}</div>`;
  }
  // The topics of the last two weeks, by how many people wrote about them
  function topicCloud(posts) {
    const by = new Map();
    for (const i of posts) for (const t of tagsOf(i)) {
      const k = t.toLowerCase(), e = by.get(k) || { k, label: t, posts: 0, people: new Set() };
      e.posts++; e.people.add(nbWho(i)?.id); by.set(k, e);
    }
    return [...by.values()].sort((a, b) => b.people.size - a.people.size || b.posts - a.posts);
  }
  function setTopicMute(t, on) {
    const list = (S.prefs.mutedTopics || []).filter(x => x.toLowerCase() !== t);
    S.prefs.mutedTopics = on ? [...list, t] : list; savePrefs(); PV++;
    if (on && SOC.nbTopic === t) SOC.nbTopic = '';
    renderList(); status(on ? `Posts about #${t} are hidden from the Neighborhood.` : `#${t} is back.`);
  }

  // ---- Comments on someone's post, read from their site (WordPress's own API, or the post's comments feed)
  const CM = new Map();
  function cmtsHtml(i) {
    if (SOC.cmOpen !== i.id) return '';
    const r = CM.get(i.link), page = (i.link || '').replace(/#.*$/, '') + '#respond';
    if (!r) return `<div class="nb-cmts"><p class="note">Reading the comments…</p></div>`;
    if (r.err || !r.found) return `<div class="nb-cmts"><p class="note">${r.err ? esc(r.err) : 'Their site doesn’t share its comments with apps.'} <button class="linkish" data-talk="open" data-url="${esc(page.replace('#respond', '#comments'))}">Read them on their site</button></p></div>`;
    const kids = new Map(), top = [];
    for (const c of r.comments) { if (c.parent && r.comments.some(x => x.id === c.parent)) { if (!kids.has(c.parent)) kids.set(c.parent, []); kids.get(c.parent).push(c); } else top.push(c); }
    const one = (c, deep) => {
      const face = isWeb(c.avatar) ? `<span class="nb-av sm"><img class="nb-face-img" src="${esc(c.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">${esc((c.name || '?')[0].toUpperCase())}</span>`
        : `<span class="nb-av sm" style="--h:${hueFor(c.name || '?')}">${esc((c.name || '?')[0].toUpperCase())}</span>`;
      const t = c.text.length > 700 ? c.text.slice(0, 680).replace(/\s+\S*$/, '') + '…' : c.text;
      return `<div class="nb-cmt${deep ? ' deep' : ''}">${face}<div><div class="nb-cmt-by">${isWeb(c.url) ? `<button class="linkish" data-talk="open" data-url="${esc(c.url)}">${esc(c.name || 'Someone')}</button>` : `<b>${esc(c.name || 'Someone')}</b>`}<time>${esc(c.date ? fmtWhen(c.date) : '')}</time></div><p>${esc(t)}</p></div></div>`
        + (deep < 3 ? (kids.get(c.id) || []).map(k => one(k, deep + 1)).join('') : '');
    };
    return `<div class="nb-cmts">${r.comments.length ? top.map(c => one(c, 0)).join('') : '<p class="note">No comments yet.</p>'}
      <p class="nb-cmt-foot"><button class="linkish" data-talk="open" data-url="${esc(r.page || page)}">Join in on their site</button></p></div>`;
  }
  function toggleComments(it) {
    if (SOC.cmOpen === it.id) { SOC.cmOpen = null; renderList(); paintReaderTalk(); return; }
    SOC.cmOpen = it.id; renderList(); paintReaderTalk();
    const c = CM.get(it.link);
    if (c && !c.err && Date.now() - c.at < 10 * 60e3) return;
    invoke('post_comments', { url: it.link }).then(r => CM.set(it.link, { ...r, at: Date.now() })).catch(e => CM.set(it.link, { err: msg(e), at: Date.now() }))
      .finally(() => { if (S.view === 'talk') renderList(); paintReaderTalk(); });
  }

  // ---- Repost: put someone's post on your own site as a short "reposted" note with its picture card. Their site is
  // told (the Webmention plugin sends it), so it can show the repost. Kept by the post's address (synced).
  const repostOf = it => (S.prefs.reposts || {})[normU(it.link)];
  const repostBtn = it => !SOC.accounts.wordpress || !isWeb(it.link) ? '' : repostOf(it)
    ? `<button class="linkish nb-rp on" data-talk="open" data-url="${esc(repostOf(it).url)}" title="See your repost">Reposted ✓</button>`
    : `<button class="linkish nb-rp" data-talk="repost" data-id="${esc(it.id)}">Repost</button>`;
  function openRepost(it) {
    const f = nbWho(it), host = SOC.accounts.wordpress.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const el = sheet('repostPanel', `<h2>Repost to ${esc(host)}</h2>
      <div class="rp-card">${isWeb(it.image) ? `<img src="${esc(it.image)}" alt="" referrerpolicy="no-referrer">` : ''}<span><small>↻ Reposted</small><b>${esc(headline(it))}</b><small>${esc(f?.title || hostOfU(it.link))}</small></span></div>
      <textarea id="rpText" rows="3" placeholder="Add a few words (optional)"></textarea>
      <p class="note">It goes on your site as a note with this card, in Notes. ${esc(f?.title || 'Their site')} is told, and sites that show reposts will list yours.</p>
      <div class="row sheet-foot"><button class="btn" type="button" id="rpNo">Cancel</button><button class="btn primary" type="button" id="rpYes">Repost</button></div>`, 'Repost');
    $('rpText').focus();
    $('rpNo').onclick = () => { el.hidden = true; };
    $('rpYes').onclick = async () => {
      const btn = $('rpYes'); btn.disabled = true; btn.textContent = 'Reposting…';
      try {
        const r = await invoke('site_note', { title: '', text: $('rpText').value.trim(), link: it.link, linkTitle: headline(it), photo: '', alt: '', draft: false, linkImage: isWeb(it.image) ? it.image : '', linkSite: f?.title || srcLabel(it) || '', repost: true });
        S.prefs.reposts = { ...(S.prefs.reposts || {}), [normU(it.link)]: { url: r.url, at: new Date().toISOString() } }; savePrefs();
        el.hidden = true; renderList(); paintReaderTalk();
        status(`Reposted on ${host}. ${f?.title || 'Their site'} is told if it listens for that.`);
      } catch (e) { btn.disabled = false; btn.textContent = 'Repost'; status(msg(e), true); }
    };
  }

  // ---- Follow many at once (bring your people over, a whole blogroll): a few at a time, people marked as people
  async function followMany(urls, btn, asPeople) {
    const todo = [...new Set(urls)]; let done = 0, ok = 0; const failed = [], ids = [];
    const label = btn?.textContent;
    const one = async u => {
      try {
        const r = await invoke('add_feed', { url: u, title: null, folderId: null });
        ok++; ids.push(r.id); (SOC.added = SOC.added || new Map()).set(bareHost(hostOfU(u)), r.id);
      } catch (e) { failed.push(hostOfU(u)); (SOC.blogErr = SOC.blogErr || new Map()).set(bareHost(hostOfU(u)), msg(e)); }
      done++; if (btn) btn.textContent = `Following ${done} of ${todo.length}…`;
    };
    if (btn) btn.disabled = true;
    const queue = [...todo];
    await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift()); }));
    if (btn) { btn.disabled = false; btn.textContent = label; }
    await load();
    // they're people: mark them so, so their posts gather in the Neighborhood
    if (asPeople && ids.length) { const k = { ...(S.prefs.kinds || {}) }; for (const id of ids) { const f = feedById(id); if (f) k[f.url] = 'person'; } S.prefs.kinds = k; savePrefs(); PV++; }
    renderList();
    status(`Following ${ok} new ${ok === 1 ? 'site' : 'sites'}.${failed.length ? ` ${failed.length} didn’t have a feed we could find (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}).` : ''}`);
  }

  // ---- Bring your people over: the people you follow on Mastodon and Bluesky who keep a blog you don't read here yet
  function bringList() {
    const have = new Set(S.feeds.flatMap(f => [hostOfU(f.site), hostOfU(f.url)].filter(Boolean).map(bareHost)));
    const hid = hiddenIn('b');
    return (SOC.theirBlogs || []).filter(b => { const k = bareHost(hostOfU(b.blog)); return !have.has(k) && !hid.has(k); });
  }
  const socFace = (p, cls = 'nb-av md') => isWeb(p.avatar) ? `<span class="${cls}"><img class="nb-face-img" src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">${esc((p.name || '?')[0].toUpperCase())}</span>`
    : `<span class="${cls}" style="--h:${hueFor(p.handle || p.name || '?')}">${esc((p.name || '?')[0].toUpperCase())}</span>`;
  function nbBringHtml() {
    if (!anySocial() || store.get('nbBrought') === '1') return '';
    const list = bringList(); if (!list.length) return '';
    const nets = [...new Set(list.map(b => NET[b.network]))].join(' and ');
    const open = SOC.bringOpen, shown = open ? list : [];
    return `<section class="nb-bring">
      <button class="nb-x" data-talk="nbbrought" aria-label="Close" title="Close">×</button>
      <div class="nb-stack">${list.slice(0, 7).map(b => socFace(b.person)).join('')}</div>
      <h3>Bring your people over</h3>
      <p>${list.length === 1 ? 'Someone you follow' : `${list.length} people you follow`} on ${esc(nets)} ${list.length === 1 ? 'keeps a blog' : 'keep blogs'} you don’t read here yet. Follow ${list.length === 1 ? 'it' : 'them'} and their posts join your Neighborhood.</p>
      <div class="row"><button class="btn primary" data-talk="bringall">Follow ${list.length === 1 ? 'it' : `all ${list.length}`}</button><button class="btn" data-talk="bringopen">${open ? 'Hide the list' : 'Choose'}</button></div>
      ${shown.length ? `<div class="nb-bring-list">${shown.map(b => { const k = bareHost(hostOfU(b.blog)); return `<div class="nb-writer">${socFace(b.person, 'nb-av sm')}<span class="nb-w-who"><button class="linkish nb-w-host" data-talk="open" data-url="${esc(b.blog)}">${esc(b.person.name || b.person.handle)}</button><small>${esc(hostOfU(b.blog))} · ${ICON_NET[b.network] || ''} ${esc(b.person.handle)}</small>${SOC.blogErr?.has(k) ? `<small class="fol-err">${esc(SOC.blogErr.get(k))}</small>` : ''}</span>
        <span class="nb-w-acts"><button class="fbtn p" data-talk="blog" data-url="${esc(b.blog)}">Follow</button>${xBtn('b', k, `Don’t suggest ${hostOfU(b.blog)}`)}</span></div>`; }).join('')}</div>` : ''}
    </section>`;
  }

  // ---- Their blogroll, read live from their site (once a day), with everyone on it
  const ROLLS = (() => { try { return JSON.parse(localStorage.getItem('rolls') || '{}'); } catch { return {}; } })();
  const rollBusy = new Set();
  function loadRoll(site) {
    const c = ROLLS[site]; if ((c && Date.now() - c.at < DAY) || rollBusy.has(site)) return c;
    rollBusy.add(site);
    invoke('person_blogroll', { site }).then(list => { ROLLS[site] = { at: Date.now(), list }; })
      .catch(() => { ROLLS[site] = { at: Date.now() - DAY + 3600e3, list: [], err: true }; })
      .finally(() => { rollBusy.delete(site); try { localStorage.setItem('rolls', JSON.stringify(ROLLS)); } catch {} if (SOC.person) renderList(); });
    return c;
  }
  function rollHtml(f) {
    const site = isWeb(f.site) ? f.site : 'https://' + bareHost(hostOfU(f.url)) + '/';
    const c = loadRoll(site);
    if (!c) return `<p class="note">Looking for their blogroll…</p>`;
    if (!c.list.length) return '';
    const followed = e => followsDomain(bareHost(hostOfU(e.url))) || SOC.added?.has(bareHost(hostOfU(e.url)));
    const not = c.list.filter(e => !followed(e)), have = c.list.length - not.length;
    const show = SOC.rollAll === f.id ? not : not.slice(0, 8);
    return `<p class="pp-sub">${c.list.length} ${c.list.length === 1 ? 'site' : 'sites'} ${esc(f.title)} recommends${have ? `. You follow ${have === c.list.length ? 'all of them' : have}` : ''}.</p>
      ${not.length > 1 ? `<button class="btn pp-rollall" data-talk="rollall" data-feed="${esc(f.id)}">Follow all ${not.length}</button>` : ''}
      ${show.map(e => { const h = bareHost(hostOfU(e.url)), err = SOC.blogErr?.get(h); return `<div class="nb-writer">${nbFace({ url: e.url, title: e.title || h }, 'nb-av sm')}<span class="nb-w-who"><button class="linkish nb-w-host" data-talk="open" data-url="${esc(e.url)}">${esc(e.title || h)}</button><small>${esc(h)}</small>${err ? `<small class="fol-err">${esc(err)}</small>` : ''}</span><span class="nb-w-acts"><button class="fbtn p" data-talk="site" data-url="${esc(e.feed || e.url)}">Follow</button></span></div>`; }).join('')}
      ${not.length > 8 ? `<button class="linkish more-r" data-talk="rollmore" data-feed="${esc(f.id)}">${SOC.rollAll === f.id ? 'Show fewer' : `Show all ${not.length}`}</button>` : ''}`;
  }
  const NB_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

  // ---- Liked by: writers who keep a Likes (or Bookmarks) page on their own site, read once every 12 hours.
  let TL = (() => { try { return JSON.parse(localStorage.getItem('theirLikes') || 'null'); } catch { return null; } })();
  let tlBusy = false, TLX = null;
  const peopleFeeds = () => S.feeds.filter(f => kindOf(f) === 'person' && !isEmailFeed(f) && !isSocialFeed(f));
  function loadTheirLikes(force) {
    if (tlBusy || (!force && TL && Date.now() - TL.at < 12 * 3600e3)) return;
    const sites = [...new Set(peopleFeeds().filter(f => !isOwn(f.id)).map(f => { try { return new URL(isWeb(f.site) ? f.site : f.url).origin + '/'; } catch { return ''; } }).filter(Boolean))];
    if (!sites.length) return;
    tlBusy = true;
    invoke('people_likes', { sites }).then(list => {
      TL = { at: Date.now(), list: list || [] }; store.set('theirLikes', JSON.stringify(TL)); PV++;
      if (S.view === 'talk') renderList(); paintReaderTalk();
    }).catch(() => {}).finally(() => { tlBusy = false; });
  }
  // normU(link) → the people you read who liked it, newest likers' pages first
  function likedByIndex() {
    if (TLX && TLX.tl === TL && TLX.feeds === S.feeds) return TLX;
    const byHost = new Map();
    for (const f of peopleFeeds()) { const h = bareHost(hostOfU(isWeb(f.site) ? f.site : f.url)); if (h && !byHost.has(h)) byHost.set(h, feedById(personId(f.id)) || f); }
    const map = new Map(), recent = [];
    for (const t of TL?.list || []) {
      const f = byHost.get(bareHost(hostOfU(t.site))); if (!f) continue;
      t.links.forEach((l, n) => {
        const k = normU(l);
        if (!map.has(k)) map.set(k, []);
        if (!map.get(k).includes(f)) map.get(k).push(f);
        if (n < 3) recent.push({ url: l, f });
      });
    }
    TLX = { tl: TL, feeds: S.feeds, map, recent };
    return TLX;
  }
  const likedBy = i => (isWeb(i?.link) ? likedByIndex().map.get(normU(i.link)) || [] : []).filter(f => f.id !== nbWho(i)?.id);
  function likedByHtml(i) {
    const fs = likedBy(i); if (!fs.length) return '';
    return `<div class="nb-shared nb-likedby">${HEART}<span>Liked by <button class="linkish" data-talk="nbwho" data-feed="${esc(fs[0].id)}">${esc(fs[0].title)}</button>${fs.length > 1 ? ` and ${fs.length - 1} other${fs.length > 2 ? 's' : ''} you read` : ''}</span></div>`;
  }
  // Posts the people you read liked lately that aren't in your feeds: a way to find new writers
  function likedElsewhereHtml() {
    const have = new Set(S.items.map(i => i.link && normU(i.link)).filter(Boolean)), seen = new Set(), mine = myDomain();
    const list = likedByIndex().recent.filter(r => {
      const k = normU(r.url), h = bareHost(hostOfU(r.url));
      if (have.has(k) || seen.has(k) || !h || nbBig(h) || h === mine || /\.(social|bsky)/.test(h)) return false;
      seen.add(k); return true;
    }).slice(0, 4);
    if (!list.length) return '';
    return `<aside class="nb-wbox"><h3>Liked by the people you read</h3><p>Posts from their Likes pages, from blogs you don’t follow yet.</p>${list.map(r => {
      const path = r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), h = bareHost(hostOfU(r.url));
      const by = (likedByIndex().map.get(normU(r.url)) || [r.f]).map(f => f.title);
      return `<div class="nb-writer">${nbFace(r.f, 'nb-av sm')}<span class="nb-w-who"><button class="linkish nb-w-host" data-talk="open" data-url="${esc(r.url)}">${esc(path.length > 60 ? path.slice(0, 58) + '…' : path)}</button><small>Liked by ${esc(by.length > 2 ? `${by[0]}, ${by[1]} and ${by.length - 2} more` : by.join(' and '))}</small></span>
        ${SOC.added?.has(h) ? `<button class="fbtn done-open" data-view="${SOC.added.get(h)}">✓ Following · Open</button>` : `<span class="nb-w-acts"><button class="fbtn p" data-talk="site" data-url="${esc('https://' + h + '/')}">Follow</button></span>`}</div>`;
    }).join('')}</aside>`;
  }

  // ---- Who has you on their blogroll (from Discover's last look at everyone's blogrolls)
  function needReport() { if (!D.report && !SOC.discLoading) { SOC.discLoading = true; invoke('discover_get').then(r => { D.report = r.report; PV++; if (S.view === 'talk') renderList(); }).catch(() => {}); } }
  const rollsYou = () => { const d = myDomain(); return new Set(((D.report?.listed || []).find(l => l.domain === d)?.by) || []); };
  const readsYou = f => !!f && !isOwn(f.id) && rollsYou().has(f.title);
  const READS_YOU = '<span class="nb-tag reads" title="You’re on their blogroll">Reads you</span>';

  // ---- Comment counts, when the post's feed gives one
  const commentsBtn = i => i.comments > 0 && isWeb(i.link) ? `<button class="linkish nb-count" data-talk="cmts" data-id="${esc(i.id)}" aria-expanded="${SOC.cmOpen === i.id}" title="Read the comments">${i.comments} ${i.comments === 1 ? 'comment' : 'comments'}</button>` : '';

  // ---- Quote reply: select words in a post, then Quote (or Reply) starts your reply with them
  let QUOTE = null;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection(), text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    const node = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
    let id = '';
    if (text.length >= 3 && node) id = node.closest?.('#rBody, #rTitle') ? S.readerId : node.closest?.('.nb-post[data-id]')?.dataset.id || '';
    const it = id && item(id);
    if (it && isWeb(it.link) && !isEmailItem(it) && !isOwn(it.feed_id)) QUOTE = { id, text: text.length > 600 ? text.slice(0, 590).replace(/\s+\S*$/, '') + '…' : text, at: Date.now() };
    else if (text.length < 3 && QUOTE && Date.now() - QUOTE.at > 1500) QUOTE = null;
    paintQuoteBtn();
  });
  function paintQuoteBtn() {
    let b = $('quoteBtn');
    if (!QUOTE) { if (b) b.hidden = true; return; }
    if (!b) { b = Object.assign(document.createElement('button'), { id: 'quoteBtn', className: 'quote-btn', type: 'button' }); b.innerHTML = `${NB_TALK}<span>Quote in a reply</span>`; document.body.appendChild(b);
      b.addEventListener('pointerdown', e => e.preventDefault()); // keep the selection
      b.addEventListener('click', () => { const q = QUOTE, it = q && item(q.id); if (!it) return; QUOTE = null; b.hidden = true; quoteReply(it, q.text); }); }
    b.hidden = false;
  }
  const quoted = text => text.split(/\n+/).map(l => '> ' + l).join('\n') + '\n\n';
  function quoteReply(it, text) {
    // the reply box under the post: in the reader's conversation section, or under its card
    if (S.readerId === it.id && $('rTalk')) {
      if ($('rTalk').hidden || !$('rTalk').querySelector(`.n-box[data-box="nb:${CSS.escape(it.id)}"]`)) { $('rTalk').hidden = false; $('rTalk').innerHTML = `<div class="nb-acts r-talk-acts"></div><div class="n-box" data-box="nb:${esc(it.id)}"></div>`; }
    }
    const q = quoted(text);
    nbReplyBox(null, it, { text: q, focus: true, at: q.length });
    document.querySelector(`.n-box[data-box="nb:${CSS.escape(it.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.getSelection()?.removeAllRanges();
  }

  // ---- Alerts: replies, comments and mentions coming your way, and new posts from close friends
  const ALERT_MAX = 600;
  function alertedSet() { try { const r = store.get('youAlerted'); return r ? new Set(JSON.parse(r)) : null; } catch { return null; } }
  function youAlerts() {
    if (S.prefs.youAlerts === false) return;
    const x = nbIndex(), ev = [];
    for (const n of SOC.conv?.replies || []) ev.push({ k: 'r:' + n.network + ':' + n.id, date: n.created_at, who: n.author?.name || n.author?.handle, what: 'replied to you', text: n.text });
    for (const n of SOC.mentions || []) ev.push({ k: 'm:' + n.network + ':' + n.id, date: n.created_at, who: n.author?.name || n.author?.handle, what: 'mentioned your blog', text: n.text });
    for (const c of SOC.comments?.comments || []) ev.push({ k: 'c:' + c.id + ':' + c.date, date: c.date, who: c.name || 'Someone', what: c.kind === 'comment' ? `commented on “${c.post_title || 'your post'}”` : c.kind === 'like' ? `liked “${c.post_title || 'your post'}”` : `mentioned “${c.post_title || 'your post'}”`, text: c.text });
    for (const i of S.items) if (x.toMe.has(i.id)) ev.push({ k: 'l:' + i.id, date: i.date, who: nbWho(i)?.title || hostOfU(i.link), what: 'linked to you', text: headline(i) });
    const had = alertedSet() || new Set();
    const save = () => store.set('youAlerted', JSON.stringify([...had].slice(-ALERT_MAX)));
    // The first time each kind has loaded, just remember what's there: no burst of old news
    let seeded; try { seeded = new Set(JSON.parse(store.get('youSeeded') || '[]')); } catch { seeded = new Set(); }
    const loaded = { r: !!SOC.conv, m: !!SOC.mentions, c: !!SOC.comments, l: true };
    let changed = false;
    for (const k of Object.keys(loaded)) if (loaded[k] && !seeded.has(k)) { ev.filter(e => e.k[0] === k).forEach(e => had.add(e.k)); seeded.add(k); changed = true; }
    if (changed) { store.set('youSeeded', JSON.stringify([...seeded])); save(); }
    const fresh = ev.filter(e => !had.has(e.k) && Date.now() - Date.parse(e.date) < 3 * DAY);
    if (!fresh.length) return;
    fresh.forEach(e => had.add(e.k)); save();
    fresh.sort((a, b) => b.date.localeCompare(a.date));
    const one = fresh[0];
    const title = fresh.length === 1 ? `${one.who} ${one.what}` : `${fresh.length} new replies, comments and mentions`;
    const body = fresh.length === 1 ? clipT(one.text || '', 160) : [...new Set(fresh.map(e => e.who))].slice(0, 4).join(', ');
    invoke('notify', { title, body, id: 'you-' + one.k }).catch(() => {});
  }
  function friendAlerts(fresh) {
    if (S.prefs.friendAlerts === false || !(S.prefs.friends || []).length) return;
    const ids = friendIds(), by = new Map();
    for (const i of fresh) {
      const f = nbWho(i);
      if (!f || !ids.has(f.id) || i.read || isEmailItem(i) || Date.now() - Date.parse(i.date) > 2 * DAY) continue;
      by.set(f.id, [...(by.get(f.id) || []), i]);
    }
    for (const list of by.values()) {
      const f = nbWho(list[0]);
      invoke('notify', { title: list.length === 1 ? `${f.title} posted` : `${f.title} posted ${list.length} times`, body: list.slice(0, 3).map(headline).join(' · '), id: 'friend-' + list[0].id }).catch(() => {});
    }
  }
  const clipT = (s, n) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; };
  const alertsBtn = (k, on, label) => `<button class="nb-alerts${on ? ' on' : ''}" data-talk="alerts" data-k="${k}" aria-pressed="${on}" title="${on ? 'Turn these alerts off' : 'Turn these alerts on'}">${label}: ${on ? 'on' : 'off'}</button>`;
  function neighborhoodHtml() {
    const people = S.feeds.filter(f => kindOf(f) === 'person' && !isEmailFeed(f) && !isSocialFeed(f) && !isOwn(f.id));
    // nobody yet: the suggestions are the page; a few people: suggestions after their first posts
    const intro = nbWelcomeHtml() + (!people.length ? nbStartersHtml(0) : '');
    const more = people.length && people.length < 5 ? nbStartersHtml(people.length) : '';
    if (!people.length) return intro || `<div class="empty"><strong>No one here yet</strong><span>Follow a few people who write, and their posts gather here with the conversations between them.</span><button class="btn primary" data-view="discover">Find writers in Discover</button></div>`;
    const x = nbIndex(), soc = nbSocial(), since = Date.now() - NB_DAYS * DAY, mine = myFeed();
    loadTheirLikes(); needReport();
    // Blog posts (yours too) and their short posts on Mastodon and Bluesky
    const posts = S.items.filter(i => inScope(i, 'people') && !isMuted(i) && !isFolded(i, 'people') && !topicMuted(i) && Date.parse(i.date) > since && !soc.hidden.has('i:' + i.id));
    if (mine && !isPerson(mine.id)) posts.push(...S.items.filter(i => i.feed_id === mine.id && Date.parse(i.date) > since));
    // Replies gather under the post they answer, as one thread, placed where its newest reply falls
    const threads = new Map(), inThread = new Set();
    for (const i of posts) {
      if (!x.replyTo.has(i.id)) continue;
      const root = nbRoot(i, x);
      if (!threads.has(root.id)) threads.set(root.id, { root, replies: [] });
      threads.get(root.id).replies.push(i); inThread.add(i.id); inThread.add(root.id);
    }
    let all = [
      ...posts.filter(i => !inThread.has(i.id)).map(i => ({ i, date: i.date, who: [nbWho(i)?.id] })),
      ...[...threads.values()].map(t => { t.replies.sort((a, b) => a.date.localeCompare(b.date)); return { t, date: t.replies[t.replies.length - 1].date, who: [t.root, ...t.replies].map(i => nbWho(i)?.id) }; }),
      ...soc.notes.map(s => ({ s, date: s.n.created_at, who: [s.f.id] })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const talky = e => e.t || (e.i && (x.answers.has(e.i.id) || x.toMe.has(e.i.id) || x.mentions.has(e.i.id) || soc.shares.has(e.i.id)));
    const who = SOC.nbWho && feedById(SOC.nbWho);
    let list = who ? all.filter(e => e.who.includes(who.id)) : all;
    // A group of yours, or one topic
    const grp = SOC.nbGroup && groupsOf().find(g => g.id === SOC.nbGroup);
    if (grp) { const ids = groupIds(grp); list = list.filter(e => e.who.some(id => ids.has(id))); }
    const topic = SOC.nbTopic || '';
    const itemsOf = e => e.t ? [e.t.root, ...e.t.replies] : e.i ? [e.i] : [];
    if (topic) list = list.filter(e => itemsOf(e).some(i => hasTopic(i, topic)));
    if (SOC.nbOnly === 'talk') list = list.filter(talky);
    if (SOC.nbOnly === 'short') list = list.filter(e => e.s || (e.i && isShort(e.i)));
    const picOf = e => (e.s ? e.s.n.image : e.i ? e.i.image : e.t ? e.t.root.image : '') || '';
    if (SOC.nbOnly === 'photos') list = list.filter(e => isWeb(picOf(e)));
    if (SOC.nbOnly === 'long') list = list.filter(e => (e.i && !isShort(e.i)) || (e.t && !isShort(e.t.root)));
    // One from each: just the newest from each person, so one busy writer doesn't fill the page
    if (SOC.nbOnly === 'each') { const had = new Set(); list = list.filter(e => { const k = e.s ? e.s.f.id : e.t ? nbWho(e.t.replies[e.t.replies.length - 1])?.id : nbWho(e.i)?.id; if (!k || had.has(k)) return false; had.add(k); return true; }); }
    // Close friends: their newest posts (unread, or from the last two days) sit at the top
    const fids = friendIds();
    const pinned = !who && !SOC.nbOnly && !grp && !topic && fids.size ? list.filter(e => e.who.some(id => fids.has(id)) && (Date.now() - Date.parse(e.date) < 2 * DAY || (e.i && !e.i.read) || (e.t && e.t.replies.some(r => !r.read)))).slice(0, 5) : [];
    if (pinned.length) list = list.filter(e => !pinned.includes(e));
    const shown = list.slice(0, SOC.nbShown || 30);
    // Where you left off
    if (SOC.nbVisit === undefined) { SOC.nbVisit = Number(store.get('nbSeen') || 0); store.set('nbSeen', String(Date.now())); }
    // Faces: who's posted in the last few days (not you)
    const faces = new Map();
    for (const e of all) {
      if (Date.now() - Date.parse(e.date) > 3 * DAY) continue;
      const items = e.t ? [e.t.root, ...e.t.replies] : e.i ? [e.i] : [];
      const fs = e.s ? [{ f: e.s.f, unread: true }] : items.filter(i => Date.now() - Date.parse(i.date) < 3 * DAY).map(i => ({ f: nbWho(i), unread: !i.read }));
      for (const { f, unread } of fs) if (f && !isOwn(f.id) && !faces.has(f.id)) faces.set(f.id, { f, unread });
    }
    const faceList = [...faces.values()].sort( // close friends first
      (a, b) => fids.has(b.f.id) - fids.has(a.f.id));
    const facesHtml = faces.size > 1 ? `<nav class="nb-faces" aria-label="Who posted lately">${faceList.slice(0, 16).map(({ f, unread }) =>
      `<button class="nb-face${unread ? ' new' : ''}" data-talk="nbwho" data-feed="${esc(f.id)}" aria-pressed="${who?.id === f.id}" title="${esc(f.title)}">${nbFace(f, 'nb-fav')}<b>${esc(f.title)}</b></button>`).join('')}</nav>` : '';
    const talks = all.filter(talky).length;
    const chips = `<div class="nb-seg" role="group" aria-label="Show">${[['', 'Everything'], ['talk', `Conversations${talks ? ` · ${talks}` : ''}`], ['short', 'Notes'], ['photos', 'Photos'], ['long', 'Long reads'], ['each', 'One from each'], ['topics', 'Topics']].map(([k, l]) => `<button data-talk="nbonly" data-k="${k}" aria-pressed="${(SOC.nbOnly || '') === k}">${l}</button>`).join('')}</div>`
      + (groupsOf().length ? `<span class="nb-break"></span><div class="nb-seg nb-groups" role="group" aria-label="Groups"><button data-talk="nbgroup" data-g="" aria-pressed="${!grp}">All people</button>${groupsOf().map(g => `<button data-talk="nbgroup" data-g="${esc(g.id)}" aria-pressed="${grp?.id === g.id}">${esc(g.name)}</button>`).join('')}</div>` : '');
    const opener = nbOpener(posts, soc, x, facesHtml, chips);
    const tlabel = topic && (topicCloud(posts).find(c => c.k === topic)?.label || topic);
    const bars = (grp ? `<div class="nb-bar"><span><b>${esc(grp.name)}</b> · ${groupIds(grp).size} ${groupIds(grp).size === 1 ? 'person' : 'people'}</span><button class="linkish" data-talk="grpedit" data-g="${esc(grp.id)}">Rename or delete</button><button class="nb-x sm" data-talk="nbgroup" data-g="" aria-label="Show everyone" title="Show everyone">×</button></div>` : '')
      + (topic ? `<div class="nb-bar"><span>Posts about <b>#${esc(tlabel)}</b></span><button class="linkish" data-talk="topicmute" data-t="${esc(topic)}">Mute this topic</button><button class="nb-x sm" data-talk="topic" data-t="" aria-label="All topics" title="All topics">×</button></div>` : '');
    if (SOC.nbOnly === 'topics' && !topic) {
      const cloud = topicCloud(list.flatMap(itemsOf)), muted = [...mutedTopics()];
      return intro + opener + `<section class="nb-tcloud"><h3 class="nb-sub">Topics of the last two weeks</h3>
        ${cloud.length ? `<div class="nb-topics big">${cloud.slice(0, 60).map(c => `<button class="nb-topic" data-talk="topic" data-t="${esc(c.k)}">#${esc(c.label)}<small>${c.people.size > 1 ? `${c.people.size} people` : `${c.posts} ${c.posts === 1 ? 'post' : 'posts'}`}</small></button>`).join('')}</div>`
          : '<p class="note">No topics yet. Many blogs tag their posts; those tags show up here after the next refresh.</p>'}
        ${muted.length ? `<h3 class="nb-sub">Muted topics</h3><div class="nb-topics">${muted.map(t => `<button class="nb-topic muted" data-talk="topicunmute" data-t="${esc(t)}" title="Show #${esc(t)} again">#${esc(t)} ×</button>`).join('')}</div>` : ''}</section>`;
    }
    const writers = nbWriters(3);
    let body = '', lined = false;
    const fresh = shown.filter(e => Date.parse(e.date) > SOC.nbVisit).length;
    const entryHtml = e => e.t ? `<section class="nb-thread">${nbCard(e.t.root, x, soc, 'root')}<div class="nb-replies">${e.t.replies.map(r => nbCard(r, x, soc, 'reply')).join('')}</div></section>`
      : e.i ? nbCard(e.i, x, soc) : nbNote(e.s);
    const friendsHtml = pinned.length ? `<section class="nb-friends"><h3 class="nb-sub">${NB_STAR}Close friends</h3>${pinned.map(entryHtml).join('')}</section>` : '';
    const elsewhere = who ? '' : likedElsewhereHtml();
    if (SOC.nbOnly === 'photos') {
      body = `<div class="nb-grid">${shown.map(e => {
        const it = e.i || e.t?.root, n = e.s?.n, f = it ? nbWho(it) : e.s.f, short = it && isShort(it);
        return `<button class="nb-tile" ${it ? `data-open="${esc(it.id)}"` : `data-talk="open" data-url="${esc(n.link || n.url)}"`}><img class="nb-tile-img" src="${esc(picOf(e))}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="nb-tile-by">${nbFace(f, 'nb-av sm')}<span><b>${esc(f?.title || '')}</b>${it && !short ? `<small>${esc(headline(it))}</small>` : ''}</span></span></button>`;
      }).join('')}</div>`;
    }
    (SOC.nbOnly === 'photos' ? [] : shown).forEach((e, k) => {
      if (!lined && SOC.nbVisit && fresh && fresh < shown.length && Date.parse(e.date) <= SOC.nbVisit) { body += `<div class="nb-seen"><span>Seen before</span></div>`; lined = true; }
      body += entryHtml(e);
      if (more && k === Math.min(2, shown.length - 1)) body += more;
      if (k === Math.min(4, shown.length - 1) && writers.length && !who) body += `<aside class="nb-wbox"><h3>Writers your writers link to</h3><p>Blogs the people you read keep linking to. Follow one to grow your neighborhood.</p>${writers.map(writerRow).join('')}</aside>`;
      if (k === Math.min(9, shown.length - 1) && elsewhere) body += elsewhere;
    });
    const unreadHere = list.flatMap(e => e.t ? [e.t.root, ...e.t.replies] : e.i ? [e.i] : []).filter(i => !i.read && !isOwn(i.feed_id));
    SOC.nbUnreadIds = unreadHere.map(i => i.id);
    const readAll = unreadHere.length > 1 ? `<button class="btn nb-readall" data-talk="nbreadall">Mark all ${unreadHere.length} as read</button>` : '';
    const end = readAll + (shown.length < list.length ? `<button class="btn nb-more" data-talk="nbmore">Show more</button>`
      : `<p class="nb-end">${list.length ? 'You’re caught up.' : SOC.nbOnly === 'talk' ? 'No conversations between blogs in the last two weeks yet.' : SOC.nbOnly === 'photos' ? 'No pictures in the last two weeks.' : 'Nothing here in the last two weeks.'}<small>${list.length ? `That’s everything ${who ? `from ${esc(who.title)} ` : ''}from the last two weeks.` : 'When one writer you read links to another’s post or blog, it shows up here.'}</small></p>`);
    return intro + nbBringHtml() + opener + bars + nbHintHtml() + friendsHtml + body + end;
  }
  // ---- Reactions from other sites: likes, replies and reposts a post has received through webmention.io
  // (sites that use it; the rest have none to show). Counts cached for six hours.
  const WM = (() => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem('wmc') || '{}'))); } catch { return new Map(); } })();
  let wmWant = new Set(), wmBusy = false, wmTimer = 0;
  function wmNeed(url) { const c = WM.get(url); if (!c || Date.now() - c.at > 6 * 3600e3) wmWant.add(url); return c; }
  function wmLater() {
    clearTimeout(wmTimer);
    wmTimer = setTimeout(async () => {
      if (wmBusy || !wmWant.size) return;
      wmBusy = true;
      const urls = [...wmWant].slice(0, 40); urls.forEach(u => wmWant.delete(u));
      try {
        const got = await invoke('wm_counts', { urls });
        let any = false;
        for (const c of got) { WM.set(c.url, { at: Date.now(), like: c.like, reply: c.reply, repost: c.repost, mention: c.mention }); any = any || c.like + c.reply + c.repost + c.mention > 0; }
        // keep the cache small: newest 600
        const keep = [...WM.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, 600);
        try { localStorage.setItem('wmc', JSON.stringify(Object.fromEntries(keep))); } catch {}
        if (any && S.view === 'talk') renderList();
        if (any) paintReaderTalk();
      } catch {} finally { wmBusy = false; if (wmWant.size) wmLater(); }
    }, 600);
  }
  function reactionsHtml(i) {
    if (!isWeb(i.link) || isEmailItem(i) || isSocialFeed(feedById(i.feed_id))) return '';
    const c = wmNeed(i.link); wmLater();
    if (!c || !(c.like + c.reply + c.repost + c.mention)) return '';
    const bits = [c.like && `${HEART}${c.like}`, c.reply && `${NB_TALK}${c.reply}`, c.repost && `${NB_SHARE}${c.repost}`, c.mention && `<span class="wm-m">@</span>${c.mention}`].filter(Boolean);
    const open = SOC.wmOpen === i.id, list = SOC.wmList?.get(i.link);
    return `<div class="nb-react"><button class="nb-react-b" data-talk="wmopen" data-id="${esc(i.id)}" aria-expanded="${open}" title="Reactions from other sites">${bits.join('<span class="sep"></span>')}</button>
      ${open ? (list === undefined ? '<p class="note">Looking at who reacted…</p>' : list.err ? `<p class="note err">${esc(list.err)}</p>` : wmListHtml(list)) : ''}</div>`;
  }
  function wmListHtml(list) {
    const likes = list.filter(r => r.kind === 'like' || r.kind === 'repost'), talk = list.filter(r => r.kind === 'reply' || r.kind === 'mention');
    const face = r => `<span class="nb-av sm" style="--h:${hueFor(r.name || r.url)}">${esc((r.name || '?')[0].toUpperCase())}${isWeb(r.photo) ? `<img class="nb-face-img" src="${esc(r.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
    return `<div class="wm-list">
      ${likes.length ? `<div class="wm-faces">${likes.slice(0, 16).map(r => `<button class="wm-face" data-talk="open" data-url="${esc(r.url)}" title="${esc(r.name || '')} ${r.kind === 'like' ? 'liked' : 'reposted'} it">${face(r)}</button>`).join('')}<span class="wm-who">${esc(likes.slice(0, 2).map(r => r.name).filter(Boolean).join(', '))}${likes.length > 2 ? ` and ${likes.length - 2} more` : ''}</span></div>` : ''}
      ${talk.slice(0, 6).map(r => `<button class="wm-r" data-talk="open" data-url="${esc(r.url)}">${face(r)}<span><b>${esc(r.name || hostOfU(r.url))}</b> ${r.kind === 'reply' ? 'replied' : 'mentioned it'}${r.date ? ` · ${esc(fmtWhen(r.date))}` : ''}${r.text ? `<small>${esc(r.text.length > 220 ? r.text.slice(0, 210) + '…' : r.text)}</small>` : ''}</span></button>`).join('')}
    </div>`;
  }

  // ---- Like: on a blog post, a like from your own site (your Likes page, then a Webmention to theirs);
  // on Mastodon or Bluesky, that network's own like. Both remembered (synced) so the heart stays filled.
  const HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-9-9a4.6 4.6 0 0 1 8-4.3L12 8l1-1.3A4.6 4.6 0 0 1 21 11c-2 4.6-9 9-9 9z"/></svg>';
  const likedAt = it => (S.prefs.likes || {})[normU(it.link)];
  const likeBtn = it => isWeb(it.link) && !isSocialFeed(feedById(it.feed_id))
    ? `<button class="linkish nb-like${likedAt(it) ? ' on' : ''}" data-talk="nblike" data-id="${esc(it.id)}" aria-pressed="${!!likedAt(it)}" title="${likedAt(it) ? 'Take back your like' : SOC.accounts.wordpress ? 'Like it from your site' : 'Like it'}">${HEART}${likedAt(it) ? 'Liked' : 'Like'}</button>` : '';
  const noteLiked = n => (S.prefs.socialLikes || {})[n.network + ':' + n.id];
  const noteLikeBtn = n => SOC.accounts[n.network] ? `<button class="linkish nb-like${noteLiked(n) ? ' on' : ''}" data-talk="notelike" data-net="${n.network}" data-id="${esc(n.id)}" data-cid="${esc(n.cid)}" aria-pressed="${!!noteLiked(n)}">${HEART}${noteLiked(n) ? (n.network === 'mastodon' ? 'Favorited' : 'Liked') : (n.network === 'mastodon' ? 'Favorite' : 'Like')}</button>` : '';
  async function likePost(b, it) {
    const on = !likedAt(it), f = nbWho(it), host = SOC.accounts.wordpress?.site?.replace(/^https?:\/\//, '') || 'your site';
    // Without a site connected, a like stays in the app (synced): a way to keep what you loved
    if (!SOC.accounts.wordpress) {
      const likes = { ...(S.prefs.likes || {}) }, key = normU(it.link);
      if (on) likes[key] = new Date().toISOString(); else delete likes[key];
      S.prefs.likes = likes; savePrefs(); renderList(); paintReaderTalk();
      if (on && !store.get('likeLocalTold')) { store.set('likeLocalTold', '1'); status('Liked. Only you see this one. Connect your site in Settings › Connections and your likes can tell the writer, too.'); }
      else status(on ? 'Liked.' : 'Like taken back.');
      return;
    }
    if (on && !store.get('likeExplained')) {
      const ok = await new Promise(done => {
        const el = sheet('likePanel', `<h2>Like it from your site</h2>
          <p>Your likes go on a <b>Likes</b> page on ${esc(host)}, made the first time you like something. Each one links to the post, and the post’s site is told, so if it shows likes, yours appears there.</p>
          <p class="note">Taking a like back removes it from your page and tells their site again.</p>
          <div class="row sheet-foot"><button class="btn" type="button" id="likeNo">Not now</button><button class="btn primary" type="button" id="likeYes">Like it</button></div>`, 'Like it from your site');
        $('likeNo').onclick = () => { el.hidden = true; done(false); };
        $('likeYes').onclick = () => { el.hidden = true; done(true); };
      });
      if (!ok) return;
      store.set('likeExplained', '1');
    }
    b.disabled = true;
    const key = normU(it.link), likes = { ...(S.prefs.likes || {}) };
    if (on) likes[key] = new Date().toISOString(); else delete likes[key];
    S.prefs.likes = likes; savePrefs(); renderList(); paintReaderTalk();
    try {
      const r = await invoke('site_like', { url: it.link, title: headline(it), author: f?.title || '', on });
      status(on ? (r.told ? `Liked. ${f?.title || 'Their site'} was told, and it’s on your Likes page.` : r.error ? `Liked on your Likes page, but telling their site didn’t work: ${r.error}` : `Liked on your Likes page. ${f?.title || 'Their site'} doesn’t listen for likes from other sites, so they won’t see it there.`)
        : 'Your like is taken back.');
    } catch (e) {
      const back = { ...(S.prefs.likes || {}) }; if (on) delete back[key]; else back[key] = new Date().toISOString();
      S.prefs.likes = back; savePrefs(); renderList(); paintReaderTalk(); status(msg(e), true);
    }
  }
  async function likeNote(b) {
    const k = b.dataset.net + ':' + b.dataset.id, was = (S.prefs.socialLikes || {})[k], on = !was;
    const set = v => { const m = { ...(S.prefs.socialLikes || {}) }; if (v) m[k] = v; else delete m[k]; S.prefs.socialLikes = m; savePrefs(); renderList(); };
    set(on ? 'pending' : '');
    try {
      const uri = await invoke('social_like', { network: b.dataset.net, id: b.dataset.id, cid: b.dataset.cid, on, likeUri: was && was !== 'pending' && was !== '1' ? was : null });
      set(on ? (uri || '1') : '');
    } catch (e) { set(was || ''); status(msg(e), true); }
  }
  // ---- Reply right in the card: post a reply on your own site (their site is told), or email them
  async function nbReplyBox(b, it, keep) {
    document.querySelectorAll('.n-box').forEach(x => { x.innerHTML = ''; });
    const sel = `.n-box[data-box="nb:${CSS.escape(it.id)}"]`;
    const box = b?.closest('.r-talk, .nb-main')?.querySelector(sel) || document.querySelector(sel); if (!box) return;
    const f = nbWho(it), wp = SOC.accounts.wordpress, host = wp?.site?.replace(/^https?:\/\//, '').replace(/\/$/, '');
    box.innerHTML = `<form class="nb-rbox"><textarea rows="3" placeholder="Write back to ${esc(f?.title || 'them')}…"></textarea>
      <div class="row">
        ${wp ? `<button class="btn primary" type="button" data-rb="site">Post on ${esc(host)}</button>` : ''}
        <span class="nb-rb-mail"></span>
        <button class="btn" type="button" data-rb="more" aria-haspopup="menu">More ways</button>
        <button class="btn ghost" type="button" data-rb="cancel">Cancel</button>
      </div>
      <p class="note">${wp ? `A reply on your site links to their post, and ${esc(f?.title || 'their site')} is told if their site listens for that.` : 'Connect your site to post replies there, or use More ways.'}</p></form>`;
    const ta = box.querySelector('textarea'), dkey = box.dataset.box;
    const draft = DRAFTS[dkey]?.text || '';
    if (keep) { ta.value = keep.text; if (keep.focus) { ta.focus(); ta.setSelectionRange(keep.at, keep.at); } }
    else { ta.value = draft; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    if (keep && draft && !keep.text.includes(draft.trim())) { ta.value = draft.trimEnd() + '\n\n' + keep.text; }
    ta.addEventListener('input', () => setDraft(dkey, ta.value));
    if (wp) mentionPicker(ta);
    // email, if they list an address and you have a mailbox here
    invoke('reply_options', { itemId: it.id }).then(o => {
      const addr = plainAddress(o?.email?.address || '');
      if (!addr || !MAIL.account || !box.isConnected) return;
      box.querySelector('.nb-rb-mail').innerHTML = `<button class="btn" type="button" data-rb="mail" data-to="${esc(addr)}">Email ${esc(f?.title?.split(' ')[0] || 'them')}</button>`;
    }).catch(() => {});
    box.querySelector('form').onclick = async e => {
      const k = e.target.closest('[data-rb]')?.dataset.rb; if (!k) return;
      const text = ta.value.trim();
      if (k === 'cancel') { setDraft(dkey, ''); box.innerHTML = ''; renderList(); paintReaderTalk(); return; }
      if (k === 'more') { openReply(e.target, it); return; }
      if (k === 'mail') { box.innerHTML = ''; openMailCompose({ to: e.target.dataset.to, toName: f?.title || '', subject: `Re: ${headline(it)}`, body: `${text}\n\n—\nIn reply to “${headline(it)}”\n${it.link}` }); return; }
      if (k === 'site') {
        if (!text) { ta.focus(); status('Write a few words first.'); return; }
        const btn = e.target; btn.disabled = true; btn.textContent = 'Posting…';
        try {
          const r = await invoke('site_note', { title: '', text: withMentions(ta), link: it.link, linkTitle: headline(it), photo: '', alt: '', draft: false, linkImage: isWeb(it.image) ? it.image : '', linkSite: f?.title || srcLabel(it) || '' });
          setDraft(dkey, ''); if (r.url) rememberReply(it, r.url);
          box.innerHTML = `<p class="nb-rb-done">Posted on ${esc(host)}. <button class="linkish" data-talk="open" data-url="${esc(r.url)}">See it</button></p>`;
          status(`Your reply is on ${host}. ${f?.title || 'Their site'} is told if their site listens for that.`);
        } catch (err) { btn.disabled = false; btn.textContent = `Post on ${host}`; status(msg(err), true); }
      }
    };
  }

  // ---- A page for each person: their posts and short posts, how you know them, who they talk with and read.
  function personHtml(f) {
    const x = nbIndex(), soc = nbSocial(), pid = f.id;
    const mineIds = new Set(S.feeds.filter(g => personId(g.id) === pid || g.id === pid).map(g => g.id));
    const theirs = S.items.filter(i => mineIds.has(i.feed_id) && !isEmailItem(i) && !isFolded(i, 'people') && !soc.hidden.has('i:' + i.id)).sort((a, b) => b.date.localeCompare(a.date));
    const notes = soc.notes.filter(s => s.f.id === pid);
    const host = bareHost(hostOfU(isWeb(f.site) ? f.site : f.url));
    const accts = (SOC.readers || []).filter(r => r.feedId === pid);
    const plinks = (PL[siteOf(f)]?.links || []).filter(l => !accts.some(r => NET[r.network] === l.label));
    // How often they post, and how much of it you've read
    const month = theirs.filter(i => Date.now() - Date.parse(i.date) < 30 * DAY).length;
    const read = theirs.filter(i => i.read).length;
    const pace = month >= 8 ? `About ${Math.round(month / 4.3)} posts a week` : month ? `${month} ${month === 1 ? 'post' : 'posts'} in the last month` : theirs.length ? `Last post ${fmtWhen(theirs[0].date)}` : 'No posts yet';
    // Who they talk with: replies and mentions both ways
    const talk = new Map();
    const bump = (other, n = 1) => { if (!other || other.id === pid) return; const t = talk.get(other.id) || { f: other, n: 0 }; t.n += n; talk.set(other.id, t); };
    for (const i of theirs) { const to = x.replyTo.get(i.id); if (to) bump(nbWho(to)); const m = x.mentions.get(i.id); if (m) bump(m.f); }
    for (const i of S.items) {
      if (mineIds.has(i.feed_id)) continue;
      const to = x.replyTo.get(i.id), m = x.mentions.get(i.id);
      if ((to && mineIds.has(to.feed_id)) || (m && m.f.id === pid)) bump(nbWho(i));
    }
    const talks = [...talk.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const toYou = theirs.filter(i => x.toMe.has(i.id));
    // Emails from them (their address on their own site's domain)
    const mails = S.items.filter(i => isEmailItem(i) && i.links.startsWith('mailto:') && bareHost(i.links.split('@')[1] || '') === host).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    // Blogs they link to that you don't follow, and their blogroll (from Discover's scan)
    const followed = new Set(S.feeds.flatMap(g => [hostOfU(g.site), hostOfU(g.url)].filter(Boolean).map(bareHost)));
    const out = new Map();
    for (const i of theirs) for (const l of (i.links || '').split(' ')) {
      const h = bareHost(hostOfU(l));
      if (!h || followed.has(h) || nbBig(h) || h === host || /\.(social|bsky)/.test(h)) continue;
      const w = out.get(h) || { host: h, by: new Set([pid]), links: 0, url: l, date: i.date }; w.links++; out.set(h, w);
    }
    const linksTo = [...out.values()].sort((a, b) => b.links - a.links).slice(0, 5);
    if (!D.report && !SOC.discLoading) { SOC.discLoading = true; invoke('discover_get').then(r => { D.report = r.report; if (SOC.person) renderList(); }).catch(() => {}); }
    const roll = (D.report?.suggestions || []).filter(s => s.rolls.includes(f.title)).slice(0, 6);
    const hasRoll = (D.report?.rolls_found || []).includes(f.title);
    const shownN = SOC.personShown || 15;
    const stream = [...theirs.map(i => ({ i, date: i.date })), ...notes.map(s => ({ s, date: s.n.created_at }))].sort((a, b) => b.date.localeCompare(a.date));
    const latest = theirs.find(i => !isSocialFeed(feedById(i.feed_id))) || theirs[0];
    const sec = (title, body) => body ? `<section class="pp-sec"><h3>${title}</h3>${body}</section>` : '';
    const isMine = isOwn(pid);
    return `<div class="pp">
      <button class="btn pp-back" data-talk="nbback" title="Back (Esc)">‹ Back to ${esc(backLabel())}</button>
      <header class="pp-head">${nbFace(f, 'nb-av xl')}
        <div class="pp-who"><h2>${esc(f.title)}</h2>
          <div class="pp-where"><button class="linkish" data-talk="open" data-url="${esc(isWeb(f.site) ? f.site : 'https://' + host + '/')}">${esc(host)}</button>${accts.map(r => `<button class="linkish" data-talk="open" data-url="${esc(r.person.url || r.url)}">${ICON_NET[r.network] || ''} ${esc(r.person.handle)}</button>`).join('')}${plinks.map(l => `<button class="linkish" data-talk="open" data-url="${esc(l.url)}">${esc(l.label)}</button>`).join('')}</div>
          <p class="pp-pace">${esc(pace)}${theirs.length ? ` · you’ve read ${read} of ${theirs.length}` : ''}${toYou.length ? ` · linked to you ${toYou.length === 1 ? 'once' : toYou.length + ' times'}` : ''}${readsYou(f) ? ' · you’re on their blogroll' : ''}</p>
        </div></header>
      <div class="pp-acts">
        ${latest && !isMine ? `<button class="btn primary" data-talk="nbreply" data-id="${esc(latest.id)}" aria-haspopup="menu">Write back</button>` : ''}
        <button class="btn" data-view="${f.id}">All their posts</button>
        ${isMine ? '' : `<button class="btn" data-talk="groups" data-feed="${esc(f.id)}" aria-haspopup="dialog">Groups${groupsOf().filter(g => inGroup(g, f)).length ? ` · ${groupsOf().filter(g => inGroup(g, f)).map(g => esc(g.name)).join(', ')}` : ''}</button>`}
        ${isMine ? '' : `<button class="btn pp-friend${isFriend(f) ? ' on' : ''}" data-talk="friend" data-feed="${esc(f.id)}" aria-pressed="${isFriend(f)}" title="${isFriend(f) ? 'Stop pinning their posts' : 'Pin their new posts to the top of the Neighborhood'}">${NB_STAR}Close friend</button>`}
        ${isMine ? '' : followButtons(f)}
      </div>
      ${isFriend(f) ? `<p class="pp-sub pp-friend-note">Their new posts sit at the top of the Neighborhood. ${alertsBtn('friend', S.prefs.friendAlerts !== false, 'Alerts when close friends post')}</p>` : ''}
      ${sec('Talks with', talks.length ? `<div class="pp-faces">${talks.map(t => `<button class="pp-face" data-talk="nbwho" data-feed="${esc(t.f.id)}">${nbFace(t.f, 'nb-av md')}<span><b>${esc(t.f.title)}</b><small>${t.n} ${t.n === 1 ? 'reply or mention' : 'replies and mentions'}</small></span></button>`).join('')}</div>` : '')}
      ${sec('Emails from them', mails.length ? mails.map(i => `<button class="nb-pair" data-open="${esc(i.id)}">${ICON_MAIL}<span><b>${esc(i.title)}</b><small>${esc(fmtWhen(i.date))}</small></span></button>`).join('') : '')}
      ${sec('Recent', stream.slice(0, shownN).map(e => e.i ? nbCard(e.i, x, soc) : nbNote(e.s)).join('') + (stream.length > shownN ? `<button class="btn nb-more" data-talk="ppmore">Show more</button>` : '') || '<p class="note">Nothing from them yet. New posts show up after the next refresh.</p>')}
      ${sec('They link to', linksTo.length ? `<p class="pp-sub">Blogs ${esc(f.title)} links to that you don’t follow yet.</p>${linksTo.map(writerRow).join('')}` : '')}
      ${sec('Their blogroll', rollHtml(f))}
    </div>`;
  }

  // ---- First run: what this page is, a few writers to start with, and what a connection would add
  // A few personal blogs to start a neighborhood (the same people the guide suggests)
  const NB_STARTERS = () => STARTERS.filter(([d]) => !/daviddaniels\.com/.test(d));
  function nbWelcomeHtml() {
    if (store.get('nbWelcomed') === '1') return '';
    return `<section class="nb-welcome">
      <button class="nb-x" data-talk="nbwelcomed" aria-label="Close" title="Close">×</button>
      <h3>Your neighborhood</h3>
      <p>These are the people you read, newest first. When one of them writes about another, it shows up here as a conversation.</p>
      <p>Reply by email or from your own site, like what you love, and tap a face to see everything from that person.</p>
      <button class="btn" data-talk="nbwelcomed">Got it</button>
    </section>`;
  }
  function nbStartersHtml(n) {
    const list = NB_STARTERS().filter(([d]) => !followsDomain(d));
    if (!list.length) return '';
    return `<section class="nb-starters">
      <h3>${n ? 'Add a few more people' : 'Start with a few people who write'}</h3>
      <p>${n ? 'The Neighborhood comes alive with five or more. Here are some to try:' : 'Follow two or three and their posts show up here. You can unfollow any time.'}</p>
      ${list.map(([d, name, about]) => `<div class="nb-starter"><span class="nb-av md" style="--h:${hueFor('https://' + d + '/')}">${esc(name[0])}</span>
        <span class="nb-st-who"><b>${esc(name)}</b><small>${esc(about)}</small></span>
        <button class="btn primary" data-guide-follow="${esc(d)}">Follow</button></div>`).join('')}
      <p class="nb-st-more"><button class="linkish" data-view="discover">Find more writers in Discover</button> · <button class="linkish" data-talk="open" data-url="https://readingroomapp.com/lists/">Written by People, a list to follow</button></p>
    </section>`;
  }
  // One quiet line on what a connection adds, until you connect or close it
  function nbHintHtml() {
    if (store.get('nbHinted') === '1') return '';
    const site = !!SOC.accounts.wordpress, social = anySocial();
    if (site && social) return '';
    const what = !site && !social ? 'Connect your site to like and reply from it, or Mastodon or Bluesky to see the short posts of the people you read.'
      : !site ? 'Connect your site to like and reply from it, so the writer hears about it.'
      : 'Connect Mastodon or Bluesky to see the short posts of the people you read there.';
    return `<p class="nb-hint"><span>${what} <button class="linkish" id="talkConnect">Connect</button></span><button class="nb-x sm" data-talk="nbhinted" aria-label="Don’t show this again" title="Don’t show this again">×</button></p>`;
  }

  // "Since you were here": what's new, in a sentence, before you scroll
  function nbOpener(posts, soc, x, facesHtml = '', chips = '') {
    const first = !SOC.nbVisit, cut = first ? Date.now() - 7 * DAY : SOC.nbVisit, mine = myFeed();
    const fresh = posts.filter(i => Date.parse(i.date) > cut && !isOwn(i.feed_id));
    const notes = soc.notes.filter(s => Date.parse(s.n.created_at) > cut);
    const ppl = new Map();
    for (const i of fresh) { const f = nbWho(i); if (f) ppl.set(f.id, f); }
    for (const s of notes) ppl.set(s.f.id, s.f);
    const n = fresh.length + notes.length;
    const events = [], answered = new Set();
    for (const r of myReplies()) for (const i of answersTo(r)) if (Date.parse(i.date) > cut && !answered.has(i.id)) { answered.add(i.id); events.push(`<button class="nb-ev mine" data-open="${esc(i.id)}"><b>${nbName(i)}</b> answered your reply</button>`); }
    for (const i of fresh) {
      const to = x.replyTo.get(i.id), m = x.mentions.get(i.id);
      if (answered.has(i.id)) continue;
      if (x.toMe.has(i.id)) events.push(`<button class="nb-ev" data-open="${esc(i.id)}"><b>${nbName(i)}</b> linked to you</button>`);
      else if (to) events.push(`<button class="nb-ev" data-open="${esc(i.id)}"><b>${nbName(i)}</b> replied to <b>${isOwn(to.feed_id) ? 'you' : nbName(to)}</b></button>`);
      else if (m) events.push(`<button class="nb-ev" data-open="${esc(i.id)}"><b>${nbName(i)}</b> mentioned <b>${nbFeedName(m.f)}</b></button>`);
    }
    const yours = (SOC.conv?.posts || []).reduce((s, p) => s + (p.replies || 0), 0);
    const head = n ? `${n} new ${n === 1 ? 'post' : 'posts'} from ${ppl.size} ${ppl.size === 1 ? 'person' : 'people'}` : 'Nothing new yet';
    // One line when there's nothing new, or when you've folded it away
    const small = (!n && !events.length) || store.get('nbMin') === '1';
    const k = `<div class="nb-open-top"><span class="nb-open-k">${first ? 'This week' : 'Since you were here'}</span>${chips}
      ${n || events.length ? `<button class="nb-min" data-talk="nbmin" title="${small ? 'Show more' : 'Fold away'}" aria-label="${small ? 'Show more' : 'Fold away'}">${small ? '+' : '–'}</button>` : ''}</div>`;
    if (small) return `<section class="nb-open small">${k}<div class="nb-open-h sm"><span>${head}${events.length ? ` · ${events.length} conversation${events.length === 1 ? '' : 's'}` : ''}</span></div>${store.get('nbMin') === '1' ? '' : facesHtml}</section>`;
    return `<section class="nb-open">${k}
      <div class="nb-open-h"><span>${head}${!n && !first ? '. Here’s the last two weeks.' : ''}</span></div>
      ${facesHtml}
      ${events.length ? `<div class="nb-evs">${events.slice(0, 3).join('')}${events.length > 3 ? `<button class="nb-ev more" data-talk="nbonly" data-k="talk">${events.length - 3} more conversations</button>` : ''}</div>` : ''}
      ${yours ? `<button class="nb-ev mine" data-talk="tab" data-tab="posts">Your posts have ${yours} ${yours === 1 ? 'reply' : 'replies'} on Mastodon and Bluesky</button>` : ''}
    </section>`;
  }


  // ---- You: everything coming your way, in one place. Replies on Mastodon and Bluesky, comments and Webmentions
  // on your own site, blogs linking to you, mentions of your blog, and emails from the people you read.
  const YOU_CHIPS = [['', 'Everything'], ['myreplies', 'Your replies'], ['replies', 'Replies'], ['comments', 'Comments'], ['mentions', 'Mentions'], ['posts', 'Your posts']];
  const newComments = () => (SOC.comments?.comments || []).filter(c => Date.parse(c.date) > socialSeen()).length;
  const newYou = () => newReplies() + newComments() + (SOC.mentions || []).filter(n => Date.parse(n.created_at) > socialSeen()).length;
  function commentHtml(c) {
    const wm = c.kind !== 'comment';
    const what = wm ? (c.kind === 'like' ? 'liked' : c.kind === 'repost' ? 'reposted' : 'mentioned') : 'commented on';
    const face = isWeb(c.avatar) ? `<span class="nb-av md"><img class="nb-face-img" src="${esc(c.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">${esc((c.name || '?')[0].toUpperCase())}</span>`
      : `<span class="nb-av md" style="--h:${hueFor(c.name)}">${esc((c.name || '?')[0].toUpperCase())}</span>`;
    return `<article class="yu-ev${Date.parse(c.date) > socialSeen() ? ' new' : ''}">${face}<div class="nb-main">
      <div class="nb-by"><b>${esc(c.name || 'Someone')}</b><span>${what}${c.post_title ? ` “${esc(c.post_title)}”` : ' your post'}${wm ? ' · from their site' : ''}</span><time>${esc(fmtWhen(c.date))}</time></div>
      ${c.text && !(wm && c.kind !== 'comment' && c.text.length < 3) ? `<p class="nb-text">${esc(c.text.length > 400 ? c.text.slice(0, 390) + '…' : c.text)}</p>` : ''}
      <div class="nb-acts"><button class="linkish" data-talk="open" data-url="${esc(c.link)}">${wm ? 'Open' : 'Reply on your site'}</button>${isWeb(c.url) ? `<button class="linkish" data-talk="open" data-url="${esc(c.url)}">${esc(hostOfU(c.url))}</button>` : ''}</div>
    </div></article>`;
  }
  function youHtml() {
    const chip = SOC.youChip || '';
    const chips = `<div class="nb-chips">${YOU_CHIPS.filter(([k]) => !['comments', 'myreplies'].includes(k) || SOC.accounts.wordpress).filter(([k]) => !['replies', 'posts'].includes(k) || anySocial())
      .map(([k, l]) => `<button class="nb-chip" data-talk="youchip" data-k="${k}" aria-pressed="${chip === k}">${l}</button>`).join('')}${alertsBtn('you', S.prefs.youAlerts !== false, 'Alerts')}</div>`;
    const waiting = SOC.comments?.waiting ? `<button class="nb-ev wait" data-talk="open" data-url="${esc(SOC.comments.admin)}">${SOC.comments.waiting} ${SOC.comments.waiting === 1 ? 'comment is' : 'comments are'} waiting for your approval</button>` : '';
    if (chip === 'myreplies') return chips + myRepliesHtml();
    if (chip === 'replies') return chips + repliesHtml();
    if (chip === 'posts') return chips + postsHtml();
    if (chip === 'mentions') return chips + blogHtml();
    if (chip === 'comments') return chips + waiting + (SOC.comments ? (SOC.comments.comments.length ? SOC.comments.comments.map(commentHtml).join('') : '<p class="note">No comments or Webmentions on your site yet.</p>') : '<p class="note">Looking at your site’s comments…</p>');
    // Everything, newest first
    const x = nbIndex(), soc = nbSocial(), mine = myFeed(), host = mine ? bareHost(hostOfU(isWeb(mine.site) ? mine.site : mine.url)) : '';
    const ev = [];
    for (const n of SOC.conv?.replies || []) ev.push({ date: n.created_at, html: `<div class="yu-ev${Date.parse(n.created_at) > socialSeen() ? ' new' : ''}">${noteHtml(n)}</div>` });
    for (const r of myReplies()) for (const i of answersTo(r)) ev.push({ date: i.date, html: `<article class="yu-ev${i.read ? '' : ' new'}">${nbFace(nbWho(i), 'nb-av md')}<div class="nb-main"><div class="nb-by"><b>${nbName(i)}</b><span>answered your reply to “${esc(r.title)}”</span><time>${esc(fmtWhen(i.date))}</time></div><button class="nb-title sm" data-open="${esc(i.id)}">${esc(headline(i))}</button><div class="nb-acts"><button class="linkish" data-open="${esc(i.id)}">Read</button><button class="linkish" data-talk="open" data-url="${esc(r.url)}">Your reply</button></div></div></article>` });
    for (const n of SOC.mentions || []) ev.push({ date: n.created_at, html: `<div class="yu-ev${Date.parse(n.created_at) > socialSeen() ? ' new' : ''}">${noteHtml(n)}</div>` });
    // a Webmention from a blog you read is the same news as its post linking to you: keep the post
    const linking = S.items.filter(i => x.toMe.has(i.id));
    const dupe = c => c.kind !== 'comment' && linking.some(i => bareHost(hostOfU(i.link)) === bareHost(hostOfU(c.url)) && Math.abs(Date.parse(i.date) - Date.parse(c.date)) < 3 * DAY);
    for (const c of SOC.comments?.comments || []) if (!dupe(c)) ev.push({ date: c.date, html: commentHtml(c) });
    for (const i of linking) ev.push({ date: i.date, html: nbCard(i, x, soc) });
    // emails from the people you read (their address on their own site's domain)
    const people = new Map();
    for (const f of S.feeds) if (kindOf(f) === 'person' && !isEmailFeed(f)) { const h = bareHost(hostOfU(isWeb(f.site) ? f.site : f.url)); if (h && h !== host) people.set(h, feedById(personId(f.id)) || f); }
    for (const i of S.items.filter(i => isEmailItem(i) && i.links.startsWith('mailto:'))) {
      const f = people.get(bareHost(i.links.split('@')[1] || ''));
      if (f) ev.push({ date: i.date, html: `<article class="yu-ev${i.read ? '' : ' new'}">${nbFace(f, 'nb-av md')}<div class="nb-main"><div class="nb-by"><button class="nb-name" data-talk="nbwho" data-feed="${esc(f.id)}">${esc(f.title)}</button><span>emailed you</span><time>${esc(fmtWhen(i.date))}</time></div><button class="nb-title sm" data-open="${esc(i.id)}">${esc(i.title)}</button><div class="nb-acts"><button class="linkish" data-open="${esc(i.id)}">Read</button></div></div></article>` });
    }
    ev.sort((a, b) => b.date.localeCompare(a.date));
    const loading = (anySocial() && !SOC.conv) || (SOC.accounts.wordpress && !SOC.comments);
    const empty = loading ? '<p class="note">Checking for replies, comments and mentions…</p>'
      : `<p class="nb-end">Nothing yet.<small>${anySocial() || SOC.accounts.wordpress ? 'Replies, comments and links to your site show up here.' : 'Connect your site or a Mastodon or Bluesky account (Settings › Connections) to see replies here. Blogs linking to you show up either way.'}</small></p>`;
    return chips + waiting + (ev.length ? ev.slice(0, 50).map(e => e.html).join('') : empty);
  }

  // Tabs: what people share, replies to you, your posts, and people linking to your blog
  const TALK_TABS = [['blogs', 'Neighborhood'], ['shared', 'Following'], ['you', 'You']];
  const WEEK_MS = 7 * DAY;
  const myDomain = () => {
    const f = myFeed(); if (!f) return '';
    const h = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    return (isWeb(f.site) && h(f.site)) || h(f.url);
  };
  // Your site's comments: when Conversations opens, and every 15 minutes for alerts
  function loadComments() {
    if (!SOC.accounts.wordpress) return;
    invoke('site_comments').then(c => { SOC.comments = c; youAlerts(); if (S.view === 'talk') { renderList(); renderRail(); } }).catch(() => { if (!SOC.comments) SOC.comments = { comments: [], waiting: 0 }; });
  }
  async function loadTalk() {
    SOC.checkedAt = new Date().toISOString();
    loadComments();
    loadTheirLikes();
    if (!anySocial()) return;
    const tasks = [
      loadConversations(true),
      invoke('social_profiles').then(p => { SOC.profiles = p; }).catch(() => {}),
      invoke('social_followers').then(f => { SOC.followers = f; }).catch(() => {}),
      invoke('social_shared').then(c => { SOC.shared = c; }).catch(e => { SOC.shared = { posts: [], errors: [msg(e)] }; }),
    ];
    const d = myDomain();
    if (d) tasks.push(invoke('social_blog_mentions', { domain: d }).then(m => { SOC.mentions = m; youAlerts(); }).catch(() => { SOC.mentions = []; }));
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
  // (by their name: the handles differ from one network to the other)
  const samePerson = n => (n.author.name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') || n.author.handle;
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
      // the same person on Mastodon and Bluesky counts once: by the writer you read, else by their name
      const people = [...new Map(g.map(x => [samePerson(x), x])).values()];
      const nets = [...new Set(g.map(x => x.network))];
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
          <b>${esc(who.author.name)}</b>${more ? ` and <b>${more} other${more > 1 ? 's' : ''}</b>` : ''} ${who.via ? `(via ${esc(who.via)})` : 'shared'} · ${esc(fmtWhen(who.created_at))} <span class="n-net">${nets.map(k => ICON_NET[k] || '').join(' ')}</span></div>
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
  // ---- Replies, grouped into whole conversations: everything from the post that started it down through every
  // reply, yours too, so you can follow and answer the back-and-forth here.
  const convRoot = n => n.network === 'bluesky' ? (n.root_id || n.id) : (SOC.rootOf.get(n.id) || n.id);
  const convKey = n => n.network + ':' + convRoot(n);
  function replyGroups() {
    const groups = new Map();
    for (const n of SOC.conv?.replies || []) {
      const k = convKey(n);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    return [...groups.entries()];
  }
  async function loadWhole(n) {
    const k = convKey(n);
    if (SOC.whole.has(k)) return;
    SOC.whole.set(k, 'loading');
    try {
      const all = await invoke('social_whole', { network: n.network, id: n.id, root: n.network === 'bluesky' ? n.root_id || '' : '' });
      const top = all[0]?.id || convRoot(n);
      for (const x of all) SOC.rootOf.set(x.id, top);
      SOC.rootOf.set(n.id, top);
      SOC.whole.set(n.network + ':' + top, all);
      if (k !== n.network + ':' + top) SOC.whole.delete(k);
    } catch (e) { SOC.whole.set(k, { err: msg(e) }); }
    // don't redraw under a reply you're typing; it shows on the next redraw
    if (S.view === 'talk' && SOC.tab === 'you' && !document.querySelector('.n-form')) renderList();
  }
  let wholeBusy = false;
  async function loadWholes() {
    if (wholeBusy) return; wholeBusy = true;
    try {
      // the newest conversations load by themselves, a few at a time; older ones when you ask
      const want = replyGroups().slice(0, 10).map(([k, ns]) => ns[0]).filter(n => !SOC.whole.has(convKey(n)));
      for (let i = 0; i < want.length; i += 3) await Promise.all(want.slice(i, i + 3).map(loadWhole));
    } finally { wholeBusy = false; }
  }
  function wholeHtml(k, notes, whole) {
    const seen = socialSeen(), notified = new Set(notes.map(n => n.id));
    const root = whole[0], rootId = root.root_id || root.id, rootCid = root.root_cid || root.cid;
    const one = (n, i) => `<div class="${notified.has(n.id) && Date.parse(n.created_at) > seen ? 't-new' : ''}">${noteHtml(n, { reply: i > 0, rootId, rootCid })}</div>`;
    let body;
    if (whole.length > 9 && !SOC.wideOpen.has(k)) {
      const hidden = whole.length - 1 - 6;
      body = one(whole[0], 0) + `<button class="linkish t-earlier" data-talk="wide" data-k="${esc(k)}">Show ${hidden} earlier ${hidden === 1 ? 'reply' : 'replies'}</button>` + whole.slice(-6).map((n, i) => one(n, i + 1)).join('');
    } else body = whole.map(one).join('');
    return `<div class="t-conv" data-conv="${esc(k)}"><div class="t-conv-h">${ICON_NET[root.network]} Conversation · ${whole.length} ${whole.length === 1 ? 'post' : 'posts'}</div>${body}</div>`;
  }
  function repliesHtml() {
    const c = SOC.conv; if (!c) return '<p class="note">Checking Mastodon and Bluesky…</p>';
    const seen = socialSeen(), groups = replyGroups();
    if (groups.some(([k, ns]) => !SOC.whole.has(convKey(ns[0]))) ) setTimeout(loadWholes, 0);
    return (SOC.err || []).map(e => `<div class="banner err">${esc(e)}</div>`).join('') + (groups.length
      ? `<div class="t-replies">${groups.slice(0, 30).map(([k, ns]) => {
          const w = SOC.whole.get(k);
          if (Array.isArray(w) && w.length) return `<div>${wholeHtml(k, ns, w)}</div>`;
          const foot = w === 'loading' ? '<p class="note t-convnote">Loading the whole conversation…</p>'
            : `<button class="linkish t-convnote" data-talk="whole" data-net="${ns[0].network}" data-id="${esc(ns[0].id)}">${w?.err ? 'Couldn’t load the conversation. Try again' : 'Show the whole conversation'}</button>`;
          return `<div>${ns.map(n => `<div class="${Date.parse(n.created_at) > seen ? 't-new' : ''}">${noteHtml(n)}</div>`).join('')}${foot}</div>`;
        }).join('')}</div>`
      : '<p class="note">No replies or mentions yet. When someone answers you, it shows up here.</p>');
  }
  function postsHtml() {
    const c = SOC.conv; if (!c) return '<p class="note">Checking Mastodon and Bluesky…</p>';
    return c.posts.length ? c.posts.map(postHtml).join('') : '<p class="note">Nothing posted yet. Open a story and choose Share › Post to Bluesky or Mastodon, or press New post.</p>';
  }
  function blogHtml(limit) {
    const d = myDomain();
    if (!d) return '<p class="note">Mark your own site first: open its feed and choose “This is my site.”</p>';
    // Blogs you read that link to you come first: those are the replies that live on people's own sites
    const x = nbIndex(), fromBlogs = S.items.filter(i => x.toMe.has(i.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    const blogs = fromBlogs.length ? `<h3 class="nb-sub">From blogs you read</h3>${fromBlogs.map(i => nbCard(i, x)).join('')}<h3 class="nb-sub">On Mastodon and Bluesky</h3>` : '';
    if (!anySocial()) return blogs || `<p class="note">No blogs you read have linked to ${esc(d)} lately.</p>`;
    const m = SOC.mentions;
    if (!m) return blogs + '<p class="note">Looking for people linking to your site…</p>';
    if (!m.length) return blogs + `<p class="note">Nobody has linked to ${esc(d)} there lately${SOC.accounts.mastodon && !SOC.accounts.bluesky ? ' (Mastodon’s search only finds some posts)' : ''}.</p>`;
    return blogs + `<div class="t-replies">${m.slice(0, limit || 40).map(n => `<div>${noteHtml(n)}</div>`).join('')}</div>`;
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
    const who = SOC.person && feedById(SOC.person);
    paintTalkHead();
    // Three tabs (in the title row): the Neighborhood, Following (Mastodon and Bluesky), and You
    const { tab } = talkTabsInfo();
    if (tab === 'blogs') return `<div class="nb-col">${who ? personHtml(who) : neighborhoodHtml()}</div>`;
    if (tab === 'you') return `<div class="nb-col">${profilesHtml()}${youHtml()}</div>`;
    return `<div class="tcols"><div class="tmain"><h2 class="sec-t">Shared by people you follow</h2><p class="sec-s">Only the posts that share something to read. No doom-scrolling.</p>${sharedHtml()}</div>
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
    const ta = box.querySelector('textarea'), dkey = box.dataset.box;
    if (DRAFTS[dkey]) ta.value = DRAFTS[dkey].text;
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('input', () => setDraft(dkey, ta.value === start ? '' : ta.value));
    box.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const btn = box.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await invoke('social_reply', { network: net, text: ta.value, parentId: b.dataset.id, parentCid: b.dataset.cid || '', rootId: b.dataset.root || '', rootCid: b.dataset.rootcid || '' });
        status('Reply sent.'); setDraft(dkey, ''); box.innerHTML = '';
        const conv = b.closest('[data-conv]')?.dataset.conv;
        if (conv) { const n = SOC.whole.get(conv)?.[0]; SOC.whole.delete(conv); if (n) { await loadWhole(n); } }
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
  // Back from a person's page to where you were: the feed you opened it from, or the same place in Conversations
  function personBack() {
    const from = SOC.personFrom || {}; SOC.personFrom = null; SOC.person = null;
    if (from.view !== undefined && from.view !== 'talk') { selectView(String(from.view)); return; }
    if (from.tab) SOC.tab = from.tab; if (from.chip !== undefined) SOC.youChip = from.chip;
    renderList(); renderRail();
    requestAnimationFrame(() => $('main').scrollTo({ top: from.top || 0 }));
  }
  const backLabel = () => { const f = SOC.personFrom || {}; return f.view !== undefined && f.view !== 'talk' ? (f.title || 'your feeds') : f.tab === 'you' ? 'You' : f.tab === 'shared' ? 'Following' : 'Neighborhood'; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.view === 'talk' && SOC.person && !document.querySelector('dialog[open], .n-box textarea:focus')) personBack(); });
  // "Their page" on a person's feed: open Conversations on that person (runs before the view switch)
  document.addEventListener('click', e => {
    const pp = e.target.closest?.('[data-person-page]');
    if (pp) { SOC.personFrom = { view: S.view, title: feedById(S.view)?.title || '' }; SOC.person = pp.dataset.personPage; SOC.personShown = 15; SOC.tab = 'blogs'; SOC.keepPerson = true; }
  }, true);
  document.addEventListener('click', e => {
    if (e.target.id === 'talkConnect') { openAccounts(); return; }
    if (e.target.id === 'talkRefresh') { SOC.shared = null; SOC.mentions = null; SOC.comments = null; SOC.whole.clear(); loadTalk(); renderList(); return; }
    const b = e.target.closest('[data-talk]'); if (!b) return;
    const k = b.dataset.talk;
    if (k === 'nbwho') { if (!b.dataset.feed) { SOC.nbWho = ''; renderList(); return; }
      if (!SOC.person) SOC.personFrom = { tab: SOC.tab, chip: SOC.youChip, top: $('main').scrollTop };
      SOC.person = b.dataset.feed; SOC.personShown = 15; SOC.tab = 'blogs'; renderList(); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'nbback') { personBack(); return; }
    if (k === 'ppmore') { SOC.personShown = (SOC.personShown || 15) + 15; renderList(); return; }
    if (k === 'nbonly') { SOC.nbOnly = b.dataset.k; SOC.nbShown = 30; renderList(); return; }
    if (k === 'nbwelcomed') { store.set('nbWelcomed', '1'); renderList(); return; }
    if (k === 'nbhinted') { store.set('nbHinted', '1'); renderList(); return; }
    if (k === 'nbdots') { SOC.moreOpen = b.dataset.id; renderList(); return; }
    if (k === 'nbmin') { store.set('nbMin', store.get('nbMin') === '1' ? '0' : '1'); renderList(); return; }
    if (k === 'nbmore') { SOC.nbShown = (SOC.nbShown || 30) + 30; renderList(); return; }
    if (k === 'nbsave') { const it = item(b.dataset.id); if (it) { mark(it.id, { saved: !it.saved }); status(it.saved ? 'Removed from Read later.' : 'Saved to Read later.'); } return; }
    if (k === 'nbshare') { const it = item(b.dataset.id); if (it) openShareMenu(b, it); return; }
    if (k === 'nbreply') { const it = item(b.dataset.id); if (it) openReply(b, it); return; }
    if (k === 'nbrbox') { const it = item(b.dataset.id); if (!it) return; if (QUOTE && QUOTE.id === it.id && Date.now() - QUOTE.at < 120e3) { const q = QUOTE.text; QUOTE = null; paintQuoteBtn(); quoteReply(it, q); } else nbReplyBox(b, it); return; }
    if (k === 'friend') { const f = feedById(b.dataset.feed); if (f) setFriend(f, !isFriend(f)); return; }
    if (k === 'alerts') { const key = b.dataset.k === 'friend' ? 'friendAlerts' : 'youAlerts'; S.prefs[key] = S.prefs[key] === false; savePrefs(); renderList();
      status(S.prefs[key] ? (key === 'youAlerts' ? 'You’ll get an alert for new replies, comments and links to your blog.' : 'You’ll get an alert when a close friend posts.') : 'Those alerts are off.');
      if (S.prefs[key]) invoke('notify', { title: 'Alerts are on', body: key === 'youAlerts' ? 'Replies, comments and mentions show up like this.' : 'New posts from close friends show up like this.', id: 'alerts-' + key }).catch(() => {});
      return; }
    if (k === 'nblike') { const it = item(b.dataset.id); if (it) likePost(b, it); return; }
    if (k === 'nbreadall') { const ids = SOC.nbUnreadIds || []; if (ids.length) { mark(ids, { read: true }); status(`Marked ${ids.length} as read.`); } return; }
    if (k === 'myrepmore') { SOC.myRepShown = (SOC.myRepShown || 20) + 20; renderList(); return; }
    if (k === 'cmts') { const it = item(b.dataset.id); if (it) toggleComments(it); return; }
    if (k === 'repost') { const it = item(b.dataset.id); if (it) openRepost(it); return; }
    if (k === 'groups') { const f = feedById(b.dataset.feed); if (f) groupMenu(f); return; }
    if (k === 'nbgroup') { SOC.nbGroup = b.dataset.g; SOC.nbShown = 30; renderList(); return; }
    if (k === 'grpedit') { const g = groupsOf().find(x => x.id === b.dataset.g); if (g) groupEdit(g); return; }
    if (k === 'topic') { SOC.nbTopic = b.dataset.t; SOC.nbShown = 30; SOC.person = null; SOC.nbWho = ''; if (b.dataset.t && SOC.nbOnly === 'topics') SOC.nbOnly = ''; SOC.tab = 'blogs'; if (S.view !== 'talk') selectView('talk'); else renderList(); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'topicmute') { setTopicMute(b.dataset.t, true); return; }
    if (k === 'topicunmute') { setTopicMute(b.dataset.t, false); return; }
    if (k === 'nbbrought') { store.set('nbBrought', '1'); renderList(); status('You’ll still find them under Following › Their blogs.'); return; }
    if (k === 'bringopen') { SOC.bringOpen = !SOC.bringOpen; renderList(); return; }
    if (k === 'bringall') { followMany(bringList().map(x => x.blog), b, true); return; }
    if (k === 'rollmore') { SOC.rollAll = SOC.rollAll === b.dataset.feed ? null : b.dataset.feed; renderList(); return; }
    if (k === 'rollall') { const f = feedById(b.dataset.feed); if (!f) return; const site = isWeb(f.site) ? f.site : 'https://' + bareHost(hostOfU(f.url)) + '/';
      const not = (ROLLS[site]?.list || []).filter(e => !followsDomain(bareHost(hostOfU(e.url)))); followMany(not.map(e => e.feed || e.url), b, false); return; }
    if (k === 'notelike') { likeNote(b); return; }
    if (k === 'wmopen') {
      const it = item(b.dataset.id); if (!it) return;
      if (SOC.wmOpen === it.id) { SOC.wmOpen = null; renderList(); paintReaderTalk(); return; }
      SOC.wmOpen = it.id; SOC.wmList = SOC.wmList || new Map(); renderList(); paintReaderTalk();
      if (!SOC.wmList.has(it.link)) invoke('wm_mentions', { url: it.link }).then(l => { SOC.wmList.set(it.link, l); }).catch(e => { SOC.wmList.set(it.link, { err: msg(e) }); }).finally(() => { if (S.view === 'talk') renderList(); paintReaderTalk(); });
      return;
    }
    if (k === 'thread') toggleThread(b.dataset.net, b.dataset.id);
    if (k === 'whole') { const n = (SOC.conv?.replies || []).find(x => x.id === b.dataset.id); if (n) { SOC.whole.delete(convKey(n)); loadWhole(n); renderList(); } }
    if (k === 'wide') { SOC.wideOpen.add(b.dataset.k); renderList(); }
    if (k === 'open' && isWeb(b.dataset.url)) openWeb(b.dataset.url);
    if (k === 'reply') replyBox(b);
    if (k === 'cancel') { const nb = b.closest('.n-box'); setDraft(nb.dataset.box, ''); nb.innerHTML = ''; }
    if (k === 'more') moreMenu(b);
    if (k === 'tab') {
      SOC.person = null;
      const old = { replies: 'replies', posts: 'posts', blog: 'mentions' }[b.dataset.tab];
      SOC.tab = old !== undefined ? 'you' : b.dataset.tab;
      if (old !== undefined) SOC.youChip = old; else if (b.dataset.chip !== undefined) SOC.youChip = b.dataset.chip;
      renderList(); $('main').scrollTo({ top: 0 });
      if (SOC.tab === 'you') setTimeout(() => { store.set('socialSeen', String(Date.now())); renderRail(); }, 3000);
    }
    if (k === 'youchip') { SOC.youChip = b.dataset.k; renderList(); return; }
    if (k === 'newpost') { if (SOC.accounts.wordpress) openNote(null); else openCompose(null); }
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
  setInterval(() => { if (!document.hidden) loadConversations(true); if (S.prefs.youAlerts !== false) loadComments(); }, 15 * 60 * 1000);

  // ------------------------------------------------------------ Write back: reply to the writer, not the algorithm
  let replyFor = null;
  async function openReply(anchor, about) {
    const it = about || item(S.readerId); if (!it) return;
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
  // Feeds write an address as "name@site.com (Name)" or "Name <name@site.com>": keep the address
  const plainAddress = t => ((t || '').match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [''])[0];
  function replyItems(it, o) {
    const who = feedById(it.feed_id)?.title || 'the writer', rows = [];
    if (o.email && plainAddress(o.email.address)) o = { ...o, email: { ...o.email, address: plainAddress(o.email.address) } };
    if (o.email) {
      const subject = o.email.subject || `Re: ${headline(it)}`;
      const body = `\n\n\n—\nIn reply to “${headline(it)}”\n${it.link}`;
      rows.push(MAIL.account
        ? `<button type="button" role="menuitem" data-reply-mail="${esc(o.email.address)}" data-subject="${esc(subject)}">${ICON_MAIL}<span>Reply by email<small>to ${esc(o.email.address)}, from ${esc(MAIL.account.address)}</small></span></button>`
        : `<button type="button" role="menuitem" data-reply="${esc(`mailto:${o.email.address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)}">${ICON_MAIL}<span>Reply by email<small>${esc(o.email.address)}</small></span></button>`);
    }
    if (o.comments) rows.push(`<button type="button" role="menuitem" data-reply-web="${esc(o.comments)}">${ICON_TALK}<span>Leave a comment<small>on the post</small></span></button>`);
    // With that network connected, Write back answers from your own account in the app (no website sign-in)
    for (const l of o.social || []) {
      const net = (l.label || '').toLowerCase(), mine = SOC.accounts[net];
      if (mine && l.post) rows.push(`<button type="button" role="menuitem" data-reply-app="${esc(l.url)}">${ICON_AT}<span>Reply on ${esc(l.label)}<small>from ${esc(mine.handle)}</small></span></button>`);
      else if (mine) rows.push(`<button type="button" role="menuitem" data-mention-app="${esc(net + '|' + l.url)}">${ICON_AT}<span>Write to them on ${esc(l.label)}<small>share this story from ${esc(mine.handle)}, mentioning them</small></span></button>`);
      else rows.push(`<button type="button" role="menuitem" data-reply-web="${esc(l.url)}">${ICON_AT}<span>${l.post ? `Reply on ${esc(l.label)}` : `Write to them on ${esc(l.label)}`}<small>${esc(l.post ? 'opens the post' : l.url.replace(/^https?:\/\//, ''))}</small></span></button>`);
    }
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
    const b = e.target.closest('[data-reply], [data-reply-web], [data-reply-app], [data-mention-app], [data-reply-mail]'); if (!b) return;
    $('replyMenu').hidden = true;
    if (b.dataset.replyMail) {
      const it = item(S.readerId);
      return openMailCompose({ to: b.dataset.replyMail, subject: b.dataset.subject, body: it ? `\n\n—\nIn reply to “${headline(it)}”\n${it.link}` : '' });
    }
    if (b.dataset.replyApp) return replyFromApp(b.dataset.replyApp);
    if (b.dataset.mentionApp) {
      const [net, url] = b.dataset.mentionApp.split('|'), it = item(S.readerId);
      let at = '';
      try { const u = new URL(url); at = net === 'bluesky' ? '@' + (u.pathname.split('/profile/')[1] || '').split('/')[0] : '@' + u.pathname.replace(/^\/@/, '').split('/')[0] + '@' + u.hostname; } catch {}
      openCompose(it, net);
      if (at && $('cText')) { $('cText').value = at + ' '; $('cText').dispatchEvent(new Event('input')); $('cText').focus(); }
      return;
    }
    try {
      if (b.dataset.reply) await invoke('open_external', { url: b.dataset.reply });
      else openWeb(b.dataset.replyWeb);
    } catch (err) { status(msg(err), true); }
  });

  // Answer a Mastodon or Bluesky post from your own account, right here
  async function replyFromApp(url) {
    const el = sheet('replyApp', `<h2>Reply</h2><p class="note" id="raNote">Finding the post…</p>
      <textarea id="raText" rows="5" placeholder="Write your reply" disabled></textarea>
      <div class="row sheet-foot"><button class="btn" type="button" id="raCancel">Cancel</button><button class="btn primary" type="button" id="raSend" disabled>Reply</button></div>`, 'Reply');
    $('raCancel').onclick = () => { el.hidden = true; };
    let r;
    try { r = await invoke('social_resolve', { url }); }
    catch (e) { $('raNote').textContent = msg(e); return; }
    $('raNote').innerHTML = `Replying to <b>${esc(r.name)}</b> ${esc(r.handle)} on ${NET[r.network]}${r.text ? `<span class="ra-q">${esc(r.text.length > 240 ? r.text.slice(0, 240) + '…' : r.text)}</span>` : ''}`;
    const t = $('raText'); t.disabled = false; t.value = r.network === 'mastodon' ? r.handle + ' ' : ''; t.focus();
    $('raSend').disabled = false;
    $('raSend').onclick = async () => {
      $('raSend').disabled = true; $('raSend').textContent = 'Replying…';
      try {
        await invoke('social_reply', { network: r.network, text: t.value, parentId: r.id, parentCid: r.cid, rootId: r.root_id, rootCid: r.root_cid });
        el.hidden = true; status(`Replied on ${NET[r.network]}. Answers will show in Conversations.`);
      } catch (e) { $('raSend').disabled = false; $('raSend').textContent = 'Reply'; status(msg(e), true); }
    };
  }

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
    if (!S.readerId && S.view === 'talk') talkScroll = [$('main').scrollTop, $('listView').scrollTop];
    S.readerId = S.selId = id; S.keep.add(id);
    hidePops();
    $('listView').hidden = !isSplit(); $('reader').hidden = false; $('readerEmpty').hidden = true; syncWide();
    if (isPhone()) setScreen('reader');
    if (isSplit()) $('reader').scrollTo({ top: 0 }); else $('main').scrollTo({ top: 0 });
    if (!it.read) { countOpen(it); mark(id, { read: true }); } else render();
    renderReaderChrome();
    loadArticle(it);
    if (isSplit()) document.querySelector(`.story[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function closeReader(silent) {
    if (!S.readerId) return;
    S.readerId = null; articleFor = null; hidePops();
    // A video stops when you leave it; a podcast that's playing keeps going until the next story
    const au = $('rAudio'); if (!au || au.paused) { $('rMedia').innerHTML = ''; $('rMedia').hidden = true; }
    // videos inside the story stop too (a hidden player keeps playing otherwise)
    $('rBody').querySelectorAll('.r-video').forEach(v => v.remove());
    $('reader').hidden = true; $('listView').hidden = false; $('readerEmpty').hidden = false; syncWide();
    if (isPhone()) setScreen('list');
    if (!silent) { renderList(); if (!isSplit()) $('main').scrollTo({ top: listScroll }); }
    if (S.view === 'talk' && talkScroll) { const [m, l] = talkScroll; requestAnimationFrame(() => { $('main').scrollTop = m; $('listView').scrollTop = l; }); talkScroll = null; }
  }
  let talkScroll = null;

  function renderReaderChrome() {
    const it = item(S.readerId); if (!it) return closeReader();
    const f = feedById(it.feed_id);
    $('rBackLabel').textContent = viewName();
    $('rSave').textContent = isPhone() ? (it.saved ? 'Saved ✓' : 'Save') : (it.saved ? 'Saved ✓' : 'Read later');
    $('rOriginal').textContent = isPhone() ? 'Web' : 'View original';
    const em = isEmailItem(it);
    $('rReply').textContent = em || isPhone() ? 'Reply' : 'Write back';
    $('rOriginal').hidden = em; $('rShare').hidden = em; // an email has no web page
    $('rReply').classList.toggle('primary', em);
    $('rDelete').hidden = !em;
    $('rSave').setAttribute('aria-pressed', String(!!it.saved));
    $('rTitle').textContent = headline(it);
    const when = new Date(it.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    $('rMeta').innerHTML = `<span class="src">${esc(em ? 'Email' : f ? f.title : '')}</span><time datetime="${esc(it.date)}">${esc(when)}</time><span id="rByline"></span>`;
    const list = visible().slice(0, S.shown), i = list.findIndex(x => x.id === it.id);
    $('rPrev').disabled = i <= 0; $('rNext').disabled = i < 0 || i >= list.length - 1;
    renderNotes();
  }

  // ---- Under a post in the reader: the blogs you read that answered it, what it answers, who shared it,
  // reactions from other sites, and a Like from your own site
  function paintReaderTalk() {
    const el = $('rTalk'), it = item(S.readerId);
    if (!el) return;
    if (!it || isEmailItem(it) || !isWeb(it.link)) { el.hidden = true; el.innerHTML = ''; return; }
    const x = nbIndex(), soc = nbSocial(), ans = x.answers.get(it.id) || [], to = x.replyTo.get(it.id), m = !to && x.mentions.get(it.id);
    const parts = [];
    if (to) parts.push(`<button class="nb-to" data-open="${esc(to.id)}">${NB_TALK}<span>This answers <b>${nbName(to)}</b>: ${esc(headline(to))}</span></button>`);
    else if (m) parts.push(`<button class="nb-to" data-talk="open" data-url="${esc(m.url)}">${NB_TALK}<span>Mentions <b>${nbFeedName(m.f)}</b>’s blog</span></button>`);
    if (ans.length) parts.push(`<div class="nb-ans"><span class="nb-ans-k">${ans.length === 1 ? 'An answer' : `${ans.length} answers`} from blogs you read</span>
      ${ans.map(a => `<button class="nb-ans-r" data-open="${esc(a.id)}">${nbFace(nbWho(a), 'nb-av sm')}<span><b>${nbName(a)}</b> ${esc(headline(a))} <time>${esc(fmtWhen(a.date))}</time></span></button>`).join('')}</div>`);
    const shared = sharesHtml(it, soc), reacts = reactionsHtml(it), like = likeBtn(it), liked = likedByHtml(it), cm = commentsBtn(it);
    if (shared) parts.push(shared);
    if (liked) parts.push(liked);
    if (reacts) parts.push(reacts);
    if (!parts.length && !like) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `${parts.length || SOC.cmOpen === it.id ? '<h2>The conversation</h2>' : ''}${parts.join('')}${like ? `<div class="nb-acts r-talk-acts">${like}<button class="linkish" data-talk="nbrbox" data-id="${esc(it.id)}">${replyLbl(it.id)}</button>${repostBtn(it)}${cm}</div>${cmtsHtml(it)}<div class="n-box" data-box="nb:${esc(it.id)}"></div>` : ''}`;
  }

  async function loadArticle(it, refetch = false) {
    articleFor = it.id;
    paintMedia(it);
    paintReaderTalk();
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
      if (isEmailItem(it) && a.html.includes('rMailWait') && !MAIL.refetched?.has(it.id)) {
        (MAIL.refetched ||= new Set()).add(it.id);
        checkMail().then(() => { if (articleFor === it.id) loadArticle(item(it.id) || it); });
      }
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
  // Emails are laid out with tables (no lines between cells) and carry hidden lines meant for inbox previews.
  // Here: drop the empty spacer cells and rows, and a first line that only repeats the subject.
  function tidyMail(body, it) {
    const empty = el => !el.textContent.trim() && !el.querySelector('img, a, hr');
    body.querySelectorAll('tr').forEach(tr => { if (empty(tr)) tr.remove(); });
    body.querySelectorAll('td, th').forEach(td => { if (empty(td)) td.remove(); });
    const first = [...body.querySelectorAll('p, div, span, td, h1, h2')].find(el => el.textContent.trim());
    if (first && it && first.textContent.trim() === headline(it).trim() && !first.querySelector('img')) first.remove();
  }
  function paintArticle() {
    const body = $('rBody');
    body.innerHTML = articleHtml;
    const isMail = isEmailItem(item(S.readerId) || {});
    body.classList.toggle('mail-body', isMail);
    if (isMail) tidyMail(body, item(S.readerId));
    // YouTube players in the story come through as marked links; play them right here
    const shown = ytId(item(S.readerId)?.link);
    body.querySelectorAll('a[href$="#rr-video"]').forEach(a => {
      const id = ytId(a.getAttribute('href')), spot = a.parentElement?.tagName === 'P' && a.parentElement.textContent.trim() === a.textContent.trim() ? a.parentElement : a;
      if (!id || id === shown) { spot.remove(); return; } // the story's own video already plays above
      const v = document.createElement('div');
      v.className = 'r-video r-inline-video';
      v.innerHTML = ytPlayer(id, a.closest('figure')?.querySelector('figcaption')?.textContent || 'Video');
      spot.replaceWith(v);
    });
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
    document.querySelectorAll('#themeSeg button, #setThemeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === typePrefs.theme)));
    try { localStorage.setItem('readerPrefs', JSON.stringify(typePrefs)); } catch {}
    window.__TAURI__.event.emit?.('app-theme', typePrefs.theme).catch?.(() => {}); // the web window's toolbar follows
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
    if (kind === 'note') { if (SOC.accounts.wordpress) openNote(it); else { openAccounts().then(() => $('wpSite')?.focus()); status('Connect your site first, then write your note.'); } return; }
    if (kind === 'bluesky' || kind === 'mastodon') { openCompose(it, kind); return; }
    if (kind === 'sheet') { navigator.share?.({ title: it.title, url: it.link }).catch(() => {}); return; }
    const u = encodeURIComponent(it.link), t = encodeURIComponent(it.title);
    try {
      if (kind === 'x') await invoke('open_share', { url: `https://x.com/intent/post?text=${t}&url=${u}` });
      if (kind === 'linkedin') await invoke('open_share', { url: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` });
      if (kind === 'email') {
        if (MAIL.account) openMailCompose({ to: '', subject: it.title, body: `${it.title}\n${it.link}` });
        else await invoke('open_external', { url: `mailto:?subject=${t}&body=${t}%0A%0A${u}` });
      }
      if (kind === 'browser') await invoke('open_external', { url: it.link });
      // the story's page, translated by Google into this device's language, in the web window
      if (kind === 'translate') { const tl = (navigator.language || 'en').split('-')[0]; openWeb(`https://translate.google.com/translate?sl=auto&tl=${tl}&u=${u}`); }
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
  $('rClose').onclick = () => closeReader();
  $('rSave').onclick = () => { const it = item(S.readerId); if (it) mark(it.id, { saved: !it.saved }); };
  $('rShare').onclick = e => openShareMenu(e.currentTarget, item(S.readerId));
  $('rReply').onclick = e => { const it = item(S.readerId); if (it && isEmailItem(it)) openMailReply(it); else openReply(e.currentTarget); };
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
    // Every web link opens inside the app, in its web window (a book's own footnotes stay in the book).
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); if (S.view === 'books' && a.closest('.bk-text') && bookLink(a)) return; openWeb(a.href); return; }

    const grp = e.target.closest('[data-group]');
    if (grp) { const g = grp.dataset.group; foldedGroups.has(g) ? foldedGroups.delete(g) : foldedGroups.add(g); saveFoldedGroups(); renderRail(); return; }

    const chev = e.target.closest('[data-chev]');
    if (chev) { const id = Number(chev.dataset.chev); collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); saveCollapsed(); renderRail(); return; }

    const v = e.target.closest('[data-view]');
    if (v) { closeReader(true); selectView(v.dataset.view); return; }
    if (e.target.closest('[data-guide-posse]')) { closeReader(true); selectView('guide'); setTimeout(() => document.getElementById('g-posse')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); return; }
    const gj = e.target.closest('[data-guide-jump]');
    if (gj) {
      // Stop below the sticky title bar, so the heading isn't hidden under it
      const to = document.getElementById(gj.dataset.guideJump);
      if (to) { to.style.scrollMarginTop = (($('listTop')?.offsetHeight || 0) + 16) + 'px'; to.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      return;
    }
    const gf = e.target.closest('[data-guide-follow]');
    if (gf) { guideFollow(gf.dataset.guideFollow, gf); return; }
    if (e.target.id === 'guideMutes') { openMutes(); return; }
    if (e.target.id === 'guideNewsletters') { openNewsletters(); return; }
    if (e.target.id === 'welcomeX') { store.set('guideSeen', '1'); hideBanner(); return; }
    if (e.target.closest('[data-goal]')) { editGoal(); return; }
    const az = e.target.closest('[data-ab]');
    if (az) { abAction(az); return; }
    const bz = e.target.closest('[data-book]');
    if (bz) { bookAction(bz); return; }
    const vp = e.target.closest('#bkVp');
    if (vp && !e.target.closest('a') && window.getSelection()?.isCollapsed) {
      const r = vp.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x > .72) { flip(1); return; } if (x < .28) { flip(-1); return; }
    }
    const jz = e.target.closest('[data-job]');
    if (jz) { jobAction(jz); return; }
    const sm = e.target.closest('[data-small]');
    if (sm) { if (sm.dataset.small === 'more') D.smallMore = true; if (sm.dataset.small === 'retry') { D.smallErr = ''; D.small = null; } renderList(); return; }
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
    if (e.target.closest('#subFeedBtn')) { const f = feedById(S.view); if (f) toggleSubscribed(f); return; }
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
    const lb = e.target.closest('#listCheck, #listUnfollow, #listKeep, #listTake, #listSkip, #listCopy');
    if (lb) return listAction(lb.id, lb.dataset.list, lb);

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
    if (act.dataset.act === 'mdel') deleteMail(it);
  });

  // Drag a feed onto a folder (or onto "All" to take it out of its folder).
  // Drag a folder onto another to put it inside (two levels at most), or onto "All" to bring it back to the top.
  let dragFeed = null, dragFolder = null;
  document.addEventListener('dragstart', e => {
    const b = e.target.closest?.('[data-feed]');
    if (b) { dragFeed = Number(b.dataset.feed); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFeed)); return; }
    const fb = e.target.closest?.('.folder > button[data-view^="folder:"]');
    if (fb) { dragFolder = Number(fb.dataset.view.slice(7)); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'folder:' + dragFolder); }
  });
  document.addEventListener('dragend', () => { dragFeed = null; dragFolder = null; document.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });
  const dropTarget = e => {
    const t = e.target.closest?.('[data-view]'); if (!t || (dragFeed == null && dragFolder == null)) return null;
    if (t.dataset.view === 'all') return { el: t, folder: null };
    const m = /^folder:(\d+)$/.exec(t.dataset.view); if (!m) return null;
    const target = folderById(m[1]);
    if (dragFolder != null) {
      const moving = folderById(dragFolder);
      // only into a top-level folder, not into itself, and not a folder that has folders inside it
      if (!target || !moving || target.id === moving.id || !isTopFolder(target) || subfoldersOf(moving).length || moving.parent_id === target.id) return null;
    }
    return { el: t, folder: Number(m[1]) };
  };
  document.addEventListener('dragover', e => { const d = dropTarget(e); document.querySelectorAll('.drop').forEach(x => x !== d?.el && x.classList.remove('drop')); if (d) { e.preventDefault(); d.el.classList.add('drop'); } });
  document.addEventListener('drop', e => {
    const d = dropTarget(e); if (!d) return;
    e.preventDefault();
    if (dragFolder != null) moveFolder(dragFolder, d.folder); else moveFeed(dragFeed, d.folder);
  });
  async function moveFolder(id, parent) {
    const f = folderById(id); if (!f || (f.parent_id || null) === parent) return;
    try {
      await invoke('set_folder_parent', { id, parent });
      if (parent) collapsed.delete(parent);
      status(parent ? `${f.name} is now inside ${folderById(parent).name}.` : `${f.name} is back at the top.`);
      load();
    } catch (e) { status(msg(e), true); }
  }

  $('fAll').onclick = () => { S.unreadOnly = false; S.shown = 60; render(); };
  $('fUnread').onclick = () => { S.unreadOnly = true; S.shown = 60; render(); };
  S.freeOnly = store.get('freeOnly') === '1';
  $('fFree').onclick = () => { S.freeOnly = !S.freeOnly; store.set('freeOnly', S.freeOnly ? '1' : ''); S.shown = 60; render(); };
  let qt; $('q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); S.shown = 60; searchOlder(); renderList(); }, 150); });
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
    if (listOfFolder(f.id)) return listAction('listUnfollow', listOfFolder(f.id).url);
    const n = S.feeds.filter(x => x.folder_id === f.id).length, subs = subfoldersOf(f).length;
    showBanner(`<span>Delete the ${esc(f.name)} folder? ${n ? `Its ${n} ${n === 1 ? 'feed stays' : 'feeds stay'} in your reader, just outside any folder.` : 'It has no feeds in it.'}${subs ? ` The ${subs === 1 ? 'folder' : 'folders'} inside it move${subs === 1 ? 's' : ''} to the top.` : ''}</span><button class="btn danger" id="yesDel">Delete folder</button><button class="btn" id="noDel">Cancel</button>`, false, 'confirm');
    $('noDel').onclick = hideBanner;
    $('yesDel').onclick = async () => {
      hideBanner();
      try { await invoke('delete_folder', { id: f.id }); S.view = 'all'; status(`Deleted the ${f.name} folder.`); load(); }
      catch (e) { status(msg(e), true); }
    };
  }

  // followed lists
  async function listAction(what, url, btn) {
    const l = S.lists.find(x => x.url === url); if (!l) return;
    try {
      if (what === 'listCheck') {
        btn.disabled = true; btn.textContent = 'Checking…';
        const r = await invoke('list_check', { url });
        const bits = [];
        if (r.added) bits.push(`followed ${r.added} new ${r.added === 1 ? 'feed' : 'feeds'}`);
        if (r.pending) bits.push(`${r.pending} new ${r.pending === 1 ? 'feed is' : 'feeds are'} waiting for you`);
        if (r.left) bits.push(`${r.left} ${r.left === 1 ? 'feed' : 'feeds'} left the list`);
        status(bits.length ? `${l.title}: ${bits.join(', ')}.` : `${l.title} hasn’t changed.`);
      } else if (what === 'listKeep') {
        await invoke('list_keep', { url, feedUrl: btn.dataset.feedurl }); hideBanner(); status('Still following it.');
      } else if (what === 'listTake' || what === 'listSkip') {
        hideBanner();
        const n = await invoke('list_pending', { url, follow: what === 'listTake' });
        status(what === 'listTake' ? `Now following ${n} more from ${l.title}. Pulling their stories now.` : 'Okay. Those won’t be suggested again.');
      } else if (what === 'listCopy') {
        await navigator.clipboard.writeText(url); status('Copied the list’s address. Share it so others can follow the same list.');
      } else if (what === 'listUnfollow') {
        showBanner(`<span>Stop following the ${esc(l.title)} list? You can keep the feeds you got from it, or unfollow them too.</span><button class="btn" id="listStopKeep">Keep the feeds</button><button class="btn danger" id="listStopAll">Unfollow them too</button><button class="btn" id="listStopNo">Cancel</button>`, false, 'confirm');
        $('listStopNo').onclick = hideBanner;
        const stop = async all => {
          hideBanner();
          try {
            const n = await invoke('list_unfollow', { url, removeFeeds: all });
            status(all ? `Stopped following ${l.title} and unfollowed ${n} ${n === 1 ? 'feed' : 'feeds'}.` : `Stopped following ${l.title}. Its feeds stay in the ${l.title} folder.`);
            if (all && !S.feeds.some(f => f.folder_id === l.folder_id && !l.gone.includes(f.url))) S.view = 'all';
            load();
          } catch (e) { status(msg(e), true); }
        };
        $('listStopKeep').onclick = () => stop(false);
        $('listStopAll').onclick = () => stop(true);
        return;
      }
      load();
    } catch (e) { status(msg(e), true); load(); }
  }
  document.addEventListener('change', async e => {
    if (e.target.id !== 'listAuto') return;
    const on = e.target.checked, l = S.lists.find(x => x.url === e.target.dataset.list); if (!l) return;
    try { await invoke('list_set_auto', { url: l.url, on }); l.auto_add = on; status(on ? `Feeds that join ${l.title} will be followed for you.` : `New feeds in ${l.title} will wait for your OK.`); }
    catch (err) { e.target.checked = !on; status(msg(err), true); }
  });
  listen('list-news', e => {
    const p = e.payload || {}, bits = [];
    if (p.added) bits.push(`${p.added} new ${p.added === 1 ? 'feed' : 'feeds'} added`);
    if (p.pending) bits.push(`${p.pending} new ${p.pending === 1 ? 'feed is' : 'feeds are'} waiting for you`);
    if (p.left) bits.push(`${p.left} ${p.left === 1 ? 'feed' : 'feeds'} left the list`);
    if (bits.length) status(`${p.title}: ${bits.join(', ')}.`);
  });

  // new folder
  function openNewFolder() {
    $('folderForm').hidden = false; $('folderName').value = '';
    // inside which folder: the one you're looking at, if it's a top-level folder
    const here = folderOf(S.view) || (feedById(S.view) && folderById(feedById(S.view).folder_id));
    const top = here ? (isTopFolder(here) ? here : parentOf(here)) : null;
    const tops = S.folders.filter(isTopFolder);
    $('folderIn').innerHTML = `<option value="">At the top</option>` + tops.map(f => `<option value="${f.id}"${top && top.id === f.id ? ' selected' : ''}>Inside ${esc(f.name)}</option>`).join('');
    $('folderIn').hidden = !tops.length;
    $('folderName').focus();
  }
  $('newFolderBtn').onclick = () => $('folderForm').hidden ? openNewFolder() : ($('folderForm').hidden = true);
  $('folderName').onkeydown = e => { if (e.key === 'Escape') $('folderForm').hidden = true; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.id === 'topicQ' && (D.q || D.res)) { e.preventDefault(); e.stopPropagation(); clearTopic(); } }, true);
  document.addEventListener('input', e => { if (e.target.id === 'topicQ' && !e.target.value && (D.q || D.res)) clearTopic(); });
  document.addEventListener('submit', e => {
    if (e.target.id === 'addBookForm') { e.preventDefault(); addBook($('addBook').value); return; }
    if (e.target.id === 'addAbForm') { e.preventDefault(); addAudiobook($('addAb').value); return; }
    if (e.target.id !== 'topicForm') return;
    e.preventDefault(); topicSearch($('topicQ').value);
  });
  $('folderForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('folderName').value.trim(); if (!name) return;
    try {
      const inside = $('folderIn') && $('folderIn').value ? Number($('folderIn').value) : null;
      const id = await invoke('create_folder', { name, parent: inside });
      if (inside) collapsed.delete(inside);
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
  const FEED_NOTE = $('addNote').textContent;
  let addingList = false;
  let watching = false;
  function setWatchMode(on) {
    if (on) setListMode(false);
    watching = on;
    $('feedUrlLabel').textContent = on ? 'Address of the page to watch' : 'Feed or website address';
    $('feedUrl').placeholder = on ? 'example.com/jobs or a page that changes now and then' : 'A site, @someone@mastodon.social, a YouTube or podcast link';
    $('addBtn').textContent = on ? 'Watch page' : 'Add feed';
    $('watchMode').textContent = on ? 'Add a feed instead' : 'Watch a page that has no feed';
    $('addNote').className = 'note';
    $('addNote').textContent = on ? 'For pages without a feed: a club’s events, a shop’s new arrivals, a job board. Each time you refresh, the page is checked, and any change arrives as a story.' : FEED_NOTE;
  }
  function setListMode(on) {
    if (on && watching) setWatchMode(false);
    addingList = on;
    $('feedUrlLabel').textContent = on ? 'Address of the list (an OPML file)' : 'Feed or website address';
    $('feedUrl').placeholder = on ? 'example.com/blogroll.opml' : 'A site, @someone@mastodon.social, a YouTube or podcast link';
    $('feedName').hidden = on; $('feedFolder').hidden = on || !S.folders.length;
    $('addBtn').textContent = on ? 'Follow list' : 'Add feed';
    $('listMode').textContent = on ? 'Add a single feed instead' : 'Follow a list of feeds (OPML) instead';
    $('addNote').className = 'note';
    $('addNote').textContent = on ? 'Someone shares a list of feeds, like a blogroll or a club. Follow it once and you get every feed in it, in a folder of their own. When the list adds a feed later, it’s added for you.' : FEED_NOTE;
  }
  const looksLikeList = u => /\.opml(?:[?#]|$)/i.test(u.trim()) || /[?&/](?:format=)?opml\b/i.test(u.trim());
  $('listMode').onclick = () => { setListMode(!addingList); $('feedUrl').focus(); };
  $('watchMode').onclick = () => { setWatchMode(!watching); $('feedUrl').focus(); };
  async function watchPage(url) {
    const note = $('addNote'), btn = $('addBtn');
    btn.disabled = true; btn.textContent = 'Reading the page…'; note.className = 'note'; note.textContent = 'Checking that page…';
    try {
      const folderId = $('feedFolder').value ? Number($('feedFolder').value) : null;
      const r = await invoke('watch_page', { url, title: $('feedName').value.trim() || null, folderId });
      $('feedUrl').value = ''; $('feedName').value = ''; setWatchMode(false);
      note.textContent = `Watching ${r.title}. Changes arrive as stories when you refresh.`;
      await load(); selectView(String(r.id));
    } catch (err) { note.className = 'note err'; note.textContent = msg(err); }
    finally { btn.disabled = false; btn.textContent = watching ? 'Watch page' : 'Add feed'; }
  }
  function openAdd() { setWatchMode(false); setListMode(false); renderAddFolders(); $('addForm').hidden = false; $('showAdd').hidden = true; $('feedUrl').focus(); }
  $('showAdd').onclick = openAdd;
  $('cancelAdd').onclick = () => { $('addForm').hidden = true; $('showAdd').hidden = false; setListMode(false); };
  async function followList(url) {
    const note = $('addNote'), btn = $('addBtn');
    btn.disabled = true; btn.textContent = 'Reading the list…'; note.className = 'note'; note.textContent = 'Checking that list…';
    try {
      const r = await invoke('follow_list', { url });
      $('feedUrl').value = '';
      setListMode(false);
      note.textContent = `Now following ${r.title}: ${r.added === r.total ? `all ${r.total}` : `${r.added} new of ${r.total}`} ${r.total === 1 ? 'feed' : 'feeds'}.`;
      status(`Following the ${r.title} list. Pulling its stories now; new members will be added as they join.`);
      await load(); if (r.folderId) { collapsed.delete(r.folderId); selectView('folder:' + r.folderId); }
    } catch (err) { note.className = 'note err'; note.textContent = msg(err); }
    finally { btn.disabled = false; btn.textContent = addingList ? 'Follow list' : 'Add feed'; }
  }
  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (watching) return watchPage($('feedUrl').value.trim());
    if (addingList || looksLikeList($('feedUrl').value)) { if (!addingList) setListMode(true); return followList($('feedUrl').value.trim()); }
    const note = $('addNote'), btn = $('addBtn');
    btn.disabled = true; btn.textContent = 'Finding feed…'; note.className = 'note'; note.textContent = 'Checking that address…';
    try {
      const folderId = $('feedFolder').value ? Number($('feedFolder').value) : null;
      const r = await invoke('add_feed', { url: $('feedUrl').value.trim(), title: $('feedName').value.trim() || null, folderId });
      $('feedUrl').value = ''; $('feedName').value = '';
      note.textContent = `Now following ${r.title}.`;
      await load(); selectView(r.id);
    } catch (err) {
      note.className = 'note err'; note.textContent = msg(err);
      // a page with no feed: offer to watch it instead
      if (/doesn.t list an RSS/.test(msg(err))) {
        const w = document.createElement('button'); w.type = 'button'; w.className = 'linkish'; w.textContent = 'Watch this page for changes instead';
        w.onclick = () => { setWatchMode(true); watchPage($('feedUrl').value.trim()); };
        note.append(' ', w);
      }
    }
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

  // ---- The sidebar can fold down to its icons, for smaller screens. Kept per device: the MacBook can stay slim
  // while the iMac shows everything.
  function setSlim(on, chosen = true) {
    document.body.classList.toggle('rail-slim', on);
    $('railToggle').setAttribute('aria-pressed', String(on));
    $('railToggle').title = on ? 'Show the full sidebar (⌃⌘S)' : 'Show only icons (⌃⌘S)';
    $('railToggle').setAttribute('aria-label', on ? 'Show the full sidebar' : 'Show only icons in the sidebar');
    if (chosen) try { localStorage.setItem('railSlim', on ? '1' : ''); } catch {}
    if (typeof layoutBook === 'function' && S.view === 'books' && B.open) setTimeout(layoutBook, 220);
    try { renderRail(); } catch {} // folded groups open up in the icon-only sidebar
  }
  phoneSize.addEventListener('change', () => { try { renderRail(); } catch {} });
  // On an iPad the sidebar folds to icons in portrait and opens out in landscape, until you choose with the button
  const ipadPortrait = window.matchMedia('(min-width: 761px) and (max-width: 1100px) and (orientation: portrait)');
  let slimSaved = null; try { slimSaved = localStorage.getItem('railSlim'); } catch {}
  if (slimSaved !== null) { if (slimSaved && !isPhone()) setSlim(true, false); }
  else if (IOS && !isPhone()) setSlim(ipadPortrait.matches, false);
  ipadPortrait.addEventListener('change', () => {
    let saved = null; try { saved = localStorage.getItem('railSlim'); } catch {}
    if (IOS && saved === null && !isPhone()) setSlim(ipadPortrait.matches, false);
  });
  $('railToggle').onclick = () => setSlim(!document.body.classList.contains('rail-slim'));
  // folders show as lettered tiles; the feeds inside them come back with the full sidebar

  // keyboard (⌘R, ⌘N, ⇧⌘N, ⌘[ come from the app menu)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('settingsPanel').hidden) { closeSettings(); return; } if (!$('wxPanel').hidden) { $('wxPanel').hidden = true; return; } if (!$('voicePanel').hidden) { $('voicePanel').hidden = true; return; } if (!$('mutePanel').hidden) { $('mutePanel').hidden = true; return; } if (!$('syncPanel').hidden) { closeSync(); return; } if (hidePops()) return; if (S.readerId) { closeReader(); return; } }
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
    else if (cur && (e.key === 'Delete' || e.key === 'Backspace') && isEmailItem(item(cur) || {}) && !document.querySelector('.overlay:not([hidden])')) { e.preventDefault(); deleteMail(item(cur)); }
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
  // The app closed unexpectedly last time: say so, with the details to send along
  listen('last-crash', e => {
    const t = String(e.payload || '');
    showBanner(`<span>The Reading Room closed unexpectedly last time. If you send the details to the developer, it helps fix it.</span><button class="btn" id="crashCopy">Copy details</button><button class="btn" id="crashOk">OK</button>`, false, 'confirm');
    $('crashCopy').onclick = async () => { try { await navigator.clipboard.writeText(t); status('Details copied.'); } catch { status(t); } hideBanner(); };
    $('crashOk').onclick = hideBanner;
  });
  // "Follow site" in the web window: open Add a feed with that page's address, ready to go
  listen('web-follow', e => { const u = String(e.payload || ''); if (!isWeb(u)) return; openAdd(); $('feedUrl').value = u; $('addForm').requestSubmit(); });
  // "Open in The Reading Room" on a website (readingroom://subscribe?url=…) or a feed:// link: ask, then follow
  async function followFromLink() {
    const u = await invoke('take_open_link').catch(() => null);
    if (!u || !isWeb(u)) return;
    let host = u; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {}
    showBanner(`<span><b>Follow ${esc(host)}?</b> A link asked to add <code>${esc(u)}</code> to your feeds.</span><button class="btn primary" id="linkFollowYes">Follow</button><button class="btn" id="linkFollowNo">Not now</button>`, false, 'confirm');
    $('linkFollowYes').onclick = () => { hideBanner(); openAdd(); $('feedUrl').value = u; $('addForm').requestSubmit(); };
    $('linkFollowNo').onclick = hideBanner;
  }
  listen('link-follow', followFromLink);
  followFromLink();
  listen('menu-new-folder', openNewFolder);
  listen('menu-import', importOpml);
  listen('menu-export', exportOpml);
  listen('menu-back', () => closeReader());
  listen('menu-help', () => { closeReader(true); selectView('guide'); });
  // View › Bigger / Smaller / Actual Size text (⌘+ ⌘− ⌘0)
  const UI_STEPS = [0.92, 1, 1.1, 1.2, 1.3];
  const uiStep = d => { const i = UI_STEPS.indexOf(typePrefs.ui); typePrefs.ui = d === 0 ? 1 : UI_STEPS[Math.max(0, Math.min(UI_STEPS.length - 1, (i < 0 ? 1 : i) + d))]; applyType(); };
  listen('menu-slim', () => setSlim(!document.body.classList.contains('rail-slim')));
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


  // ------------------------------------------------------------ Your year in reading
  // Counted from the day this arrived: each story you open, per device (so Mac and iPhone add up when prefs sync).
  let statsTimer = 0;
  function countOpen(it) {
    const f = feedById(it.feed_id); if (!f || isJobItem(it)) return;
    const now = new Date(), y = String(now.getFullYear());
    const st = S.prefs.stats = { since: now.toISOString(), years: {}, ...(S.prefs.stats || {}) };
    st.years = { ...st.years };
    const mine = st.years[y] = { ...(st.years[y] || {}) };
    const d = mine[deviceId] = { stories: 0, feeds: {}, months: Array(12).fill(0), days: {}, ...(mine[deviceId] || {}) };
    d.stories++;
    d.feeds = { ...d.feeds, [f.url]: (d.feeds[f.url] || 0) + 1 };
    d.months = [...d.months]; d.months[now.getMonth()]++;
    d.days = { ...d.days, [dayKey(now).slice(5)]: 1 };
    st.last = { ...(st.last || {}), [f.url]: dayKey(now) };
    clearTimeout(statsTimer); statsTimer = setTimeout(savePrefs, 4000);
  }
  // Every device's counts for one year, added up
  function yearTotals(y) {
    const per = Object.values(((S.prefs.stats || {}).years || {})[y] || {});
    const t = { stories: 0, feeds: {}, months: Array(12).fill(0), days: new Set() };
    for (const d of per) {
      t.stories += d.stories || 0;
      for (const [u, n] of Object.entries(d.feeds || {})) t.feeds[u] = (t.feeds[u] || 0) + n;
      (d.months || []).forEach((n, i) => { t.months[i] += n || 0; });
      for (const k of Object.keys(d.days || {})) t.days.add(k);
    }
    // minutes come from the reading goal's log (only kept while a goal is set)
    for (const [k, v] of Object.entries(S.prefs.readLog || {})) if (k.startsWith(y)) {
      const m = Object.values(v).reduce((a, b) => a + b, 0) / 60;
      if (m >= 1) t.days.add(k.slice(5));
      t.mins = (t.mins || 0) + m;
    }
    return t;
  }
  function longestRun(days, y) {
    let best = 0, run = 0; const d = new Date(Number(y), 0, 1), end = new Date(Math.min(Date.now(), new Date(Number(y), 11, 31).getTime()));
    while (d <= end) { if (days.has(dayKey(d).slice(5))) { run++; best = Math.max(best, run); } else run = 0; d.setDate(d.getDate() + 1); }
    return best;
  }
  const nameOfUrl = u => S.feeds.find(f => f.url === u)?.title || (() => { try { return new URL(u.replace(/^watch:/, '')).hostname.replace(/^www\./, ''); } catch { return u; } })();
  function yearHtml(y) {
    const t = yearTotals(y), since = (S.prefs.stats || {}).since;
    const books = Object.values(S.prefs.finished || {}).filter(at => (at || '').startsWith(y)).length;
    const highlights = S.highlights.filter(h => (h.created_at || '').startsWith(y)).length;
    const ranked = Object.entries(t.feeds).sort((a, b) => b[1] - a[1]);
    const isP = u => { const f = S.feeds.find(x => x.url === u); return f ? kindOf(f) === 'person' : false; };
    const people = ranked.filter(([u]) => isP(u)).slice(0, 5), pubs = ranked.filter(([u]) => !isP(u)).slice(0, 3);
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const max = Math.max(...t.months), busiest = max ? MONTHS[t.months.indexOf(max)] : '';
    const hours = t.mins ? (t.mins >= 90 ? `${Math.round(t.mins / 60)} hours` : `${Math.round(t.mins)} minutes`) : '';
    const tile = (n, label) => `<div class="yr-tile"><b>${esc(String(n))}</b><span>${esc(label)}</span></div>`;
    const who = list => list.map(([u, n], i) => `<li><span class="yr-n">${i + 1}</span><span class="yr-who">${esc(nameOfUrl(u))}</span><span class="yr-c">${n} ${n === 1 ? 'story' : 'stories'}</span></li>`).join('');
    const years = Object.keys((S.prefs.stats || {}).years || {}).sort();
    if (!t.stories && !books && !t.mins) return `<h2>Your ${esc(y)} in reading</h2>
      <p>Nothing counted yet. From now on, every story you open counts toward your year: who you read most, your busiest month and your longest run of reading days. Come back in a few weeks.</p>
      <div class="row sheet-foot"><button class="btn primary" type="button" data-yr="done">Done</button></div>`;
    return `<h2>Your ${esc(y)} in reading</h2>
      ${years.length > 1 ? `<div class="yr-years">${years.map(x => `<button class="chip${x === y ? ' on' : ''}" type="button" data-yr-year="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
      <div class="yr-tiles">${tile(t.stories, t.stories === 1 ? 'story read' : 'stories read')}${books ? tile(books, books === 1 ? 'book finished' : 'books finished') : ''}${hours ? tile(hours.split(' ')[0], hours.split(' ')[1] + ' reading') : ''}${tile(longestRun(t.days, y), 'days in a row, your longest run')}</div>
      ${people.length ? `<h3 class="yr-h">The people you read most</h3><ol class="yr-list">${who(people)}</ol>` : ''}
      ${pubs.length ? `<h3 class="yr-h">Publications</h3><ol class="yr-list">${who(pubs)}</ol>` : ''}
      ${busiest ? `<h3 class="yr-h">Month by month</h3><div class="yr-bars" aria-label="Stories read each month">${t.months.map((n, i) => `<span title="${MONTHS[i]}: ${n}"><i style="height:${max ? Math.max(n ? 6 : 0, Math.round(100 * n / max)) : 0}%"></i><em>${MONTHS[i][0]}</em></span>`).join('')}</div>
        <p class="note">Your busiest month was ${esc(busiest)}${highlights ? `, and you highlighted ${highlights} ${highlights === 1 ? 'passage' : 'passages'} this year` : ''}.</p>` : ''}
      ${since && since.startsWith(y) ? `<p class="note">Counting began ${esc(new Date(since).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))}, when this feature arrived.</p>` : ''}
      <div class="row sheet-foot"><button class="btn primary" type="button" data-yr="done">Done</button></div>`;
  }
  function openYear(y = String(new Date().getFullYear())) {
    const el = sheet('yearPanel', yearHtml(y), 'Your year in reading');
    el.querySelector('.sheet').classList.add('yr');
    el.onclick = e => {
      if (e.target.closest('[data-yr="done"]')) el.hidden = true;
      const b = e.target.closest('[data-yr-year]'); if (b) openYear(b.dataset.yrYear);
    };
  }

  // ------------------------------------------------------------ Feed checkup
  function checkupHtml() {
    const now = Date.now(), st = S.prefs.stats || {}, since = st.since ? Date.parse(st.since) : now;
    const tracked = now - since > 30 * DAY;
    const feeds = S.feeds.filter(f => !isJobFeed(f));
    const broken = feeds.filter(f => f.status === 'error');
    const quiet = feeds.filter(f => f.status !== 'error' && f.status !== 'pending' && (!f.latest || now - Date.parse(f.latest) > 90 * DAY))
      .sort((a, b) => (a.latest || '').localeCompare(b.latest || ''));
    const opens = u => Object.values(st.years || {}).reduce((n, per) => n + Object.values(per).reduce((m, d) => m + ((d.feeds || {})[u] || 0), 0), 0);
    const unopened = tracked ? feeds.filter(f => f.status !== 'error' && f.recent >= 4 && !opens(f.url) && !quiet.includes(f)).sort((a, b) => b.recent - a.recent) : [];
    const row = (f, why) => `<li class="ck-row"><span class="fav" style="background:hsl(${hueFor(f.url)} 45% 42%)">${esc((f.title || '?').trim()[0] || '?')}</span>
      <span class="ck-body"><b>${esc(f.title)}</b><span>${esc(why)}</span></span>
      <span class="ck-acts"><button class="btn" type="button" data-ck="go" data-id="${f.id}">Open</button><button class="btn danger" type="button" data-ck="drop" data-id="${f.id}">Unfollow</button></span></li>`;
    const when = iso => { const d = Math.floor((now - Date.parse(iso)) / DAY); return d > 730 ? `${Math.round(d / 365)} years` : d > 60 ? `${Math.round(d / 30)} months` : `${d} days`; };
    const sec = (title, sub, list, why) => list.length ? `<h3 class="yr-h">${title} <span class="count">${list.length}</span></h3><p class="note">${sub}</p><ul class="ck-list">${list.map(f => row(f, why(f))).join('')}</ul>` : '';
    const body = sec('Not working', 'These couldn’t be read on the last refresh. A site may have moved its feed, or closed.', broken, f => f.error || 'Couldn’t be read')
      + sec('Gone quiet', 'Nothing new in three months or more. Some writers come back; some have moved on.', quiet, f => f.latest ? `Last story ${when(f.latest)} ago` : 'No stories yet')
      + sec('Never opened', 'Busy feeds you haven’t opened a story from since counting began. Fine if you skim the headlines; if not, they’re only noise.', unopened, f => `${f.recent} stories in the last 30 days, none opened`);
    return `<h2>Feed checkup</h2>
      <p>${feeds.length} feeds. ${broken.length + quiet.length + unopened.length ? 'A few worth a look:' : 'Everything is working and everyone is still writing.'}</p>
      ${body}${tracked ? '' : '<p class="note">“Never opened” appears after a month of counting which stories you open.</p>'}
      <div class="row sheet-foot"><button class="btn primary" type="button" data-ck="done">Done</button></div>`;
  }
  function openCheckup() {
    const el = sheet('checkupPanel', checkupHtml(), 'Feed checkup');
    el.onclick = async e => {
      const b = e.target.closest('[data-ck]'); if (!b) return;
      if (b.dataset.ck === 'done') { el.hidden = true; return; }
      const f = feedById(Number(b.dataset.id)); if (!f) return;
      if (b.dataset.ck === 'go') { el.hidden = true; selectView(String(f.id)); return; }
      if (b.dataset.ck === 'drop') {
        b.disabled = true;
        try { await invoke('remove_feed', { id: f.id }); status(`Unfollowed ${f.title}.`); await load(); openCheckup(); }
        catch (err) { status(msg(err), true); b.disabled = false; }
      }
    };
  }

  // ------------------------------------------------------------ Rules and keyword alerts
  // A rule: words (any of them, in the title or the summary), optionally one feed, and what to do.
  // Rules act on stories as they arrive, never on ones already here.
  const RULE_ACTS = { alert: 'Let me know', save: 'Save to Read later', read: 'Mark read (skip it)' };
  const rules = () => (S.prefs.rules || []).filter(r => r && (r.words || r.feed));
  function ruleRe(words) {
    const parts = String(words || '').split(',').map(w => w.trim()).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return parts.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${parts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu') : null;
  }
  function ruleMatches(r, it) {
    if (r.feed) { const f = feedById(it.feed_id); if (!f || f.url !== r.feed) return false; }
    const re = ruleRe(r.words);
    return re ? re.test(`${it.title || ''} ${it.summary || ''}`) : !!r.feed;
  }
  let seenIds = null;
  function processNew() {
    if (!seenIds) { try { const raw = store.get('rulesSeen'); seenIds = raw ? new Set(JSON.parse(raw)) : null; } catch { seenIds = null; } }
    const first = !seenIds; if (first) seenIds = new Set();
    const fresh = S.items.filter(i => !seenIds.has(i.id));
    fresh.forEach(i => seenIds.add(i.id));
    if (fresh.length || first) {
      const keep = [...seenIds]; store.set('rulesSeen', JSON.stringify(keep.slice(-4000))); if (keep.length > 4000) seenIds = new Set(keep.slice(-4000));
    }
    if (!first && fresh.length) { friendAlerts(fresh); youAlerts(); }
    const rs = rules(); if (first || !rs.length || !fresh.length) return;
    const read = [], save = [], alerts = new Map();
    for (const it of fresh) {
      if (it.read || isJobItem(it)) continue;
      for (const r of rs) {
        if (!ruleMatches(r, it)) continue;
        if (r.act === 'read') read.push(it.id);
        else if (r.act === 'save') { if (!it.saved) save.push(it.id); }
        else { const k = r.words || nameOfUrl(r.feed); alerts.set(k, [...(alerts.get(k) || []), it]); }
      }
    }
    if (save.length) mark([...new Set(save)], { saved: true });
    if (read.length) mark([...new Set(read)], { read: true });
    for (const [k, list] of alerts) {
      const one = list[0], f = feedById(one.feed_id);
      const title = list.length === 1 ? `${f?.title || 'New story'}: “${k}”` : `${list.length} new stories mention “${k}”`;
      const body = list.length === 1 ? headline(one) : list.slice(0, 3).map(headline).join(' · ');
      invoke('notify', { title, body, id: 'alert-' + one.id }).catch(() => {});
      if (document.hasFocus()) status(`${title}. ${body}`);
    }
  }
  function rulesHtml() {
    const list = S.prefs.rules || [];
    const feedOpts = sel => `<option value="">Any feed</option>` + S.feeds.filter(f => !isJobFeed(f)).map(f => `<option value="${esc(f.url)}"${f.url === sel ? ' selected' : ''}>${esc(f.title)}</option>`).join('');
    const actOpts = sel => Object.entries(RULE_ACTS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
    const row = (r, i) => `<li class="rule" data-i="${i}">
        <label>When a story mentions<input type="text" data-k="words" value="${esc(r.words || '')}" placeholder="words, separated by commas" autocomplete="off" spellcheck="false"></label>
        <label>in<select data-k="feed">${feedOpts(r.feed)}</select></label>
        <label>then<select data-k="act">${actOpts(r.act || 'alert')}</select></label>
        <button class="icon" type="button" data-rule="del" aria-label="Delete this rule" title="Delete this rule">×</button></li>`;
    return `<h2>Rules &amp; alerts</h2>
      <p>Rules act on new stories as they arrive. An alert is a notification on this device; it’s how you hear the moment someone writes about your town, your company or a book you love.</p>
      <ul class="rules">${list.map(row).join('') || '<li class="note">No rules yet.</li>'}</ul>
      <div class="row"><button class="btn" type="button" data-rule="add">+ Add a rule</button><button class="btn" type="button" data-rule="test">Try them on today’s stories</button></div>
      <p class="note" id="ruleNote">To hide stories that mention a word, use Muted words. Rules save as you type and sync with your other devices.</p>
      <div class="row sheet-foot"><button class="btn primary" type="button" data-rule="done">Done</button></div>`;
  }
  let rulesSave = 0;
  function openRules() {
    const el = sheet('rulesPanel', rulesHtml(), 'Rules and alerts');
    el.querySelector('.sheet').classList.add('wide-sheet');
    const persist = () => { clearTimeout(rulesSave); rulesSave = setTimeout(savePrefs, 600); };
    el.oninput = el.onchange = e => {
      const li = e.target.closest('.rule'), k = e.target.dataset.k; if (!li || !k) return;
      const list = [...(S.prefs.rules || [])], i = Number(li.dataset.i);
      list[i] = { ...list[i], [k]: e.target.value }; S.prefs.rules = list; persist();
    };
    el.onclick = e => {
      const b = e.target.closest('[data-rule]'); if (!b) return;
      const k = b.dataset.rule;
      if (k === 'done') { el.hidden = true; savePrefs(); return; }
      if (k === 'add') {
        S.prefs.rules = [...(S.prefs.rules || []), { words: '', feed: '', act: 'alert' }]; persist(); openRules();
        const ins = $('rulesPanel').querySelectorAll('.rule input'); ins[ins.length - 1]?.focus();
        if (!store.get('alertsAsked')) { store.set('alertsAsked', '1'); invoke('notify', { title: 'Alerts are on', body: 'You’ll see a notification like this when a new story matches a rule.', id: 'alerts-hello' }).catch(() => {}); }
      }
      if (k === 'del') { const list = [...(S.prefs.rules || [])]; list.splice(Number(b.closest('.rule').dataset.i), 1); S.prefs.rules = list; persist(); openRules(); }
      if (k === 'test') {
        const rs = rules(), hits = S.items.filter(i => isToday(i) && rs.some(r => ruleMatches(r, i)));
        $('ruleNote').textContent = rs.length ? (hits.length ? `${hits.length} of today’s stories match: ${hits.slice(0, 3).map(headline).join(' · ')}${hits.length > 3 ? ' …' : ''}` : 'None of today’s stories match. New ones will be checked as they arrive.') : 'Add a rule first.';
      }
    };
  }

  // ------------------------------------------------------------ Search everything (stories the app has let go too)
  const OLD = { q: '', rows: [], busy: false };
  let olderTimer = 0;
  function searchOlder() {
    clearTimeout(olderTimer);
    const q = S.q;
    if (!q || q.length < 3) { OLD.q = ''; OLD.rows = []; return; }
    olderTimer = setTimeout(async () => {
      OLD.busy = true;
      try { const rows = await invoke('search_all', { q, limit: 80 }); if (S.q === q) { OLD.q = q; OLD.rows = rows; renderList(); } }
      catch { /* the list above still works */ }
      finally { OLD.busy = false; }
    }, 250);
  }
  function olderHtml(shownIds) {
    if (!S.q || OLD.q !== S.q) return '';
    const rows = OLD.rows.filter(r => !shownIds.has(r.id)).slice(0, 40);
    if (!rows.length) return '';
    return `<section class="older"><h3>Older stories <span class="count">${rows.length}</span></h3>
      <p class="note">From everything you’ve followed, including stories this view doesn’t show or the app has let go.</p>
      ${rows.map(r => `<button class="older-row" type="button" data-older="${esc(r.id)}" data-url="${esc(r.link)}">
        <span class="o-t">${esc(r.title)}</span><span class="o-m">${esc(r.feed || nameOfUrl(r.link))} · ${esc(new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</span></button>`).join('')}
    </section>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-older]'); if (!b) return;
    if (item(b.dataset.older)) openReader(b.dataset.older); else openWeb(b.dataset.url);
  });

  // ------------------------------------------------------------ The Morning Edition
  // Yesterday's reading laid out as a newspaper front page: the people you read up top, the newsroom in a column,
  // the rest in brief by folder. Made once a morning (6 a.m.); stories after that wait for tomorrow's paper.
  function editionWindow() {
    const end = new Date(); if (end.getHours() < 6) end.setDate(end.getDate() - 1); end.setHours(6, 0, 0, 0);
    let start = end.getTime() - DAY, stop = end.getTime();
    const ok = i => !isJobItem(i) && !isEmailItem(i) && !(mutesApply('all') && isMuted(i)) && !isFolded(i, 'all');
    let list = S.items.filter(i => ok(i) && Date.parse(i.date) >= start && Date.parse(i.date) < stop);
    if (list.length < 6) {
      // a thin night (or the app was closed): the latest day of stories instead
      const newest = Math.max(0, ...S.items.filter(ok).map(i => Date.parse(i.date) || 0));
      stop = Math.max(Date.now(), newest + 1); start = Math.min(stop, newest + 1) - DAY;
      list = S.items.filter(i => ok(i) && Date.parse(i.date) >= start);
    }
    return { end, list: list.sort((a, b) => b.date.localeCompare(a.date)) };
  }
  function editionHtml() {
    const { end, list } = editionWindow();
    const date = end.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const head = `<header class="ed-mast"><div class="ed-rule"><span>${esc(date)}</span><span>Written by people</span></div>
      <h1>The Reading Room</h1><div class="ed-rule"><span>${list.length} ${list.length === 1 ? 'story' : 'stories'} from ${new Set(list.map(i => i.feed_id)).size} feeds</span>
      <span class="ed-tools"><button class="linkish" type="button" data-ed="print">Print</button><button class="linkish" type="button" data-ed="read">Mark the edition read</button></span></div></header>`;
    if (!list.length) return `<div class="edition">${head}<div class="empty"><strong>No paper today</strong><span>Nothing new arrived overnight. Press Refresh, or come back tomorrow morning.</span></div></div>`;
    const used = new Set(), byFeed = new Set();
    const take = (pred, n, oneEach = true) => {
      const out = [];
      for (const i of list) {
        if (out.length >= n) break;
        if (used.has(i.id) || (oneEach && byFeed.has(i.feed_id)) || !pred(i)) continue;
        out.push(i); used.add(i.id); byFeed.add(i.feed_id);
      }
      return out;
    };
    const person = i => isPerson(i.feed_id), score = i => (isWeb(i.image) ? 2 : 0) + Math.min((i.summary || '').length / 200, 2);
    const leadPick = [...list].filter(person).sort((a, b) => score(b) - score(a))[0] || [...list].sort((a, b) => score(b) - score(a))[0];
    used.add(leadPick.id); byFeed.add(leadPick.feed_id);
    // the seconds and the newsroom prefer stories with pictures, so the page isn't a wall of text
    const withPic = i => isWeb(i.image);
    const seconds = take(i => person(i) && withPic(i), 2); seconds.push(...take(person, 2 - seconds.length));
    const news = take(i => !person(i), 6);
    const by = i => esc(srcLabel(i));
    const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; };
    const tileOf = i => tileFor(feedById(i.feed_id) || (srcLabel(i) ? { url: srcLabel(i), title: srcLabel(i) } : null));
    const hueOf = i => tileOf(i).split('|')[0];
    // a picture, or the feed's coloured letter tile when there isn't one (a broken picture turns into the tile too)
    const pic = (i, cls) => {
      const [h, letter] = tileOf(i).split('|');
      return isWeb(i.image) ? `<img class="ed-pic ${cls}" src="${esc(i.image)}" alt="" referrerpolicy="no-referrer" loading="lazy" data-tile="${esc(h + '|' + letter)}">`
        : `<span class="ed-pic ed-tile ${cls}" style="--h:${h}" aria-hidden="true"><span>${esc(letter.toUpperCase())}</span></span>`;
    };
    const dot = i => `<i class="ed-dot" style="--h:${hueOf(i)}"></i>`;
    const story = (i, cls, n) => `<article class="${cls}${i.read ? ' read' : ''}" data-ed-open="${esc(i.id)}">
        ${cls === 'ed-lead' ? (isWeb(i.image) ? pic(i, 'ed-hero') : '') : cls === 'ed-second' ? (isWeb(i.image) ? pic(i, 'ed-wide') : '') : cls === 'ed-item' ? pic(i, 'ed-sq') : ''}
        <div class="ed-txt"><p class="ed-by">${dot(i)}${by(i)}</p><h2>${esc(headline(i))}</h2>${n ? `<p class="ed-sum">${esc(clip(i.summary, n))}</p>` : ''}</div></article>`;
    // the people in today's paper, as a row of faces (their first letter, in their feed's colour)
    const folks = [];
    for (const i of list) if (person(i) && !folks.some(x => x.feed_id === i.feed_id)) folks.push(i);
    const faces = folks.length > 1 ? `<nav class="ed-faces" aria-label="People in this edition"><span class="ed-faces-k">In this edition</span>
      ${folks.slice(0, 12).map(i => { const [h, l] = tileOf(i).split('|'); return `<button type="button" class="ed-face" data-ed-open="${esc(i.id)}" title="${by(i)}: ${esc(headline(i))}"><span style="--h:${h}">${esc(l.toUpperCase())}</span><b>${by(i)}</b></button>`; }).join('')}
      ${folks.length > 12 ? `<span class="ed-more">+${folks.length - 12} more</span>` : ''}</nav>` : '';
    // In pictures: up to four more stories that came with a photo
    const shots = take(withPic, 4);
    const pictures = shots.length >= 2 ? `<section class="ed-pics"><h3 class="ed-kicker">In pictures</h3><div class="ed-pgrid">
      ${shots.map(i => `<figure class="${i.read ? 'read' : ''}" data-ed-open="${esc(i.id)}">${pic(i, 'ed-shot')}<figcaption><b>${esc(headline(i))}</b><span>${by(i)}</span></figcaption></figure>`).join('')}</div></section>` : '';
    if (shots.length < 2) shots.forEach(i => used.delete(i.id));
    // the rest, in brief, by folder
    const rest = list.filter(i => !used.has(i.id));
    const groups = new Map();
    for (const i of rest) { const f = feedById(i.feed_id), g = (f && folderById(f.folder_id)?.name) || (person(i) ? 'People' : 'Elsewhere'); groups.set(g, [...(groups.get(g) || []), i]); }
    const brief = [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([g, items]) => `<section class="ed-brief" style="--h:${hueFor(g)}"><h3><span>${esc(g)}</span><em>${items.length}</em></h3>
      ${items.slice(0, 5).map(i => `<p data-ed-open="${esc(i.id)}"${i.read ? ' class="read"' : ''}>${dot(i)}<b>${esc(headline(i))}</b> <span>${by(i)}</span></p>`).join('')}
      ${items.length > 5 ? `<p class="ed-more">and ${items.length - 5} more</p>` : ''}</section>`).join('');
    const cur = currentBook(), b = cur && bookOf(cur), jobs = newJobs();
    const boxes = [
      b ? `<div class="ed-box ed-box-book" data-ed="book"><h4>Your book</h4><p><b>${esc(b.title)}</b> by ${esc(b.author)}</p><p class="ed-more">Pick up where you left off →</p></div>` : '',
      goalOn() ? `<div class="ed-box ed-box-goal"><h4>Your reading</h4><p class="ed-big">${streak()}</p><p>${streak() === 1 ? 'day' : 'days'} in a row · goal ${goalCfg().mins} minutes a day</p></div>` : '',
      jobs ? `<div class="ed-box ed-box-jobs" data-ed="jobs"><h4>Help Wanted</h4><p class="ed-big">${jobs}</p><p>new ${jobs === 1 ? 'listing' : 'listings'} →</p></div>` : '',
    ].join('');
    return `<div class="edition">${head}${faces}
      <div class="ed-front">
        <div class="ed-main">${story(leadPick, `ed-lead${isWeb(leadPick.image) ? '' : ' no-pic'}`, 420)}
          ${seconds.length ? `<div class="ed-seconds">${seconds.map(i => story(i, 'ed-second', 200)).join('')}</div>` : ''}</div>
        ${news.length ? `<aside class="ed-news"><h3>From the newsroom</h3>${news.map(i => story(i, 'ed-item', 0)).join('')}</aside>` : ''}
      </div>
      ${pictures}
      ${brief || boxes ? `<div class="ed-lower"><div class="ed-briefs"><h3 class="ed-kicker">In brief</h3><div class="ed-bcols">${brief}</div></div>${boxes ? `<aside class="ed-boxes">${boxes}</aside>` : ''}</div>` : ''}
    </div>`;
  }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-ed-open]'); if (o) { openReader(o.dataset.edOpen); return; }
    const b = e.target.closest('[data-ed]'); if (!b) return;
    if (b.dataset.ed === 'print') invoke('print_page').catch(() => window.print());
    if (b.dataset.ed === 'read') { const ids = editionWindow().list.filter(i => !i.read).map(i => i.id); if (ids.length) { mark(ids, { read: true }); status(`Marked ${ids.length} ${ids.length === 1 ? 'story' : 'stories'} read.`); } }
    if (b.dataset.ed === 'book') selectView('books');
    if (b.dataset.ed === 'jobs') selectView('jobs');
  });

  // ------------------------------------------------------------ Newsletters in your reader
  // A private address from Kill the Newsletter: subscribe with it, and each issue arrives as a story.
  // New newsletter feeds go in a "Newsletters" folder unless you pick another (the folder is made the first time)
  const nlFolder = () => S.folders.find(f => f.name.trim().toLowerCase() === 'newsletters');
  function nlFolderOptions() {
    const nf = nlFolder(), last = S.prefs.nlFolder; // last choice: a folder id, '' for none, or undefined
    const pick = last === '' ? '' : last != null && folderById(Number(last)) ? Number(last) : nf ? nf.id : 'new';
    return (nf ? '' : `<option value="new"${pick === 'new' ? ' selected' : ''}>Newsletters (new folder)</option>`) + folderOptions(pick === 'new' ? undefined : pick)
      .replace('<option value="">No folder</option>', `<option value=""${pick === '' ? ' selected' : ''}>No folder</option>`);
  }
  function newslettersHtml(fresh) {
    const list = S.prefs.newsletters || [];
    const row = n => `<li class="nl-row${fresh && n.email === fresh ? ' fresh' : ''}"><span class="ck-body"><b>${esc(n.title)}</b><span class="nl-mail">${esc(n.email)}</span></span>
      <span class="ck-acts"><button class="btn${fresh && n.email === fresh ? ' primary' : ''}" type="button" data-nl="copy" data-mail="${esc(n.email)}">Copy address</button><button class="btn danger" type="button" data-nl="remove" data-mail="${esc(n.email)}">Remove</button></span></li>`;
    return `<h2>Newsletters</h2>
      <p>Read newsletters here instead of in your inbox. Make an address, subscribe to newsletters with it, and each issue arrives as a story in its own feed.</p>
      ${list.length ? `<ul class="ck-list nl-list">${list.map(row).join('')}</ul>` : ''}
      <form class="nl-new" id="nlForm"><label for="nlName">${list.length ? 'Another address' : 'Name this address'}</label>
        <div class="row"><input id="nlName" type="text" maxlength="80" placeholder="e.g. Newsletters, or one newsletter’s name" autocomplete="off"><button class="btn primary" type="submit" id="nlMake">Make an address</button></div>
        <div class="row nl-folder"><label for="nlFolder">Put its feed in</label><select id="nlFolder">${nlFolderOptions()}</select></div></form>
      <p class="note" id="nlNote">One address can take many newsletters; they’ll share one feed. Make one per newsletter if you’d like them apart. The addresses come from Kill the Newsletter, a free, open-source service: anyone with an address can send to it, so use it only for newsletters. To stop one, unsubscribe from the newsletter, then Remove the address here.</p>
      <div class="row sheet-foot"><button class="btn primary" type="button" data-nl="done">Done</button></div>`;
  }
  function openNewsletters(fresh) {
    const el = sheet('nlPanel', newslettersHtml(fresh), 'Newsletters');
    const note = (t, err) => { $('nlNote').textContent = t; $('nlNote').classList.toggle('err', !!err); };
    el.onclick = async e => {
      const b = e.target.closest('[data-nl]'); if (!b) return;
      if (b.dataset.nl === 'done') { el.hidden = true; return; }
      if (b.dataset.nl === 'copy') {
        try { await navigator.clipboard.writeText(b.dataset.mail); b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy address'; }, 2000); }
        catch { note(`Couldn’t copy. The address is ${b.dataset.mail}`, true); }
      }
      if (b.dataset.nl === 'remove') {
        // Ask once more on the button itself, then unfollow the address's feed and drop it from the list
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Remove and unfollow?'; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = 'Remove'; } }, 4000); return; }
        const n = (S.prefs.newsletters || []).find(x => x.email === b.dataset.mail); if (!n) return;
        const f = S.feeds.find(x => x.url === n.feed);
        try { if (f) await invoke('remove_feed', { id: f.id }); } catch (err) { note(msg(err), true); return; }
        S.prefs.newsletters = (S.prefs.newsletters || []).filter(x => x.email !== n.email);
        await savePrefs(); await load();
        openNewsletters();
        note(`Removed ${n.email}${f ? ` and unfollowed “${f.title}”` : ''}. Anything still sent to it won’t reach you, so unsubscribe from its newsletters if you haven’t.`);
      }
    };
    $('nlForm').onsubmit = async e => {
      e.preventDefault();
      const title = $('nlName').value.trim() || 'Newsletters', btn = $('nlMake');
      btn.disabled = true; btn.textContent = 'Making…'; note('');
      try {
        const n = await invoke('newsletter_address', { title });
        const choice = $('nlFolder').value;
        let folderId = choice === 'new' ? nlFolder()?.id ?? null : choice ? Number(choice) : null;
        if (choice === 'new' && folderId == null) {
          // First time: make the folder and move in the newsletter feeds you already have that aren't in a folder
          folderId = await invoke('create_folder', { name: 'Newsletters' }).catch(() => null);
          if (folderId != null) for (const old of S.prefs.newsletters || []) {
            const f = S.feeds.find(x => x.url === old.feed && !x.folder_id);
            if (f) await invoke('set_feed_folder', { feedId: f.id, folderId }).catch(() => {});
          }
        }
        S.prefs.nlFolder = choice === 'new' ? (folderId ?? undefined) : choice === '' ? '' : folderId;
        const r = await invoke('add_feed', { url: n.feed, title, folderId }).catch(() => null);
        await load();
        S.prefs.newsletters = [...(S.prefs.newsletters || []), { title, email: n.email, feed: n.feed, at: new Date().toISOString(), added: !!r }];
        await savePrefs();
        openNewsletters(n.email);
        $('nlNote').textContent = r ? `Your address is ready, and its feed “${title}” is in your feeds${folderId != null && folderById(folderId) ? ` under ${folderById(folderId).name}` : ''}. Copy the address and use it to sign up for newsletters. The welcome email may take a minute to show up after a refresh.` : 'Your address is ready. Its feed couldn’t be added just now; it will be added next time you open this.';
      } catch (err) { note(msg(err), true); btn.disabled = false; btn.textContent = 'Make an address'; }
    };
    // a feed that didn't get added the first time (only those: a feed you unfollowed stays unfollowed)
    for (const n of S.prefs.newsletters || []) if (n.added === false && !S.feeds.some(f => f.url === n.feed))
      invoke('add_feed', { url: n.feed, title: n.title, folderId: null }).then(async () => { n.added = true; await savePrefs(); load(); }).catch(() => {});
  }
  $('nlMode').onclick = () => { $('addForm').hidden = true; $('showAdd').hidden = false; openNewsletters(); };

  // ------------------------------------------------------------ Share menu and Home Screen widgets (iPhone and iPad)
  const onIOS = () => true; // iPhone, iPad and the Mac (elsewhere the app's side does nothing)
  async function takeShared() {
    if (!onIOS()) return;
    try {
      const n = await invoke('share_inbox');
      if (n) { status(`Saved ${n} ${n === 1 ? 'page' : 'pages'} from the Share menu to Read later.`); load(); }
    } catch { /* nothing waiting */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) takeShared(); });
  setTimeout(takeShared, 1500);
  let widgetTimer = 0, widgetLast = '';
  function updateWidget() {
    if (!onIOS()) return;
    clearTimeout(widgetTimer);
    widgetTimer = setTimeout(() => {
      const fresh = S.items.filter(i => !i.read && inScope(i, 'today') && !(mutesApply('today') && isMuted(i)) && !isFolded(i, 'today'))
        .sort((a, b) => (isPerson(b.feed_id) - isPerson(a.feed_id)) || b.date.localeCompare(a.date));
      const data = JSON.stringify({ unread: fresh.length, stories: fresh.slice(0, 6).map(i => ({ t: headline(i), f: srcLabel(i), p: isPerson(i.feed_id) })),
        streak: goalOn() ? streak() : null, books: finishedThisYear(), goal: goalOn() ? goalCfg().mins : null });
      if (data === widgetLast) return;
      widgetLast = data; invoke('widget_data', { json: data }).catch(() => {});
    }, 1500);
  }

  $('rulesBtn').onclick = openRules;
  $('checkupBtn').onclick = openCheckup;
  $('yearBtn').onclick = () => openYear();

  // A thin line under the top bar once stories are scrolling beneath it.
  const scrollerOf = () => (isSplit() ? $('listView') : $('main'));
  const markStuck = () => $('listTop').classList.toggle('stuck', scrollerOf().scrollTop > 4);
  $('main').addEventListener('scroll', markStuck, { passive: true });
  $('listView').addEventListener('scroll', markStuck, { passive: true });
  load();
})();
