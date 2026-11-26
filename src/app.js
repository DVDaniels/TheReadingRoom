// The Reading Room — the window's behaviour. Talks to the Rust side through Tauri commands.
(() => {
  const { invoke: tauriInvoke } = window.__TAURI__.core;
  // Posting to your own site is part of The Reading Room Plus: site_note (Notes, reposts, replies, Weeknotes, What I read),
  // site_post and site_post_publish (full posts from Writing)
  // and liking (taking a like back stays free). Everything else goes straight through.
  const invoke = (cmd, args) => (cmd === 'site_note' || cmd === 'site_post' || cmd === 'site_post_publish' || cmd === 'tumblr_write' || cmd === 'tumblr_post' || cmd === 'tumblr_publish' || (cmd === 'site_like' && args?.on !== false)) && !plusOk() ? plusBlocked(cmd) : tauriInvoke(cmd, args);
  const { listen } = window.__TAURI__.event;

  const $ = id => document.getElementById(id);
  // view: 'today' | 'all' | 'saved' | 'annotated' | 'recent' | 'folder:<id>' | <feed id number>
  const S = { prefs: {}, kinds: new Map(), folders: [], feeds: [], items: [], highlights: [], mutes: [], lists: [], also: new Map(), hiddenMuted: 0, readerId: null, view: 'today', unreadOnly: true, keep: new Set(), selId: null, q: '', shown: 60, refreshing: false, lastRefresh: null };
  // Mastodon and Bluesky (see that section)
  const SOC = { accounts: {}, conv: null, loading: false, open: new Set(), threads: new Map(), whole: new Map(), rootOf: new Map(), wideOpen: new Set(), err: [], tab: 'blogs', profiles: null, followers: null, shared: null, mentions: null, readers: null, theirBlogs: null };
  const NET = { bluesky: 'Bluesky', mastodon: 'Mastodon', tumblr: 'Tumblr' };
  // Where your own posts go: a WordPress site, or a Tumblr blog when no WordPress site is connected (David, Nov 25)
  // …or a Micro.blog, Pika or other IndieWeb site, through Micropub (David, Nov 25)
  const onTumblr = () => SOC.accounts?.site?.kind === 'tumblr';
  const onWp = () => SOC.accounts?.site?.kind === 'wordpress';
  const siteApp = () => { const s = SOC.accounts?.site; if (!s || s.kind === 'wordpress') return 'WordPress'; if (s.kind === 'tumblr') return 'Tumblr';
    const h = s.service || ''; return /micro\.blog$/.test(h) ? 'Micro.blog' : /pika\.page$/.test(h) ? 'Pika' : 'your site’s own editor'; };
  // Copies of what you post at home: Bluesky and Mastodon (Tumblr is a "Post to" choice instead, below)
  const copyNets = () => ['bluesky', 'mastodon'].filter(n => SOC.accounts[n]);
  // Post to: your site, Tumblr or both, when Tumblr is connected beside a WordPress or Micropub site (David, Nov 25:
  // "can I just post to tumblr?"). Remembered; Both sends Tumblr the full post, not a copy that links home.
  const postToChoice = () => !!(SOC.accounts?.tumblr && SOC.accounts?.site && !onTumblr());
  // Since the Tumblr tab (David, Nov 26) Writing posts to your site, and "Also post to Tumblr" sends the full post there too.
  const postTo = () => postToChoice() && store.get('postTo') === 'both' ? 'both' : 'site';
  const postToHtml = attr => {
    const host = (SOC.accounts.site?.site || '').replace(/^https?:\/\//, '').replace(/\/$/, ''), on = postTo() === 'both';
    return `<div class="post-to pt-also"><button type="button" class="pt-box" ${attr}="${on ? 'site' : 'both'}" aria-pressed="${on}"><span class="pt-tick" aria-hidden="true">${on ? '✓' : ''}</span>Also post to Tumblr</button>
      <span class="pt-n">${on ? `The full post goes on ${esc(host)} and on your Tumblr (${esc(SOC.accounts.tumblr.blog)}).` : `Only on ${esc(host)}.`}</span></div>`;
  };
  const anySocial = () => !!(SOC.accounts.bluesky || SOC.accounts.mastodon);
  const socialSeen = () => { try { return Number(localStorage.getItem('socialSeen')) || 0; } catch { return 0; } };
  const newReplies = () => (SOC.conv?.replies || []).filter(r => Date.parse(r.created_at) > socialSeen()).length;
  // Discover's results (see the Discover section)
  const D = { report: null, running: false, done: 0, total: 0, open: new Set(), busy: new Set(), q: '', searching: false, res: null, added: new Map(), imgs: new Map(), small: null, smallErr: '', smallMore: false };
  const ICONS = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>',
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
    myday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    later: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    recent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    videos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></svg>',
    tumblr: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.6 21c-3 0-5.2-1.5-5.2-5.2V9.9H6.7V6.7c3-.8 4.3-3.4 4.4-5.7h3.1v5.1h3.6v3.8h-3.6v5.2c0 1.6.8 2.1 2 2.1h1.7V21h-3.3z"/></svg>',
    wordpress: '<svg viewBox="0 0 24 24" fill="none" stroke="#21759B" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M5.6 8.4h2.6M7 8.4l3.1 9 2-5.6M10.4 8.4h2.4M11.6 8.4l3.2 9 2.4-7.3c.4-1.1.1-1.7-.6-1.9"/></svg>', // the WordPress tab: WordPress's W, in WordPress blue (David, Nov 26)
    write: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
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
  let APP = { platform: '', version: '' };
  invoke('app_info').then(info => { APP = info; IOS = info.platform === 'ios'; applyPlatform(); render(); }).catch(() => {});

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
  const MAIL = { account: null, checking: false, last: 0, error: '', meta: {}, threads: new Map(), olderLeft: null, olderBusy: false, showPics: new Set() };
  // Videos: YouTube and Vimeo videos and video files, in a tab of their own (Settings can hide it; then they stay in Today)
  const isVideoItem = i => !!(ytId(i.link) || isVideoFile(i.audio) || /^https?:\/\/(www\.)?vimeo\.com\/\d+/.test(i.link || ''));
  const videosOn = () => !hiddenViews().has('videos');
  function inScope(i, view = S.view) {
    if (view === 'email') return isEmailItem(i);
    if ((view === 'all' || view === 'today' || view === 'people') && isEmailItem(i)) return false; // your mail stays in Email
    if (view === 'jobs') return isJobItem(i);
    if ((view === 'all' || view === 'today' || view === 'people') && isJobItem(i)) return false;
    if (view === 'videos') return isVideoItem(i);
    if ((view === 'today' || view === 'people') && videosOn() && isVideoItem(i)) return false; // videos have their own tab
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
  // (Email's Sent, Archive, Trash and Spam always show everything: their emails come in read)
  const usesUnreadFilter = () => !['saved', 'recent', 'annotated', 'discover', 'guide', 'talk', 'jobs', 'books', 'edition', 'myday', 'write', 'site', 'tumblr'].includes(S.view) && !(S.view === 'email' && typeof mailFolder === 'function' && mailFolder() !== 'inbox');
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
      .filter(site => !(PL[site]?.at > weekAgo && 'about' in PL[site])); // (icon: looked for since 1.2.4; about: since 1.2.5)
    if (!sites.length) return;
    scanningSites = true;
    try {
      const res = await invoke('site_accounts', { sites });
      for (const r of res) PL[r.site] = { at: Date.now(), links: r.links, icon: r.icon || '', about: r.about || '' };
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
    if (S.freeOnly && usesUnreadFilter() && S.view !== 'email' && S.view !== 'videos') list = list.filter(i => !paywall(i) || S.keep.has(i.id));
    if (S.view === 'videos' && S.vchan) list = list.filter(i => String(i.feed_id) === String(S.vchan));
    if (S.q) { const q = S.q.toLowerCase(); list = list.filter(i => (i.title + ' ' + i.summary + ' ' + (i.byline || '')).toLowerCase().includes(q)); }
    if (S.view === 'email') list = mailShape(list);
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
  // ---- Parts of the app people can take out of the sidebar (all shown until someone hides one; synced)
  const OPTIONAL_VIEWS = [['myday', 'My Day', 'Your goals, calendar and markets, and a weekly review'], ['write', 'Writing', 'Notes, posts and Weeknotes for your own site'], ['site', 'Your site', 'Your WordPress, Micro.blog or Pika site: its posts, drafts and numbers'], ['tumblr', 'Tumblr', 'Write, queue and schedule on your Tumblr, and see who’s talking'], ['edition', 'Morning Edition', 'Yesterday’s reading as a front page'], ['email', 'Email', 'Read and write back from one mailbox'],
    ['videos', 'Videos', 'YouTube channels you follow and video podcasts, kept out of Today'], ['jobs', 'Help Wanted', 'Job posts from the sites you follow'], ['books', 'Books', 'Your books and audiobooks']];
  const hiddenViews = () => new Set(S.prefs.hiddenViews || []);
  function showView(v, on) {
    const h = hiddenViews(); if (on) h.delete(v); else h.add(v);
    S.prefs.hiddenViews = [...h]; savePrefs();
    const name = OPTIONAL_VIEWS.find(x => x[0] === v)?.[1] || v;
    if (!on && S.view === v) selectView('today');
    renderRail(); renderHead(); paintShowSettings();
    const where = EXPERIMENTAL.includes(v) ? 'Settings › Experimental' : 'Settings › Appearance';
    status(on ? `${name} is back in the sidebar.` : `${name} is off. Turn it back on in ${where}.`);
    if (v === 'email' && on) checkMail(true);
  }
  // Settings › Experimental: My Day, Email, Morning Edition and Help Wanted go beyond reading feeds (David, Nov 21).
  // Turned off, each is gone from the sidebar and stops its work (no mail checks, nothing from My Day on Today);
  // with all four off the app is a plain feed reader. Same switch as hiding a view (S.prefs.hiddenViews).
  const EXPERIMENTAL = ['myday', 'email', 'edition', 'jobs'];
  function paintShowSettings() {
    const h = hiddenViews();
    const sw = ([v, label, what]) => `<label class="set-switch"><span><b>${label}</b><small>${what}</small></span><input type="checkbox" role="switch" data-show="${v}"${h.has(v) ? '' : ' checked'}></label>`;
    const el = $('setShow'); if (el) el.innerHTML = OPTIONAL_VIEWS.filter(x => !EXPERIMENTAL.includes(x[0])).map(sw).join('');
    const ex = $('setExp'); if (ex) ex.innerHTML = EXPERIMENTAL.map(v => OPTIONAL_VIEWS.find(x => x[0] === v)).filter(Boolean).map(sw).join('');
    document.querySelectorAll('#expList [data-exp]').forEach(li => { li.hidden = h.has(li.dataset.exp); });
    const list = $('expList'); if (list) list.hidden = ![...list.children].some(li => !li.hidden);
  }
  for (const id of ['setShow', 'setExp']) $(id)?.addEventListener('change', e => { const c = e.target.closest('[data-show]'); if (c) showView(c.dataset.show, c.checked); });
  $('hideViewBtn')?.addEventListener('click', () => showView(S.view, false));

  let loadedOnce = false;
  function renderRail() {
    // The Dock icon shows the same number as Today
    const todayN = unreadIn('today');
    if (todayN !== lastBadge) { lastBadge = todayN; invoke('set_badge', { n: todayN }).catch(() => {}); }
    // Read · Explore · Library, each under a heading that folds it away. A folded heading shows the
    // group's total, and the view you're on stays visible even when its group is folded (Mac, iPad: the sidebar
    // sits beside the page). On iPhone the sidebar is its own screen, so a folded group hides everything (David, Nov 21).
    // Folding is off in the icon-only sidebar and the narrow chip strip, which show every view.
    const canFold = !document.body.classList.contains('rail-slim') && !(phoneSize.matches && !document.documentElement.classList.contains('ios'));
    const hid = hiddenViews();
    const group = (id, name, all) => {
      const items = all.filter(it => !hid.has(it.view) || String(S.view) === it.view);
      const open = !canFold || !foldedGroups.has(id);
      const total = items.reduce((n, it) => n + (Number(it.count) || 0), 0);
      const shown = open ? items : isPhone() ? [] : items.filter(it => !it.sub && String(S.view) === it.view);
      return `<button class="grp" type="button" data-group="${id}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${name}">`
        + `<span class="grp-chev">${ICONS.chev}</span><span class="grp-name">${name}</span>`
        + `<span class="count">${open || !total ? '' : fmtCount(total)}</span></button>`
        + shown.map(it => it.html || navButton(it.view, it.label, it.count, { icon: it.icon })).join('');
    };
    $('views').innerHTML =
      group('read', 'Read', [
        { view: 'today', label: 'Today', count: unreadIn('today'), icon: ICONS.today },
        mydayNavItem(),
        { view: 'people', label: 'People', count: unreadIn('people'), icon: ICONS.people },
        videosNavItem(),
        ...favChannelNav(),
        { view: 'edition', label: 'Morning Edition', count: '', icon: ICONS.edition },
        ...mailNavItems()]) +
      '<hr class="nav-gap">' +
      // Read, then Write (David, Nov 22)
      group('write', 'Write', [...wrNavItems(), tbNavItem()]) +
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
    // When one of Writing's folders or a favorite channel is picked, only that line is highlighted, not Writing or
    // Videos above it too (the icon-only sidebar hides those lines, so there the parent stays highlighted).
    if (!document.body.classList.contains('rail-slim'))
      for (const sub of $('views').querySelectorAll('.navsub[aria-current="true"]'))
        $('views').querySelector(`[data-view="${sub.dataset.wrsub != null ? (isSiteSub(sub.dataset.wrsub) ? 'site' : 'write') : sub.dataset.mailsub != null ? 'email' : 'videos'}"]`)?.setAttribute('aria-current', 'false');

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
      $('feeds').innerHTML = isPhone() ? '' : v === 'all' ? navButton('all', 'All', unreadIn('all'), { icon: ICONS.all })
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
      // A folded folder still shows the feed or subfolder you're on, the way a folded group keeps your view (Mac, iPad)
      if (!open && !isPhone()) {
        const v = String(S.view), here = [...subs.map(x => 'folder:' + x.id), ...inside.map(f => String(f.id))].includes(v) ? v
          : subs.find(x => S.feeds.some(f => f.folder_id === x.id && String(f.id) === v)) ? v : '';
        const hf = here && feedById(here), hs = here.startsWith('folder:') && folderById(here.slice(7));
        if (hf) h += `<div class="infolder${sub ? ' insub' : ''}" data-folder="${folder.id}">${feedButton(hf)}</div>`;
        else if (hs) h += `<div class="infolder${sub ? ' insub' : ''}" data-folder="${folder.id}">${navButton('folder:' + hs.id, hs.name, unreadIn('folder:' + hs.id), { ini: hs.name })}</div>`;
      }
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
    if (S.view === 'email' && mailFolder() !== 'inbox') return MAIL_FOLDERS[mailFolder()];
    const names = { write: 'Writing', site: siteTabName(), tumblr: 'Tumblr', myday: 'My Day', today: 'Today', all: 'All stories', saved: 'Read later', annotated: 'Annotated', recent: 'Recently read', discover: 'Discover', people: 'People', videos: 'Videos', guide: 'How to use The Reading Room', edition: 'The Morning Edition', talk: 'Conversations', jobs: 'Help Wanted', books: 'Books', email: 'Email' };
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
    document.body.classList.toggle('discover-view', ['discover', 'guide', 'talk', 'books'].includes(S.view) || ((S.view === 'jobs' || S.view === 'edition' || S.view === 'myday' || S.view === 'write' || S.view === 'site' || S.view === 'tumblr') && !S.readerId));
    // Writing uses My Day's width and panels
    document.body.classList.toggle('myday-view', S.view === 'myday' || S.view === 'write' || S.view === 'site' || S.view === 'tumblr');
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
      <div class="th-acts">${anySocial() || SOC.accounts.site ? `<button class="btn primary" data-talk="newpost">${SOC.accounts.site ? 'New note' : 'New post'}</button>` : ''}
        <button class="btn icon-only" id="talkRefresh" type="button" title="Check again${checked ? ' · ' + checked : ''}" aria-label="Check again"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></div>`;
  }

  function renderHead() {
    $('viewTitle').innerHTML = S.view === 'today'
      ? `<span class="sun" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg></span>Today`
      : S.view === 'myday' ? `<span class="sun" aria-hidden="true">${ICONS.myday}</span>My Day`
      : S.view === 'write' ? `<span class="sun" aria-hidden="true">${ICONS.write}</span>Writing`
      : S.view === 'tumblr' ? `<span class="sun tb-sun" aria-hidden="true">${ICONS.tumblr}</span>Tumblr`
      : S.view === 'site' ? `<span class="sun" aria-hidden="true">${siteIcon()}</span>${esc(siteTabName())}`
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
      : S.view === 'videos' ? (S.vchan && feedById(S.vchan) ? `${S.items.filter(i => !i.read && isVideoItem(i) && String(i.feed_id) === String(S.vchan)).length} unwatched from ${feedById(S.vchan).title}` : `${unreadIn('videos')} unwatched from the channels you follow`)
      : S.view === 'guide' ? 'A five-minute introduction to RSS and this app'
      : S.view === 'edition' ? 'Yesterday’s reading as a front page, made at 6 every morning'
      : S.view === 'myday' ? (MD.mode === 'week' ? 'Look back at the week, then point the next one' : 'Your goals, your calendar and the markets')
      : S.view === 'write' ? (WR.sub ? `Writing › ${WR.sub.startsWith('cat-') ? (WR.cats || []).find(c => 'cat-' + c.id === WR.sub)?.name || '' : { ideas: 'Ideas', drafts: 'Drafts', posts: 'Posts', notes: 'Notes', weeknotes: 'Weeknotes' }[WR.sub]}` : 'Notes, posts and Weeknotes for your own site')
      : S.view === 'site' ? (WR.sub && isSiteSub(WR.sub) ? `${siteTabName()} › ${WR.sub.startsWith('cat-') ? (WR.cats || []).find(c => 'cat-' + c.id === WR.sub)?.name || '' : { drafts: 'Drafts', posts: 'Posts', notes: 'Notes', weeknotes: 'Weeknotes' }[WR.sub] || ''}` : wrSite() ? `${wrHost()}: your posts, drafts and numbers` : 'Your own site')
      : S.view === 'tumblr' ? (SOC.accounts?.tumblr ? `${SOC.accounts.tumblr.blog}.tumblr.com: write, queue and schedule, and see who’s talking` : 'Work your Tumblr from here')
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
    { const b = $('hideViewBtn'); if (b) b.hidden = !OPTIONAL_VIEWS.some(([v]) => v === S.view) || hiddenViews().has(S.view); }
    $('viewSub').textContent = ['discover', 'guide', 'talk', 'books', 'edition', 'email', 'myday', 'write', 'site', 'tumblr'].includes(S.view) ? lead : S.view === 'jobs' ? `${lead} · ${when}` : `${lead}${muted} · ${when}`;
    paintTalkHead();
    syncWide();
    $('fAll').setAttribute('aria-pressed', String(!S.unreadOnly));
    $('fUnread').setAttribute('aria-pressed', String(S.unreadOnly));
    $('fFree').setAttribute('aria-pressed', String(!!S.freeOnly));
    const onVid = S.view === 'videos';
    { const t = $('readerEmptyT'); if (t) t.textContent = onVid ? 'Pick a video to watch it here' : onMail ? 'Pick an email to read it here' : 'Pick a story to read it here'; }
    paintUpNext();
    $('fFree').hidden = onMail || onVid; // nothing to pay for in Videos
    // Videos speaks of watching: Unwatched first, then All; Mark all watched
    $('fUnread').textContent = onVid ? 'Unwatched' : 'Unread';
    $('fAll').textContent = onVid ? 'All videos' : 'All';
    if (onVid !== ($('seg').firstElementChild === $('fUnread'))) $('seg').insertBefore(onVid ? $('fUnread') : $('fAll'), $('seg').firstElementChild);
    $('markAll').textContent = onVid ? 'Mark all watched' : 'Mark all read';
    if (!onMail) $('q').placeholder = onVid ? 'Search videos' : 'Search stories';
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
    } else if (S.view === 'recent' && S.items.some(i => i.read_at)) {
      bar.hidden = false;
      bar.innerHTML = `<button class="btn" data-roundup>Make a roundup of your week</button><span class="note">Your favorites, a line each, for your site or an email</span>`;
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
    if (S.view === 'videos') return S.vchan && S.unreadOnly ? ['You’ve watched everything from this channel', 'Switch to “All videos” to see them again.'] : S.unreadOnly && S.items.some(isVideoItem) ? ['You’ve watched everything', 'Switch to “All videos” to see the ones you’ve watched.'] : ['No videos yet', 'Follow a channel to start with above, or paste any YouTube channel’s address, or a link to one of its videos, into Add feed. Channels the people you read share show up above too.'];
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
    const mine = myFeed(), k = `${S.feeds.length}|${mine?.id}|${SOC.accounts.site?.site || ''}`;
    if (ownCache.k === k) return ownCache.ids;
    const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
    const homes = new Set([mine && (hostOf(mine.site) || hostOf(mine.url)), hostOf(SOC.accounts.site?.site || '')].filter(Boolean));
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
    const unread = S.items.filter(i => isToday(i) && !i.read && !isMuted(i) && !isJobItem(i) && !isEmailItem(i) && !(videosOn() && isVideoItem(i))).filter(i => {
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
    const peopleShown = people.filter(i => i !== lead).slice(0, 3); // one row
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
    // One line: what's new, and how much of it is from people (point to the people, not to whoever posted the most)
    let line;
    if (!unread.length) line = 'Nothing new waiting. You’re caught up for today.';
    else {
      line = fresh && since ? `${fresh} new ${since}` : `${unread.length} unread from the last day`;
      line += peopleAll.length ? `, <button class="b-link" data-view="people">${peopleAll.length} from people you read</button>.` : '.';
    }

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
      const readWeek = S.items.filter(i => i.read_at && Date.now() - Date.parse(i.read_at) < 7 * DAY && isWeb(i.link) && !isEmailItem(i)).length;
      if (readWeek >= 3) statsHtml += `<p class="b-stats">${readWeek} posts read this week. <button class="b-link" data-roundup>Make a roundup</button> to pass the best ones on.</p>`;
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
      ${myDayOn() ? glanceHtml() : ''}
      ${inBriefHtml}${leadHtml}${mkToday() ? mkLineHtml() : ''}${trendHtml()}${peopleHtml}${moreHtml}<div class="b-foot">${statsHtml}${mineHtml}${laterHtml}</div>
    </section>`;
  }

  function renderList() {
    syncHome(); paintUpNext();
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
    if (S.view === 'myday') { paintMyDay(); return; }
    if (S.view === 'write' || S.view === 'site') { wrPaint(); return; }
    if (S.view === 'tumblr') { tbPaint(); return; }
    if (S.view === 'books') { $('list').innerHTML = booksHtml(); if (B.open) requestAnimationFrame(B.chapters && !B.loading ? layoutBook : () => bookGeom()); return; }
    if (isHome()) { $('list').innerHTML = homeHtml(visible()); return; }
    if (isPeopleHome()) { $('list').innerHTML = peopleHomeHtml(visible()); return; }
    const all = visible(), list = all.slice(0, S.shown);
    const brief = S.view === 'email' ? mailBarHtml() : S.view === 'videos' ? myChannelsHtml() + (S.q || S.vchan ? '' : starterChannelsHtml() + sharedChannelsHtml()) : briefHtml();
    const older = S.view === 'email' ? '' : olderHtml(new Set(all.map(i => i.id)));
    if (!list.length) {
      const [t, d] = emptyText();
      $('list').innerHTML = brief + (older || !t ? '' : `<div class="empty"><strong>${t}</strong><span>${d}</span></div>`) + older + (S.view === 'email' ? mailOlderHtml() : '');
      return;
    }
    if (S.view === 'email') {
      $('list').innerHTML = brief + `<div class="mail-list">${list.map(mailRow).join('')}</div>`
        + (all.length > list.length ? `<button class="btn more" id="more">Show ${Math.min(60, all.length - list.length)} more</button>` : mailOlderHtml());
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
          <button class="icon" data-act="read" title="${readWord(it)}" aria-label="${readWord(it)}">${it.read ? ICONS.read : ICONS.unread}</button>
        </div>
      </article>`;
    }
    out += '</div>';
    if (all.length > list.length) out += `<button class="btn more" id="more">Show ${Math.min(60, all.length - list.length)} more</button>`;
    $('list').innerHTML = out + older;
  }
  // in Videos, read means watched
  const readWord = it => S.view === 'videos' && isVideoItem(it) ? (it.read ? 'Mark unwatched' : 'Mark watched') : (it.read ? 'Mark unread' : 'Mark read');
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
    if (img.tagName === 'IMG' && img.classList.contains('tp-pic')) { img.closest('.t-post')?.classList.remove('has-pic'); img.closest('.tp-picb')?.remove(); return; }
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
    if (text) statusTimer = setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.classList.remove('err'); } }, err ? 20000 : 6000);
    el.title = text && err ? 'Click to clear' : '';
  }
  function showBanner(html, err, kind = 'feed-error') { const b = $('banner'); b.hidden = false; b.className = 'banner' + (err ? ' err' : ''); b.dataset.kind = kind; b.innerHTML = html; }
  function hideBanner() { const b = $('banner'); b.hidden = true; b.dataset.kind = ''; }

  // ------------------------------------------------------------ data
  // ---- First run (Nov 24): Welcome → pick what you like → follow a circle of writers → your first conversation.
  // Only for someone with no feeds yet. Circles come from readingroomapp.com/lists/circles.json (the `circles`
  // command), with this copy for when the site can't be reached. Each circle is writers who link to each other,
  // so the first conversation can show up straight away.
  const CIRCLES_BUNDLED = [
    { id: "web", name: "The web and design", about: "People who build websites and write about how the web works. They quote each other almost every week.", writers: [
      ["Jeremy Keith", "https://adactio.com/", "https://adactio.com/journal/rss", "Journal of a web developer in Brighton, since 2001."],
      ["Jim Nielsen", "https://blog.jim-nielsen.com/", "https://blog.jim-nielsen.com/feed.xml", "Short, thoughtful posts about the web, design and making things."],
      ["Chris Coyier", "https://chriscoyier.net/", "https://chriscoyier.net/feed/", "Personal blog of the CodePen co-founder."],
      ["Dave Rupert", "https://daverupert.com/", "https://daverupert.com/atom.xml", "Web developer and podcaster; notes on building and life."],
      ["Ethan Marcotte", "https://ethanmarcotte.com/", "https://ethanmarcotte.com/wrote/feed.xml", "The designer who coined “responsive web design.”"],
      ["Brad Frost", "https://bradfrost.com/", "https://bradfrost.com/feed/", "Design systems, the web, and making music."],
      ["Eric Meyer", "https://meyerweb.com/", "https://meyerweb.com/eric/thoughts/feed/", "CSS, the web platform and life, since the 1990s."],
      ["Sophie Koonin", "https://localghost.dev/", "https://localghost.dev/feed.xml", "Front-end engineering, the indie web and side projects."]] },
    { id: "small", name: "The small web", about: "Personal sites, blogrolls and the indie web. A good place to start if you want a blog of your own.", writers: [
      ["Kev Quirk", "https://kevquirk.com/", "https://kevquirk.com/feed", "A personal blog about the small web, technology and life."],
      ["Robb Knight", "https://rknight.me/", "https://rknight.me/subscribe/posts/rss.xml", "Small tools and notes for the independent web."],
      ["Dan Q", "https://danq.me/", "https://danq.me/feed/", "A long-running personal blog: geocaching, code and everything else."],
      ["Tracy Durnell", "https://tracydurnell.com/", "https://tracydurnell.com/feed/", "Weeknotes and a “mind garden” of ideas, books and making."],
      ["Chris Aldrich", "https://boffosocko.com/", "https://boffosocko.com/feed/", "IndieWeb notes, reading and commonplace books."],
      ["Ton Zijlstra", "https://www.zylstra.org/blog/", "https://www.zylstra.org/blog/feed/", "Notes on networks, knowledge work and the open web."],
      ["Lou Plummer", "https://amerpie.lol/", "", "Mac tips, music and the small web."],
      ["David Daniels", "https://daviddaniels.com/", "https://daviddaniels.com/feed/", "Makes The Reading Room. Personal essays since 2001, and happy to answer anyone new to blogging.", 1]] },
    { id: "tech", name: "Tech, written by people", about: "AI, platforms and the open web, from people rather than outlets.", writers: [
      ["Simon Willison", "https://simonwillison.net/", "https://simonwillison.net/atom/everything/", "AI, open source and data, with links to everyone worth reading."],
      ["Molly White", "https://www.mollywhite.net/", "https://www.mollywhite.net/feed/feed.xml", "Crypto, tech power and the open web, in short notes and long posts."],
      ["Ben Werdmuller", "https://werd.io/", "", "Tech, media and the open social web; weekly notable links."],
      ["Anil Dash", "https://www.anildash.com/", "https://www.anildash.com/feed.xml", "Essays on tech, culture and making the web humane."],
      ["Cory Doctorow", "https://pluralistic.net/", "https://pluralistic.net/feed/", "Pluralistic: a daily post on tech, power and the internet."],
      ["Matt Webb", "https://interconnected.org/home/", "https://interconnected.org/home/feed", "Ideas about technology, design and the near future."]] },
    { id: "apple", name: "Apple and the Mac", about: "Apple writers who link to and answer each other every day.", writers: [
      ["John Gruber", "https://daringfireball.net/", "https://daringfireball.net/feeds/main", "Daring Fireball: Apple, design and tech, since 2002."],
      ["Jason Snell", "https://sixcolors.com/", "https://sixcolors.com/feed/", "Six Colors: Apple news and reviews."],
      ["Michael Tsai", "https://mjtsai.com/blog/", "https://mjtsai.com/blog/feed/", "Collects what everyone is saying about Apple and software, quotes and all."],
      ["Manton Reece", "https://www.manton.org/", "https://www.manton.org/feed.xml", "Founder of Micro.blog; short posts on the indie web and Apple."],
      ["Matt Birchler", "https://birchtree.me/", "https://birchtree.me/rss/", "Apps, tech and design, from a product designer."],
      ["Riccardo Mori", "https://morrick.me/", "https://morrick.me/feed", "Thoughtful essays on Apple, software and design."]] },
    { id: "ideas", name: "Books, ideas and making", about: "Writers, artists and readers who share what they are reading and making.", writers: [
      ["Austin Kleon", "https://austinkleon.com/", "https://austinkleon.com/feed/", "Notes on creativity, reading and making things."],
      ["Robin Sloan", "https://www.robinsloan.com/", "https://www.robinsloan.com/feed.xml", "A novelist’s notes on books, media and technology."],
      ["Craig Mod", "https://craigmod.com/", "https://craigmod.com/index.xml", "Walking, books and publishing, from Japan."],
      ["Jason Kottke", "https://kottke.org/", "", "kottke.org: the best of the web, since 1998."],
      ["Seth Godin", "https://seths.blog/", "https://seths.blog/feed/", "A short daily post about marketing, work and generosity."],
      ["Tracy Durnell", "https://tracydurnell.com/", "https://tracydurnell.com/feed/", "Weeknotes and a “mind garden” of ideas, books and making."]] }];
  const frCircle = c => ({ id: c.id, name: c.name, about: c.about || '', writers: (c.writers || []).map(w => Array.isArray(w)
    ? { name: w[0], site: w[1], feed: w[2] || '', about: w[3] || '', maker: !!w[4] } : { name: w.name, site: w.site, feed: w.feed || '', about: w.about || '', maker: !!w.maker }) });
  const FR = { step: 'welcome', circles: CIRCLES_BUNDLED.map(frCircle), on: new Set(), done: 0, total: 0, failed: [] };
  const firstRunDue = () => !store.get('firstRun') && !S.feeds.length && !$('firstRun');
  function frWriters() {
    const seen = new Set(), out = [];
    for (const c of FR.circles) if (FR.on.has(c.id)) for (const w of c.writers) { const k = hostOfU(w.site); if (!seen.has(k)) { seen.add(k); out.push(w); } }
    return out;
  }
  const frAv = (name, key, cls = '') => `<span class="fr-av${cls}" style="--h:${hueFor(key)}" aria-hidden="true">${esc((name || '?').trim()[0] || '?')}</span>`;
  function frHtml() {
    if (FR.step === 'welcome') return `<div class="fr-page fr-welcome">
      <p class="fr-brand">The Reading Room</p>
      <h1>Real people are still writing on the web.</h1>
      <p class="fr-lede">And they’re answering each other.</p>
      <div class="fr-demo" aria-hidden="true">
        <div class="fr-demo-row">${frAv('A', 'a1')}<span><b>One writer</b> posts on their own blog</span></div>
        <div class="fr-demo-line"></div>
        <div class="fr-demo-row">${frAv('B', 'b2')}<span><b>Another answers</b> on theirs, with a link back</span></div>
        <div class="fr-demo-line"></div>
        <div class="fr-demo-row fr-demo-you"><span class="fr-av fr-av-you">✓</span><span>The Reading Room puts them together for you, as a conversation</span></div>
      </div>
      <button class="btn primary fr-go" data-fr="pick">Show me</button>
      <p class="fr-small">Free. No account. No algorithm. No ads.</p>
      <p class="fr-small"><button class="linkish" data-fr="skip">I already have feeds to add</button></p>
    </div>`;
    if (FR.step === 'pick') {
      const ws = frWriters();
      return `<div class="fr-page fr-pick">
        <button class="linkish fr-back" data-fr="welcome">‹ Back</button>
        <h2>What do you like reading about?</h2>
        <p class="fr-lede">Pick one or more. Each is a small circle of writers who read and answer each other, so conversations start right away.</p>
        <div class="fr-chips" role="group" aria-label="Topics">${FR.circles.map(c => `<button class="fr-chip" data-fr-circle="${esc(c.id)}" aria-pressed="${FR.on.has(c.id)}" title="${esc(c.about)}">${esc(c.name)}</button>`).join('')}</div>
        ${ws.length ? `<p class="fr-k">Your circle · ${ws.length} writer${ws.length === 1 ? '' : 's'}</p>
        <ul class="fr-list">${ws.map(w => `<li${w.maker ? ' class="fr-maker"' : ''}>${frAv(w.name, w.site)}<span><b>${esc(w.name)}</b> <small>${esc(hostOfU(w.site))}</small><br>${esc(w.about)}</span></li>`).join('')}</ul>
        <p class="fr-small">They link to each other often. You can unfollow anyone later, or add your own.</p>`
        : `<p class="fr-small fr-hint">Tap a topic to see who’s in it.</p>`}
        <div class="fr-foot"><button class="btn primary fr-go" data-fr="follow"${ws.length ? '' : ' disabled'}>Follow ${ws.length ? `these ${ws.length} writers` : 'writers'}</button>
        <button class="linkish" data-fr="skip">Skip and add my own feeds</button></div>
      </div>`;
    }
    if (FR.step === 'following') return `<div class="fr-page fr-following" aria-live="polite">
      <h2>Following ${FR.total} writers…</h2>
      <div class="fr-bar"><span style="width:${FR.total ? Math.round(FR.done / FR.total * 100) : 0}%"></span></div>
      <p class="fr-lede">${FR.done} of ${FR.total}. The Reading Room reads each blog and looks for the posts that answer one another.</p>
    </div>`;
    // The first conversation: posts that answer one another, or one writer writing about another
    const c = frConversation();
    const okText = FR.failed.length ? `<p class="fr-small">${FR.failed.length} blog${FR.failed.length === 1 ? '' : 's'} didn’t answer just now (${esc(FR.failed.slice(0, 3).join(', '))}${FR.failed.length > 3 ? '…' : ''}). You can add ${FR.failed.length === 1 ? 'it' : 'them'} later from Feeds.</p>` : '';
    if (!c) return `<div class="fr-page fr-thread">
      <h2>You’re following ${FR.total - FR.failed.length} writers</h2>
      <p class="fr-lede">No conversation between them in their latest posts yet. When one answers another, it shows up in Conversations, and under the post they answered.</p>
      ${okText}
      <div class="fr-foot"><button class="btn primary fr-go" data-fr="done">Start reading</button></div></div>`;
    const posts = c.posts, names = [...new Set(posts.map(p => frName(p)))];
    return `<div class="fr-page fr-thread">
      <p class="fr-k">Your first conversation</p>
      <p class="fr-lede">${c.kind === 'answers'
        ? `${posts.length} posts on ${names.length} blogs, answering one another. The Reading Room puts them together for you.`
        : `${esc(frName(posts[0]))} wrote about ${esc(c.about)}, who you follow now too. The Reading Room spots that for you.`}</p>
      <ol class="fr-chain">${posts.map(p => `<li>${frAv(frName(p), (feedById(p.feed_id) || {}).url || p.feed_id)}
        <button class="fr-post" data-fr-open="${esc(p.id)}"><small>${esc(frName(p))} · ${esc(hostOfU(p.link))} · ${esc(fmtWhen(p.date))}</small>
        <b>${esc(headline(p) || 'A post')}</b>${p.summary ? `<span>${esc(frSnip(p.summary))}</span>` : ''}</button></li>`).join('')}</ol>
      ${okText}
      <div class="fr-foot"><button class="btn primary fr-go" data-fr-open="${esc(posts[0].id)}">Read it</button>
      <button class="linkish" data-fr="talk">See all conversations</button> · <button class="linkish" data-fr="done">Start reading</button></div>
    </div>`;
  }
  const frName = p => nbWho(p)?.title || hostOfU(p.link);
  const frSnip = t => { const s = String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > 160 ? s.slice(0, 150).replace(/\s+\S*$/, '') + '…' : s; };
  // The best conversation among what just arrived: a post with answers from other writers (most answers, then
  // newest), else one writer linking to another's blog
  function frConversation() {
    const x = nbIndex();
    let best = null;
    for (const [id, ans] of x.answers) {
      const root = item(id); if (!root || isEmailItem(root)) continue;
      const others = ans.filter(a => personId(a.feed_id) !== personId(root.feed_id));
      if (!others.length) continue;
      const last = others[others.length - 1].date;
      if (!best || others.length > best.n || (others.length === best.n && last > best.last)) best = { n: others.length, last, posts: [root, ...others.slice(0, 3)] };
    }
    if (best) return { kind: 'answers', posts: best.posts };
    let m = null;
    for (const [id, to] of x.mentions) { const i = item(id); if (i && (!m || i.date > m.i.date)) m = { i, to }; }
    return m ? { kind: 'mention', posts: [m.i], about: m.to.f.title } : null;
  }
  async function frFollow() {
    const ws = frWriters();
    FR.step = 'following'; FR.total = ws.length; FR.done = 0; FR.failed = []; frPaint();
    const queue = [...ws];
    const one = async () => {
      for (let w; (w = queue.shift());) {
        try { await invoke('add_feed', { url: w.feed || w.site, title: w.name, folderId: null }); }
        catch (e) {
          if (!/already follow/i.test(msg(e)) && w.feed) { try { await invoke('add_feed', { url: w.site, title: w.name, folderId: null }); } catch (e2) { if (!/already follow/i.test(msg(e2))) FR.failed.push(w.name); } }
          else if (!/already follow/i.test(msg(e))) FR.failed.push(w.name);
        }
        FR.done++; frPaint();
      }
    };
    await Promise.all([one(), one(), one(), one()]);
    store.set('firstRun', '1');
    await load();
    FR.step = 'thread'; frPaint();
  }
  function frPaint() { const el = $('firstRun'); if (el) { el.innerHTML = frHtml(); el.scrollTop = 0; } }
  function frClose(view) {
    store.set('firstRun', '1');
    const el = $('firstRun'); if (el) el.remove();
    document.body.classList.remove('fr-on');
    if (view) selectView(view);
  }
  async function openFirstRun(step = 'welcome') {
    if ($('firstRun')) return;
    const el = document.createElement('div'); el.id = 'firstRun'; el.className = 'fr'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Welcome to The Reading Room');
    document.body.appendChild(el); document.body.classList.add('fr-on');
    FR.step = step; FR.on.clear(); frPaint();
    el.addEventListener('click', e => {
      const c = e.target.closest('[data-fr-circle]');
      if (c) { const id = c.dataset.frCircle; FR.on.has(id) ? FR.on.delete(id) : FR.on.add(id); frPaint(); return; }
      const o = e.target.closest('[data-fr-open]');
      if (o) { const id = o.dataset.frOpen; frClose('talk'); openReader(id); return; }
      const b = e.target.closest('[data-fr]'); if (!b) return;
      const a = b.dataset.fr;
      if (a === 'pick' || a === 'welcome') { FR.step = a; frPaint(); }
      else if (a === 'follow') frFollow();
      else if (a === 'skip') { frClose('all'); openAdd(); }
      else if (a === 'talk') frClose('talk');
      else if (a === 'done') frClose('today');
    });
    try { const c = await invoke('circles'); if (Array.isArray(c?.circles) && c.circles.length) { FR.circles = c.circles.map(frCircle); if (FR.step === 'pick') frPaint(); } } catch {}
  }
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
      PLUS.prefsReady = true; plusGraceCheck();
      buildKinds(); buildPersons(); buildMutes(); renderMutes();
      setTimeout(scanSites, 4000);
      const oldMine = store.get('myFeed'); // earlier builds kept this on one device only
      if (oldMine && !('mine' in S.prefs)) { const f = feedById(oldMine); S.prefs.mine = oldMine === 'none' ? 'none' : f ? f.url : undefined; if (S.prefs.mine) savePrefs(); store.set('myFeed', ''); }
      const valid = ['today', 'myday', 'write', 'site', 'tumblr', 'edition', 'email', 'all', 'saved', 'annotated', 'recent', 'discover', 'people', 'guide', 'talk', 'jobs', 'books', 'videos'].includes(S.view) || folderOf(S.view) || feedById(S.view);
      if (!valid) S.view = 'all';
      if (!loadedOnce && hiddenViews().has(S.view)) S.view = 'today';
      // Mornings start on My Day (My Day settings › Starting the day turns this off)
      if (!loadedOnce && S.view === 'today' && myDayOn() && mdMorningStart() && new Date().getHours() < mdUntil()) { S.view = 'myday'; MD.auto = true; }
      loadedOnce = true;
      render(); if (firstRunDue()) openFirstRun(); else welcome(); processNew();
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
    if (v !== 'write' && document.body.classList.contains('wr-focus')) { document.body.classList.remove('wr-focus'); try { WR.focus = false; } catch {} }
    if (was !== undefined && String(was) !== String(v)) maybeAskReview(); // moving between views is a quiet moment too (the Mac rarely closes the reader)
    S.view = /^\d+$/.test(v) ? Number(v) : v;
    if ((S.view === 'write' || S.view === 'site') && String(was) !== String(S.view)) { try { wrLoad(); } catch {} } // drafts deleted or added in WordPress show up when you come back to Writing
    if (was === 'talk' && S.view !== 'talk') SOC.nbLeft = Date.now();
    if (S.view !== 'videos') S.vchan = null;
    if (S.view !== 'myday') { MD.mode = null; MD.step = 0; } // the channel picked in Videos is just for that visit
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
        <div class="g-starts">${STARTERS.map(starter).join('')}</div>
        <p><button class="btn" data-fr-start>Pick writers by topic</button> <span class="muted">Small circles of writers who answer each other: the web, the small web, tech, Apple, books.</span></p></section>

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
          <li><b>YouTube:</b> paste a channel’s address, or a link to any of its videos. New videos play right in the app, in the Videos tab (Settings can hide it). To answer a video, Comment on YouTube copies your words and opens it, so you can paste them under the video (the same works for Rumble, Vimeo, Odysee, Dailymotion and TikTok).</li>
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
          <li>Follow your own site here with <b>+ Add a feed</b>, open it and choose <b>This is my site</b>. Your page, like the one each person you read has, is then at the top of Conversations › You.</li>
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
          <dt>Conversations</dt><dd>The blogs you read as a social feed. The faces at the top are the people who posted in the last three days; a <b>green ring</b> means something new from them you haven’t read yet, and it goes away once you’ve read it. Tap a face to see just their posts, and their name for their page. The small labels on a post explain themselves when you tap them: <b>You</b> (your own site), a <b>star</b> (a close friend: pinned to the top, with an alert when they post), <b>Reads you</b> (you’re on their blogroll), <b>Links to you</b>, and <b>Back after</b> a few months of quiet. The row of hearts and speech bubbles under a post counts the likes, replies and mentions other sites sent it; tap it to see who. <b>Search</b> shows what people are saying right now about anything (an outage, the news): recent posts on Bluesky and Mastodon through your accounts, and posts from the blogs you read.</dd>
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

  // ---- Channels your people share: YouTube videos in the posts of the people you read, grouped by the channel
  // that made them (YouTube's oEmbed says who), most-shared first. Channels you already follow are left out.
  const VID = { info: new Map(), asked: new Set(), busy: false, added: new Set(), err: {}, more: false };
  document.addEventListener('click', e => { if (e.target.closest('[data-vmore]')) { VID.more = true; renderList(); } });
  const isYouTubeFeed = f => /youtube\.com\//.test(f?.url || '');
  function sharedVideos() {
    const since = Date.now() - 60 * DAY, out = new Map(); // video id → { feeds: Set, item, date }
    for (const i of S.items) {
      if (!i.videos || new Date(i.date).getTime() < since) continue;
      const f = feedById(i.feed_id);
      if (!f || isYouTubeFeed(f) || isEmailFeed(f) || isJobFeed(f)) continue;
      for (const id of i.videos.split(' ').filter(Boolean)) {
        const v = out.get(id) || { feeds: new Set(), item: i, date: i.date };
        v.feeds.add(f.id); if (i.date > v.date) { v.date = i.date; v.item = i; }
        out.set(id, v);
      }
    }
    return out;
  }
  async function lookUpVideos(ids) {
    const need = ids.filter(id => !VID.asked.has(id)).slice(0, 60);
    if (!need.length || VID.busy) return;
    VID.busy = true; need.forEach(id => VID.asked.add(id));
    try { for (const v of await invoke('video_channels', { ids: need })) VID.info.set(v.id, v); } catch {}
    VID.busy = false;
    if (S.view === 'videos' || S.view === 'discover') renderList();
  }
  function sharedChannelsHtml() {
    const shared = sharedVideos();
    if (!shared.size) return '';
    lookUpVideos([...shared.entries()].sort((a, b) => b[1].date.localeCompare(a[1].date)).map(([id]) => id));
    const followed = new Set(S.feeds.filter(isYouTubeFeed).map(f => (f.title || '').trim().toLowerCase()));
    const chans = new Map(); // channel address → { name, feeds: Set, videos: [] }
    for (const [id, v] of shared) {
      const info = VID.info.get(id); if (!info || !info.channel) continue;
      if (followed.has(info.channel.toLowerCase()) || VID.added.has(info.channel_url)) continue;
      const c = chans.get(info.channel_url) || { name: info.channel, url: info.channel_url, feeds: new Set(), videos: [] };
      v.feeds.forEach(x => c.feeds.add(x)); c.videos.push({ id, title: info.title, date: v.date });
      chans.set(info.channel_url, c);
    }
    const all = [...chans.values()].sort((a, b) => b.feeds.size - a.feeds.size || b.videos.length - a.videos.length).slice(0, 6);
    // in Videos a compact row of three (more on request), so the videos from your channels show without scrolling (Nov 23)
    const inVid = S.view === 'videos', more = inVid && !VID.more && all.length > 3, list = more ? all.slice(0, 3) : all;
    if (!list.length) return VID.busy ? '<section class="vchans"><h3>Channels your people share</h3><p class="note">Looking up the videos in the posts you read…</p></section>' : '';
    // each person once, by name: a person with two feeds ("Posts", "Atom Feed") counts once (David, Nov 23)
    const who = c => { const names = [...new Set([...c.feeds].map(id => (feedById(personId(id)) || feedById(id))?.title).filter(Boolean))]; return names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and '); };
    return `<section class="vchans${inVid ? ' compact' : ''}"><div class="vchans-head"><h3>Channels your people share</h3>${more ? `<button class="linkish" type="button" data-vmore>Show ${all.length - 3} more</button>` : ''}</div><p class="note" title="${esc(CUES.vchans)}">YouTube channels whose videos turned up in the posts of people you read.</p><div class="vchan-row">${list.map(c => {
      const v = c.videos.sort((a, b) => b.date.localeCompare(a.date))[0];
      return `<article class="vchan"><button class="vchan-pic" type="button" data-vplay="${esc(v.id)}" title="Play “${esc(v.title)}”"><img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"></button>
        <div class="vchan-body"><b>${esc(c.name)}</b><span>Shared by ${esc(who(c))}</span>
        <div class="t-acts"><button class="btn" type="button" data-vfollow="${esc(c.url)}" data-vname="${esc(c.name)}">Follow</button>${VID.err[c.url] ? `<span class="fol-err">${esc(VID.err[c.url])}</span>` : ''}</div></div></article>`;
    }).join('')}</div></section>`;
  }
  // Channels to start with: shown in Videos while you follow only a few YouTube channels, so a new Videos view isn't
  // empty (David, Nov 22: add iJustine and Chris Pirillo "to the video blogroll for new users downloading the app").
  const VIDEO_STARTERS = [
    ['UCey_c7U86mJGz1VJWH5CYPA', 'iJustine', 'Tech, Apple gear and everyday life, with a lot of joy.'],
    ['UChQl2YkLt3dj-KDyGUBzcHw', 'Chris Pirillo', 'Decades of tech talk: gadgets, computers and the people who love them.'],
  ];
  const ytFeed = id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  const followsChannel = id => S.feeds.some(f => (f.url || '').includes(id) || (f.site || '').includes(id));
  function starterChannelsHtml() {
    if (S.feeds.filter(isYouTubeFeed).length >= 5) return '';
    const list = VIDEO_STARTERS.filter(([id]) => !followsChannel(id) || VID.added.has(ytFeed(id)));
    if (!list.length) return '';
    return `<section class="vchans vstarts"><h3>Channels to start with</h3><p class="note">A few people who've been making videos for years. Follow one and its new videos show up here.</p>
      <div class="g-starts">${list.map(([id, name, about]) => { const on = followsChannel(id);
        return `<div class="g-start"><span class="fav" style="background:hsl(${hueFor(ytFeed(id))} 45% 42%)">${esc(name[0])}</span><div><strong>${esc(name)}</strong><span>${esc(about)}</span></div>
        <button class="btn${on ? '' : ' primary'}" type="button" data-vfollow="${esc(ytFeed(id))}" data-vname="${esc(name)}"${on ? ' disabled' : ''}>${on ? 'Following' : 'Follow'}</button></div>`; }).join('')}</div></section>`;
  }
  async function followChannel(b) {
    const url = b.dataset.vfollow; b.disabled = true; b.textContent = 'Following…';
    try { const r = await invoke('add_feed', { url, title: null, folderId: null }); VID.added.add(url); status(`Following ${r.title}. Its new videos show up in ${videosOn() ? 'Videos' : 'your feeds'}.`); await load(); }
    catch (e) { VID.err[url] = msg(e); status(msg(e), true); b.disabled = false; b.textContent = 'Follow'; }
    renderList();
  }
  // Your channels: every channel with videos here, favorites (starred) first. Tap one to see only its videos.
  const favChannels = () => Array.isArray(S.prefs.favChannels) ? S.prefs.favChannels : [];
  function myChannelsHtml() {
    const by = new Map(); // feed id → { f, latest item, unwatched }
    for (const i of S.items) {
      if (!isVideoItem(i)) continue;
      const f = feedById(i.feed_id); if (!f) continue;
      const c = by.get(f.id) || { f, latest: null, n: 0 };
      if (!c.latest || i.date > c.latest.date) c.latest = i;
      if (!i.read) c.n++;
      by.set(f.id, c);
    }
    if (by.size < 2 && !S.vchan) return '';
    const favs = favChannels(), rank = c => { const k = favs.indexOf(c.f.url); return k < 0 ? 1e6 : k; };
    const list = [...by.values()].sort((a, b) => rank(a) - rank(b) || (b.latest.date || '').localeCompare(a.latest.date || ''));
    const pic = c => { const id = ytId(c.latest.link || ''); const src = isWeb(c.latest.image) ? c.latest.image : id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '';
      return src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="mc-letter" style="--h:${tileFor(c.f).split('|')[0]}">${esc((c.f.title || '?').trim()[0] || '?')}</span>`; };
    const tile = c => { const fav = favs.includes(c.f.url), on = String(S.vchan) === String(c.f.id);
      return `<div class="mychan${on ? ' on' : ''}${fav ? ' is-fav' : ''}"><button class="mc-pick" type="button" data-vchan="${esc(c.f.id)}" title="${on ? 'Show every channel' : `Show only ${esc(c.f.title)}`}" aria-pressed="${on}">
        <span class="mc-pic">${pic(c)}${c.n ? `<span class="mc-n">${c.n}</span>` : ''}</span><span class="mc-name">${esc(c.f.title)}</span></button>
        <button class="mc-star" type="button" data-vfav="${esc(c.f.url)}" title="${fav ? 'Remove from favorites' : 'Favorite: keep this channel first'}" aria-label="${fav ? `Remove ${esc(c.f.title)} from favorites` : `Favorite ${esc(c.f.title)}`}" aria-pressed="${fav}">${fav ? '★' : '☆'}</button></div>`; };
    const cur = S.vchan && feedById(S.vchan);
    return `<section class="mychans"><div class="mc-head"><h3>Your channels</h3><span class="note" title="${esc(CUES.favchan)}">${favs.length ? 'Your favorites come first.' : 'Tap ☆ to make a channel a favorite. Favorites come first.'}</span>${cur ? `<button class="linkish" type="button" data-vchan="">Show every channel</button>` : ''}</div>
      <div class="mc-row">${list.map(tile).join('')}</div></section>`;
  }
  // Favorite channels also sit in the sidebar under Videos: one tap opens Videos showing just that channel
  // Favorite channels fold away under their own heading, like a feed folder (remembered on this device)
  const favsFolded = () => store.get('vfavFolded') === '1';
  // The Videos row itself folds its favorites away too (a chevron at its right end, remembered on this device)
  const vidFolded = () => store.get('vidFolded') === '1';
  const favChannelFeeds = () => favChannels().map(u => S.feeds.find(f => f.url === u)).filter(Boolean);
  // My Day in the sidebar: how many events are still ahead today, and a 🎂 when a birthday is within five days
  // (David, Nov 21: "a notification to look"). Calendar's own alerts still ring at the time; this is just a nudge.
  function mydayNavItem() {
    const it = { view: 'myday', label: 'My Day', count: '', icon: ICONS.myday };
    if (!dayPrefs().cal || !myDayOn()) return it;
    const today = new Date().toDateString();
    if (!DAYB.data || DAYB.day !== today) setTimeout(() => loadDay(), 0);
    if (!BDAY.list || BDAY.day !== today || Date.now() - BDAY.at > 60 * 60 * 1000) setTimeout(() => loadBirthdays(), 0);
    const now = Date.now() / 1000;
    const left = DAYB.day === today && DAYB.data?.calendar === 'granted' ? (DAYB.data.events || []).filter(e => !e.all_day && e.end > now).length : 0;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const bdays = BDAY.day === today ? (BDAY.list || []) : [];
    const soon = bdays.map(e => { const d = new Date(e.start * 1000); d.setHours(0, 0, 0, 0); return { e, n: Math.round((d - t0) / DAY) }; }).filter(x => x.n >= 0 && x.n <= 5).sort((a, b) => a.n - b.n);
    if (!left && !soon.length) return it;
    const tip = [left ? `${left} ${left === 1 ? 'event' : 'events'} still to come today` : '',
      ...soon.slice(0, 3).map(({ e, n }) => `${e.title || 'A birthday'} ${n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}`)].filter(Boolean).join(' · ');
    const mark = soon.length ? `<span class="md-bday" aria-label="Birthday coming up">🎂</span>` : '';
    it.html = navButton('myday', 'My Day', left || '', { icon: ICONS.myday, title: `My Day: ${tip}`, mark });
    return it;
  }
  function videosNavItem() {
    const it = { view: 'videos', label: 'Videos', count: unreadIn('videos'), icon: ICONS.videos };
    if (!videosOn() || !favChannelFeeds().length) return it;
    const open = !vidFolded();
    it.html = `<div class="folder vidrow">${navButton('videos', 'Videos', it.count, { icon: ICONS.videos })}<button class="chev" type="button" data-vidfold aria-expanded="${open}" aria-label="${open ? 'Fold' : 'Show'} favorite channels under Videos" title="${open ? 'Fold your favorite channels into Videos' : 'Show your favorite channels under Videos'}">${ICONS.chev}</button></div>`;
    return it;
  }
  function favChannelNav() {
    if (!videosOn() || vidFolded()) return [];
    const feeds = favChannelFeeds();
    if (!feeds.length) return [];
    const open = !favsFolded();
    const unw = open ? 0 : S.items.filter(i => !i.read && isVideoItem(i) && feeds.some(f => f.id === i.feed_id)).length;
    const head = { view: 'videos', sub: true, html: `<div class="folder favfold"><button class="chev" type="button" data-vfavfold aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} favorite channels">${ICONS.chev}</button><button class="favhead" type="button" data-vfavfold title="${open ? 'Hide' : 'Show'} your favorite channels"><span class="name">Favorite channels</span><span class="count">${unw ? fmtCount(unw) : ''}</span></button></div>` };
    if (!open) return [head];
    return [head, ...feeds.map(f => {
      const n = S.items.filter(i => !i.read && i.feed_id === f.id && isVideoItem(i)).length;
      const on = S.view === 'videos' && String(S.vchan) === String(f.id);
      return { view: 'videos', sub: true, html: `<button class="navsub" type="button" data-vchanside="${esc(f.id)}" aria-current="${on}" title="${esc(f.title)}: only this channel's videos"><span class="navsub-star" aria-hidden="true">★</span><span class="name">${esc(f.title)}</span><span class="count">${fmtCount(n)}</span></button>` };
    })];
  }
  function toggleFavChannel(url) {
    const favs = favChannels(), on = favs.includes(url);
    S.prefs.favChannels = on ? favs.filter(u => u !== url) : [...favs, url];
    savePrefs();
    const f = S.feeds.find(x => x.url === url);
    status(on ? `${f?.title || 'That channel'} is no longer a favorite.` : `${f?.title || 'That channel'} is a favorite. It stays first in Your channels and in the sidebar under Videos.`);
    renderList(); renderRail();
  }
  // a shared video plays in a small window over the list
  function playShared(id) {
    const info = VID.info.get(id);
    const el = sheet('vplayPanel', `<h2>${esc(info?.title || 'Video')}</h2><div class="r-video">${ytPlayer(id, info?.title)}</div>
      <div class="row sheet-foot"><button class="btn" type="button" id="vpClose">Close</button></div>`, 'Video');
    $('vpClose').onclick = () => { el.hidden = true; el.innerHTML = ''; };
    el.onmousedown = e => { if (e.target === el) { el.hidden = true; el.innerHTML = ''; } }; // closing stops the video
  }
  // "Follow this channel" under a video in a story: the row names the channel once YouTube says who made it
  const followRow = id => `<div class="vfol" data-vfol="${esc(id)}"><button class="linkish" type="button" data-vfollowid="${esc(id)}">Follow this channel</button></div>`;
  async function fillFollowRows(root = document) {
    const rows = [...root.querySelectorAll('[data-vfol]')]; if (!rows.length) return;
    const need = rows.map(r => r.dataset.vfol).filter(id => !VID.info.has(id));
    if (need.length) { try { for (const v of await invoke('video_channels', { ids: need })) VID.info.set(v.id, v); } catch {} }
    const followed = new Set(S.feeds.filter(isYouTubeFeed).map(f => (f.title || '').trim().toLowerCase()));
    for (const r of rows) {
      const info = VID.info.get(r.dataset.vfol);
      if (!info) { r.remove(); continue; } // YouTube wouldn't say who made it
      r.innerHTML = followed.has(info.channel.toLowerCase()) || VID.added.has(info.channel_url)
        ? `<span>✓ You follow ${esc(info.channel)}</span>`
        : `<button class="linkish" type="button" data-vfollow="${esc(info.channel_url)}" data-vname="${esc(info.channel)}">Follow ${esc(info.channel)}</button><span>New videos from this channel will show up in ${videosOn() ? 'Videos' : 'your feeds'}.</span>`;
    }
  }
  document.addEventListener('click', e => {
    const f = e.target.closest('[data-vfollow]'); if (f) { e.preventDefault(); followChannel(f); return; }
    const p = e.target.closest('[data-vplay]'); if (p) { e.preventDefault(); playShared(p.dataset.vplay); return; }
    const st = e.target.closest('[data-vfav]'); if (st) { e.preventDefault(); toggleFavChannel(st.dataset.vfav); return; }
    const ch = e.target.closest('[data-vchan]'); if (ch) { e.preventDefault(); const v = ch.dataset.vchan; S.vchan = v && String(S.vchan) !== v ? v : null; S.shown = 60; renderRail(); renderHead(); renderList(); $('listView').scrollTo({ top: 0 }); }
  });

  function discoverHtml() {
    return searchHtml() + (D.res || D.searching ? '' : sharedChannelsHtml() + smallWebHtml()) + blogrollHtml();
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
  const ytPlayUrl = (id, title, o = {}) => `https://readingroomapp.com/play/?v=${encodeURIComponent(id)}&title=${encodeURIComponent(title || '')}${o.t >= 1 ? `&t=${Math.floor(o.t)}` : ''}${o.auto ? '&autoplay=1' : ''}`;
  const ytPlayer = (id, title, o = {}) => `<iframe src="${esc(ytPlayUrl(id, title, o))}" title="${esc(title || 'Video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
  const ytId = link => { const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(link || ''); return m ? m[1] : null; };
  const socialKind = link => /bsky\.app\/profile\/[^/]+\/post\//.test(link || '') ? 'Bluesky'
    : /^https?:\/\/[^/]+\/@[\w.]+\/\d+$/.test(link || '') ? 'Mastodon' : null;
  const isSocialFeed = f => /\/@[\w.]+\.rss$/.test(f?.url || '') || /bsky\.app\/profile\/[^/]+\/rss$/.test(f?.url || '');
  // a podcast episode or a video file the feed attaches ("#video" marks one whose address doesn't say)
  const isVideoFile = u => /#video$|\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(u || '');
  const kindTag = it => it.audio ? `<span class="via">${isVideoFile(it.audio) ? 'Video' : 'Podcast'}</span>${OFF.has(it.audio) ? `<span class="via" title="${esc(CUES.offline)}">Saved</span>` : ''}` : ytId(it.link) ? '<span class="via">Video</span>' : socialKind(it.link) ? `<span class="via">${socialKind(it.link)}</span>` : '';

  // ---- Save for offline: the episode or video file is downloaded to this device and plays from there.
  // Which files are saved is kept per device (localStorage), with when each was finished; finished ones are
  // removed after a week. The files live in the app's Caches folder (offline.rs).
  const OFF = {
    map: (() => { try { return JSON.parse(store.get('offline') || '{}'); } catch { return {}; } })(),
    busy: {},
    has(u) { return !!this.map[u]; },
    save() { store.set('offline', JSON.stringify(this.map)); },
  };
  const fileSrc = p => (window.__TAURI__?.core?.convertFileSrc || (x => x))(p);
  const mb = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
  function paintOffline(url) {
    const row = $('rOff'); if (!row || row.dataset.url !== url) return;
    const busy = OFF.busy[url];
    row.innerHTML = busy
      ? `<span>Saving for offline… ${busy.total ? Math.floor(busy.got / busy.total * 100) + '%' : mb(busy.got)}</span>`
      : OFF.has(url)
        ? `<span title="${esc(CUES.offline)}">Saved on this ${esc(deviceName())}. It plays without a connection.</span><button class="linkish" type="button" data-off="remove">Remove</button>`
        : `<button class="linkish" type="button" data-off="save">Save for offline</button>`;
  }
  async function offlineSave(url) {
    if (OFF.busy[url]) return;
    OFF.busy[url] = { got: 0, total: 0 }; paintOffline(url);
    try {
      const path = await invoke('offline_save', { url });
      OFF.map[url] = { at: new Date().toISOString() }; OFF.save();
      status('Saved for offline.');
      const a = $('rAudio'); if (a && a.dataset.url === url && a.paused) { const t = a.currentTime; a.src = fileSrc(path); a.addEventListener('loadedmetadata', () => { a.currentTime = t; }, { once: true }); }
    } catch (e) { status(msg(e), true); }
    delete OFF.busy[url]; paintOffline(url); renderList();
  }
  async function offlineRemove(url) {
    try { await invoke('offline_remove', { url }); } catch {}
    delete OFF.map[url]; OFF.save();
    const a = $('rAudio'); if (a && a.dataset.url === url && a.paused) a.src = url.replace(/#video$/, '');
    paintOffline(url); renderList(); status('Removed the saved copy.');
  }
  listen('offline-progress', e => { const p = e.payload || {}; if (OFF.busy[p.url]) { OFF.busy[p.url] = p; paintOffline(p.url); } });
  // finished a week ago or more: free the space
  setTimeout(async () => {
    const week = Date.now() - 7 * 864e5; let changed = false;
    for (const [u, v] of Object.entries(OFF.map)) {
      if (v.done && Date.parse(v.done) < week) { try { await invoke('offline_remove', { url: u }); } catch {} delete OFF.map[u]; changed = true; }
      else if (!(await invoke('offline_path', { url: u }).catch(() => 'x'))) { delete OFF.map[u]; changed = true; } // the system cleared it
    }
    if (changed) { OFF.save(); renderList(); }
  }, 6000);

  function paintMedia(it) {
    const box = $('rMedia'), yt = ytId(it.link);
    box.hidden = !(yt || it.audio); box.innerHTML = '';
    if (yt) {
      const back = miniTime(yt, it.id); // coming back from the mini player: carry on from there
      box.innerHTML = `<div class="r-video">${ytPlayer(yt, it.title, back)}</div>${isYouTubeFeed(feedById(it.feed_id)) ? '' : followRow(yt)}`;
      fillFollowRows(box);
    } else if (it.audio) {
      const key = 'pos:' + it.id, vid = isVideoFile(it.audio), remote = it.audio.replace(/#video$/, '');
      box.innerHTML = `<div class="r-audio${vid ? ' r-vfile' : ''}">${vid
        ? `<video id="rAudio" controls playsinline preload="metadata" data-url="${esc(it.audio)}" src="${esc(remote)}"></video>`
        : `<audio id="rAudio" controls preload="metadata" data-url="${esc(it.audio)}" src="${esc(remote)}"></audio>`}
        <div class="seg r-rate" role="group" aria-label="Speed">${[1, 1.25, 1.5, 2].map(r => `<button type="button" data-rate="${r}" aria-pressed="${r === 1}">${r}×</button>`).join('')}</div>${vid ? `<button type="button" class="linkish r-pip" id="rPip" hidden title="${esc(CUES.pip)}">Picture in picture</button>` : ''}
        <div class="r-off" id="rOff" data-url="${esc(it.audio)}"></div></div>`;
      // coming back from the mini player: the same player moves back here, still playing
      if (MINI.el && MINI.url === it.audio && MINI.item === it.id) { const el = MINI.el; MINI.el = null; closeMini(); $('rAudio').replaceWith(el); el.id = 'rAudio'; }
      const a = $('rAudio');
      box.querySelectorAll('[data-rate]').forEach(x => x.setAttribute('aria-pressed', String(Number(x.dataset.rate) === a.playbackRate)));
      if (vid && pipOk(a)) { $('rPip').hidden = false; $('rPip').onclick = () => pip(a); }
      paintOffline(it.audio);
      // a saved copy plays from this device
      if (OFF.has(it.audio)) invoke('offline_path', { url: it.audio }).then(p => {
        if (!p) { delete OFF.map[it.audio]; OFF.save(); paintOffline(it.audio); return; }
        if ($('rAudio') === a && a.paused && !a.currentTime) a.src = fileSrc(p);
      }).catch(() => {});
      $('rOff').onclick = e => { const b = e.target.closest('[data-off]'); if (!b) return; b.dataset.off === 'save' ? offlineSave(it.audio) : offlineRemove(it.audio); };
      box.querySelector('.r-rate').onclick = e => {
        const b = e.target.closest('[data-rate]'); if (!b) return;
        a.playbackRate = Number(b.dataset.rate);
        box.querySelectorAll('[data-rate]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      };
      if (a._wired) return; // a player back from the mini player already has its listeners
      a._wired = true;
      a.addEventListener('play', () => { if (MINI.kind && MINI.el !== a) closeMini(); }); // one thing plays at a time
      a.addEventListener('ended', () => { if (OFF.has(it.audio)) { OFF.map[it.audio].done = new Date().toISOString(); OFF.save(); } });
      const saved = Number(store.get(key)) || 0;
      a.addEventListener('loadedmetadata', () => { if (saved > 5 && saved < a.duration - 10) a.currentTime = saved; }, { once: true });
      let last = 0;
      a.addEventListener('timeupdate', () => { if (Math.abs(a.currentTime - last) > 5) { last = a.currentTime; store.set(key, String(Math.floor(a.currentTime))); } });
      a.addEventListener('ended', () => store.set(key, '0'));
    }
  }

  // ---- The mini player: when you leave a story while its video or episode is playing, it keeps playing in
  // a small box in the corner while you browse. Tap its title to go back to the story; × stops it. A YouTube
  // player can't be moved without starting over, so readingroomapp.com/play tells the app how far along it is
  // and the corner copy starts from there. A video file or an episode moves over as it is, still playing.
  // Video files can also go to picture in picture, and on the Mac any video can go to its own floating window.
  const MINI = { kind: null, item: null, title: '', v: null, t: 0, url: null, el: null };
  window.addEventListener('message', e => {
    if (e.origin !== 'https://readingroomapp.com' || !e.data || e.data.rr !== 'yt') return;
    const f = [...document.querySelectorAll('iframe')].find(x => x.contentWindow === e.source); if (!f) return;
    f._t = Number(e.data.t) || 0; f._on = e.data.state === 1; f._v = String(e.data.v || '');
    if (f._on && MINI.kind && !$('mini').contains(f)) closeMini(); // one thing plays at a time
  });
  const pipOk = v => !!v && v.tagName === 'VIDEO' && (document.pictureInPictureEnabled
    || (typeof v.webkitSupportsPresentationMode === 'function' && v.webkitSupportsPresentationMode('picture-in-picture')));
  function pip(v) {
    try { if (v.requestPictureInPicture) v.requestPictureInPicture().catch(() => v.webkitSetPresentationMode?.('picture-in-picture')); else v.webkitSetPresentationMode('picture-in-picture'); }
    catch { status("Picture in picture isn't available here.", true); }
  }
  // the time to pick up a YouTube video from, if the mini player has it (and the mini player closes)
  function miniTime(v, itemId) {
    if (MINI.kind !== 'yt' || MINI.v !== v || MINI.item !== itemId) return {};
    const f = $('mini').querySelector('iframe'), t = f && f._v === v ? f._t : MINI.t;
    closeMini();
    return { t, auto: 1 };
  }
  // Leaving the story in the reader: whatever is playing there goes to the corner.
  function toMini() {
    const it = item(S.readerId); if (!it) return;
    const a = $('rAudio');
    if (a && !a.paused && !a.ended) {
      openMini({ kind: isVideoFile(a.dataset.url) ? 'vfile' : 'audio', item: it.id, title: headline(it), url: a.dataset.url, el: a });
      return;
    }
    const f = [...$('reader').querySelectorAll('.r-video iframe')].find(x => x._on && x._v);
    if (f) openMini({ kind: 'yt', item: it.id, title: f.title && f.title !== 'Video' ? f.title : headline(it), v: f._v, t: f._t });
  }
  const MINI_ICONS = {
    pip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none"/></svg>',
    window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  function openMini(o) {
    closeMini();
    Object.assign(MINI, { t: 0, v: null, url: null, el: null }, o);
    const box = $('mini'), vid = o.kind !== 'audio';
    box.className = 'miniplayer ' + (vid ? 'is-video' : 'is-audio');
    const btn = (k, label) => `<button type="button" class="icon" data-mini="${k}" aria-label="${esc(label)}" title="${esc(label)}">${MINI_ICONS[k]}</button>`;
    box.innerHTML = `<div class="mp-media"></div><div class="mp-row">
      <button type="button" class="mp-title linkish" data-mini="open" title="${esc(CUES.mini)}">${esc(o.title || 'Playing')}</button>
      ${o.kind === 'vfile' && pipOk(o.el) ? btn('pip', 'Picture in picture') : ''}${!IOS && vid ? btn('window', 'Open in its own window') : ''}${btn('close', 'Stop')}</div>`;
    const m = box.querySelector('.mp-media');
    if (o.kind === 'yt') m.innerHTML = `<div class="r-video">${ytPlayer(o.v, o.title, { t: o.t, auto: 1 })}</div>`;
    else { o.el.removeAttribute('id'); m.appendChild(o.el); } // moved in one step, so it doesn't stop
    box.hidden = false;
    if (!store.get('miniSeen')) { store.set('miniSeen', '1'); status(CUES.miniFirst); }
  }
  function closeMini() {
    if (!MINI.kind) return;
    if (MINI.el) { MINI.el.pause(); }
    const box = $('mini'); box.innerHTML = ''; box.hidden = true;
    Object.assign(MINI, { kind: null, item: null, title: '', v: null, t: 0, url: null, el: null });
  }
  $('mini').addEventListener('click', e => {
    const b = e.target.closest('[data-mini]'); if (!b) return;
    const k = b.dataset.mini;
    if (k === 'close') closeMini();
    else if (k === 'pip' && MINI.el) pip(MINI.el);
    else if (k === 'open') { if (item(MINI.item)) openReader(MINI.item); else status('That story is no longer in your list.', true); }
    else if (k === 'window') {
      let url, t = MINI.t;
      if (MINI.kind === 'yt') { const f = $('mini').querySelector('iframe'); if (f && f._v === MINI.v) t = f._t; url = ytPlayUrl(MINI.v, MINI.title, { t, auto: 1 }); }
      else { url = MINI.url.replace(/#video$/, ''); t = MINI.el?.currentTime || 0; if (t >= 1) url += `#t=${Math.floor(t)}`; }
      const title = MINI.title;
      invoke('open_player', { url, title }).then(closeMini).catch(err => status(String(err), true));
    }
  });
  // A YouTube description (plain text from the feed): paragraphs and line breaks kept, web addresses as links,
  // chapter times (1:23, 1:02:03) as buttons that start the player above at that point.
  function videoText(s) {
    const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;
    const times = t => t.replace(/(^|[\s(\[])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s)\].,:\-–—])/g, (m, pre, ts) => {
      const secs = ts.split(':').reduce((a, n) => a * 60 + Number(n), 0);
      return `${pre}<button type="button" class="b-link r-ts" data-ts="${secs}" title="${esc(CUES.vtime)}">${ts}</button>`;
    });
    const line = l => l.split(URL_RE).map((part, i) => i % 2 ? `<a href="${esc(part)}">${esc(part.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : times(esc(part))).join('');
    return s.split(/\n{2,}/).map(p => `<p>${p.split('\n').map(line).join('<br>')}</p>`).join('');
  }
  // Short posts and videos come straight from the feed; their web pages aren't articles.
  function feedOnlyBody(it) {
    const kind = socialKind(it.link), yt = ytId(it.link);
    if (!kind && !yt) return null;
    const pic = !yt && isWeb(it.image) ? `<figure><img src="${esc(it.image)}" alt=""></figure>` : '';
    const text = !it.summary ? '' : yt ? `<div class="r-desc">${videoText(it.summary)}</div>` : `<p class="${kind ? 'r-post' : ''}">${esc(it.summary)}</p>`;
    return `${text}${pic}<p class="note">${kind ? `A post on ${kind}.` : 'A video on YouTube.'} <button class="b-link" id="rOnSite">${kind ? `Open it on ${kind}` : 'Watch on YouTube'}</button></p>`;
  }


  // ------------------------------------------------------------ Writing (The Reading Room Plus)
  // Everything you write for your own site in one place (David, Nov 22): a new Note, Post or Weeknotes, your ideas,
  // drafts on your site, this week, a writing calendar, Your blog's numbers and what's on your site lately.
  // In the sidebar it sits right under Read ("reading, writing…"), and folds open to its folders: Ideas, Drafts,
  // Posts, Notes, Weeknotes, then your site's own categories. Notes and Weeknotes are the Notes and Weeknotes
  // categories the app already posts into; the other categories come from WordPress, so they always match the site.
  // Likes, reposts and replies still happen on the post you're reading; they show here once they're on your site.
  const WR = { sub: '', cats: null, drafts: null, recent: null, future: null, at: 0, busy: false, err: '', folder: null, folderKey: '', folderBusy: false,
    cal: null, calKey: '', calMonth: null, calDay: '', draftsMore: false, draftsPage: 1, trashed: null, photo: '', photoUrl: '', alt: '', posting: false, note: '', noteErr: false };
  // Writing is for your own site; a Tumblr has its own tab (David, Nov 26)
  const wrSite = () => SOC.accounts?.site?.kind === 'tumblr' ? null : SOC.accounts?.site;
  const wrHost = () => (wrSite()?.site || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const wrCat = slug => (WR.cats || []).find(c => c.slug === slug);
  const wrCatName = id => (WR.cats || []).find(c => c.id === id)?.name || '';
  // the site's categories as folders: not Notes or Weeknotes (they have their own), not empty ones, not Uncategorized
  const wrOwnCats = () => (WR.cats || []).filter(c => c.count > 0 && !['notes', 'weeknotes', 'uncategorized'].includes(c.slug));
  const wrIdeas = () => (S.prefs.ideas ||= []);
  const wrFolded = () => store.get('wrFolded') !== '0'; // folded until you open it, so the sidebar stays short
  const wrDraftGet = () => { try { return JSON.parse(store.get('wrDraft') || '{}') || {}; } catch { return {}; } };
  const wrDraftSet = d => store.set('wrDraft', JSON.stringify(d));
  const wrKind = () => ['note', 'post', 'weeknotes'].includes(wrDraftGet().kind) ? wrDraftGet().kind : 'post';
  // WordPress gives dates in UTC without the Z
  const wrDate = s => s ? new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z') : null;
  function wrWhen(s) {
    const d = wrDate(s); if (!d || isNaN(d)) return '';
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const n = Math.round((t0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
    return n === 0 ? 'today' : n === 1 ? 'yesterday' : n > 1 && n < 7 ? `${n} days ago` : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() === t0.getFullYear() ? {} : { year: 'numeric' }) });
  }
  // what a post is, by its category
  function wrKindOf(p) {
    const c = p.categories || [], n = wrCat('notes')?.id, w = wrCat('weeknotes')?.id;
    return n && c.includes(n) ? 'note' : w && c.includes(w) ? 'weeknotes' : 'post';
  }
  const WR_KIND = { note: 'Note', post: 'Post', weeknotes: 'Weeknotes' };

  async function wrLoad(force) {
    if (!wrSite() || WR.busy || (!force && WR.at && Date.now() - WR.at < 60e3)) return;
    WR.busy = true;
    try {
      const [cats, drafts, recent, future] = await Promise.all([invoke('site_categories'), invoke('site_posts', { status: 'draft', perPage: 50 }),
        invoke('site_posts', { status: 'publish', perPage: 60 }), invoke('site_posts', { status: 'future', perPage: 20 }).catch(() => [])]);
      WR.cats = cats || []; WR.drafts = drafts || []; WR.draftsMore = WR.drafts.length >= 50; WR.draftsPage = 1; WR.recent = recent || []; WR.future = future || []; WR.err = '';
    } catch (e) { WR.err = msg(e); }
    WR.busy = false; WR.at = Date.now(); WR.cal = null;
    renderRail();
    if (S.view === 'write' || S.view === 'site') wrPaint();
  }
  // one month of the calendar: what went on your site that month
  async function wrLoadCal() {
    const m = WR.calMonth || (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
    const key = `${m.getFullYear()}-${m.getMonth()}`;
    if (WR.calKey === key && WR.cal) return;
    WR.calKey = key; WR.cal = null;
    try {
      const list = await invoke('site_posts', { status: 'publish', perPage: 100, after: new Date(m.getTime() - 1000).toISOString().slice(0, 19) });
      if (WR.calKey === key) { WR.cal = list || []; if (S.view === 'write' && !WR.sub) wrPaint(); }
    } catch { if (WR.calKey === key) WR.cal = []; }
  }
  async function wrLoadFolder(key) {
    if (WR.folderBusy) return;
    WR.folderBusy = true; WR.folderKey = key; WR.folder = null;
    const n = wrCat('notes')?.id, w = wrCat('weeknotes')?.id;
    const args = key === 'posts' ? { status: 'publish', perPage: 50, exclude: [n, w].filter(Boolean) }
      : key === 'notes' ? (n ? { status: 'publish', perPage: 50, categories: [n] } : null)
      : key === 'weeknotes' ? (w ? { status: 'publish', perPage: 50, categories: [w] } : null)
      : key.startsWith('cat-') ? { status: 'publish', perPage: 50, categories: [Number(key.slice(4))] } : null;
    try { WR.folder = args ? (await invoke('site_posts', args)) || [] : []; WR.err = ''; } catch (e) { WR.folder = []; WR.err = msg(e); }
    WR.folderBusy = false;
    if ((S.view === 'write' || S.view === 'site') && WR.sub === key) wrPaint();
  }

  // ---- the sidebar: Writing, and its folders when it's open
  // Writing is the notebook: what you're writing, your ideas, drafts and this week. What's already on your site has
  // its own tab, named for the platform (David, Nov 26: "cleaning up the writing tab with a wordpress tab", and a tab
  // for the other indie platforms), the way Tumblr and YouTube have theirs.
  const SITE_SUBS = ['drafts', 'posts', 'notes', 'weeknotes'];
  const isSiteSub = k => SITE_SUBS.includes(k) || String(k).startsWith('cat-');
  const siteTabName = () => { const s = wrSite(); return !s ? 'Your site' : s.kind === 'wordpress' ? 'WordPress' : siteApp() === 'your site’s own editor' ? (wrHost() || 'Your site') : siteApp(); };
  const siteIcon = () => wrSite()?.kind === 'wordpress' ? ICONS.wordpress : ICONS.site;
  function wrNavItems() {
    const mark = plusLive() ? '<span class="wr-plus" title="Part of The Reading Room Plus">Plus</span>' : '';
    const it = { view: 'write', label: 'Writing', count: '', icon: ICONS.write, html: navButton('write', 'Writing', '', { icon: ICONS.write, mark }) };
    if (!wrSite()) return [it];
    if (!WR.at && !WR.busy) setTimeout(() => wrLoad(), 0);
    return [it, ...siteNavItems(mark)];
  }
  function siteNavItems(mark) {
    const name = siteTabName(), icon = siteIcon();
    const site = { view: 'site', label: name, count: '', icon };
    const open = !wrFolded(), nd = (WR.drafts || []).length ? `${(WR.drafts || []).length}${WR.draftsMore ? '+' : ''}` : '';
    site.count = open ? '' : nd || '';
    site.html = `<div class="folder vidrow">${navButton('site', name, site.count, { icon, mark })}<button class="chev" type="button" data-wrfold aria-expanded="${open}" aria-label="${open ? 'Fold' : 'Show'} the folders under ${esc(name)}" title="${open ? `Fold the folders into ${esc(name)}` : 'Show your drafts, posts, notes and categories'}">${ICONS.chev}</button></div>`;
    if (!open) return [site];
    const sub = (k, label, n, tip) => ({ view: 'site', sub: true, html: `<button class="navsub" type="button" data-wrsub="${esc(k)}" aria-current="${S.view === 'site' && WR.sub === k}" title="${esc(tip || label)}"><span class="name">${esc(label)}</span><span class="count">${n ? (typeof n === 'number' ? fmtCount(n) : esc(n)) : ''}</span></button>` });
    const cats = wrOwnCats();
    return [site, sub('drafts', 'Drafts', nd, 'Drafts on your site'), sub('posts', 'Posts'), sub('notes', 'Notes'), sub('weeknotes', 'Weeknotes'),
      ...(cats.length ? wrCatItems(cats, sub) : [])];
  }
  // On your site (David, Nov 26): your site's categories fold away under their heading, folded to start, so the list
  // stays short. Folded, the category you're in stays in view (like folding a folder in Feeds).
  const wrCatsFolded = () => store.get('wrCatsFolded') !== '0';
  function wrCatItems(cats, sub) {
    const open = !wrCatsFolded();
    const head = { view: 'site', sub: true, html: `<button class="wr-navhead wr-cathead" type="button" data-wrcats aria-expanded="${open}" title="${open ? 'Fold your site’s categories' : 'Show your site’s categories'}"><span>On your site</span>${open ? '' : `<span class="count">${cats.length}</span>`}<span class="wr-catchev" aria-hidden="true">${ICONS.chev}</span></button>` };
    const shown = open ? cats : cats.filter(c => S.view === 'site' && WR.sub === 'cat-' + c.id);
    return [head, ...shown.map(c => sub('cat-' + c.id, c.name, 0, `Everything in ${c.name} on your site`))];
  }

  // ---- the page
  // The page grows with what you write (no box to scroll inside)
  function wrGrow(t) {
    if (!t || t.offsetParent === null) return;
    const m = $('main'), y = m?.scrollTop, ly = $('listView')?.scrollTop;
    t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px';
    if (m) m.scrollTop = y; if ($('listView')) $('listView').scrollTop = ly;
  }
  function wrPaint() {
    const a = document.activeElement, id = a && a.id && a.closest?.('#list') ? a.id : '';
    const sel = id && typeof a.selectionStart === 'number' ? a.selectionStart : null;
    const y = $('main').scrollTop, ly = $('listView').scrollTop;
    $('list').innerHTML = writingHtml();
    wrGrow($('wrText'));
    $('main').scrollTop = y; $('listView').scrollTop = ly;
    const el = id && $(id);
    if (el) { el.focus(); if (sel != null) try { el.setSelectionRange(sel, sel); } catch {} }
  }
  function wrHead(sub) {
    return `<div class="md-top"><div class="md-top-row"><h2>${esc(sub || 'Write something')}${!sub && plusLive() ? '<span class="wr-plusmark" title="Part of The Reading Room Plus">Plus</span>' : ''}</h2>
        <div class="md-modes">${sub ? `<button type="button" class="linkish" data-wr="back">All of ${S.view === 'site' ? esc(siteTabName()) : 'Writing'}</button>` : ''}${S.view !== 'site' && wrSite() ? `<span class="wr-site">Posting to <b>${esc(wrHost())}</b></span><button type="button" class="linkish" data-wr="site">Change</button>` : ''}</div></div>`;
  }
  function writingHtml() {
    if (S.view === 'site') return siteHtml();
    if (!wrSite()) return `<section class="brief myday writing" aria-label="Writing">${wrHead()}<p class="b-line">Writing is where you post to your own site: notes, full posts and Weeknotes, with your drafts, ideas and your blog’s numbers alongside.</p></div>
      <section class="b-panel wr-invite"><p class="b-sub">Your site</p><h2>Connect your site to start</h2>
      <p>WordPress, Micro.blog, Pika or another IndieWeb site. No site yet? Micro.blog is the quickest start: sign in and approve the app. Nothing goes on your site until you press Post.${SOC.accounts?.tumblr ? ' Your Tumblr has its own tab, under Writing in the sidebar.' : ''}</p>
      <div class="wr-acts"><button class="btn primary" type="button" data-wr="connect">Connect your site</button></div></section></section>`;
    if (!plusOk()) return wrInviteHtml();
    if (!WR.at && !WR.busy) setTimeout(() => wrLoad(), 0);
    if (WR.sub && !isSiteSub(WR.sub)) return wrFolderHtml();
    const err = WR.err ? `<p class="wr-err" role="alert">${esc(WR.err)} <button class="b-link" type="button" data-wr="reload">Try again</button></p>` : '';
    return `<section class="brief myday writing" aria-label="Writing">${wrHead()}<p class="b-line">Whatever you write here goes to your own site. Nothing is posted until you press Post.</p></div>
      ${err}${wrComposerHtml()}<div class="md-quad">${wrIdeasHtml()}${wrDraftsHtml()}${wrWeekHtml()}${wrCalHtml()}</div>
      ${wrSite() ? `<p class="day-note wr-sitelink">What’s on ${esc(wrHost())}, its folders and your blog’s numbers are in <button class="b-link" type="button" data-view-go="site">${esc(siteTabName())}</button>.</p>` : ''}</section>`;
  }
  // The site tab: what's already on your own site (WordPress, or Micro.blog, Pika or another IndieWeb site).
  function siteHtml() {
    const name = siteTabName();
    if (!wrSite()) return `<section class="brief myday writing" aria-label="Your site"><section class="b-panel wr-invite"><p class="b-sub">Your site</p><h2>Connect your site to start</h2>
      <p>WordPress, Micro.blog, Pika or another IndieWeb site. Its posts, drafts and numbers show here; you write in Writing.</p>
      <div class="wr-acts"><button class="btn primary" type="button" data-wr="connect">Connect your site</button></div></section></section>`;
    if (!plusOk()) return wrInviteHtml();
    if (!WR.at && !WR.busy) setTimeout(() => wrLoad(), 0);
    if (WR.sub && isSiteSub(WR.sub)) return wrFolderHtml();
    const err = WR.err ? `<p class="wr-err" role="alert">${esc(WR.err)} <button class="b-link" type="button" data-wr="reload">Try again</button></p>` : '';
    return `<section class="brief myday writing site-tab" aria-label="${esc(name)}"><div class="md-top"><div class="md-top-row"><h2>${esc(wrHost())}</h2>
        <div class="md-modes"><button type="button" class="btn primary" data-wr="new" data-k="post">Write a post</button><button type="button" class="btn" data-wr="new" data-k="note">Write a note</button><button type="button" class="linkish" data-mkurl="${esc(wrSite().site)}">Open your site</button></div></div>
      <p class="b-line">What’s on your site: your numbers, your drafts and what you posted lately. The folders in the sidebar list everything by kind and category.</p></div>
      ${err}${yourBlogHtml()}<div class="md-quad">${wrDraftsHtml()}</div>${wrRecentHtml()}</section>`;
  }
  function wrInviteHtml() {
    return `<section class="brief myday writing" aria-label="Writing"><section class="b-panel wr-invite"><p class="b-sub">The Reading Room Plus</p>
      <h2>Write back to the web, from where you read it</h2>
      <p>Reading stays free. Plus adds Writing: post notes, full posts and Weeknotes to your own site, keep your ideas and drafts in one place, and see who’s reading you.</p>
      <ul class="wr-feat"><li><b>Post to your site</b><span>Notes, posts, replies, likes and reposts</span></li><li><b>Weeknotes and What I read</b><span>Made from your week, posted in a tap</span></li>
        <li><b>Ideas and drafts</b><span>Your ideas, and the drafts on your site</span></li><li><b>Your blog</b><span>Visitors, RSS readers and search, every day</span></li></ul>
      <div class="wr-acts"><button class="btn primary" type="button" data-plus>See the price and try it free</button></div></section></section>`;
  }

  // New: a Note, a Post or Weeknotes. What you type is kept on this device until it's posted.
  function wrComposerHtml() {
    const d = wrDraftGet(), kind = wrKind(), nets = copyNets();
    const picked = new Set((store.get('wrNets') ?? 'bluesky,mastodon').split(',').filter(Boolean));
    const cats = (WR.cats || []).filter(c => !['notes', 'weeknotes'].includes(c.slug));
    const pt = postToChoice() ? (d.editId && postTo() === 'tumblr' ? 'both' : postTo()) : 'site';
    const help = pt === 'tumblr' && kind !== 'post' ? (kind === 'note' ? 'A note goes on your Tumblr, tagged “notes”. A title is optional.' : 'Your Weeknotes go on your Tumblr, tagged “weeknotes”.') : kind === 'post' ? 'Leave a blank line between paragraphs. A line starting with ## is a heading, with > a quote. [Words](https://…) makes a link; a video’s address on its own line becomes a player.'
      : kind === 'note' ? (onTumblr() ? 'A note goes on your Tumblr, tagged “notes”. A title is optional.' : !onWp() ? 'A note goes on your site as a short post. A title is optional.' : 'A note goes on your Notes page and in its feed. Without a title, its first words are used.')
      : 'Step 3 of 3: add a few words under What happened (and a line under any post if you like), then Publish, or Save as a draft to finish later. Your Weeknotes go in the Weeknotes category, with the photo as the featured image.';
    const pic = WR.photo || WR.photoUrl;
    return `<section class="b-panel wr-new" aria-label="New">
      <div class="bp-head"><h3 class="b-sub">${d.editId ? 'Your draft' : 'New'}</h3>${d.editId ? `<span class="bp-meta">Saved on your site · <button class="linkish" type="button" data-wr="clear">Start something new</button></span>` : ''}
        <button class="wr-focusbtn" type="button" data-wr="focus" aria-pressed="${!!WR.focus}" title="${WR.focus ? 'Show the rest of Writing (Esc)' : 'Hide everything but the page'}">${WR.focus ? 'Done' : 'Focus'}</button>
        <div class="wr-kinds" role="group" aria-label="What you’re writing">${Object.entries(WR_KIND).map(([k, l]) => `<button type="button" data-wr="kind" data-k="${k}" aria-pressed="${k === kind}"${d.editId ? ` title="Make this draft a ${l}"` : ''}>${l}</button>`).join('')}</div></div>
      <input class="wr-title" id="wrTitle" type="text" maxlength="200" autocomplete="off" value="${esc(d.title || '')}" placeholder="${kind === 'note' ? 'Title (optional)' : 'Title'}" aria-label="Title">
      <textarea class="wr-body" id="wrText" rows="${kind === 'note' ? 4 : 9}" placeholder="${kind === 'note' ? 'What’s on your mind?' : kind === 'weeknotes' ? 'What happened this week?' : 'Start writing…'}" aria-label="What you’re writing">${esc(d.text || '')}</textarea>
      <p class="wr-help">${esc(help)}</p>
      ${pic ? `<div class="wr-pic"><img src="${esc(pic)}" alt=""><div><input class="n-field" id="wrAlt" maxlength="1000" value="${esc(WR.alt)}" placeholder="Describe the photo for people who can’t see it"${WR.photo ? '' : ' disabled'}>
        <button class="b-link" type="button" data-wr="photox">${WR.photo ? 'Remove photo' : `Change the picture in ${siteApp()}`}</button></div></div>` : ''}
      ${postToChoice() ? postToHtml('data-wrpt', !!d.editId) : ''}
      <div class="wr-opts">${pic ? '' : `<button class="btn" type="button" data-wr="photo">＋ ${kind === 'note' ? 'Photo' : 'Featured image'}</button>`}<input id="wrPhoto" type="file" accept="image/*" hidden>
        ${kind === 'post' && onWp() ? `<label class="wr-sel">Category <select id="wrCat"><option value="">${WR.cats ? 'None' : 'Loading…'}</option>${cats.map(c => `<option value="${c.id}"${String(d.cat || '') === String(c.id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
        ${nets.map(n => `<label class="wr-chk"><input type="checkbox" data-wrnet="${n}"${picked.has(n) ? ' checked' : ''}> Also share on ${NET[n]}</label>`).join('')}</div>
      <p class="acct-note${WR.noteErr ? ' err' : ''}" aria-live="polite">${esc(WR.note)}</p>
      <div class="wr-acts"><span class="note"><span class="wr-count" id="wrCount">${wrCount(d.text)}</span>${d.text || d.title ? '<span class="wr-kept">Kept on this device as you type</span>' : ''}</span>
        <button class="btn" type="button" data-wr="preview"${WR.posting ? ' disabled' : ''} title="See how it will look on your site">Preview</button>
        <button class="btn" type="button" data-wr="draft"${WR.posting ? ' disabled' : ''}>${d.editId ? 'Save the draft' : pt === 'tumblr' ? 'Save as a draft on Tumblr' : 'Save as a draft on your site'}</button>
        <button class="btn primary" type="button" data-wr="post"${WR.posting ? ' disabled' : ''}>${kind === 'post' ? 'Post now' : kind === 'weeknotes' ? 'Publish' : 'Post'}</button></div></section>`;
  }
  // "312 words · 2 min read" by the buttons (about 230 words a minute)
  function wrCount(text) {
    const n = ((text || '').match(/[\p{L}\p{N}’'-]+/gu) || []).length;
    return n ? `${n.toLocaleString()} word${n === 1 ? '' : 's'} · ${Math.max(1, Math.round(n / 230))} min read` : '';
  }
  // Focus: everything but the page goes away until you press Done or Esc
  function wrSetFocus(on) {
    WR.focus = !!on; document.body.classList.toggle('wr-focus', WR.focus);
    if (S.view === 'write') wrPaint();
    if (WR.focus) setTimeout(() => { const t = $('wrText'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 0);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && WR.focus && !document.querySelector('.overlay:not([hidden])')) { e.preventDefault(); wrSetFocus(false); } });
  function wrIdeasHtml() {
    const ideas = wrIdeas();
    return `<section class="b-panel wr-ideas" aria-label="Ideas"><div class="bp-head"><h3 class="b-sub">Ideas</h3><span class="bp-meta">${ideas.length ? `${ideas.length} waiting` : ''}</span></div>
      ${ideas.length ? `<ul class="wr-list">${ideas.slice(0, 5).map(i => `<li><span class="wr-t">${esc(i.t)}<small>Added ${esc(wrWhen(i.at))}</small></span><button class="b-link" type="button" data-wr="idea-write" data-id="${esc(i.id)}">Write it</button></li>`).join('')}</ul>` : ''}
      ${ideas.length > 5 ? `<p class="day-note"><button class="b-link" type="button" data-wrsub="ideas">All ${ideas.length} ideas</button></p>` : ''}
      <form class="wr-addf" data-wr-form="idea"><input class="wr-add" id="wrIdea" maxlength="200" placeholder="Add an idea…" aria-label="Add an idea" autocomplete="off"><button class="btn" type="submit">Add</button></form>
      <p class="day-note">${ideas.length ? 'Your ideas stay in the app and sync through iCloud. Write it starts a post with the idea as its title.' : 'Jot down what you might write about. Your ideas stay in the app and sync through iCloud.'}</p></section>`;
  }
  function wrDraftsHtml() {
    const list = WR.drafts;
    const body = !list ? `<p class="day-note">${WR.busy ? 'Looking at your site…' : ''}</p>` : !list.length ? '<p class="day-note">No drafts on your site right now. Save as a draft puts one here.</p>'
      : `<ul class="wr-list">${list.slice(0, 4).map(p => `<li><span class="wr-t">${esc(p.title || p.excerpt?.slice(0, 80) || 'Untitled draft')}<small>Edited ${esc(wrWhen(p.modified))}${p.categories?.length ? ` · ${esc(wrCatName(p.categories[0]))}` : ''}</small></span><span class="wr-lacts"><button class="b-link" type="button" data-wr="pv" data-id="${p.id}">Preview</button><button class="b-link" type="button" data-wr="edit" data-id="${p.id}">Keep writing</button><button class="b-link wr-dl" type="button" data-wr="trash" data-id="${p.id}">Delete</button></span></li>`).join('')}</ul>
        ${list.length > 4 ? `<p class="day-note"><button class="b-link" type="button" data-wrsub="drafts">All ${list.length} drafts</button></p>` : ''}`;
    return `<section class="b-panel wr-drafts" aria-label="Drafts"><div class="bp-head"><h3 class="b-sub">Drafts on your site</h3><span class="bp-meta">${list?.length ? `${list.length}${WR.draftsMore ? '+' : ''}` : ''}</span></div>${wrUndoHtml()}${body}
      ${list?.length ? `<p class="day-note">Drafts you started here or in ${siteApp()}. Finish them in either place.</p>` : ''}</section>`;
  }
  // This week: Weeknotes in three labeled steps (David, Nov 22: "Can we make it easier and label the steps?").
  // 1 Pick what you read (optional) · 2 Write · 3 Publish. Each step shows when it's done; the next one is the green button.
  function wrWeekHtml() {
    const wk = mdWeek(), mon = wk.mon.getTime();
    const done = wrWeekDone(wk), d = wrDraftGet(), onSite = wrWeekDraftOnSite(wk);
    const read = S.items.filter(i => i.read_at && Date.parse(i.read_at) >= mon && !isEmailItem(i)).length;
    const picks = roundupPicks().length, picked = wrPicks(wk)?.links.length || 0;
    const open = d.kind === 'weeknotes', writing = open && (d.editId || !wrUntouched(d)), started = !!(onSite || writing);
    const s1 = done || picked, s2 = done || started, s3 = !!done;
    const cur = done ? 0 : !s2 && !s1 ? 1 : !s2 ? 2 : 3;
    const step = (n, ok, title, text, btn) => `<li class="wr-step${ok ? ' ok' : ''}${cur === n ? ' cur' : ''}"><span class="wr-num" aria-hidden="true">${ok ? '✓' : n}</span>
      <div><b>${title}</b><span>${text}</span>${btn || ''}</div></li>`;
    const b = (cls, attrs, label, off) => `<button class="btn${cls}" type="button" ${attrs}${off ? ' disabled' : ''}>${label}</button>`;
    return `<section class="b-panel wr-week" aria-label="This week"><div class="bp-head"><h3 class="b-sub">This week</h3><span class="bp-meta">${esc(fmtRange(wk.mon, wk.sun))}</span></div>
      <p class="wr-steps-lede">${done ? 'Your Weeknotes are on your site.' : 'Your Weeknotes in three steps.'}</p>
      <ol class="wr-steps">
        ${step(1, s1, 'Pick what you read', done ? 'Done for this week.' : picked ? `${picked} picked. They go under What I read. Change them any time.`
          : picks ? `Tick your favorites from the ${picks} ${picks === 1 ? 'post' : 'posts'} you read, saved or highlighted, and add a line about any. Optional: skip it and the ones you read go in.` : 'Read, save or highlight a few posts first. Optional.',
          done ? '' : b(cur === 1 ? ' primary' : '', 'data-roundup', picked ? 'Change picks' : 'Pick posts', !picks))}
        ${step(2, s2, 'Write', done ? 'Done.' : started || open ? `Your Weeknotes ${onSite ? 'draft is saved on your site' : 'are open on the page'}. Add a few words under What happened.`
          : `Opens your Weeknotes: what you posted since Monday, ${picked ? 'your picks' : 'what you read'} under What I read, and room for what happened. ${read} ${read === 1 ? 'post' : 'posts'} read so far.`,
          done ? '' : b(cur === 2 ? ' primary' : '', 'data-wr="weeknotes"', started || open ? 'Keep writing' : 'Write Weeknotes'))}
        ${step(3, s3, 'Publish', done ? `Posted ${esc(wrWhen(done.date))}: “${esc(done.title)}”` : 'On the page, press Publish when you’re happy with it, or Save as a draft to finish later.',
          done ? b('', `data-mkurl="${esc(done.link)}"`, 'Open on your site') : b(cur === 3 ? ' primary' : '', 'data-wr="weeknotes"', 'Go to the page', !(started || open)))}
      </ol>
      <p class="wr-steps-alt">${done ? `Want What I read as a post of its own? ${picks ? '<button class="linkish" type="button" data-roundup>Pick posts</button>' : ''}` : `Or make What I read a post of its own: Pick posts, then Write it as a post.`}</p></section>`;
  }
  function wrCalHtml() {
    const m = WR.calMonth || (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
    if (WR.calKey !== `${m.getFullYear()}-${m.getMonth()}` || !WR.cal) setTimeout(() => wrLoadCal(), 0);
    const marks = new Map(), add = (p, k) => { const d = wrDate(p.date); if (!d) return; const key = dayKey(d); if (!marks.has(key)) marks.set(key, []); marks.get(key).push({ k, t: p.title || p.excerpt?.slice(0, 60) || '', p }); };
    for (const p of WR.cal || []) add(p, wrKindOf(p));
    for (const p of WR.future || []) add(p, 'plan');
    const a = addDays(m, -m.getDay()), last = new Date(m.getFullYear(), m.getMonth() + 1, 0), days = [];
    for (let d = a; d <= last || d.getDay() !== 0; d = addDays(d, 1)) days.push(d);
    const today = dayKey(), kinds = { post: 'p', note: 'n', weeknotes: 'w', plan: 'plan' };
    const cells = days.map(d => {
      const k = dayKey(d), ms = marks.get(k) || [], out = d.getMonth() !== m.getMonth();
      const tip = ms.map(x => `${x.k === 'plan' ? 'Scheduled' : WR_KIND[x.k]}: ${x.t}`).join('\n');
      const label = `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${ms.length ? `, ${ms.length} on your site` : ''}`;
      return `<button type="button" class="wr-day${k === today ? ' now' : ''}${out ? ' out' : ''}${k === WR.calDay ? ' on' : ''}" data-wr="day" data-day="${k}" aria-pressed="${k === WR.calDay}" aria-label="${esc(label)}"${tip ? ` title="${esc(tip)}"` : ''}><i>${d.getDate()}</i>${ms.length ? `<span class="wr-dots">${ms.slice(0, 3).map(x => `<b class="k-${kinds[x.k]}"></b>`).join('')}</span>` : ''}</button>`;
    }).join('');
    const inMonth = (WR.cal || []).filter(p => { const d = wrDate(p.date); return d && d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear(); }).length;
    const thisMonth = m.getMonth() === new Date().getMonth() && m.getFullYear() === new Date().getFullYear();
    return `<section class="b-panel wr-cal" aria-label="Writing calendar"><div class="bp-head"><h3 class="b-sub">Writing calendar</h3>
        <span class="mc-nav"><button class="mc-arrow" type="button" data-wr="cal" data-n="-1" aria-label="Previous month">‹</button><span class="bp-meta">${esc(m.toLocaleDateString(undefined, { month: 'long', ...(m.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }))}</span><button class="mc-arrow" type="button" data-wr="cal" data-n="1" aria-label="Next month"${thisMonth ? ' disabled' : ''}>›</button></span></div>
      <div class="wr-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<span class="wr-wd">${x}</span>`).join('')}${cells}</div>
      ${wrDayHtml(marks)}
      <p class="wr-key"><span><b class="k-p"></b>Post</span><span><b class="k-n"></b>Note</span><span><b class="k-w"></b>Weeknotes</span>${(WR.future || []).length ? '<span><b class="k-plan"></b>Scheduled</span>' : ''}</p>
      <p class="day-note">${!WR.cal ? 'Looking at your site…' : `${inMonth ? `${inMonth} ${inMonth === 1 ? 'thing' : 'things'} on your site ${thisMonth ? 'this month' : 'that month'}.` : `Nothing on your site ${thisMonth ? 'yet this month' : 'that month'}.`}`}</p></section>`;
  }
  // a day picked on the calendar: what went on your site that day (David, Nov 22)
  function wrDayHtml(marks) {
    if (!WR.calDay) return '';
    const [y, mo, da] = WR.calDay.split('-').map(Number), d = new Date(y, mo - 1, da);
    const ms = marks.get(WR.calDay) || [], future = d > new Date();
    const when = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(y === new Date().getFullYear() ? {} : { year: 'numeric' }) });
    return `<div class="wr-dayl" role="region" aria-label="${esc(when)}"><div class="wr-dayh"><b>${esc(when)}</b><button class="b-link" type="button" data-wr="day" data-day="">Close</button></div>
      ${!WR.cal ? '<p class="day-note">Looking at your site…</p>' : ms.length ? `<ul class="wr-plist">${ms.map(x => `<li><span class="wr-kind k-${x.k === 'plan' ? 'sched' : x.k}">${x.k === 'plan' ? 'Scheduled' : WR_KIND[x.k]}</span><span class="wr-pt">${esc(x.t || 'Untitled')}</span><span class="wr-when">${esc((wrDate(x.p.date) || d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span>${x.p.link ? `<button class="b-link" type="button" data-mkurl="${esc(x.p.link)}">View</button>` : ''}</li>`).join('')}</ul>`
        : `<p class="day-note">${future ? 'Nothing scheduled for that day.' : 'Nothing went on your site that day.'}</p>`}</div>`;
  }
  function wrRecentHtml() {
    const list = (WR.recent || []).slice(0, 8);
    if (!list.length) return '';
    return `<section class="b-panel wr-posted" aria-label="Recently on your site"><div class="bp-head"><h3 class="b-sub">Recently on your site</h3><span class="bp-meta">${esc(wrHost())}</span></div>
      <ul class="wr-plist">${list.map(p => { const k = wrKindOf(p); return `<li><span class="wr-kind k-${k}">${WR_KIND[k]}</span><span class="wr-pt">${esc(p.title || p.excerpt || '')}</span><span class="wr-when">${esc(wrWhen(p.date))}</span><button class="b-link" type="button" data-mkurl="${esc(p.link)}">View</button></li>`; }).join('')}</ul>
      <p class="day-note">Likes, reposts and replies still happen right on the post you’re reading. Reposts and replies show here as notes${!onWp() ? '; likes stay in the app, since only a WordPress site gets a Likes page' : '; likes go on your Likes page'}.</p></section>`;
  }
  // a folder: Ideas, Drafts, Posts, Notes, Weeknotes or one of your site's categories, as a list
  function wrFolderHtml() {
    const k = WR.sub, cat = k.startsWith('cat-') ? (WR.cats || []).find(c => 'cat-' + c.id === k) : null;
    const name = cat?.name || { ideas: 'Ideas', drafts: 'Drafts', posts: 'Posts', notes: 'Notes', weeknotes: 'Weeknotes' }[k] || 'Writing';
    const note = k === 'ideas' ? 'Ideas for posts, kept in the app and synced through iCloud. Write it starts a post with the idea as its title.'
      : k === 'drafts' ? `Drafts on ${wrHost()}, whether you started them here or in ${siteApp()}. Finish them in either place.`
      : cat ? `Everything in ${cat.name} on ${wrHost()}, newest first. Categories come from your site, so they always match it.`
      : `Your ${name.toLowerCase()} on ${wrHost()}, newest first.`;
    let rows = '';
    if (k === 'ideas') {
      const ideas = wrIdeas();
      rows = ideas.length ? ideas.map(i => `<li class="wr-frow"><div class="wr-fmain"><b>${esc(i.t)}</b><span class="wr-fmeta">Added ${esc(wrWhen(i.at))}</span></div>
        <div class="wr-facts"><button class="btn primary" type="button" data-wr="idea-write" data-id="${esc(i.id)}">Write it</button><button class="btn" type="button" data-wr="idea-x" data-id="${esc(i.id)}">Remove</button></div></li>`).join('')
        : '<li class="wr-frow"><p class="day-note">No ideas yet. Add one on the Writing page.</p></li>';
    } else {
      const list = k === 'drafts' ? WR.drafts : WR.folderKey === k ? WR.folder : null;
      if (k !== 'drafts' && WR.folderKey !== k && !WR.folderBusy) setTimeout(() => wrLoadFolder(k), 0);
      rows = !list ? `<li class="wr-frow"><p class="day-note">Looking at your site…</p></li>`
        : !list.length ? `<li class="wr-frow"><p class="day-note">${k === 'weeknotes' ? 'No Weeknotes yet. Your first one makes the Weeknotes category on your site.' : k === 'notes' ? 'No notes yet.' : 'Nothing here yet.'}</p></li>`
        : list.map(p => `<li class="wr-frow">${p.image ? `<img class="wr-thumb" src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="wr-fmain"><b>${esc(p.title || (k === 'drafts' ? 'Untitled draft' : p.excerpt?.slice(0, 80) || ''))}</b>${p.excerpt && p.title ? `<p>${esc(p.excerpt)}</p>` : ''}
          <span class="wr-fmeta">${(p.categories || []).slice(0, 2).map(c => wrCatName(c)).filter(Boolean).map(c => `<span class="wr-kind">${esc(c)}</span>`).join('')}${k === 'drafts' ? `Edited ${esc(wrWhen(p.modified))}` : esc(wrWhen(p.date))}</span></div>
          <div class="wr-facts">${k === 'drafts' ? `<button class="btn wr-del" type="button" data-wr="trash" data-id="${p.id}">Delete</button><button class="btn" type="button" data-wr="pv" data-id="${p.id}">Preview</button><button class="btn" type="button" data-wr="edit" data-id="${p.id}">Keep writing</button><button class="btn primary" type="button" data-wr="publish" data-id="${p.id}">Post now</button>`
            : !onWp() ? `<button class="btn" type="button" data-mkurl="${esc(p.link)}">Open on ${onTumblr() ? 'Tumblr' : 'your site'}</button>`
            : `<button class="btn" type="button" data-mkurl="${esc(wrSite().site.replace(/\/$/, ''))}/wp-admin/post.php?post=${p.id}&amp;action=edit">Edit in WordPress</button><button class="btn" type="button" data-mkurl="${esc(p.link)}">Open on your site</button>`}</div></li>`).join('');
    }
    // a way to write a new one from its own folder (David, Nov 25: "no way to post a new note from the notes tab")
    const newK = { notes: 'note', posts: 'post', weeknotes: 'weeknotes' }[k];
    const newBtn = newK ? `<div class="wr-acts wr-fnew"><button class="btn primary" type="button" data-wr="new" data-k="${newK}">${newK === 'note' ? 'Write a note' : newK === 'post' ? 'Write a post' : 'Start this week’s Weeknotes'}</button></div>` : '';
    return `<section class="brief myday writing" aria-label="${esc(name)}">${wrHead(name)}<p class="b-line">${esc(note)}</p>${newBtn}</div>
      ${WR.err ? `<p class="wr-err" role="alert">${esc(WR.err)} <button class="b-link" type="button" data-wr="reload">Try again</button></p>` : ''}
      ${k === 'drafts' ? wrUndoHtml() : ''}<section class="b-panel wr-folder"><ul class="wr-flist">${rows}</ul>
      ${k === 'drafts' && WR.draftsMore ? `<p class="wr-more"><button class="btn" type="button" data-wr="moredrafts"${WR.folderBusy ? ' disabled' : ''}>${WR.folderBusy ? 'Loading…' : 'Show more drafts'}</button></p>` : ''}</section></section>`;
  }

  // ---- Preview: the post as it will look, before it's on your site (David, Nov 22). What you're writing is turned
  // into exactly the HTML Post sends (site_preview); a draft on your site shows as WordPress has it (site_post_view).
  // Shown in the reader's type, so it reads the way people will read it in The Reading Room.
  function wrPreviewSheet(v) {
    const by = [wrSite()?.name || wrHost(), v.when].filter(Boolean).join(' · ');
    const acts = v.loading ? '' : v.id ? `<button class="btn" type="button" data-wrpv="edit">Keep writing</button><button class="btn primary" type="button" data-wrpv="publish">Post now</button>`
      : `<button class="btn primary" type="button" data-wrpv="post">${v.kind === 'post' ? 'Post now' : v.kind === 'weeknotes' ? 'Publish' : 'Post'}</button>`;
    return `<div class="wr-pv-top"><p class="wr-pv-k">Preview · ${esc(v.state)}</p><button class="icon" type="button" data-wrpv="close" aria-label="Close the preview" title="Close (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <article class="wr-pv-art">${v.kind ? `<span class="wr-kind k-${v.kind}">${WR_KIND[v.kind]}</span>` : ''}
        ${v.title ? `<h1 class="r-title">${esc(v.title)}</h1>` : ''}<p class="wr-pv-by">${esc(by)}</p>
        ${v.image ? `<figure class="wr-pv-pic"><img src="${esc(v.image)}" alt="${esc(v.alt || '')}"></figure>` : ''}
        <div class="prose">${v.loading ? '<p class="wr-pv-wait">Getting the preview…</p>' : v.html || '<p class="wr-pv-wait">Nothing written yet.</p>'}</div></article>
      ${v.note ? `<p class="wr-pv-note">${esc(v.note)}</p>` : ''}
      <div class="row sheet-foot"><button class="btn" type="button" data-wrpv="close">${v.id ? 'Close' : 'Back to writing'}</button>${acts}</div>`;
  }
  function wrShowPreview(v) {
    const el = sheet('wrPreview', wrPreviewSheet(v), 'Preview');
    el.querySelector('.sheet').classList.add('wr-pv');
    el.onclick = e => {
      const b = e.target.closest('[data-wrpv]');
      if (!b) { const a = e.target.closest('.prose a[href]'); if (a) { e.preventDefault(); invoke('open_external', { url: a.href }).catch(() => {}); } return; }
      const k = b.dataset.wrpv; el.hidden = true;
      if (k === 'post') wrPost(false);
      if (k === 'edit') wrEdit(v.id);
      if (k === 'publish') wrPublishDraft(v.id);
    };
    el.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; } };
    if (!v.loading) el.querySelector('[data-wrpv="close"]')?.focus();
    return el;
  }
  async function wrPreviewNew() {
    const d = wrDraftGet(), kind = wrKind(), text = (d.text || '').trim();
    let title = (d.title || '').trim();
    const note = kind === 'note' && !title && text ? 'Without a title, your note’s first words are used as its title on your site.' : kind !== 'note' && !title ? 'Give it a title before you post it.' : '';
    const base = { kind, title, image: WR.photo || WR.photoUrl, alt: WR.alt, state: d.editId ? `your draft on ${wrHost()}, with your latest changes` : 'not on your site yet', when: 'today', note };
    const el = wrShowPreview({ ...base, loading: true });
    try {
      const html = text ? await invoke('site_preview', { text }) : '';
      if (!el.hidden) { wrShowPreview({ ...base, html }); }
    } catch (e) { if (!el.hidden) wrShowPreview({ ...base, html: `<p class="wr-pv-wait">${esc(msg(e))}</p>` }); }
  }
  async function wrPreviewDraft(id) {
    if (wrDraftGet().editId === id) return wrPreviewNew(); // the draft open here: show it with your latest changes
    const p0 = (WR.drafts || []).find(x => x.id === id) || {};
    const base = { id, kind: '', title: p0.title || 'Untitled draft', image: p0.image, state: `a draft on ${wrHost()}`, when: p0.modified ? `edited ${wrWhen(p0.modified)}` : '' };
    const el = wrShowPreview({ ...base, loading: true });
    try {
      const p = await invoke('site_post_view', { id });
      if (!el.hidden) wrShowPreview({ ...base, kind: wrKindOf(p), title: p.title || 'Untitled draft', image: p.image || '', html: p.html, note: p.categories?.length ? `In ${p.categories.map(wrCatName).filter(Boolean).join(', ')} once it’s posted.` : '' });
    } catch (e) { if (!el.hidden) wrShowPreview({ ...base, html: `<p class="wr-pv-wait">${esc(msg(e))}</p>` }); }
  }

  // ---- doing things
  const wrSay = (t, err) => { WR.note = t; WR.noteErr = !!err; };
  // Delete moves a draft to WordPress's Trash (it can be restored there for 30 days); Undo brings it straight back
  const wrUndoHtml = () => WR.trashed ? `<p class="wr-undo" role="status">Moved “${esc(WR.trashed.title || 'Untitled draft')}” to the trash on your site. <button class="b-link" type="button" data-wr="untrash">Undo</button></p>` : '';
  async function wrTrash(id) {
    const p = (WR.drafts || []).find(x => x.id === id); if (!p) return;
    // Tumblr has no trash: a deleted draft is gone for good, so ask first and offer no Undo
    if (onTumblr() && !confirm(`Delete “${p.title || 'Untitled draft'}”? Tumblr doesn’t keep deleted drafts, so it can’t be brought back.`)) return;
    const at = WR.drafts.indexOf(p);
    WR.drafts = WR.drafts.filter(x => x !== p); WR.trashed = onTumblr() ? null : { ...p, at }; wrPaint(); renderRail();
    try {
      await invoke('site_post_trash', { id });
      if (wrDraftGet().editId === id) { wrClear(); wrSay(''); }
    } catch (e) {
      WR.drafts.splice(at, 0, p); WR.trashed = null; status(msg(e), true); wrPaint(); renderRail();
    }
  }
  async function wrUntrash() {
    const p = WR.trashed; if (!p) return;
    WR.trashed = null; wrPaint();
    try { await invoke('site_post_restore', { id: p.id }); WR.drafts.splice(Math.min(p.at, WR.drafts.length), 0, p); status(`“${p.title || 'Untitled draft'}” is back in your drafts.`); }
    catch (e) { status(msg(e), true); }
    wrPaint(); renderRail();
  }
  async function wrMoreDrafts() {
    if (WR.folderBusy) return;
    WR.folderBusy = true; wrPaint();
    try {
      const more = (await invoke('site_posts', { status: 'draft', perPage: 50, page: WR.draftsPage + 1 })) || [];
      const have = new Set((WR.drafts || []).map(x => x.id));
      WR.drafts = [...(WR.drafts || []), ...more.filter(x => !have.has(x.id))];
      WR.draftsPage += 1; WR.draftsMore = more.length >= 50;
    } catch { WR.draftsMore = false; }
    WR.folderBusy = false; wrPaint(); renderRail();
  }
  function wrClear() { wrDraftSet({ kind: wrKind() === 'weeknotes' ? 'post' : wrKind() }); WR.photo = ''; WR.photoUrl = ''; WR.alt = ''; }
  function wrToTop() { WR.sub = ''; WR.trashed = null; renderHead(); renderRail(); wrPaint(); $('listView')?.scrollTo({ top: 0 }); $('main')?.scrollTo({ top: 0 }); }
  // A draft from your site that's open here is saved back to your site before something else takes its place,
  // so nothing you changed is lost (David, Nov 22: "I was not able to click Weeknotes while in a draft").
  async function wrPutAside() {
    const d = wrDraftGet(); if (!d.editId) return true;
    const kind = wrKind();
    try {
      status('Saving your draft on your site…');
      await invoke('site_post', { id: d.editId, title: (d.title || '').trim(), text: (d.text || '').trim(), categories: kind === 'post' && d.cat ? [Number(d.cat)] : [], photo: WR.photo, alt: WR.alt.trim(), draft: true, kind });
      status(`Saved “${(d.title || '').trim() || 'your draft'}” in your drafts.`); wrLoad(true); return true;
    } catch (e) { status(`Couldn’t save your draft first: ${msg(e)}`, true); return false; }
  }
  // Weeknotes on their own, without My Day (David, Nov 22): a page started from your week — room for what happened,
  // what you put on your site since Monday, and the posts you read, saved or highlighted — for you to add a line to each.
  function wrWeekDraft(wk) {
    const a = wk.mon.getTime(), wid = wrCat('weeknotes')?.id;
    const made = (WR.recent || []).filter(p => !(p.categories || []).includes(wid) && (wrDate(p.date) || 0) >= a)
      .sort((x, y) => (x.date || '').localeCompare(y.date || '')).slice(0, 8)
      .map(p => `[${wkLabel(p.title || p.excerpt || 'A note')}](${p.link})`);
    // the posts you picked (What I read this week › Pick posts), or else the ones you read, saved or highlighted since Monday
    const all = roundupPicks(), mine = wrPicks(wk);
    const read = mine ? mine.links.map(l => all.find(p => p.it.link === l)).filter(Boolean).map(p => wrReadLine(p, mine.why?.[p.it.link] || '', mine.quotes))
      : all.filter(p => Date.parse(p.it.read_at || p.hl?.created_at || p.it.date || 0) >= a).slice(0, 7).map(p => wrReadLine(p, '', false));
    const room = '\n\n\n\n';
    return `## What happened${room}## What I made${made.length ? '\n\n' + made.join('\n\n') + '\n\n' : room}## What I read${read.length ? '\n\n' + read.join('\n\n') : '\n\n'}`;
  }
  // this week's Weeknotes draft on your site, if there is one (same title, in Weeknotes)
  function wrWeekDraftOnSite(wk) {
    const wid = wrCat('weeknotes')?.id, title = wkTitle(wk);
    return (WR.drafts || []).find(p => (p.title || '').trim() === title && (!wid || !(p.categories || []).length || (p.categories || []).includes(wid)));
  }
  // this week's Weeknotes already on your site
  function wrWeekDone(wk) { const wid = wrCat('weeknotes')?.id; return wid && (WR.recent || []).find(p => (p.categories || []).includes(wid) && wrDate(p.date) >= wk.mon); }
  // a post's name for a link: its title, or for an untitled note its first words (an empty [](link) isn't a link)
  const wrItemName = it => headline(it).trim() || (it.summary || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim() || `A note by ${cardWriter(it)}`;
  // The posts you pick in What I read this week are remembered for the week, so the order doesn't matter (David, Nov 22:
  // "I picked my posts first and then wrote the weeknotes"): Write Weeknotes puts your picks under What I read, and the
  // picker opens with them ticked. { week, links: [..], why: { link: line }, quotes }
  function wrPicks(wk) { const k = S.prefs.wkPicks; return k && k.week === wk.key && Array.isArray(k.links) ? k : null; }
  function wrPicksSet(wk, chosen, quotes) {
    S.prefs.wkPicks = { week: wk.key, links: chosen.map(c => c.p.it.link), why: Object.fromEntries(chosen.filter(c => c.why).map(c => [c.p.it.link, c.why])), quotes: !!quotes };
    savePrefs();
  }
  // a post you read, as a line for your site: "[Title](link) — writer", your line under it, your highlight as a quote
  function wrReadLine(p, why, quote) {
    return [`[${wkLabel(wrItemName(p.it))}](${p.it.link}) — ${cardWriter(p.it)}${why ? '\n' + why : ''}`, quote && p.hl ? '> ' + p.hl.text.replace(/\s+/g, ' ').trim() : ''].filter(Boolean).join('\n\n');
  }
  // The posts you picked in What I read this week go into your Weeknotes' "## What I read" (David, Nov 22: "I'm picking
  // my posts … but it is not porting over to the writing tab"). Lines the page listed on its own for posts you didn't
  // pick come out; your picks go in (with your line, if you wrote one); anything you typed yourself stays.
  function wrPutReads(text, chosen, all) {
    const t = (text || '').replace(/\r\n?/g, '\n');
    const m = /^##[ \t]+What I read[^\n]*$/im.exec(t);
    let head, sec = '', tail = '';
    if (m) {
      const start = m.index + m[0].length, nx = t.slice(start).search(/\n##[ \t]/), end = nx < 0 ? t.length : start + nx;
      head = t.slice(0, start); sec = t.slice(start, end); tail = t.slice(end);
    } else head = (t.trim() ? t.replace(/\s+$/, '') + '\n\n' : '') + '## What I read';
    const auto = new Map(all.map(p => [p.it.link, wrReadLine(p, '', false)]));
    const picked = new Map(chosen.map(c => [c.p.it.link, wrReadLine(c.p, c.why, c.quote)]));
    const linkOf = para => (/^\[[^\]\n]*\]\((https?:\/\/[^\s()]+)\)/.exec(para) || [])[1];
    const out = []; let skipQuote = false;
    for (const para of sec.split(/\n[ \t]*\n/).map(x => x.trim()).filter(Boolean)) {
      const u = linkOf(para);
      if (u && picked.has(u)) { const mine = picked.get(u), plain = para === auto.get(u); out.push(plain ? mine : para); skipQuote = plain && mine.includes('\n\n> '); picked.delete(u); continue; }
      if (u && auto.has(u) && para === auto.get(u)) { skipQuote = true; continue; } // listed on its own, not picked
      if (skipQuote && para.startsWith('>')) continue;
      skipQuote = false; out.push(para);
    }
    out.push(...picked.values());
    return head + '\n\n' + out.join('\n\n') + (tail.trim() ? '\n\n' + tail.replace(/^\s+/, '') : '\n\n');
  }
  async function wrStartWeeknotes() {
    const wk = mdWeek(), d = wrDraftGet();
    // this week's Weeknotes already started and saved: open that draft, so there's only ever one
    const mine = !(d.kind === 'weeknotes' && !d.editId && (d.text || '').trim()) && wrWeekDraftOnSite(wk);
    if (mine) { if (d.editId === mine.id) { wrToTop(); return; } await wrEdit(mine.id); return; }
    if (d.editId) { if (!(await wrPutAside())) return; }
    else if ((d.text || '').trim() && d.kind !== 'weeknotes' && !confirm('Put aside what you’re writing and start your Weeknotes? What you wrote stays only if you save it as a draft first.')) return;
    const text = d.kind === 'weeknotes' && !d.editId && (d.text || '').trim() ? d.text : wrWeekDraft(wk);
    wrDraftSet({ kind: 'weeknotes', title: wkTitle(wk), text, tpl: d.kind === 'weeknotes' && d.tpl ? d.tpl : text }); WR.photo = ''; WR.photoUrl = ''; WR.alt = '';
    wrToTop(); setTimeout(() => $('wrText')?.focus(), 0);
  }
  // Your site shows one blank line between paragraphs however many you leave, so the page does too (David, Nov 22):
  // runs of blank lines become one. An empty section between two "## " headings (the Weeknotes template) keeps its room.
  function wrTidy(s) {
    return (s || '').replace(/\r\n?/g, '\n').replace(/\n(?:[ \t]*\n){2,}/g, (m, at, all) => {
      const before = all.slice(0, at), line = before.slice(before.lastIndexOf('\n') + 1);
      return /^##\s/.test(line) && /^##\s/.test(all.slice(at + m.length)) ? m : '\n\n';
    });
  }
  async function wrEdit(id) {
    const o = wrDraftGet();
    if (o.editId && o.editId !== id) { if (!(await wrPutAside())) return; }
    else if (!o.editId && (o.text || '').trim() && !confirm('Put aside what you’re writing and open this draft? Save what you have as a draft first if you want to keep it.')) return;
    status('Opening your draft…');
    try {
      const p = await invoke('site_post_get', { id });
      if (!p.simple) { invoke('open_external', { url: p.edit }).catch(() => {}); status(`This draft has pictures or other blocks, so it opens in ${siteApp()}, where nothing in it gets lost.`); return; }
      const nid = wrCat('notes')?.id, wid = wrCat('weeknotes')?.id;
      const cat = (p.categories || []).find(c => c !== nid && c !== wid) || '';
      const kind = nid && (p.categories || []).includes(nid) ? 'note' : wid && (p.categories || []).includes(wid) ? 'weeknotes' : 'post';
      wrDraftSet({ kind, title: p.title || '', text: wrTidy(p.text || '').trim(), cat, editId: id });
      WR.photo = ''; WR.photoUrl = p.image || ''; WR.alt = ''; wrSay('');
      status(''); wrToTop(); setTimeout(() => $('wrText')?.focus(), 0);
    } catch (e) { status(msg(e), true); }
  }
  async function wrPublishDraft(id) {
    if (wrDraftGet().editId === id) return wrPost(false); // the draft open here: post it with your latest changes
    const p = (WR.drafts || []).find(x => x.id === id);
    if (!confirm(`Publish “${p?.title || 'this draft'}” on your site now? Everyone who follows your blog will see it.`)) return;
    try {
      const r = await invoke('site_post_publish', { id });
      status(`Posted to ${wrHost()}.`);
      if (wrDraftGet().editId === id) wrClear();
      WR.drafts = (WR.drafts || []).filter(x => x.id !== id); wrPaint(); renderRail();
      wrLoad(true);
      return r;
    } catch (e) { status(msg(e), true); }
  }
  async function wrPost(draft) {
    const d = wrDraftGet(), kind = wrKind(), words = (d.text || '').trim(), title = (d.title || '').trim();
    if (!words && !WR.photo && !title) { wrSay('Write something first.', true); wrPaint(); return; }
    if (kind !== 'note' && !title && !draft) { wrSay('Give it a title first.', true); wrPaint(); $('wrTitle')?.focus(); return; }
    if (!draft && kind !== 'note' && !confirm(`Publish “${title}” on your site now? Everyone who follows your blog will see it.`)) return;
    if (WR.photo && !WR.alt.trim() && !draft && !confirm('Post the photo without a description? People using screen readers won’t know what it shows.')) { $('wrAlt')?.focus(); return; }
    const pt = postToChoice() ? (d.editId && postTo() === 'tumblr' ? 'both' : postTo()) : 'site';
    WR.posting = true; wrSay(draft ? 'Saving the draft…' : `Posting to ${pt === 'tumblr' ? 'Tumblr' : wrHost()}…`); wrPaint();
    try {
      let r;
      if (pt === 'tumblr') {
        // only on Tumblr: a full post there; its drafts stay in Tumblr's drafts
        r = await invoke('tumblr_write', { kind, title, text: words, photo: WR.photo, alt: WR.alt.trim(), draft, link: null, linkTitle: null });
        if (draft) { wrClear(); wrSay(''); status('Saved to your Tumblr drafts. Finish it on Tumblr whenever you like.'); WR.posting = false; wrPaint(); return; }
        if (kind === 'weeknotes') { const wk = mdWeek(), w = mdWk(wk.key); w.published = Date.now(); w.pubUrl = r?.url || ''; savePrefs(); }
        if (d.idea) { S.prefs.ideas = wrIdeas().filter(i => i.id !== d.idea); savePrefs(); }
        const picks = [...document.querySelectorAll('[data-wrnet]:checked')].map(x => x.dataset.wrnet).filter(n => SOC.accounts[n]);
        let shared = [];
        if (picks.length && r?.url) {
          const copy = kind === 'note' ? (title && words ? `${title}\n\n${words}` : words || title) : title;
          const res = await invoke('social_share_note', { networks: picks, text: copy, link: r.url, title: title || 'A note on Tumblr', photo: WR.photo, alt: WR.alt.trim(), video: '', videoTitle: '', about: '', aboutTitle: '', aboutSite: '', aboutImage: '' }).catch(() => []);
          shared = (res || []).filter(x => !x.error).map(x => NET[x.network]);
        }
        wrClear(); wrSay(''); status(`Posted to your Tumblr${shared.length ? `, then shared to ${shared.join(' and ')}` : ''}.`);
        WR.posting = false; wrPaint(); renderRail(); return;
      }
      if (kind === 'post' || d.editId) {
        const cats = kind === 'post' && d.cat ? [Number(d.cat)] : [];
        r = await invoke('site_post', { id: d.editId || null, title, text: words, categories: cats, photo: WR.photo, alt: WR.alt.trim(), draft, kind });
      } else {
        r = await invoke('site_note', { title, text: words, link: '', linkTitle: '', photo: WR.photo, alt: WR.alt.trim(), draft, linkImage: '', linkSite: '', category: kind === 'weeknotes' ? 'weeknotes' : null, featuredOnly: kind === 'weeknotes' });
      }
      if (draft && (kind !== 'note' || d.editId)) {
        // a post or Weeknotes saved as a draft stays open here, so the next save updates the same draft
        // (David, Nov 22: Weeknotes used to vanish from the page after Save, and Weeknotes then started over)
        wrDraftSet({ ...d, editId: r.id }); if (r.image) { WR.photoUrl = r.image; WR.photo = ''; }
        wrSay(`Saved to your drafts on your site. Keep writing, or finish it later here or in ${siteApp()}.`);
        WR.posting = false; wrLoad(true); wrPaint(); return;
      }
      if (draft) { wrClear(); wrSay(''); status(kind === 'weeknotes' ? 'Saved your Weeknotes as a draft on your site.' : 'Saved as a draft on your site.'); WR.posting = false; wrLoad(true); wrPaint(); return; }
      if (kind === 'weeknotes') { const wk = mdWeek(), w = mdWk(wk.key); w.published = Date.now(); w.pubUrl = r?.url || ''; savePrefs(); }
      if (d.idea) { S.prefs.ideas = wrIdeas().filter(i => i.id !== d.idea); savePrefs(); }
      // Both: the full post on Tumblr too (published together; a draft on your site goes to Tumblr when you post it here)
      let tumblrOk = '', tumblrErr = '';
      if (pt === 'both') {
        wrSay('Posted on your site. Posting it on Tumblr…'); wrPaint();
        try { await invoke('tumblr_write', { kind, title, text: words, photo: WR.photo || '', alt: WR.alt.trim(), draft: false, link: null, linkTitle: null }); tumblrOk = 'Tumblr'; }
        catch (err) { tumblrErr = `Tumblr: ${msg(err)}`; }
      }
      // copies to Bluesky and Mastodon that link home
      const picks = [...document.querySelectorAll('[data-wrnet]:checked')].map(x => x.dataset.wrnet).filter(n => SOC.accounts[n]);
      let shared = [], bad = [];
      if (picks.length && r?.url) {
        wrSay('Posted on your site. Sharing the copies…'); wrPaint();
        const copy = kind === 'note' ? (title && words ? `${title}\n\n${words}` : words || title) : title;
        const res = await invoke('social_share_note', { networks: picks, text: copy, link: r.url, title: title || `A note on ${wrSite().name || 'my site'}`, photo: WR.photo, alt: WR.alt.trim(), video: '', videoTitle: '', about: '', aboutTitle: '', aboutSite: '', aboutImage: '' })
          .catch(err => [{ network: '', error: msg(err) }]); // the post is already up: copies that fail are just noted
        shared = (res || []).filter(x => !x.error).map(x => NET[x.network]); bad = (res || []).filter(x => x.error);
        if (shared.length) setTimeout(() => { loadConversations(true); }, 4000);
      }
      wrClear();
      const errs = [...(tumblrErr ? [tumblrErr] : []), ...bad.map(x => x.network ? `${NET[x.network]}: ${x.error}` : `The copies weren’t shared: ${x.error}`)];
      wrSay(errs.length ? `Posted to ${[wrHost(), tumblrOk, ...shared].filter(Boolean).join(' and ')}. ${errs.join(' ')}` : '', !!errs.length);
      status(`Posted to ${wrHost()}${tumblrOk ? ' and Tumblr' : ''}${shared.length ? `, then shared to ${shared.join(' and ')}` : ''}.`);
      WR.posting = false; wrLoad(true); wrPaint(); renderRail();
    } catch (e) { WR.posting = false; wrSay(msg(e), true); wrPaint(); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-wrpt]'); if (!b || b.disabled) return;
    store.set('postTo', b.dataset.wrpt); wrPaint();
  });
  // Writing in the sidebar is always a fresh start, a blank composer (David, Nov 22: "the draft stays with you when
  // you click on the writing tab"; then "When clicking on write we should be taken back to a blank composer").
  // Anything you wrote yourself is saved as a draft on your site first, so nothing is lost; an empty composer or a
  // Weeknotes template you haven't touched is simply cleared.
  const WK_BLANK = '## What happened\n\n\n\n## What I made\n\n\n\n## What I read\n\n';
  const wrUntouched = d => {
    const t = (d.text || '').trim(); if (!t) return true;
    if (d.tpl) return t === d.tpl.trim();
    if (d.kind !== 'weeknotes') return false;
    // Weeknotes started before the template was remembered: compare with what the template would be now
    try { const wk = mdWeek(); return t === WK_BLANK.trim() || t === (weeknotes(wk, mdWk(wk.key), true) || '').trim(); } catch { return false; }
  };
  // the site tab in the sidebar opens at its top page; Writing's link to it too
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-view-go]'); if (go) { WR.sub = ''; selectView(go.dataset.viewGo); return; }
    if (e.target.closest('#views [data-view="site"]')) WR.sub = '';
  }, true);
  document.addEventListener('click', e => {
    if (!e.target.closest('#views [data-view="write"]')) return;
    WR.sub = '';
    const d = wrDraftGet(), photo = WR.photo, photoUrl = WR.photoUrl, alt = WR.alt;
    if (!d.editId && wrUntouched(d) && !photo) { if ((d.text || d.title || d.tpl || photoUrl)) { wrClear(); wrSay(''); if (S.view === 'write') wrPaint(); } return; }
    const kind = wrKind(), title = (d.title || '').trim(), text = (d.text || '').trim(), name = title || 'your draft';
    wrClear(); wrSay(`“${name}” is saved in Drafts on your site.`);
    if (S.view === 'write') wrPaint();
    status('Saving your draft on your site…');
    const save = kind === 'post' || d.editId
      ? invoke('site_post', { id: d.editId || null, title, text, categories: kind === 'post' && d.cat ? [Number(d.cat)] : [], photo, alt: (alt || '').trim(), draft: true, kind })
      : invoke('site_note', { title, text, link: '', linkTitle: '', photo, alt: (alt || '').trim(), draft: true, linkImage: '', linkSite: '', category: kind === 'weeknotes' ? 'weeknotes' : null, featuredOnly: kind === 'weeknotes' });
    save.then(() => { status(`Saved “${name}” in your drafts.`); wrLoad(true); })
      .catch(err => {
        // couldn't save: bring it back so nothing is lost
        if (!(wrDraftGet().text || '').trim()) { wrDraftSet(d); WR.photo = photo; WR.photoUrl = photoUrl; WR.alt = alt; }
        wrSay(`Couldn’t save your draft on your site, so it’s still open here: ${msg(err)}`, true); if (S.view === 'write') wrPaint();
      });
  }, true);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-wrfold]')) { store.set('wrFolded', wrFolded() ? '0' : '1'); renderRail(); return; }
    if (e.target.closest('[data-wrcats]')) { store.set('wrCatsFolded', wrCatsFolded() ? '0' : '1'); renderRail(); return; }
    const s = e.target.closest('[data-wrsub]');
    if (s) { WR.sub = s.dataset.wrsub; WR.trashed = null; if (WR.sub === 'drafts') wrLoad(); const to = isSiteSub(WR.sub) ? 'site' : 'write'; if (S.view !== to) selectView(to); else { renderHead(); renderList(); $('listView')?.scrollTo({ top: 0 }); $('main')?.scrollTo({ top: 0 }); if (isPhone()) setScreen('list'); } renderRail(); return; }
    const b = e.target.closest('[data-wr]'); if (!b || !b.closest('.writing')) return;
    const k = b.dataset.wr, id = Number(b.dataset.id) || b.dataset.id;
    if (k === 'connect' || k === 'site') { openAccounts(); return; }
    if (k === 'back') { wrToTop(); return; }
    // Write a note / post / Weeknotes from its folder: the composer at the top, set to that kind. What you were
    // writing stays (only its kind changes); a draft from your site is saved back there first.
    if (k === 'new') {
      const kind = b.dataset.k;
      if (S.view !== 'write') { WR.sub = ''; selectView('write'); }
      if (kind === 'weeknotes') { wrStartWeeknotes(); return; }
      const go = () => { const d = wrDraftGet(); if (d.editId) { WR.photo = ''; WR.photoUrl = ''; WR.alt = ''; } wrDraftSet(d.editId || (d.kind === 'weeknotes' && wrUntouched(d)) ? { kind } : { ...d, kind, ...(d.kind === 'weeknotes' && d.title?.startsWith('Weeknotes:') ? { title: '' } : {}) }); wrSay(''); wrToTop(); setTimeout(() => $('wrText')?.focus(), 0); };
      const d = wrDraftGet();
      if (d.editId) { wrPutAside().then(ok => ok && go()); return; }
      go(); return;
    }
    if (k === 'reload') { WR.err = ''; WR.folderKey = ''; wrLoad(true); return; }
    if (k === 'kind') { const d = wrDraftGet(); if (d.editId) { wrDraftSet({ ...d, kind: b.dataset.k }); wrSay(`Saves as ${b.dataset.k === 'note' ? 'a Note' : b.dataset.k === 'weeknotes' ? 'Weeknotes' : 'a Post'} on your site.`); wrPaint(); return; } if (b.dataset.k === 'weeknotes') { wrStartWeeknotes(); return; } wrDraftSet(d.kind === 'weeknotes' && wrUntouched(d) ? { kind: b.dataset.k } : { ...d, kind: b.dataset.k, ...(d.kind === 'weeknotes' && d.title?.startsWith('Weeknotes:') ? { title: '' } : {}) }); wrSay(''); wrPaint(); return; }
    if (k === 'weeknotes') { wrStartWeeknotes(); return; }
    if (k === 'clear') { if ((wrDraftGet().text || '').trim() && !confirm('Start something new? Your draft stays on your site as you last saved it.')) return; wrClear(); wrSay(''); wrPaint(); return; }
    if (k === 'photo') { $('wrPhoto')?.click(); return; }
    if (k === 'photox') { if (!WR.photo && WR.photoUrl) { const d = wrDraftGet(); if (d.editId) invoke('open_external', { url: onTumblr() ? `https://www.tumblr.com/blog/${wrSite().blog}/drafts` : !onWp() ? wrSite().site : `${wrSite().site.replace(/\/$/, '')}/wp-admin/post.php?post=${d.editId}&action=edit` }).catch(() => {}); return; } WR.photo = ''; WR.alt = ''; wrPaint(); return; }
    if (k === 'preview') { wrPreviewNew(); return; }
    if (k === 'focus') { wrSetFocus(!WR.focus); return; }
    if (k === 'pv') { wrPreviewDraft(id); return; }
    if (k === 'post' || k === 'draft') { wrPost(k === 'draft'); return; }
    if (k === 'edit') { if (S.view !== 'write') { WR.sub = ''; selectView('write'); } wrEdit(id); return; }
    if (k === 'publish') { wrPublishDraft(id); return; }
    if (k === 'trash') { wrTrash(id); return; }
    if (k === 'untrash') { wrUntrash(); return; }
    if (k === 'moredrafts') { wrMoreDrafts(); return; }
    if (k === 'day') {
      const day = b.dataset.day && b.dataset.day !== WR.calDay ? b.dataset.day : '';
      // a grey day from the month before or after: go to that month, with the day picked
      if (day) { const [y, mo] = day.split('-').map(Number), m = WR.calMonth || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        if (y !== m.getFullYear() || mo - 1 !== m.getMonth()) { const t = new Date(y, mo - 1, 1), now = new Date(); if (t > now) return; WR.calMonth = t; WR.cal = null; } }
      WR.calDay = day; wrPaint(); return;
    }
    if (k === 'cal') { WR.calDay = ''; const m = WR.calMonth || (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })(); WR.calMonth = new Date(m.getFullYear(), m.getMonth() + Number(b.dataset.n), 1); WR.cal = null; wrPaint(); return; }
    if (k === 'idea-x') { S.prefs.ideas = wrIdeas().filter(i => i.id !== b.dataset.id); savePrefs(); wrPaint(); renderRail(); return; }
    if (k === 'idea-write') {
      const idea = wrIdeas().find(i => i.id === b.dataset.id); if (!idea) return;
      const d = wrDraftGet();
      const go = () => { wrDraftSet({ kind: 'post', title: idea.t, text: '', idea: idea.id }); WR.photo = ''; WR.photoUrl = ''; WR.alt = ''; wrToTop(); setTimeout(() => $('wrText')?.focus(), 0); };
      if (d.editId) { wrPutAside().then(ok => ok && go()); return; }
      if ((d.text || '').trim() && !confirm('Put aside what you’re writing and start this idea? Save what you have as a draft first if you want to keep it.')) return;
      go(); return;
    }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-wr-form="idea"]'); if (!f) return;
    e.preventDefault();
    const t = $('wrIdea')?.value.trim(); if (!t) return;
    wrIdeas().unshift({ id: Math.random().toString(36).slice(2, 9), t, at: new Date().toISOString() });
    S.prefs.ideas = wrIdeas().slice(0, 100); savePrefs(); renderRail(); wrPaint(); $('wrIdea')?.focus();
  });
  document.addEventListener('input', e => {
    const t = e.target; if (!t.closest?.('.writing')) return;
    if (t.id === 'wrText' && /\n[ \t]*\n[ \t]*\n/.test(t.value)) { // a third Enter, or pasted text with gaps: one blank line, like the site
      const v = wrTidy(t.value), at = wrTidy(t.value.slice(0, t.selectionStart)).length;
      if (v !== t.value) { t.value = v; try { t.setSelectionRange(Math.min(at, v.length), Math.min(at, v.length)); } catch {} }
    }
    if (t.id === 'wrTitle' || t.id === 'wrText') { const d = wrDraftGet(); d.kind = wrKind(); d[t.id === 'wrTitle' ? 'title' : 'text'] = t.value; wrDraftSet(d); const c = $('wrCount'); if (c) c.textContent = wrCount(d.text); if (t.id === 'wrText') wrGrow(t); }
    if (t.id === 'wrAlt') WR.alt = t.value;
  });
  document.addEventListener('change', async e => {
    const t = e.target; if (!t.closest?.('.writing')) return;
    if (t.id === 'wrCat') { const d = wrDraftGet(); d.cat = t.value; wrDraftSet(d); }
    if (t.dataset?.wrnet) store.set('wrNets', [...document.querySelectorAll('[data-wrnet]:checked')].map(x => x.dataset.wrnet).join(','));
    if (t.id === 'wrPhoto') {
      const file = t.files[0]; if (!file) return;
      wrSay('Getting the photo ready…'); wrPaint();
      try { WR.photo = await shrinkPhoto(file); WR.photoUrl = ''; wrSay(''); } catch { WR.photo = ''; wrSay('Couldn’t open that picture. Try another one, or save it as a JPEG first.', true); }
      wrPaint(); $('wrAlt')?.focus();
    }
  });

  // ------------------------------------------------------------ The Reading Room Plus
  // A yearly subscription (StoreKit 2 through tauri-plugin-iap) for people who write: posting to your own site
  // (Notes, reposts, replies, likes, Weeknotes, What I read this week) and Your blog's stats on My Day. Reading,
  // Conversations and the Experimental extras stay free. PLUS_LIVE stays false until the subscription exists in
  // App Store Connect; while it's false nothing is locked and nothing is shown. (localStorage plusLive=1 turns it on
  // for testing.) People who already had a site connected when Plus went live keep posting free for 91 days.
  const PLUS_LIVE = true;
  const PLUS_ID = 'com.daviddaniels.readingroom.plus.yearly';
  const plusLive = () => PLUS_LIVE || store.get('plusLive') === '1';
  const PLUS = { owned: false, exp: 0, product: null, busy: false, prefsReady: false, accountsReady: false };
  try { const c = JSON.parse(store.get('plusState') || 'null'); if (c) { PLUS.owned = !!c.owned; PLUS.exp = c.exp || 0; } } catch {}
  const plusSubscribed = () => PLUS.owned && (!PLUS.exp || PLUS.exp > Date.now());
  const plusGraceUntil = () => { const g = S.prefs.plusGrace; return g && g >= dayKey() ? g : ''; };
  function plusOk() { return !plusLive() || plusSubscribed() || !!plusGraceUntil(); }
  // The first time a Plus-live version runs: if a site is already connected, posting stays free for three months
  function plusGraceCheck() {
    if (!plusLive() || !PLUS.prefsReady || !PLUS.accountsReady || S.prefs.plusSince) return;
    S.prefs.plusSince = dayKey();
    if (SOC.accounts?.wordpress) { const d = new Date(); d.setDate(d.getDate() + 91); S.prefs.plusGrace = dayKey(d); }
    savePrefs();
  }
  const plusDate = k => new Date(k + 'T12:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  function plusBlocked() {
    setTimeout(() => openPlus('post'), 0);
    return Promise.reject(new Error('Posting to your site is part of The Reading Room Plus.'));
  }
  async function plusRefresh() {
    if (!plusLive()) return;
    try {
      const st = await tauriInvoke('plugin:iap|get_product_status', { payload: { productId: PLUS_ID, productType: 'subs' } });
      PLUS.owned = !!st?.isOwned && (st.purchaseState == null || st.purchaseState === 0);
      PLUS.exp = st?.expirationTime || 0;
      store.set('plusState', JSON.stringify({ owned: PLUS.owned, exp: PLUS.exp, at: Date.now() }));
      if (S.view === 'myday') mdRender();
      if (S.view === 'write') wrPaint();
      paintPlusRow();
    } catch { /* offline or no StoreKit: keep what we knew */ }
  }
  async function plusProduct() {
    if (PLUS.product) return PLUS.product;
    const r = await tauriInvoke('plugin:iap|get_products', { payload: { productIds: [PLUS_ID], productType: 'subs' } });
    PLUS.product = (r?.products || []).find(p => p.productId === PLUS_ID) || null;
    return PLUS.product;
  }
  // A free introductory period shows as a first pricing phase that costs nothing
  function plusTrial(p) {
    for (const o of p?.subscriptionOfferDetails || []) for (const ph of o.pricingPhases || []) if (!ph.priceAmountMicros) return ph.billingPeriod || 'P1W';
    return '';
  }
  const PLUS_FEATURES = [
    ['Post to your site', 'Notes, reposts, replies and likes, straight to your own WordPress site, Micro.blog, Pika or Tumblr, with copies to Mastodon and Bluesky.'],
    ['Weeknotes', 'Publish your Weeknotes and What I read this week as posts, with a featured image.'],
    ['Writing', 'Full posts, notes and Weeknotes, your ideas, the drafts on your site and a writing calendar, in one place.'],
    ['Your blog', 'Visitors, RSS readers and search traffic for your blog, in Writing.'],
  ];
  function paintPlusRow() {
    const row = $('plusRow'); if (!row) return;
    row.hidden = !plusLive();
    const note = $('plusNote'); if (!note) return;
    note.textContent = plusSubscribed() ? (PLUS.exp ? `You have Plus. It renews or ends ${plusDate(dayKey(new Date(PLUS.exp)))}.` : 'You have Plus.')
      : plusGraceUntil() ? `Posting to your site is free for you until ${plusDate(plusGraceUntil())}.`
      : 'Post to your site, Weeknotes and your blog’s stats';
  }
  async function openPlus(why) {
    const el = sheet('plusPanel', `<h2>The Reading Room Plus</h2>
      <p>${why === 'post' ? 'Posting to your own site is part of Plus.' : 'For people who write on their own site.'} Reading, Conversations and My Day stay free.</p>
      <ul class="plus-list">${PLUS_FEATURES.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>
      <div id="plusBuy" class="plus-buy"><p class="note">Getting the price from the App Store…</p></div>
      <p class="acct-note" id="plusMsg" aria-live="polite"></p>
      <p class="note plus-fine">A yearly subscription. It renews automatically each year until you cancel, which you can do anytime in your Apple Account’s Subscriptions, at least a day before it renews. Payment goes through your Apple Account.
        <button class="linkish" type="button" data-mkurl="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">Terms of Use</button> · <button class="linkish" type="button" data-mkurl="https://readingroomapp.com/privacy/">Privacy</button></p>
      <div class="row sheet-foot"><button class="btn" type="button" id="plusRestore">Restore purchases</button><button class="btn primary" type="button" id="plusDone">Done</button></div>`, 'The Reading Room Plus');
    const say = (t, err) => { $('plusMsg').textContent = t; $('plusMsg').classList.toggle('err', !!err); };
    const paint = async () => {
      const box = $('plusBuy');
      if (plusSubscribed()) {
        box.innerHTML = `<p><b>You have Plus.</b> Thank you for supporting The Reading Room.${PLUS.exp ? ` It renews or ends ${esc(plusDate(dayKey(new Date(PLUS.exp))))}.` : ''}</p>
          <button class="btn" type="button" data-mkurl="https://apps.apple.com/account/subscriptions">Manage subscription</button>`;
        return;
      }
      let p = null; try { p = await plusProduct(); } catch {}
      const grace = plusGraceUntil() ? `<p class="note">You already post to your site, so it stays free for you until ${esc(plusDate(plusGraceUntil()))}.</p>` : '';
      if (!p) { box.innerHTML = `${grace}<p class="note">The App Store isn’t answering right now. Try again in a little while.</p>`; return; }
      const trial = plusTrial(p), price = p.formattedPrice || '';
      box.innerHTML = `${grace}<p class="plus-price">${trial ? `Free for a week, then <b>${esc(price)}</b> a year` : `<b>${esc(price)}</b> a year`}</p>
        <button class="btn primary plus-go" type="button" id="plusGo">${trial ? 'Try it free for a week' : `Subscribe for ${esc(price)} a year`}</button>`;
    };
    el.onclick = async e => {
      if (e.target.id === 'plusDone') { el.hidden = true; return; }
      if (e.target.id === 'plusGo' && !PLUS.busy) {
        PLUS.busy = true; say('Opening the App Store…');
        try {
          const r = await tauriInvoke('plugin:iap|purchase', { payload: { productId: PLUS_ID, productType: 'subs' } });
          if (r?.purchaseState === 2) say('Waiting for approval. Plus turns on once it’s approved.');
          await plusRefresh();
          if (plusSubscribed()) { say('Welcome to Plus.'); paint(); renderList(); }
          else if (r?.purchaseState !== 2) say('');
        } catch (err) { say(/cancel/i.test(msg(err)) ? '' : msg(err), !/cancel/i.test(msg(err))); }
        finally { PLUS.busy = false; }
        return;
      }
      if (e.target.id === 'plusRestore' && !PLUS.busy) {
        PLUS.busy = true; say('Checking with the App Store…');
        try { await tauriInvoke('plugin:iap|restore_purchases', { payload: { productType: 'subs' } }); await plusRefresh(); say(plusSubscribed() ? 'Plus is back on.' : 'No Plus subscription found for this Apple Account.', !plusSubscribed()); paint(); }
        catch (err) { say(msg(err), true); }
        finally { PLUS.busy = false; }
      }
    };
    paint();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) plusRefresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (S.view === 'write' || S.view === 'site')) wrLoad(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-plus]')) openPlus(); });
  setTimeout(() => { paintPlusRow(); plusRefresh(); }, 1500);

  // ------------------------------------------------------------ Mastodon and Bluesky: share with a note, and talk
  // Accounts belong to the person: they sign in to their own server, and the sign-in stays in this device's Keychain.
  async function loadAccounts() { try { SOC.accounts = await invoke('social_accounts'); } catch { SOC.accounts = {}; } PLUS.accountsReady = true; plusGraceCheck(); }
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
    return `<h2 id="socialTitle">Your site, Tumblr, Mastodon &amp; Bluesky</h2>
      <p>Connect your own site and accounts to post notes and stories with your thoughts, and to see and answer the replies in Conversations. Sign-ins are kept in Apple’s Keychain and sync to your other Apple devices through iCloud Keychain; they’re sent only to your own site and servers.</p>
      <section class="acct"><h3>${ICONS.site}Your site <small class="acct-sub">WordPress</small></h3>${wp
        ? `<p>Connected to <b>${esc(wp.name)}</b> (${esc(wp.site.replace(/^https?:\/\//, ''))}) as ${esc(wp.user)}. Notes go in a Notes category there.</p><div class="row"><button class="btn" data-disconnect="wordpress">Disconnect</button></div>`
        : `<p>Post short notes to your own site first, then share copies that link back to it. Use an <b>Application Password</b>, not your real password: in WordPress open <button class="b-link" id="wpAppPw" type="button">Users › Profile › Application Passwords</button>, type “The Reading Room” and press Add. You can revoke it anytime.</p>
        <form class="acct-form" id="wpForm"><input id="wpSite" placeholder="yoursite.com" autocapitalize="off" spellcheck="false" autocomplete="url">
        <input id="wpUser" placeholder="WordPress username" autocapitalize="off" spellcheck="false" autocomplete="username">
        <input id="wpPass" type="password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" autocomplete="off"><button class="btn primary" type="submit">Connect</button></form>`}</section>
      ${tumblrAcctHtml()}
      ${micropubAcctHtml()}
      ${row('bluesky', SOC.accounts.bluesky, `<p>Use an <b>App Password</b>, not your real password. Make one in Bluesky under Settings › Privacy and security › <button class="b-link" data-open-url="https://bsky.app/settings/app-passwords">App passwords</button>. You can revoke it anytime.</p>
        <form class="acct-form" id="bskyForm"><input id="bskyHandle" placeholder="you.bsky.social" autocomplete="username" autocapitalize="off" spellcheck="false">
        <input id="bskyPass" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="off"><button class="btn primary" type="submit">Connect</button></form>`)}
      ${row('mastodon', SOC.accounts.mastodon, `<p>Type your server, then approve The Reading Room in the page that opens. Your server shows a code: paste it here.</p>
        <form class="acct-form" id="mastoForm"><input id="mastoServer" placeholder="mastodon.social" autocapitalize="off" spellcheck="false"><button class="btn primary" type="submit">Continue</button></form>
        <form class="acct-form" id="mastoCodeForm" hidden><input id="mastoCode" placeholder="Paste the code" autocapitalize="off" spellcheck="false"><button class="btn primary" type="submit">Connect</button></form>`)}
      <p class="acct-note" id="acctNote" aria-live="polite"></p>
      <div class="row sheet-foot"><button class="btn primary" type="button" id="socialDone">Done</button></div>`;
  }
  // Tumblr: Writing's home when there's no WordPress site; with one, a place to share copies (David, Nov 25)
  function tumblrAcctHtml() {
    const t = SOC.accounts.tumblr, wp = SOC.accounts.wordpress;
    const blogs = t?.blogs || [];
    return `<section class="acct"><h3>${ICON_NET.tumblr}Tumblr</h3>${t
      ? `<p>Connected to <b>${esc(t.name || t.blog)}</b> (${esc(t.blog)}.tumblr.com). ${wp ? 'Your WordPress site stays where Writing posts; Tumblr is offered as a copy when you post.' : 'Writing posts here: notes are tagged “notes”, Weeknotes “weeknotes”.'}</p>
        ${blogs.length > 1 ? `<label class="acct-pick">Post to <select id="tumblrBlog">${blogs.map(b => `<option value="${esc(b.blog)}"${b.blog === t.blog ? ' selected' : ''}>${esc(b.title || b.blog)}</option>`).join('')}</select></label>` : ''}
        <div class="row"><button class="btn" data-disconnect="tumblr">Disconnect</button></div>`
      : `<p>Post to your Tumblr blog: no site to set up and no password to make. Press Connect Tumblr, sign in on Tumblr’s page and approve The Reading Room. A page then shows a code: paste it here. ${wp ? 'With your WordPress site connected, Tumblr is offered as a copy when you post.' : ''}</p>
        <form class="acct-form" id="tumblrForm"><button class="btn primary" type="submit">Connect Tumblr</button></form>
        <form class="acct-form" id="tumblrCodeForm" hidden><input id="tumblrCode" placeholder="Paste the code" autocapitalize="off" spellcheck="false"><button class="btn primary" type="submit">Connect</button></form>`}</section>`;
  }
  // Micro.blog, Pika and other IndieWeb sites, through Micropub (David, Nov 25): sign in on your own site, or paste an app token
  function micropubAcctHtml() {
    const m = SOC.accounts.micropub, wp = SOC.accounts.wordpress;
    return `<section class="acct"><h3>${ICONS.site}Micro.blog, Pika or your IndieWeb site <small class="acct-sub">Micropub</small></h3>${m
      ? `<p>Connected to <b>${esc(m.name || m.handle)}</b> (${esc(m.handle)}). ${wp ? 'Your WordPress site stays where Writing posts.' : 'Writing posts here.'}</p><div class="row"><button class="btn" data-disconnect="micropub">Disconnect</button></div>`
      : `<p>Type your site’s address. If your site has its own sign-in page, it opens: approve The Reading Room and paste the code the next page shows. Micro.blog and Pika can also give you an <b>app token</b> to paste (Micro.blog: Account › Edit Apps; Pika: Settings › App tokens).</p>
        <form class="acct-form" id="mpForm"><input id="mpSite" placeholder="you.micro.blog or you.pika.page" autocapitalize="off" spellcheck="false" autocomplete="url"><button class="btn primary" type="submit">Continue</button></form>
        <form class="acct-form" id="mpCodeForm" hidden><input id="mpCode" placeholder="Paste the code" autocapitalize="off" spellcheck="false"><button class="btn primary" type="submit">Connect</button></form>
        <form class="acct-form" id="mpTokenForm" hidden><input id="mpToken" type="password" placeholder="Paste the app token" autocomplete="off"><button class="btn primary" type="submit">Connect</button></form>
        <p class="note"><button class="b-link" type="button" id="mpUseToken">Use an app token instead</button></p>`}</section>`;
  }
  const ICON_NET = {
    tumblr: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M14.6 21c-3 0-5.2-1.5-5.2-5.2V9.9H6.7V6.7c3-.8 4.3-3.4 4.4-5.7h3.1v5.1h3.6v3.8h-3.6v5.2c0 1.6.8 2.1 2 2.1h1.7V21h-3.3z"/></svg>',
    bluesky: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6.3 4.2C8.6 5.9 11 9.4 12 11.4c1-2 3.4-5.5 5.7-7.2 1.6-1.2 4.3-2.2 4.3.9 0 .6-.4 5.2-.6 5.9-.7 2.5-3.2 3.1-5.5 2.7 4 .7 5 2.9 2.8 5.2-4.2 4.3-6-1.1-6.5-2.5l-.2-.5-.2.5c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.3-1.2-4.5 2.8-5.2-2.3.4-4.8-.2-5.5-2.7C2.4 10.3 2 5.7 2 5.1c0-3.1 2.7-2.1 4.3-.9z"/></svg>',
    mastodon: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M21.3 13.8c-.3 1.5-2.6 3.1-5.3 3.4-1.4.2-2.8.3-4.3.3-2.4-.1-4.3-.6-4.3-.6v.7c.3 2.4 2.4 2.5 4.3 2.6 2 .1 3.7-.5 3.7-.5l.1 1.8s-1.4.7-3.8.9c-1.4.1-3.1-.1-5.1-.6-4.3-1.1-5-5.5-5.2-10V7.6C1.4 3 4.4 1.7 4.4 1.7 5.9 1 8.6.7 11.3.7h.1c2.7 0 5.4.3 6.9 1 0 0 3 1.3 3 5.9 0 0 .1 3.4-.4 5.7zM18.2 8.4c0-1.2-.3-2.1-.9-2.8-.6-.7-1.4-1-2.4-1-1.2 0-2 .4-2.6 1.3l-.6 1-.6-1c-.6-.9-1.4-1.3-2.6-1.3-1 0-1.8.4-2.4 1-.6.7-.9 1.6-.9 2.8v5.6h2.2V8.6c0-1.1.5-1.7 1.4-1.7 1 0 1.6.7 1.6 2v3h2.2v-3c0-1.3.5-2 1.6-2 .9 0 1.4.6 1.4 1.7V14h2.2z"/></svg>',
  };
  // A text box in a sheet grows with what's in it, so a list of questions or rituals is all in view (David, Nov 22:
  // "the reminders list and journal questions input fields are small and do not adjust")
  function growArea(t) { if (!t || t.offsetParent === null) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, Math.round(window.innerHeight * 0.6)) + 'px'; }
  document.addEventListener('input', e => { if (e.target.matches?.('.sheet textarea')) growArea(e.target); });
  function sheet(id, html, label) {
    let el = $(id);
    if (!el) {
      el = document.createElement('div'); el.className = 'overlay'; el.id = id;
      el.addEventListener('mousedown', e => { if (e.target === el) el.hidden = true; });
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
    el.hidden = false; el.querySelector('.sheet').scrollTop = 0;
    requestAnimationFrame(() => el.querySelectorAll('textarea').forEach(growArea));
    return el;
  }
  /** Let a sheet float over the page instead of blocking it: drag it by its .sheet-grip, double-click the grip to
   *  put it back in the middle. Where it was left is remembered under `key`. Part of the grip always stays on screen. */
  function floatSheet(el, key) {
    el.classList.add('floating');
    const sh = el.querySelector('.sheet'), grip = el.querySelector('.sheet-grip');
    let pos = { x: 0, y: 0 }; try { pos = { x: 0, y: 0, ...JSON.parse(store.get(key) || '{}') }; } catch {}
    const place = (x, y, fit) => {
      sh.style.transform = ''; const r = sh.getBoundingClientRect(); // where it sits in the middle
      const keep = 72, vw = innerWidth, vh = innerHeight;
      x = Math.min(Math.max(x, keep - r.right), vw - keep - r.left);
      if (fit) x = Math.min(Math.max(x, 8 - r.left), vw - 8 - r.right), y = Math.min(y, vh - 8 - r.bottom); // all of it on screen
      y = Math.min(Math.max(y, -r.top), vh - 56 - r.top);
      pos = { x: Math.round(x), y: Math.round(y) };
      sh.style.transform = pos.x || pos.y ? `translate(${pos.x}px, ${pos.y}px)` : '';
    };
    const save = () => store.set(key, pos.x || pos.y ? JSON.stringify(pos) : '');
    requestAnimationFrame(() => place(pos.x, pos.y));
    if (!grip) return;
    grip.onpointerdown = e => {
      if (e.button || e.target.closest('button, a, input')) return;
      e.preventDefault();
      const sx = e.clientX - pos.x, sy = e.clientY - pos.y;
      grip.setPointerCapture(e.pointerId); sh.classList.add('dragging');
      grip.onpointermove = m => place(m.clientX - sx, m.clientY - sy);
      grip.onpointerup = grip.onpointercancel = () => { grip.onpointermove = grip.onpointerup = grip.onpointercancel = null; sh.classList.remove('dragging'); save(); };
    };
    grip.ondblclick = e => { if (e.target.closest('button')) return; place(0, 0); save(); };
    el._refloat = () => place(pos.x, pos.y);
    // change the sheet's size (tuck it away, open it again) without its top bar jumping: it stays where it was put
    el._resize = (change, fit) => {
      const a = sh.getBoundingClientRect(); change(); sh.style.transform = '';
      const b = sh.getBoundingClientRect(); place(a.left - b.left, a.top - b.top, fit); save();
    };
    if (!el.dataset.floatResize) { el.dataset.floatResize = '1'; addEventListener('resize', () => { if (!el.hidden) el._refloat?.(); }); }
  }
  async function openAccounts() {
    await loadAccounts();
    const el = sheet('socialPanel', accountsHtml(), 'Your site, Mastodon and Bluesky');
    const note = (t, err) => { $('acctNote').textContent = t; $('acctNote').classList.toggle('err', !!err); };
    el.onclick = async e => {
      if (e.target.id === 'socialDone') { el.hidden = true; return; }
      const u = e.target.closest('[data-open-url]'); if (u) { invoke('open_external', { url: u.dataset.openUrl }).catch(() => {}); return; }
      const d = e.target.closest('[data-disconnect]');
      if (d) { const n = d.dataset.disconnect; SOC.accounts = await invoke(n === 'tumblr' ? 'tumblr_disconnect' : n === 'micropub' ? 'micropub_disconnect' : 'social_disconnect', { network: n }); SOC.conv = null; WR.at = 0; BLOG.data = null; TBL.data = null; openAccounts(); renderRail(); }
    };
    // Micropub: find the site, then its sign-in page (and a code) or an app token
    const mpBegin = async wantToken => {
      note('Looking at your site…');
      try {
        const url = await invoke('micropub_begin', { site: $('mpSite').value });
        $('mpForm').hidden = true;
        if (url && !wantToken) { await invoke('open_external', { url }); $('mpCodeForm').hidden = false; $('mpCode').focus(); note('Approve The Reading Room on your site’s page, then paste the code the next page shows.'); }
        else { $('mpTokenForm').hidden = false; $('mpToken').focus(); note(url ? 'Paste an app token from your site’s settings.' : 'Your site doesn’t have a sign-in page for apps. Paste an app token from its settings.'); }
      } catch (err) { note(msg(err), true); }
    };
    $('mpForm')?.addEventListener('submit', e => { e.preventDefault(); mpBegin(false); });
    $('mpUseToken')?.addEventListener('click', () => { if (!($('mpSite')?.value || '').trim()) { note('Type your site’s address first.', true); $('mpSite').focus(); return; } mpBegin(true); });
    const mpFinish = async args => {
      note('Connecting to your site…');
      try { SOC.accounts = await invoke('micropub_finish', args); WR.at = 0; BLOG.data = null; TBL.data = null; openAccounts(); renderRail(); }
      catch (err) { note(msg(err), true); }
    };
    $('mpCodeForm')?.addEventListener('submit', e => { e.preventDefault(); mpFinish({ code: $('mpCode').value, token: null }); });
    $('mpTokenForm')?.addEventListener('submit', e => { e.preventDefault(); mpFinish({ code: null, token: $('mpToken').value }); });
    $('tumblrBlog')?.addEventListener('change', async e => {
      try { SOC.accounts = await invoke('tumblr_pick_blog', { blog: e.target.value }); WR.at = 0; BLOG.data = null; TBL.data = null; note(`Posting to ${e.target.selectedOptions[0].textContent} now.`); renderRail(); }
      catch (err) { note(msg(err), true); }
    });
    $('tumblrForm')?.addEventListener('submit', async e => {
      e.preventDefault(); note('Opening Tumblr…');
      try {
        await invoke('open_external', { url: await invoke('tumblr_begin') });
        $('tumblrForm').hidden = true; $('tumblrCodeForm').hidden = false; $('tumblrCode').focus();
        note('Sign in on Tumblr’s page and approve The Reading Room, then paste the code the next page shows.');
      } catch (err) { note(msg(err), true); }
    });
    $('tumblrCodeForm')?.addEventListener('submit', async e => {
      e.preventDefault(); note('Connecting to Tumblr…');
      try { SOC.accounts = await invoke('tumblr_finish', { code: $('tumblrCode').value }); WR.at = 0; BLOG.data = null; TBL.data = null; openAccounts(); renderRail(); }
      catch (err) { note(msg(err), true); }
    });
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
  $('plusBtn').onclick = () => { closeSettings(); openPlus(); };

  // ------------------------------------------------------------ Settings
  // The links that used to fill the bottom of the sidebar live here now. Each keeps its own handler;
  // choosing one closes Settings and opens that panel.
  const closeSettings = () => { $('settingsPanel').hidden = true; };
  const paintOfflineSetting = () => invoke('offline_usage').then(u => { const n = $('offlineNote'); if (n) n.textContent = u.count ? `${u.count} saved on this ${deviceName()}, ${mb(u.bytes)}. Remove them all` : 'Podcast episodes and videos you save play without a connection'; }).catch(() => {});
  $('offlineBtn') && ($('offlineBtn').onclick = async () => {
    const u = await invoke('offline_usage').catch(() => ({ count: 0 }));
    if (!u.count) { status('Nothing saved for offline yet. Open a podcast episode or a video and choose Save for offline.'); return; }
    if (!confirm(`Remove all ${u.count} saved episodes and videos (${mb(u.bytes)}) from this ${deviceName()}? You can save them again any time.`)) return;
    await invoke('offline_clear').catch(e => status(msg(e), true)); OFF.map = {}; OFF.save(); renderList(); status('Removed everything saved for offline.');
  });
  $('settingsBtn').onclick = () => { paintShowSettings(); paintOfflineSetting(); $('setVer').textContent = APP.version ? `The Reading Room ${APP.version}` : ''; $('settingsPanel').hidden = false; $('settingsPanel').querySelector('.sheet').scrollTop = 0; $('settingsDone').focus({ preventScroll: true }); };
  $('settingsPanel').addEventListener('mousedown', e => { if (e.target.id === 'settingsPanel') closeSettings(); });
  $('settingsDone').onclick = e => { e.stopPropagation(); closeSettings(); };
  // Help and feedback: GitHub issues (the app has no server or mail of its own), the App Store's review page, the support page
  const openOut = url => invoke('open_external', { url }).catch(e => status(msg(e), true));
  const deviceName = () => APP.platform === 'ios' ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && !phoneSize.matches ? 'iPad' : 'iPhone') : APP.platform === 'macos' ? 'Mac' : 'computer';
  $('feedbackBtn').onclick = () => {
    const body = `**What happened, or what would you like?**\n\n\n**Steps to see it (if it's a problem)**\n\n\n---\nThe Reading Room ${APP.version || ''} on ${deviceName()}`;
    openOut('https://github.com/DVDaniels/TheReadingRoom/issues/new?body=' + encodeURIComponent(body));
  };
  $('rateBtn').onclick = () => openOut('https://apps.apple.com/app/id6828213191?action=write-review');
  $('supportBtn').onclick = () => openOut('https://readingroomapp.com/support/');
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
    if (!MAIL.account || MAIL.checking || bridgeAway() || hiddenViews().has('email')) return;
    if (quiet && Date.now() - MAIL.last < 120e3) return;
    MAIL.checking = true; MAIL.last = Date.now();
    const before = new Set(S.items.filter(isEmailItem).map(i => i.id));
    if (S.view === 'email') { renderList(); renderHead(); }
    try {
      const r = await invoke('email_refresh'), n = r?.added || 0;
      MAIL.error = ''; MAIL.inbox = r?.inbox ?? null; MAIL.checkedAt = new Date();
      if (n && !quiet) status(`${n} new ${n === 1 ? 'email' : 'emails'}.`);
      if (n) { await load(); await loadMailMeta(); mailAlert(S.items.filter(i => isEmailItem(i) && !before.has(i.id) && !i.read && !isNewsletter(i))); }
    } catch (e) { MAIL.error = msg(e); }
    MAIL.checking = false;
    await loadMailMeta();
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
    const fk = mailFolder(), fname = (MAIL.folders || []).find(f => f.kind === fk)?.name;
    const fnote = fk === 'inbox' ? '' : `<p class="mail-fnote">${MAIL.folderBusy === fk ? 'Getting the newest emails…' : { sent: 'Emails you sent from this mailbox.', archive: 'Emails you archived. Move one back with Move to Inbox.', trash: 'Emails you deleted. Your mail service empties the Trash on its own; Move to Inbox brings one back.', spam: 'Emails your mail service thinks are junk. Not spam puts one in your inbox.' }[fk]}${fname && fname !== MAIL_FOLDERS[fk] ? ` <span>(“${esc(fname)}” in your mailbox)</span>` : ''}${fk === 'trash' ? ` <button class="linkish mail-empty" type="button" data-mailempty>Empty Trash…</button>` : ''}</p>`;
    if (!problems.length) return fnote + mailAlertsOfferHtml() + mailKindsHtml();
    return fnote + mailAlertsOfferHtml() + mailKindsHtml() + `<div class="mailbar mail-problem"><div>${problems.join('')}</div>
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
      <p>Connect one mailbox to read its inbox in the Email tab and reply from it. Best: an address on your own domain that you use only for this app, like reading@yoursite.com. The app reads the inbox; it only moves an email when you archive it or delete it (to the Trash).</p>
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
        <label>Pictures from the web <span class="hint">(they tell the sender when you read their email)</span><select id="mailPics">
          <option value="ask"${mailPicsMode() === 'ask' ? ' selected' : ''}>Ask first: show them with Show pictures</option>
          <option value="always"${mailPicsMode() === 'always' ? ' selected' : ''}>Always show them</option></select></label>
        <label class="mail-check"><input id="mailAlerts" type="checkbox"${S.prefs.mailAlerts === true ? ' checked' : ''}> Alert me when a person writes to me <span class="hint">(never for newsletters)</span></label>
        ${(S.prefs.mailPicsFrom || []).length ? `<p class="note" id="mailPicsFromNote">Always shown from ${esc(S.prefs.mailPicsFrom.join(', '))}. <button class="linkish" type="button" id="mailPicsClear">Forget these</button></p>` : ''}
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
    $('mailAlerts').onchange = () => { S.prefs.mailAlerts = $('mailAlerts').checked; MAIL.offerAlerts = false; savePrefs(); };
    $('mailPics').onchange = () => { S.prefs.mailPics = $('mailPics').value; savePrefs(); if (S.readerId) paintArticle(); };
    if ($('mailPicsClear')) $('mailPicsClear').onclick = () => { S.prefs.mailPicsFrom = []; savePrefs(); $('mailPicsFromNote')?.remove(); };
    if ($('mailOff')) $('mailOff').onclick = async () => {
      const btn = $('mailOff');
      if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Disconnect this mailbox?'; return; }
      await invoke('email_disconnect').catch(() => {});
      await loadMailAccount(); MAIL.folders = []; store.set('mailFolder', 'inbox'); el.hidden = true; render();
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
        store.set('mailFolder', 'inbox'); MAIL.folderAt = {};
        selectView('email');
        checkMail(); loadMailFolders();
      } catch (err) { note(msg(err), true); go.disabled = false; go.textContent = a ? 'Save' : 'Connect'; }
    };
  }


  // ---- Email in the reader: pictures from the web, attached files, more ways to answer, the conversation
  // Pictures from the web tell the sender when (and where) you read their email. Unless you say otherwise
  // (Email settings, or Always for this sender), they wait for Show pictures. Pictures sent inside the email
  // (data:) show at once: loading them tells no one anything.
  const mailPicsMode = () => S.prefs.mailPics || 'ask';
  const mailPicsOk = it => {
    if (mailPicsMode() === 'always' || MAIL.showPics.has(it.id)) return true;
    const from = (mailMeta(it).from || '').toLowerCase();
    return !!from && (S.prefs.mailPicsFrom || []).includes(from);
  };
  function mailHoldPictures(f, it) {
    if (mailPicsOk(it)) return 0;
    let n = 0;
    f.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (!/^https?:/i.test(src)) return;
      img.dataset.rrSrc = src; img.removeAttribute('src'); img.removeAttribute('srcset'); n++;
      const alt = (img.getAttribute('alt') || '').trim(), w = Number(img.getAttribute('width')) || 0;
      // a held picture with something to say shows its description; small ones (logos, icons) just wait
      if (alt.length > 3 && !(w > 0 && w < 100) && !/^[\w-]+\.(jpe?g|png|gif|webp|heic)$/i.test(alt)) { const t = document.createElement('span'); t.className = 'mail-alt held'; t.textContent = alt; img.after(t); }
      img.hidden = true;
    });
    return n;
  }
  function mailPicsBar(it, n) {
    const el = document.createElement('div'); el.className = 'mail-pics';
    const from = mailMeta(it).from || '';
    el.innerHTML = `<span>${n === 1 ? 'A picture from the web is' : `${n} pictures from the web are`} held back, so the sender can't tell when you read this.</span>
      <span class="mp-acts"><button class="btn" type="button" data-mailpics="once">Show pictures</button>${from ? `<button class="linkish" type="button" data-mailpics="sender">Always for ${esc(from)}</button>` : ''}</span>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-mailpics]'); if (!b) return;
      if (b.dataset.mailpics === 'sender') { S.prefs.mailPicsFrom = [...new Set([...(S.prefs.mailPicsFrom || []), from.toLowerCase()])]; savePrefs(); status(`Pictures from ${from} will always show. Change it in Email settings.`); }
      MAIL.showPics.add(it.id); paintArticle();
    });
    return el;
  }
  // Attached files: Open (Mac) or Share (iPhone, iPad), and Save… on the Mac. The file is downloaded again from your inbox.
  function mailFiles(f, it) {
    f.querySelectorAll('[data-rr-file]').forEach(sp => {
      const k = Number(sp.dataset.rrFile), name = sp.textContent;
      const li = sp.closest('li') || sp;
      const acts = document.createElement('span'); acts.className = 'ma-acts';
      acts.innerHTML = IOS ? `<button class="btn" type="button" data-mailfile="share">Open…</button>`
        : `<button class="btn" type="button" data-mailfile="open">Open</button><button class="btn" type="button" data-mailfile="save">Save…</button>`;
      acts.addEventListener('click', async e => {
        const b = e.target.closest('[data-mailfile]'); if (!b || b.disabled) return;
        const how = b.dataset.mailfile, was = b.textContent; b.disabled = true; b.textContent = 'Getting it…';
        try {
          if (how === 'share') {
            const r = await invoke('email_attachment', { itemId: it.id, index: k, action: 'data' });
            const bin = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
            const file = new File([bin], r.name || name, { type: r.mime || 'application/octet-stream' });
            if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (err) { if (err?.name !== 'AbortError') status(msg(err), true); } }
            else status('This file can’t be opened here. Open the email in your email app.', true);
          } else {
            const r = await invoke('email_attachment', { itemId: it.id, index: k, action: how });
            if (r?.saved) status(`Saved ${r.name}.`); else if (r?.opened) status(`Opened ${r.name}.`);
          }
        } catch (err) { status(msg(err), true); }
        b.disabled = false; b.textContent = was;
      });
      li.appendChild(acts);
    });
    const box = f.querySelector('[data-rr-att]');
    if (box) { const p = document.createElement('p'); p.className = 'ma-note'; p.textContent = 'Each file is downloaded from your mailbox when you open it; the app doesn’t keep a copy.'; box.appendChild(p); }
  }
  // Under the sender: Reply all, Forward, Unsubscribe, and their blog if you follow it.
  // At the end: the rest of the conversation.
  const FREE_MAIL = /^(gmail|googlemail|icloud|me|mac|yahoo|ymail|outlook|hotmail|live|msn|aol|proton|protonmail|pm|gmx|fastmail|hey|zoho|substack|buttondown|mailchimp|ghost|convertkit|beehiiv)\./i;
  function mailBlogFeed(it) {
    const from = (mailMeta(it).from || '').toLowerCase(), dom = from.split('@')[1] || '';
    if (!dom || FREE_MAIL.test(dom)) return null;
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
    return S.feeds.find(f => !isEmailFeed(f) && (host(f.site) === dom || host(f.url) === dom || host(f.site).endsWith('.' + dom))) || null;
  }
  function paintMailExtras() {
    const it = item(S.readerId), body = $('rBody'); if (!it || !isEmailItem(it) || !body) return;
    const meta = mailMeta(it), head = body.querySelector('.mail-head'); if (!head) return;
    body.querySelector('.mh-acts')?.remove();
    const others = [meta.to, meta.cc].join(',').split(',').map(x => x.trim().toLowerCase()).filter(x => x && x !== (MAIL.account?.address || '').toLowerCase() && x !== (meta.from || '').toLowerCase());
    const blog = mailBlogFeed(it);
    const acts = document.createElement('div'); acts.className = 'mh-acts';
    const inSent = mailFolderOf(it) === 'sent';
    acts.innerHTML = `${others.length && !inSent ? `<button class="linkish" type="button" data-mailact="all" title="Reply to ${esc(others.length + 1 + ' people')}">Reply all</button>` : ''}
      <button class="linkish" type="button" data-mailact="fwd">Forward</button>
      ${meta.bulk ? '<button class="linkish" type="button" data-mailact="feed" title="Many newsletters also publish a feed: read them with your other feeds">Follow as a feed</button>' : ''}
      ${meta.unsub ? '<button class="linkish" type="button" data-mailact="unsub">Unsubscribe</button>' : ''}
      ${blog ? `<button class="linkish mh-blog" type="button" data-view="${esc(String(blog.id))}" title="See their posts">You follow their blog, ${esc(blog.title)}</button>` : ''}`;
    head.after(acts);
    acts.addEventListener('click', e => {
      const b = e.target.closest('[data-mailact]'); if (!b) return;
      if (b.dataset.mailact === 'all') openMailReply(it, { all: true });
      if (b.dataset.mailact === 'fwd') openMailForward(it);
      if (b.dataset.mailact === 'unsub') mailUnsubscribe(it);
      if (b.dataset.mailact === 'feed') mailFollowFeed(it, b);
    });
    body.querySelector('.mail-conv')?.remove();
    const conv = mailThreadOf(it).filter(x => x.id !== it.id);
    if (conv.length) {
      const el = document.createElement('section'); el.className = 'mail-conv';
      el.innerHTML = `<h3>In this conversation</h3>${conv.map(x => `<button type="button" class="mc-item${x.read ? '' : ' unread'}" data-open="${esc(x.id)}"><b>${esc(srcLabel(x))}</b><time>${esc(mailWhen(x.date))}</time><span>${esc(mailSnip(x.summary) || headline(x))}</span></button>`).join('')}`;
      el.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openReader(b.dataset.open); });
      body.appendChild(el);
    }
  }
  // The email as plain text, for quoting in a reply or a forward (without the earlier email it quotes)
  function mailText(it) {
    const f = mailFragment(it.id === S.readerId ? articleHtml : '');
    tidyMail(f, it);
    f.querySelectorAll('details.mail-quote, .mail-foot, [data-rr-att], .mail-web').forEach(n => n.remove());
    const box = document.createElement('div'); box.appendChild(f);
    box.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    box.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, blockquote, table').forEach(b => b.append('\n'));
    box.querySelectorAll('a[href^="http"]').forEach(a => { if (a.textContent.trim() && a.textContent.trim() !== a.href) a.append(` <${a.href}>`); });
    return box.textContent.replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const mailFrom = async it => { try { return await invoke('email_from', { itemId: it.id }); } catch { return {}; } };
  const mailLongDate = d => new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  async function openMailForward(it) {
    const r = await mailFrom(it), text = mailText(it);
    const t = document.createElement('template'); t.innerHTML = it.id === S.readerId ? articleHtml : '';
    const fromFiles = [...t.content.querySelectorAll('[data-rr-file]')].map(sp => ({ index: Number(sp.dataset.rrFile), name: sp.textContent.trim() }));
    const fwd = `---------- Forwarded message ----------\nFrom: ${r.name || srcLabel(it)}${r.address ? ` <${r.address}>` : ''}\nDate: ${mailLongDate(it.date)}\nSubject: ${headline(it)}\n\n${text}`;
    openMailCompose({ subject: /^fwd?:/i.test(headline(it)) ? headline(it) : `Fwd: ${headline(it)}`, quote: fwd, fwd: it.id, fromFiles,
      note: fromFiles.length ? `Untick a file to leave it out.` : '' });
  }
  // A newsletter as a feed: found on its site, followed in your reader, and (if you like) unsubscribed from
  async function mailFollowFeed(it, btn) {
    const who = srcLabel(it), was = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Looking for its feed…'; }
    let r = null;
    try { r = await invoke('email_newsletter_feed', { itemId: it.id }); } catch (e) { status(msg(e), true); }
    if (btn) { btn.disabled = false; btn.textContent = was; }
    if (!r?.feed) { status(`${who} doesn't seem to have a feed. Not every newsletter does.`); return; }
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const have = S.feeds.find(f => f.url === r.feed || (host(f.site) && host(f.site) === host(r.site)));
    if (have) { status(`You already follow ${have.title}.`); return; }
    const name = r.title || who, canUnsub = !!mailMeta(it).unsub;
    showBanner(`<span><b>${esc(name)}</b> has a feed. Follow it with your other feeds${canUnsub ? ', and stop the emails' : ''}? New posts arrive in your reader instead of your inbox.</span>
      <span class="row"><button class="btn primary" id="nfYes">${canUnsub ? 'Follow and unsubscribe' : 'Follow'}</button>${canUnsub ? '<button class="btn" id="nfOnly">Just follow</button>' : ''}<button class="btn" id="nfNo">Cancel</button></span>`, false, 'confirm');
    $('nfNo').onclick = hideBanner;
    const go = async unsub => {
      hideBanner(); status(`Following ${name}…`);
      try { const a = await invoke('add_feed', { url: r.feed, title: null, folderId: null }); await load(); status(`Following ${a?.title || name}. Its posts arrive with your feeds.`); }
      catch (e) { status(msg(e), true); return; }
      if (unsub) mailUnsubscribe(it, true);
    };
    $('nfYes').onclick = () => go(canUnsub);
    if ($('nfOnly')) $('nfOnly').onclick = () => go(false);
  }
  async function mailUnsubscribe(it, already = false) {
    const who = srcLabel(it);
    showBanner(`<span>Unsubscribe from ${esc(who)}? The app asks their mailing list to take your address off. Emails already here stay.</span><button class="btn primary" id="unsubYes">Unsubscribe</button><button class="btn" id="unsubNo">Cancel</button>`, false, 'confirm');
    $('unsubNo').onclick = hideBanner;
    if (already) { hideBanner(); setTimeout(() => $('unsubYes')?.onclick?.(), 0); }
    $('unsubYes').onclick = async () => {
      hideBanner(); status(`Unsubscribing from ${who}…`);
      try {
        const r = await invoke('email_unsubscribe', { itemId: it.id });
        if (r.how === 'done') status(`Unsubscribed from ${who}.`);
        else if (r.how === 'emailed') status(`Sent ${who} an email asking to unsubscribe (to ${r.to}). It can take a few days.`);
        else if (r.url) { openWeb(r.url); status(`${who} asks you to finish on their page.`); }
      } catch (e) { status(msg(e), true); }
    };
  }
  // ---- writing: one sheet for new emails, replies and Write back. Your signature goes at the end.
  const DEFAULT_SIG = '—\nSent from The Reading Room\nhttps://readingroomapp.com';
  const mailSig = () => (typeof S.prefs.mailSig === 'string' ? S.prefs.mailSig : DEFAULT_SIG);
  const withSig = body => { const sig = mailSig().trim(); return `${body || ''}${sig ? `\n\n${sig}` : ''}`; };

  async function openMailReply(it, { all = false } = {}) {
    try {
      const r = await invoke('email_reply_to', { itemId: it.id });
      // the email you're answering goes below your signature, as Mail does it
      const text = mailText(it), from = await mailFrom(it);
      const quote = text ? `On ${mailLongDate(it.date)}, ${from.name || r.name || srcLabel(it)}${from.address ? ` <${from.address}>` : ''} wrote:\n${text.slice(0, 6000).split('\n').map(l => '> ' + l).join('\n')}` : '';
      openMailCompose({ to: r.to, toName: r.name, subject: r.subject, replyTo: it.id, all: all && (r.cc || []).length ? r.cc : null, quote });
    } catch (e) { status(msg(e), true); }
  }

  // Unfinished emails are kept on this device as drafts: one per email you're answering (Reply and Reply all
  // apart), one forward, one new email. They come back the next time, and go once the email is sent.
  const draftKey = (replyTo, all, fwd) => replyTo ? `mailDraft:${replyTo}${all ? ':all' : ''}` : fwd ? `mailDraft:fwd:${fwd}` : 'mailDraft:new';
  const draftGet = k => { try { return JSON.parse(store.get(k) || 'null'); } catch { return null; } };
  const draftSet = (k, v) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch {} };
  const mailHasDraft = id => !!(store.get(`mailDraft:${id}`) || store.get(`mailDraft:${id}:all`));
  // Addresses to suggest in To: people who wrote to you or were on their emails (not newsletters), and you
  function mailContacts() {
    // (and not the addresses machines send from: no-reply, alerts, orders, receipts and the like)
    const robot = a => /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|orders?|receipts?|billing|invoices?|news|newsletters?|deals|offers|marketing|promo|info|support|help|hello|team|updates?|digest|scan|scanner|system|admin|automated|auto)([-+._].*)?$/i.test(a.split('@')[0]);
    const me = (MAIL.account?.address || '').toLowerCase(), seen = new Map();
    for (const it of S.items) {
      if (!isEmailItem(it)) continue;
      const m = mailMeta(it); if (m.bulk) continue;
      const from = (m.from || '').toLowerCase();
      if (from && from !== me && !robot(from) && !seen.has(from)) seen.set(from, it.byline || srcLabel(it));
      for (const x of [m.to, m.cc].join(',').split(',')) { const a = x.trim().toLowerCase(); if (a && a !== me && a.includes('@') && !robot(a) && !seen.has(a)) seen.set(a, ''); }
    }
    return [...seen].slice(0, 300);
  }
  const fileSize = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  const toB64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error(`Couldn't read ${file.name}.`)); r.readAsDataURL(file); });

  function openMailCompose({ to = '', toName = '', subject = '', body = '', replyTo = null, all = null, quote = '', note: extra = '', fwd = null, fromFiles = [] } = {}) {
    if (!MAIL.account) { openMailSettings(); status('Connect your email first.'); return; }
    const fixedTo = !!replyTo, key = draftKey(replyTo, all, fwd);
    const title = replyTo ? (all ? 'Reply all' : 'Reply') : quote ? 'Forward' : 'New email';
    const el = sheet('mailComposePanel', `<h2>${title}</h2>
      <div class="mail-form mc-fields">
        <label class="mc-line"><span>To</span>${fixedTo ? `<span class="mc-fixed">${esc(toName && toName !== to ? `${toName} <${to}>` : to)}</span>` : `<input id="mcTo" type="email" list="mcToList" value="${esc(to)}" placeholder="name@example.com" spellcheck="false" autocapitalize="off" autocomplete="off"><datalist id="mcToList">${mailContacts().map(([a, n]) => `<option value="${esc(a)}"${n ? ` label="${esc(n)}"` : ''}></option>`).join('')}</datalist>`}</label>
        ${all ? `<div class="mc-line"><span>Cc</span><span class="mc-fixed">${esc(all.join(', '))}</span></div>` : ''}
        <label class="mc-line"><span>Subject</span>${fixedTo ? `<span class="mc-fixed">${esc(subject)}</span>` : `<input id="mcSubj" type="text" value="${esc(subject)}">`}</label>
        <div class="mc-line"><span>From</span><span class="mc-fixed">${esc(MAIL.account.name ? `${MAIL.account.name} <${MAIL.account.address}>` : MAIL.account.address)}</span></div>
      </div>
      <textarea id="mcBody" rows="11"></textarea>
      <div class="mc-files" id="mcFiles"></div>
      <p class="note" id="mcNote"></p>
      <div class="row sheet-foot"><label class="btn mc-attach" title="Attach files (up to 20 MB in all)">Attach…<input id="mcPick" type="file" multiple hidden></label><button class="btn" type="button" id="mcCancel">Cancel</button><button class="btn primary" type="button" id="mcSend">Send</button></div>`, title);
    const box = $('mcBody');
    box.value = withSig(body.startsWith('\n') ? body : body ? `\n\n${body}` : '') + (quote ? `\n\n${quote}` : '');
    const untouched = box.value;
    const baseNote = `${extra ? extra + ' ' : ''}Sent from your mailbox and filed in its Sent folder. Change the signature in Email settings.`;
    const note = (t, err) => { $('mcNote').textContent = t; $('mcNote').classList.toggle('err', !!err); };
    note(baseNote);
    // files: ones you pick, and (forwarding) the email's own files, ticked to go along
    const files = [], orig = fromFiles.map(f => ({ ...f, on: true }));
    const paintFiles = () => {
      $('mcFiles').innerHTML = [...orig.map((f, k) => `<label class="mc-file${f.on ? '' : ' off'}"><input type="checkbox" data-orig="${k}"${f.on ? ' checked' : ''}> ${esc(f.name)} <small>from the email</small></label>`),
        ...files.map((f, k) => `<span class="mc-file">${esc(f.name)} <small>${fileSize(f.size)}</small><button type="button" class="linkish" data-drop="${k}" aria-label="Remove ${esc(f.name)}">×</button></span>`)].join('');
    };
    paintFiles();
    $('mcFiles').addEventListener('click', e => { const d = e.target.closest('[data-drop]'); if (d) { files.splice(Number(d.dataset.drop), 1); paintFiles(); } });
    $('mcFiles').addEventListener('change', e => { const c = e.target.closest('[data-orig]'); if (c) { orig[Number(c.dataset.orig)].on = c.checked; paintFiles(); } });
    $('mcPick').onchange = () => {
      for (const f of $('mcPick').files) files.push({ file: f, name: f.name, size: f.size, mime: f.type || 'application/octet-stream' });
      $('mcPick').value = ''; paintFiles();
      const total = files.reduce((n, f) => n + f.size, 0);
      note(total > 20 * 1048576 ? `That's ${fileSize(total)} of files: most mail servers won't send more than 20 MB.` : baseNote, total > 20 * 1048576);
    };
    // the draft: back if there is one, kept as you type
    const saved = draftGet(key);
    if (saved && saved.body && saved.body.trim() !== untouched.trim()) {
      box.value = saved.body;
      if (!fixedTo) { if (saved.to) $('mcTo').value = saved.to; if (saved.subject) $('mcSubj').value = saved.subject; }
      note('Your unfinished draft is back. ' + baseNote);
    }
    const keep = () => draftSet(key, box.value.trim() !== untouched.trim() || (!fixedTo && $('mcTo').value.trim() !== to) ? { body: box.value, to: fixedTo ? '' : $('mcTo').value, subject: fixedTo ? '' : $('mcSubj').value, at: Date.now() } : null);
    let typing = 0;
    el.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(keep, 400); });
    $('mcCancel').onclick = () => {
      clearTimeout(typing); keep(); el.hidden = true;
      if (draftGet(key)) { status('Kept as a draft. It comes back when you open this again.'); if (S.view === 'email') renderList(); }
    };
    setTimeout(() => { if (!fixedTo && !$('mcTo').value) $('mcTo').focus(); else { box.focus(); box.setSelectionRange(0, 0); box.scrollTop = 0; } }, 30);
    $('mcSend').onclick = async () => {
      const text = box.value, b = $('mcSend');
      if (!text.replace(mailSig(), '').trim() || (!quote.startsWith('-') && text.trim() === untouched.trim() && !files.length)) { note('Write something first.', true); return; }
      b.disabled = true; b.textContent = files.length || orig.some(f => f.on) ? 'Attaching…' : 'Sending…'; note('');
      try {
        const out = [];
        for (const f of orig.filter(f => f.on)) { const r = await invoke('email_attachment', { itemId: fwd, index: f.index, action: 'data' }); out.push({ name: r.name, mime: r.mime, data: r.data }); }
        for (const f of files) out.push({ name: f.name, mime: f.mime, data: await toB64(f.file) });
        b.textContent = 'Sending…';
        const sentTo = replyTo
          ? await invoke('email_reply', { itemId: replyTo, body: text, all: !!all, files: out })
          : await invoke('email_send', { to: $('mcTo').value, subject: $('mcSubj').value, body: text, files: out });
        clearTimeout(typing); draftSet(key, null);
        el.hidden = true; status(`Sent to ${sentTo}${out.length ? ` with ${out.length === 1 ? 'a file' : `${out.length} files`}` : ''}.`);
        if (S.view === 'email') renderList();
      } catch (e) { note(msg(e), true); b.disabled = false; b.textContent = 'Send'; }
    };
  }
  $('mailNew').onclick = () => openMailCompose();
  $('rDelete').onclick = () => { const it = item(S.readerId); if (it) deleteMail(it); };
  // Archive and Delete leave the Email tab at once, and reach your mailbox a few seconds later: until then,
  // Undo puts them back. (Another archive or delete in the meantime sends the first one on its way.)
  let mailPending = null;
  function mailLater(kind, items, run) {
    mailFlush();
    const gone = new Set(items.filter(x => kind === 'delete' || !x.saved).map(x => x.id));
    const list = visible(), first = list.findIndex(x => gone.has(x.id)), next = list.slice(first + 1).concat(list.slice(0, Math.max(0, first)).reverse()).find(x => !gone.has(x.id));
    const wasOpen = items.some(x => x.id === S.readerId);
    const kept = S.items.filter(x => gone.has(x.id));
    S.items = S.items.filter(x => !gone.has(x.id));
    if (wasOpen) { if (next && isSplit()) openReader(next.id); else closeReader(); }
    render();
    const what = items.length > 1 ? `the conversation (${items.length} emails)` : `“${clipT(headline(items[0]), 50)}”`;
    showBanner(`<span>${kind === 'delete' ? 'Deleted' : 'Archived'} ${esc(what)}.</span><button class="btn" id="mailUndo">Undo</button>`, false, 'mail-undo');
    const p = mailPending = { kind, run, kept, timer: setTimeout(() => mailFlush(), 6000) };
    $('mailUndo').onclick = () => {
      if (mailPending !== p) return;
      clearTimeout(p.timer); mailPending = null; hideBanner();
      S.items = [...S.items, ...p.kept].sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      render(); status(kind === 'delete' ? 'Not deleted.' : 'Not archived.');
    };
  }
  async function mailFlush() {
    const p = mailPending; if (!p) return;
    mailPending = null; clearTimeout(p.timer);
    if ($('banner').dataset.kind === 'mail-undo') hideBanner();
    try { const msgText = await p.run(); if (msgText) status(msgText); } catch (e) { status(msg(e), true); load(); }
  }
  // the app going to the background, or closing: what's waiting goes now
  document.addEventListener('visibilitychange', () => { if (document.hidden) mailFlush(); });
  window.addEventListener('pagehide', () => mailFlush());
  function deleteMail(it) {
    if (!it || !isEmailItem(it)) return;
    mailLater('delete', [it], async () => { const folder = await invoke('email_delete', { itemId: it.id }); return folder ? `Moved to ${folder}.` : ''; });
  }
  $('mailSet').onclick = () => openMailSettings();
  $('mailCheck').onclick = () => { if (mailFolder() !== 'inbox') { (MAIL.folderAt ||= {})[mailFolder()] = 0; openMailFolder(mailFolder()); } else refresh(); };

  function mailSub() {
    if (!MAIL.account) return 'Read and answer one mailbox of your own here';
    const fk = mailFolder();
    if (fk !== 'inbox') {
      const n = S.items.filter(i => isEmailItem(i) && mailFolderOf(i) === fk).length, at = MAIL.folderAt?.[fk];
      return [MAIL.account.address, `${n} ${n === 1 ? 'email' : 'emails'} here`, MAIL.folderBusy === fk ? 'checking…' : at ? `checked ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''].filter(Boolean).join(' · ');
    }
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
  // The line under an email's subject: its own words, without the email it answers
  const mailSnip = t => (t || '').replace(/\s(On\s.{4,200}?\swrote:|-{3,}\s*Original Message).*$/s, '').trim();
  // A writer you follow shows their site's icon (from their own site, which the app already reads for their feed)
  function mailAvatar(it, cls = 'mr-av') {
    const sent = mailFolderOf(it) === 'sent', from = sent ? ((mailMeta(it).to || '').split(',')[0].trim() || '?') : srcLabel(it), blog = sent ? null : mailBlogFeed(it), h = hueFor('mail:' + from), ini = esc((from.trim()[0] || '?').toUpperCase());
    let host = ''; try { host = blog ? new URL(blog.site || blog.url).origin : ''; } catch {}
    return host ? `<img class="${cls} mr-ico" src="${esc(host)}/apple-touch-icon.png" data-alt="${esc(host)}/favicon.ico" data-h="${h}" data-ini="${ini}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="${cls}" style="--h:${h}" aria-hidden="true">${ini}</span>`;
  }
  document.addEventListener('error', e => {
    const img = e.target; if (img.tagName !== 'IMG' || !img.classList.contains('mr-ico')) return;
    if (img.dataset.alt) { const a = img.dataset.alt; img.dataset.alt = ''; img.src = a; return; }
    const sp = document.createElement('span'); sp.className = img.className.replace('mr-ico', '').trim(); sp.style.setProperty('--h', img.dataset.h); sp.setAttribute('aria-hidden', 'true'); sp.textContent = img.dataset.ini; img.replaceWith(sp);
  }, true);
  function mailRow(it) {
    const fk = mailFolderOf(it), sentTo = fk === 'sent' ? (mailMeta(it).to || '').split(',').map(x => x.trim()).filter(Boolean) : null;
    const from = sentTo ? `To ${sentTo[0] || 'no one'}${sentTo.length > 1 ? ` +${sentTo.length - 1}` : ''}` : srcLabel(it), n = MAIL.threads.get(it.id) || 1;
    return `<article class="story mail-row${it.read ? ' read' : ''}${S.selId === it.id ? ' sel' : ''}${S.readerId === it.id ? ' open' : ''}" data-id="${esc(it.id)}">
      ${mailAvatar(it)}
      <button class="mr-main title" data-act="open"><span class="mr-top"><span class="mr-from">${esc(from)}${n > 1 ? `<span class="mr-n" title="${n} emails in this conversation">${n}</span>` : ''}</span><time datetime="${esc(it.date)}">${esc(mailWhen(it.date))}</time></span>
        <span class="mr-subj">${mailHasDraft(it.id) ? '<span class="mr-draft">Draft</span>' : ''}${esc(headline(it))}</span>${mailSnip(it.summary) ? `<span class="mr-snip">${esc(mailSnip(it.summary))}</span>` : ''}</button>
      <div class="acts mr-acts">
        ${['archive', 'trash', 'spam'].includes(fk) ? `<button class="icon" data-act="minbox" title="${fk === 'spam' ? 'Not spam: put it in your inbox' : 'Move to Inbox'}" aria-label="${fk === 'spam' ? 'Not spam' : 'Move to Inbox'}">${ICONS.inbox}</button>` : fk === 'sent' ? '' : `<button class="icon" data-act="march" title="Archive (e)" aria-label="Archive">${ICONS.archive}</button>`}
        ${fk === 'trash' ? '' : `<button class="icon" data-act="mdel" title="Move to the Trash" aria-label="Move to the Trash">${ICONS.trash}</button>`}
        <button class="icon${it.saved ? ' on' : ''}" data-act="save" title="${it.saved ? 'Remove from Read later' : 'Read later'}" aria-label="${it.saved ? 'Remove from Read later' : 'Read later'}">${it.saved ? ICONS.saved : ICONS.save}</button>
        <button class="icon" data-act="read" title="${it.read ? 'Mark unread' : 'Mark read'}" aria-label="${it.read ? 'Mark unread' : 'Mark read'}">${it.read ? ICONS.read : ICONS.unread}</button>
      </div></article>`;
  }

  // ---- Folders: Inbox, and the mailbox's Sent, Archive, Trash and Spam (the ones it has). The inbox is checked
  // on its own; another folder is brought up to date when you open it (its newest 100, Show older emails for more).
  const MAIL_FOLDERS = { inbox: 'Inbox', sent: 'Sent', archive: 'Archive', trash: 'Trash', spam: 'Spam' };
  const mailFolder = () => (S.view === 'email' && MAIL_FOLDERS[store.get('mailFolder')] && (store.get('mailFolder') === 'inbox' || (MAIL.folders || []).some(f => f.kind === store.get('mailFolder')))) ? store.get('mailFolder') : 'inbox';
  const mailFolderOf = it => mailMeta(it).folder || 'inbox';
  const mailFolded = () => store.get('mailFolded') === '1';
  function mailNavItems() {
    const it = { view: 'email', label: 'Email', count: unreadIn('email'), icon: ICONS.email };
    if (!MAIL.account || !(MAIL.folders || []).length) return [it];
    const open = !mailFolded();
    it.html = `<div class="folder vidrow">${navButton('email', 'Email', it.count, { icon: ICONS.email })}<button class="chev" type="button" data-mailfold aria-expanded="${open}" aria-label="${open ? 'Fold' : 'Show'} the folders under Email" title="${open ? 'Fold the folders into Email' : 'Show Inbox, Sent, Archive, Trash and Spam'}">${ICONS.chev}</button></div>`;
    if (!open) return [it];
    const cur = S.view === 'email' ? mailFolder() : '';
    const sub = (k, n) => ({ view: 'email', sub: true, html: `<button class="navsub" type="button" data-mailsub="${k}" aria-current="${cur === k}" title="${esc(MAIL_FOLDERS[k])}${k !== 'inbox' ? ` (${esc((MAIL.folders.find(f => f.kind === k) || {}).name || '')} in your mailbox)` : ''}"><span class="name">${MAIL_FOLDERS[k]}</span><span class="count">${n ? fmtCount(n) : ''}</span></button>` });
    return [it, sub('inbox', unreadIn('email')), ...['sent', 'archive', 'trash', 'spam'].filter(k => MAIL.folders.some(f => f.kind === k)).map(k => sub(k, 0))];
  }
  async function loadMailFolders() {
    if (!MAIL.account || bridgeAway()) return;
    try { MAIL.folders = (await invoke('email_folders')) || []; } catch { return; }
    renderRail();
  }
  // Open a folder: show what's here, then bring it up to date from the mailbox
  async function openMailFolder(k, { older = false } = {}) {
    store.set('mailFolder', k); MAIL.olderLeft = null;
    if (S.view !== 'email') selectView('email'); else { S.shown = 60; renderHead(); renderList(); $('listView')?.scrollTo({ top: 0 }); if (isPhone()) setScreen('list'); }
    renderRail();
    if (k === 'inbox') { if (older) mailOlder(); else checkMail(true); return; }
    if (!older && MAIL.folderAt?.[k] && Date.now() - MAIL.folderAt[k] < 120e3) return;
    MAIL.folderBusy = k; renderList();
    try {
      const r = await invoke('email_folder', { kind: k, older });
      (MAIL.folderAt ||= {})[k] = Date.now();
      if (r?.missing) { MAIL.folders = (MAIL.folders || []).filter(f => f.kind !== k); store.set('mailFolder', 'inbox'); status(`Your mailbox has no ${MAIL_FOLDERS[k]} folder.`); }
      else if (older) { MAIL.olderLeft = r.left; status(r.added ? `Brought in ${r.added} older ${r.added === 1 ? 'email' : 'emails'}${r.left ? `; ${r.left} more in ${MAIL_FOLDERS[k]}` : ''}.` : `No older emails in ${MAIL_FOLDERS[k]}.`); if (!r.added) MAIL.olderLeft = 0; }
      if (r?.added || r?.removed) { await load(); }
      await loadMailMeta();
    } catch (e) { status(msg(e), true); }
    MAIL.folderBusy = null; renderList(); renderRail(); renderHead();
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-mailfold]')) { store.set('mailFolded', mailFolded() ? '0' : '1'); renderRail(); return; }
    const s = e.target.closest('[data-mailsub]');
    if (s) openMailFolder(s.dataset.mailsub);
  });
  // Empty Trash: always asks first, says how many, and that it can't be undone
  function mailEmptyTrash() {
    const here = S.items.filter(i => isEmailItem(i) && mailFolderOf(i) === 'trash').length;
    showBanner(`<span><b>Empty Trash?</b> Every email in your mailbox’s Trash is deleted for good${here ? `: the ${here === 1 ? 'one' : here} here${MAIL.olderLeft ? ' and any older ones' : ''}` : ''}. This can’t be undone, here or in any other email app.</span>
      <span class="row"><button class="btn danger" id="etYes">Delete for good</button><button class="btn" id="etNo">Cancel</button></span>`, false, 'confirm');
    $('etNo').onclick = hideBanner;
    $('etYes').onclick = async () => {
      hideBanner(); status('Emptying the Trash…');
      try {
        const r = await invoke('email_empty_trash');
        S.items = S.items.filter(i => !(isEmailItem(i) && mailFolderOf(i) === 'trash' && !i.saved));
        if (S.readerId && !item(S.readerId)) closeReader();
        render();
        status(r.deleted ? `Emptied the Trash: ${r.deleted} ${r.deleted === 1 ? 'email' : 'emails'} deleted for good.` : 'The Trash was already empty.');
        await load(); await loadMailMeta();
      } catch (e) { status(msg(e), true); }
    };
  }
  // Move to Inbox (Archive, Trash) and Not spam: back to the inbox, where the next check brings it in
  async function mailToInbox(it) {
    const spam = mailFolderOf(it) === 'spam';
    const list = visible(), i = list.findIndex(x => x.id === it.id), next = list[i + 1] || list[i - 1];
    const wasOpen = S.readerId === it.id;
    S.items = S.items.filter(x => x.id !== it.id);
    if (wasOpen) { if (next && isSplit()) openReader(next.id); else closeReader(); }
    render();
    try {
      await invoke('email_move', { itemId: it.id });
      status(spam ? 'Not spam: it’s back in your inbox.' : 'Moved to your inbox.');
      MAIL.last = 0; checkMail(true);
    } catch (e) { status(msg(e), true); load(); }
  }
  $('rMove').onclick = () => { const it = item(S.readerId); if (it) mailToInbox(it); };

  // ---- People and newsletters, conversations, older email
  // Each email's facts (newsletter or person, unsubscribe, conversation, sender) come from email_meta_all.
  async function loadMailMeta() {
    if (!MAIL.account) return;
    try { MAIL.meta = (await invoke('email_meta_all')) || {}; } catch { MAIL.meta = {}; }
    if (S.view === 'email') { renderList(); if (S.readerId && isEmailItem(item(S.readerId) || {})) paintMailExtras(); }
  }
  const mailMeta = it => (it && MAIL.meta[it.link]) || {};
  const mailKind = () => store.get('mailKind') || '';
  const isNewsletter = it => !!mailMeta(it).bulk;
  // the conversation an email belongs to: the Message-ID that started it
  const mailThreadKey = it => mailMeta(it).thread || it.link;
  const mailThreadOf = it => S.items.filter(x => isEmailItem(x) && mailThreadKey(x) === mailThreadKey(it)).sort((a, b) => b.date.localeCompare(a.date));
  // People / Newsletters, then one row per conversation (its newest email, with how many are in it)
  function mailShape(list) {
    const f = mailFolder();
    list = list.filter(i => mailFolderOf(i) === f);
    const k = f === 'sent' ? '' : mailKind();
    if (k === 'people') list = list.filter(i => !isNewsletter(i));
    else if (k === 'news') list = list.filter(i => isNewsletter(i));
    const seen = new Map(); MAIL.threads = new Map();
    const out = [];
    for (const it of list) {
      const key = mailThreadKey(it);
      if (seen.has(key)) { const first = seen.get(key); MAIL.threads.set(first.id, (MAIL.threads.get(first.id) || 1) + 1); continue; }
      seen.set(key, it); out.push(it);
    }
    for (const it of out) { const all = mailThreadOf(it).length; if (all > 1) MAIL.threads.set(it.id, Math.max(MAIL.threads.get(it.id) || 1, all)); }
    return out;
  }
  // Alerts when a person writes to you (newsletters, stores and services never alert). Off until you say so:
  // the first time a person writes, the Email tab offers it once.
  function mailAlert(fresh) {
    if (!fresh.length) return;
    if (S.prefs.mailAlerts === true) {
      const one = fresh[0], who = srcLabel(one);
      invoke('notify', { title: fresh.length === 1 ? who : `${fresh.length} new emails from people`, body: fresh.length === 1 ? headline(one) : fresh.slice(0, 3).map(i => `${srcLabel(i)}: ${headline(i)}`).join(' · '), id: 'mail-' + one.id }).catch(() => {});
    } else if (S.prefs.mailAlerts === undefined) { MAIL.offerAlerts = true; if (S.view === 'email') renderList(); }
  }
  function mailAlertsOfferHtml() {
    if (!MAIL.offerAlerts || S.prefs.mailAlerts !== undefined || mailFolder() !== 'inbox') return '';
    return `<div class="mailbar mail-offer"><div><strong>Get an alert when a person writes to you?</strong><span>Only emails from people: newsletters, stores and services never alert. Change it any time in Email settings.</span></div>
      <span class="mb-acts"><button class="btn primary" type="button" data-mailalerts="on">Turn on</button><button class="btn" type="button" data-mailalerts="off">No thanks</button></span></div>`;
  }
  function mailKindsHtml() {
    if (!MAIL.account || mailFolder() === 'sent') return '';
    const all = S.items.filter(i => isEmailItem(i) && mailFolderOf(i) === mailFolder()), news = all.filter(isNewsletter).length;
    if (!news && mailKind() !== 'news') return '';
    const people = all.length - news, k = mailKind();
    const b = (v, label, n, tip) => `<button type="button" data-mailkind="${v}" aria-pressed="${k === v}" title="${esc(tip)}">${label}${n != null ? ` <span>${n}</span>` : ''}</button>`;
    return `<div class="mail-kinds seg" role="group" aria-label="Show">${b('', 'Everything', null, 'Every email')}${b('people', 'People', people, 'Emails written to you by people')}${b('news', 'Newsletters', news, 'Newsletters, stores and services: emails sent to a list')}</div>`;
  }
  // Searching: what's here first, then the whole inbox on your mail server
  function mailSearchHtml() {
    if (!MAIL.account || bridgeAway() || !S.q || S.q.trim().length < 2) return '';
    const done = MAIL.searched === S.q;
    return `<div class="mail-older"><button class="btn" type="button" data-mailsearch${MAIL.searching || done ? ' disabled' : ''}>${MAIL.searching ? 'Searching your inbox…' : done ? `Searched your whole inbox for “${esc(S.q)}”` : `Search your whole inbox for “${esc(S.q)}”`}</button>
      <span>${done ? esc(MAIL.searchNote || '') : 'Looks through every email in your inbox on your mail server, not just the ones here.'}</span></div>`;
  }
  async function mailSearch() {
    const q = S.q; if (!q || MAIL.searching) return;
    MAIL.searching = true; renderList();
    try {
      const r = await invoke('email_search', { query: q });
      MAIL.searched = q;
      MAIL.searchNote = !r.found ? 'Nothing else in your inbox matches.' : r.added ? `Found ${r.found}; brought in ${r.added} that weren’t here.` : `All ${r.found} matching emails were already here.`;
      if (r.added) { await load(); await loadMailMeta(); }
    } catch (e) { status(msg(e), true); }
    MAIL.searching = false; renderList();
  }
  function mailOlderHtml() {
    if (S.q) return mailFolder() === 'inbox' ? mailSearchHtml() : '';
    if (!MAIL.account || bridgeAway() || MAIL.olderLeft === 0) return '';
    if (mailFolder() !== 'inbox') return `<div class="mail-older"><button class="btn" type="button" data-mailolder${MAIL.folderBusy ? ' disabled' : ''}>${MAIL.folderBusy ? `Getting ${MAIL_FOLDERS[mailFolder()]}…` : 'Show older emails'}</button><span>The 100 before the oldest one here, from ${MAIL_FOLDERS[mailFolder()]} in your mailbox.</span></div>`;
    return `<div class="mail-older"><button class="btn" type="button" data-mailolder${MAIL.olderBusy ? ' disabled' : ''}>${MAIL.olderBusy ? 'Getting older emails…' : 'Show older emails'}</button>
      <span>The app brings in your newest 100 emails. This gets the 100 before them from your inbox.</span></div>`;
  }
  async function mailOlder() {
    if (MAIL.olderBusy) return;
    MAIL.olderBusy = true; renderList();
    try {
      const r = await invoke('email_older');
      MAIL.olderLeft = r?.left ?? 0;
      status(r?.added ? `Brought in ${r.added} older ${r.added === 1 ? 'email' : 'emails'}${r.left ? `; ${r.left} more in your inbox` : ''}.` : 'No older emails in your inbox.');
      if (!r?.added) MAIL.olderLeft = 0;
      await load(); await loadMailMeta();
    } catch (e) { status(msg(e), true); }
    MAIL.olderBusy = false; renderList();
  }
  $('list').addEventListener('click', e => {
    const al = e.target.closest('[data-mailalerts]');
    if (al) { S.prefs.mailAlerts = al.dataset.mailalerts === 'on'; MAIL.offerAlerts = false; savePrefs(); renderList();
      if (S.prefs.mailAlerts) { status('You’ll get an alert when a person writes to you.'); invoke('notify', { title: 'Email alerts are on', body: 'When a person writes to you, it shows up like this.', id: 'mail-alerts-on' }).catch(() => {}); } else status('No email alerts. Turn them on in Email settings if you change your mind.');
      return; }
    if (e.target.closest('[data-mailsearch]')) { mailSearch(); return; }
    if (e.target.closest('[data-mailempty]')) { mailEmptyTrash(); return; }
    const k = e.target.closest('[data-mailkind]');
    if (k) { store.set('mailKind', k.dataset.mailkind); S.shown = 60; renderList(); renderHead(); return; }
    if (e.target.closest('[data-mailolder]')) { if (mailFolder() === 'inbox') mailOlder(); else openMailFolder(mailFolder(), { older: true }); }
  });
  // Archive: the email leaves the inbox for the Archive folder (and leaves the Email tab), like Delete does
  // From the list (a row, a swipe, e), the whole conversation goes; from the reader, the email you're reading.
  function archiveMail(it, whole = false) {
    if (!it || !isEmailItem(it)) return;
    const these = whole ? mailThreadOf(it).filter(x => mailFolderOf(x) === mailFolderOf(it)) : [it];
    mailLater('archive', these, async () => {
      let folder = null;
      for (const x of these) folder = (await invoke('email_archive', { itemId: x.id })) || folder;
      return folder ? `In ${folder}.` : '';
    });
  }
  $('rArchive').onclick = () => { const it = item(S.readerId); if (it) archiveMail(it); };
  for (const [id, icon, label] of [['rArchive', ICONS.archive, 'Archive'], ['rDelete', ICONS.trash, 'Delete']]) { const b = $(id); b.classList.add('r-icon-btn'); b.innerHTML = `${icon}<span class="lbl">${label}</span>`; b.setAttribute('aria-label', label); }
  loadMailAccount().then(() => { if (MAIL.account) { loadMailMeta(); loadMailFolders(); if (S.view === 'email') render(); setTimeout(() => checkMail(true), 2500); } });
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
  // An unfinished note stays on the device until it's posted, saved as a draft or discarded (David, Nov 24: "I backed
  // out of the note to rewind the video and the note disappeared"). One per story, plus one for a new note; a photo
  // is kept only while the app is open.
  const NOTE_PH = new Map();
  function openNote(it) {
    const wp = SOC.accounts.site; if (!wp) { openAccounts(); return; }
    const dkey = 'noteDraft:' + (it ? it.id : 'new');
    let kept = null; try { kept = JSON.parse(store.get(dkey) || 'null'); } catch {}
    const nets = copyNets();
    const quote = it ? S.highlights.find(h => h.item_id === it.id)?.text || '' : '';
    const f = it && feedById(it.feed_id);
    let photo = '';
    const el = sheet('notePanel', `<div class="sheet-grip" id="nGrip" title="Drag to move the note. Double-click to put it back in the middle.">
        <span class="grip-dots" aria-hidden="true"></span><div class="grip-t"><h2>${it ? 'Note about this' : 'New note'}</h2>
        <small>Drag here to move it out of the way. The page behind still works.</small></div>
        <button class="b-link n-fold" id="nFold" type="button">Tuck away</button></div>
      ${it ? `<div class="c-card">${isWeb(it.image) ? `<img src="${esc(it.image)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(headline(it))}</b><span>${esc(srcLabel(it) || f?.title || '')}</span></div></div>` : ''}
      <input class="n-field n-title" id="nTitle" type="text" placeholder="Title (optional)" maxlength="200" autocomplete="off">
      <textarea id="nText" rows="5" placeholder="${it ? 'What did you think? Mention the writer to let them know.' : 'What’s on your mind?'}"></textarea>
      <div class="n-tools">${quote ? '<button class="b-link" id="nQuote" type="button">Add your highlight as a quote</button>' : ''}
        <button class="b-link" id="nPhotoBtn" type="button">+ Add a photo</button>${it ? '' : '<button class="b-link" id="nLinkBtn" type="button">+ Add a link</button>'}
        <span class="n-room" id="nRoom"></span><input id="nPhoto" type="file" accept="image/*" hidden></div>
      <input class="n-field" id="nLink" type="url" placeholder="https:// a link to add" hidden autocapitalize="off" spellcheck="false">
      <div class="n-photo" id="nPhotoBox" hidden><img id="nPrev" alt=""><div><input class="n-field" id="nAlt" placeholder="Describe the photo for people who can’t see it" maxlength="1000"><button class="b-link" id="nPhotoX" type="button">Remove photo</button></div></div>
      ${postToChoice() ? `<div class="n-home n-pt">${postToHtml('data-npt', false)}</div>` : ''}
      <label class="n-home"${postToChoice() ? ' hidden' : ''}><input type="checkbox" id="nSite"${postToChoice() ? ' disabled' : ' checked'}><span class="slim-ini n-ini" style="background:hsl(${hueFor(wp.site)} 45% 42%)">${esc((wp.name || '?').trim()[0].toUpperCase())}</span>
        <span><b>Post to ${esc(wp.site.replace(/^https?:\/\//, ''))}</b><small>As a note: without a title, its first words are used. It goes on your Notes page and in its feed.</small></span></label>
      ${nets.length ? `<p class="n-also" id="nAlso">Also share a copy that links back to it</p>
      <div class="c-nets">${nets.map(n => `<label class="c-net"><input type="checkbox" value="${n}"${n === 'tumblr' ? '' : ' checked'}>${ICON_NET[n]}${NET[n]} <small>${esc(SOC.accounts[n].handle)}</small></label>`).join('')}</div>` : ''}
      <label class="c-net n-x"><input type="checkbox" id="nX"${store.get('noteX') === '1' ? ' checked' : ''}><span class="x-mark" aria-hidden="true">X</span>Then open X with a copy <small>you press Post there</small></label>
      <p class="acct-note" id="nNote" aria-live="polite"></p>
      <div class="row sheet-foot"><button class="btn" type="button" id="nCancel">Close</button><button class="btn" type="button" id="nDraft">Save as draft</button><button class="btn primary" type="button" id="nPost">Post</button></div>`, it ? 'Note about this' : 'New note');
    const text = $('nText'), boxes = () => [...el.querySelectorAll('.c-net input:checked:not(#nX)')].map(x => x.value);
    $('nX').onchange = () => store.set('noteX', $('nX').checked ? '1' : '');
    const ptBox = el.querySelector('.n-pt');
    let npt = postTo();
    const toSite = () => ptBox ? npt !== 'tumblr' : $('nSite').checked;
    const toTumblr = () => !!ptBox && npt !== 'site';
    const wirePt = () => el.querySelectorAll('[data-npt]').forEach(b => b.onclick = () => { npt = b.dataset.npt; store.set('postTo', npt); el.querySelector('.n-pt .post-to').outerHTML = postToHtml('data-npt', false); wirePt(); count(); });
    wirePt();
    const link = () => it ? it.link : ($('nLink').hidden ? '' : $('nLink').value.trim());
    const count = () => {
      const n = [...text.value].length, picks = boxes();
      const room = Math.min(...picks.map(p => LIMIT[p] - (toSite() || link() ? (p === 'mastodon' ? 25 : 40) : 0)), 99999);
      const over = picks.length && n > room;
      $('nRoom').textContent = !picks.length ? '' : toSite() ? (over ? 'Copies will be shortened, with the link to the full note' : `${room - n}`) : `${room - n}`;
      $('nRoom').classList.toggle('over', !toSite() && over);
      const home = toSite() || toTumblr();
      $('nAlso').textContent = home ? 'Also share a copy that links back to it' : 'Post only to';
      $('nDraft').hidden = !home;
      $('nPost').disabled = (!home && !picks.length && !$('nX').checked) || (!home && over) || (!text.value.trim() && !photo);
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
      try { photo = await shrinkPhoto(file); $('nPrev').src = photo; $('nPhotoBox').hidden = false; $('nPhotoBtn').hidden = true; $('nNote').textContent = ''; keep(); $('nAlt').focus(); }
      catch { photo = ''; $('nNote').textContent = 'Couldn’t open that picture. Try another one, or save it as a JPEG first.'; $('nNote').classList.add('err'); }
      $('nPhoto').value = ''; count();
    };
    $('nPhotoX').onclick = () => { photo = ''; $('nPhotoBox').hidden = true; $('nPhotoBtn').hidden = false; $('nAlt').value = ''; keep(); count(); };
    const say = (t, err) => { $('nNote').textContent = t; $('nNote').classList.toggle('err', !!err); };
    // Keep what's written as it's written, and bring it back next time
    const keep = () => {
      const d = { title: $('nTitle').value, text: text.value, link: $('nLink').hidden ? '' : $('nLink').value, alt: $('nAlt').value };
      if (d.title.trim() || d.text.trim() || d.link.trim() || photo) store.set(dkey, JSON.stringify(d)); else store.set(dkey, '');
      if (photo) NOTE_PH.set(dkey, photo); else NOTE_PH.delete(dkey);
    };
    const forget = () => { store.set(dkey, ''); NOTE_PH.delete(dkey); };
    el.oninput = keep;
    if (kept || NOTE_PH.has(dkey)) {
      $('nTitle').value = kept?.title || ''; text.value = kept?.text || '';
      if (kept?.link && $('nLinkBtn')) { $('nLink').hidden = false; $('nLinkBtn').hidden = true; $('nLink').value = kept.link; }
      const ph = NOTE_PH.get(dkey);
      if (ph) { photo = ph; $('nPrev').src = ph; $('nPhotoBox').hidden = false; $('nPhotoBtn').hidden = true; }
      $('nAlt').value = kept?.alt || '';
      $('nNote').innerHTML = 'Your unfinished note is back. <button class="b-link" id="nDiscard" type="button">Start over</button>';
      $('nDiscard').onclick = () => { forget(); $('nTitle').value = text.value = $('nAlt').value = ''; photo = ''; $('nPhotoBox').hidden = true; $('nPhotoBtn').hidden = false; say(''); count(); text.focus(); };
    }
    // The note floats: drag it aside and the video or article behind it still plays, scrolls and takes clicks
    // (David, Nov 24). So a tap outside no longer closes it; Close (or Escape) does, and keeps the note for next time.
    floatSheet(el, 'notePos');
    const fold = on => {
      el._resize(() => { el.querySelector('.sheet').classList.toggle('folded', on); $('nFold').textContent = on ? 'Open' : 'Tuck away'; }, !on);
      if (!on) text.focus();
    };
    $('nFold').onclick = () => fold(!el.querySelector('.sheet').classList.contains('folded'));
    const closed = () => { if (store.get(dkey) || NOTE_PH.has(dkey)) status('Your note is kept. Open Note again to pick up where you left off.'); };
    $('nCancel').onclick = () => { el.hidden = true; closed(); };
    el.onmousedown = null;
    el.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; closed(); } };
    const go = async draft => {
      const words = text.value.trim(), alt = $('nAlt').value.trim(), picks = boxes();
      if (photo && !alt && !draft && !confirm('Post the photo without a description? People using screen readers won’t know what it shows.')) { $('nAlt').focus(); return; }
      $('nPost').disabled = $('nDraft').disabled = true;
      let home = '', onTumblrToo = false;
      try {
        if (toSite()) {
          say(draft ? 'Saving the draft…' : `Posting to ${wp.site.replace(/^https?:\/\//, '')}…`);
          const r = await invoke('site_note', { title: $('nTitle').value.trim(), text: words, link: link(), linkTitle: it ? headline(it) : '', photo, alt, draft, linkImage: it && isWeb(it.image) ? it.image : '', linkSite: it ? (srcLabel(it) || f?.title || '') : '' });
          if (draft && !toTumblr()) { forget(); el.hidden = true; status(`Saved as a draft on your site. Finish it in ${siteApp()} whenever you like.`); return; }
          home = r.url; forget();
        }
        // Post to Tumblr or Both: the full note on Tumblr (not a copy that links home)
        if (toTumblr()) {
          say(draft ? 'Saving the draft on Tumblr…' : 'Posting to Tumblr…');
          const r = await invoke('tumblr_write', { kind: 'note', title: $('nTitle').value.trim(), text: words, photo, alt, draft, link: link(), linkTitle: it ? headline(it) : '' });
          if (draft) { forget(); el.hidden = true; status(toSite() ? 'Saved as a draft on your site and on Tumblr.' : 'Saved to your Tumblr drafts.'); return; }
          if (!home) home = r.url; onTumblrToo = true; forget();
        }
        let shared = [], bad = [], warned = [];
        if (picks.length) {
          say(home ? 'Posted on your site. Sharing the copies…' : 'Posting…');
          const t = $('nTitle').value.trim();
          // a titled note's copies lead with the title (a copy with a photo gets no link card to carry it)
          const copy = home && t ? (words ? `${t}\n\n${words}` : t) : words;
          const res = await invoke('social_share_note', { networks: picks, text: copy, link: home || link(), title: home ? (t || `A note on ${wp.name || 'my site'}`) : (it ? headline(it) : ''), photo, alt, video: home ? link() : '', videoTitle: it ? headline(it) : '',
            // the post the note is about becomes the copy's card (Bluesky) or preview (Mastodon); the link home goes in the words
            about: home ? link() : '', aboutTitle: it ? headline(it) : '', aboutSite: it ? (srcLabel(it) || f?.title || '') : '', aboutImage: it && isWeb(it.image) ? it.image : '' });
          shared = res.filter(r => !r.error).map(r => NET[r.network]); bad = res.filter(r => r.error);
          warned = res.filter(r => !r.error && r.warning).map(r => `${NET[r.network]}: ${r.warning}`);
        }
        if (it) store.set('shared:' + it.id, '1');
        if (shared.length) forget();
        // X: free, because X's own compose window does the posting and you press Post (no API, no charge)
        const toX = !draft && $('nX').checked && (home || words || link());
        const xt = $('nTitle').value.trim();
        if (toX) await openXCopy(home && xt && words ? `${xt}\n\n${words}` : (words || xt), home || link());
        const where = [toSite() && home ? wp.site.replace(/^https?:\/\//, '') : '', onTumblrToo ? 'Tumblr' : '', ...shared].filter(Boolean);
        if (bad.length) {
          say(`${where.length ? `Posted to ${where.join(', ')}. ` : ''}${bad.map(r => `${NET[r.network]}: ${r.error}`).join(' ')}${warned.length ? ' ' + warned.join(' ') : ''}`, true);
          $('nPost').disabled = true; $('nCancel').textContent = 'Close'; return;
        }
        if (warned.length) { say(`Posted to ${where.join(', ')}. ${warned.join(' ')}`, true); $('nPost').disabled = true; $('nCancel').textContent = 'Close'; return; }
        forget(); el.hidden = true;
        const hostName = wp.site.replace(/^https?:\/\//, '');
        const xNote = toX ? ' X is open with your copy: press Post there.' : '';
        if (onTumblrToo) { status(`Posted to ${where.join(', ').replace(/, ([^,]*)$/, ' and $1')}.${shared.length ? ' Replies will show in Conversations.' : ''}${xNote}`); if (shared.length) setTimeout(() => { loadConversations(true); if (S.view === 'talk') renderList(); }, 4000); return; }
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
    const chars = [...words.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()];
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
  // A post's picture: the featured image of your own post when it's in your feeds, else the link card's picture
  function postPic(ps, it) {
    const src = (it && isWeb(it.image) && it.image) || (ps.find(q => isWeb(q.image)) || {}).image || '';
    if (!src) return '';
    const go = it ? `data-open="${esc(it.id)}"` : `data-talk="open" data-url="${esc(ps.find(q => q.link)?.link || ps[0].url)}"`;
    return `<button class="tp-picb" ${go} aria-label="Open the post"><img class="tp-pic" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`;
  }
  function postHtml(p) {
    const open = SOC.open.has(p.id), thread = SOC.threads.get(p.id);
    const it = S.items.find(i => i.link && p.link && i.link.replace(/\/$/, '') === p.link.replace(/\/$/, ''));
    const pic = postPic([p], it);
    return `<article class="t-post${pic ? ' has-pic' : ''}"><div class="tp-row"><div class="tp-main">
      <div class="t-story">${!p.link ? `<span class="t-plain">${ICON_NET[p.network]}</span>` : ''}${p.link ? `<button class="t-link" ${it ? `data-open="${esc(it.id)}"` : `data-talk="open" data-url="${esc(p.link)}"`}>${esc(p.link_title || p.link.replace(/^https?:\/\//, ''))}</button>` : ''}
        <span class="t-when">${ICON_NET[p.network]} ${esc(fmtWhen(p.created_at))}</span></div>
      ${p.text ? `<p class="t-note">${esc(p.text)}</p>` : ''}
      <div class="t-meta"><button class="t-count linkish" data-talk="thread" data-net="${p.network}" data-id="${esc(p.id)}">${p.replies ? `${p.replies} ${p.replies === 1 ? 'reply' : 'replies'}` : 'No replies yet'}${p.replies ? (open ? ' ▴' : ' ▾') : ''}</button>
        ${p.reposts ? `<span>${p.reposts} ${p.network === 'mastodon' ? (p.reposts === 1 ? 'boost' : 'boosts') : (p.reposts === 1 ? 'repost' : 'reposts')}</span>` : ''}${p.likes ? `<span>${p.likes} ${p.network === 'mastodon' ? (p.likes === 1 ? 'favorite' : 'favorites') : (p.likes === 1 ? 'like' : 'likes')}</span>` : ''}
        <button class="linkish" data-talk="open" data-url="${esc(p.url)}">Open on ${NET[p.network]}</button></div>
      </div>${pic}</div>
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
      if (SOC.accounts.site) invoke('site_avatar').then(u => { myPics.wp = isWeb(u) ? u : ''; if (myPics.wp) redraw(); }).catch(() => {});
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
          <div class="nb-by"><button class="nb-name" data-talk="nbwho" data-feed="${esc(f?.id || '')}">${nbName(i)}</button>${mine ? cueTag('you', 'You') : ''}<span>replied</span><time>${esc(fmtWhen(i.date))}</time></div>
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
        <div class="nb-by"><button class="nb-name" data-talk="nbwho" data-feed="${esc(f?.id || '')}">${nbName(i)}</button>${mine ? cueTag('you', 'You') : ''}${isFriend(f) ? `<button class="nb-star" data-talk="cue" data-cue="friend" title="${esc(CUES.friend)}" aria-label="Close friend">${NB_STAR}</button>` : ''}<span>${esc(hostOfU(i.link))}</span><time>${esc(fmtWhen(i.date))}</time>${x.toMe.has(i.id) ? cueTag('links', 'Links to you') : readsYou(f) ? READS_YOU : ''}${back ? cueTag('back', `Back after ${back} month${back === 1 ? '' : 's'}`, 'back') : ''}</div>
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
    const mine = ownIds(), myHost = bareHost(hostOfU(SOC.accounts.site?.site || myFeed()?.site || ''));
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
  const repostBtn = it => {
    if (!SOC.accounts.site || !isWeb(it.link)) return '';
    if (!repostOf(it)) return `<button class="linkish nb-rp" data-talk="repost" data-id="${esc(it.id)}">Repost</button>`;
    if (!rpSwept) { rpSwept = true; setTimeout(sweepReposts, 4000); }
    return `<button class="linkish nb-rp on" data-talk="repost" data-id="${esc(it.id)}" title="See your repost, or repost it again">Reposted ✓</button>`;
  };
  // Reposts deleted from your site (their page says "not found") are forgotten, so the button says Repost again.
  // Checked once a session, newest first, a few dozen at most.
  let rpSwept = false;
  async function sweepReposts() {
    const all = Object.entries(S.prefs.reposts || {}).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 40);
    let changed = false;
    for (const [key, r] of all) {
      if (await invoke('site_post_gone', { url: r.url }).catch(() => false)) { delete S.prefs.reposts[key]; changed = true; }
    }
    if (changed) { savePrefs(); renderList(); paintReaderTalk(); }
  }
  async function openRepost(it) {
    const f = nbWho(it), host = SOC.accounts.site.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const prev = repostOf(it);
    // already reposted: if that post is gone from your site, start fresh; if not, offer to see it or repost again
    if (prev && await invoke('site_post_gone', { url: prev.url }).catch(() => false)) {
      delete S.prefs.reposts[normU(it.link)]; savePrefs(); renderList(); paintReaderTalk();
    } else if (prev) {
      const when = new Date(prev.at); const day = isNaN(when) ? '' : ` on ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      const el = sheet('repostPanel', `<h2>You reposted this</h2>
        <p class="note">You put it on ${esc(host)}${esc(day)}. You can look at that repost, or repost it again as a new note.</p>
        <div class="row sheet-foot"><button class="btn" type="button" id="rpNo">Cancel</button><button class="btn" type="button" id="rpSee">See your repost</button><button class="btn primary" type="button" id="rpAgain">Repost again</button></div>`, 'Repost');
      $('rpNo').onclick = () => { el.hidden = true; };
      $('rpSee').onclick = () => { el.hidden = true; openWeb(prev.url); };
      $('rpAgain').onclick = () => { el.hidden = true; repostSheet(it, f, host); };
      return;
    }
    repostSheet(it, f, host);
  }
  function repostSheet(it, f, host) {
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
        status(`Reposted on ${host}. ${toldLine(r, f?.title || 'their site')}`, r.told === false && !!r.told_error);
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
    const show = SOC.rollAll === String(f.id) ? not : not.slice(0, 8);
    return `<p class="pp-sub">${c.list.length} ${c.list.length === 1 ? 'site' : 'sites'} ${esc(f.title)} recommends${have ? `. You follow ${have === c.list.length ? 'all of them' : have}` : ''}.</p>
      ${not.length > 1 ? `<button class="btn pp-rollall" data-talk="rollall" data-feed="${esc(f.id)}">Follow all ${not.length}</button>` : ''}
      ${show.map(e => { const h = bareHost(hostOfU(e.url)), err = SOC.blogErr?.get(h); return `<div class="nb-writer">${nbFace({ url: e.url, title: e.title || h }, 'nb-av sm')}<span class="nb-w-who"><button class="linkish nb-w-host" data-talk="open" data-url="${esc(e.url)}">${esc(e.title || h)}</button><small>${esc(h)}</small>${err ? `<small class="fol-err">${esc(err)}</small>` : ''}</span><span class="nb-w-acts"><button class="fbtn p" data-talk="site" data-url="${esc(e.feed || e.url)}">Follow</button></span></div>`; }).join('')}
      ${not.length > 8 ? `<button class="linkish more-r" data-talk="rollmore" data-feed="${esc(f.id)}">${SOC.rollAll === String(f.id) ? 'Show fewer' : `Show all ${not.length}`}</button>` : ''}`;
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
  // The little labels on a card say what they mean when tapped (iPhone has no hover) or hovered (Mac)
  const CUES = {
    trend: 'Trending in your neighborhood: names, topics and links that several of the people you read wrote about this week, more than they usually do. Worked out on this device from the posts you already have. Tap one to see their posts side by side.',
    mypage: 'Your page: your posts and notes, who talks with you and who links to you, the same page each person you read has.',
    ytc: site => `Comment on ${site}: copies what you wrote and opens the video on ${site}. Paste it into the comments there. ${site} doesn’t take replies from other sites, so this is how your words get under the video.`,
    favchan: 'Your channels: every channel you follow that has videos here. The number is how many you haven’t watched. Tap a channel to see only its videos; tap it again for all. Tap ☆ to make it a favorite, and favorites stay first.',
    vchans: 'Channels your people share: YouTube channels whose videos the people you read put in their posts lately, most shared first. Follow one and its new videos show up in Videos.',
    mini: 'Back to the story. The video or episode keeps playing here while you browse; × stops it.',
    miniFirst: 'Still playing: it moved to the corner so you can keep browsing. Tap its title to go back to the story.',
    pip: 'Picture in picture: the video floats above everything, even other apps, and keeps playing.',
    vtime: 'Play the video from this point.',
    offline: 'Saved for offline: this episode or video is on this device and plays without a connection. Finished ones are removed after a week.',
    you: 'You: a post from your own site.',
    friend: 'Close friend: their new posts are pinned to the top of the Neighborhood, and you get an alert when they post. Change it with the Close friend button on their page.',
    reads: 'Reads you: your site is on their blogroll.',
    links: 'Links to you: this post links to your site.',
    back: 'Back after a quiet spell: their first post in months.',
    react: 'Likes, replies, reposts and mentions that other sites and people sent to this post. Tap to see who.',
  };
  const cueTag = (k, label, cls = '') => `<button class="nb-tag${cls ? ' ' + cls : ''}" data-talk="cue" data-cue="${k}" title="${esc(CUES[k])}">${esc(label)}</button>`;
  const READS_YOU = cueTag('reads', 'Reads you', 'reads');

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
      for (const { f, unread } of fs) { if (!f || isOwn(f.id)) continue; const had = faces.get(f.id); if (!had) faces.set(f.id, { f, unread }); else if (unread) had.unread = true; } // ring = anything unread
    }
    const faceList = [...faces.values()].sort( // close friends first
      (a, b) => fids.has(b.f.id) - fids.has(a.f.id));
    const facesHtml = faces.size > 1 ? `<nav class="nb-faces" aria-label="Who posted in the last three days (a ring means something unread)">${faceList.slice(0, 16).map(({ f, unread }) =>
      `<button class="nb-face${unread ? ' new' : ''}" data-talk="nbwho" data-feed="${esc(f.id)}" aria-pressed="${who?.id === f.id}" title="${esc(f.title)}${unread ? ' · something new you haven’t read' : ' · all read'}">${nbFace(f, 'nb-fav')}<b>${esc(f.title)}</b></button>`).join('')}</nav>
      <p class="nb-faces-key"><i aria-hidden="true"></i>Posted in the last three days · a green ring means something new you haven’t read</p>` : '';
    const talks = all.filter(talky).filter(e => itemsOf(e).some(i => !i.read && !isOwn(i.feed_id))).length; // unread ones only
    const chips = `<div class="nb-seg" role="group" aria-label="Show">${[['', 'Everything'], ['talk', `Conversations${talks ? ` · ${talks}` : ''}`], ['short', 'Notes'], ['photos', 'Photos'], ['long', 'Long reads'], ['each', 'One from each'], ['topics', 'Topics']].map(([k, l]) => `<button data-talk="nbonly" data-k="${k}" aria-pressed="${(SOC.nbOnly || '') === k}">${l}</button>`).join('')}</div>`
      + (groupsOf().length ? `<span class="nb-break"></span><div class="nb-seg nb-groups" role="group" aria-label="Groups"><button data-talk="nbgroup" data-g="" aria-pressed="${!grp}">All people</button>${groupsOf().map(g => `<button data-talk="nbgroup" data-g="${esc(g.id)}" aria-pressed="${grp?.id === g.id}">${esc(g.name)}</button>`).join('')}</div>` : '');
    // Everything unread in this view (close friends at the top included), for Mark all as read up top and at the end
    let unreadHere = [...pinned, ...list].flatMap(itemsOf).filter(i => !i.read && !isOwn(i.feed_id));
    // On Everything (no chip, person, group or topic), also take in the rest of what the sidebar's Conversations
    // count includes: every unread post from your people in the last two weeks, and new answers to your replies
    if (!SOC.nbOnly && !who && !grp && !topic) {
      const had = new Set(unreadHere.map(i => i.id));
      const extra = [...nbUnread(), ...myReplies().flatMap(answersTo)].filter(i => !i.read && !had.has(i.id) && had.add(i.id));
      unreadHere = unreadHere.concat(extra);
    }
    SOC.nbUnreadIds = unreadHere.map(i => i.id);
    const readTop = unreadHere.length > 1 ? `<button class="btn nb-readtop" data-talk="nbreadall">Mark all ${unreadHere.length} as read</button>` : '';
    const opener = nbOpener(posts, soc, x, facesHtml, chips, readTop);
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
    return `<div class="nb-react"><button class="nb-react-b" data-talk="wmopen" data-id="${esc(i.id)}" aria-expanded="${open}" title="${esc(CUES.react)}">${bits.join('<span class="sep"></span>')}</button>
      ${open ? (list === undefined ? '<p class="note">Looking at who reacted…</p>' : list.err ? `<p class="note err">${esc(list.err)}</p>` : wmListHtml(list)) : ''}</div>`;
  }
  function wmListHtml(list) {
    const likes = list.filter(r => r.kind === 'like' || r.kind === 'repost'), talk = list.filter(r => r.kind === 'reply' || r.kind === 'mention');
    const face = r => `<span class="nb-av sm" style="--h:${hueFor(r.name || r.url)}">${esc((r.name || '?')[0].toUpperCase())}${isWeb(r.photo) ? `<img class="nb-face-img" src="${esc(r.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
    return `<div class="wm-list"><p class="wm-what">Reactions other sites and people sent to this post</p>
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
  // ---- Comment on YouTube (and other video sites): they take no replies from other sites and can't fill in
  // their comment box, so copy the words and open the video there (like the copy for X)
  const VIDEO_SITES = [['YouTube', /(^|\.)(youtube\.com|youtu\.be)$/], ['Vimeo', /(^|\.)vimeo\.com$/], ['Rumble', /(^|\.)rumble\.com$/],
    ['Odysee', /(^|\.)odysee\.com$/], ['Dailymotion', /(^|\.)(dailymotion\.com|dai\.ly)$/], ['TikTok', /(^|\.)tiktok\.com$/]];
  function videoSite(it) {
    const link = it?.link || '', yt = ytId(link);
    if (yt) return { name: 'YouTube', url: `https://www.youtube.com/watch?v=${yt}` };
    let u; try { u = new URL(link); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || u.pathname.length < 2) return null; // a video, not the site's home page
    const hit = VIDEO_SITES.find(([n, re]) => n !== 'YouTube' && re.test(u.hostname));
    return hit ? { name: hit[0], url: link } : null;
  }
  async function videoComment(it, text) {
    const v = videoSite(it); if (!v) return;
    let copied = false;
    if (text) { try { await navigator.clipboard.writeText(text); copied = true; } catch {} }
    try { await invoke('open_external', { url: v.url }); }
    catch (e) { status(msg(e), true); return; }
    status(copied ? `Your words are copied. Paste them into the comments under the video on ${v.name}.` : text ? `Opened the video on ${v.name}. Copying didn’t work, so copy your words from the reply box.` : `Opened the video on ${v.name}. Its comments are under the video.`);
  }
  // ---- Reply right in the card: post a reply on your own site (their site is told), or email them
  async function nbReplyBox(b, it, keep) {
    document.querySelectorAll('.n-box').forEach(x => { x.innerHTML = ''; });
    const sel = `.n-box[data-box="nb:${CSS.escape(it.id)}"]`;
    const box = b?.closest('.r-talk, .nb-main')?.querySelector(sel) || document.querySelector(sel); if (!box) return;
    const f = nbWho(it), wp = SOC.accounts.site, host = wp?.site?.replace(/^https?:\/\//, '').replace(/\/$/, ''), vsite = videoSite(it);
    box.innerHTML = `<form class="nb-rbox"><textarea rows="3" placeholder="Write back to ${esc(f?.title || 'them')}…"></textarea>
      <div class="row">
        ${wp ? `<button class="btn primary" type="button" data-rb="site">Post on ${esc(host)}</button>` : ''}
        <span class="nb-rb-mail">${vsite ? `<button class="btn" type="button" data-rb="yt" title="${esc(CUES.ytc(vsite.name))}">Comment on ${esc(vsite.name)}</button>` : ''}</span>
        <button class="btn" type="button" data-rb="more" aria-haspopup="menu">More ways</button>
        <button class="btn ghost" type="button" data-rb="cancel">Cancel</button>
      </div>
      <p class="note nb-rb-wm">${wp ? `A reply on your site links to their post. Checking whether ${esc(f?.title || 'their site')} shows replies from other sites…` : 'Connect your site to post replies there, or use More ways.'}</p></form>`;
    const ta = box.querySelector('textarea'), dkey = box.dataset.box;
    const draft = DRAFTS[dkey]?.text || '';
    if (keep) { ta.value = keep.text; if (keep.focus) { ta.focus(); ta.setSelectionRange(keep.at, keep.at); } }
    else { ta.value = draft; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    if (keep && draft && !keep.text.includes(draft.trim())) { ta.value = draft.trimEnd() + '\n\n' + keep.text; }
    ta.addEventListener('input', () => setDraft(dkey, ta.value));
    if (wp) mentionPicker(ta);
    // email, if they list an address and you have a mailbox here; and whether their site shows replies from other sites
    const theirHost = (() => { try { return new URL(it.link).hostname.replace(/^www\./, ''); } catch { return f?.title || 'Their site'; } })();
    invoke('reply_options', { itemId: it.id }).then(o => {
      if (!box.isConnected) return;
      const note = box.querySelector('.nb-rb-wm');
      if (wp && note) {
        if (o?.webmention) {
          note.innerHTML = `<span class="nb-rb-yes">✓ ${esc(theirHost)} shows replies from other sites.</span> Yours can appear under the post (they may approve it first).`;
        } else {
          note.innerHTML = vsite ? `${esc(vsite.name)} doesn’t take replies from other sites. Yours will stay on ${esc(host)}. To put the same words under the video, use Comment on ${esc(vsite.name)}.`
            : `${esc(theirHost)} doesn’t take replies from other sites. Yours will stay on ${esc(host)}${o?.comments ? ', or you can leave a comment on their post.' : '.'}`;
          if (o?.comments) box.querySelector('.nb-rb-mail').insertAdjacentHTML('beforeend', `<button class="btn" type="button" data-talk="open" data-url="${esc(o.comments)}">Comment on their site</button>`);
        }
      }
      const addr = plainAddress(o?.email?.address || '');
      if (!addr || !MAIL.account) return;
      box.querySelector('.nb-rb-mail').insertAdjacentHTML('afterbegin', `<button class="btn" type="button" data-rb="mail" data-to="${esc(addr)}">Email ${esc(f?.title?.split(' ')[0] || 'them')}</button>`);
    }).catch(() => { const note = box.querySelector('.nb-rb-wm'); if (wp && note && box.isConnected) note.textContent = `A reply on your site links to their post, and ${f?.title || 'their site'} is told if their site listens for that.`; });
    box.querySelector('form').onclick = async e => {
      const k = e.target.closest('[data-rb]')?.dataset.rb; if (!k) return;
      const text = ta.value.trim();
      if (k === 'cancel') { setDraft(dkey, ''); box.innerHTML = ''; renderList(); paintReaderTalk(); return; }
      if (k === 'more') { openReply(e.target, it); return; }
      if (k === 'yt') { videoComment(it, text); return; }
      if (k === 'mail') { box.innerHTML = ''; openMailCompose({ to: e.target.dataset.to, toName: f?.title || '', subject: `Re: ${headline(it)}`, body: `${text}\n\n—\nIn reply to “${headline(it)}”\n${it.link}` }); return; }
      if (k === 'site') {
        if (!text) { ta.focus(); status('Write a few words first.'); return; }
        const btn = e.target; btn.disabled = true; btn.textContent = 'Posting…';
        try {
          const r = await invoke('site_note', { title: '', text: withMentions(ta), link: it.link, linkTitle: headline(it), photo: '', alt: '', draft: false, linkImage: isWeb(it.image) ? it.image : '', linkSite: f?.title || srcLabel(it) || '', reply: true });
          setDraft(dkey, ''); if (r.url) rememberReply(it, r.url);
          const told = toldLine(r, f?.title || theirHost);
          box.innerHTML = `<p class="nb-rb-done">Posted on ${esc(host)}. ${esc(told)} <button class="linkish" data-talk="open" data-url="${esc(r.url)}">See it</button></p>`;
          status(`Your reply is on ${host}. ${told}`, r.told === false && !!r.told_error);
        } catch (err) { btn.disabled = false; btn.textContent = `Post on ${host}`; status(msg(err), true); }
      }
    };
  }

  // What happened to the Webmention the app sent after a reply or repost went up on your site
  function toldLine(r, who) {
    const whose = /site$/i.test(who) ? who : `${who}’s site`;
    if (r?.told === true) return `${whose[0].toUpperCase()}${whose.slice(1)} was told, and may show it under the post (some approve replies first).`;
    if (r?.told === false && r.told_error) return `${whose[0].toUpperCase()}${whose.slice(1)} wasn’t told: ${r.told_error}`;
    if (r?.told === false) return `${whose[0].toUpperCase()}${whose.slice(1)} doesn’t take replies from other sites, so it stays on yours.`;
    return '';
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
    // How they describe themselves: on their own site first, else their Mastodon or Bluesky bio
    const about = PL[siteOf(f)]?.about || accts.map(r => r.person.bio).find(Boolean) || '';
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
          ${about ? `<p class="pp-about">${esc(about)}</p>` : ''}
          <div class="pp-where"><button class="linkish" data-talk="open" data-url="${esc(isWeb(f.site) ? f.site : 'https://' + host + '/')}">${esc(host)}</button>${accts.map(r => `<button class="linkish" data-talk="open" data-url="${esc(r.person.url || r.url)}">${ICON_NET[r.network] || ''} ${esc(r.person.handle)}</button>`).join('')}${plinks.map(l => `<button class="linkish" data-talk="open" data-url="${esc(l.url)}">${esc(l.label)}</button>`).join('')}</div>
          <p class="pp-pace">${esc(pace)}${theirs.length && !isMine ? ` · you’ve read ${read} of ${theirs.length}` : ''}${toYou.length ? ` · linked to you ${toYou.length === 1 ? 'once' : toYou.length + ' times'}` : ''}${readsYou(f) ? ' · you’re on their blogroll' : ''}</p>
        </div></header>
      <div class="pp-acts">
        ${latest && !isMine ? `<button class="btn primary" data-talk="nbreply" data-id="${esc(latest.id)}" aria-haspopup="menu">Write back</button>` : ''}
        <button class="btn" data-view="${f.id}">${isMine ? 'All your posts' : 'All their posts'}</button>
        ${isMine ? '' : `<button class="btn" data-talk="groups" data-feed="${esc(f.id)}" aria-haspopup="dialog">Groups${groupsOf().filter(g => inGroup(g, f)).length ? ` · ${groupsOf().filter(g => inGroup(g, f)).map(g => esc(g.name)).join(', ')}` : ''}</button>`}
        ${isMine ? '' : `<button class="btn pp-friend${isFriend(f) ? ' on' : ''}" data-talk="friend" data-feed="${esc(f.id)}" aria-pressed="${isFriend(f)}" title="${isFriend(f) ? 'Stop pinning their posts' : 'Pin their new posts to the top of the Neighborhood'}">${NB_STAR}Close friend</button>`}
        ${isMine ? '' : followButtons(f)}
        ${isMine ? '' : `<button class="btn pp-unfollow" data-talk="unfollow" data-feed="${esc(f.id)}" title="Stop following ${esc(f.title)} in The Reading Room">Unfollow</button>`}
      </div>
      ${isFriend(f) ? `<p class="pp-sub pp-friend-note">Their new posts sit at the top of the Neighborhood. ${alertsBtn('friend', S.prefs.friendAlerts !== false, 'Alerts when close friends post')}</p>` : ''}
      ${sec('Talks with', talks.length ? `<div class="pp-faces">${talks.map(t => `<button class="pp-face" data-talk="nbwho" data-feed="${esc(t.f.id)}">${nbFace(t.f, 'nb-av md')}<span><b>${esc(t.f.title)}</b><small>${t.n} ${t.n === 1 ? 'reply or mention' : 'replies and mentions'}</small></span></button>`).join('')}</div>` : '')}
      ${sec(isMine ? 'Emails from your address' : 'Emails from them', mails.length ? mails.map(i => `<button class="nb-pair" data-open="${esc(i.id)}">${ICON_MAIL}<span><b>${esc(i.title)}</b><small>${esc(fmtWhen(i.date))}</small></span></button>`).join('') : '')}
      ${sec('Recent', stream.slice(0, shownN).map(e => e.i ? nbCard(e.i, x, soc) : nbNote(e.s)).join('') + (stream.length > shownN ? `<button class="btn nb-more" data-talk="ppmore">Show more</button>` : '') || '<p class="note">Nothing from them yet. New posts show up after the next refresh.</p>')}
      ${sec(isMine ? 'You link to' : 'They link to', linksTo.length ? `<p class="pp-sub">Blogs ${esc(f.title)} links to that you don’t follow yet.</p>${linksTo.map(writerRow).join('')}` : '')}
      ${sec(isMine ? 'Your blogroll' : 'Their blogroll', rollHtml(f))}
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
    const site = !!SOC.accounts.site, social = anySocial();
    if (site && social) return '';
    const what = !site && !social ? 'Connect your site to like and reply from it, or Mastodon or Bluesky to see the short posts of the people you read.'
      : !site ? 'Connect your site to like and reply from it, so the writer hears about it.'
      : 'Connect Mastodon or Bluesky to see the short posts of the people you read there.';
    return `<p class="nb-hint"><span>${what} <button class="linkish" id="talkConnect">Connect</button></span><button class="nb-x sm" data-talk="nbhinted" aria-label="Don’t show this again" title="Don’t show this again">×</button></p>`;
  }

  // "Since you were here": what's new, in a sentence, before you scroll
  function nbOpener(posts, soc, x, facesHtml = '', chips = '', readTop = '') {
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
    if (small) return `<section class="nb-open small">${k}<div class="nb-open-h sm"><span>${head}${events.length ? ` · ${events.length} conversation${events.length === 1 ? '' : 's'}` : ''}</span>${readTop}</div>${store.get('nbMin') === '1' ? '' : facesHtml}</section>`;
    return `<section class="nb-open">${k}
      <div class="nb-open-h"><span>${head}${!n && !first ? '. Here’s the last two weeks.' : ''}</span>${readTop}</div>
      ${facesHtml}
      ${events.length ? `<div class="nb-evs">${events.slice(0, 3).join('')}${events.length > 3 ? `<button class="nb-ev more" data-talk="nbonly" data-k="talk">${events.length - 3} more conversations</button>` : ''}</div>` : ''}
      ${yours ? `<button class="nb-ev mine" data-talk="tab" data-tab="posts">Your posts have ${yours} ${yours === 1 ? 'reply' : 'replies'} on Mastodon and Bluesky</button>` : ''}
    </section>`;
  }


  // ---- You: everything coming your way, in one place. Replies on Mastodon and Bluesky, comments and Webmentions
  // on your own site, blogs linking to you, mentions of your blog, and emails from the people you read.
  const YOU_CHIPS = [['', 'Everything'], ['myreplies', 'Your replies'], ['replies', 'Replies'], ['comments', 'Comments'], ['tumblr', 'Tumblr'], ['mentions', 'Mentions'], ['posts', 'Your posts']];
  const newComments = () => [...(SOC.comments?.comments || []), ...(SOC.tumblr || [])].filter(c => Date.parse(c.date) > socialSeen()).length;
  // People talking to you on Tumblr (Rust tumblr_activity): replies, reblogs with words, mentions and asks. No likes,
  // follows or plain reblogs (David, Nov 25: "keep conversations about people talking"). Answering happens on Tumblr.
  const TUMBLR_SAID = { 'tumblr-reply': 'replied to', 'tumblr-reblog_with_content': 'reblogged', 'tumblr-mention_in_reply': 'mentioned you in a reply', 'tumblr-mention_in_post': 'mentioned you in a post', 'tumblr-ask': 'sent you an ask' };
  function tumblrEvHtml(c) {
    const said = TUMBLR_SAID[c.kind] || 'wrote to you';
    const onPost = ['tumblr-reply', 'tumblr-reblog_with_content'].includes(c.kind);
    const what = onPost ? `${said} ${c.post_title ? `“${esc(c.post_title)}”` : 'your post'}${c.kind === 'tumblr-reblog_with_content' ? ' and added' : ''}` : said;
    const face = `<span class="nb-av md"><img class="nb-face-img" src="${esc(c.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">${esc((c.name || '?')[0].toUpperCase())}</span>`;
    const f = S.feeds.find(x => bareHost(hostOfU(isWeb(x.site) ? x.site : x.url)) === bareHost(hostOfU(c.url)));
    return `<article class="yu-ev${Date.parse(c.date) > socialSeen() ? ' new' : ''}">${face}<div class="nb-main">
      <div class="nb-by"><b>${esc(c.name)}</b><span>${what} · on Tumblr</span><time>${esc(fmtWhen(c.date))}</time></div>
      ${c.text ? `<p class="nb-text">${esc(c.text.length > 400 ? c.text.slice(0, 390) + '…' : c.text)}</p>` : ''}
      <div class="nb-acts"><button class="linkish" data-talk="xopen" data-url="${esc(c.link)}">${c.kind === 'tumblr-ask' ? 'Answer on Tumblr' : 'Reply on Tumblr'}</button>${f ? '' : `<button class="linkish" data-talk="tfollow" data-url="${esc(c.url)}">Follow their Tumblr</button>`}</div>
    </div></article>`;
  }
  // ---- the Tumblr tab (Plus): work your Tumblr from its own tab (David, Nov 26: "go into the tumblr tab and work the
  // site from there. I can always cross promote to other sites but this would make it easy to manage each individual
  // platform"). Writing is for your own site; from there "Also post to Tumblr" still sends the full post here.
  // Rust: tumblr_post, tumblr_list, tumblr_publish, tumblr_delete, tumblr_stats, tumblr_activity.
  const TB = { kind: store.get('tbKind') === 'post' ? 'post' : 'note', list: 'posts', items: null, busy: false, err: '', page: 1, more: false,
    photo: '', alt: '', sending: false, say: '', sayErr: false, link: '', confirm: 0, actLoading: false };
  const tbDraft = () => { try { return JSON.parse(store.get('tbDraft') || '{}') || {}; } catch { return {}; } };
  const tbBlog = () => SOC.accounts?.tumblr?.blog || '';
  function tbNavItem() {
    const mark = plusLive() ? '<span class="wr-plus" title="Part of The Reading Room Plus">Plus</span>' : '';
    return { view: 'tumblr', label: 'Tumblr', count: '', icon: ICONS.tumblr, html: navButton('tumblr', 'Tumblr', '', { icon: ICONS.tumblr, mark }) };
  }
  async function tbLoadList(page = 1) {
    if (TB.busy) return;
    TB.busy = true; TB.err = '';
    try {
      const got = await tauriInvoke('tumblr_list', { which: TB.list, page });
      TB.items = page > 1 ? [...(TB.items || []), ...got] : got; TB.page = page; TB.more = got.length >= 25;
    } catch (e) { TB.err = msg(e) || 'Tumblr didn’t answer.'; if (page === 1) TB.items = null; }
    finally { TB.busy = false; TB.at = Date.now(); if (S.view === 'tumblr') tbPaint(); }
  }
  function tbComposerHtml() {
    const d = tbDraft(), note = TB.kind === 'note';
    const local = new Date(Date.now() + 60 * 60 * 1000); local.setMinutes(0, 0, 0);
    const defAt = new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return `<section class="b-panel tb-write" aria-label="Write on Tumblr"><div class="bp-head"><h3 class="b-sub">Write on Tumblr</h3><span class="bp-meta">${esc(tbBlog())}.tumblr.com</span></div>
      <div class="post-to"><div class="pt-seg" role="group" aria-label="What you’re writing">${[['note', 'Note'], ['post', 'Post']].map(([k, l]) => `<button type="button" data-tb="kind" data-k="${k}" aria-pressed="${TB.kind === k}">${l}</button>`).join('')}</div>
        <span class="pt-n">${note ? 'A short post, tagged “notes”. A title is optional.' : 'A full post with a title. A line starting with ## is a heading, with > a quote; [words](https://…) makes a link.'}</span></div>
      <input id="tbTitle" class="tb-in" placeholder="${note ? 'Title (optional)' : 'Title'}" value="${esc(d.title || '')}">
      <textarea id="tbText" class="tb-in tb-text" rows="${note ? 4 : 9}" placeholder="${note ? 'What’s on your mind?' : 'Write your post. Leave a blank line between paragraphs.'}">${esc(d.text || '')}</textarea>
      ${TB.photo ? `<div class="tb-photo"><img src="${esc(TB.photo)}" alt=""><div><input id="tbAlt" class="tb-in" placeholder="Describe the photo for people who can’t see it" value="${esc(TB.alt)}"><button class="b-link" type="button" data-tb="nophoto">Remove the photo</button></div></div>`
        : `<button class="btn" type="button" data-tb="photo">＋ Photo</button>`}<input id="tbPhoto" type="file" accept="image/*" hidden>
      <input id="tbTags" class="tb-in" placeholder="Tags, separated by commas" value="${esc(d.tags || '')}" autocapitalize="off">
      <div class="tb-acts">
        <label class="tb-when"><input type="datetime-local" id="tbAt" value="${esc(d.at || defAt)}"></label>
        <button class="btn" type="button" data-tb="send" data-when="schedule"${TB.sending ? ' disabled' : ''} title="Post it at the time beside this button">Schedule</button>
        <button class="btn" type="button" data-tb="send" data-when="queue"${TB.sending ? ' disabled' : ''} title="Tumblr’s queue posts it at the times you set on Tumblr">Add to queue</button>
        <button class="btn" type="button" data-tb="send" data-when="draft"${TB.sending ? ' disabled' : ''}>Save as draft</button>
        <button class="btn primary" type="button" data-tb="send" data-when="published"${TB.sending ? ' disabled' : ''}>${TB.sending ? 'Posting…' : 'Post now'}</button></div>
      ${TB.say ? `<p class="tm-tip tb-say${TB.sayErr ? ' err' : ''}" role="status">${esc(TB.say)}${TB.link ? ` <button class="b-link" type="button" data-tb="open" data-url="${esc(TB.link)}">See it on Tumblr</button>` : ''}</p>` : ''}
      <p class="tm-tip">What you type is kept on this device until it’s posted.</p></section>`;
  }
  function tbPeopleHtml() {
    if (SOC.tumblr == null && !TB.actLoading) {
      TB.actLoading = true;
      tauriInvoke('tumblr_activity').then(t => { SOC.tumblr = t || []; SOC.tumblrErr = ''; }).catch(e => { SOC.tumblrErr = msg(e); SOC.tumblr = SOC.tumblr || null; })
        .finally(() => { TB.actLoading = false; if (S.view === 'tumblr') tbPaint(); });
    }
    const list = (SOC.tumblr || []).slice(0, 5);
    const body = SOC.tumblr == null ? `<p class="day-note">${SOC.tumblrErr ? `Couldn’t reach Tumblr just now. ${esc(SOC.tumblrErr)}` : 'Looking at your Tumblr…'}</p>`
      : list.length ? `<div class="tb-people">${list.map(tumblrEvHtml).join('')}</div>${(SOC.tumblr || []).length > 5 ? `<button class="b-link" type="button" data-tb="talk">See all ${SOC.tumblr.length} in Conversations</button>` : ''}`
      : '<p class="day-note">No replies, reblogs with words, mentions or asks yet. They show here and in Conversations when they come.</p>';
    return `<section class="b-panel" aria-label="People talking to you on Tumblr"><div class="bp-head"><h3 class="b-sub">People talking to you</h3></div>${body}</section>`;
  }
  function tbPostsHtml() {
    if (TB.items == null && !TB.busy && !TB.err) setTimeout(() => tbLoadList(1), 0);
    const where = { posts: '', drafts: '/drafts', queue: '/queue' }[TB.list];
    const rows = (TB.items || []).map(p => {
      const when = p.date ? new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      const meta = TB.list === 'posts' ? `${esc(when)} · ${nfmt(p.notes)} notes` : TB.list === 'queue' ? `In the queue${when ? ` · ${esc(when)}` : ''}` : `Draft${when ? ` · ${esc(when)}` : ''}`;
      const acts = TB.confirm === p.id
        ? `<span class="tb-sure">Delete it for good? Tumblr keeps no trash.</span><button class="b-link danger" type="button" data-tb="delete" data-id="${p.id}">Delete</button><button class="b-link" type="button" data-tb="keep">Keep it</button>`
        : `${TB.list === 'posts' && p.link ? `<button class="b-link" type="button" data-tb="open" data-url="${esc(p.link)}">Open</button>` : ''}${TB.list !== 'posts' ? `<button class="b-link" type="button" data-tb="publish" data-id="${p.id}">Post now</button>` : ''}<button class="b-link" type="button" data-tb="ask" data-id="${p.id}">Delete</button>`;
      return `<li class="tb-row">${p.image ? `<img class="tb-thumb" src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="tb-main"><b>${esc(p.title || p.excerpt || 'A post')}</b>${p.title && p.excerpt ? `<span class="tb-ex">${esc(p.excerpt.slice(0, 140))}</span>` : ''}<span class="tb-meta">${meta}</span><span class="tb-rowacts">${acts}</span></div></li>`;
    }).join('');
    const body = TB.items == null ? `<p class="day-note">${TB.err ? `Couldn’t get your posts just now. ${esc(TB.err)} <button class="b-link" type="button" data-tb="reload">Try again</button>` : 'Getting your posts from Tumblr…'}</p>`
      : rows ? `<ul class="tb-list">${rows}</ul>${TB.more ? `<button class="b-link" type="button" data-tb="more"${TB.busy ? ' disabled' : ''}>Show more</button>` : ''}`
      : `<p class="day-note">${{ posts: 'Nothing on your Tumblr yet. Write your first post above.', drafts: 'No drafts on Tumblr.', queue: 'Nothing in your queue.' }[TB.list]}</p>`;
    return `<section class="b-panel" aria-label="Your posts on Tumblr"><div class="bp-head"><h3 class="b-sub">Your posts</h3><span class="bp-meta"><button class="b-link" type="button" data-tb="open" data-url="https://www.tumblr.com/blog/${esc(tbBlog())}${where}">Open on Tumblr</button></span></div>
      <div class="nb-chips">${[['posts', 'Posts'], ['drafts', 'Drafts'], ['queue', 'Queue']].map(([k, l]) => `<button class="nb-chip" type="button" data-tb="list" data-k="${k}" aria-pressed="${TB.list === k}">${l}</button>`).join('')}</div>${body}</section>`;
  }
  function tbNumbersHtml() {
    if (!TBL.busy && (!TBL.data && (!TBL.at || Date.now() - TBL.at > 5 * 60 * 1000) || TBL.data && Date.now() - TBL.at > 30 * 60 * 1000)) setTimeout(() => loadTumblrStats(), 0);
    if (TBL.data) return tumblrBlogHtml(TBL.data, TBL.at);
    return `<section class="b-panel md-blog md-blog-invite" aria-label="Your Tumblr's numbers"><div class="bp-head"><h3 class="b-sub">Your numbers</h3></div><p class="day-note">${TBL.err ? `Couldn’t get your Tumblr’s numbers just now. ${esc(TBL.err)} <button class="b-link" type="button" data-tbl-retry>Try again</button>` : 'Getting your Tumblr’s numbers…'}</p></section>`;
  }
  function tbPaint() {
    const a = document.activeElement, id = a && a.id && a.closest?.('#list') ? a.id : '';
    const sel = id && typeof a.selectionStart === 'number' ? a.selectionStart : null;
    const y = $('main').scrollTop, ly = $('listView').scrollTop;
    const t = SOC.accounts?.tumblr;
    const body = !t
      ? `<section class="b-panel wr-invite"><p class="b-sub">Tumblr</p><h2>Connect your Tumblr to start</h2>
          <p>Write notes and posts, keep drafts, fill your queue or schedule a post, see your followers and notes, and who’s replying and reblogging. Press Connect Tumblr, sign in on Tumblr’s page and approve The Reading Room.</p>
          <div class="wr-acts"><button class="btn primary" type="button" data-tb="connect">Connect Tumblr</button></div></section>`
      : !plusOk() ? `<section class="b-panel wr-invite"><p class="b-sub">Tumblr</p><h2>Work your Tumblr from here with The Reading Room Plus</h2>
          <p>Write, queue and schedule posts, and see your numbers and who’s talking to you, next to your reading.</p>
          <div class="wr-acts"><button class="btn primary" type="button" data-plus>See the price and try it free</button></div></section>`
      : tbComposerHtml() + tbPeopleHtml() + tbNumbersHtml() + tbPostsHtml();
    $('list').innerHTML = `<section class="brief myday tumblr-tab" aria-label="Tumblr">${body}</section>`;
    $('main').scrollTop = y; $('listView').scrollTop = ly;
    const el = id && $(id);
    if (el) { el.focus(); if (sel != null) try { el.setSelectionRange(sel, sel); } catch {} }
  }
  const tbKeep = () => { const d = tbDraft(); for (const [k, i] of [['title', 'tbTitle'], ['text', 'tbText'], ['tags', 'tbTags'], ['at', 'tbAt']]) if ($(i)) d[k] = $(i).value; store.set('tbDraft', JSON.stringify(d)); };
  document.addEventListener('input', e => { if (['tbTitle', 'tbText', 'tbTags', 'tbAt'].includes(e.target.id)) tbKeep(); if (e.target.id === 'tbAlt') TB.alt = e.target.value; });
  document.addEventListener('change', async e => {
    if (e.target.id !== 'tbPhoto') return;
    const file = e.target.files[0]; if (!file) return;
    tbKeep(); TB.say = 'Getting the photo ready…'; TB.sayErr = false; TB.link = ''; tbPaint();
    try { TB.photo = await shrinkPhoto(file); TB.say = ''; } catch { TB.photo = ''; TB.say = 'Couldn’t open that picture. Try another one, or save it as a JPEG first.'; TB.sayErr = true; }
    tbPaint(); $('tbAlt')?.focus();
  });
  async function tbSend(when) {
    tbKeep();
    const d = tbDraft(), title = (d.title || '').trim(), text = (d.text || '').trim();
    if (!title && !text && !TB.photo) { TB.say = 'Write something first.'; TB.sayErr = true; TB.link = ''; tbPaint(); $('tbText')?.focus(); return; }
    let publishOn = null;
    if (when === 'schedule') {
      const at = d.at ? new Date(d.at) : null;
      if (!at || isNaN(at) || at <= new Date()) { TB.say = 'Pick a time in the future to schedule it.'; TB.sayErr = true; TB.link = ''; tbPaint(); $('tbAt')?.focus(); return; }
      publishOn = at.toISOString();
    }
    TB.sending = true; TB.say = ''; tbPaint();
    try {
      const r = await invoke('tumblr_post', { kind: TB.kind, title, text, photo: TB.photo || '', alt: (TB.alt || '').trim(), tags: [d.tags || ''], when, publishOn });
      store.set('tbDraft', JSON.stringify({ at: d.at }));
      TB.photo = ''; TB.alt = ''; TB.sayErr = false;
      TB.link = when === 'published' ? (r?.url || '') : '';
      TB.say = when === 'published' ? 'Posted to your Tumblr.' : when === 'draft' ? 'Saved in your Tumblr drafts.' : when === 'queue' ? 'Added to your queue.' : `Scheduled for ${new Date(publishOn).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`;
      TB.list = when === 'published' ? 'posts' : when === 'draft' ? 'drafts' : 'queue'; TB.items = null; TB.err = '';
      TBL.at = 0;
    } catch (e) { TB.say = msg(e); TB.sayErr = true; TB.link = ''; }
    TB.sending = false; tbPaint();
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-tb]'); if (!b) return;
    const k = b.dataset.tb;
    if (k === 'connect') { openAccounts(); return; }
    if (k === 'kind') { tbKeep(); TB.kind = b.dataset.k; store.set('tbKind', TB.kind); tbPaint(); $('tbText')?.focus(); return; }
    if (k === 'photo') { tbKeep(); $('tbPhoto')?.click(); return; }
    if (k === 'nophoto') { TB.photo = ''; TB.alt = ''; tbPaint(); return; }
    if (k === 'send') { if (!plusOk()) { openPlus(); return; } tbSend(b.dataset.when); return; }
    if (k === 'list') { TB.list = b.dataset.k; TB.items = null; TB.err = ''; TB.confirm = 0; tbPaint(); return; }
    if (k === 'reload') { TB.items = null; TB.err = ''; tbPaint(); return; }
    if (k === 'more') { tbLoadList(TB.page + 1); return; }
    if (k === 'open' && isWeb(b.dataset.url)) { tauriInvoke('open_external', { url: b.dataset.url }).catch(err => status(msg(err), true)); return; }
    if (k === 'talk') { SOC.tab = 'you'; SOC.youChip = 'tumblr'; selectView('talk'); return; }
    if (k === 'ask') { TB.confirm = Number(b.dataset.id); tbPaint(); return; }
    if (k === 'keep') { TB.confirm = 0; tbPaint(); return; }
    const id = Number(b.dataset.id);
    if (k === 'delete') {
      try { await tauriInvoke('tumblr_delete', { id }); TB.items = (TB.items || []).filter(p => p.id !== id); status('Deleted from your Tumblr.'); }
      catch (err) { status(msg(err), true); }
      TB.confirm = 0; tbPaint(); return;
    }
    if (k === 'publish') {
      if (!plusOk()) { openPlus(); return; }
      b.disabled = true;
      try { const r = await tauriInvoke('tumblr_publish', { id }); TB.items = (TB.items || []).filter(p => p.id !== id); TB.say = 'Posted to your Tumblr.'; TB.sayErr = false; TB.link = r?.url || ''; TBL.at = 0; }
      catch (err) { status(msg(err), true); }
      tbPaint();
    }
  });

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
    const chips = `<div class="nb-chips">${YOU_CHIPS.filter(([k]) => k !== 'tumblr' || SOC.accounts.tumblr).filter(([k]) => !['comments', 'myreplies'].includes(k) || SOC.accounts.site).filter(([k]) => !['replies', 'posts'].includes(k) || anySocial())
      .map(([k, l]) => `<button class="nb-chip" data-talk="youchip" data-k="${k}" aria-pressed="${chip === k}">${l}</button>`).join('')}${alertsBtn('you', S.prefs.youAlerts !== false, 'Alerts')}</div>`;
    const waiting = SOC.comments?.waiting ? `<button class="nb-ev wait" data-talk="open" data-url="${esc(SOC.comments.admin)}">${SOC.comments.waiting} ${SOC.comments.waiting === 1 ? 'comment is' : 'comments are'} waiting for your approval</button>` : '';
    if (chip === 'myreplies') return chips + myRepliesHtml();
    if (chip === 'replies') return chips + repliesHtml();
    if (chip === 'posts') return chips + postsHtml();
    if (chip === 'mentions') return chips + blogHtml();
    if (chip === 'tumblr') return chips + (SOC.tumblr ? (SOC.tumblr.length ? SOC.tumblr.map(tumblrEvHtml).join('') : '<p class="note">No replies, reblogs with words, mentions or asks on your Tumblr yet. Likes and follows stay on Tumblr.</p>') : SOC.tumblrErr ? `<p class="note">Couldn’t reach Tumblr just now. ${esc(SOC.tumblrErr)}</p>` : '<p class="note">Looking at your Tumblr…</p>');
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
    for (const c of SOC.tumblr || []) ev.push({ date: c.date, html: tumblrEvHtml(c) });
    for (const i of linking) ev.push({ date: i.date, html: nbCard(i, x, soc) });
    // emails from the people you read (their address on their own site's domain)
    const people = new Map();
    for (const f of S.feeds) if (kindOf(f) === 'person' && !isEmailFeed(f)) { const h = bareHost(hostOfU(isWeb(f.site) ? f.site : f.url)); if (h && h !== host) people.set(h, feedById(personId(f.id)) || f); }
    for (const i of S.items.filter(i => isEmailItem(i) && i.links.startsWith('mailto:'))) {
      const f = people.get(bareHost(i.links.split('@')[1] || ''));
      if (f) ev.push({ date: i.date, html: `<article class="yu-ev${i.read ? '' : ' new'}">${nbFace(f, 'nb-av md')}<div class="nb-main"><div class="nb-by"><button class="nb-name" data-talk="nbwho" data-feed="${esc(f.id)}">${esc(f.title)}</button><span>emailed you</span><time>${esc(fmtWhen(i.date))}</time></div><button class="nb-title sm" data-open="${esc(i.id)}">${esc(i.title)}</button><div class="nb-acts"><button class="linkish" data-open="${esc(i.id)}">Read</button></div></div></article>` });
    }
    ev.sort((a, b) => b.date.localeCompare(a.date));
    const loading = (anySocial() && !SOC.conv) || (SOC.accounts.site && !SOC.comments);
    const empty = loading ? '<p class="note">Checking for replies, comments and mentions…</p>'
      : `<p class="nb-end">Nothing yet.<small>${anySocial() || SOC.accounts.site ? 'Replies, comments and links to your site show up here.' : 'Connect your site or a Mastodon or Bluesky account (Settings › Connections) to see replies here. Blogs linking to you show up either way.'}</small></p>`;
    return chips + waiting + (ev.length ? ev.slice(0, 50).map(e => e.html).join('') : empty);
  }

  // Tabs: what people share, replies to you, your posts, and people linking to your blog
  const TALK_TABS = [['blogs', 'Neighborhood'], ['shared', 'Following'], ['you', 'You'], ['search', 'Search']];
  const WEEK_MS = 7 * DAY;
  const myDomain = () => {
    const f = myFeed(); if (!f) return '';
    const h = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    return (isWeb(f.site) && h(f.site)) || h(f.url);
  };
  // Your site's comments: when Conversations opens, and every 15 minutes for alerts
  function loadComments() {
    if (!SOC.accounts.site) return;
    invoke('site_comments').then(c => { SOC.comments = c; youAlerts(); if (S.view === 'talk') { renderList(); renderRail(); } }).catch(() => { if (!SOC.comments) SOC.comments = { comments: [], waiting: 0 }; });
    if (SOC.accounts.tumblr) invoke('tumblr_activity').then(t => { SOC.tumblr = t || []; SOC.tumblrErr = ''; youAlerts(); if (S.view === 'talk') { renderList(); renderRail(); } })
      .catch(e => { SOC.tumblrErr = msg(e); if (!SOC.tumblr && S.view === 'talk') renderList(); });
    else SOC.tumblr = null;
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
  // Your own page (the same page everyone you read has), first in the You tab
  function myPageCard() {
    const mine = myFeed();
    if (!mine) return `<button class="pcard mycard" data-talk="pickmine" title="${esc(CUES.mypage)}">
        <span class="pav mine-empty">${ICONS.site}</span>
        <span class="pwho"><b>Your page</b><span class="plain">Show the app which site is yours</span></span></button>`;
    const pid = personId(mine.id), ids = new Set(S.feeds.filter(g => personId(g.id) === pid || g.id === pid).map(g => g.id));
    const month = S.items.filter(i => ids.has(i.feed_id) && Date.now() - Date.parse(i.date) < 30 * DAY).length;
    const x = nbIndex(), links = S.items.filter(i => x.toMe.has(i.id) && Date.now() - Date.parse(i.date) < 30 * DAY).length;
    return `<button class="pcard mycard" data-talk="nbwho" data-feed="${esc(pid)}" title="${esc(CUES.mypage)}">
        <span class="pav mine-face">${nbFace(mine, 'nb-av md')}</span>
        <span class="pwho"><b>Your page</b><span>${esc(mine.title)} · ${esc(bareHost(hostOfU(isWeb(mine.site) ? mine.site : mine.url)))}</span></span>
        <span class="pnums"><span class="pnum"><strong>${fmtN(month)}</strong><small>Posts this month</small></span><span class="pnum"><strong>${fmtN(links)}</strong><small>Linked to you</small></span></span></button>`;
  }
  // No site marked as yours yet: pick it from the people you follow, or add it
  function openPickMine() {
    const people = S.feeds.filter(f => kindOf(f) === 'person' && !isEmailFeed(f)).sort((a, b) => a.title.localeCompare(b.title));
    const el = sheet('pickMine', `<h2>Which site is yours?</h2>
      <p class="note">Your page shows your posts and notes, who talks with you and who links to you, like the page each person you read has. It needs your site's feed in your feeds.</p>
      ${people.length ? `<label class="pm-field"><span>Your site</span><select id="pmSel">${people.map(f => `<option value="${esc(f.url)}">${esc(f.title)} · ${esc(bareHost(hostOfU(isWeb(f.site) ? f.site : f.url)))}</option>`).join('')}</select></label>` : ''}
      <div class="row sheet-foot"><button class="btn" type="button" id="pmAdd">My site isn’t here: add it</button>${people.length ? '<button class="btn primary" type="button" id="pmOk">This is my site</button>' : ''}</div>`, 'Which site is yours?');
    $('pmAdd').onclick = () => { el.hidden = true; openAdd(); status('Paste your site’s address, then open it and choose This is my site.'); };
    if ($('pmOk')) $('pmOk').onclick = () => { S.prefs.mine = $('pmSel').value; savePrefs(); el.hidden = true; renderList(); status('Got it. Your page is at the top of You.'); };
  }
  function profilesHtml() {
    const ps = SOC.profiles || [];
    return `<div class="pstrip">${myPageCard()}${ps.map(p => {
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
    return c.posts.length ? samePosts(c.posts).map(g => g.length > 1 ? postPairHtml(g) : postHtml(g[0])).join('') : '<p class="note">Nothing posted yet. Open a story and choose Share › Post to Bluesky or Mastodon, or press New post.</p>';
  }
  // The same post sent to Mastodon and Bluesky shows once: same link (YouTube by video id), same link title,
  // or the same opening words, posted within a few hours of each other on different networks.
  const postLinkKey = u => {
    if (!u) return '';
    const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
    if (yt) return 'yt:' + yt[1];
    return u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?&](si|utm_[a-z]+|ref|fbclid)=[^&#]*/g, '').replace(/[?#]$/, '').replace(/#.*$/, '').replace(/\/$/, '');
  };
  const postWords = t => (t || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
  function samePosts(posts) {
    const groups = [];
    for (const p of posts) {
      const lk = postLinkKey(p.link), lt = (p.link_title || '').trim().toLowerCase(), w = postWords(p.text), at = Date.parse(p.created_at);
      const g = groups.find(g => !g.some(q => q.network === p.network) && g.some(q => Math.abs(Date.parse(q.created_at) - at) < 6 * 3600e3 &&
        ((lk && lk === postLinkKey(q.link)) || (lt && lt === (q.link_title || '').trim().toLowerCase()) || (w.length >= 20 && w === postWords(q.text)))));
      if (g) g.push(p); else groups.push([p]);
    }
    return groups;
  }
  // One card for a post on both networks: the longest text, each network's replies and counts, both Open links
  function postPairHtml(g) {
    const p = g.reduce((a, b) => (b.text || '').length > (a.text || '').length ? b : a);
    const lp = g.find(q => q.link) || p;
    const it = lp.link && S.items.find(i => i.link && i.link.replace(/\/$/, '') === lp.link.replace(/\/$/, ''));
    const replies = g.reduce((s, q) => s + (q.replies || 0), 0);
    const per = q => {
      const open = SOC.open.has(q.id);
      return [q.replies ? `<button class="t-count linkish" data-talk="thread" data-net="${q.network}" data-id="${esc(q.id)}">${q.replies} ${q.replies === 1 ? 'reply' : 'replies'} on ${NET[q.network]}${open ? ' ▴' : ' ▾'}</button>` : '',
        q.reposts ? `<span>${q.reposts} ${q.network === 'mastodon' ? (q.reposts === 1 ? 'boost' : 'boosts') : (q.reposts === 1 ? 'repost' : 'reposts')}</span>` : '',
        q.likes ? `<span>${q.likes} ${q.network === 'mastodon' ? (q.likes === 1 ? 'favorite' : 'favorites') : (q.likes === 1 ? 'like' : 'likes')} on ${NET[q.network]}</span>` : ''].join('');
    };
    const threads = g.filter(q => SOC.open.has(q.id)).map(q => { const t = SOC.threads.get(q.id);
      return `<div class="t-thread">${t === undefined ? '<p class="note">Loading the replies…</p>' : t.length ? t.map(n => noteHtml(n, { reply: true, rootId: q.id, rootCid: q.cid })).join('') : '<p class="note">No replies yet.</p>'}</div>`; }).join('');
    const pic = postPic(g, it);
    return `<article class="t-post${pic ? ' has-pic' : ''}"><div class="tp-row"><div class="tp-main">
      <div class="t-story">${!lp.link ? `<span class="t-plain">${g.map(q => ICON_NET[q.network]).join('')}</span>` : ''}${lp.link ? `<button class="t-link" ${it ? `data-open="${esc(it.id)}"` : `data-talk="open" data-url="${esc(lp.link)}"`}>${esc(lp.link_title || lp.link.replace(/^https?:\/\//, ''))}</button>` : ''}
        <span class="t-when" title="Posted to ${g.map(q => NET[q.network]).join(' and ')}">${g.map(q => ICON_NET[q.network]).join('')} ${esc(fmtWhen(p.created_at))}</span></div>
      ${p.text ? `<p class="t-note">${esc(p.text)}</p>` : ''}
      <div class="t-meta">${replies ? '' : '<span>No replies yet</span>'}${g.map(per).join('')}
        ${g.map(q => `<button class="linkish" data-talk="open" data-url="${esc(q.url)}">Open on ${NET[q.network]}</button>`).join('')}</div>
      </div>${pic}</div>
      ${g.map(q => `<div class="n-box" data-box="${esc(q.id)}"></div>`).join('')}
      ${threads}
    </article>`;
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
  // ---- Search: what everyone is saying right now (an outage, the news), on Bluesky and Mastodon through your
  // accounts, and in the feeds you read. Newest first; Check again (or the refresh button) looks again.
  const searches = () => { try { return JSON.parse(store.get('searches') || '[]'); } catch { return []; } };
  const setSearches = list => store.set('searches', JSON.stringify(list.slice(0, 8)));
  const srWords = q => q.toLowerCase().split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  function feedMatches(q) {
    const words = srWords(q), since = Date.now() - 7 * DAY;
    if (!words.length) return [];
    return S.items.filter(i => Date.parse(i.date) > since && !isEmailItem(i) && !isMuted(i))
      .filter(i => { const t = `${i.title} ${i.summary}`.toLowerCase(); return words.every(w => t.includes(w)); })
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }
  async function runSearch(q) {
    q = (q || '').trim(); if (!q) return;
    SOC.tab = 'search'; SOC.person = null; SOC.sq = q; SOC.srAllFeeds = false;
    setSearches([q, ...searches().filter(x => x.toLowerCase() !== q.toLowerCase())]);
    SOC.sres = { q, loading: true, posts: SOC.sres?.q === q ? SOC.sres.posts : [], errors: [] };
    renderList();
    let res = { posts: [], errors: [] };
    if (anySocial()) { try { res = await invoke('social_search', { query: q }); } catch (e) { res.errors = [msg(e)]; } }
    if (SOC.sq !== q) return; // another search started meanwhile
    SOC.sres = { q, loading: false, posts: res.posts || [], errors: res.errors || [], at: Date.now() };
    if (S.view === 'talk' && SOC.tab === 'search') renderList();
  }
  function talkSearchHtml() {
    const q = SOC.sq || '', r = SOC.sres && SOC.sres.q === q ? SOC.sres : null, past = searches();
    const form = `<form class="sr-form" id="srForm" role="search"><input type="search" id="srQ" value="${esc(q)}" placeholder="What’s going on? Try “Outlook down”" aria-label="Search what people are saying" autocomplete="off" enterkeyhint="search"><button class="btn primary" type="submit">Search</button></form>
      ${past.length ? `<div class="sr-past">${past.map(p => `<span class="sr-chip${p === q ? ' on' : ''}"><button class="linkish" data-talk="srch" data-q="${esc(p)}">${esc(p)}</button><button class="sr-x" data-talk="srdrop" data-q="${esc(p)}" aria-label="Forget ${esc(p)}">×</button></span>`).join('')}</div>` : ''}`;
    if (!q) return `<div class="nb-col sr">${form}<p class="sec-s sr-intro">When something big happens (an outage, a storm, the news), see what people are saying about it right now: recent posts from everyone on Bluesky and Mastodon${anySocial() ? '' : ' (connect an account in Settings › Connections)'}, and posts from the blogs you read.</p></div>`;
    const feeds = feedMatches(q), shownFeeds = SOC.srAllFeeds ? feeds : feeds.slice(0, 6);
    const nets = [SOC.accounts.bluesky && 'Bluesky', SOC.accounts.mastodon && 'Mastodon'].filter(Boolean);
    const social = !anySocial() ? `<p class="sec-s">Connect Bluesky or Mastodon (Settings › Connections) to see what everyone is saying about this right now. Below are posts from the blogs you read.</p>`
      : r?.loading && !r.posts.length ? `<p class="sec-s sr-wait">Looking on ${nets.join(' and ')}…</p>`
      : !r ? '' : `<p class="sec-s">${r.posts.length ? `${r.posts.length} recent post${r.posts.length === 1 ? '' : 's'} on ${nets.join(' and ')}, newest first` : `Nothing on ${nets.join(' or ')} yet`}${r.at ? ` · looked ${esc(fmtWhen(r.at))}` : ''} · <button class="linkish" data-talk="srch" data-q="${esc(q)}">Check again</button></p>
        ${r.errors.length ? `<p class="sec-s err">${r.errors.map(esc).join(' · ')}</p>` : ''}
        ${SOC.accounts.mastodon ? '<p class="sec-s sr-note">Mastodon only shows posts its search allows, plus posts with these words as hashtags.</p>' : ''}
        <div class="sr-list">${r.posts.map(n => noteHtml(n)).join('')}</div>`;
    const feedList = feeds.length ? `<h2 class="sec-t">In the blogs you read</h2><p class="sec-s">${feeds.length} post${feeds.length === 1 ? '' : 's'} from the last week</p>
      <ul class="sr-feeds">${shownFeeds.map(i => { const f = feedById(i.feed_id); return `<li><button class="sr-item" data-open="${esc(i.id)}">${f ? nbFace(f, 'nb-av sm') : ''}<span><b>${esc(headline(i) || (i.summary || '').slice(0, 100))}</b><small>${esc(f?.title || '')} · ${esc(fmtWhen(i.date))}</small></span></button></li>`; }).join('')}</ul>
      ${feeds.length > shownFeeds.length ? `<button class="linkish" data-talk="srfeeds">Show all ${feeds.length}</button>` : ''}`
      : `<h2 class="sec-t">In the blogs you read</h2><p class="sec-s">Nothing from the last week yet.</p>`;
    return `<div class="sr">${form}<div class="tcols"><div class="tmain"><h2 class="sec-t">What people are saying</h2>${social}</div><aside class="tside">${feedList}</aside></div></div>`;
  }
  document.addEventListener('submit', e => {
    if (e.target.id !== 'srForm') return;
    e.preventDefault(); runSearch($('srQ').value);
  });
  function talkHtml() {
    const who = SOC.person && feedById(SOC.person);
    paintTalkHead();
    // Three tabs (in the title row): the Neighborhood, Following (Mastodon and Bluesky), and You
    const { tab } = talkTabsInfo();
    if (tab === 'blogs') return `<div class="nb-col">${who ? personHtml(who) : neighborhoodHtml()}</div>`;
    if (tab === 'you') return `<div class="nb-col">${profilesHtml()}${youHtml()}</div>`;
    if (tab === 'search') return talkSearchHtml();
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
  // Unfollow from a person's page: every feed that's theirs (their blog, plus any extra feeds shown under the same face)
  function confirmUnfollowPerson(f) {
    const pid = personId(f.id);
    const feeds = S.feeds.filter(g => g.id === pid || personId(g.id) === pid);
    if (!feeds.length) return;
    const extra = feeds.length - 1;
    showBanner(`<span>Unfollow ${esc(f.title)}?${extra ? ` That’s their ${extra + 1} feeds.` : ''} Their posts leave your reader too, including ones saved for later.</span><button class="btn danger" id="yesUnfollowPerson">Unfollow</button><button class="btn" id="noUnfollowPerson">Cancel</button>`, false, 'confirm');
    $('noUnfollowPerson').onclick = hideBanner;
    $('yesUnfollowPerson').onclick = async () => {
      hideBanner();
      const wasFriend = isFriend(f), ids = new Set(feeds.map(g => g.id));
      try {
        for (const g of feeds) await invoke('remove_feed', { id: g.id });
        if (wasFriend) { const k = friendKey(f); S.prefs.friends = (S.prefs.friends || []).filter(x => x !== k); savePrefs(); }
        // Back to where you were, unless that was one of the feeds just removed
        const from = SOC.personFrom || {};
        if (from.view !== undefined && ids.has(String(from.view))) SOC.personFrom = { tab: 'blogs' };
        personBack();
        status(`Unfollowed ${f.title}.`);
        load();
      } catch (e) { status(msg(e), true); load(); }
    };
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
    if (e.target.id === 'talkRefresh' && SOC.tab === 'search' && SOC.sq) { runSearch(SOC.sq); return; }
    if (e.target.id === 'talkRefresh') { SOC.shared = null; SOC.mentions = null; SOC.comments = null; SOC.tumblr = null; SOC.whole.clear(); loadTalk(); renderList(); return; }
    const b = e.target.closest('[data-talk]'); if (!b) return;
    const k = b.dataset.talk;
    if (k === 'nbwho') { if (!b.dataset.feed) { SOC.nbWho = ''; renderList(); return; }
      if (!SOC.person) SOC.personFrom = { tab: SOC.tab, chip: SOC.youChip, top: $('main').scrollTop };
      SOC.person = b.dataset.feed; SOC.personShown = 15; SOC.tab = 'blogs'; renderList(); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'nbback') { personBack(); return; }
    if (k === 'pickmine') { openPickMine(); return; }
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
    if (k === 'unfollow') { const f = feedById(b.dataset.feed); if (f) confirmUnfollowPerson(f); return; }
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
    if (k === 'cue') { status(CUES[b.dataset.cue] || ''); return; }
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
    // Tumblr's own pages open in your browser, where you're signed in to Tumblr
    if (k === 'xopen' && isWeb(b.dataset.url)) invoke('open_external', { url: b.dataset.url }).catch(e => status(msg(e), true));
    if (k === 'tfollow') { b.disabled = true; b.textContent = 'Adding…';
      invoke('add_feed', { url: b.dataset.url, title: null, folderId: null }).then(r => { status(`Following ${r.title}.`); b.textContent = 'Following'; load(); })
        .catch(e => { if (/already follow/i.test(msg(e))) { b.textContent = 'Following'; return; } b.disabled = false; b.textContent = 'Follow their Tumblr'; status(msg(e), true); }); }
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
    if (k === 'srch') { runSearch(b.dataset.q); return; }
    if (k === 'srdrop') { setSearches(searches().filter(q => q !== b.dataset.q)); renderList(); return; }
    if (k === 'srfeeds') { SOC.srAllFeeds = true; renderList(); return; }
    if (k === 'newpost') { if (SOC.accounts.site) openNote(null); else openCompose(null); }
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
    const vs = videoSite(it);
    if (vs) rows.push(`<button type="button" role="menuitem" data-reply-yt="1" title="${esc(CUES.ytc(vs.name))}">${ICON_TALK}<span>Comment on ${esc(vs.name)}<small>opens the video; its comments are under it</small></span></button>`);
    else if (o.comments) rows.push(`<button type="button" role="menuitem" data-reply-web="${esc(o.comments)}">${ICON_TALK}<span>Leave a comment<small>on the post</small></span></button>`);
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
    const b = e.target.closest('[data-reply], [data-reply-web], [data-reply-app], [data-mention-app], [data-reply-mail], [data-reply-yt]'); if (!b) return;
    $('replyMenu').hidden = true;
    if (b.dataset.replyYt) {
      const it = item(replyFor), box = it && document.querySelector(`.n-box[data-box="nb:${CSS.escape(it.id)}"] textarea`);
      return videoComment(it, (box?.value || DRAFTS['nb:' + it?.id]?.text || '').trim());
    }
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

  // Videos on a wide screen: the right side shows Up next instead of "Pick a video" (David, Nov 23: "What can we do
  // with this opening screen?"): the newest video you haven't watched, big and ready to play, and the next few.
  function paintUpNext() {
    const box = $('readerEmpty'); if (!box) return;
    let up = box.querySelector('.upnext');
    const list = S.view === 'videos' ? visible().filter(i => isVideoItem(i) && !i.read) : [];
    box.classList.toggle('has-upnext', list.length > 0);
    if (!list.length) { up?.remove(); return; }
    if (!up) { up = document.createElement('div'); up.className = 'upnext'; box.appendChild(up); }
    const pic = i => isWeb(i.image) ? i.image : ytId(i.link) ? `https://i.ytimg.com/vi/${ytId(i.link)}/hqdefault.jpg` : '';
    const chan = i => feedById(i.feed_id)?.title || '';
    const [first, ...rest] = list;
    up.innerHTML = `<p class="un-k">Up next · ${list.length} you haven’t watched</p>
      <button class="un-big" type="button" data-upnext="${esc(first.id)}" title="Watch “${esc(headline(first))}”">${pic(first) ? `<img src="${esc(pic(first))}" alt="" referrerpolicy="no-referrer">` : ''}<span class="un-play" aria-hidden="true">▶</span></button>
      <h3 class="un-t"><button class="linkish" type="button" data-upnext="${esc(first.id)}">${esc(headline(first))}</button></h3>
      <p class="un-m">${esc(chan(first))} · ${esc(ago(first.date))}</p>
      ${rest.length ? `<ol class="un-list">${rest.slice(0, 4).map(i => `<li><button type="button" data-upnext="${esc(i.id)}">${pic(i) ? `<img src="${esc(pic(i))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="un-noimg"></span>'}<span><b>${esc(headline(i))}</b><small>${esc(chan(i))} · ${esc(ago(i.date))}</small></span></button></li>`).join('')}</ol>` : ''}
      <p class="un-hint">Or pick any video on the left. j and k move through the list.</p>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-upnext]'); if (b) openReader(b.dataset.upnext); });
  function openReader(id) {
    const it = item(id); if (!it) return;
    if (S.readerId && S.readerId !== id) toMini(); // what's playing keeps going in the corner
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
    toMini(); // whatever is playing keeps going in the corner
    if (!silent) maybeAskReview();
    S.readerId = null; articleFor = null; hidePops();
    // what was playing has moved to the mini player; the rest stops
    $('rMedia').innerHTML = ''; $('rMedia').hidden = true;
    // videos inside the story stop too (a hidden player keeps playing otherwise)
    $('rBody').querySelectorAll('.r-video').forEach(v => v.remove());
    $('reader').hidden = true; $('listView').hidden = false; $('readerEmpty').hidden = false; syncWide(); paintUpNext();
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
    // what fits the folder: Move to Inbox (Archive, Trash) or Not spam; no Archive in Archive or Sent, no Delete
    // in Trash, no Reply to your own sent email (Forward still works)
    const fk = em ? mailFolderOf(it) : '';
    $('rDelete').hidden = !em || fk === 'trash'; $('rArchive').hidden = !em || fk !== 'inbox';
    $('rMove').hidden = !em || !['archive', 'trash', 'spam'].includes(fk);
    $('rMove').textContent = fk === 'spam' ? 'Not spam' : 'Move to Inbox';
    $('rMove').title = fk === 'spam' ? 'Not junk: put it in your inbox' : 'Put it back in your inbox';
    $('rReply').hidden = em && fk === 'sent';
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
  // Read like email: the email being answered folds away, the signature is set apart, and plain text cut into
  // short lines goes back into paragraphs. Newsletters: their hidden preview line goes, links drawn as buttons
  // stay buttons, side-by-side columns stay apart, and the footer (unsubscribe and so on) is made small.
  // Tracking pixels are taken out before anything loads (see mailFragment).
  function mailFragment(html) {
    const t = document.createElement('template'); t.innerHTML = html; // nothing in a template loads
    const f = t.content;
    f.querySelectorAll('[data-rr-hide]').forEach(el => el.remove());
    f.querySelectorAll('img').forEach(img => {
      const w = Number(img.getAttribute('width')), h = Number(img.getAttribute('height')), src = img.getAttribute('src') || '';
      if ((w > 0 && w <= 3) || (h > 0 && h <= 3) || /\/(open|o|t|track|pixel|beacon)\.(gif|png)(\?|$)|\/(track|open)\/|[?&](open|track)=|pixel\.|beacon|spacer\.gif/i.test(src)) img.remove();
    });
    return f;
  }
  function tidyMail(body, it) {
    const empty = el => !el.textContent.trim() && !el.querySelector('img, a, hr');
    body.querySelectorAll('tr').forEach(tr => { if (empty(tr)) tr.remove(); });
    body.querySelectorAll('td, th').forEach(td => { if (empty(td)) td.remove(); });
    // Spacer paragraphs (Outlook's <p>&nbsp;</p>, Gmail's <div><br></div>): paragraphs already have room
    // between them, so a spacer paragraph goes; a run of spacer lines keeps one
    const blank = el => !el.textContent.replace(/[\s\u00a0\u200b-\u200f\u034f]/g, '') && !el.querySelector('img, hr, table, a, video');
    body.querySelectorAll('p').forEach(p => { if (blank(p)) p.remove(); });
    body.querySelectorAll('div').forEach(d => { if (blank(d) && d.previousElementSibling && blank(d.previousElementSibling) && d.previousElementSibling.tagName === 'DIV') d.remove(); });
    // "View in browser" / "View this email online": a quiet link, not the first thing you read
    body.querySelectorAll('a').forEach(a => { if (/^\s*(view|read|open)\b.{0,30}\b(online|on the web|in (your |a |the )?(web )?browser|web version)\s*$/i.test(a.textContent)) { const blk = a.closest('p, td, div'); (blk && blk.textContent.trim().length < 120 ? blk : a).classList.add('mail-web'); } });
    // The subject repeated as the email's own heading (near the top)
    const tops = [...body.querySelectorAll('p, div, span, td, h1, h2, h3')].filter(el => el.textContent.trim() && !el.querySelector('p, div, td, h1, h2, h3') && !el.closest('.mail-web')).slice(0, 4);
    const same = it && tops.find(el => el.textContent.trim().toLowerCase() === headline(it).trim().toLowerCase() && !el.querySelector('img'));
    if (same) same.remove();
    // Plain text: "> " lines are a quote; lines cut at about 72 characters go back into paragraphs
    body.querySelectorAll('p').forEach(p => {
      if (!p.querySelector('br') || p.querySelector('table, div, p')) return;
      const lines = p.innerHTML.split(/<br\s*\/?>/i), texts = lines.map(l => l.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').trim());
      if (lines.every(l => /^&gt;/.test(l.trim()))) {
        const q = document.createElement('blockquote'); const inner = document.createElement('p');
        inner.innerHTML = lines.map(l => l.trim().replace(/^(&gt;\s?)+/, '')).join('<br>'); q.appendChild(inner); p.replaceWith(q); return;
      }
      if (lines.length < 3) return;
      const wrapped = texts.filter(t => t.length >= 50 && t.length <= 80).length;
      if (wrapped / texts.length < 0.5) return;
      let out = lines[0];
      for (let k = 1; k < lines.length; k++) out += (texts[k - 1].length < 45 || !texts[k] || /^([-*•]|\d+[.)])\s/.test(texts[k])) ? '<br>' + lines[k] : ' ' + lines[k].trimStart();
      p.innerHTML = out;
    });
    // The email being answered: from "On … wrote:" (or "Original Message") to the end, folded away
    const fold = start => {
      if (!start?.parentNode || start.closest('details')) return;
      // start from the outermost block the marker begins (Gmail's quote box, Outlook's divider), so the
      // email being answered goes with it, not just the line that introduces it
      for (let up = start.parentElement; up && up.parentNode && up !== body && up.firstElementChild === start
        && up.textContent.trim().startsWith(start.textContent.trim().slice(0, 40)); up = up.parentElement) start = up;
      const det = document.createElement('details'); det.className = 'mail-quote';
      det.innerHTML = '<summary>Show the earlier email</summary>';
      start.parentNode.insertBefore(det, start);
      for (let n = start; n;) { const next = n.nextSibling; det.appendChild(n); n = next; }
    };
    const marker = [...body.querySelectorAll('p, div, span, td')].find(el => el.textContent.length < 400 && /^\s*(On\s.{4,200}\swrote:|-{3,}\s*Original Message\s*-{3,}|From:\s.{3,200}\s(Sent|Date):\s)/is.test(el.textContent) && ![...el.children].some(c => /^(P|DIV|TABLE)$/.test(c.tagName)));
    if (marker) fold(marker);
    else if (it && /^(re|aw|sv|antw)\s*:/i.test(headline(it))) body.querySelectorAll('blockquote').forEach(b => { if (!b.parentElement?.closest('blockquote, details')) fold(b); });
    // The signature: after a "-- " line, or a "Sent from my …" line
    const sig = body.querySelector('[data-rr-sig]') || [...body.querySelectorAll('p, div')].find(el => !el.querySelector('p, div, table') && (/^--\s*(\n|$)/.test(el.innerText || el.textContent) || /^\s*--\s*$/.test(el.textContent) || /^Sent from my \w+/i.test(el.textContent.trim())));
    if (sig && !sig.closest('details')) for (let n = sig; n; n = n.nextElementSibling) n.classList.add('mail-sig');
    // Newsletters: buttons, columns and the footer
    // a link the cleaning took the address from (javascript:, data:) is just its words
    body.querySelectorAll('a:not([href])').forEach(a => a.replaceWith(...a.childNodes));
    body.querySelectorAll('a[data-rr-btn]').forEach(a => a.classList.add('mail-btn'));
    body.querySelectorAll('[data-rr-cell]').forEach(td => { const a = td.querySelectorAll('a'); if (a.length === 1 && !td.querySelector('img') && a[0].textContent.trim() && td.textContent.trim() === a[0].textContent.trim() && a[0].textContent.trim().length <= 40) a[0].classList.add('mail-btn'); });
    body.querySelectorAll('[data-rr-att]').forEach(d => d.classList.add('mail-att'));
    body.querySelectorAll('tr').forEach(tr => {
      const cells = [...tr.children].filter(c => /^T[DH]$/.test(c.tagName));
      if (cells.length >= 2 && cells.filter(c => c.textContent.trim().length > 30 || c.querySelector('img')).length >= 2) tr.classList.add('mail-cols');
    });
    const foot = [...body.querySelectorAll('p, td, div, span')].filter(el => el.textContent.length < 1500 && /unsubscribe|opt[ -]out|email preferences|manage (your )?(subscription|preferences|email)|update your preferences/i.test(el.textContent)).pop();
    if (foot) {
      const block = (foot.closest('tr') && foot.closest('tr').textContent.length < 1500 ? foot.closest('tr') : null) || foot.closest('p, div') || foot;
      for (let n = block; n; n = n.nextElementSibling) n.classList.add('mail-foot');
    }
  }
  // Who an email is from, above it (name, address, when)
  function mailHead(it) {
    const name = it.byline || srcLabel(it) || 'Email';
    const when = new Date(it.date).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const el = document.createElement('div'); el.className = 'mail-head';
    el.innerHTML = `${mailAvatar(it)}
      <div class="mh-who"><b>${esc(name)}</b> <span class="mh-addr"></span><small>${esc(when)}</small></div>`;
    invoke('email_from', { itemId: it.id }).then(r => {
      const a = el.querySelector('.mh-addr'); if (!a || !r) return;
      if (r.address && r.address !== name) a.textContent = `<${r.address}>`;
      const sm = el.querySelector('small');
      if (sm) sm.textContent = [r.to ? `to ${r.to}` : '', r.replyTo && r.replyTo !== r.address ? `replies go to ${r.replyTo}` : '', when].filter(Boolean).join(' · ');
    }).catch(() => {});
    return el;
  }
  function paintArticle() {
    const body = $('rBody');
    const isMail = isEmailItem(item(S.readerId) || {});
    body.classList.toggle('mail-body', isMail);
    if (isMail) {
      const it = item(S.readerId), f = mailFragment(articleHtml);
      tidyMail(f, it);
      const held = mailHoldPictures(f, it);
      mailFiles(f, it);
      body.replaceChildren(mailHead(it), ...(held ? [mailPicsBar(it, held)] : []), f);
      paintMailExtras();
    } else body.innerHTML = articleHtml;
    // YouTube players in the story come through as marked links; play them right here
    const shown = ytId(item(S.readerId)?.link);
    body.querySelectorAll('a[href$="#rr-video"]').forEach(a => {
      const id = ytId(a.getAttribute('href')), spot = a.parentElement?.tagName === 'P' && a.parentElement.textContent.trim() === a.textContent.trim() ? a.parentElement : a;
      if (!id || id === shown) { spot.remove(); return; } // the story's own video already plays above
      const v = document.createElement('div');
      v.className = 'r-video r-inline-video';
      v.innerHTML = ytPlayer(id, a.closest('figure')?.querySelector('figcaption')?.textContent || 'Video', miniTime(id, S.readerId));
      spot.replaceWith(v);
      v.insertAdjacentHTML('afterend', followRow(id));
    });
    fillFollowRows(body);
    body.querySelectorAll('img').forEach(img => {
      if (img.dataset.rrSrc) return; // a picture from the web held back until you say so (Email)
      img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      // A picture that can't load leaves no empty frame behind (nor an empty figure around it).
      const drop = () => {
        const fig = img.closest('figure'), alt = (img.getAttribute('alt') || '').trim();
        if (isMail && alt.length > 3 && !(Number(img.getAttribute('width')) > 0 && Number(img.getAttribute('width')) < 100) && !/^[\w-]+\.(jpe?g|png|gif|webp|heic)$/i.test(alt) && !/^(logo|image|photo|picture|spacer)$/i.test(alt)) { const t = document.createElement('span'); t.className = 'mail-alt'; t.textContent = alt; img.replaceWith(t); return; }
        img.remove(); if (fig && !fig.querySelector('img, video')) fig.remove();
      };
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
      `<div class="quote" data-jump="${h.id}"><q>${esc(h.text)}</q>${h.note ? `<span class="note-text">${esc(h.note)}</span>` : ''}<button class="linkish qc-btn" type="button" data-qcard="${h.id}" title="Make a picture of this passage to share">Quote card</button></div>`).join('') : '';
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
  const cardFromSel = () => { const t = pending?.text?.trim(), it = item(S.readerId); $('selPop').hidden = true; pending = null; if (t && it) openQuoteCard(t.length > 600 ? t.slice(0, 590).replace(/\s+\S*$/, '') + '…' : t, it); };
  $('selCard').onclick = cardFromSel;
  $('selCard').addEventListener('touchstart', e => { e.preventDefault(); cardFromSel(); }, { passive: false });
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

  // ---- Quote cards: a passage as a picture, with who wrote it and where, to send in WhatsApp, Messages, Instagram…
  const CARD_LOOK = {
    paper: { bg: '#F7F2E8', ink: '#1F1B16', muted: '#6B645A', accent: '#127A62', line: '#DDD4C4' },
    night: { bg: '#13201C', ink: '#F1EEE6', muted: '#A9B3AE', accent: '#3CC39E', line: '#2C3D37' },
  };
  const cardWriter = it => (!isEmailItem(it) && (it.byline || '').trim()) || srcLabel(it) || hostOfU(it.link);
  function wrapLines(ctx, text, maxW) {
    const out = [];
    for (const para of text.split(/\n+/)) {
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
      }
      if (line) out.push(line);
    }
    return out;
  }
  const fitOne = (ctx, t, maxW) => { if (ctx.measureText(t).width <= maxW) return t; let s = [...t]; while (s.length && ctx.measureText(s.join('') + '…').width > maxW) s.pop(); return s.join('').trimEnd() + '…'; };
  async function drawQuoteCard(text, it, look = 'paper') {
    const W = 1080, H = 1350, P = 96, c = CARD_LOOK[look] || CARD_LOOK.paper;
    try { await Promise.all(['400 60px Newsreader', 'italic 400 32px Newsreader', '600 40px Geist', '400 30px Geist', '500 26px Geist'].map(f => document.fonts.load(f))); } catch {}
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H }), ctx = cv.getContext('2d');
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c.accent; ctx.fillRect(0, 0, W, 14);
    ctx.textBaseline = 'alphabetic';
    // the big opening quote mark
    ctx.fillStyle = c.accent; ctx.font = '400 220px Newsreader'; ctx.fillText('“', P - 12, 290);
    // the passage: as large as fits
    const words = text.replace(/\s+/g, ' ').trim().replace(/^[“"']+|[”"']+$/g, '');
    const top = 320, bottom = H - 430, maxW = W - P * 2;
    let size = 84, lines, lh;
    for (; size >= 30; size -= 2) {
      ctx.font = `400 ${size}px Newsreader`; lh = Math.round(size * 1.32);
      lines = wrapLines(ctx, words, maxW);
      if (lines.length * lh <= bottom - top) break;
    }
    if (size < 30) { size = 30; lh = 40; ctx.font = '400 30px Newsreader'; lines = wrapLines(ctx, words, maxW); const n = Math.floor((bottom - top) / lh); if (lines.length > n) { lines = lines.slice(0, n); lines[n - 1] = fitOne(ctx, lines[n - 1] + ' …', maxW); } }
    const last = lines.length - 1; lines[last] = lines[last] + '”';
    ctx.fillStyle = c.ink;
    let y = top + Math.max(0, ((bottom - top) - lines.length * lh) / 2) + size;
    for (const l of lines) { ctx.fillText(l, P, y); y += lh; }
    // who wrote it, the post, and where it lives
    ctx.fillStyle = c.ink; ctx.font = '600 40px Geist'; ctx.fillText(fitOne(ctx, '— ' + cardWriter(it), maxW), P, H - 300);
    ctx.fillStyle = c.muted; ctx.font = 'italic 400 34px Newsreader'; ctx.fillText(fitOne(ctx, headline(it), maxW), P, H - 246);
    ctx.font = '400 30px Geist'; ctx.fillText(fitOne(ctx, hostOfU(it.link), maxW), P, H - 198);
    ctx.fillStyle = c.line; ctx.fillRect(P, H - 140, maxW, 2);
    ctx.font = '500 26px Geist'; ctx.fillStyle = c.muted; ctx.fillText('Found in The Reading Room', P, H - 86);
    ctx.textAlign = 'right'; ctx.fillText('readingroomapp.com', W - P, H - 86); ctx.textAlign = 'left';
    return cv;
  }
  async function openQuoteCard(text, it) {
    if (!it || !text.trim()) return;
    hidePops(); window.getSelection()?.removeAllRanges();
    let look = store.get('cardLook') === 'night' ? 'night' : 'paper', cv = null;
    const el = sheet('cardPanel', `<h2>Quote card</h2>
      <p>A picture of the passage, with who wrote it and where. Send it with the link so people can read the whole post.</p>
      <div class="qc-wrap"><img id="qcImg" alt=""></div>
      <div class="row qc-looks"><div class="seg" id="qcLook"><button type="button" data-look="paper">Paper</button><button type="button" data-look="night">Night</button></div></div>
      <p class="acct-note" id="qcNote" aria-live="polite"></p>
      <div class="row sheet-foot"><button class="btn" type="button" id="qcClose">Close</button><button class="btn" type="button" id="qcLink">Copy link</button>
        ${IOS ? '<button class="btn primary" type="button" id="qcShare">Share…</button>' : '<button class="btn" type="button" id="qcCopy">Copy picture</button><button class="btn primary" type="button" id="qcSave">Save picture…</button>'}</div>`, 'Quote card');
    const say = (t, err) => { $('qcNote').textContent = t; $('qcNote').classList.toggle('err', !!err); };
    const paint = async () => {
      el.querySelectorAll('[data-look]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.look === look)));
      cv = await drawQuoteCard(text, it, look); $('qcImg').src = cv.toDataURL('image/png');
      $('qcImg').alt = `“${clipT(text, 200)}” — ${cardWriter(it)}, ${hostOfU(it.link)}`;
    };
    const blob = () => new Promise(r => cv.toBlob(r, 'image/png'));
    const fname = () => `Quote – ${cardWriter(it)}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 70);
    $('qcLook').onclick = e => { const b = e.target.closest('[data-look]'); if (!b) return; look = b.dataset.look; store.set('cardLook', look); paint(); };
    $('qcClose').onclick = () => { el.hidden = true; };
    $('qcLink').onclick = async () => { try { await navigator.clipboard.writeText(it.link); say('Link copied. Paste it after the picture.'); } catch { say(`The link is ${it.link}`); } };
    if ($('qcShare')) $('qcShare').onclick = async () => {
      const file = new File([await blob()], fname() + '.png', { type: 'image/png' });
      const data = { files: [file], text: `${headline(it)} ${it.link}` };
      if (navigator.canShare?.(data)) { try { await navigator.share(data); } catch (e) { if (e?.name !== 'AbortError') say(msg(e), true); } }
      else say('Touch and hold the picture to save or share it, then send the link with it.');
    };
    if ($('qcCopy')) $('qcCopy').onclick = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]); say('Picture copied. Paste it into WhatsApp, Messages or anywhere else.'); }
      catch { say('Couldn’t copy the picture here. Use Save picture… instead.', true); }
    };
    if ($('qcSave')) $('qcSave').onclick = async () => {
      try { if (await invoke('save_image', { name: fname(), data: cv.toDataURL('image/png') })) say('Saved.'); } catch (e) { say(msg(e), true); }
    };
    await paint();
  }

  // ---- What I read this week: a roundup of your favorites, each with a line, for your site or an email
  function roundupPicks() {
    const since = Date.now() - 7 * DAY, recent = d => d && Date.parse(d) >= since;
    const hl = new Map(); for (const h of S.highlights) if (!hl.has(h.item_id)) hl.set(h.item_id, h);
    return S.items.filter(i => isWeb(i.link) && !isEmailItem(i) && !isOwn(i.feed_id) && (recent(i.read_at) || (i.saved && recent(i.date)) || (hl.has(i.id) && recent(hl.get(i.id).created_at))))
      .map(i => ({ it: i, hl: hl.get(i.id), score: (hl.has(i.id) ? 3 : 0) + (i.saved ? 2 : 0) + (i.read_at ? 1 : 0) }))
      .sort((a, b) => b.score - a.score || (b.it.read_at || b.it.date || '').localeCompare(a.it.read_at || a.it.date || ''))
      .slice(0, 30);
  }
  function openRoundup() {
    const picks = roundupPicks(), wp = SOC.accounts.site;
    // with your site connected (and Writing not hidden), your picks go into Writing: your Weeknotes or a post of their own
    const wrTo = !!wp && !hiddenViews().has('write'), weekOpen = wrTo && !wrWeekDone(mdWeek());
    if (!picks.length) { status('Nothing read this week yet. Read, save or highlight a few posts, then make your roundup.'); return; }
    const wk = mdWeek(), saved = wrPicks(wk);
    const on = new Set(saved ? picks.filter(p => saved.links.includes(p.it.link)).map(p => p.it.id) : picks.filter(p => p.score >= 2).slice(0, 7).map(p => p.it.id));
    if (!saved) for (const p of picks) if (on.size < Math.min(5, picks.length)) on.add(p.it.id);
    const why0 = p => saved?.why?.[p.it.link] || '';
    const hasHl = picks.some(p => p.hl);
    const el = sheet('roundupPanel', `${weekOpen ? '<p class="wr-steps-k">Weeknotes · step 1 of 3</p>' : ''}<h2>What I read this week</h2>
      <p>Pick your favorites and add a line about each.${wrTo ? ' They go into Writing, where you finish and post them.' : ''} Every writer you link to gets a nod: sites that take Webmentions hear about it.</p>
      <input class="n-field n-title" id="ruTitle" type="text" maxlength="200" value="What I read this week" autocomplete="off">
      <textarea id="ruIntro" rows="2" placeholder="A few words to start (optional)"></textarea>
      <div class="ru-list" id="ruList">${picks.map(p => `<div class="ru-item${on.has(p.it.id) ? ' on' : ''}" data-ru="${esc(p.it.id)}">
        <label class="ru-row"><input type="checkbox"${on.has(p.it.id) ? ' checked' : ''}><span><b>${esc(wrItemName(p.it))}</b><small>${esc(cardWriter(p.it))} · ${esc(hostOfU(p.it.link))}${p.hl ? ' · highlighted' : p.it.saved ? ' · saved' : ''}</small></span></label>
        <input class="n-field ru-why" type="text" maxlength="280" value="${esc(why0(p))}" placeholder="Why it’s worth reading (optional)"></div>`).join('')}</div>
      ${hasHl ? `<label class="c-net"><input type="checkbox" id="ruQuotes"${saved && !saved.quotes ? '' : ' checked'}>Add my highlight from each, as a quote</label>` : ''}
      <p class="acct-note" id="ruNote" aria-live="polite"></p>
      <div class="row sheet-foot ru-foot">${wrTo ? `<span class="ru-main"><button class="btn${weekOpen ? '' : ' primary'}" type="button" id="ruPostW">Write it as a post</button>${weekOpen ? '<button class="btn primary" type="button" id="ruWeek">Next: add to my Weeknotes</button>' : ''}</span>` : ''}
        <span class="ru-more"><button class="btn" type="button" id="ruCancel">Cancel</button><button class="btn" type="button" id="ruCopy">${IOS ? 'Share…' : 'Copy'}</button><button class="btn" type="button" id="ruEmail">Email</button></span></div>`, 'What I read this week');
    const say = (t, err) => { $('ruNote').textContent = t; $('ruNote').classList.toggle('err', !!err); };
    const chosen = () => [...el.querySelectorAll('.ru-item')].filter(r => r.querySelector('input[type=checkbox]').checked).map(r => ({ p: picks.find(p => String(p.it.id) === r.dataset.ru), why: r.querySelector('.ru-why').value.trim() })).filter(x => x.p);
    const quotesOn = () => !!$('ruQuotes')?.checked;
    const label = t => { t = t.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim(); return [...t].length > 78 ? [...t].slice(0, 77).join('').trimEnd() + '…' : t; };
    // for your site: [Title](link) lines become links (and Webmentions); "> " lines become quotes
    const asNote = () => [$('ruIntro').value.trim(), ...chosen().map(({ p, why }) => [`[${label(wrItemName(p.it))}](${p.it.link}) — ${cardWriter(p.it)}${why ? '\n' + why : ''}`,
      quotesOn() && p.hl ? '> ' + p.hl.text.replace(/\s+/g, ' ').trim() : ''].filter(Boolean).join('\n\n'))].filter(Boolean).join('\n\n');
    const asText = () => [$('ruTitle').value.trim(), $('ruIntro').value.trim(), ...chosen().map(({ p, why }) => [`${headline(p.it)} — ${cardWriter(p.it)}`, p.it.link, why, quotesOn() && p.hl ? `“${p.hl.text.replace(/\s+/g, ' ').trim()}”` : ''].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
    const count = () => {
      const n = chosen().length;
      el.querySelectorAll('.ru-item').forEach(r => r.classList.toggle('on', r.querySelector('input[type=checkbox]').checked));
      for (const id of ['ruWeek', 'ruPostW', 'ruEmail', 'ruCopy']) if ($(id)) $(id).disabled = !n;
      say(n ? `${n} ${n === 1 ? 'post' : 'posts'} in your roundup.` : 'Pick at least one post.');
    };
    // remembered for the week as you pick, even if you close this without a button
    const remember = () => { if (wrTo) wrPicksSet(wk, chosen(), quotesOn()); };
    el.querySelector('#ruList').addEventListener('change', () => { count(); remember(); });
    el.querySelector('#ruList').addEventListener('input', remember);
    $('ruQuotes')?.addEventListener('change', remember);
    $('ruCancel').onclick = () => { el.hidden = true; if (wrTo && chosen().length) status(`Kept your ${chosen().length} picks: Write Weeknotes puts them under What I read.`); if (S.view === 'write') wrPaint(); };
    $('ruCopy').onclick = async () => {
      const t = asText();
      if (IOS && navigator.share) { try { await navigator.share({ title: $('ruTitle').value.trim(), text: t }); } catch (e) { if (e?.name !== 'AbortError') say(msg(e), true); } return; }
      try { await navigator.clipboard.writeText(t); say('Copied. Paste it anywhere: a newsletter, a message, a post.'); } catch { say('Couldn’t copy it here.', true); }
    };
    $('ruEmail').onclick = async () => {
      const subject = $('ruTitle').value.trim() || 'What I read this week', body = asText().replace(/^[^\n]*\n\n/, '');
      if (MAIL.account) { el.hidden = true; openMailCompose({ to: '', subject, body }); }
      else { try { await invoke('open_external', { url: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` }); } catch (e) { say(msg(e), true); } }
    };
    // into Writing: added to this week's Weeknotes (What I read), or a post of its own, open on the page to finish
    const toWriting = async week => {
      const list = chosen().map(c => ({ ...c, quote: quotesOn() })), title = $('ruTitle').value.trim() || 'What I read this week', intro = $('ruIntro').value.trim();
      if (!list.length) return;
      const n = `${list.length} ${list.length === 1 ? 'post' : 'posts'}`;
      el.hidden = true;
      if (S.view !== 'write') selectView('write');
      if (!WR.at) await wrLoad(); // know about a Weeknotes draft already on your site, so there's only ever one
      if (week) {
        await wrStartWeeknotes();
        const d = wrDraftGet();
        if (d.kind !== 'weeknotes') { status('Your Weeknotes didn’t open, so your picks weren’t added. Try Pick posts again.', true); return; }
        wrDraftSet({ ...d, text: wrTidy(wrPutReads(d.text, list, picks)) });
        wrSay(`Added ${n} to What I read. Step 2: add a few words under What happened. Step 3: Publish.`);
      } else {
        const d = wrDraftGet();
        if (d.editId) { if (!(await wrPutAside())) return; }
        else if ((d.text || '').trim() && !wrUntouched(d) && !confirm('Put aside what you’re writing and start your roundup? Save what you have as a draft first if you want to keep it.')) return;
        wrDraftSet({ kind: 'post', title, text: [intro, ...list.map(c => wrReadLine(c.p, c.why, c.quote))].filter(Boolean).join('\n\n') });
        WR.photo = ''; WR.photoUrl = ''; WR.alt = '';
        wrSay(`Your ${n} are on the page. Add anything you like, then Post now or Save as a draft.`);
      }
      wrToTop(); setTimeout(() => $('wrText')?.focus(), 0);
    };
    if ($('ruWeek')) $('ruWeek').onclick = () => toWriting(true);
    if ($('ruPostW')) $('ruPostW').onclick = () => toWriting(false);
    count(); remember(); // what you see ticked is what goes in
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-roundup]')) openRoundup(); });

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
    if (kind === 'dayone') { journalItem(it); return; }
    if (kind === 'note') { if (SOC.accounts.site) openNote(it); else { openAccounts().then(() => $('wpSite')?.focus()); status('Connect your site first, then write your note.'); } return; }
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
    const ts = e.target.closest('[data-ts]');
    if (ts) { // a chapter time in a video's description: play the video above from there
      const it = item(S.readerId), id = ytId(it?.link), v = $('rMedia').querySelector('.r-video');
      if (id && v) { v.innerHTML = ytPlayer(id, it.title, { t: Number(ts.dataset.ts), auto: true }); v.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      return;
    }
    const m = e.target.closest('mark[data-h]');
    if (m && window.getSelection()?.isCollapsed) { openNoteEditor(Number(m.dataset.h)); return; }
    const qc = e.target.closest('[data-qcard]');
    if (qc) { const h = S.highlights.find(x => String(x.id) === qc.dataset.qcard); if (h) openQuoteCard(h.text, item(S.readerId)); return; }
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

    if (e.target.closest('[data-vidfold]')) { store.set('vidFolded', vidFolded() ? '' : '1'); renderRail(); return; }
    if (e.target.closest('[data-vfavfold]')) { store.set('vfavFolded', favsFolded() ? '' : '1'); renderRail(); return; }
    const vs = e.target.closest('[data-vchanside]');
    if (vs) { closeReader(true); if (S.view !== 'videos') selectView('videos'); S.vchan = vs.dataset.vchanside; S.shown = 60; render(); $('listView').scrollTo({ top: 0 }); return; }
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
    if (e.target.closest('[data-fr-start]')) { openFirstRun('pick'); return; }
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
    if (act.dataset.act === 'march') archiveMail(it, true);
    if (act.dataset.act === 'minbox') mailToInbox(it);
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

  $('status').onclick = () => { if ($('status').classList.contains('err')) status(''); };
  $('markAll').onclick = () => {
    // (in Email, a conversation shows as one row: every unread email in it counts)
    const ids = (S.view === 'email' ? visible().flatMap(i => mailThreadOf(i)) : visible()).filter(i => !i.read).map(i => i.id);
    if (!ids.length) { status('Nothing unread here.'); return; }
    const vid = S.view === 'videos', where = vid && S.vchan && feedById(S.vchan) ? feedById(S.vchan).title : viewName();
    const what = vid ? (ids.length === 1 ? 'video' : 'videos') : S.view === 'email' ? (ids.length === 1 ? 'email' : 'emails') : ids.length === 1 ? 'story' : 'stories';
    showBanner(`<span>Mark ${ids.length} ${what} in ${esc(where)} as ${vid ? 'watched' : 'read'}?</span><button class="btn primary" id="yesAll">${vid ? 'Mark watched' : 'Mark read'}</button><button class="btn" id="noAll">Cancel</button>`, false, 'confirm');
    $('noAll').onclick = hideBanner;
    $('yesAll').onclick = () => { hideBanner(); mark(ids, { read: true }); status(`Marked ${ids.length} as ${vid ? 'watched' : 'read'}.`); };
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
    else if (cur && e.key === 'e' && isEmailItem(item(cur) || {}) && mailFolderOf(item(cur)) === 'inbox') archiveMail(item(cur), !S.readerId);
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
      // Email: like Mail, swipe right to mark read (or unread), left to archive
      const em = it && isEmailItem(it);
      const fk = em ? mailFolderOf(it) : '';
      sw.bg.innerHTML = em ? `<span class="l">${it.read ? 'Unread' : 'Read'}</span><span class="r">${fk === 'spam' ? 'Not spam' : ['archive', 'trash'].includes(fk) ? 'Inbox' : fk === 'sent' ? '' : 'Archive'}</span>` : `<span class="l">${it?.saved ? 'Unsave' : 'Read later'}</span><span class="r">${it?.read ? 'Unread' : 'Read'}</span>`;
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
    if (isEmailItem(it)) { const fk = mailFolderOf(it); if (dx >= SW_GO) { S.keep.add(it.id); mark(it.id, { read: !it.read }); } else if (dx <= -SW_GO) { if (['archive', 'trash', 'spam'].includes(fk)) mailToInbox(it); else if (fk !== 'sent') archiveMail(it, true); } return; }
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

  // ------------------------------------------------------------ Markets on Today: up to 5 stocks and 5 coins at a glance
  // Stocks come from Finnhub with your own free key (kept in the Keychain); coins from CoinGecko (no key).
  // Only the ticker symbols are sent. Prices may be delayed.
  const MK = { busy: false };
  const mkPicks = () => { const m = S.prefs.markets || {}; return { stocks: (m.stocks || []).slice(0, 5), coins: (m.coins || []).slice(0, 5) }; };
  const mkAny = () => { const p = mkPicks(); return p.stocks.length + p.coins.length > 0; };
  let mkData = (() => { try { return JSON.parse(store.get('marketsNow') || 'null'); } catch { return null; } })();
  const mkSig = () => JSON.stringify(mkPicks());
  async function loadMarkets(force) {
    if (!mkAny() || MK.busy) return;
    if (!force && mkData && mkData.sig === mkSig() && Date.now() - mkData.at < 10 * 60 * 1000) return;
    MK.busy = true;
    try {
      const p = mkPicks();
      const r = await invoke('markets_now', { stocks: p.stocks, coins: p.coins.map(c => c.id) });
      mkData = { ...r, sig: mkSig(), at: Date.now() }; store.set('marketsNow', JSON.stringify(mkData));
      mkSaveCloses(r.quotes);
      if (S.view === 'today' || S.view === 'myday') renderList();
    } catch { /* keep the last prices */ }
    finally { MK.busy = false; }
  }
  const mkPrice = n => n == null ? '—' : n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n >= 1 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toPrecision(3);
  // Markets on Today, under the top story (Markets › Show on Today; on unless turned off)
  const mkToday = () => mkAny() && S.prefs.mkToday !== false;
  // Today's version: one line of small tiles, stocks then crypto (the full panel stays on My Day)
  function mkLineHtml() {
    if (!mkAny()) return '';
    if (!mkData || mkData.sig !== mkSig() || Date.now() - mkData.at > 10 * 60 * 1000) setTimeout(() => loadMarkets(), 0);
    const p = mkPicks(), q = new Map((mkData?.quotes || []).map(x => [`${x.kind}:${x.id}`, x]));
    const chip = (kind, id, sym) => {
      const x = q.get(`${kind}:${id}`), pct = x?.pct;
      const dir = pct == null ? '' : pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat';
      const url = kind === 'coin' ? `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` : `https://finance.yahoo.com/quote/${encodeURIComponent(id)}`;
      return `<button class="ml-q ${dir}" type="button" data-mkurl="${esc(url)}"><b>${esc(sym)}</b> ${x ? esc(mkPrice(x.price)) : '…'}${pct == null ? '' : ` <span class="ml-c">${pct > 0.005 ? '▲' : pct < -0.005 ? '▼' : ''}${Math.abs(pct).toFixed(1)}%</span>`}</button>`;
    };
    const st = p.stocks.map(s => chip('stock', s, s)).join(''), co = p.coins.map(c => chip('coin', c.id, c.sym)).join('');
    const when = mkData?.at ? new Date(mkData.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    return `<div class="b-mkline" role="group" aria-label="Markets"><h3 class="b-sub">Markets</h3>${st}${st && co ? '<span class="ml-sep" aria-hidden="true"></span>' : ''}${co}
      <span class="ml-meta" title="Prices may be delayed">${mkData?.problem ? `<span class="err">${esc(mkData.problem)}</span> · ` : ''}${when ? esc(when) : 'Getting prices…'} · <button class="linkish" type="button" data-mkedit>Change</button></span></div>`;
  }
  function mkHtml() {
    if (!mkAny()) return '';
    if (!mkData || mkData.sig !== mkSig() || Date.now() - mkData.at > 10 * 60 * 1000) setTimeout(() => loadMarkets(), 0);
    const p = mkPicks(), q = new Map((mkData?.sig === mkSig() ? mkData.quotes : mkData?.quotes || []).map(x => [`${x.kind}:${x.id}`, x]));
    const chip = (kind, id, sym) => {
      const x = q.get(`${kind}:${id}`), pct = x?.pct;
      const dir = pct == null ? '' : pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat';
      const url = kind === 'coin' ? `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` : `https://finance.yahoo.com/quote/${encodeURIComponent(id)}`;
      return `<button class="mk-chip ${dir}" type="button" data-mkurl="${esc(url)}" title="${esc(sym)}${x?.price != null ? ` · $${esc(mkPrice(x.price))}` : ''}">
        <b>${esc(sym)}</b><span class="mk-p">${x ? esc(mkPrice(x.price)) : '…'}</span>${pct == null ? '' : `<span class="mk-c">${pct > 0.005 ? '▲' : pct < -0.005 ? '▼' : ''}${Math.abs(pct).toFixed(1)}%</span>`}</button>`;
    };
    const when = mkData?.at ? new Date(mkData.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    const row = (label, chips) => chips ? `<div class="mk-grp"><span class="mk-lab">${label}</span><div class="mk-row">${chips}</div></div>` : '';
    return `<section class="b-panel b-mk" aria-label="Markets">
      <div class="bp-head"><h3 class="b-sub">Markets</h3><span class="bp-meta">${mkData?.problem ? `<span class="err">${esc(mkData.problem)}</span> · ` : ''}${when ? `As of ${esc(when)} · may be delayed` : 'Getting prices…'}</span><button class="linkish bp-edit" type="button" data-mkedit>Change</button></div>
      ${row('Stocks', p.stocks.map(s => chip('stock', s, s)).join(''))}
      ${row('Crypto', p.coins.map(c => chip('coin', c.id, c.sym)).join(''))}</section>`;
  }
  async function openMarkets() {
    const p = mkPicks();
    let hasKey = false; try { hasKey = await invoke('markets_key_status'); } catch {}
    let stocks = [...p.stocks], coins = [...p.coins], found = [];
    const el = sheet('mkPanel', `<h2>Markets</h2>
      <p>Up to five stocks or funds and five coins, on My Day and on Today. The app sends only the ticker symbols. Prices may be delayed; this isn't investment advice.</p>
      <label class="c-net"><input type="checkbox" id="mkTodayIn"${S.prefs.mkToday !== false ? ' checked' : ''}>Show on Today, under the top story</label>
      <h3 class="mk-h">Stocks and funds</h3>
      <div class="mk-picked" id="mkStocks"></div>
      <form class="row" id="mkStockForm"><input class="search" id="mkStockIn" type="text" placeholder="Ticker, like AAPL" autocomplete="off" autocapitalize="characters" style="flex:1;min-width:120px"><button class="btn" type="submit">Add</button></form>
      <div class="mk-key" id="mkKeyBox"></div>
      <h3 class="mk-h">Crypto</h3>
      <div class="mk-picked" id="mkCoins"></div>
      <form class="row" id="mkCoinForm"><input class="search" id="mkCoinIn" type="text" placeholder="Bitcoin, ETH, Solana…" autocomplete="off" style="flex:1;min-width:120px"><button class="btn" type="submit">Find</button></form>
      <div class="voices" id="mkCoinRes"></div>
      <p class="acct-note" id="mkNote" aria-live="polite"></p>
      <p class="note">Stock prices: Finnhub. Crypto prices: CoinGecko.</p>
      <div class="row sheet-foot">${mkAny() ? '<button class="btn danger" type="button" id="mkRemove">Remove markets</button>' : ''}<button class="btn primary" type="button" id="mkDone">Done</button></div>`, 'Markets');
    const say = (t, err) => { $('mkNote').textContent = t; $('mkNote').classList.toggle('err', !!err); };
    const save = () => { S.prefs.markets = { stocks, coins }; savePrefs(); mkData = null; store.set('marketsNow', ''); renderList(); loadMarkets(true); };
    const paint = () => {
      $('mkStocks').innerHTML = stocks.map(s => `<span class="mk-tag">${esc(s)}<button type="button" data-mkdel-s="${esc(s)}" aria-label="Remove ${esc(s)}">×</button></span>`).join('') || '<span class="note">None yet</span>';
      $('mkCoins').innerHTML = coins.map(c => `<span class="mk-tag" title="${esc(c.name || '')}">${esc(c.sym)}<button type="button" data-mkdel-c="${esc(c.id)}" aria-label="Remove ${esc(c.sym)}">×</button></span>`).join('') || '<span class="note">None yet</span>';
      $('mkKeyBox').innerHTML = hasKey
        ? `<p class="note">Your Finnhub key is saved in the Keychain. <button class="linkish" type="button" id="mkKeyDel">Remove the key</button></p>`
        : `<p class="note">Stocks need a free key from Finnhub (no credit card, for personal use): sign up at <button class="linkish" type="button" data-mkurl="https://finnhub.io/register">finnhub.io</button>, copy the key from your dashboard and paste it here. It stays in your Keychain.</p>
           <form class="row" id="mkKeyForm"><input class="search" id="mkKeyIn" type="password" placeholder="Finnhub key" autocomplete="off" style="flex:1;min-width:160px"><button class="btn" type="submit">Save key</button></form>`;
    };
    el.addEventListener('click', async e => {
      const ds = e.target.closest('[data-mkdel-s]'); if (ds) { stocks = stocks.filter(s => s !== ds.dataset.mkdelS); paint(); save(); return; }
      const dc = e.target.closest('[data-mkdel-c]'); if (dc) { coins = coins.filter(c => c.id !== dc.dataset.mkdelC); paint(); save(); return; }
      const pick = e.target.closest('[data-mkcoin]');
      if (pick) { const c = found[Number(pick.dataset.mkcoin)]; if (c && !coins.some(x => x.id === c.id)) { if (coins.length >= 5) { say('Five coins at most. Remove one first.', true); return; } coins.push(c); paint(); save(); say(`Added ${c.name}.`); } $('mkCoinRes').innerHTML = ''; $('mkCoinIn').value = ''; return; }
      if (e.target.id === 'mkKeyDel') { try { await invoke('markets_key_set', { key: '' }); } catch {} hasKey = false; paint(); say('Removed the key.'); return; }
      if (e.target.id === 'mkTodayIn') { S.prefs.mkToday = e.target.checked; savePrefs(); renderList(); return; }
      if (e.target.id === 'mkDone') { el.hidden = true; return; }
      if (e.target.id === 'mkRemove') { stocks = []; coins = []; save(); el.hidden = true; return; }
    });
    el.addEventListener('submit', async e => {
      e.preventDefault();
      if (e.target.id === 'mkKeyForm') {
        const key = $('mkKeyIn').value; say('Checking the key with Finnhub…');
        try { hasKey = await invoke('markets_key_set', { key }); paint(); say('Key saved.'); loadMarkets(true); } catch (err) { say(msg(err), true); }
      } else if (e.target.id === 'mkStockForm') {
        const t = $('mkStockIn').value.trim(); if (!t) return;
        if (stocks.length >= 5) { say('Five stocks at most. Remove one first.', true); return; }
        if (!hasKey) { say('Save your Finnhub key first, then add stocks.', true); return; }
        say(`Looking up ${t.toUpperCase()}…`);
        try { const r = await invoke('stock_check', { symbol: t }); if (!stocks.includes(r.sym)) stocks.push(r.sym); $('mkStockIn').value = ''; paint(); save(); say(`Added ${r.sym} ($${mkPrice(r.price)}).`); }
        catch (err) { say(msg(err), true); }
      } else if (e.target.id === 'mkCoinForm') {
        $('mkCoinRes').innerHTML = '<p class="note">Looking…</p>';
        try { found = await invoke('coin_search', { query: $('mkCoinIn').value }); $('mkCoinRes').innerHTML = found.map((c, i) => `<button type="button" class="voice" data-mkcoin="${i}"><span class="v-name">${esc(c.name)} <span class="note">${esc(c.sym)}</span></span></button>`).join(''); }
        catch (err) { $('mkCoinRes').innerHTML = `<p class="note err">${esc(msg(err))}</p>`; }
      }
    });
    paint();
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-mkedit]')) { openMarkets(); return; }
    const u = e.target.closest('[data-mkurl]'); if (u) invoke('open_external', { url: u.dataset.mkurl }).catch(() => {});
  });
  $('marketsBtn').onclick = () => { closeSettings(); openMarkets(); };
  loadMarkets();
  setInterval(() => loadMarkets(), 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadMarkets(); });

  // ------------------------------------------------------------ Your day on Today: Calendar and Reminders from this device, and Day One
  // Calendar and Reminders are read on the device (EventKit) and never leave it. The on/off choice syncs; the system's
  // OK is per device, so a device that hasn't been asked shows an "Allow" button.
  const DAYB = { data: null, at: 0, busy: false, day: '' };
  const dayPrefs = () => S.prefs.day || {};
  const dayOn = () => !!(dayPrefs().cal || dayPrefs().rem);
  // Which Reminders list My Day uses: its own list "The Reading Room" (made the first time you put a task down),
  // another list you pick, or "*" = all your lists (new tasks go to your default list). Kept by name, so it's the
  // same list on every device (iCloud gives a list a different id on each one).
  const RR_LIST = 'The Reading Room';
  const remList = () => { const l = dayPrefs().list; return l == null || l === '' ? RR_LIST : l; };
  const remListName = () => remList() === '*' ? 'your lists' : `your “${remList()}” list`;
  const doPrefs = () => S.prefs.dayone || {};
  const dayBounds = () => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(a); b.setDate(b.getDate() + 1); return [a.getTime() / 1000, b.getTime() / 1000]; };
  async function loadDay(ask) {
    if (!dayOn() || (!myDayOn() && !ask) || (DAYB.busy && !ask)) return;
    const today = new Date().toDateString();
    if (!ask && DAYB.data && DAYB.day === today && Date.now() - DAYB.at < 5 * 60 * 1000) return;
    DAYB.busy = true;
    try {
      const [from, to] = dayBounds();
      DAYB.data = await invoke('day_today', { from, to, calendar: !!dayPrefs().cal, reminders: !!dayPrefs().rem, ask: !!ask, list: remList() });
      DAYB.at = Date.now(); DAYB.day = today;
      if (S.view === 'today' || S.view === 'myday') renderList();
      renderRail();
    } catch { /* leave the last day */ }
    finally { DAYB.busy = false; }
  }
  const hm = s => new Date(s * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const where = IOS ? 'Settings › Privacy & Security' : 'System Settings › Privacy & Security';
  const showUndated = () => dayPrefs().undated !== false;
  const pageDay = () => doPrefs().page === 'today' ? 'today' : 'yesterday';
  const DAYONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>';
  function dayHtml(noEvents) {
    if (!dayOn() && !doPrefs().on) return '';
    if (dayOn() && (!DAYB.data || DAYB.day !== new Date().toDateString() || Date.now() - DAYB.at > 5 * 60 * 1000)) setTimeout(() => loadDay(), 0);
    const d = DAYB.data, dev = IOS ? 'this iPhone or iPad' : 'this Mac';
    const head = `<div class="bp-head"><h3 class="b-sub">${noEvents ? 'To do' : 'Your day'}</h3>${noEvents && remList() !== '*' ? `<span class="bp-meta">${esc(remList())} in Reminders</span>` : ''}<button class="linkish bp-edit" type="button" data-dayedit>Change</button></div>`;
    const dayone = doPrefs().on ? `<div class="day-foot"><button class="btn day-one" type="button" data-dayone-page>${DAYONE_ICON}Write ${pageDay() === 'yesterday' ? 'yesterday’s' : 'today’s'} page in Day One</button></div>` : '';
    if (dayOn() && !d) return `<section class="b-panel b-day">${head}<p class="day-note">Looking at your calendar…</p>${dayone}</section>`;
    const p = dayPrefs(), ask = [], denied = [];
    if (d) {
      if (d.calendar === 'ask') ask.push('Calendar'); if (d.reminders === 'ask') ask.push('Reminders');
      if (d.calendar === 'denied') denied.push('Calendars'); if (d.reminders === 'denied') denied.push('Reminders');
    }
    const now = Date.now() / 1000, [start] = dayBounds();
    const ev = !noEvents && p.cal && d?.calendar === 'granted' ? `<div class="day-col"><h4>Calendar</h4>${d.events.length
      ? `<ul class="day-ev">${d.events.map(e => `<li class="${!e.all_day && e.end < now ? 'past' : ''}"><time>${e.all_day ? 'All day' : esc(hm(e.start))}</time><span><b>${esc(e.title || 'Event')}</b>${e.location || e.calendar ? `<small>${esc([e.location, e.calendar].filter(Boolean).join(' · '))}</small>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="day-note">Nothing on your calendar today.</p>'}</div>` : '';
    const remLi = r => `<li><label><input type="checkbox" data-remdone="${esc(r.id)}"><span>${esc(r.title || 'Reminder')}${r.due != null
      ? `<small class="${r.due < now - 60 ? 'late' : ''}">${r.due < start ? 'Overdue' : r.due - start < 60 ? 'Today' : esc(hm(r.due))}${r.list ? ' · ' + esc(r.list) : ''}</small>`
      : r.list ? `<small>${esc(r.list)}</small>` : ''}</span></label></li>`;
    let rem = '';
    if (p.rem && d?.reminders === 'granted') {
      const und = showUndated() ? (d.undated || []).slice(0, 5) : [], more = showUndated() ? Math.max(0, (d.undated_total || 0) - und.length) : 0;
      rem = `<div class="day-col"><h4>Reminders</h4>`
        + (d.todo.length ? `<ul class="day-rem">${d.todo.map(remLi).join('')}</ul>` : `<p class="day-note">${!d.undated?.length && remList() !== '*' ? `Nothing in ${esc(remListName())} yet. Tasks you put down on My Day go there.` : 'Nothing due today.'}</p>`)
        + (und.length ? `<p class="day-subh">No date</p><ul class="day-rem">${und.map(remLi).join('')}</ul>` : '')
        + (more ? `<p class="day-note">${more} more without a date in Reminders.</p>` : '')
        + `</div>`;
    }
    const cols = ev || rem ? `<div class="day-cols">${ev}${rem}</div>` : '';
    return `<section class="b-panel b-day">${head}${cols}
      ${ask.length ? `<p class="day-note"><button class="btn" type="button" data-dayask>Allow ${ask.join(' and ')} on ${dev}</button></p>` : ''}
      ${denied.length ? `<p class="day-note">The Reading Room can’t see ${denied.join(' or ')} on ${dev}. Turn it on in ${where} › ${denied.join(' / ')}.</p>` : ''}
      ${dayone}</section>`;
  }
  document.addEventListener('change', async e => {
    const c = e.target.closest('[data-remdone]'); if (!c) return;
    const li = c.closest('li'); li?.classList.add('done');
    try {
      await invoke('reminder_done', { id: c.dataset.remdone, done: c.checked });
      if (DAYB.data) { const id = c.dataset.remdone; DAYB.data.todo = DAYB.data.todo.filter(r => r.id !== id); if (DAYB.data.undated?.some(r => r.id === id)) { DAYB.data.undated = DAYB.data.undated.filter(r => r.id !== id); DAYB.data.undated_total = Math.max(0, (DAYB.data.undated_total || 1) - 1); } }
      setTimeout(() => { if (S.view === 'today') renderList(); else if (S.view === 'myday') mdRender(); }, 900);
    } catch (err) { c.checked = !c.checked; li?.classList.remove('done'); status(msg(err)); }
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-dayask]')) { loadDay(true); return; }
    if (e.target.closest('[data-dayedit]')) { openDaySettings(); return; }
    if (e.target.closest('[data-dayone-page]')) { morningPage().then(t => dayOne(t, 'Morning')); return; }
  });

  // Day One: a new entry filled in, through Day One's own dayone:// link. Day One opens and you finish it there.
  async function dayOne(text, tag) {
    const p = doPrefs(), tags = [p.tags || '', tag || ''].map(t => t.trim()).filter(Boolean).join(',');
    try { await invoke('day_one', { text, journal: p.journal || '', tags }); }
    catch (err) { status(msg(err)); }
  }
  // Your journal questions: the page about a day you've lived (yesterday's page in the morning, today's in the
  // evening) is these questions as headings, in your order, set in Your day › Day One. Under a few of them the app
  // puts what it already knows, matched by the words in the question so they still fill in when you reword them:
  // "happen" gets the calendar and the notes you put down, "read / hear / listen /
  // watch" what you read, watched and highlighted, "next / goal / tomorrow" your goals.
  // The rest stay empty for you. (No Big 3 anywhere on My Day since Nov 21.)
  const DAYONE_Q = ['What happened in the past day?', 'What were my biggest wins?', 'What lessons did I learn?', 'What am I thankful for right now?', 'How am I feeling right now?', 'What did I read or hear?', 'What stood out?', 'What can I do next to move forward on my goals?'];
  const doQuestions = () => { const q = (doPrefs().questions || []).map(x => String(x).trim()).filter(Boolean); return q.length ? q.slice(0, 20) : DAYONE_Q; };
  const qKind = q => /happen/i.test(q) ? 'happened' : /\bwins?\b/i.test(q) ? '' : /\b(read|hear|heard|listen|watch)/i.test(q) ? 'read' : /\b(next|goals?|tomorrow)\b/i.test(q) ? 'next' : '';
  // d = midnight of the day the page is about; day = that day's Calendar/Reminders answer (or null)
  function questionPage(d, day) {
    const from = d.getTime(), to = addDays(d, 1).getTime(), inDay = t => { const x = Date.parse(t || ''); return x >= from && x < to; };
    const notes = mdPeek(dayKey(d))?.notes || [];
    const ev = dayPrefs().cal ? (day?.events || []) : [];
    const happened = [...ev.map(e => `- ${e.all_day ? 'All day' : hm(e.start)}: ${e.title}${e.location ? ` (${e.location})` : ''}`), ...notes.map(x => `- ${x.t}`)];
    const seen = S.items.filter(i => inDay(i.read_at) && isWeb(i.link) && !isEmailItem(i));
    const how = i => isVideoItem(i) ? 'Watched: ' : i.audio ? 'Listened to: ' : '';
    const read = seen.slice(0, 10).map(i => `- ${how(i)}[${headline(i)}](${i.link}) — ${cardWriter(i)}`);
    for (const h of S.highlights.filter(h => inDay(h.created_at)).slice(0, 5)) read.push(`> ${h.text.replace(/\s+/g, ' ').trim()}${(() => { const it = S.items.find(i => i.id === h.item_id); return it ? ` — ${cardWriter(it)}` : ''; })()}`);
    const goals = cmp().goals.map(g => `- ${goalLine(g)}`);
    const next = goals.length ? ['Goals:', ...goals] : [];
    const fill = { happened, read, next }; // wins are yours to write: finished reminders aren't listed (David, Nov 21)
    const out = [`# ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`];
    for (const q of doQuestions()) { const k = qKind(q), body = k ? fill[k] : []; out.push(`## ${q}` + (body.length ? '\n' + body.join('\n') : '\n')); if (k) fill[k] = []; }
    return out.join('\n\n');
  }
  // The page from My Day is about yesterday (for writing first thing the next morning: your questions, filled in
  // where the app knows the answer) or about today, as chosen in Your day › Day One; today's page has today's
  // weather, events, what's due, markets and what you read yesterday.
  // (Day One's link can't set the entry's date: the entry is dated when it's made.)
  async function morningPage() {
    const yday = pageDay() === 'yesterday';
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    if (yday) {
      const d = addDays(t0, -1);
      let day = null;
      if (dayOn()) { try { day = await invoke('day_today', { from: d.getTime() / 1000, to: t0.getTime() / 1000, calendar: !!dayPrefs().cal, reminders: !!dayPrefs().rem, ask: false, done: true, list: remList() }); } catch { day = null; } }
      return questionPage(d, day);
    }
    const out = [`# ${t0.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`];
    const day = DAYB.data;
    try {
      const place = wxPlace();
      if (place && wxData) { const w = WX.find(([codes]) => codes.includes(Number(wxData.code))); out.push(`${Math.round(wxData.temp)}°${w ? ', ' + w[3].toLowerCase() : ''} in ${place.name} (high ${Math.round(wxData.high)}°, low ${Math.round(wxData.low)}°)`); }
    } catch {}
    { const notes = S.prefs.mydays?.[dayKey(t0)]?.notes || []; if (notes.length) out.push('## Notes from the day\n' + notes.map(x => `- ${x.t}`).join('\n')); }
    if (dayPrefs().cal && day?.events?.length) out.push('## On the calendar\n' + day.events.map(e => `- ${e.all_day ? 'All day' : hm(e.start)}: ${e.title}${e.location ? ` (${e.location})` : ''}`).join('\n'));
    if (dayPrefs().rem && day?.todo?.length) out.push('## To do\n' + day.todo.map(r => `- [ ] ${r.title}`).join('\n'));
    try {
      if (mkAny() && mkData?.quotes?.length) out.push('## Markets\n' + mkData.quotes.filter(q => q.price != null).map(q => `${q.kind === 'coin' ? (mkPicks().coins.find(c => c.id === q.id)?.sym || q.id) : q.id} ${mkPrice(q.price)} (${q.pct >= 0 ? '+' : ''}${(q.pct || 0).toFixed(1)}%)`).join(' · '));
    } catch {}
    const yStart = t0.getTime() - DAY;
    const read = S.items.filter(i => i.read_at && Date.parse(i.read_at) >= yStart && Date.parse(i.read_at) < t0.getTime() && isWeb(i.link) && !isEmailItem(i)).slice(0, 8);
    if (read.length) out.push('## Read yesterday\n' + read.map(i => `- [${headline(i)}](${i.link}) — ${cardWriter(i)}`).join('\n'));
    out.push('## Today\n');
    return out.join('\n\n');
  }
  function journalItem(it) {
    const hls = S.highlights.filter(h => h.item_id === it.id);
    const parts = [`## [${headline(it)}](${it.link})`, `${cardWriter(it)} · ${hostOfU(it.link)}`];
    for (const h of hls) parts.push(`> ${h.text.replace(/\s+/g, ' ').trim()}` + (h.note ? `\n\n${h.note}` : ''));
    parts.push('');
    dayOne(parts.join('\n\n'), 'Reading');
  }
  const applyDayOne = () => { const b = document.querySelector('#shareMenu [data-share="dayone"]'); if (b) b.hidden = !doPrefs().on; };

  function openDaySettings() {
    const p = dayPrefs(), o = doPrefs();
    const el = sheet('dayPanel', `<h2>Calendar, reminders and Day One</h2>
      <p>My Day can show your events and the reminders due today, read from Calendar and Reminders on each of your devices. They never leave the device. Each device asks your OK once.</p>
      <label class="c-net"><input type="checkbox" id="dayCal"${p.cal ? ' checked' : ''}>Today’s events from Calendar</label>
      <label class="c-net"><input type="checkbox" id="dayRem"${p.rem ? ' checked' : ''}>Reminders due today and overdue (tick them off right on My Day)</label>
      <label class="c-net"><input type="checkbox" id="dayUnd"${p.undated !== false ? ' checked' : ''}>Also reminders with no date (the newest five)</label>
      <label class="do-q" for="dayList">Reminders list <span class="hint">My Day shows this list, and tasks you put down go into it. “The Reading Room” is a list just for the app, made in Reminders the first time you add a task.</span></label>
      <select id="dayList" class="n-field"><option value="">The Reading Room (its own list)</option>${remList() !== RR_LIST && remList() !== '*' ? `<option value="${esc(remList())}" selected>${esc(remList())}</option>` : ''}<option value="*"${remList() === '*' ? ' selected' : ''}>All my lists (new tasks go to the default list)</option></select>
      <h3 class="mk-h">Day One</h3>
      <p class="note">If you journal in Day One, the app can start entries for you: a page from My Day, and “Journal in Day One” in a story’s Share menu (with your highlights and notes). Day One opens with the entry filled in; you finish it there.</p>
      <label class="c-net"><input type="checkbox" id="doOn"${o.on ? ' checked' : ''}>Show Day One buttons</label>
      <p class="note" style="margin-bottom:4px">The morning page from My Day is about:</p>
      <div class="day-pick" role="radiogroup" aria-label="The Day One page is about"><label><input type="radio" name="doPage" value="yesterday"${o.page !== 'today' ? ' checked' : ''}>Yesterday <small>for writing the next morning: your questions, with yesterday’s events and reading filled in</small></label><label><input type="radio" name="doPage" value="today"${o.page === 'today' ? ' checked' : ''}>Today <small>today’s weather, events, what’s due, markets and what you read yesterday</small></label></div>
      <p class="note">Day One dates the entry when it’s made, so for yesterday’s page change the date in Day One.</p>
      <label class="do-q" for="doQ">Your journal questions <span class="hint">(one per line; they head yesterday’s page and the evening page, and the app fills in what happened, what you read or heard, and what’s next)</span></label>
      <textarea id="doQ" rows="8">${esc(doQuestions().join('\n'))}</textarea>
      <p class="note"><button class="b-link" type="button" id="doQReset">Use the starting questions</button></p>
      <div class="row"><input class="n-field" id="doJournal" type="text" placeholder="Journal (blank: your default journal)" value="${esc(o.journal || '')}" autocomplete="off" style="flex:1;min-width:160px"><input class="n-field" id="doTags" type="text" placeholder="Tags, like reading" value="${esc(o.tags || '')}" autocomplete="off" style="flex:1;min-width:120px"></div>
      <p class="acct-note" id="dayNote" aria-live="polite"></p>
      <div class="row sheet-foot"><button class="btn" type="button" id="doTry">Try Day One</button><button class="btn primary" type="button" id="dayDone">Done</button></div>`, 'Calendar, reminders and Day One');
    const save = () => {
      S.prefs.day = { cal: $('dayCal').checked, rem: $('dayRem').checked, undated: $('dayUnd').checked, list: $('dayList').value || undefined };
      S.prefs.dayone = { on: $('doOn').checked, journal: $('doJournal').value.trim(), tags: $('doTags').value.trim(), page: el.querySelector('input[name="doPage"]:checked')?.value || 'yesterday', questions: (() => { const q = $('doQ').value.split('\n').map(x => x.trim()).filter(Boolean); return q.length && q.join('\n') !== DAYONE_Q.join('\n') ? q.slice(0, 20) : undefined; })() };
      savePrefs(); applyDayOne(); DAYB.data = null; renderList();
    };
    el.addEventListener('change', save);
    // the device's own lists, once Reminders is allowed (names only)
    invoke('reminder_lists').then(names => {
      const sel = $('dayList'); if (!sel || !Array.isArray(names)) return;
      const have = new Set([...sel.options].map(o => o.value));
      const star = sel.querySelector('option[value="*"]');
      for (const n of names) if (n && n.trim().toLowerCase() !== RR_LIST.toLowerCase() && !have.has(n)) { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.insertBefore(o, star); }
    }).catch(() => {});
    $('doQReset').onclick = () => { $('doQ').value = DAYONE_Q.join('\n'); save(); };
    $('doTry').onclick = () => { save(); dayOne('Hello from The Reading Room.', ''); $('dayNote').textContent = 'If Day One opened with a new entry, it works. You can delete that entry.'; };
    $('dayDone').onclick = () => { save(); el.hidden = true; if (dayOn()) loadDay(true); };
  }
  $('dayBtn').onclick = () => { closeSettings(); openDaySettings(); };
  applyDayOne();
  setInterval(() => loadDay(), 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadDay(); });

  // ------------------------------------------------------------ My Day: your compass, your day and the markets
  // A page to start the day on and check in with during it: the season's goals (typed in here,
  // synced with the other prefs), a quick place to put things down, Your day and Markets (moved off Today, which
  // keeps one glance line), an evening mode for closing the day and planning tomorrow, and a Weekly Preview that
  // saves a private review to Day One and a Weeknotes draft for your site. Goals and "what got in the way" never
  // go into anything public.
  const MD = { auto: false, wkPhoto: null, mode: null, step: 0, cap: '', capTo: 'task', force: false, refocus: '', tmr: null, wkCal: null, saveT: 0 };
  function myDayOn() { return !hiddenViews().has('myday'); }
  const MD_ACCTS = ['Spiritual', 'Vocational', 'Intellectual', 'Physical', 'Social', 'Avocational', 'Financial'];
  const cmp = () => {
    const c = S.prefs.compass || {};
    return { goals: (c.goals || []).slice(0, 6), why: c.why || '', season: c.season || '', rituals: { m: (c.rituals?.m || []).slice(0, 8), e: (c.rituals?.e || []).slice(0, 8) } };
  };
  const mdSaveSoon = () => { clearTimeout(MD.saveT); MD.saveT = setTimeout(savePrefs, 700); };
  function mdDay(k = dayKey()) {
    const all = (S.prefs.mydays ||= {});
    if (!all[k]) {
      all[k] = {};
      const cut = dayKey(new Date(Date.now() - 21 * DAY)); // three weeks is enough for the Weekly Preview
      for (const d of Object.keys(all)) if (d < cut) delete all[d];
    }
    const d = all[k];
    d.big3 ||= []; d.rm ||= []; d.re ||= []; d.notes ||= []; d.cap ||= {}; d.h ||= {};
    return d;
  }
  const mdPeek = k => S.prefs.mydays?.[k] || null; // a day without making it
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const tomorrowKey = () => dayKey(addDays(new Date(), 1));
  const mdEvening = () => MD.mode === 'evening' || (MD.mode !== 'day' && MD.mode !== 'week' && new Date().getHours() >= 18);
  function mdMorningStart() { return S.prefs.mydayMorning !== false; }
  // until when mornings open on My Day (My Day settings › Starting the day); 10 am unless you pick another hour
  const mdUntil = () => [9, 10, 11, 12].includes(S.prefs.mydayUntil) ? S.prefs.mydayUntil : 10;
  const mdHourName = h => h === 12 ? 'noon' : `${h} am`;
  // The week a Weekly Preview is about: Monday to Sunday, this week's (last week's on a Monday morning)
  function mdWeek() {
    const now = new Date(), back = now.getDay() === 1 && now.getHours() < 12 ? 7 : 0;
    const mon = addDays(now, -((now.getDay() + 6) % 7) - back); mon.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    return { key: dayKey(days[6]), days, mon, sun: days[6] };
  }
  function mdWk(key = mdWeek().key) {
    const all = (S.prefs.weeks ||= {});
    if (!all[key]) {
      all[key] = {};
      const keys = Object.keys(all).sort();
      while (keys.length > 8) delete all[keys.shift()];
    }
    const w = all[key]; w.steps ||= {}; w.reads ||= null; w.share ||= { wins: true, made: true, read: true, next: false };
    return w;
  }
  const prevWkKey = key => dayKey(addDays(new Date(key + 'T12:00:00'), -7));
  const fmtRange = (a, b) => {
    const m = d => d.toLocaleDateString(undefined, { month: 'short' });
    return m(a) === m(b) ? `${m(a)} ${a.getDate()}–${b.getDate()}` : `${m(a)} ${a.getDate()} – ${m(b)} ${b.getDate()}`;
  };

  // ---- goals: how far along each is
  const curWeekDays = () => { const now = new Date(), mon = addDays(now, -((now.getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0); return Array.from({ length: 7 }, (_, i) => addDays(mon, i)); };
  function goalProgress(g, days = curWeekDays()) {
    if (g.kind === 'books') {
      const target = Number(g.target) || goalCfg().books || 12, n = finishedThisYear();
      return { n, target, text: `${n} of ${target}`, pct: Math.min(1, n / target) };
    }
    if (g.kind === 'habit') {
      const target = Math.min(7, Number(g.target) || 7), n = days.filter(d => mdPeek(dayKey(d))?.h?.[g.id]).length;
      return { n, target, text: `${n} of ${target} days this week`, pct: Math.min(1, n / target) };
    }
    if (g.kind === 'count' && Number(g.target) > 0) {
      const n = Number(g.done) || 0, target = Number(g.target);
      return { n, target, text: `${n} of ${target}${g.unit ? ' ' + g.unit : ''}`, pct: Math.min(1, n / target) };
    }
    return { n: null, target: null, text: g.status || '', pct: null };
  }
  const goalLine = (g, days) => { const p = goalProgress(g, days); return `${g.title}${p.text ? `: ${p.text}` : ''}`; };

  // ---- the line on Today: the next thing on the calendar, any birthday in the next five days (and three quotes
  // when Markets isn't on Today itself). (David, Nov 21: no My Day reminders on Today.)
  const BDAY = { list: null, at: 0, day: '', busy: false };
  async function loadBirthdays() {
    if (!dayPrefs().cal || BDAY.busy) return;
    BDAY.busy = true;
    try {
      const a = new Date(); a.setHours(0, 0, 0, 0);
      const r = await invoke('day_today', { from: a.getTime() / 1000, to: addDays(a, 6).getTime() / 1000, calendar: true, reminders: false, ask: false });
      // A birthday is an event on the Birthdays calendar (from Contacts) or one whose own title says birthday.
      // Not everything on a calendar that happens to have "birthday" in its name (David, Nov 21: "Dad flying in").
      BDAY.list = (r?.events || []).filter(e => e.birthday || /birthday|bday/i.test(e.title || ''));
      BDAY.at = Date.now(); BDAY.day = new Date().toDateString();
      if (S.view === 'today') renderList();
      renderRail();
    } catch { BDAY.list = BDAY.list || []; BDAY.at = Date.now(); BDAY.day = new Date().toDateString(); }
    finally { BDAY.busy = false; }
  }
  function birthdayLine() {
    if (!dayPrefs().cal) return '';
    if (!BDAY.list || BDAY.day !== new Date().toDateString() || Date.now() - BDAY.at > 60 * 60 * 1000) setTimeout(() => loadBirthdays(), 0);
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const seen = new Set(), list = (BDAY.list || []).filter(e => { const k = e.title + '|' + dayKey(new Date(e.start * 1000)); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!list.length) return '';
    const when = e => {
      const d = new Date(e.start * 1000); d.setHours(0, 0, 0, 0);
      const n = Math.round((d - t0) / DAY);
      return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `${d.toLocaleDateString(undefined, { weekday: 'long' })} (in ${n} days)`;
    };
    const name = e => (e.title || 'A birthday').replace(/[’']s birthday$/i, '’s birthday');
    return `<span class="gl-i gl-bday"><span aria-hidden="true">🎂</span>Coming up: ${list.slice(0, 3).map(e => `${esc(name(e))} ${esc(when(e))}`).join(' · ')}</span>`;
  }
  function glanceHtml() {
    const parts = [];
    if (dayOn()) {
      if (!DAYB.data || DAYB.day !== new Date().toDateString() || Date.now() - DAYB.at > 5 * 60 * 1000) setTimeout(() => loadDay(), 0);
      const now = Date.now() / 1000, ev = (DAYB.data?.events || []).find(e => !e.all_day && e.end > now);
      if (ev) parts.push(`<span class="gl-i">${ev.start > now ? 'Next' : 'Now'}: ${esc(ev.title || 'Event')} · ${esc(hm(ev.start))}</span>`);
      const bd = birthdayLine(); if (bd) parts.push(bd);
    }
    if (mkAny() && !mkToday()) {
      if (!mkData || mkData.sig !== mkSig() || Date.now() - mkData.at > 10 * 60 * 1000) setTimeout(() => loadMarkets(), 0);
      const p = mkPicks(), q = new Map((mkData?.quotes || []).map(x => [`${x.kind}:${x.id}`, x]));
      const three = [...p.stocks.map(s => ['stock', s, s]), ...p.coins.map(c => ['coin', c.id, c.sym])].slice(0, 3);
      const chips = three.map(([kind, id, sym]) => {
        const x = q.get(`${kind}:${id}`), pct = x?.pct;
        if (pct == null) return `<span class="gl-q"><b>${esc(sym)}</b> …</span>`;
        return `<span class="gl-q ${pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : ''}"><b>${esc(sym)}</b> ${pct > 0.005 ? '▲' : pct < -0.005 ? '▼' : ''}${Math.abs(pct).toFixed(1)}%</span>`;
      }).join('');
      if (chips) parts.push(`<span class="gl-i gl-qs">${chips}</span>`);
    }
    if (!parts.length) return '';
    return `<div class="b-glance" role="group" aria-label="My Day at a glance">${parts.join('')}<button class="gl-open" type="button" data-view="myday">Open My Day →</button></div>`;
  }

  // ---- the page
  function mdGreeting() {
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    let wx = '';
    try {
      const place = wxPlace();
      if (place && wxData && wxData.key === `${place.lat},${place.lon}`) {
        const w = WX.find(([codes]) => codes.includes(Number(wxData.code)));
        wx = ` · ${Math.round(wxData.temp)}°${w ? ' and ' + w[3].toLowerCase() : ''} in ${place.name}`;
      }
    } catch {}
    return { date, wx };
  }
  function mdSummary(evening) {
    const now = Date.now() / 1000, left = (DAYB.data?.events || []).filter(e => !e.all_day && e.end > now).length;
    if (evening) return 'Close out the day and take a look at tomorrow.';
    if (DAYB.data?.calendar === 'granted') return left ? `${left === 1 ? 'One thing' : left === 2 ? 'Two things' : `${left} things`} left on the calendar today.` : 'Nothing else on the calendar today.';
    return 'Your day at a glance: what’s coming up, your goals and the markets.';
  }
  function mydayHtml() {
    if (MD.mode === 'week') return weeklyHtml();
    const evening = mdEvening(), g = mdGreeting(), w = mdWk(), sunday = new Date().getDay() === 0;
    const head = `<div class="md-top"><div class="md-top-row"><h2>${esc(greeting())}</h2>
        <div class="md-modes" role="group" aria-label="My Day view"><button type="button" class="linkish" data-md="mode" data-mode="${evening ? 'day' : 'evening'}">${evening ? 'Daytime view' : 'Evening view'}</button>
        <button type="button" class="linkish" data-md="week">Weekly Preview</button>${cmp().rituals.m.length ? '' : '<button type="button" class="linkish" data-md="edit">Rituals and goals</button>'}
        <button type="button" class="linkish md-set" data-md="settings" title="Starting the day, goals and rituals, calendar and reminders, Day One and markets">${ICONS.gear || ''}My Day settings</button></div></div>
      <p class="b-date">${esc(g.date)}${esc(g.wx)}</p><p class="b-line">${esc(mdSummary(evening))}</p>
      ${MD.auto ? `<p class="md-auto" role="note">It’s before ${esc(mdHourName(mdUntil()))}, so The Reading Room opened on My Day. <button type="button" class="b-link" data-md="settings">Change this</button> <button type="button" class="b-link" data-md="autook" aria-label="Hide this note">OK</button></p>` : ''}</div>`;
    const weekCard = sunday && !w.done && !evening ? `<button class="md-weekcard" type="button" data-md="week"><b>Your Weekly Preview is ready</b><span>Ten minutes to look back at the week and point the next one. It ends with a page for Day One and a Weeknotes draft for your site.</span></button>` : '';
    const body = evening
      ? `<div class="md-grid">${eveningTodayHtml()}${planTomorrowHtml()}</div>`
      : `${quadHtml()}${captureHtml()}<div class="md-grid">${compassHtml()}${myDayDayHtml()}</div>`;
    const people = S.items.filter(i => !i.read && !isMuted(i) && !isEmailItem(i) && isPerson(i.feed_id) && !isOwn(i.feed_id) && Date.now() - Date.parse(i.date) < 4 * DAY).length;
    const foot = evening
      ? `<p class="md-foot">Done for the day? <button class="b-link" type="button" data-view="${people ? 'people' : 'today'}">Read something good before bed</button></p>`
      : `<p class="md-foot">Then go read: <button class="b-link" type="button" data-view="${people ? 'people' : 'today'}">${people ? `${people} new from people you read` : 'Today'}</button></p>`;
    return `<section class="brief myday" aria-label="My Day">${head}${weekCard}${body}${foot}</section>`;
  }
  const marketsInvite = () => '';

  // ---- the four quadrants at the top of My Day: Coming up (a list), the month, Stocks, Crypto
  // The calendar is read on the device (EventKit, the same call as Your day) for the month shown and the next two weeks.
  const MCAL = { month: null, sel: '', data: null, key: '', at: 0, busy: false };
  const mcalMonth = () => { if (!MCAL.month) { const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); MCAL.month = m; } return MCAL.month; };
  // The month's grid runs Sunday to Saturday, whole weeks
  function mcalGrid() {
    const m = mcalMonth(), a = addDays(m, -m.getDay()), last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const b = addDays(last, 7 - last.getDay()); return [a, b];
  }
  function mcalRange() {
    const [a, b] = mcalGrid(), t = new Date(); t.setHours(0, 0, 0, 0);
    return [a < t ? a : t, b > addDays(t, 15) ? b : addDays(t, 15)];
  }
  async function loadMonthCal(force) {
    if (!dayPrefs().cal || MCAL.busy) return;
    const [a, b] = mcalRange(), key = `${dayKey(a)}:${dayKey(b)}`;
    if (!force && MCAL.data && MCAL.key === key && Date.now() - MCAL.at < 5 * 60 * 1000) return;
    MCAL.busy = true;
    try {
      const r = await invoke('day_today', { from: a.getTime() / 1000, to: b.getTime() / 1000, calendar: true, reminders: false, ask: false, done: false });
      MCAL.data = r; MCAL.key = key; MCAL.at = Date.now();
      if (S.view === 'myday') mdRender();
    } catch { /* keep the last month */ }
    finally { MCAL.busy = false; }
  }
  // Each calendar gets one of six colors, the same one every time (from its name)
  const CAL_COLORS = ['#127A62', '#2F6FD0', '#C2413A', '#B7791F', '#7B4FC0', '#2C8C9B'];
  const calColor = name => { let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CAL_COLORS[h % CAL_COLORS.length]; };
  // Events on a day (an all-day event that spans days shows on each of them)
  function eventsOn(day) {
    const a = new Date(day); a.setHours(0, 0, 0, 0); const b = addDays(a, 1), A = a.getTime() / 1000, B = b.getTime() / 1000;
    return (MCAL.data?.events || []).filter(e => e.start < B && (e.end > A || e.start >= A))
      .sort((x, y) => (y.all_day - x.all_day) || x.start - y.start);
  }
  const evIsBday = e => e.birthday || /birthday|bday/i.test(e.title || '');
  function quadCalSetup(title, line) {
    return `<section class="b-panel md-q" aria-label="${esc(title)}"><div class="bp-head"><h3 class="b-sub">${esc(title)}</h3></div>
      <p class="day-note">${esc(line)}</p><p class="day-note"><button class="btn" type="button" data-dayedit>Show my calendar</button></p></section>`;
  }
  // Quadrant 1: what's coming up, as a list, two weeks from today (or from the day picked in the month)
  function agendaHtml() {
    if (!dayPrefs().cal) return quadCalSetup('Coming up', 'Your events for the next two weeks show here, read from Calendar on this device. They never leave it.');
    if (!MCAL.data) return `<section class="b-panel md-q" aria-label="Coming up"><div class="bp-head"><h3 class="b-sub">Coming up</h3></div><p class="day-note">Looking at your calendar…</p></section>`;
    if (MCAL.data.calendar && MCAL.data.calendar !== 'granted') return quadCalSetup('Coming up', `The app needs your OK to read Calendar. Turn it on in ${where} › Calendars.`);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const start = MCAL.sel ? new Date(MCAL.sel + 'T00:00') : t, now = Date.now() / 1000;
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = addDays(start, i), evs = eventsOn(d).filter(e => dayKey(d) !== dayKey(t) || e.all_day || e.end > now);
      if (evs.length || i === 0) days.push([d, evs]);
    }
    const label = d => { const k = dayKey(d); return k === dayKey(t) ? 'Today' : k === dayKey(addDays(t, 1)) ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };
    const row = e => `<li class="ag-ev" style="--cal:${calColor(e.calendar)}"><span class="ag-time">${e.all_day ? 'All day' : esc(hm(e.start))}</span>
      <span class="ag-t">${evIsBday(e) ? '🎂 ' : ''}${esc(e.title || 'Untitled')}${e.location ? `<small>${esc(e.location)}</small>` : ''}</span></li>`;
    const list = days.map(([d, evs]) => `<li class="ag-day"><h4>${esc(label(d))}</h4>${evs.length ? `<ul>${evs.map(row).join('')}</ul>` : `<p class="day-note">${dayKey(d) === dayKey(t) ? 'Nothing else today.' : 'Nothing on the calendar.'}</p>`}</li>`).join('');
    const sel = MCAL.sel && MCAL.sel !== dayKey(t) ? `<button class="linkish bp-edit" type="button" data-md="calsel" data-day="">Back to today</button>` : '';
    return `<section class="b-panel md-q md-agenda" aria-label="Coming up"><div class="bp-head"><h3 class="b-sub">Coming up</h3><span class="bp-meta">${MCAL.sel && MCAL.sel !== dayKey(t) ? 'From ' + esc(start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : 'Next two weeks'}</span>${sel}</div>
      <ul class="ag-list">${list}</ul></section>`;
  }
  // Quadrant 2: the month, with each day's events as small colored bars (dots on a narrow screen)
  function monthHtml() {
    if (!dayPrefs().cal) return quadCalSetup('This month', 'A month of your calendar shows here.');
    const m = mcalMonth(), [a, b] = mcalGrid(), today = dayKey(), cells = [];
    for (let d = new Date(a); d < b; d = addDays(d, 1)) {
      const k = dayKey(d), out = d.getMonth() !== m.getMonth(), evs = MCAL.data ? eventsOn(d) : [];
      const bars = evs.slice(0, 3).map(e => `<span class="mc-ev" style="--cal:${calColor(e.calendar)}">${evIsBday(e) ? '🎂 ' : ''}${esc(e.title || '')}</span>`).join('');
      cells.push(`<button type="button" class="mc-day${out ? ' out' : ''}${k === today ? ' now' : ''}${k === MCAL.sel ? ' sel' : ''}" data-md="calsel" data-day="${k}"
        aria-label="${esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}${evs.length ? `, ${evs.length} ${evs.length === 1 ? 'event' : 'events'}` : ''}">
        <span class="mcal-n">${d.getDate()}</span>${bars}${evs.length > 3 ? `<span class="mc-more">+${evs.length - 3}</span>` : ''}
        ${evs.length ? `<span class="mc-dots">${evs.slice(0, 3).map(e => `<i style="--cal:${calColor(e.calendar)}"></i>`).join('')}</span>` : ''}</button>`);
    }
    const wd = Array.from({ length: 7 }, (_, i) => addDays(a, i).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, IOS ? 1 : 3));
    const thisMonth = m.getMonth() === new Date().getMonth() && m.getFullYear() === new Date().getFullYear();
    return `<section class="b-panel md-q md-month" aria-label="This month"><div class="bp-head"><h3 class="b-sub">${esc(m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h3>
      <span class="mc-nav">${thisMonth ? '' : '<button class="linkish" type="button" data-md="calmon" data-n="0">Today</button>'}<button class="mc-arrow" type="button" data-md="calmon" data-n="-1" aria-label="Previous month">‹</button><button class="mc-arrow" type="button" data-md="calmon" data-n="1" aria-label="Next month">›</button></span></div>
      <div class="mc-grid" role="group" aria-label="Days">${wd.map(x => `<span class="mc-wd">${esc(x)}</span>`).join('')}${cells.join('')}</div>
      <p class="mc-tip">Pick a day to see it in Coming up.</p></section>`;
  }
  // Markets: closes saved on this device each day, so a stock's line grows over a month (Finnhub's free key has no history)
  const mkCloses = () => { try { return JSON.parse(store.get('mkCloses') || '{}'); } catch { return {}; } };
  function mkSaveCloses(quotes) {
    const c = mkCloses(), k = dayKey();
    for (const q of quotes || []) if (q.kind === 'stock' && q.price != null) { const h = c[q.id] || (c[q.id] = {}); h[k] = q.price; const ks = Object.keys(h).sort(); while (ks.length > 30) delete h[ks.shift()]; }
    store.set('mkCloses', JSON.stringify(c));
  }
  function sparkSvg(pts, label) {
    pts = (pts || []).filter(Number.isFinite); if (pts.length < 2) return '';
    const W = 120, H = 34, lo = Math.min(...pts), hi = Math.max(...pts), r = hi - lo || 1;
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(1 + i * (W - 2) / (pts.length - 1)).toFixed(1)},${(H - 2 - (v - lo) / r * (H - 4)).toFixed(1)}`).join('');
    return `<svg class="mq-spark ${pts[pts.length - 1] >= pts[0] ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><path d="${d}"/></svg>`;
  }
  // Where today's price sits between the day's low and high
  function rangeBar(lo, hi, at, label) {
    if (!(lo > 0 && hi > 0 && hi >= lo) || at == null) return '';
    const pos = hi === lo ? 50 : Math.max(0, Math.min(100, (at - lo) / (hi - lo) * 100));
    return `<div class="mq-range" title="${esc(label)}"><span>${esc(mkPrice(lo))}</span><span class="mq-bar"><i style="left:${pos.toFixed(0)}%"></i></span><span>${esc(mkPrice(hi))}</span></div>`;
  }
  const mkPct = pct => pct == null ? '' : `${pct > 0.005 ? '▲ +' : pct < -0.005 ? '▼ ' : ''}${Math.abs(pct) < 0.005 ? '0.0' : (pct > 0 ? pct : -pct).toFixed(2)}%`;
  const mkDir = pct => pct == null ? '' : pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat';
  const mkCap = n => n == null ? '' : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;
  function mkQuadHtml(kind) {
    const title = kind === 'stock' ? 'Stocks' : 'Crypto', p = mkPicks(), ids = kind === 'stock' ? p.stocks.map(s => [s, s, '']) : p.coins.map(c => [c.id, c.sym, c.name || '']);
    if (!ids.length) return `<section class="b-panel md-q" aria-label="${title}"><div class="bp-head"><h3 class="b-sub">${title}</h3></div>
      <p class="day-note">${kind === 'stock' ? 'Up to five stocks or funds: the price, the day’s range and a line of the last month.' : 'Up to five coins: the price, the last 24 hours and a line of the last 7 days.'}</p>
      <p class="day-note"><button class="btn" type="button" data-mkedit>${kind === 'stock' ? 'Pick stocks' : 'Pick coins'}</button></p></section>`;
    if (!mkData || mkData.sig !== mkSig() || Date.now() - mkData.at > 10 * 60 * 1000) setTimeout(() => loadMarkets(), 0);
    const q = new Map((mkData?.quotes || []).map(x => [`${x.kind}:${x.id}`, x])), closes = mkCloses();
    const tiles = ids.map(([id, sym, name]) => {
      const x = q.get(`${kind}:${id}`), url = kind === 'coin' ? `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` : `https://finance.yahoo.com/quote/${encodeURIComponent(id)}`;
      let line = '', foot = '';
      if (kind === 'stock') {
        const h = closes[id] || {}, pts = Object.keys(h).sort().map(k => h[k]);
        line = pts.length >= 3 ? sparkSvg(pts, `${sym}, the last ${pts.length} days`) : '<p class="mq-wait">The line fills in as the days go by.</p>';
        foot = x?.open ? `Open ${esc(mkPrice(x.open))} · Prev close ${esc(mkPrice(x.prev))}` : '';
        if (pts.length >= 3) foot = `${pts.length} days${foot ? ' · ' + foot : ''}`;
      } else {
        line = sparkSvg(x?.spark, `${sym}, the last 7 days`);
        foot = [x?.pct7 != null ? `7 days ${mkPct(x.pct7)}` : '', x?.cap ? `Market cap ${mkCap(x.cap)}` : ''].filter(Boolean).join(' · ');
      }
      return `<button class="mq-tile ${mkDir(x?.pct)}" type="button" data-mkurl="${esc(url)}">
        <span class="mq-name"><b>${esc(sym)}</b>${name ? `<span>${esc(name)}</span>` : ''}</span>
        <span class="mq-price">${x?.price != null ? '$' + esc(mkPrice(x.price)) : '…'}</span><span class="mq-chg">${esc(mkPct(x?.pct))}${kind === 'coin' && x?.pct != null ? ' <small>24 h</small>' : ''}</span>
        ${line}${rangeBar(x?.low, x?.high, x?.price, kind === 'stock' ? 'Today’s low and high' : 'The last 24 hours’ low and high')}
        ${foot ? `<span class="mq-foot">${foot}</span>` : ''}</button>`;
    }).join('');
    const when = mkData?.at ? new Date(mkData.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    return `<section class="b-panel md-q md-mq" aria-label="${title}"><div class="bp-head"><h3 class="b-sub">${title}</h3>
      <span class="bp-meta">${mkData?.problem && kind === 'stock' ? `<span class="err">${esc(mkData.problem)}</span> · ` : ''}${when ? `As of ${esc(when)}` : 'Getting prices…'}</span><button class="linkish bp-edit" type="button" data-mkedit>Change</button></div>
      <div class="mq-grid">${tiles}</div><p class="mc-tip">${kind === 'stock' ? 'Finnhub; may be delayed.' : 'CoinGecko.'} Not investment advice.</p></section>`;
  }
  // ---- Your blog: visitors, RSS readers and search traffic for your own site (Rust blog_stats → the site's
  // /wp-json/reading-room/v1/stats, from the free "The Reading Room stats" plugin, or David's older snippet). Shape: { site, at,
  //   visitors: { total, prev, window, through, days: [{d, n}], label ('visits' from the plugin; people otherwise), source (a caption) }, top: [{title, url, n}],
  //   rss: { total, prev, since, apps: [{name, n}] }, search: { clicks, prevClicks, impressions, position, window, through, queries: [{q, clicks, pos}] } }
  // Any part can be missing. A connected site without the plugin gives null: the panel offers the plugin instead.
  // If asking the site fails, the panel says so with Try again, and asks again by itself after five minutes
  // (it used to go blank until the app was restarted — David, Nov 24: "There's nothing. The tiles are gone.").
  const BLOG = { data: null, at: 0, busy: false, failed: false, loaded: false, err: '' };
  const blogRepaint = () => { if (S.view === 'myday') mdRender(); if (S.view === 'write' || S.view === 'site') wrPaint(); if (S.view === 'tumblr') tbPaint(); };
  async function loadBlog(force) {
    if (BLOG.busy || (!force && BLOG.data && Date.now() - BLOG.at < 30 * 60 * 1000)) return;
    BLOG.busy = true; BLOG.err = '';
    try { const d = await invoke('blog_stats'); BLOG.data = d || BLOG.data; BLOG.loaded = true; BLOG.failed = !d; }
    catch (e) { BLOG.failed = true; BLOG.err = msg(e) || 'The site didn’t answer.'; }
    finally { BLOG.busy = false; BLOG.at = Date.now(); blogRepaint(); }
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-blog-retry]')) { BLOG.failed = false; loadBlog(true); blogRepaint(); } });
  const nfmt = n => n == null ? '—' : n >= 10000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  function delta(now, before, unit) {
    if (now == null || !before) return '';
    const pct = (now - before) / before * 100, dir = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
    return `<span class="bl-d ${dir}">${dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''} ${Math.abs(pct).toFixed(0)}%</span> <span class="bl-vs">${esc(unit)}</span>`;
  }
  const blDay = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // Your Tumblr: what Tumblr gives apps (followers, and the notes on your recent posts). It has no visits or search
  // numbers for apps, and the panel says so.
  function tumblrBlogHtml(b, at = BLOG.at) {
    const when = at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    const top = (b.top || []).map(t => `<li><button class="b-link" type="button" data-mkurl="${esc(t.link)}">${esc((t.title || 'A post').slice(0, 90))}</button><span class="bl-n">${nfmt(t.notes)}</span></li>`).join('');
    return `<section class="b-panel md-blog" aria-label="Your Tumblr">
      <div class="bp-head"><h3 class="b-sub">Your numbers</h3><span class="bp-meta">${esc(b.site || '')}${when ? ` · As of ${esc(when)}` : ''}</span></div>
      <div class="bl-cols"><div class="bl-col"><h4>Followers</h4><p class="bl-big">${nfmt(b.followers)} <small>following your blog</small></p><p class="bl-sub">${nfmt(b.posts)} posts on your blog</p></div>
        <div class="bl-col"><h4>Notes</h4><p class="bl-big">${nfmt(b.recentNotes)} <small>on your last ${b.recentCount || 0} posts</small></p><p class="bl-sub">Likes, reblogs and replies, as Tumblr counts them.</p>
          ${top ? `<h5>Most notes</h5><ul class="bl-list">${top}</ul>` : ''}</div></div>
      <p class="bl-cap">Tumblr doesn’t share visits or search numbers with apps, so those stay in Tumblr’s own Activity page. <button class="b-link" type="button" data-mkurl="https://www.tumblr.com/blog/${esc(b.site || '')}/activity">Open Activity on Tumblr</button></p></section>`;
  }
  // Your Tumblr beside Your blog: when a WordPress (or Micropub) site is home and Tumblr is connected too, Writing shows
  // both panels (David, Nov 25: "Where are the tumblr stats?" — they only showed when Tumblr was the only site).
  const TBL = { data: null, at: 0, busy: false, err: '' };
  async function loadTumblrStats(force) {
    if (TBL.busy || (!force && TBL.data && Date.now() - TBL.at < 30 * 60 * 1000)) return;
    TBL.busy = true; TBL.err = '';
    try { TBL.data = (await invoke('tumblr_stats')) || null; }
    catch (e) { TBL.err = msg(e) || 'Tumblr didn’t answer.'; }
    finally { TBL.busy = false; TBL.at = Date.now(); blogRepaint(); }
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-tbl-retry]')) { TBL.err = ''; loadTumblrStats(true); blogRepaint(); } });
  function alsoTumblrHtml() {
    if (!plusOk() || !SOC.accounts?.tumblr || onTumblr()) return '';
    if (!TBL.busy && (!TBL.data && (!TBL.at || Date.now() - TBL.at > 5 * 60 * 1000) || TBL.data && Date.now() - TBL.at > 30 * 60 * 1000)) setTimeout(() => loadTumblrStats(), 0);
    if (TBL.data) return tumblrBlogHtml(TBL.data, TBL.at);
    const head = '<section class="b-panel md-blog md-blog-invite" aria-label="Your Tumblr"><div class="bp-head"><h3 class="b-sub">Your Tumblr</h3></div>';
    if (TBL.err) return `${head}<p class="day-note">Couldn’t get your Tumblr’s numbers just now. ${esc(TBL.err)} The app tries again in a few minutes. <button class="b-link" type="button" data-tbl-retry>Try again</button></p></section>`;
    return `${head}<p class="day-note">Getting your Tumblr’s numbers…</p></section>`;
  }
  function yourBlogHtml() { return homeBlogHtml(); } // Tumblr's numbers are in the Tumblr tab
  function homeBlogHtml() {
    if (!plusOk()) return SOC.accounts?.site && (onWp() || onTumblr()) ? `<section class="b-panel md-blog md-blog-invite" aria-label="Your blog"><div class="bp-head"><h3 class="b-sub">${onTumblr() ? 'Your Tumblr' : 'Your blog'}</h3></div>
      <p class="day-note">${onTumblr() ? 'See your followers and the notes on your posts here' : 'See your blog’s visitors, RSS readers and search traffic here every day'} with The Reading Room Plus. <button class="b-link" type="button" data-plus>Try it free for a week</button></p></section>` : '';
    if (!BLOG.busy && (!BLOG.data && !BLOG.failed || BLOG.failed && Date.now() - BLOG.at > 5 * 60 * 1000 || BLOG.data && Date.now() - BLOG.at > 30 * 60 * 1000)) setTimeout(() => loadBlog(), 0);
    const b = BLOG.data;
    const head = '<section class="b-panel md-blog md-blog-invite" aria-label="Your blog"><div class="bp-head"><h3 class="b-sub">Your blog</h3></div>';
    // Asking the site went wrong: say what happened instead of showing nothing
    if (!b && BLOG.err) return `${head}<p class="day-note">Couldn’t get your blog’s numbers just now. ${esc(BLOG.err)} The app tries again in a few minutes. <button class="b-link" type="button" data-blog-retry>Try again</button></p></section>`;
    if (!b && !BLOG.loaded) return `${head}<p class="day-note">${BLOG.busy || !BLOG.failed ? 'Getting your blog’s numbers…' : ''}</p></section>`;
    // Connected to a WordPress site that doesn't have the plugin: say where to get it
    if (b?.kind === 'tumblr') return tumblrBlogHtml(b);
    if (!b && BLOG.loaded && SOC.accounts?.wordpress) return `<section class="b-panel md-blog md-blog-invite" aria-label="Your blog"><div class="bp-head"><h3 class="b-sub">Your blog</h3></div>
      <p class="day-note">Your blog’s visitors, RSS readers and search traffic can show here. Add the free plugin The Reading Room stats to your WordPress site. <button class="b-link" type="button" data-mkurl="https://readingroomapp.com/plugin/">Get the plugin</button></p></section>`;
    if (!b || !(b.visitors || b.rss || b.search)) return '';
    const v = b.visitors, days = v?.days || [], max = Math.max(1, ...days.map(x => x.n));
    const bars = days.map((x, i) => { const h = Math.max(2, Math.round(x.n / max * 46));
      return `<rect x="${i * 10 + 1}" y="${48 - h}" width="7" height="${h}" rx="1.5" class="${i === days.length - 1 ? 'now' : ''}"><title>${esc(blDay(x.d))}: ${x.n} visits</title></rect>`; }).join('');
    const apps = b.rss?.apps || [], amax = Math.max(1, ...apps.map(a => a.n));
    const appRows = apps.map(a => `<li><span class="bl-app">${esc(a.name)}</span><span class="bl-hbar"><i style="width:${Math.round(a.n / amax * 100)}%"></i></span><span class="bl-n">${a.n}</span></li>`).join('');
    const q = (b.search?.queries || []).slice(0, 4).map(x => `<li><span class="bl-q">${esc(x.q)}</span><span class="bl-n">${x.clicks}</span><span class="bl-pos" title="Average spot in Google">#${Math.round(x.pos)}</span></li>`).join('');
    const top = (b.top || []).slice(0, 3).map(t => `<li><button class="b-link" type="button" data-mkurl="${esc(t.url)}">${esc(t.title)}</button><span class="bl-n">${t.n}</span></li>`).join('');
    const rssDiff = b.rss?.prev != null ? b.rss.total - b.rss.prev : null;
    const vcol = v ? `<div class="bl-col"><h4>Visitors</h4><p class="bl-big">${nfmt(v.total)} <small>${v.label === 'visits' ? 'visits' : 'people'}, ${v.window || 28} days</small></p><p class="bl-sub">${delta(v.total, v.prev, `vs. the ${v.window || 28} days before`)}</p>
          ${bars ? `<svg class="bl-bars" viewBox="0 0 ${days.length * 10} 48" preserveAspectRatio="none" role="img" aria-label="Visits each day, the last ${days.length} days">${bars}</svg><p class="bl-cap">Visits each day${v.through ? `, through ${esc(blDay(v.through))}` : ''}. ${v.source ? esc(v.source) : 'From Google Analytics'}.</p>` : ''}
          ${top ? `<h5>Read most</h5><ul class="bl-list">${top}</ul>` : ''}</div>` : '';
    const rcol = b.rss ? `<div class="bl-col"><h4>RSS readers</h4><p class="bl-big">${nfmt(b.rss.total)} <small>following</small></p><p class="bl-sub">${rssDiff != null ? `<span class="bl-d ${rssDiff > 0 ? 'up' : rssDiff < 0 ? 'down' : 'flat'}">${rssDiff > 0 ? '+' : rssDiff < 0 ? '−' : '±'}${Math.abs(rssDiff)}</span> <span class="bl-vs">since a week ago</span>` : ''}</p>
          ${appRows ? `<ul class="bl-apps">${appRows}</ul>` : ''}<p class="bl-cap">An estimate from what feed readers tell your site when they check your feed${b.rss.since ? `, counting since ${esc(blDay(b.rss.since))}` : ''}.</p></div>` : '';
    const s = b.search, scol = s ? `<div class="bl-col"><h4>Search</h4><p class="bl-big">${nfmt(s.clicks)} <small>clicks, ${s.window || 28} days</small></p><p class="bl-sub">${delta(s.clicks, s.prevClicks, `vs. the ${s.window || 28} days before`)}</p>
          <p class="bl-sub">${nfmt(s.impressions)} times in results · average spot #${(s.position || 0).toFixed(1)}</p>
          ${q ? `<h5>Searches you show up for</h5><ul class="bl-list bl-qs">${q}</ul>` : ''}<p class="bl-cap">From Google Search Console${s.through ? `, through ${esc(blDay(s.through))}` : ''}.</p></div>` : '';
    const when = b.at ? new Date(b.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    return `<section class="b-panel md-blog" aria-label="Your blog">
      <div class="bp-head"><h3 class="b-sub">Your blog</h3><span class="bp-meta">${esc(b.site || '')}${when ? ` · As of ${esc(when)}` : ''}</span></div>
      <div class="bl-cols">${vcol}${rcol}${scol}</div></section>`;
  }
  function quadHtml() {
    if (dayPrefs().cal && (!MCAL.data || Date.now() - MCAL.at > 5 * 60 * 1000 || MCAL.key !== (() => { const [a, b] = mcalRange(); return `${dayKey(a)}:${dayKey(b)}`; })())) setTimeout(() => loadMonthCal(), 0);
    return `<div class="md-quad">${agendaHtml()}${monthHtml()}${mkQuadHtml('stock')}${mkQuadHtml('coin')}</div>`;
  }
  // Your day's panel without its own heading text change: the same as on Today
  function myDayDayHtml() {
    const h = dayHtml(true);
    if (h) return h;
    return `<section class="b-panel b-day" aria-label="To do"><div class="bp-head"><h3 class="b-sub">To do</h3></div>
      <p class="day-note">Your reminders can show here, read from Reminders on this device. They never leave it.</p>
      <p class="day-note"><button class="btn" type="button" data-dayedit>Show my reminders</button></p></section>`;
  }

  // ---- quick capture
  // ---- "tomorrow 9am", "Tuesday 12:30", "Nov 25 at 3pm for 2 hours": a date and time read from what you typed
  const MD_WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const MD_MO = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function mdParseWhen(text, now = new Date()) {
    let t = ' ' + text + ' ', date = null, hh = null, mm = 0, dur = null;
    const cut = re => { const m = re.exec(t); if (m) t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return m; };
    const day0 = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    let m;
    // duration: "for 2 hours", "for 30 min"
    if ((m = cut(/\s(?:for\s)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i))) dur = Math.round(parseFloat(m[1]) * (/^h/i.test(m[2]) ? 60 : 1));
    // a time range: "12:30-1:30pm", "2-4pm"
    let end = null;
    if ((m = cut(/\s(?:at\s|from\s)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)\b/i))) {
      const ap2 = m[6].toLowerCase()[0], ap1 = (m[3] || m[6]).toLowerCase()[0];
      hh = (Number(m[1]) % 12) + (ap1 === 'p' ? 12 : 0); mm = Number(m[2] || 0);
      end = [(Number(m[4]) % 12) + (ap2 === 'p' ? 12 : 0), Number(m[5] || 0)];
      if (end[0] * 60 + end[1] <= hh * 60 + mm && !m[3]) hh -= 12;
      if (hh < 0) hh += 12;
    }
    // a time: "9am", "9:30 pm", "at 5", "at 17:00", "noon", "midnight"
    if (hh == null) {
      if ((m = cut(/\s(?:at\s)?(noon|midday)\b/i))) hh = 12;
      else if ((m = cut(/\s(?:at\s)?midnight\b/i))) hh = 0;
      else if ((m = cut(/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.!?]|$)/i))) { hh = (Number(m[1]) % 12) + (/^p/i.test(m[3]) ? 12 : 0); mm = Number(m[2] || 0); }
      else if ((m = cut(/\sat\s(\d{1,2})(?::(\d{2}))?(?=[\s,.!?]|$)/i))) { hh = Number(m[1]); mm = Number(m[2] || 0); if (hh >= 1 && hh <= 7) hh += 12; } // "at 5" is 5 pm
      else if ((m = cut(/\s(\d{1,2}):(\d{2})(?=[\s,.!?]|$)/))) { hh = Number(m[1]); mm = Number(m[2]); if (hh >= 1 && hh <= 7) hh += 12; }
    }
    if (hh != null && (hh > 23 || mm > 59)) { hh = null; mm = 0; }
    // the day
    if ((m = cut(/\s(today)\b/i))) date = day0(now);
    else if ((m = cut(/\s(tonight)\b/i))) { date = day0(now); if (hh == null) hh = 19; else if (hh < 12) hh += 12; }
    else if ((m = cut(/\s(tomorrow|tmrw|tmw)\b/i))) date = day0(new Date(now.getTime() + 864e5));
    else if ((m = cut(/\s(?:on\s)?(next\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?\b/i))) {
      const want = MD_WD.indexOf(m[2].toLowerCase().slice(0, 3)); let add = (want - now.getDay() + 7) % 7;
      // "next Tuesday": Tuesday of next week (weeks run Monday to Sunday)
      if (m[1]) add = (((8 - now.getDay()) % 7) || 7) + (want + 6) % 7;
      date = day0(new Date(now.getTime() + add * 864e5));
    }
    else if ((m = cut(/\s(?:on\s)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s(\d{1,2})(?:st|nd|rd|th)?(?:,?\s(\d{4}))?\b/i))) {
      const mo = MD_MO.indexOf(m[1].toLowerCase().slice(0, 3)); date = new Date(m[3] ? Number(m[3]) : now.getFullYear(), mo, Number(m[2]));
      if (!m[3] && date < day0(now)) date.setFullYear(date.getFullYear() + 1);
    }
    else if ((m = cut(/\s(?:on\s)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
      date = new Date(y, Number(m[1]) - 1, Number(m[2])); if (!m[3] && date < day0(now)) date.setFullYear(date.getFullYear() + 1);
    }
    else if ((m = cut(/\sin\s(\d+)\s(day|days|week|weeks)\b/i))) date = day0(new Date(now.getTime() + Number(m[1]) * (/^w/i.test(m[2]) ? 7 : 1) * 864e5));
    else if ((m = cut(/\snext\sweek\b/i))) { const add = ((1 - now.getDay() + 7) % 7) || 7; date = day0(new Date(now.getTime() + add * 864e5)); }
    if (!date && hh != null) { date = day0(now); if (hh * 60 + mm <= now.getHours() * 60 + now.getMinutes()) date = day0(new Date(now.getTime() + 864e5)); }
    if (!date) return { title: text.trim(), found: false };
    if (end && hh != null) dur = Math.max(15, (end[0] * 60 + end[1]) - (hh * 60 + mm));
    const title = t.replace(/\s(on|at|by|for|from)\s*$/i, ' ').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim().replace(/[,\s]+$/, '');
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { title: title || text.trim(), found: true, date: ymd, time: hh != null ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : '', dur };
  }
  // The date and time under Put it down: filled in from what you typed; change them before you Add
  function whenHtml() {
    const ev = MD.capTo === 'event', w = MD.when;
    if (!ev && MD.capTo !== 'task') return '';
    if (!ev && !w?.found && !MD.wantDate) return `<div class="md-when" id="mdWhen"><button class="linkish" type="button" data-md="wantdate">Add a due date</button><span class="md-cap-tip">or type it, like “tomorrow 9am”</span></div>`;
    const now = new Date(), next = new Date(now.getTime() + 3600e3);
    const date = w?.date || dayKey(ev ? now : now), time = w?.found ? w.time : ev ? `${String(next.getHours()).padStart(2, '0')}:00` : '';
    const dur = w?.dur || 60;
    const lens = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [480, 'All day']];
    if (!lens.some(([v]) => v === dur)) lens.push([dur, `${dur} min`]);
    return `<div class="md-when" id="mdWhen">
      <label><span>${ev ? 'When' : 'Due'}</span><input type="date" id="mdWhenDate" data-md="when" value="${esc(date)}"></label>
      <label><span>Time</span><input type="time" id="mdWhenTime" data-md="when" value="${esc(time)}"${ev && MD.allDay ? ' disabled' : ''}></label>
      ${ev ? `<label><span>Length</span><select id="mdWhenDur" data-md="when">${lens.map(([v, l]) => `<option value="${v}"${(MD.allDay ? 480 : dur) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`
        : `<button class="linkish" type="button" data-md="nodate">No due date</button>`}
      ${w?.found && w.title !== (MD.cap || '').trim() ? `<span class="md-cap-tip">Saves as “${esc(w.title)}”</span>` : ''}</div>`;
  }
  function mdWhenRead() {
    const d = $('mdWhenDate')?.value, tm = $('mdWhenTime')?.value, dur = Number($('mdWhenDur')?.value || 60);
    if (!d) return null;
    const [y, mo, da] = d.split('-').map(Number), [h, mi] = (tm || '0:0').split(':').map(Number);
    const allDay = MD.capTo === 'event' && (dur >= 480 || !tm);
    const start = new Date(y, mo - 1, da, allDay || !tm ? 0 : h, allDay || !tm ? 0 : mi);
    return { start, timed: !!tm && !allDay, allDay, end: allDay ? new Date(y, mo - 1, da + 1) : new Date(start.getTime() + dur * 60e3) };
  }
  const mdFmtWhen = (w, ev) => w.start.toLocaleString(undefined, w.timed ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric' }) + (ev && w.allDay ? ' (all day)' : '');
  function captureHtml() {
    const d = mdPeek(dayKey()), c = d?.cap || {};
    const n = (k, one, many) => c[k] ? `<span>${c[k]} ${c[k] === 1 ? one : many}</span>` : '';
    const caught = [n('note', 'note for tonight', 'notes for tonight'), n('task', 'task', 'tasks'), n('event', 'event', 'events'), n('link', 'link saved', 'links saved')].filter(Boolean);
    const to = [['task', 'Task → Reminders'], ['event', 'Event → Calendar'], ['note', 'Note → tonight’s journal']];
    return `<form class="md-cap" data-md="capform" autocomplete="off"><label class="md-cap-l" for="mdCapIn">Put it down</label>
      <div class="md-cap-row"><input id="mdCapIn" class="search" type="text" maxlength="300" placeholder="${MD.capTo === 'event' ? 'Lunch with Sam Tuesday 12:30' : MD.capTo === 'task' ? 'Call the leasing office tomorrow 9am' : 'A task, a thought, a link…'}" value="${esc(MD.cap)}"><button class="btn primary" type="submit">${MD.capTo === 'event' ? 'Add to Calendar' : 'Add'}</button></div>
      ${whenHtml()}
      <div class="md-cap-to" role="radiogroup" aria-label="Where it goes">${to.map(([k, label]) => `<button type="button" role="radio" class="md-to${MD.capTo === k ? ' on' : ''}" aria-checked="${MD.capTo === k}" data-md="capto" data-to="${k}">${label}</button>`).join('')}<span class="md-cap-tip">Paste a link and it goes to Read later.</span></div>
      ${caught.length ? `<p class="md-caught">Today: ${caught.join(' · ')}</p>` : ''}</form>`;
  }
  async function mdCapture() {
    const t = ($('mdCapIn')?.value || '').trim(); if (!t) return;
    const d = mdDay(), bump = k => { d.cap[k] = (d.cap[k] || 0) + 1; };
    MD.cap = '';
    try {
      if (/^https?:\/\/\S+$/i.test(t)) {
        await invoke('save_url', { url: t, title: null });
        bump('link'); status('Saved to Read later.'); load();
      } else if (MD.capTo === 'note') {
        d.notes.push({ t, at: Date.now() }); bump('note'); status('Kept for tonight’s journal.');
      } else if (MD.capTo === 'event') {
        const w = mdWhenRead(); if (!w) { MD.cap = t; status('Pick a date for the event.', true); mdRender(); return; }
        const title = MD.when?.found ? MD.when.title : t;
        await invoke('event_add', { title, start: w.start.getTime() / 1000, end: w.end.getTime() / 1000, allDay: w.allDay });
        bump('event'); status(`Added to Calendar: ${title}, ${mdFmtWhen(w, true)}.`); DAYB.data = null; MD.tmr = null; MCAL.at = 0; setTimeout(() => loadDay(), 300);
      } else {
        const w = MD.when?.found || MD.wantDate ? mdWhenRead() : null, title = MD.when?.found ? MD.when.title : t;
        await invoke('reminder_add', { title, due: w ? w.start.getTime() / 1000 : null, timed: !!w?.timed, list: remList() });
        bump('task'); { const where = remList() === '*' ? 'Reminders' : `“${remList()}” in Reminders`; status(w ? `Added to ${where}, due ${mdFmtWhen(w)}.` : `Added to ${where}.`); } DAYB.data = null; setTimeout(() => loadDay(), 300);
      }
      MD.when = null; MD.wantDate = false; MD.allDay = false; MD.whenEdited = false;
    } catch (e) { MD.cap = t; status(msg(e), true); }
    savePrefs(); MD.refocus = 'mdCapIn'; mdRender();
  }

  // ---- your compass
  // Your compass is now just this morning's ritual: the Big 3 came out on Nov 21 and the goals on Nov 21 too
  // (both David's calls). No ritual set, no tile; "Rituals and goals" sits with the view links at the top.
  function compassHtml() {
    const c = cmp(), d = mdPeek(dayKey());
    if (!c.rituals.m.length) return '';
    const done = d?.rm || [], all = c.rituals.m.every((_, i) => done[i]);
    return `<section class="b-panel b-cp" aria-label="Your compass">
      <div class="bp-head"><h3 class="b-sub">Morning ritual</h3>${all ? '<span class="bp-meta">Done</span>' : ''}</div>
      <div class="cp-list">${c.rituals.m.map((t, i) => `<button class="cp-task sm${done[i] ? ' done' : ''}" type="button" aria-pressed="${!!done[i]}" data-md="rit" data-r="rm" data-n="${i}"><span class="cp-box" aria-hidden="true">${done[i] ? '✓' : ''}</span><span class="cp-t">${esc(t)}</span></button>`).join('')}</div>
      <p class="cp-foot"><button class="linkish" type="button" data-md="edit">Rituals and goals</button></p>
    </section>`;
  }
  function cpGoalHtml(g) {
    const p = goalProgress(g), today = mdPeek(dayKey())?.h?.[g.id];
    const act = g.kind === 'habit' ? `<button class="cp-act${today ? ' on' : ''}" type="button" data-md="habit" data-id="${esc(g.id)}" aria-pressed="${!!today}">${today ? '✓ Today' : 'Did it today'}</button>`
      : g.kind === 'count' && p.target ? `<button class="cp-act" type="button" data-md="count" data-id="${esc(g.id)}" aria-label="Add one to ${esc(g.title)}">+1</button>` : '';
    return `<div class="cp-goal"><div class="cp-gl"><span class="cp-gt">${g.acct ? `<span class="cp-acct">${esc(g.acct)}</span>` : ''}${esc(g.title)}</span><span class="cp-n">${esc(p.text)}</span>${act}</div>
      ${p.pct != null ? `<div class="cp-bar" role="img" aria-label="${esc(p.text)}"><i style="width:${Math.round(p.pct * 100)}%"></i></div>` : ''}</div>`;
  }

  // ---- evening
  function eveningTodayHtml() {
    const c = cmp(), d = mdPeek(dayKey()) || {};
    const rit = c.rituals.e.length ? `<div class="cp-lab">Evening ritual</div><div class="cp-list">${c.rituals.e.map((t, i) => `<button class="cp-task sm${d.re?.[i] ? ' done' : ''}" type="button" aria-pressed="${!!d.re?.[i]}" data-md="rit" data-r="re" data-n="${i}"><span class="cp-box" aria-hidden="true">${d.re?.[i] ? '✓' : ''}</span><span class="cp-t">${esc(t)}</span></button>`).join('')}</div>`
      : `<p class="day-note">An evening ritual is a few small things you do to close the day. <button class="b-link" type="button" data-md="edit">Add yours</button></p>`;
    const notes = d.notes?.length ? `<div class="cp-lab">For tonight’s journal</div><ul class="ev-notes">${d.notes.map(x => `<li>${esc(x.t)} <time>${esc(new Date(x.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</time></li>`).join('')}</ul>` : '';
    const dayone = doPrefs().on ? `<div class="day-foot"><button class="btn day-one" type="button" data-md="dayone-today">${DAYONE_ICON}Write today’s page in Day One</button></div>` : '';
    return `<section class="b-panel b-cp" aria-label="How today went">
      <div class="bp-head"><h3 class="b-sub">How today went</h3></div>
      ${rit}${notes}${dayone}</section>`;
  }
  function planTomorrowHtml() {
    const t = addDays(new Date(), 1);
    if (!dayOn() || !dayPrefs().cal) return '';
    if (!MD.tmr || MD.tmr.day !== dayKey(t) || Date.now() - MD.tmr.at > 15 * 60 * 1000) setTimeout(loadTomorrow, 0);
    const ev = MD.tmr?.events || [];
    return `<section class="b-panel b-tm" aria-label="Tomorrow">
      <div class="bp-head"><h3 class="b-sub">Tomorrow</h3><span class="bp-meta">${esc(t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</span></div>
      ${ev.length ? `<ul class="day-ev">${ev.slice(0, 8).map(e => `<li><time>${e.all_day ? 'All day' : esc(hm(e.start))}</time><span><b>${esc(e.title || 'Event')}</b>${e.location || e.calendar ? `<small>${esc([e.location, e.calendar].filter(Boolean).join(' · '))}</small>` : ''}</span></li>`).join('')}</ul>` : `<p class="day-note">${MD.tmr ? 'Nothing on the calendar tomorrow.' : 'Looking at tomorrow…'}</p>`}</section>`;
  }
  async function loadTomorrow() {
    if (!dayOn() || !dayPrefs().cal || MD.tmrBusy) return;
    const a = addDays(new Date(), 1); a.setHours(0, 0, 0, 0);
    MD.tmrBusy = true;
    try {
      const r = await invoke('day_today', { from: a.getTime() / 1000, to: addDays(a, 1).getTime() / 1000, calendar: true, reminders: false, ask: false, done: false });
      MD.tmr = { day: dayKey(a), at: Date.now(), events: r?.events || [] };
      if (S.view === 'myday') mdRender();
    } catch { MD.tmr = { day: dayKey(a), at: Date.now(), events: [] }; }
    finally { MD.tmrBusy = false; }
  }
  // The evening's journal page: today's date, what you put down, what you read, and room to write
  function eveningPage() {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return questionPage(t0, DAYB.data);
  }

  // ---- Weekly Preview
  const WK_STEPS = ['Look back', 'Goals', 'What you read', 'Next week', 'Save and share'];
  function weeklyHtml() {
    const wk = mdWeek(), w = mdWk(wk.key), step = Math.max(0, Math.min(4, MD.step));
    const head = `<div class="md-top"><div class="md-top-row"><h2>Weekly Preview</h2><div class="md-modes"><button type="button" class="linkish" data-md="mode" data-mode="day">Back to My Day</button></div></div>
      <p class="b-date">${esc(fmtRange(wk.mon, wk.sun))}${w.done ? ' · done' : ''}</p>
      <p class="b-line">${step === 4 ? 'One review, two pages: a private one for your journal, a public one for your blog.' : 'Ten minutes to see where the week went and point the next one.'}</p>
      <ol class="wk-steps" aria-label="Steps">${WK_STEPS.map((s, i) => `<li><button type="button" class="${i === step ? 'on' : ''}" data-md="step" data-step="${i}"${i === step ? ' aria-current="step"' : ''}>${i + 1} ${s}</button></li>`).join('')}</ol></div>`;
    const panes = [wkLookBack, wkGoals, wkReading, wkNext, wkShare];
    const nav = `<div class="wk-nav">${step > 0 ? '<button class="btn" type="button" data-md="prev">Back</button>' : ''}${step < 4 ? '<button class="btn primary" type="button" data-md="next">Next</button>' : '<button class="btn primary" type="button" data-md="finish">Done: start the week</button>'}</div>`;
    return `<section class="brief myday md-week" aria-label="Weekly Preview">${head}${panes[step](wk, w)}${nav}</section>`;
  }
  function wkStats(wk) {
    let r = 0, rt = 0;
    const c = cmp(), perDay = wk.days.map(d => {
      const x = mdPeek(dayKey(d));
      const rits = c.rituals.m.length + c.rituals.e.length;
      if (rits && d <= new Date()) { rt += rits; r += (x?.rm || []).filter(Boolean).length + (x?.re || []).filter(Boolean).length; }
      return { d };
    });
    return { perDay, r, rt };
  }
  function wkLookBack(wk, w) {
    const s = wkStats(wk);
    return `<div class="md-grid"><section class="b-panel" aria-label="Look back">
        <div class="bp-head"><h3 class="b-sub">Look back</h3>${s.rt ? `<span class="bp-meta">Rituals: ${s.r} of ${s.rt} done</span>` : ''}</div>
        <label class="cp-lab" for="wkWins">Wins this week</label>
        <textarea id="wkWins" class="search wk-ta" rows="4" data-md="wk" data-k="wins" placeholder="Big or small. What went right?">${esc(w.wins || '')}</textarea>
        <label class="cp-lab" for="wkHard">What got in the way</label>
        <textarea id="wkHard" class="search wk-ta" rows="3" data-md="wk" data-k="hard" placeholder="Be honest; this stays private.">${esc(w.hard || '')}</textarea>
      </section>
      <section class="b-panel" aria-label="Notes you put down">
        <div class="bp-head"><h3 class="b-sub">From your week</h3></div>
        ${(() => {
          const notes = wk.days.flatMap(d => (mdPeek(dayKey(d))?.notes || []).map(x => ({ ...x, d })));
          return (notes.length ? `<div class="cp-lab">Notes you put down</div><ul class="ev-notes">${notes.slice(-12).map(x => `<li>${esc(x.t)} <time>${esc(x.d.toLocaleDateString(undefined, { weekday: 'short' }))}</time></li>`).join('')}</ul>` : '')
            || '<p class="day-note">The notes you put down on My Day gather here, to jog your memory.</p>';
        })()}
      </section></div>`;
  }
  function wkGoals(wk, w) {
    const c = cmp(), prev = S.prefs.weeks?.[prevWkKey(wk.key)]?.snap || {};
    const rows = c.goals.length ? c.goals.map(g => {
      const p = goalProgress(g, wk.days), before = prev[g.id];
      const delta = g.kind === 'habit' ? (before != null ? (p.n > before ? `up from ${before}` : p.n < before ? `down from ${before}` : 'same as last week') : '')
        : p.n != null && before != null ? (p.n - before > 0 ? `+${p.n - before} this week` : 'no change this week') : '';
      return `<div class="cp-goal"><div class="cp-gl"><span class="cp-gt">${g.acct ? `<span class="cp-acct">${esc(g.acct)}</span>` : ''}${esc(g.title)}</span><span class="cp-n">${esc(p.text)}${delta ? ` <em class="wk-d">${esc(delta)}</em>` : ''}</span></div>
        ${p.pct != null ? `<div class="cp-bar"><i style="width:${Math.round(p.pct * 100)}%"></i></div>` : ''}</div>`;
    }).join('') : `<p class="day-note">No goals yet. <button class="b-link" type="button" data-md="edit">Set your goals</button></p>`;
    const tr = [['yes', 'Yes'], ['mostly', 'Mostly'], ['change', 'Needs a change']];
    return `<div class="md-grid"><section class="b-panel b-cp md-wide" aria-label="Goals">
        <div class="bp-head"><h3 class="b-sub">Goals</h3><span class="bp-meta">${esc(c.season || 'This season')}</span><button class="linkish bp-edit" type="button" data-md="edit">Change</button></div>
        ${rows}
        <div class="wk-track" role="radiogroup" aria-label="On track?"><span>On track?</span>${tr.map(([k, l]) => `<button type="button" role="radio" class="md-to${w.track === k ? ' on' : ''}" aria-checked="${w.track === k}" data-md="track" data-v="${k}">${l}</button>`).join('')}</div>
        ${c.why ? `<p class="cp-why">Why it matters: <em>${esc(c.why)}</em></p>` : ''}
      </section></div>`;
  }
  function wkPicks() {
    const picks = roundupPicks(), w = mdWk();
    if (!w.reads) {
      const on = picks.filter(p => p.score >= 2).slice(0, 5);
      for (const p of picks) if (on.length < Math.min(5, picks.length) && !on.includes(p)) on.push(p);
      w.reads = Object.fromEntries(on.map(p => [p.it.id, '']));
    }
    return picks;
  }
  function wkReading(wk, w) {
    const picks = wkPicks();
    const list = picks.length ? picks.slice(0, 20).map(p => {
      const on = p.it.id in w.reads;
      return `<div class="ru-item${on ? ' on' : ''}"><label class="ru-row"><input type="checkbox" data-md="pick" data-id="${esc(p.it.id)}"${on ? ' checked' : ''}><span><b>${esc(headline(p.it))}</b><small>${esc(cardWriter(p.it))} · ${esc(hostOfU(p.it.link))}${p.hl ? ' · highlighted' : p.it.saved ? ' · saved' : ''}</small></span></label>
        ${p.hl ? `<blockquote class="wk-hlq">${esc(p.hl.text.replace(/\s+/g, ' ').trim().slice(0, 280))}</blockquote>` : ''}
        ${on ? `<input class="n-field ru-why" type="text" maxlength="280" data-md="why" data-id="${esc(p.it.id)}" value="${esc(w.reads[p.it.id] || '')}" placeholder="Your one-line take (optional)">` : ''}</div>`;
    }).join('') : '<p class="day-note">Nothing read, saved or highlighted this week yet.</p>';
    return `<div class="md-grid"><section class="b-panel md-wide" aria-label="What you read">
      <div class="bp-head"><h3 class="b-sub">What you read that mattered</h3><span class="bp-meta">The ones you tick go into your Weeknotes, with a line from you</span></div>
      <div class="ru-list">${list}</div></section></div>`;
  }
  function wkNext(wk, w) {
    const c = cmp();
    if (!MD.wkCal || MD.wkCal.key !== wk.key) setTimeout(loadNextWeek, 0);
    const ev = MD.wkCal?.events || [];
    const big = ev.filter(e => e.all_day || e.end - e.start >= 3 * 3600).slice(0, 8);
    return `<div class="md-grid"><section class="b-panel md-wide" aria-label="Next week">
      <div class="bp-head"><h3 class="b-sub">Next week</h3><span class="bp-meta">${esc(fmtRange(addDays(wk.mon, 7), addDays(wk.sun, 7)))}</span></div>
      <div class="day-cols">
        <div class="day-col"><label class="cp-lab" for="wkFocus">One focus for the week</label>
          <input id="wkFocus" class="search wk-in" type="text" maxlength="160" data-md="wk" data-k="focus" value="${esc(w.focus || '')}" placeholder="What would make next week a good one?">
          ${dayOn() && dayPrefs().cal ? (big.length ? `<p class="tm-tip">Big dates: ${big.map(e => `<b>${esc(new Date(e.start * 1000).toLocaleDateString(undefined, { weekday: 'short' }))}</b> ${esc(e.title || 'Event')}`).join(' · ')}</p>` : `<p class="tm-tip">${MD.wkCal ? 'No all-day or long events next week.' : 'Looking at next week…'}</p>`) : ''}</div>
        <div class="day-col"><div class="cp-lab">A step for each goal</div>
          ${c.goals.length ? `<div class="tm-list">${c.goals.map(g => `<label class="tm-in"><span class="tm-n tm-a" aria-hidden="true">${esc((g.acct || g.title || '?').trim()[0].toUpperCase())}</span><input class="search" type="text" maxlength="160" data-md="step-in" data-id="${esc(g.id)}" value="${esc(w.steps[g.id] || '')}" placeholder="${esc(g.title)}: one step" aria-label="${esc(g.title)}: one step next week"></label>`).join('')}</div>` : '<p class="day-note">Set your goals to plan a step for each.</p>'}</div>
      </div></section></div>`;
  }
  async function loadNextWeek() {
    const wk = mdWeek(); if (!dayOn() || !dayPrefs().cal) { MD.wkCal = { key: wk.key, events: [] }; return; }
    if (MD.wkBusy) return; MD.wkBusy = true;
    try {
      const a = addDays(wk.mon, 7);
      const r = await invoke('day_today', { from: a.getTime() / 1000, to: addDays(a, 7).getTime() / 1000, calendar: true, reminders: false, ask: false, done: false });
      MD.wkCal = { key: wk.key, events: r?.events || [] };
    } catch { MD.wkCal = { key: wk.key, events: [] }; }
    finally { MD.wkBusy = false; if (S.view === 'myday' && MD.mode === 'week') mdRender(); }
  }
  function wkDayOneText(wk, w) {
    const c = cmp(), s = wkStats(wk);
    const out = [`# Week of ${wk.mon.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`];
    if (w.wins?.trim()) out.push('## Wins\n' + w.wins.trim());
    if (w.hard?.trim()) out.push('## What got in the way\n' + w.hard.trim());
    if (c.goals.length) out.push('## Goals\n' + c.goals.map(g => `- ${goalLine(g, wk.days)}`).join('\n') + (w.track ? `\n\nOn track: ${{ yes: 'yes', mostly: 'mostly', change: 'needs a change' }[w.track]}` : ''));
    const steps = c.goals.filter(g => w.steps[g.id]?.trim());
    if (w.focus?.trim() || steps.length) out.push('## Next week\n' + [w.focus?.trim() ? `Focus: ${w.focus.trim()}` : '', ...steps.map(g => `- ${g.title}: ${w.steps[g.id].trim()}`)].filter(Boolean).join('\n'));
    return out.join('\n\n');
  }
  function wkMade(wk) {
    const mine = myFeed(); if (!mine) return [];
    const a = wk.mon.getTime(), b = addDays(wk.sun, 1).getTime();
    return S.items.filter(i => isOwn(i.feed_id) && isWeb(i.link) && Date.parse(i.date) >= a && Date.parse(i.date) < b).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 10);
  }
  const wkLabel = t => { t = (t || '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim(); return [...t].length > 78 ? [...t].slice(0, 77).join('').trimEnd() + '…' : t; };
  // Weeknotes for your site: "## " headings, [Title](link) lines (links and Webmentions), never goals or "what got in the way"
  function weeknotes(wk, w, forSite) {
    const sh = w.share, parts = [];
    if (sh.wins && w.wins?.trim()) parts.push('## This week\n\n' + w.wins.trim());
    const made = wkMade(wk);
    if (sh.made && made.length) parts.push('## Things I made\n\n' + made.map(i => forSite ? `[${wkLabel(headline(i))}](${i.link})` : `${headline(i)}\n${i.link}`).join('\n\n'));
    const picks = wkPicks().filter(p => p.it.id in (w.reads || {}));
    if (sh.read && picks.length) parts.push('## Good things I read\n\n' + picks.map(p => { const why = (w.reads[p.it.id] || '').trim(); return forSite ? `[${wkLabel(headline(p.it))}](${p.it.link}) — ${cardWriter(p.it)}${why ? '\n' + why : ''}` : `${headline(p.it)} — ${cardWriter(p.it)}\n${p.it.link}${why ? '\n' + why : ''}`; }).join('\n\n'));
    if (sh.next && w.focus?.trim()) parts.push('## Next week\n\n' + w.focus.trim());
    return parts.join('\n\n');
  }
  const wkTitle = wk => `Weeknotes: ${fmtRange(wk.mon, wk.sun)}`;
  function wkShare(wk, w) {
    const wp = SOC.accounts?.site, notes = weeknotes(wk, w, false), sh = w.share;
    const box = (k, l) => `<label><input type="checkbox" data-md="share" data-k="${k}"${sh[k] ? ' checked' : ''}> ${l}</label>`;
    return `<div class="md-grid">
      <section class="b-panel" aria-label="Your journal">
        <div class="bp-head"><h3 class="b-sub">Your journal</h3><span class="bp-meta">Private · Day One</span></div>
        <pre class="wo-doc">${esc(wkDayOneText(wk, w))}</pre>
        <p class="tm-tip">Tagged <b>Weekly Review</b> in Day One. Everything here stays private.</p>
        <div class="day-foot">${doPrefs().on ? `<button class="btn primary day-one" type="button" data-md="wk-dayone">${DAYONE_ICON}Save to Day One</button>` : `<button class="btn" type="button" data-md="wk-copy-dayone">${IOS ? 'Share…' : 'Copy'}</button><span class="tm-tip"> To send it to Day One, turn on Day One in Settings › Your day.</span>`}</div>
      </section>
      <section class="b-panel" aria-label="Weeknotes">
        <div class="bp-head"><h3 class="b-sub">Weeknotes</h3><span class="bp-meta">Public · a draft blog post, in Weeknotes</span></div>
        <pre class="wo-doc">${esc(wkTitle(wk) + '\n\n' + (notes || 'Tick what goes in below. Wins come from Look back, your reading from What you read.'))}</pre>
        <div class="wo-pick" role="group" aria-label="What goes in">${box('wins', 'Wins')}${box('made', 'Things I made')}${box('read', 'What I read')}${box('next', 'Next week')}<span class="wo-off">Goals and what got in the way always stay private.</span></div>
        <p class="acct-note" id="wkNote" aria-live="polite"></p>
        ${wp && !w.published ? `<div class="wk-photo">${MD.wkPhoto
          ? `<img src="${MD.wkPhoto.data}" alt=""><div class="wk-photo-in"><span class="cp-lab">Featured image</span><input class="n-field" id="wkAlt" data-md="wk-alt" placeholder="Describe the picture for people who can’t see it" maxlength="1000" value="${esc(MD.wkPhoto.alt || '')}"><button class="b-link" type="button" data-md="wk-photo-x">Remove</button></div>`
          : `<button class="b-link" type="button" data-md="wk-photo">+ Add a featured image</button><span class="tm-tip"> It shows at the top of the post and when the post is shared.</span>`}<input id="wkPhotoIn" data-md="wk-photo-in" type="file" accept="image/*" hidden></div>` : ''}
        <div class="day-foot">${w.published
          ? `<span class="tm-tip">Published ${esc(new Date(w.published).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}.</span>${w.pubUrl ? ` <button class="b-link" type="button" data-md="wk-view">See the post</button>` : ''} `
          : wp ? '<button class="btn primary" type="button" data-md="wk-publish">Publish now</button> <button class="btn" type="button" data-md="wk-draft">Save as draft</button> ' : ''}<button class="btn" type="button" data-md="wk-copy">${IOS ? 'Share…' : 'Copy'}</button>${wp ? '' : '<span class="tm-tip"> Connect your site in Settings › Your site to post it there.</span>'}</div>
      </section></div>`;
  }
  async function wkCopy(text, title) {
    if (IOS && navigator.share) { try { await navigator.share({ title, text }); } catch {} return; }
    try { await navigator.clipboard.writeText(text); status('Copied.'); } catch { status('Couldn’t copy it here.', true); }
  }

  // ---- render, without wiping what you're typing
  const mdTyping = () => { const a = document.activeElement; return !!a && $('list')?.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio'].includes(a.type))); };
  function mdRender() { MD.force = true; renderList(); }
  function paintMyDay() {
    if (!MD.force && mdTyping()) return;
    MD.force = false;
    const y = $('main').scrollTop, ly = $('listView').scrollTop;
    $('list').innerHTML = mydayHtml();
    $('main').scrollTop = y; $('listView').scrollTop = ly;
    if (MD.refocus) { const el = $(MD.refocus); MD.refocus = ''; if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} } }
  }

  // ---- what the page's buttons and fields do
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-md]'); if (!b || !b.closest('.myday, #compassPanel')) return;
    const k = b.dataset.md, d = () => mdDay(), n = Number(b.dataset.n);
    if (k === 'mode') { MD.mode = b.dataset.mode; MD.step = 0; mdRender(); $('listView').scrollTo({ top: 0 }); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'week') { MD.mode = 'week'; MD.step = 0; mdRender(); $('listView').scrollTo({ top: 0 }); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'edit') { openCompass(); return; }
    if (k === 'settings') { openMydaySettings(); return; }
    if (k === 'autook') { MD.auto = false; mdRender(); return; }
    if (k === 'calmon') { const m = mcalMonth(); MCAL.month = n === 0 ? null : new Date(m.getFullYear(), m.getMonth() + n, 1); if (n === 0) MCAL.sel = ''; mdRender(); loadMonthCal(); return; }
    if (k === 'calsel') { MCAL.sel = b.dataset.day === dayKey() ? '' : b.dataset.day || ''; mdRender(); return; }
    if (k === 'capto') { MD.capTo = b.dataset.to; MD.cap = $('mdCapIn')?.value || ''; if (!MD.whenEdited) MD.when = MD.cap ? mdParseWhen(MD.cap) : null; MD.refocus = 'mdCapIn'; mdRender(); return; }
    if (k === 'wantdate') { MD.wantDate = true; MD.cap = $('mdCapIn')?.value || ''; mdRender(); return; }
    if (k === 'nodate') { MD.wantDate = false; MD.when = null; MD.whenEdited = true; MD.cap = $('mdCapIn')?.value || ''; mdRender(); return; }
    if (k === 'rit') { const arr = d()[b.dataset.r]; arr[n] = !arr[n]; savePrefs(); mdRender(); return; }
    if (k === 'habit') { const h = d().h; h[b.dataset.id] = !h[b.dataset.id]; savePrefs(); mdRender(); return; }
    if (k === 'count') { const g = (S.prefs.compass?.goals || []).find(x => x.id === b.dataset.id); if (g) { g.done = (Number(g.done) || 0) + 1; savePrefs(); mdRender(); } return; }
    if (k === 'dayone-today') { dayOne(eveningPage(), 'Evening'); return; }
    // Weekly Preview
    const wk = mdWeek(), w = mdWk(wk.key);
    if (k === 'step') { MD.step = Number(b.dataset.step); mdRender(); return; }
    if (k === 'next' || k === 'prev') { MD.step += k === 'next' ? 1 : -1; mdRender(); $('listView').scrollTo({ top: 0 }); $('main').scrollTo({ top: 0 }); return; }
    if (k === 'track') { w.track = b.dataset.v; savePrefs(); mdRender(); return; }
    if (k === 'wk-dayone') { dayOne(wkDayOneText(wk, w), 'Weekly Review'); w.dayone = Date.now(); savePrefs(); return; }
    if (k === 'wk-copy-dayone') { wkCopy(wkDayOneText(wk, w), `Week of ${wk.mon.toLocaleDateString()}`); return; }
    if (k === 'wk-copy') { wkCopy(wkTitle(wk) + '\n\n' + weeknotes(wk, w, false), wkTitle(wk)); return; }
    if (k === 'wk-photo') { $('wkPhotoIn')?.click(); return; }
    if (k === 'wk-photo-x') { MD.wkPhoto = null; mdRender(); return; }
    if (k === 'wk-view') { if (w.pubUrl) invoke('open_external', { url: w.pubUrl }).catch(() => {}); return; }
    if (k === 'wk-draft' || k === 'wk-publish') {
      const draft = k === 'wk-draft', text = weeknotes(wk, w, true), note = t => { const el = $('wkNote'); if (el) el.textContent = t; };
      if (!text) { note('Tick at least one part, and write a win or pick a post to read.'); return; }
      if (!draft && !confirm(`Publish “${wkTitle(wk)}” on your site now? Everyone who follows your blog will see it.`)) return;
      const ph = MD.wkPhoto;
      if (ph && !(ph.alt || '').trim()) { note('Describe the featured image first (for people who can’t see it).'); $('wkAlt')?.focus(); return; }
      document.querySelectorAll('[data-md="wk-draft"], [data-md="wk-publish"]').forEach(x => { x.disabled = true; });
      note(draft ? 'Saving the draft…' : 'Publishing…');
      invoke('site_note', { title: wkTitle(wk), text, link: '', linkTitle: '', photo: ph?.data || '', alt: ph?.alt || '', draft, linkImage: '', linkSite: '', category: 'weeknotes', featuredOnly: true })
        .then(r => {
          if (draft) { w.drafted = Date.now(); status(`Saved your Weeknotes as a draft post in Weeknotes on your site. Finish and publish it in ${siteApp()}.`); }
          else { w.published = Date.now(); w.pubUrl = r?.url || ''; MD.wkPhoto = null; status('Your Weeknotes are on your site.'); }
          savePrefs(); note(''); mdRender();
        })
        .catch(err => { note(msg(err)); document.querySelectorAll('[data-md="wk-draft"], [data-md="wk-publish"]').forEach(x => { x.disabled = false; }); });
      return;
    }
    if (k === 'finish') {
      w.done = Date.now(); w.snap = Object.fromEntries(cmp().goals.map(g => [g.id, goalProgress(g, wk.days).n]).filter(([, v]) => v != null));
      savePrefs(); MD.mode = null; MD.step = 0; status('Week reviewed. Have a good one.'); mdRender(); $('listView').scrollTo({ top: 0 }); $('main').scrollTo({ top: 0 });
    }
  });
  document.addEventListener('submit', e => { if (e.target.closest('[data-md="capform"]')) { e.preventDefault(); mdCapture(); } });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-md]'); if (!el || !el.closest('.myday')) return;
    const k = el.dataset.md;
    if (k === 'when') {
      MD.whenEdited = true;
      const dur = Number($('mdWhenDur')?.value || MD.when?.dur || 60);
      MD.allDay = dur >= 480;
      MD.when = { ...(MD.when || {}), found: true, title: MD.when?.found ? MD.when.title : (MD.cap || '').trim(), date: $('mdWhenDate')?.value || '', time: $('mdWhenTime')?.value || '', dur };
      if (el.id === 'mdWhenDur') { MD.cap = $('mdCapIn')?.value || MD.cap; mdRender(); }
      return;
    }
    if (k === 'wk-photo-in') {
      const file = el.files?.[0]; if (!file) return;
      shrinkPhoto(file).then(data => { MD.wkPhoto = { data, alt: '' }; mdRender(); setTimeout(() => $('wkAlt')?.focus(), 50); })
        .catch(() => status('That picture couldn’t be read. Try a JPEG or PNG.', true));
      el.value = ''; return;
    }
    const w = mdWk();
    if (k === 'pick') { if (el.checked) w.reads[el.dataset.id] = w.reads[el.dataset.id] || ''; else delete w.reads[el.dataset.id]; savePrefs(); mdRender(); return; }
    if (k === 'share') { w.share[el.dataset.k] = el.checked; savePrefs(); mdRender(); return; }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'mdCapIn') {
      const el = e.target;
      MD.cap = el.value;
      if (!MD.whenEdited && (MD.capTo === 'task' || MD.capTo === 'event')) { MD.when = mdParseWhen(el.value); const box = $('mdWhen'); if (box) box.outerHTML = whenHtml(); }
      return;
    }
    const el = e.target.closest('[data-md]'); if (!el || !el.closest('.myday')) return;
    const k = el.dataset.md;
    const w = mdWk();
    if (k === 'wk-alt') { if (MD.wkPhoto) MD.wkPhoto.alt = el.value; return; }
    if (k === 'wk') { w[el.dataset.k] = el.value; mdSaveSoon(); return; }
    if (k === 'why') { if (el.dataset.id in w.reads) { w.reads[el.dataset.id] = el.value; mdSaveSoon(); } return; }
    if (k === 'step-in') { w.steps[el.dataset.id] = el.value; mdSaveSoon(); }
  });
  $('listView')?.addEventListener('focusout', () => { if (S.view === 'myday') setTimeout(() => { if (!mdTyping() && MD.stale) { MD.stale = false; mdRender(); } }, 0); });

  // ---- setting your goals, your why and your rituals
  function openCompass() {
    const c = cmp();
    let goals = c.goals.map(g => ({ ...g }));
    const kinds = [['', 'Just the goal'], ['count', 'Count toward a number'], ['habit', 'Days a week'], ['books', 'Books finished this year']];
    const row = (g, i) => `<div class="cm-goal" data-i="${i}">
        <input class="n-field cm-acct" type="text" list="cmAccts" maxlength="24" value="${esc(g.acct || '')}" placeholder="Part of life" aria-label="Part of life, like Physical">
        <input class="n-field cm-title" type="text" maxlength="80" value="${esc(g.title || '')}" placeholder="The goal, like Read 12 books" aria-label="Goal">
        <select class="cm-kind" aria-label="How it’s counted">${kinds.map(([k, l]) => `<option value="${k}"${(g.kind || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input class="n-field cm-target" type="number" min="1" max="10000" value="${esc(g.target || '')}" placeholder="Target" aria-label="Target"${['count', 'habit', 'books'].includes(g.kind) ? '' : ' hidden'}>
        <input class="n-field cm-done" type="number" min="0" max="100000" value="${esc(g.done || 0)}" aria-label="Done so far"${g.kind === 'count' ? '' : ' hidden'}>
        <button class="icon cm-x" type="button" data-cm="del" aria-label="Remove this goal" title="Remove">×</button></div>`;
    const el = sheet('compassPanel', `<h2>Goals and rituals</h2>
      <p>A few goals for this season, each under a part of your life, and why they matter. The Weekly Preview looks at them every week, and they end your Day One page. They stay in the app and in your iCloud; nothing here goes on your site.</p>
      <datalist id="cmAccts">${MD_ACCTS.map(a => `<option value="${a}">`).join('')}</datalist>
      <div class="row"><input class="n-field" id="cmSeason" type="text" maxlength="40" value="${esc(c.season)}" placeholder="This season (or Q4, or 2027)" style="flex:1"></div>
      <h3 class="mk-h">Goals</h3>
      <div id="cmGoals"></div>
      <p><button class="btn" type="button" data-cm="add">Add a goal</button> <small class="note">Up to six. “Books finished this year” counts the books you finish in Books.</small></p>
      <h3 class="mk-h">Why it matters</h3>
      <textarea id="cmWhy" rows="2" maxlength="300" placeholder="One line you want to read every day">${esc(c.why)}</textarea>
      <h3 class="mk-h">Rituals</h3>
      <p class="note">A few small things you do every morning and evening, one per line. You tick them off on My Day.</p>
      <div class="cm-rits"><label><span>Morning</span><textarea id="cmRm" rows="4" placeholder="10-minute routine&#10;Look at today’s calendar">${esc(c.rituals.m.join('\n'))}</textarea></label>
        <label><span>Evening</span><textarea id="cmRe" rows="4" placeholder="Clear the inbox&#10;Look at tomorrow’s calendar">${esc(c.rituals.e.join('\n'))}</textarea></label></div>
      <p class="note">Opening on My Day in the morning is in <button class="b-link" type="button" data-cm="hub">My Day settings</button>.</p>
      <div class="row sheet-foot"><button class="btn" type="button" id="cmCancel">Cancel</button><button class="btn primary" type="button" id="cmSave">Save</button></div>`, 'Goals and rituals');
    const paint = () => { $('cmGoals').innerHTML = goals.length ? goals.map(row).join('') : '<p class="note">No goals yet.</p>'; };
    const read = () => {
      goals = [...el.querySelectorAll('.cm-goal')].map(r => {
        const g = goals[Number(r.dataset.i)] || {};
        return { id: g.id || Math.random().toString(36).slice(2, 9), acct: r.querySelector('.cm-acct').value.trim(), title: r.querySelector('.cm-title').value.trim(), kind: r.querySelector('.cm-kind').value, target: Number(r.querySelector('.cm-target').value) || '', done: Number(r.querySelector('.cm-done').value) || 0 };
      });
    };
    paint();
    el.onclick = e => {
      const a = e.target.closest('[data-cm]');
      if (a?.dataset.cm === 'add') { read(); if (goals.length < 6) goals.push({ id: Math.random().toString(36).slice(2, 9), acct: '', title: '', kind: '' }); paint(); el.querySelector('.cm-goal:last-child .cm-acct')?.focus(); }
      if (a?.dataset.cm === 'hub') { el.hidden = true; openMydaySettings(); return; }
      if (a?.dataset.cm === 'del') { read(); goals.splice(Number(a.closest('.cm-goal').dataset.i), 1); paint(); }
    };
    el.onchange = e => { if (e.target.classList.contains('cm-kind')) { read(); paint(); } };
    $('cmCancel').onclick = () => { el.hidden = true; };
    $('cmSave').onclick = () => {
      read();
      const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
      S.prefs.compass = { season: $('cmSeason').value.trim(), why: $('cmWhy').value.trim(), goals: goals.filter(g => g.title).slice(0, 6).map(g => ({ ...g, target: g.kind === 'books' && !g.target ? (goalCfg().books || 12) : g.target })), rituals: { m: lines('cmRm'), e: lines('cmRe') } };
      savePrefs(); el.hidden = true; if (S.view === 'myday') mdRender();
      status('Your goals and rituals are saved.');
    };
  }
  $('mydayBtn')?.addEventListener('click', () => { closeSettings(); openMydaySettings(); });
  // ---- My Day settings: one place for everything about My Day (David, Nov 22: "there is no way to know that there
  // are additional settings to adjust"). Reached from My Day's own "My Day settings" link, from the morning note,
  // and from Settings › Experimental › My Day.
  function openMydaySettings() {
    const u = mdUntil();
    const el = sheet('mydaySetPanel', `<h2>My Day settings</h2>
      <p>My Day is the page for your day: what’s coming up, your to-dos, goals and rituals, and the markets.</p>
      <h3 class="mk-h">Starting the day</h3>
      <label class="c-net"><input type="checkbox" id="mhMorning"${mdMorningStart() ? ' checked' : ''}>Open on My Day in the morning</label>
      <label class="mh-until">Until <select id="mhUntil" class="n-field"${mdMorningStart() ? '' : ' disabled'}>${[9, 10, 11, 12].map(h => `<option value="${h}"${h === u ? ' selected' : ''}>${mdHourName(h)}</option>`).join('')}</select></label>
      <p class="note">Open the app before then and it starts on My Day. Later in the day it starts on Today, as usual.</p>
      <h3 class="mk-h">What’s on My Day</h3>
      <ul class="set-list">
        <li><button class="set-item" type="button" data-mh="compass">Goals and rituals</button><span>Your goals for this season, why they matter, and your morning and evening rituals</span></li>
        <li><button class="set-item" type="button" data-mh="day">Calendar, reminders and Day One</button><span>Events and reminders from this device, which reminders list, Day One and your journal questions</span></li>
        <li><button class="set-item" type="button" data-mh="markets">Markets</button><span>The stocks and coins you follow</span></li>
      </ul>
      <p class="note">Don’t need My Day? Turn it off in Settings › Show in the sidebar. Nothing is deleted. <button class="b-link" type="button" data-mh="settings">Open Settings</button></p>
      <div class="row sheet-foot"><button class="btn primary" type="button" id="mhDone">Done</button></div>`, 'My Day settings');
    const save = () => { S.prefs.mydayMorning = $('mhMorning').checked; S.prefs.mydayUntil = Number($('mhUntil').value) || 10; $('mhUntil').disabled = !$('mhMorning').checked; savePrefs(); if (S.view === 'myday') mdRender(); };
    el.onchange = save;
    el.onclick = e => {
      const b = e.target.closest('[data-mh]'); if (!b) return;
      el.hidden = true;
      if (b.dataset.mh === 'compass') openCompass();
      if (b.dataset.mh === 'day') openDaySettings();
      if (b.dataset.mh === 'markets') openMarkets();
      if (b.dataset.mh === 'settings') $('settingsBtn').click();
    };
    $('mhDone').onclick = () => { save(); el.hidden = true; MD.auto = false; if (S.view === 'myday') mdRender(); };
    $('mhDone').focus({ preventScroll: true });
  }

  // ---- starting the day on My Day (before 10 am; the setting turns it off)
  let mdHiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { mdHiddenAt = Date.now(); return; }
    if (mdHiddenAt && Date.now() - mdHiddenAt > 3 * 3600e3 && new Date().getHours() < mdUntil() && mdMorningStart() && myDayOn() && S.view === 'today' && !S.readerId) { MD.auto = true; selectView('myday'); }
    if (S.view === 'myday') mdRender();
  });
  setInterval(() => { if (S.view === 'myday' && !document.hidden && !MD.mode) renderList(); }, 10 * 60 * 1000);

  // ------------------------------------------------------------ Trending in your neighborhood
  // What several of the people and blogs you follow wrote about this week: the same names, hashtags, topics or
  // links turning up in posts from different writers, more than usual for them. Worked out here on the device
  // from the stories you already have; nothing is sent anywhere, and nothing is ranked by clicks.
  const TR_STOP = new Set(('a an and are as at be been but by can could did do does for from had has have he her here his how i if in into is it its '
    + 'just like me more most my new no not now of on one or our out over so some than that the their them then there these they this those to '
    + 'too up us very was we well were what when where which who why will with would you your yours about after again all also any because before '
    + 'being both each few first get got just last let made make many much never next only other own same see should since still such take '
    + 'thing things think through time today two way week weekly year years day days back best big good great little long really right '
    + 'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december '
    + 'mr mrs ms dr st part read reading post posts blog blogs note notes link links newsletter episode issue update updates thoughts '
    + 'world people life work home new news video videos photo photos podcast show here’s it’s i’m i’ve don’t can’t that’s what’s there’s let’s '
    + 'yes oh ok okay hello hi thanks thank via re fwd').split(/\s+/));
  let TRX = null;
  function trendTopics() {
    if (TRX && TRX.n === S.items.length && TRX.f === S.feeds.length && Date.now() - TRX.at < 15 * 60e3) return TRX.list;
    const now = Date.now(), WEEK = 7 * DAY;
    const writerOf = i => personId(i.feed_id);
    const recent = [], older = [];
    for (const i of S.items) {
      if (isEmailItem(i) || isJobItem(i) || isOwn(i.feed_id) || isMuted(i) || (videosOn() && isVideoItem(i))) continue;
      const age = now - Date.parse(i.date);
      if (age < 0 || !Number.isFinite(age)) continue;
      if (age < WEEK) recent.push(i); else if (age < 5 * WEEK) older.push(i);
    }
    const norm = t => t.toLowerCase().replace(/[’']s$/, '').replace(/[^\p{L}\p{N}#+ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const okWord = w => w.length > 2 && !TR_STOP.has(w) && !/^\d+$/.test(w);
    // A story's subjects: its own topic tags, #hashtags, Names Like This in its words, and the outside pages it links to
    function subjects(i) {
      const out = new Map();
      const add = (key, label, kind) => { if (!out.has(key)) out.set(key, { label, kind }); };
      for (const t of tagsOf(i)) { const k = norm(t); if (k && k.split(' ').every(okWord) && k.length <= 40) add('t:' + k, t.trim(), 'topic'); }
      const title = i.title || '', words = title.split(/\s+/).filter(Boolean);
      const titleCase = words.length > 3 && words.filter(w => /^[A-Z]/.test(w)).length / words.length > 0.6;
      const text = `${titleCase ? '' : title}. ${(i.summary || '').slice(0, 700)}`;
      for (const m of text.matchAll(/(?:^|\s)#([\p{L}][\p{L}\p{N}_-]{2,30})/gu)) add('t:' + m[1].toLowerCase(), '#' + m[1], 'topic');
      // Names: one to three Capitalized Words in a row, not at the start of a sentence (or longer than one word)
      for (const m of text.matchAll(/(^|[.!?:;"“]\s+|\s)((?:[A-Z][\p{L}\p{N}’'&-]+)(?:\s+(?:[A-Z][\p{L}\p{N}’'&-]+|of|de|and)){0,3})/gu)) {
        const lead = m[1], name = m[2].replace(/\s+(of|de|and)$/, '').replace(/[’']s$/, '');
        const parts = name.split(/\s+/);
        if (parts.length === 1 && /[.!?:;"“]/.test(lead)) continue; // a capital that only starts a sentence
        const k = norm(name);
        if (!k || !k.split(' ').some(okWord) || TR_STOP.has(k) || k.length < 3) continue;
        add('n:' + k, name, 'name');
      }
      for (const l of (i.links || '').split(' ')) {
        if (!isWeb(l)) continue;
        const h = bareHost(hostOfU(l)), path = normU(l).slice(h.length);
        if (!h || path.length < 4 || /\.(social|bsky)|youtube|youtu\.be|twitter|x\.com|instagram|facebook|wikipedia/.test(h)) continue;
        add('l:' + normU(l), l, 'link');
      }
      return out;
    }
    const count = (list, keep) => {
      const m = new Map();
      for (const i of list) for (const [k, v] of subjects(i)) {
        if (!m.has(k)) m.set(k, { key: k, ...v, writers: new Set(), items: [] });
        const x = m.get(k); x.writers.add(writerOf(i)); if (keep) x.items.push(i);
      }
      return m;
    };
    const now7 = count(recent, true), before = count(older, false);
    const people = new Set(recent.map(writerOf)).size;
    const need = people < 25 ? 2 : 3;
    let list = [...now7.values()].filter(x => {
      if (x.writers.size < need) return false;
      const usual = (before.get(x.key)?.writers.size || 0) / 4; // writers in an ordinary week, over the four before
      x.score = x.writers.size - usual * 1.5 + (x.kind === 'link' ? 0.5 : 0);
      return x.writers.size >= usual * 2 + 1 && x.score >= need - 0.5;
    }).sort((a, b) => b.score - a.score || b.items.length - a.items.length);
    // Keep the clearest of overlapping subjects ("Vision Pro" over "Vision" when the same people wrote both)
    const out = [];
    for (const x of list) {
      const lx = x.label.toLowerCase();
      if (out.some(y => { const ly = y.label.toLowerCase(); return (ly.includes(lx) || lx.includes(ly)) && [...x.writers].filter(w => y.writers.has(w)).length >= x.writers.size - 1; })) continue;
      out.push(x);
      if (out.length >= 5) break;
    }
    for (const x of out) {
      const one = new Map();
      for (const i of x.items.sort((a, b) => b.date.localeCompare(a.date))) if (!one.has(writerOf(i))) one.set(writerOf(i), i);
      x.items = [...one.values()];
      if (x.kind === 'link') { const page = S.items.find(i => normU(i.link) === x.key.slice(2)); x.label = page ? headline(page) : `${bareHost(hostOfU(x.label))}${new URL(x.label).pathname.replace(/\/$/, '').slice(0, 40)}`; x.url = x.key.slice(2); }
    }
    TRX = { n: S.items.length, f: S.feeds.length, at: Date.now(), list: out };
    return out;
  }
  function trendHtml() {
    const list = trendTopics(); if (!list.length) return '';
    // Just one topic: a single line, no section
    if (list.length === 1) { const t = list[0]; return `<div class="b-trend one"><span class="b-sub">Trending</span><button class="tr-chip" type="button" data-trend="0"><span class="tr-faces" aria-hidden="true">${t.items.slice(0, 3).map(i => nbFace(nbWho(i), 'nb-av sm')).join('')}</span><span class="tr-t">${t.kind === 'link' ? '🔗 ' : ''}${esc(t.label)}</span><span class="tr-n">${t.writers.size} people</span></button><button class="nb-tag" type="button" data-talk="cue" data-cue="trend" title="${esc(CUES.trend)}" aria-label="What is this?">?</button></div>`; }
    return `<div class="b-trend"><h3 class="b-sub">Trending in your neighborhood <button class="nb-tag" type="button" data-talk="cue" data-cue="trend" title="${esc(CUES.trend)}" aria-label="What is this?">?</button></h3>
      <div class="tr-row">${list.map((t, n) => `<button class="tr-chip" type="button" data-trend="${n}"><span class="tr-faces" aria-hidden="true">${t.items.slice(0, 3).map(i => nbFace(nbWho(i), 'nb-av sm')).join('')}</span>
        <span class="tr-t">${t.kind === 'link' ? '🔗 ' : ''}${esc(t.label)}</span><span class="tr-n">${t.writers.size} people</span></button>`).join('')}</div></div>`;
  }
  function openTrend(n) {
    const t = TRX?.list?.[n]; if (!t) return;
    const el = sheet('trendPanel', `<h2>${esc(t.label)}</h2>
      <p>${t.writers.size} people you read wrote about this in the last week${t.kind === 'link' ? ', all linking to the same page' : ''}. Their posts, side by side:</p>
      <div class="tr-posts">${t.items.map(i => `<button class="tr-post" type="button" data-open="${esc(i.id)}">
        <span class="tr-who">${nbFace(nbWho(i), 'nb-av sm')}<b>${nbName(i)}</b><time>${esc(fmtWhen(i.date))}</time></span>
        <span class="tr-title">${esc(headline(i))}</span>${i.summary ? `<span class="tr-sum">${esc(i.summary.slice(0, 220))}${i.summary.length > 220 ? '…' : ''}</span>` : ''}</button>`).join('')}</div>
      ${t.url ? `<p><button class="btn" type="button" data-talk="open" data-url="${esc('https://' + t.url)}">Open the page they link to</button></p>` : ''}
      <div class="row sheet-foot"><button class="btn primary" type="button" id="trDone">Done</button></div>`, t.label);
    el.onclick = e => { if (e.target.id === 'trDone' || e.target.closest('[data-open], [data-talk]')) el.hidden = true; };
  }
  document.addEventListener('click', e => { const t = e.target.closest('[data-trend]'); if (t) openTrend(Number(t.dataset.trend)); });


  // ------------------------------------------------------------ Your year in reading
  // Counted from the day this arrived: each story you open, per device (so Mac and iPhone add up when prefs sync).
  let statsTimer = 0;
  // Apple's own rating prompt, asked for at a quiet moment (closing a story) once someone clearly uses the app:
  // 25 stories opened on this device over at least four days, at most once per version and 120 days apart.
  // Apple decides whether it actually shows (three times a year at most, never in TestFlight).
  function maybeAskReview() {
    const opens = Number(store.get('rvOpens')) || 0, first = Number(store.get('rvFirst')) || 0, last = Number(store.get('rvAsked')) || 0;
    if (!APP.version || opens < 25 || !first || Date.now() - first < 4 * DAY) return;
    if (store.get('rvVersion') === APP.version || (last && Date.now() - last < 120 * DAY)) return;
    store.set('rvVersion', APP.version); store.set('rvAsked', String(Date.now()));
    setTimeout(() => invoke('request_review').catch(() => {}), 800);
  }
  function countOpen(it) {
    const f = feedById(it.feed_id); if (!f || isJobItem(it)) return;
    store.set('rvOpens', String((Number(store.get('rvOpens')) || 0) + 1)); if (!store.get('rvFirst')) store.set('rvFirst', String(Date.now()));
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
