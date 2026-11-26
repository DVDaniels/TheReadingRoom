//! The Reading Room — app wiring: window, menus, background refresh and the commands the page calls.

mod article;
mod audiobooks;
mod bookmark;
mod db;
mod discover;
mod feeds;
mod lists;
mod opml;
mod reply;
mod social;
mod tumblr;
mod ychannel;
mod micropub;
mod sources;
mod sync;
mod topics;
mod watch;
mod share;
mod email;
mod webmention;
mod review;
mod youtube;
mod offline;
mod daybook;

use futures::stream::{self, StreamExt};
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
#[cfg(mobile)]
use tauri_plugin_icloud_folder::FolderExt;

const REFRESH_EVERY: Duration = Duration::from_secs(30 * 60);
const ITEM_LIMIT: i64 = 2000;

pub struct AppState {
    db: Mutex<Connection>,
    refreshing: AtomicBool,
    finding_images: AtomicBool,
    discovering: AtomicBool,
    client: reqwest::Client,
    sync: Mutex<SyncInfo>,
    sync_now: tokio::sync::Notify,
}

#[derive(Default)]
struct SyncInfo {
    last_sync: Option<String>,
    error: Option<String>,
    peers: Vec<(String, String)>, // name, last written
    last_written: Option<sync::SyncFile>,
}

const SYNC_EVERY: Duration = Duration::from_secs(30);

type Shared = Arc<AppState>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    folders: Vec<db::Folder>,
    feeds: Vec<db::Feed>,
    items: Vec<db::Item>,
    highlights: Vec<db::Highlight>,
    mutes: Vec<String>,
    prefs: serde_json::Value,
    lists: Vec<lists::ListView>,
    refreshing: bool,
    last_refresh: Option<String>,
}

#[derive(Serialize)]
struct Added {
    id: i64,
    title: String,
}

/// Something you changed should reach your other devices: sync now instead of waiting for the next round.
/// (iPhone and iPad pause the app soon after you leave it, so waiting 30 seconds can mean never.)
fn changed(state: &Shared) {
    state.sync_now.notify_one();
}

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("Something went wrong saving your reader ({e}).")
}

// ------------------------------------------------------------------ refresh

async fn refresh_feeds(app: AppHandle, only: Option<Vec<i64>>) {
    let st: Shared = app.state::<Shared>().inner().clone();
    if st.refreshing.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    let _ = app.emit("state-changed", ());

    // Followed lists first, so feeds that just joined one are fetched in this same round.
    if only.is_none() {
        let due = lists::due(&st.db.lock().unwrap()).unwrap_or_default();
        for (title, r) in check_lists(&st, due).await {
            if let Ok(a) = r {
                if !a.new_ids.is_empty() || a.pending > 0 || a.left > 0 {
                    let _ = app.emit("list-news", serde_json::json!({ "title": title, "added": a.new_ids.len(), "pending": a.pending, "left": a.left }));
                }
            }
        }
    }

    let list = {
        let conn = st.db.lock().unwrap();
        match &only {
            Some(ids) => db::feeds_by_ids(&conn, ids),
            None => db::feeds(&conn),
        }
        .unwrap_or_default()
    };

    let results: Vec<_> = stream::iter(list)
        .map(|feed| {
            let client = st.client.clone();
            async move {
                let r = feeds::fetch_patient(&client, &feed.url).await;
                (feed, r)
            }
        })
        .buffer_unordered(6)
        .collect()
        .await;

    let now = feeds::now_iso();
    {
        let mut conn = st.db.lock().unwrap();
        for (feed, r) in results {
            match r {
                Ok(mut f) => {
                    if watch::is_watch(&feed.url) {
                        watch::finalize(&conn, &feed.title, &mut f);
                    }
                    let items = feeds::to_new_items(feed.id, &f.items);
                    if let Err(e) = db::store_fetch(&mut conn, &feed, &f.title, &f.site, &items, &now) {
                        let _ = db::feed_error(&conn, feed.id, &err(e), &now);
                    }
                }
                Err(msg) => {
                    let _ = db::feed_error(&conn, feed.id, &msg, &now);
                }
            }
        }
        let _ = db::set_meta(&conn, "last_refresh", &now);
    }
    st.refreshing.store(false, Ordering::SeqCst);
    st.sync_now.notify_one(); // newly downloaded stories may have marks from another Mac
    update_badge(&app);
    let _ = app.emit("state-changed", ());
    tauri::async_runtime::spawn(find_images(app.clone()));
}

// ------------------------------------------------------------------ followed lists (dynamic OPML)

/// Download a list of feeds: its name (if it gives one) and the feeds in it.
async fn fetch_list(client: &reqwest::Client, url: &str) -> Result<(Option<String>, Vec<opml::Outline>), String> {
    let (body, _, _) = feeds::get(client, url).await?;
    let text = String::from_utf8_lossy(&body).to_string();
    let outlines = opml::parse(&text).map_err(|_| "That address isn't a list of feeds (an OPML file). Check the link with whoever shares the list.".to_string())?;
    if outlines.is_empty() {
        return Err("That list doesn't have any feeds in it yet.".into());
    }
    Ok((opml::title(&text), outlines))
}

/// Check some followed lists and bring this device up to date with each.
async fn check_lists(st: &Shared, urls: Vec<String>) -> Vec<(String, Result<lists::Applied, String>)> {
    if urls.is_empty() {
        return vec![];
    }
    let fetched: Vec<_> = stream::iter(urls)
        .map(|u| {
            let client = st.client.clone();
            async move {
                let r = fetch_list(&client, &u).await;
                (u, r)
            }
        })
        .buffer_unordered(3)
        .collect()
        .await;
    let now = feeds::now_iso();
    let mut out = Vec::new();
    let mut touched = false;
    {
        let conn = st.db.lock().unwrap();
        let subs = lists::subs(&conn).unwrap_or_default();
        for (u, r) in fetched {
            let title = subs.iter().find(|s| s.url == u).map(|s| s.title.clone()).unwrap_or_else(|| u.clone());
            let r = match r {
                Ok((_, outlines)) => lists::apply(&conn, &u, &outlines, false, &now).map_err(err),
                Err(m) => {
                    let _ = lists::failed(&conn, &u, &m, &now);
                    Err(m)
                }
            };
            if let Ok(a) = &r {
                touched |= !a.new_ids.is_empty();
            }
            out.push((title, r));
        }
    }
    if touched {
        changed(st);
    }
    out
}

fn list_url(url: &str) -> Result<String, String> {
    let mut u = url.trim().to_string();
    if u.is_empty() {
        return Err("Paste the address of the list first.".into());
    }
    if !u.contains("://") {
        u = format!("https://{u}");
    }
    match url::Url::parse(&u) {
        Ok(p) if (p.scheme() == "https" || p.scheme() == "http") && p.host_str().is_some() => Ok(u),
        _ => Err("That doesn't look like a web address.".into()),
    }
}

/// Follow a list of feeds by its address. Everything in it is followed now; feeds that join later follow on their own.
#[tauri::command]
async fn follow_list(app: AppHandle, state: State<'_, Shared>, url: String) -> Result<serde_json::Value, String> {
    let url = list_url(&url)?;
    if lists::subs(&state.db.lock().unwrap()).map_err(err)?.iter().any(|s| s.url == url) {
        return Err("You already follow this list.".into());
    }
    let (title, outlines) = fetch_list(&state.client, &url).await?;
    let title = title.unwrap_or_else(|| url::Url::parse(&url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_else(|| "Followed list".into()));
    let now = feeds::now_iso();
    let (applied, name, folder_id) = {
        let conn = state.db.lock().unwrap();
        if !lists::subscribe(&conn, &url, &title).map_err(err)? {
            return Err("You already follow this list.".into());
        }
        let a = lists::apply(&conn, &url, &outlines, true, &now).map_err(err)?;
        let v = lists::views(&conn).map_err(err)?.into_iter().find(|v| v.url == url);
        (a, v.as_ref().map(|v| v.title.clone()).unwrap_or(title), v.and_then(|v| v.folder_id))
    };
    changed(state.inner());
    if !applied.new_ids.is_empty() {
        tauri::async_runtime::spawn(refresh_feeds(app, Some(applied.new_ids.clone())));
    }
    Ok(serde_json::json!({
        "title": name,
        "folderId": folder_id,
        "added": applied.new_ids.len(),
        "total": outlines.len().min(lists::MAX_FEEDS),
    }))
}

/// Check one list right away.
#[tauri::command]
async fn list_check(app: AppHandle, state: State<'_, Shared>, url: String) -> Result<serde_json::Value, String> {
    let (_, r) = check_lists(state.inner(), vec![url]).await.pop().ok_or("You don't follow that list any more.")?;
    let a = r?;
    if !a.new_ids.is_empty() {
        tauri::async_runtime::spawn(refresh_feeds(app, Some(a.new_ids.clone())));
    }
    Ok(serde_json::json!({ "added": a.new_ids.len(), "pending": a.pending, "left": a.left }))
}

#[tauri::command]
fn list_set_auto(state: State<'_, Shared>, url: String, on: bool) -> Result<(), String> {
    lists::set_auto(&state.db.lock().unwrap(), &url, on).map_err(err)?;
    changed(state.inner());
    Ok(())
}

/// Keep following a feed that left a list.
#[tauri::command]
fn list_keep(state: State<'_, Shared>, url: String, feed_url: String) -> Result<(), String> {
    lists::keep(&state.db.lock().unwrap(), &url, &feed_url).map_err(err)
}

/// Follow (or let go of) the new feeds waiting in a list.
#[tauri::command]
fn list_pending(app: AppHandle, state: State<'_, Shared>, url: String, follow: bool) -> Result<usize, String> {
    let ids = lists::take_pending(&state.db.lock().unwrap(), &url, follow).map_err(err)?;
    if !ids.is_empty() {
        changed(state.inner());
        tauri::async_runtime::spawn(refresh_feeds(app, Some(ids.clone())));
    }
    Ok(ids.len())
}

/// Stop following a list, keeping its feeds or unfollowing them too.
#[tauri::command]
fn list_unfollow(app: AppHandle, state: State<'_, Shared>, url: String, remove_feeds: bool) -> Result<usize, String> {
    let n = lists::unsubscribe(&state.db.lock().unwrap(), &url, remove_feeds).map_err(err)?;
    changed(state.inner());
    update_badge(&app);
    Ok(n)
}

/// Stories that came without a picture: look for the one their web page offers for sharing.
/// A few at a time in the background, newest first; each page is only checked once.
async fn find_images(app: AppHandle) {
    let st: Shared = app.state::<Shared>().inner().clone();
    if st.finding_images.swap(true, Ordering::SeqCst) {
        return;
    }
    for _round in 0..10 {
        let todo = db::items_needing_image(&st.db.lock().unwrap(), 24).unwrap_or_default();
        if todo.is_empty() {
            break;
        }
        let found: Vec<(String, String)> = stream::iter(todo)
            .map(|(id, link)| {
                let client = st.client.clone();
                async move { (id, feeds::page_image(&client, &link).await.unwrap_or_default()) }
            })
            .buffer_unordered(4)
            .collect()
            .await;
        let any = found.iter().any(|(_, img)| !img.is_empty());
        {
            let conn = st.db.lock().unwrap();
            for (id, img) in &found {
                let _ = db::set_page_image(&conn, id, img);
            }
        }
        if any {
            let _ = app.emit("state-changed", ());
        }
    }
    st.finding_images.store(false, Ordering::SeqCst);
}

/// The Dock icon's number is set by the page, which counts exactly what Today shows (the last day's unread
/// stories, without muted words, job ads or copies folded into their originals). Nothing to do here.
fn update_badge(_app: &AppHandle) {}

/// The Today unread count on the app icon: the Dock on a Mac, the Home Screen on iPhone and iPad.
#[tauri::command]
fn set_badge(app: AppHandle, n: i64) {
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if n > 0 { Some(n) } else { None });
    }
    #[cfg(target_os = "ios")]
    {
        let _ = &app;
        ios_badge::set(n);
    }
    #[cfg(all(mobile, not(target_os = "ios")))]
    let _ = (app, n);
}

/// iPhone and iPad: a number on the icon needs the person's OK once (badges only: no alerts, no sounds).
/// iOS asks only the first time; after that the answer stands (it can be changed in Settings › Notifications).
#[cfg(target_os = "ios")]
mod ios_badge {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSError;
    use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};
    use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

    static ASKED: AtomicBool = AtomicBool::new(false);
    static ALLOWED: AtomicBool = AtomicBool::new(false);
    static LATEST: AtomicI64 = AtomicI64::new(0);

    fn apply(n: i64) {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center.setBadgeCount_withCompletionHandler(n.clamp(0, 99_999) as _, None);
    }

    pub fn set(n: i64) {
        LATEST.store(n, Ordering::SeqCst);
        if ALLOWED.load(Ordering::SeqCst) {
            apply(n);
            return;
        }
        if ASKED.swap(true, Ordering::SeqCst) {
            return; // the question is still open (or the answer was no)
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let done = RcBlock::new(|granted: Bool, _err: *mut NSError| {
            if granted.as_bool() {
                ALLOWED.store(true, Ordering::SeqCst);
                apply(LATEST.load(Ordering::SeqCst));
            }
        });
        center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Badge, &done);
    }
}

// ------------------------------------------------------------------ commands

#[tauri::command]
fn get_state(state: State<'_, Shared>) -> Result<Snapshot, String> {
    let conn = state.db.lock().unwrap();
    Ok(Snapshot {
        folders: db::folders(&conn).map_err(err)?,
        feeds: db::feeds(&conn).map_err(err)?,
        items: db::items(&conn, ITEM_LIMIT).map_err(err)?,
        highlights: db::highlights(&conn).map_err(err)?,
        mutes: db::get_meta(&conn, "mutes").map_err(err)?.and_then(|m| serde_json::from_str(&m).ok()).unwrap_or_default(),
        prefs: db::get_meta(&conn, "prefs").map_err(err)?.and_then(|m| serde_json::from_str(&m).ok()).unwrap_or_else(|| serde_json::json!({})),
        lists: lists::views(&conn).map_err(err)?,
        refreshing: state.refreshing.load(Ordering::SeqCst),
        last_refresh: db::get_meta(&conn, "last_refresh").map_err(err)?,
    })
}

#[tauri::command]
fn mark(app: AppHandle, state: State<'_, Shared>, ids: Vec<String>, read: Option<bool>, saved: Option<bool>) -> Result<(), String> {
    {
        let mut conn = state.db.lock().unwrap();
        db::mark(&mut conn, &ids, read, saved, &feeds::now_iso()).map_err(err)?;
    }
    changed(state.inner());
    update_badge(&app);
    Ok(())
}

#[tauri::command]
async fn add_feed(
    app: AppHandle,
    state: State<'_, Shared>,
    url: String,
    title: Option<String>,
    folder_id: Option<i64>,
) -> Result<Added, String> {
    let mut url = url.trim().to_string();
    if url.is_empty() {
        return Err("Paste a feed or website address first.".into());
    }
    // A single YouTube video: follow the channel that made it
    if let Some(id) = youtube::video_id(&url) {
        url = youtube::video_info(&state.client, &id)
            .await
            .map(|v| v.channel_url)
            .ok_or("Couldn't find the channel for that video. Paste the channel's address instead.")?;
    }
    // Words rather than an address: follow that search on Google News.
    let mut title = title;
    let looks_social = url.trim().starts_with('@');
    let mut tries = if let Some(query) = feeds::news_query(&url).filter(|_| !looks_social) {
        if title.as_deref().map_or(true, |t| t.trim().is_empty()) {
            title = Some(format!("Google News: {query}"));
        }
        url = feeds::google_news_url(&query);
        vec![url.clone()]
    } else {
        // Mastodon, Bluesky, YouTube, Apple Podcasts and Medium addresses become the feeds behind them
        let plan = sources::plan(&url);
        let mut tries = plan.tries;
        if let Some(id) = plan.podcast_id {
            tries.insert(0, sources::podcast_feed(&state.client, &id).await?);
        }
        tries
    };
    tries.dedup();
    let host = url::Url::parse(&tries[0])
        .ok()
        .and_then(|u| u.host_str().map(String::from))
        .ok_or("That doesn't look like a web address. Paste the full feed or site URL.")?;

    let mut first_err = None;
    let mut found = None;
    for t in &tries {
        match feeds::fetch_patient(&state.client, t).await {
            Ok(f) => {
                found = Some(f);
                break;
            }
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    let youtube = tries.iter().any(|t| t.contains("youtube.com/"));
    let fetched = found.ok_or_else(|| {
        if youtube { feeds::YOUTUBE_HICCUP.to_string() } else { first_err.unwrap_or_else(|| "Couldn't read that feed.".into()) }
    })?;
    let name = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .or_else(|| Some(fetched.title.clone()).filter(|t| !t.is_empty()))
        .unwrap_or(host);

    let now = feeds::now_iso();
    let id = {
        let mut conn = state.db.lock().unwrap();
        if db::url_exists(&conn, &fetched.url).map_err(err)? {
            return Err("You already follow this feed.".into());
        }
        let id = db::add_feed(&conn, &fetched.url, &name, &fetched.site, folder_id).map_err(err)?;
        let feed = db::feed(&conn, id).map_err(err)?.ok_or("The new feed went missing. Try again.")?;
        let items = feeds::to_new_items(id, &fetched.items);
        db::store_fetch(&mut conn, &feed, &fetched.title, &fetched.site, &items, &now).map_err(err)?;
        id
    };
    changed(state.inner());
    update_badge(&app);
    Ok(Added { id, title: name })
}

/// The topic circles a new person picks from on the first run: small groups of writers who link to each other.
/// The list lives on the app's site (readingroomapp.com/lists/circles.json) so it can change without a new build;
/// the interface carries a copy for when the site can't be reached.
#[tauri::command]
async fn circles(state: State<'_, Shared>) -> Result<serde_json::Value, String> {
    let r = state
        .client
        .get("https://readingroomapp.com/lists/circles.json")
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(err)?;
    if !r.status().is_success() {
        return Err(format!("The circles list answered with error {}.", r.status().as_u16()));
    }
    r.json::<serde_json::Value>().await.map_err(err)
}

/// Watch a page that has no feed: it joins your feeds, and each change to it becomes a story.
#[tauri::command]
async fn watch_page(app: AppHandle, state: State<'_, Shared>, url: String, title: Option<String>, folder_id: Option<i64>) -> Result<Added, String> {
    let wurl = watch::watch_url(&url)?;
    let mut fetched = watch::fetch(&state.client, &wurl).await?;
    let name = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| fetched.title.clone());
    let now = feeds::now_iso();
    let id = {
        let mut conn = state.db.lock().unwrap();
        if db::url_exists(&conn, &wurl).map_err(err)? {
            return Err("You're already watching this page.".into());
        }
        let id = db::add_feed(&conn, &wurl, &name, &fetched.site, folder_id).map_err(err)?;
        let feed = db::feed(&conn, id).map_err(err)?.ok_or("The new page went missing. Try again.")?;
        watch::finalize(&conn, &name, &mut fetched);
        let items = feeds::to_new_items(id, &fetched.items);
        db::store_fetch(&mut conn, &feed, &fetched.title, &fetched.site, &items, &now).map_err(err)?;
        id
    };
    changed(state.inner());
    update_badge(&app);
    Ok(Added { id, title: name })
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Newsletter {
    email: String,
    feed: String,
}

/// Newsletters in your reader: a private email address from Kill the Newsletter (free, open source).
/// Newsletters sent to it arrive as stories in a feed, which joins your feeds.
#[tauri::command]
async fn newsletter_address(state: State<'_, Shared>, title: String) -> Result<Newsletter, String> {
    let title: String = title.trim().chars().take(200).collect();
    let title = if title.is_empty() { "Newsletters".to_string() } else { title };
    let resp = state
        .client
        .post("https://kill-the-newsletter.com/feeds")
        .header("Accept", "application/json")
        .header("CSRF-Protection", "true")
        .form(&[("title", title.as_str())])
        .send()
        .await
        .map_err(|_| "Couldn't reach Kill the Newsletter. Check your connection and try again.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Kill the Newsletter answered with error {}. Try again in a little while.", resp.status().as_u16()));
    }
    let n: Newsletter = resp.json().await.map_err(|_| "Kill the Newsletter sent something unexpected. Try again in a little while.".to_string())?;
    if !n.email.contains('@') || !n.feed.starts_with("https://") {
        return Err("Kill the Newsletter sent something unexpected. Try again in a little while.".into());
    }
    Ok(n)
}

// ---- Email: one mailbox of your own, read in the Email tab (see email.rs)

// Each device keeps its own mailbox, in its own Keychain (not iCloud Keychain): Proton through Bridge
// only works on the Mac, and disconnecting one device shouldn't sign out the others.
const EMAIL_KEY: &str = "email-device";
// Builds 87–1095 kept one shared sign-in in iCloud Keychain under this name
const EMAIL_SHARED_KEY: &str = "email";

fn email_account_saved() -> Option<email::Account> {
    if let Some(a) = social::local_get(EMAIL_KEY).and_then(|s| serde_json::from_str(&s).ok()) {
        return Some(a);
    }
    // First time on this version: take the shared sign-in, if there is one, for this device
    let a: email::Account = social::secret_get(EMAIL_SHARED_KEY).and_then(|v| serde_json::from_value(v).ok())?;
    let _ = social::local_set(EMAIL_KEY, &serde_json::to_string(&a).ok()?);
    Some(a)
}

fn email_account_store(a: &email::Account) -> Result<(), String> {
    social::local_set(EMAIL_KEY, &serde_json::to_string(a).map_err(err)?).map_err(|e| format!("Couldn't save the sign-in to the Keychain ({e})."))
}

fn email_table(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS email_meta (
            link TEXT PRIMARY KEY, uid TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '',
            from_addr TEXT NOT NULL DEFAULT '', reply_to TEXT NOT NULL DEFAULT '', message_id TEXT NOT NULL DEFAULT '',
            refs TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '');
         CREATE INDEX IF NOT EXISTS email_meta_uid ON email_meta(uid);
         CREATE TABLE IF NOT EXISTS email_parsed (uid TEXT PRIMARY KEY, v INTEGER NOT NULL);",
    )?;
    // added later: who else it went to, newsletter or person, where to unsubscribe, the conversation
    for col in ["to_addrs TEXT NOT NULL DEFAULT ''", "cc_addrs TEXT NOT NULL DEFAULT ''", "bulk INTEGER NOT NULL DEFAULT 0", "unsub TEXT NOT NULL DEFAULT ''", "unsub_post INTEGER NOT NULL DEFAULT 0", "thread TEXT NOT NULL DEFAULT ''", "folder TEXT NOT NULL DEFAULT 'inbox'"] {
        let name = col.split(' ').next().unwrap_or("");
        let has: bool = conn.prepare(&format!("SELECT {name} FROM email_meta LIMIT 0")).is_ok();
        if !has {
            conn.execute_batch(&format!("ALTER TABLE email_meta ADD COLUMN {col};"))?;
        }
    }
    Ok(())
}
/// How the app reads an email: raise it when that improves, and the emails still in the inbox are read again
/// (keeping read marks). 2: every part, pictures sent in the email, attached files listed, newsletter previews.
/// 3: newsletters told apart, unsubscribe, conversations, who else it went to, attached files that open.
const EMAIL_PARSE: i64 = 3;

fn email_feed(conn: &rusqlite::Connection) -> Result<db::Feed, String> {
    let id = match db::feeds(conn).map_err(err)?.into_iter().find(|f| f.url == email::FEED) {
        Some(f) => f.id,
        None => db::add_feed(conn, email::FEED, email::TITLE, "", None).map_err(err)?,
    };
    db::feed(conn, id).map_err(err)?.ok_or_else(|| "The Email feed went missing.".to_string())
}

/// The connected mailbox (without its password), or null.
#[tauri::command]
fn email_account() -> Option<serde_json::Value> {
    email_account_saved().map(|a| a.public())
}

/// Check the sign-in with the mail server, then keep it in the Keychain. A blank password keeps the saved one.
#[tauri::command]
async fn email_connect(state: State<'_, Shared>, account: email::Account) -> Result<serde_json::Value, String> {
    let mut a = account;
    a.address = a.address.trim().to_string();
    a.imap_host = a.imap_host.trim().to_string();
    a.smtp_host = a.smtp_host.trim().to_string();
    if a.password.is_empty() {
        a.password = email_account_saved().filter(|o| o.address.eq_ignore_ascii_case(&a.address)).map(|o| o.password).unwrap_or_default();
    }
    if !a.address.contains('@') || a.password.is_empty() || a.imap_host.is_empty() || a.smtp_host.is_empty() {
        return Err("Fill in the address, password and both servers.".into());
    }
    email::check(&a).await?;
    let elsewhere = email::delivered_elsewhere(&state.client, &a).await;
    email_account_store(&a)?;
    {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        email_feed(&conn)?;
    }
    changed(state.inner());
    let mut out = a.public();
    out["elsewhere"] = serde_json::json!(elsewhere);
    Ok(out)
}

/// Forget the mailbox on this device only. Emails already here stay.
#[tauri::command]
fn email_disconnect() {
    social::local_delete(EMAIL_KEY);
    // the old shared sign-in, so this device doesn't take it up again
    social::secret_delete(EMAIL_SHARED_KEY);
}

/// Keep emails just downloaded: as stories in the Email tab, with the cleaned email and what's known about it.
fn email_store(conn: &mut rusqlite::Connection, mails: &[email::Mail]) -> Result<usize, String> {
    email_store_in(conn, mails, "inbox")
}

/// Keep emails from a folder ("inbox", "sent", "archive", "trash", "spam"). An email the app already has from
/// another folder stays where it is (Gmail's All Mail holds the inbox too); emails outside the inbox arrive read.
fn email_store_in(conn: &mut rusqlite::Connection, mails: &[email::Mail], folder: &str) -> Result<usize, String> {
    let owned: Vec<email::Mail>;
    let mails = if folder == "inbox" {
        mails
    } else {
        owned = mails
            .iter()
            .filter(|m| !conn.query_row("SELECT 1 FROM email_meta WHERE link=?1 AND folder<>?2", rusqlite::params![m.link, folder], |_| Ok(())).is_ok())
            .cloned()
            .collect();
        &owned
    };
    let added = email_store_raw(conn, mails)?;
    for m in mails {
        conn.execute("UPDATE email_meta SET folder=?1 WHERE link=?2", rusqlite::params![folder, m.link]).map_err(err)?;
        if folder != "inbox" {
            conn.execute("UPDATE items SET read=1 WHERE link=?1 AND read=0 AND id NOT IN (SELECT id FROM items WHERE link=?1 AND saved=1)", [&m.link]).map_err(err)?;
        }
    }
    Ok(added)
}

fn email_store_raw(conn: &mut rusqlite::Connection, mails: &[email::Mail]) -> Result<usize, String> {
    let now = feeds::now_iso();
    {
        let feed = email_feed(conn)?;
        let fresh: Vec<db::NewItem> = mails
            .iter()
            .map(|m| db::NewItem {
                id: feeds::item_id(feed.id, &m.link),
                title: m.subject.clone(),
                link: m.link.clone(),
                date: m.date.clone(),
                summary: m.summary.clone(),
                image: String::new(),
                audio: String::new(),
                shares: String::new(),
                paid: false,
                links: String::new(),
                comments: -1,
            tags: String::new(),
            videos: String::new(),
            })
            .collect();
        let added = db::store_fetch(conn, &feed, email::TITLE, "", &fresh, &now).map_err(err)?;
        for m in mails {
            // the story may have come first through sync from another device, under its own id
            let id: Option<String> = conn.query_row("SELECT id FROM items WHERE link=?1 LIMIT 1", [&m.link], |r| r.get(0)).ok();
            if let Some(id) = id {
                db::cache_article(conn, &id, &article::clean_mail(&m.html), &m.from_name).map_err(err)?;
                if !m.summary.is_empty() {
                    conn.execute("UPDATE items SET summary=?1 WHERE id=?2", rusqlite::params![m.summary, id]).map_err(err)?;
                }
            }
            conn.execute("INSERT OR REPLACE INTO email_parsed(uid, v) VALUES (?1, ?2)", rusqlite::params![m.uid, EMAIL_PARSE]).map_err(err)?;
            conn.execute(
                "INSERT OR REPLACE INTO email_meta(link, uid, from_name, from_addr, reply_to, message_id, refs, subject, to_addrs, cc_addrs, bulk, unsub, unsub_post, thread)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                rusqlite::params![m.link, m.uid, m.from_name, m.from_addr, m.reply_to, m.message_id, m.references, m.subject, m.to, m.cc, m.bulk, m.unsub, m.unsub_post, m.thread],
            )
            .map_err(err)?;
        }
        Ok(added)
    }
}


/// Email keys from a query (its first column).
fn uids(conn: &rusqlite::Connection, sql: &str) -> Result<std::collections::HashSet<String>, String> {
    let mut st = conn.prepare(sql).map_err(err)?;
    let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Bring in new email from the inbox: how many arrived, and how many the inbox holds.
#[tauri::command]
async fn email_refresh(app: AppHandle, state: State<'_, Shared>) -> Result<serde_json::Value, String> {
    let Some(a) = email_account_saved() else { return Ok(serde_json::json!({ "added": 0, "inbox": null })) };
    let (known, seen) = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        // an email counts as fetched only while its text is still here (else it's downloaded again)
        // (read again when the app has since learned to read email better)
        let known = uids(&conn, &format!("SELECT m.uid FROM email_meta m JOIN items i ON i.link = m.link JOIN email_parsed p ON p.uid = m.uid AND p.v >= {EMAIL_PARSE} WHERE COALESCE(i.content, '') <> ''"))?;
        let seen = uids(&conn, "SELECT m.uid FROM email_meta m JOIN items i ON i.link = m.link")?;
        (known, seen)
    };
    let email::Inbox { mails, count: inbox, gone } = email::fetch(&a, &known, &seen).await?;
    // Emails deleted (or moved out of the inbox) elsewhere leave the Email tab too, unless kept in Read later
    let removed = if gone.is_empty() {
        0
    } else {
        let conn = state.db.lock().unwrap();
        let mut n = 0;
        for uid in &gone {
            n += conn
                .execute("DELETE FROM items WHERE saved=0 AND link IN (SELECT link FROM email_meta WHERE uid=?1)", [uid])
                .map_err(err)?;
            conn.execute("DELETE FROM email_meta WHERE uid=?1", [uid]).map_err(err)?;
        }
        n
    };
    if mails.is_empty() {
        if removed > 0 {
            let _ = app.emit("state-changed", ());
            update_badge(&app);
        }
        return Ok(serde_json::json!({ "added": 0, "inbox": inbox, "removed": removed }));
    }
    let added = {
        let mut conn = state.db.lock().unwrap();
        email_store(&mut conn, &mails)?
    };
    let _ = app.emit("state-changed", ());
    update_badge(&app);
    changed(state.inner());
    Ok(serde_json::json!({ "added": added, "inbox": inbox, "removed": removed }))
}

/// Who a reply to this email goes to, and its subject.
/// Who sent an email (for the header above it in the reader).
#[tauri::command]
fn email_from(state: State<'_, Shared>, item_id: String) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().unwrap();
    email_table(&conn).map_err(err)?;
    let r = conn
        .query_row(
            "SELECT m.from_name, m.from_addr, m.reply_to FROM items i JOIN email_meta m ON m.link = i.link WHERE i.id=?1",
            [&item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .map_err(|_| "Not an email.".to_string())?;
    Ok(serde_json::json!({ "name": r.0, "address": r.1, "replyTo": r.2, "to": email_account_saved().map(|a| a.address) }))
}

#[tauri::command]
fn email_reply_to(state: State<'_, Shared>, item_id: String) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().unwrap();
    email_table(&conn).map_err(err)?;
    let r = conn
        .query_row(
            "SELECT m.from_name, CASE WHEN m.reply_to<>'' THEN m.reply_to ELSE m.from_addr END, m.subject, m.to_addrs || ', ' || m.cc_addrs
             FROM items i JOIN email_meta m ON m.link = i.link WHERE i.id=?1",
            [&item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
        )
        .map_err(|_| "This email can't be replied to from here.".to_string())?;
    let subject = if r.2.to_lowercase().starts_with("re:") { r.2.clone() } else { format!("Re: {}", r.2) };
    let me = email_account_saved().map(|a| a.address).unwrap_or_default();
    Ok(serde_json::json!({ "name": r.0, "to": r.1, "subject": subject, "from": me, "cc": reply_all_cc(&r.3, &r.1, &me) }))
}

/// Reply All: everyone the email went to, but not you and not the person you're answering.
fn reply_all_cc(others: &str, to: &str, me: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for a in email::cc_list(others) {
        if !a.eq_ignore_ascii_case(me) && !a.eq_ignore_ascii_case(to) && !out.iter().any(|o| o.eq_ignore_ascii_case(&a)) {
            out.push(a);
        }
    }
    out
}

/// Send a reply from your mailbox, and file it in its Sent folder.
#[tauri::command]
async fn email_reply(state: State<'_, Shared>, item_id: String, body: String, all: Option<bool>, files: Option<Vec<OutFile>>) -> Result<String, String> {
    let files = out_files(files)?;
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    if body.trim().is_empty() {
        return Err("Write something first.".into());
    }
    let (to, subject, msg_id, refs, others) = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        conn.query_row(
            "SELECT CASE WHEN m.reply_to<>'' THEN m.reply_to ELSE m.from_addr END, m.subject, m.message_id, m.refs, m.to_addrs || ', ' || m.cc_addrs
             FROM items i JOIN email_meta m ON m.link = i.link WHERE i.id=?1",
            [&item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)),
        )
        .map_err(|_| "This email can't be replied to from here.".to_string())?
    };
    let subject = if subject.to_lowercase().starts_with("re:") { subject } else { format!("Re: {subject}") };
    let cc = if all.unwrap_or(false) { reply_all_cc(&others, &to, &a.address).join(", ") } else { String::new() };
    let out = email::Outgoing { to: &to, cc: &cc, subject: &subject, body: &body, in_reply_to: &msg_id, references: &refs, files: &files };
    let raw = email::send(&a, &out).await?;
    email::file_sent(&a, &raw).await;
    Ok(to)
}

/// Delete an email: it goes to the mailbox's Trash (where you can still get it back) and leaves the Email tab.
#[tauri::command]
async fn email_delete(app: AppHandle, state: State<'_, Shared>, item_id: String) -> Result<Option<String>, String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let (link, uid, msg_id) = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        conn.query_row(
            "SELECT i.link, COALESCE(m.uid,''), COALESCE(m.message_id,'') FROM items i LEFT JOIN email_meta m ON m.link = i.link WHERE i.id=?1",
            [&item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .map_err(|_| "That email isn't here any more.".to_string())?
    };
    let folder = email::trash(&a, &uid, &msg_id).await?;
    {
        let conn = state.db.lock().unwrap();
        conn.execute("DELETE FROM highlights WHERE item_id=?1", [&item_id]).map_err(err)?;
        conn.execute("DELETE FROM items WHERE id=?1", [&item_id]).map_err(err)?;
        conn.execute("DELETE FROM email_meta WHERE link=?1", [&link]).map_err(err)?;
    }
    let _ = app.emit("state-changed", ());
    update_badge(&app);
    changed(state.inner());
    Ok(folder)
}

/// Send a new email from your mailbox (Write back, Share › Email, New email), and file it in Sent.
#[tauri::command]
async fn email_send(to: String, subject: String, body: String, files: Option<Vec<OutFile>>) -> Result<String, String> {
    let files = out_files(files)?;
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let to = email::plain_address(&to).ok_or("Enter one email address to send to.")?;
    if body.trim().is_empty() {
        return Err("Write something first.".into());
    }
    let out = email::Outgoing { to: &to, cc: "", subject: subject.trim(), body: &body, in_reply_to: "", references: "", files: &files };
    let raw = email::send(&a, &out).await?;
    email::file_sent(&a, &raw).await;
    Ok(to)
}

/// A file to attach, as the interface sends it (its bytes in base64).
#[derive(serde::Deserialize)]
struct OutFile {
    name: String,
    mime: String,
    data: String,
}

/// Files to attach, decoded; at most 20 MB together (most mail servers refuse bigger emails).
fn out_files(files: Option<Vec<OutFile>>) -> Result<Vec<(String, String, Vec<u8>)>, String> {
    use base64::Engine;
    let mut out = vec![];
    let mut total = 0usize;
    for f in files.unwrap_or_default() {
        let b = base64::engine::general_purpose::STANDARD.decode(f.data.trim()).map_err(|_| format!("Couldn't read {}.", f.name))?;
        total += b.len();
        out.push((f.name, f.mime, b));
    }
    if total > 20 * 1024 * 1024 {
        return Err("The files are too big together (over 20 MB). Most mail servers won't send that; try fewer or smaller files.".into());
    }
    Ok(out)
}

/// Search the whole inbox on the mail server; matches the app doesn't have yet are brought in.
#[tauri::command]
async fn email_search(app: AppHandle, state: State<'_, Shared>, query: String) -> Result<serde_json::Value, String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let have: std::collections::HashSet<String> = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        let mut st = conn.prepare("SELECT uid FROM email_meta").map_err(err)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    let (mails, found) = email::search(&a, &query, &have).await?;
    let added = {
        let mut conn = state.db.lock().unwrap();
        email_store(&mut conn, &mails)?
    };
    if added > 0 {
        let _ = app.emit("state-changed", ());
        changed(state.inner());
    }
    Ok(serde_json::json!({ "added": added, "found": found }))
}

/// A newsletter's own feed, when it has one: looked for on its site (from its links and the sender's domain),
/// so you can follow it in your reader and unsubscribe from the email. Null when none is found.
#[tauri::command]
async fn email_newsletter_feed(state: State<'_, Shared>, item_id: String) -> Result<serde_json::Value, String> {
    let (html, from) = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        conn.query_row(
            "SELECT COALESCE(i.content,''), COALESCE(m.from_addr,'') FROM items i LEFT JOIN email_meta m ON m.link = i.link WHERE i.id=?1",
            [&item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|_| "That email isn't here any more.".to_string())?
    };
    for site in email::newsletter_sites(&html, &from) {
        let url = format!("https://{site}");
        // a known platform's feed address, or the feed the site's front page names
        if site.contains('/') {
            if let Ok(f) = feeds::fetch(&state.client, &url).await {
                return Ok(serde_json::json!({ "feed": if f.url.is_empty() { url.clone() } else { f.url.clone() }, "title": f.title, "site": format!("https://{}", site.split('/').next().unwrap_or(&site)) }));
            }
            continue;
        }
        let Ok(resp) = state.client.get(&url).send().await else { continue };
        if !resp.status().is_success() {
            continue;
        }
        let base = resp.url().to_string();
        let Ok(page) = resp.text().await else { continue };
        if let Some(feed) = feeds::discover(&page, &base) {
            if let Ok(f) = feeds::fetch(&state.client, &feed).await {
                return Ok(serde_json::json!({ "feed": if f.url.is_empty() { feed.clone() } else { f.url.clone() }, "title": f.title, "site": base }));
            }
        }
    }
    Ok(serde_json::Value::Null)
}

/// What the Email tab needs to know about each email, by its link: newsletter or person, whether it can be
/// unsubscribed from, its conversation, and its sender's address (to find their blog among your feeds).
#[tauri::command]
fn email_meta_all(state: State<'_, Shared>) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().unwrap();
    email_table(&conn).map_err(err)?;
    let mut st = conn.prepare("SELECT link, from_addr, bulk, unsub<>'', thread, to_addrs, cc_addrs, folder FROM email_meta").map_err(err)?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                serde_json::json!({ "from": r.get::<_, String>(1)?, "bulk": r.get::<_, bool>(2)?, "unsub": r.get::<_, bool>(3)?, "thread": r.get::<_, String>(4)?, "to": r.get::<_, String>(5)?, "cc": r.get::<_, String>(6)?, "folder": r.get::<_, String>(7)? }),
            ))
        })
        .map_err(err)?;
    let mut map = serde_json::Map::new();
    for (k, v) in rows.filter_map(Result::ok) {
        map.insert(k, v);
    }
    Ok(serde_json::Value::Object(map))
}

/// The uid and Message-ID of an email in the Email tab.
fn email_ids(state: &Shared, item_id: &str) -> Result<(String, String, String), String> {
    let conn = state.db.lock().unwrap();
    email_table(&conn).map_err(err)?;
    conn.query_row(
        "SELECT i.link, COALESCE(m.uid,''), COALESCE(m.message_id,'') FROM items i LEFT JOIN email_meta m ON m.link = i.link WHERE i.id=?1",
        [item_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    )
    .map_err(|_| "That email isn't here any more.".to_string())
}

/// The Sent, Archive, Trash and Spam folders this mailbox has: [{kind, name}].
#[tauri::command]
async fn email_folders() -> Result<serde_json::Value, String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let list = email::folders(&a).await?;
    Ok(serde_json::json!(list.into_iter().map(|(k, n)| serde_json::json!({ "kind": k.as_str(), "name": n })).collect::<Vec<_>>()))
}

/// Bring a folder up to date (its newest 100), or with `older` the 100 before the oldest one here. Emails that
/// left the folder leave the app. Sent shows what you sent; Gmail's All Mail (its Archive) leaves out your own
/// sent emails and anything already in the inbox.
#[tauri::command]
async fn email_folder(app: AppHandle, state: State<'_, Shared>, kind: String, older: Option<bool>) -> Result<serde_json::Value, String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let k = email::Kind::from_str(&kind).ok_or("That isn't an email folder.")?;
    let Some(name) = email::folder_name(&a, k).await? else {
        return Ok(serde_json::json!({ "missing": true }));
    };
    let (known, seen) = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        let known = uids(&conn, &format!("SELECT m.uid FROM email_meta m JOIN items i ON i.link = m.link JOIN email_parsed p ON p.uid = m.uid AND p.v >= {EMAIL_PARSE} WHERE COALESCE(i.content, '') <> ''"))?;
        let seen = uids(&conn, "SELECT m.uid FROM email_meta m JOIN items i ON i.link = m.link")?;
        (known, seen)
    };
    let me = a.address.to_ascii_lowercase();
    let keep = |m: &email::Mail| !(k == email::Kind::Archive && m.from_addr.to_ascii_lowercase() == me);
    let (mails, count, left, gone) = if older.unwrap_or(false) {
        let (mails, left) = email::fetch_older_in(&a, &name, &seen).await?;
        (mails, 0, left, vec![])
    } else {
        let f = email::fetch_in(&a, &name, &known, &seen).await?;
        (f.mails, f.count, 0, f.gone)
    };
    let mails: Vec<email::Mail> = mails.into_iter().filter(|m| keep(m)).collect();
    let added = {
        let mut conn = state.db.lock().unwrap();
        for uid in &gone {
            conn.execute("DELETE FROM items WHERE saved=0 AND link IN (SELECT link FROM email_meta WHERE uid=?1)", [uid]).map_err(err)?;
            conn.execute("DELETE FROM email_meta WHERE uid=?1", [uid]).map_err(err)?;
        }
        let n = email_store_in(&mut conn, &mails, k.as_str())?;
        for m in &mails {
            conn.execute("INSERT OR REPLACE INTO email_parsed(uid, v) VALUES (?1, ?2)", rusqlite::params![m.uid, EMAIL_PARSE]).map_err(err)?;
        }
        n
    };
    if added > 0 || !gone.is_empty() {
        let _ = app.emit("state-changed", ());
        changed(state.inner());
    }
    Ok(serde_json::json!({ "name": name, "added": added, "count": count, "left": left, "removed": gone.len() }))
}

/// Empty Trash (asked first in the app): the mailbox's Trash is emptied for good, and its emails leave the app.
#[tauri::command]
async fn email_empty_trash(app: AppHandle, state: State<'_, Shared>) -> Result<serde_json::Value, String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let (name, n) = email::empty_trash(&a).await?;
    {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        // kept in Read later: it stays there
        conn.execute("DELETE FROM items WHERE saved=0 AND link IN (SELECT link FROM email_meta WHERE folder='trash')", []).map_err(err)?;
        conn.execute("DELETE FROM email_meta WHERE folder='trash' AND NOT EXISTS (SELECT 1 FROM items WHERE items.link = email_meta.link)", []).map_err(err)?;
    }
    let _ = app.emit("state-changed", ());
    changed(state.inner());
    Ok(serde_json::json!({ "name": name, "deleted": n }))
}

/// Move to Inbox (from Archive or Trash) and Not spam: the email goes back to the inbox, and the next check
/// brings it in there.
#[tauri::command]
async fn email_move(app: AppHandle, state: State<'_, Shared>, item_id: String) -> Result<(), String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let (link, uid, msg_id) = email_ids(state.inner(), &item_id)?;
    email::to_inbox(&a, &uid, &msg_id).await?;
    {
        let conn = state.db.lock().unwrap();
        conn.execute("DELETE FROM items WHERE id=?1 AND saved=0", [&item_id]).map_err(err)?;
        conn.execute("DELETE FROM email_meta WHERE link=?1", [&link]).map_err(err)?;
    }
    let _ = app.emit("state-changed", ());
    changed(state.inner());
    Ok(())
}

/// Archive an email: it leaves the inbox (and the Email tab) for the mailbox's Archive folder.
#[tauri::command]
async fn email_archive(app: AppHandle, state: State<'_, Shared>, item_id: String) -> Result<Option<String>, String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let (link, uid, msg_id) = email_ids(state.inner(), &item_id)?;
    let folder = email::archive(&a, &uid, &msg_id).await?;
    {
        let conn = state.db.lock().unwrap();
        // kept in Read later: it stays there
        conn.execute("DELETE FROM items WHERE id=?1 AND saved=0", [&item_id]).map_err(err)?;
        conn.execute("DELETE FROM email_meta WHERE link=?1 AND NOT EXISTS (SELECT 1 FROM items WHERE link=?1)", [&link]).map_err(err)?;
    }
    let _ = app.emit("state-changed", ());
    update_badge(&app);
    changed(state.inner());
    Ok(folder)
}

/// Unsubscribe from a newsletter the way it asks to be: one click on its server (RFC 8058), else an email to
/// its unsubscribe address, else its unsubscribe page, which the app opens for you to finish there.
#[tauri::command]
async fn email_unsubscribe(state: State<'_, Shared>, item_id: String) -> Result<serde_json::Value, String> {
    let (header, post) = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        conn.query_row("SELECT m.unsub, m.unsub_post FROM items i JOIN email_meta m ON m.link = i.link WHERE i.id=?1", [&item_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))
            .map_err(|_| "This email doesn't say how to unsubscribe.".to_string())?
    };
    let (web, mail) = email::unsubscribe_targets(&header);
    if let (Some(url), true) = (&web, post) {
        let r = state
            .client
            .post(url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body("List-Unsubscribe=One-Click")
            .send()
            .await;
        if r.map(|r| r.status().is_success()).unwrap_or(false) {
            return Ok(serde_json::json!({ "how": "done" }));
        }
    }
    if let (Some(m), Some(a)) = (&mail, email_account_saved()) {
        let rest = m.trim_start_matches("mailto:").trim_start_matches("MAILTO:");
        let (addr, query) = rest.split_once('?').unwrap_or((rest, ""));
        let mut subject = "unsubscribe".to_string();
        let mut body = "unsubscribe".to_string();
        for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
            match k.to_ascii_lowercase().as_str() {
                "subject" if !v.trim().is_empty() => subject = v.to_string(),
                "body" if !v.trim().is_empty() => body = v.to_string(),
                _ => {}
            }
        }
        let addr = url::form_urlencoded::parse(format!("a={addr}").as_bytes()).next().map(|(_, v)| v.to_string()).unwrap_or_default();
        if let Some(to) = email::plain_address(&addr) {
            let out = email::Outgoing { to: &to, cc: "", subject: &subject, body: &body, in_reply_to: "", references: "", files: &[] };
            if email::send(&a, &out).await.is_ok() {
                return Ok(serde_json::json!({ "how": "emailed", "to": to }));
            }
        }
    }
    match web {
        Some(url) => Ok(serde_json::json!({ "how": "page", "url": url })),
        None => Err("Couldn't unsubscribe from here. Look for Unsubscribe at the end of the email.".into()),
    }
}

/// A file attached to an email: downloaded again from the inbox, then opened in the app that opens that kind
/// of file (open), saved where you choose (save), or handed back to share (data, for iPhone and iPad).
#[tauri::command]
async fn email_attachment(app: AppHandle, state: State<'_, Shared>, item_id: String, index: usize, action: String) -> Result<serde_json::Value, String> {
    use base64::Engine;
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let (_, uid, msg_id) = email_ids(state.inner(), &item_id)?;
    let raw = email::fetch_raw(&a, &uid, &msg_id).await?;
    let (name, mime, bytes) = email::attachment(&raw, index).ok_or("That file isn't in the email any more.")?;
    match action.as_str() {
        "save" => {
            let Some(file) = app.dialog().file().set_title("Save the attached file").set_file_name(&name).blocking_save_file() else {
                return Ok(serde_json::json!({ "saved": false }));
            };
            let path = file.into_path().map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
            std::fs::write(&path, &bytes).map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
            Ok(serde_json::json!({ "saved": true, "name": name }))
        }
        "open" => {
            let dir = app.path().app_cache_dir().map_err(err)?.join("Attachments");
            std::fs::create_dir_all(&dir).map_err(err)?;
            let path = dir.join(&name);
            std::fs::write(&path, &bytes).map_err(err)?;
            app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|_| "Couldn't open the file. Try Save instead.".to_string())?;
            Ok(serde_json::json!({ "opened": true, "name": name }))
        }
        _ => Ok(serde_json::json!({ "name": name, "mime": mime, "data": base64::engine::general_purpose::STANDARD.encode(&bytes) })),
    }
}

/// Bring in older email: the next hundred from the inbox before the oldest one here. Says how many more are left.
#[tauri::command]
async fn email_older(app: AppHandle, state: State<'_, Shared>) -> Result<serde_json::Value, String> {
    let a = email_account_saved().ok_or("Connect your email in Settings first.")?;
    let have: std::collections::HashSet<String> = {
        let conn = state.db.lock().unwrap();
        email_table(&conn).map_err(err)?;
        let mut st = conn.prepare("SELECT uid FROM email_meta").map_err(err)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    let (mails, left) = email::fetch_older(&a, &have).await?;
    let added = {
        let mut conn = state.db.lock().unwrap();
        email_store(&mut conn, &mails)?
    };
    let _ = app.emit("state-changed", ());
    update_badge(&app);
    changed(state.inner());
    Ok(serde_json::json!({ "added": added, "left": left }))
}

/// Save a page you found elsewhere to Read later (in a feed of its own, "Saved pages").
async fn save_page(app: &AppHandle, url: &str, title: &str) -> Result<String, String> {
    let st: Shared = app.state::<Shared>().inner().clone();
    let u = url::Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_string())?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("That isn't a web page.".into());
    }
    let item = share::page_item(&st.client, u.as_str(), title).await;
    let now = feeds::now_iso();
    let mut conn = st.db.lock().unwrap();
    let id = match db::feeds(&conn).map_err(err)?.into_iter().find(|f| f.url == share::SAVED_FEED) {
        Some(f) => f.id,
        None => db::add_feed(&conn, share::SAVED_FEED, share::SAVED_TITLE, "", None).map_err(err)?,
    };
    let feed = db::feed(&conn, id).map_err(err)?.ok_or("The Saved pages feed went missing.")?;
    let items = feeds::to_new_items(id, std::slice::from_ref(&item));
    let item_id = items[0].id.clone();
    db::store_fetch(&mut conn, &feed, share::SAVED_TITLE, "", &items, &now).map_err(err)?;
    db::mark(&mut conn, &[item_id.clone()], None, Some(true), &now).map_err(err)?;
    Ok(item_id)
}

/// A link to save from inside the app (or from the Share menu's inbox).
#[tauri::command]
async fn save_url(app: AppHandle, url: String, title: Option<String>) -> Result<String, String> {
    let id = save_page(&app, &url, title.as_deref().unwrap_or("")).await?;
    let st: Shared = app.state::<Shared>().inner().clone();
    changed(&st);
    Ok(id)
}

/// Pages saved from Safari's Share menu while the app was closed: add them to Read later.
#[tauri::command]
async fn share_inbox(app: AppHandle) -> Result<usize, String> {
    let waiting = share::take_inbox();
    let mut n = 0;
    for s in &waiting {
        if save_page(&app, &s.url, &s.title).await.is_ok() {
            n += 1;
        }
    }
    if n > 0 {
        let st: Shared = app.state::<Shared>().inner().clone();
        changed(&st);
    }
    Ok(n)
}

/// What the Home Screen widgets show (a small JSON summary made by the app).
#[tauri::command]
fn widget_data(json: String) {
    share::put_widget(&json);
}

/// Search everything: the stories still in the app and the older ones it has let go.
#[tauri::command]
fn search_all(state: State<'_, Shared>, q: String, limit: Option<i64>) -> Result<Vec<db::Found>, String> {
    let conn = state.db.lock().unwrap();
    db::search_all(&conn, &q, limit.unwrap_or(60).clamp(1, 300)).map_err(err)
}

/// A notification on this Mac, iPhone or iPad (keyword alerts). The first one asks for permission.
#[tauri::command]
fn notify(title: String, body: String, id: String) {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    alerts::send(&title, &body, &id);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = (title, body, id);
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod alerts {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest, UNNotificationSound, UNUserNotificationCenter,
    };

    pub fn send(title: &str, body: &str, id: &str) {
        let (t, b, i) = (title.to_string(), body.to_string(), id.to_string());
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let done = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            if !granted.as_bool() {
                return;
            }
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&t));
            content.setBody(&NSString::from_str(&b));
            content.setThreadIdentifier(&NSString::from_str("keyword-alerts"));
            content.setSound(Some(&UNNotificationSound::defaultSound()));
            let req = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&i), &content, None);
            UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&req, None);
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
            &done,
        );
    }
}

/// Print what's on screen (the Morning Edition's print button).
#[tauri::command]
fn print_page(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let w = app.get_webview_window("main").ok_or("The window went missing.")?;
        w.print().map_err(|e| format!("Couldn't print ({e})."))
    }
    // iPhone and iPad: the page's own print (the app falls back to it)
    #[cfg(mobile)]
    {
        let _ = app;
        Err("Printing goes through the page on iPhone and iPad.".into())
    }
}

#[tauri::command]
fn remove_feed(app: AppHandle, state: State<'_, Shared>, id: i64) -> Result<(), String> {
    db::remove_feed(&state.db.lock().unwrap(), id).map_err(err)?;
    changed(state.inner());
    update_badge(&app);
    Ok(())
}

#[tauri::command]
fn rename_feed(state: State<'_, Shared>, id: i64, title: String) -> Result<(), String> {
    let title: String = title.trim().chars().take(120).collect();
    if title.is_empty() {
        return Err("Give the feed a name.".into());
    }
    let r = db::rename_feed(&state.db.lock().unwrap(), id, &title).map_err(err);
    changed(state.inner());
    r
}

fn clean_name(name: &str) -> Result<String, String> {
    let name: String = name.trim().chars().take(60).collect();
    if name.is_empty() {
        Err("Give the folder a name.".into())
    } else {
        Ok(name)
    }
}

/// Folders go two levels deep: a folder can sit inside a top-level folder, and that's all.
fn check_nesting(conn: &rusqlite::Connection, id: Option<i64>, parent: Option<i64>) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    let Some(p) = parent else { return Ok(()) };
    if Some(p) == id {
        return Err("A folder can't go inside itself.".into());
    }
    let parent_of_parent: Option<Option<i64>> =
        conn.query_row("SELECT parent_id FROM folders WHERE id=?1", [p], |r| r.get(0)).optional().map_err(err)?;
    match parent_of_parent {
        None => return Err("That folder isn't here any more.".into()),
        Some(Some(_)) => return Err("Folders go two levels deep: that folder is already inside another one.".into()),
        Some(None) => {}
    }
    if let Some(id) = id {
        let has_children: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM folders WHERE parent_id=?1)", [id], |r| r.get(0)).map_err(err)?;
        if has_children {
            return Err("Folders go two levels deep: this folder has folders inside it, so it stays at the top.".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn create_folder(state: State<'_, Shared>, name: String, parent: Option<i64>) -> Result<i64, String> {
    let name = clean_name(&name)?;
    let conn = state.db.lock().unwrap();
    if db::folder_name_taken(&conn, &name, None).map_err(err)? {
        return Err(format!("You already have a folder called {name}."));
    }
    check_nesting(&conn, None, parent)?;
    let id = db::folder_named(&conn, &name).map_err(err)?;
    if parent.is_some() {
        db::set_folder_parent(&conn, id, parent).map_err(err)?;
    }
    changed(state.inner());
    Ok(id)
}

/// Put a folder inside another (or back at the top, with no parent).
#[tauri::command]
fn set_folder_parent(state: State<'_, Shared>, id: i64, parent: Option<i64>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    check_nesting(&conn, Some(id), parent)?;
    db::set_folder_parent(&conn, id, parent).map_err(err)?;
    changed(state.inner());
    Ok(())
}

#[tauri::command]
fn rename_folder(state: State<'_, Shared>, id: i64, name: String) -> Result<(), String> {
    let name = clean_name(&name)?;
    let conn = state.db.lock().unwrap();
    if db::folder_name_taken(&conn, &name, Some(id)).map_err(err)? {
        return Err(format!("You already have a folder called {name}."));
    }
    let r = db::rename_folder(&conn, id, &name).map_err(err);
    changed(state.inner());
    r
}

#[tauri::command]
fn delete_folder(state: State<'_, Shared>, id: i64) -> Result<(), String> {
    let r = db::delete_folder(&state.db.lock().unwrap(), id).map_err(err);
    changed(state.inner());
    r
}

#[tauri::command]
fn set_feed_folder(state: State<'_, Shared>, feed_id: i64, folder_id: Option<i64>) -> Result<(), String> {
    let r = db::set_feed_folder(&state.db.lock().unwrap(), feed_id, folder_id).map_err(err);
    changed(state.inner());
    r
}

// ---- reader, web window, sharing, highlights

#[tauri::command]
async fn get_article(state: State<'_, Shared>, item_id: String, refetch: Option<bool>) -> Result<article::Article, String> {
    let link = {
        let conn = state.db.lock().unwrap();
        if !refetch.unwrap_or(false) {
            if let Some(c) = db::cached_article(&conn, &item_id).map_err(err)? {
                return Ok(article::Article { html: c.html, byline: c.byline });
            }
        }
        db::item_link(&conn, &item_id).map_err(err)?.unwrap_or_default()
    };
    if link.starts_with("email:") {
        // An email whose text isn't here (yet): show its preview; the next check downloads it again
        let conn = state.db.lock().unwrap();
        let summary: String = conn.query_row("SELECT COALESCE(summary,'') FROM items WHERE id=?1", [&item_id], |r| r.get(0)).unwrap_or_default();
        let html = format!(
            "<p>{}</p><p class=\"note\" id=\"rMailWait\">Getting the whole email from your mailbox…</p>",
            html_escape::encode_text(&summary)
        );
        return Ok(article::Article { html, byline: String::new() });
    }
    if !link.starts_with("http") {
        return Err("This story has no web page to open.".into());
    }
    let a = article::fetch(&state.client, &link).await?;
    db::cache_article(&state.db.lock().unwrap(), &item_id, &a.html, &a.byline).map_err(err)?;
    Ok(a)
}

fn web_url(url: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(url).map_err(|_| "That link isn't a web address.".to_string())?;
    if u.scheme() == "http" || u.scheme() == "https" {
        Ok(u)
    } else {
        Err("That link isn't a web address.".into())
    }
}

/// Show a web page in the app's own browsing window (one window, reused). The window holds two views: a
/// toolbar of the app's own (back, forward, reload, the address, open in your browser, follow the site) and
/// the page itself below it. The page never gets to talk to the app; only the toolbar does.
#[cfg(desktop)]
const WEB_BAR: f64 = 56.0;

#[cfg(desktop)]
#[derive(Clone, Serialize)]
struct WebState {
    url: String,
    title: String,
    loading: bool,
}

#[cfg(desktop)]
fn web_page(app: &AppHandle) -> Option<tauri::Webview> {
    app.get_webview("webpage")
}

/// Where the web window's page is, as the page itself reported it. The page is never asked while it's loading:
/// asking from inside WebKit's own callbacks could trip Rust up, and there it can't recover (the app would quit).
#[cfg(desktop)]
static WEB_NOW: std::sync::Mutex<Option<WebState>> = std::sync::Mutex::new(None);

#[cfg(desktop)]
fn web_now() -> WebState {
    WEB_NOW.lock().map(|g| g.clone()).ok().flatten().unwrap_or(WebState { url: String::new(), title: String::new(), loading: false })
}

/// Note what changed and tell the toolbar, off WebKit's callback.
#[cfg(desktop)]
fn web_tell(app: &AppHandle, url: Option<String>, title: Option<String>, loading: Option<bool>) {
    let now = {
        let Ok(mut g) = WEB_NOW.lock() else { return };
        let cur = g.get_or_insert(WebState { url: String::new(), title: String::new(), loading: false });
        if let Some(u) = url { cur.url = u; }
        if let Some(t) = title { cur.title = t; }
        if let Some(l) = loading { cur.loading = l; }
        cur.clone()
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(w) = app.get_window("web") {
            let t = now.title.trim();
            let _ = w.set_title(if t.is_empty() { "The Reading Room — Web" } else { t });
        }
        let _ = app.emit_to("webbar", "web-state", now);
    });
}

#[cfg(desktop)]
fn web_layout(w: &tauri::Window) {
    let app = w.app_handle();
    let (Ok(size), Ok(scale)) = (w.inner_size(), w.scale_factor()) else { return };
    let s = size.to_logical::<f64>(scale);
    if let Some(bar) = app.get_webview("webbar") {
        let _ = bar.set_position(tauri::LogicalPosition::new(0.0, 0.0));
        let _ = bar.set_size(tauri::LogicalSize::new(s.width, WEB_BAR));
    }
    if let Some(page) = app.get_webview("webpage") {
        let _ = page.set_position(tauri::LogicalPosition::new(0.0, WEB_BAR));
        let _ = page.set_size(tauri::LogicalSize::new(s.width, (s.height - WEB_BAR).max(0.0)));
    }
}

#[cfg(desktop)]
#[tauri::command]
async fn open_web(app: AppHandle, url: String) -> Result<(), String> {
    let u = web_url(&url)?;
    if let (Some(w), Some(p)) = (app.get_window("web"), web_page(&app)) {
        p.navigate(u).map_err(|e| e.to_string())?;
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let w = tauri::window::WindowBuilder::new(&app, "web")
        .title("The Reading Room — Web")
        .inner_size(1120.0, 860.0)
        .min_inner_size(420.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;
    let s = w.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(w.scale_factor().unwrap_or(1.0));
    let bar = tauri::webview::WebviewBuilder::new("webbar", WebviewUrl::App("webbar.html".into()));
    let opener = app.clone();
    let page = tauri::webview::WebviewBuilder::new("webpage", WebviewUrl::External(u))
        // Links that ask for a new tab (Bluesky, Mastodon and many sites open outside links that way) open right here;
        // Back returns to where you were.
        .on_new_window(move |url, _features| {
            if url.scheme() == "http" || url.scheme() == "https" {
                let app = opener.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(p) = app.get_webview("webpage") {
                        let _ = p.navigate(url);
                    }
                });
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(|wv, p| {
            let started = matches!(p.event(), tauri::webview::PageLoadEvent::Started);
            web_tell(wv.app_handle(), Some(p.url().to_string()), started.then(String::new), Some(started));
        })
        .on_document_title_changed(|wv, title| {
            web_tell(wv.app_handle(), None, Some(title), None);
        });
    w.add_child(bar, tauri::LogicalPosition::new(0.0, 0.0), tauri::LogicalSize::new(s.width, WEB_BAR))
        .map_err(|e| e.to_string())?;
    w.add_child(page, tauri::LogicalPosition::new(0.0, WEB_BAR), tauri::LogicalSize::new(s.width, (s.height - WEB_BAR).max(0.0)))
        .map_err(|e| e.to_string())?;
    let w2 = w.clone();
    w.on_window_event(move |e| {
        if matches!(e, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
            web_layout(&w2);
        }
    });
    Ok(())
}

/// The toolbar's buttons: back, forward, reload, stop, go to an address, open in your browser.
#[cfg(desktop)]
#[tauri::command]
async fn web_nav(app: AppHandle, action: String, url: Option<String>) -> Result<(), String> {
    let p = web_page(&app).ok_or("The web window is closed.")?;
    match action.as_str() {
        "back" => p.eval("history.back()").map_err(|e| e.to_string())?,
        "forward" => p.eval("history.forward()").map_err(|e| e.to_string())?,
        "reload" => p.reload().map_err(|e| e.to_string())?,
        "stop" => p.eval("window.stop()").map_err(|e| e.to_string())?,
        "go" => {
            let raw = url.unwrap_or_default();
            let raw = raw.trim();
            let full = if raw.contains("://") { raw.to_string() } else if raw.contains('.') && !raw.contains(' ') { format!("https://{raw}") } else {
                format!("https://duckduckgo.com/?q={}", url::form_urlencoded::byte_serialize(raw.as_bytes()).collect::<String>())
            };
            p.navigate(web_url(&full)?).map_err(|e| e.to_string())?;
        }
        "browser" => {
            let u = web_now().url;
            if u.is_empty() { return Err("The page hasn't loaded yet.".into()); }
            app.opener().open_url(u.as_str(), None::<&str>).map_err(|_| "Couldn't open your browser.".to_string())?;
        }
        "follow" => {
            let u = web_now().url;
            if u.is_empty() { return Err("The page hasn't loaded yet.".into()); }
            let _ = app.emit_to("main", "web-follow", u);
            if let Some(m) = app.get_webview_window("main") {
                let _ = m.show();
                let _ = m.set_focus();
            }
        }
        _ => return Err("Unknown action.".into()),
    }
    Ok(())
}

/// Where the page is now, for the toolbar when it first loads.
#[cfg(desktop)]
#[tauri::command]
async fn web_state() -> WebState {
    web_now()
}

#[cfg(mobile)]
#[tauri::command]
fn web_nav(_action: String, _url: Option<String>) -> Result<(), String> {
    Err("Not on this device.".into())
}

#[cfg(mobile)]
#[tauri::command]
fn web_state() -> () {}

/// iPhone and iPad have one window per app, so web pages open in Safari.
#[cfg(mobile)]
#[tauri::command]
async fn open_web(app: AppHandle, url: String) -> Result<(), String> {
    let u = web_url(&url)?;
    app.opener().open_url(u.as_str(), None::<&str>).map_err(|_| "Couldn't open that page.".to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn open_share(app: AppHandle, url: String) -> Result<(), String> {
    open_web(app, url).await
}

/// A small sharing window (X, LinkedIn). Sign in there once; the app remembers it.
#[cfg(desktop)]
#[tauri::command]
async fn open_share(app: AppHandle, url: String) -> Result<(), String> {
    let u = web_url(&url)?;
    if let Some(w) = app.get_webview_window("share") {
        let _ = w.close();
    }
    WebviewWindowBuilder::new(&app, "share", WebviewUrl::External(u))
        .title("Share")
        .inner_size(620.0, 720.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// A video in its own small window that floats above the app while you keep reading (Mac). The window
/// shows the video's page only (readingroomapp.com/play for YouTube, or the file itself) and gets no
/// access to the app. One window, reused.
#[cfg(desktop)]
#[tauri::command]
async fn open_player(app: AppHandle, url: String, title: String) -> Result<(), String> {
    let u = web_url(&url)?;
    let name = if title.trim().is_empty() { "Video".to_string() } else { title.trim().chars().take(120).collect() };
    if let Some(w) = app.get_webview_window("player") {
        w.navigate(u).map_err(|e| e.to_string())?;
        let _ = w.set_title(&name);
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "player", WebviewUrl::External(u))
        .title(name)
        .inner_size(640.0, 360.0)
        .min_inner_size(320.0, 180.0)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn open_player(_url: String, _title: String) -> Result<(), String> {
    Err("A video window is only on the Mac.".into())
}

/// Hand a link to the Mac: web pages to your browser, mailto: to Mail.
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let ok = url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:");
    if !ok {
        return Err("That link can't be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|_| "Couldn't hand that link to your Mac.".to_string())
}

#[tauri::command]
fn add_highlight(state: State<'_, Shared>, item_id: String, text: String, note: Option<String>, start: i64) -> Result<i64, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Select some text to highlight.".into());
    }
    let r = db::add_highlight(&state.db.lock().unwrap(), &item_id, &text, note.as_deref().unwrap_or("").trim(), start, &feeds::now_iso()).map_err(err);
    changed(state.inner());
    r
}

#[tauri::command]
fn set_note(state: State<'_, Shared>, id: i64, note: String) -> Result<(), String> {
    let r = db::set_note(&state.db.lock().unwrap(), id, note.trim()).map_err(err);
    changed(state.inner());
    r
}

#[tauri::command]
fn delete_highlight(state: State<'_, Shared>, id: i64) -> Result<(), String> {
    let r = db::delete_highlight(&state.db.lock().unwrap(), id).map_err(err);
    changed(state.inner());
    r
}

// ---- sync between Macs

fn sync_dir(conn: &Connection) -> Option<PathBuf> {
    db::get_meta(conn, "sync_dir").ok().flatten().filter(|d| !d.is_empty()).map(PathBuf::from)
}

fn device_id(conn: &Connection) -> String {
    if let Ok(Some(id)) = db::get_meta(conn, "device_id") {
        return id;
    }
    let id: String = conn.query_row("SELECT lower(hex(randomblob(8)))", [], |r| r.get(0)).unwrap_or_else(|_| "mac".into());
    let _ = db::set_meta(conn, "device_id", &id);
    id
}

/// Write this device's sync file if anything changed since it was last written.
fn publish(st: &Shared, dir: &std::path::Path, me: &str) -> Result<(), String> {
    let mut mine = {
        let conn = st.db.lock().unwrap();
        sync::export(&conn, me, &sync::device_name()).map_err(err)?
    };
    let unchanged = st.sync.lock().unwrap().last_written.as_ref() == Some(&mine);
    let own_file = dir.join(format!("{me}.json"));
    if !unchanged || !own_file.exists() {
        let compare = mine.clone();
        mine.written_at = feeds::now_iso();
        sync::write_own(dir, &mine).map_err(|_| "Couldn't write to the sync folder. Check that it still exists and isn't full.".to_string())?;
        st.sync.lock().unwrap().last_written = Some(compare);
    }
    Ok(())
}

/// One round of sync: take in the other devices' changes, then publish this one's.
fn run_sync(app: &AppHandle) {
    let st: Shared = app.state::<Shared>().inner().clone();
    let (dir, me) = {
        let conn = st.db.lock().unwrap();
        (sync_dir(&conn), device_id(&conn))
    };
    let Some(dir) = dir else { return };
    let result = (|| -> Result<sync::Applied, String> {
        if !dir.is_dir() {
            return Err("The sync folder can't be found. If it's in iCloud Drive, check that iCloud Drive is on for this device.".into());
        }
        // iPhone and iPad: send this device's changes first (the app may be paused any moment),
        // then wait for iCloud to bring down the other devices' files.
        #[cfg(mobile)]
        {
            publish(&st, &dir, &me)?;
            let _ = app.icloud_folder().download(&dir.display().to_string());
        }
        let peers = sync::read_peers(&dir, &me);
        let mut total = sync::Applied::default();
        {
            let mut conn = st.db.lock().unwrap();
            if sync::join(&mut conn, &peers).map_err(err)? {
                total.changes += 1;
            }
            for p in &peers {
                let got = sync::merge(&mut conn, p).map_err(err)?;
                total.changes += got.changes;
                total.new_feeds.extend(got.new_feeds);
            }
        }
        st.sync.lock().unwrap().peers = peers.iter().map(|p| (p.device_name.clone(), p.written_at.clone())).collect();
        publish(&st, &dir, &me)?;
        Ok(total)
    })();
    let now = feeds::now_iso();
    match result {
        Ok(applied) => {
            {
                let mut info = st.sync.lock().unwrap();
                info.last_sync = Some(now);
                info.error = None;
            }
            if !applied.new_feeds.is_empty() {
                tauri::async_runtime::spawn(refresh_feeds(app.clone(), Some(applied.new_feeds)));
            }
            if applied.changes > 0 {
                update_badge(app);
                let _ = app.emit("state-changed", ());
            }
        }
        Err(e) => st.sync.lock().unwrap().error = Some(e),
    }
    let _ = app.emit("sync-changed", ());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatus {
    on: bool,
    folder: Option<String>,
    label: Option<String>,
    icloud_available: bool,
    this_mac: String,
    last_sync: Option<String>,
    error: Option<String>,
    peers: Vec<Peer>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Peer {
    name: String,
    last_seen: String,
}

fn status_of(state: &Shared) -> SyncStatus {
    let dir = sync_dir(&state.db.lock().unwrap());
    let info = state.sync.lock().unwrap();
    let icloud = sync::icloud_drive();
    let label = dir.as_ref().map(|d| match &icloud {
        Some(root) if d.starts_with(root) => {
            let rest = d.strip_prefix(root).map(|r| r.display().to_string()).unwrap_or_default();
            if rest.is_empty() { "iCloud Drive".to_string() } else { format!("iCloud Drive › {}", rest.replace('/', " › ")) }
        }
        _ => {
            // iPhone and iPad: …/Mobile Documents/com~apple~CloudDocs/<rest>
            let full = d.display().to_string();
            match full.split_once("/com~apple~CloudDocs") {
                Some((_, rest)) if rest.trim_matches('/').is_empty() => "iCloud Drive".to_string(),
                Some((_, rest)) => format!("iCloud Drive › {}", rest.trim_matches('/').replace('/', " › ")),
                None => full,
            }
        }
    });
    SyncStatus {
        on: dir.is_some(),
        folder: dir.map(|d| d.display().to_string()),
        label,
        icloud_available: icloud.is_some() || cfg!(mobile),
        this_mac: sync::device_name(),
        last_sync: info.last_sync.clone(),
        error: info.error.clone(),
        peers: info.peers.iter().map(|(n, w)| Peer { name: n.clone(), last_seen: w.clone() }).collect(),
    }
}

fn start_sync(app: &AppHandle, state: &Shared, dir: PathBuf) -> Result<SyncStatus, String> {
    std::fs::create_dir_all(&dir).map_err(|_| "Couldn't create the sync folder there. Pick another folder.".to_string())?;
    db::set_meta(&state.db.lock().unwrap(), "sync_dir", &dir.display().to_string()).map_err(err)?;
    state.sync.lock().unwrap().last_written = None;
    run_sync(app);
    Ok(status_of(state))
}

#[tauri::command]
fn sync_status(state: State<'_, Shared>) -> SyncStatus {
    status_of(state.inner())
}

/// Ask for a folder. In the App Store version this is also what gives the app permission to use it,
/// so it's remembered as a bookmark for later launches.
/// iPhone and iPad: Apple's Files picker. The bookmark keeps the app's access to the folder after restarts.
#[cfg(mobile)]
fn pick_folder(app: &AppHandle, state: &Shared, _title: &str, _start: Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    let Some((path, bookmark)) = app.icloud_folder().pick()? else { return Ok(None) };
    let conn = state.db.lock().unwrap();
    db::set_meta(&conn, "sync_bookmark_ios", &bookmark).map_err(err)?;
    db::delete_meta(&conn, "sync_subfolder").map_err(err)?;
    Ok(Some(PathBuf::from(path)))
}

/// At launch on iPhone and iPad: reopen the folder you picked, and learn this device's name.
#[cfg(mobile)]
fn reopen_ios(app: &AppHandle) {
    if let Some(name) = app.icloud_folder().device_name() {
        let _ = sync::DEVICE_NAME.set(name);
    }
    let st: Shared = app.state::<Shared>().inner().clone();
    let Some(bookmark) = db::get_meta(&st.db.lock().unwrap(), "sync_bookmark_ios").ok().flatten() else { return };
    match app.icloud_folder().open(&bookmark) {
        Ok((path, keep)) => {
            let conn = st.db.lock().unwrap();
            let sub = db::get_meta(&conn, "sync_subfolder").ok().flatten().filter(|s| !s.is_empty());
            let dir = match sub {
                Some(sub) => PathBuf::from(&path).join(sub),
                // Older builds didn't remember the subfolder: picking iCloud Drive always meant this one.
                None if PathBuf::from(&path).file_name().map_or(false, |n| n == "com~apple~CloudDocs") => {
                    let _ = db::set_meta(&conn, "sync_subfolder", "The Reading Room");
                    PathBuf::from(&path).join("The Reading Room")
                }
                None => PathBuf::from(&path),
            };
            let _ = db::set_meta(&conn, "sync_dir", &dir.display().to_string());
            if keep != bookmark {
                let _ = db::set_meta(&conn, "sync_bookmark_ios", &keep);
            }
        }
        Err(e) => st.sync.lock().unwrap().error = Some(e),
    }
}

#[cfg(desktop)]
fn pick_folder(app: &AppHandle, state: &Shared, title: &str, start: Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(dir) = start {
        dialog = dialog.set_directory(dir);
    }
    let Some(folder) = dialog.blocking_pick_folder() else { return Ok(None) };
    let picked = folder.into_path().map_err(|_| "Couldn't use that folder.".to_string())?;
    if bookmark::sandboxed() {
        let data = bookmark::create(&picked)?;
        db::set_meta(&state.db.lock().unwrap(), "sync_bookmark", &bookmark::to_hex(&data)).map_err(err)?;
    }
    Ok(Some(picked))
}

/// iPhone and iPad: pick iCloud Drive (or its "The Reading Room" folder) in the Files picker.
#[cfg(mobile)]
#[tauri::command]
async fn sync_use_icloud(app: AppHandle, state: State<'_, Shared>) -> Result<Option<SyncStatus>, String> {
    let Some(picked) = pick_folder(&app, state.inner(), "", None)? else { return Ok(None) };
    // Picking iCloud Drive itself means its "The Reading Room" folder. Remember that part: after a restart
    // the bookmark only reopens the folder that was picked.
    let dir = if picked.file_name().map_or(false, |n| n == "com~apple~CloudDocs") {
        db::set_meta(&state.db.lock().unwrap(), "sync_subfolder", "The Reading Room").map_err(err)?;
        picked.join("The Reading Room")
    } else {
        picked
    };
    start_sync(&app, state.inner(), dir).map(Some)
}

#[cfg(desktop)]
#[tauri::command]
async fn sync_use_icloud(app: AppHandle, state: State<'_, Shared>) -> Result<Option<SyncStatus>, String> {
    let root = sync::icloud_drive()
        .ok_or("iCloud Drive isn't on for this Mac. Turn it on in System Settings › your name › iCloud › iCloud Drive, then try again.")?;
    if !bookmark::sandboxed() {
        return start_sync(&app, state.inner(), root.join("The Reading Room")).map(Some);
    }
    // App Store version: you choose the folder once, and macOS lets the app keep using it.
    let Some(picked) = pick_folder(&app, state.inner(), "Choose iCloud Drive (or its “The Reading Room” folder), then click Open", Some(root.clone()))? else {
        return Ok(None);
    };
    let dir = if picked == root || picked.file_name().map_or(false, |n| n == "com~apple~CloudDocs") {
        picked.join("The Reading Room")
    } else {
        picked
    };
    start_sync(&app, state.inner(), dir).map(Some)
}

#[tauri::command]
async fn sync_choose_folder(app: AppHandle, state: State<'_, Shared>) -> Result<Option<SyncStatus>, String> {
    let Some(dir) = pick_folder(&app, state.inner(), "Choose a folder to sync through", None)? else {
        return Ok(None);
    };
    start_sync(&app, state.inner(), dir).map(Some)
}

/// At launch, reopen the folder you picked (App Store version only).
fn reopen_sync_folder(conn: &Connection) {
    let Some(hex) = db::get_meta(conn, "sync_bookmark").ok().flatten() else { return };
    let Some(data) = bookmark::from_hex(&hex) else { return };
    if let Ok((path, stale)) = bookmark::open(&data) {
        if stale {
            if let Ok(fresh) = bookmark::create(&path) {
                let _ = db::set_meta(conn, "sync_bookmark", &bookmark::to_hex(&fresh));
            }
        }
    }
}

#[tauri::command]
fn sync_turn_off(state: State<'_, Shared>) -> Result<SyncStatus, String> {
    db::delete_meta(&state.db.lock().unwrap(), "sync_dir").map_err(err)?;
    db::delete_meta(&state.db.lock().unwrap(), "sync_bookmark").map_err(err)?;
    db::delete_meta(&state.db.lock().unwrap(), "sync_bookmark_ios").map_err(err)?;
    db::delete_meta(&state.db.lock().unwrap(), "sync_subfolder").map_err(err)?;
    *state.sync.lock().unwrap() = SyncInfo::default();
    Ok(status_of(state.inner()))
}

#[tauri::command]
async fn sync_now(app: AppHandle, state: State<'_, Shared>) -> Result<SyncStatus, String> {
    run_sync(&app);
    Ok(status_of(state.inner()))
}

/// Reading preferences (people or publications, hidden news sources, your own site), shared with your other devices.
#[tauri::command]
fn set_prefs(state: State<'_, Shared>, prefs: serde_json::Value) -> Result<(), String> {
    if !prefs.is_object() || prefs.to_string().len() > 200_000 {
        return Err("Those settings couldn't be saved.".into());
    }
    {
        let conn = state.db.lock().unwrap();
        db::set_meta(&conn, "prefs", &prefs.to_string()).map_err(err)?;
        db::set_meta(&conn, "prefs_at", &chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()).map_err(err)?;
    }
    changed(state.inner());
    Ok(())
}

/// Words and phrases whose stories you don't want to see (shared with your other devices).
#[tauri::command]
fn set_mutes(state: State<'_, Shared>, words: Vec<String>) -> Result<Vec<String>, String> {
    let mut clean: Vec<String> = Vec::new();
    for w in words {
        let w: String = w.trim().chars().take(60).collect();
        if !w.is_empty() && !clean.iter().any(|c| c.eq_ignore_ascii_case(&w)) {
            clean.push(w);
        }
    }
    clean.truncate(300);
    {
        let conn = state.db.lock().unwrap();
        db::set_meta(&conn, "mutes", &serde_json::to_string(&clean).map_err(err)?).map_err(err)?;
        db::set_meta(&conn, "mutes_at", &chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()).map_err(err)?;
    }
    changed(state.inner());
    Ok(clean)
}

// ---- reading aloud (iPhone and iPad: native, with background audio; the Mac uses the page's own speech)

#[cfg(mobile)]
#[tauri::command]
async fn speak(app: AppHandle, text: String, title: String, source: String, rate: f32, offset: i64, voice: Option<String>) -> Result<tauri_plugin_icloud_folder::SpeechState, String> {
    app.icloud_folder().speak(&text, &title, &source, rate, offset, voice.as_deref().unwrap_or(""))
}

#[cfg(mobile)]
#[tauri::command]
async fn speech_voices(app: AppHandle) -> Result<tauri_plugin_icloud_folder::Voices, String> {
    app.icloud_folder().voices()
}

#[cfg(desktop)]
#[tauri::command]
async fn speech_voices() -> Result<(), String> {
    Err("On the Mac, voices come from the page.".into())
}

#[cfg(mobile)]
#[tauri::command]
async fn speech_control(app: AppHandle, action: String, value: Option<f32>) -> Result<tauri_plugin_icloud_folder::SpeechState, String> {
    app.icloud_folder().speech_control(&action, value)
}

#[cfg(mobile)]
#[tauri::command]
async fn speech_status(app: AppHandle) -> Result<tauri_plugin_icloud_folder::SpeechState, String> {
    app.icloud_folder().speech_status()
}

#[cfg(desktop)]
#[tauri::command]
async fn speak() -> Result<(), String> {
    Err("On the Mac, reading aloud uses the system voice in the page.".into())
}

#[cfg(desktop)]
#[tauri::command]
async fn speech_control() -> Result<(), String> {
    Err("On the Mac, reading aloud uses the system voice in the page.".into())
}

#[cfg(desktop)]
#[tauri::command]
async fn speech_status() -> Result<(), String> {
    Err("On the Mac, reading aloud uses the system voice in the page.".into())
}

// ---- weather on Today (Open-Meteo: free, no account; only the place you choose is sent)

async fn get_json(state: &Shared, url: &str) -> Result<serde_json::Value, String> {
    let resp = state.client.get(url).timeout(Duration::from_secs(12)).send().await.map_err(|_| "Couldn't reach the weather service.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("The weather service answered with error {}.", resp.status().as_u16()));
    }
    let text = resp.text().await.map_err(|_| "The weather service was cut off.".to_string())?;
    serde_json::from_str(&text).map_err(|_| "The weather service sent something unexpected.".to_string())
}

/// Find a town (or ZIP code): a few matches with their coordinates.
#[tauri::command]
async fn weather_place(state: State<'_, Shared>, query: String) -> Result<serde_json::Value, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Type a town or ZIP code.".into());
    }
    // "Fort Mill, SC" → search "Fort Mill", then prefer matches in SC
    let (name, region) = match q.split_once(',') {
        Some((n, r)) => (n.trim().to_string(), r.trim().to_lowercase()),
        None => (q.to_string(), String::new()),
    };
    let mut u = url::Url::parse("https://geocoding-api.open-meteo.com/v1/search").expect("static url");
    u.query_pairs_mut().append_pair("name", &name).append_pair("count", "8").append_pair("language", "en").append_pair("format", "json");
    let v = get_json(state.inner(), u.as_str()).await?;
    let mut results: Vec<serde_json::Value> = v.get("results").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    if !region.is_empty() {
        let abbr = us_state_name(&region).unwrap_or(&region).to_lowercase();
        results.sort_by_key(|r| {
            let a1 = r.get("admin1").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
            let cc = r.get("country_code").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
            !(a1 == abbr || a1 == region || cc == region)
        });
    }
    let out: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            let label = [r.get("name"), r.get("admin1"), r.get("country")]
                .iter()
                .filter_map(|x| x.and_then(|y| y.as_str()))
                .collect::<Vec<_>>()
                .join(", ");
            serde_json::json!({ "name": r.get("name"), "label": label, "lat": r.get("latitude"), "lon": r.get("longitude"), "country": r.get("country_code") })
        })
        .collect();
    if out.is_empty() {
        return Err(format!("Couldn't find {q}. Try the town's name, like Fort Mill."));
    }
    Ok(serde_json::Value::Array(out))
}

fn us_state_name(abbr: &str) -> Option<&'static str> {
    const STATES: &[(&str, &str)] = &[("al","Alabama"),("ak","Alaska"),("az","Arizona"),("ar","Arkansas"),("ca","California"),("co","Colorado"),("ct","Connecticut"),("de","Delaware"),("fl","Florida"),("ga","Georgia"),("hi","Hawaii"),("id","Idaho"),("il","Illinois"),("in","Indiana"),("ia","Iowa"),("ks","Kansas"),("ky","Kentucky"),("la","Louisiana"),("me","Maine"),("md","Maryland"),("ma","Massachusetts"),("mi","Michigan"),("mn","Minnesota"),("ms","Mississippi"),("mo","Missouri"),("mt","Montana"),("ne","Nebraska"),("nv","Nevada"),("nh","New Hampshire"),("nj","New Jersey"),("nm","New Mexico"),("ny","New York"),("nc","North Carolina"),("nd","North Dakota"),("oh","Ohio"),("ok","Oklahoma"),("or","Oregon"),("pa","Pennsylvania"),("ri","Rhode Island"),("sc","South Carolina"),("sd","South Dakota"),("tn","Tennessee"),("tx","Texas"),("ut","Utah"),("vt","Vermont"),("va","Virginia"),("wa","Washington"),("wv","West Virginia"),("wi","Wisconsin"),("wy","Wyoming"),("dc","District of Columbia")];
    STATES.iter().find(|(a, _)| *a == abbr).map(|(_, n)| *n)
}

/// Current conditions and today's high and low.
#[tauri::command]
async fn weather_now(state: State<'_, Shared>, lat: f64, lon: f64, fahrenheit: bool) -> Result<serde_json::Value, String> {
    let mut u = url::Url::parse("https://api.open-meteo.com/v1/forecast").expect("static url");
    u.query_pairs_mut()
        .append_pair("latitude", &format!("{lat:.3}"))
        .append_pair("longitude", &format!("{lon:.3}"))
        .append_pair("current", "temperature_2m,weather_code,is_day")
        .append_pair("daily", "temperature_2m_max,temperature_2m_min")
        .append_pair("timezone", "auto")
        .append_pair("forecast_days", "1")
        .append_pair("temperature_unit", if fahrenheit { "fahrenheit" } else { "celsius" });
    let v = get_json(state.inner(), u.as_str()).await?;
    let cur = v.get("current").cloned().unwrap_or_default();
    let daily = v.get("daily").cloned().unwrap_or_default();
    let first = |k: &str| daily.get(k).and_then(|a| a.get(0)).cloned().unwrap_or_default();
    Ok(serde_json::json!({
        "temp": cur.get("temperature_2m"), "code": cur.get("weather_code"), "day": cur.get("is_day"),
        "high": first("temperature_2m_max"), "low": first("temperature_2m_min"),
    }))
}

// ---- Today's calendar and reminders (daybook.rs) and journaling in Day One

/// Today's events and reminders from this device. `ask` shows the system's OK prompt for anything not yet answered.
#[tauri::command]
/// `done` also lists the reminders finished between `from` and `to` (for a journal page about yesterday).
async fn day_today(from: f64, to: f64, calendar: bool, reminders: bool, ask: bool, done: Option<bool>, list: Option<String>) -> Result<daybook::Day, String> {
    tauri::async_runtime::spawn_blocking(move || daybook::today(from, to, calendar, reminders, ask, done.unwrap_or(false), list))
        .await
        .map_err(|_| "Couldn't read Calendar and Reminders.".to_string())
}

/// The names of the Reminders lists on this device (for picking which list My Day uses).
#[tauri::command]
async fn reminder_lists() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(daybook::lists).await.unwrap_or_default()
}

/// Tick a reminder off in Reminders (or untick it).
#[tauri::command]
async fn reminder_done(id: String, done: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || daybook::set_done(&id, done))
        .await
        .map_err(|_| "Couldn't reach Reminders.".to_string())?
}

/// Add a reminder to the default Reminders list (quick capture on My Day). Returns its id.
#[tauri::command]
async fn reminder_add(title: String, due: Option<f64>, timed: Option<bool>, list: Option<String>) -> Result<String, String> {
    if title.trim().is_empty() {
        return Err("Type the reminder first.".into());
    }
    tauri::async_runtime::spawn_blocking(move || daybook::add(&title, due, timed.unwrap_or(false), list.as_deref()))
        .await
        .map_err(|_| "Couldn't reach Reminders.".to_string())?
}

/// Add an event to the default calendar (Put it down on My Day). Times are seconds since 1970.
#[tauri::command]
async fn event_add(title: String, start: f64, end: f64, all_day: bool) -> Result<String, String> {
    if title.trim().is_empty() {
        return Err("Type the event first.".into());
    }
    tauri::async_runtime::spawn_blocking(move || daybook::add_event(&title, start, end, all_day))
        .await
        .map_err(|_| "Couldn't reach Calendar.".to_string())?
}

/// Open Day One with a new entry filled in (its dayone://post link). Day One must be installed.
#[tauri::command]
fn day_one(app: AppHandle, text: String, journal: String, tags: String) -> Result<(), String> {
    let mut u = url::Url::parse("dayone://post").expect("static url");
    {
        let mut q = u.query_pairs_mut();
        q.append_pair("entry", text.trim());
        if !journal.trim().is_empty() {
            q.append_pair("journal", journal.trim());
        }
        if !tags.trim().is_empty() {
            q.append_pair("tags", tags.trim());
        }
    }
    // Day One reads spaces as %20, not +
    let link = u.as_str().replace('+', "%20");
    app.opener().open_url(link, None::<&str>).map_err(|_| "Couldn't open Day One. Is it installed on this device?".to_string())
}

// ---- Markets on Today: a few stocks (Finnhub, with your own free key) and coins (CoinGecko, no key)

const FINNHUB_KEY: &str = "finnhub-key";

async fn market_json(state: &Shared, url: &str, who: &str) -> Result<serde_json::Value, String> {
    let resp = state.client.get(url).timeout(Duration::from_secs(12)).send().await.map_err(|_| format!("Couldn't reach {who}."))?;
    match resp.status().as_u16() {
        200 => {}
        401 | 403 => return Err(format!("{who} didn't accept the key. Check it in Settings › Markets on Today.")),
        429 => return Err(format!("{who} asked the app to slow down. Prices will come back in a minute.")),
        s => return Err(format!("{who} answered with error {s}.")),
    }
    let text = resp.text().await.map_err(|_| format!("{who} was cut off."))?;
    serde_json::from_str(&text).map_err(|_| format!("{who} sent something unexpected."))
}

fn finnhub_key() -> Option<String> {
    social::secret_get(FINNHUB_KEY).and_then(|v| v.as_str().map(str::to_string)).filter(|k| !k.trim().is_empty())
}

/// A stock symbol as people type it: "aapl" → "AAPL", "brk.b" → "BRK.B"
fn clean_symbol(s: &str) -> String {
    s.trim().trim_start_matches('$').to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':')).take(15).collect()
}

async fn stock_quote(state: &Shared, key: &str, sym: &str) -> Result<(f64, f64), String> {
    stock_full(state, key, sym).await.map(|q| (q.0, q.1))
}

/// A stock's price, change in percent, and the day's open, high, low and the close before.
async fn stock_full(state: &Shared, key: &str, sym: &str) -> Result<(f64, f64, f64, f64, f64, f64), String> {
    let mut u = url::Url::parse("https://finnhub.io/api/v1/quote").expect("static url");
    u.query_pairs_mut().append_pair("symbol", sym).append_pair("token", key);
    let v = market_json(state, u.as_str(), "Finnhub").await?;
    let price = v.get("c").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let prev = v.get("pc").and_then(|x| x.as_f64()).unwrap_or(0.0);
    if price <= 0.0 {
        return Err(format!("Finnhub doesn't know {sym}. Free keys cover U.S. stocks and funds."));
    }
    let pct = v.get("dp").and_then(|x| x.as_f64()).unwrap_or(if prev > 0.0 { (price - prev) / prev * 100.0 } else { 0.0 });
    let f = |k: &str| v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
    Ok((price, pct, f("o"), f("h"), f("l"), prev))
}

/// Today's prices: each stock and coin with its price and the day's change in percent.
#[tauri::command]
async fn markets_now(state: State<'_, Shared>, stocks: Vec<String>, coins: Vec<String>) -> Result<serde_json::Value, String> {
    let mut out = Vec::new();
    let mut problem = String::new();
    let stocks: Vec<String> = stocks.iter().map(|s| clean_symbol(s)).filter(|s| !s.is_empty()).take(5).collect();
    if !stocks.is_empty() {
        match finnhub_key() {
            None => problem = "Add a free Finnhub key in Settings › Markets on Today to see stocks.".into(),
            Some(key) => {
                for s in &stocks {
                    match stock_full(state.inner(), &key, s).await {
                        Ok((price, pct, open, high, low, prev)) => out.push(serde_json::json!({ "kind": "stock", "id": s, "sym": s, "price": price, "pct": pct,
                            "open": open, "high": high, "low": low, "prev": prev })),
                        Err(e) => {
                            out.push(serde_json::json!({ "kind": "stock", "id": s, "sym": s, "price": null, "pct": null }));
                            if problem.is_empty() { problem = e; }
                        }
                    }
                }
            }
        }
    }
    let coins: Vec<String> = coins.iter().map(|c| c.trim().to_lowercase()).filter(|c| !c.is_empty() && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')).take(5).collect();
    if !coins.is_empty() {
        // coins/markets: price, 24-hour change and range, and the last 7 days (hourly) for the trend line
        let mut u = url::Url::parse("https://api.coingecko.com/api/v3/coins/markets").expect("static url");
        u.query_pairs_mut().append_pair("vs_currency", "usd").append_pair("ids", &coins.join(","))
            .append_pair("sparkline", "true").append_pair("price_change_percentage", "7d");
        match market_json(state.inner(), u.as_str(), "CoinGecko").await {
            Ok(v) => {
                let list = v.as_array().cloned().unwrap_or_default();
                for c in &coins {
                    let e = list.iter().find(|x| x.get("id").and_then(|i| i.as_str()) == Some(c.as_str()));
                    let n = |k: &str| e.and_then(|x| x.get(k)).and_then(|x| x.as_f64());
                    // every 4th hourly price is plenty for a small line
                    let spark: Vec<f64> = e.and_then(|x| x.get("sparkline_in_7d")).and_then(|x| x.get("price")).and_then(|x| x.as_array())
                        .map(|a| a.iter().filter_map(|p| p.as_f64()).step_by(4).collect()).unwrap_or_default();
                    out.push(serde_json::json!({ "kind": "coin", "id": c,
                        "price": n("current_price"), "pct": n("price_change_percentage_24h"),
                        "high": n("high_24h"), "low": n("low_24h"), "pct7": n("price_change_percentage_7d_in_currency"),
                        "cap": n("market_cap"), "spark": spark }));
                }
            }
            Err(e) => {
                for c in &coins { out.push(serde_json::json!({ "kind": "coin", "id": c, "price": null, "pct": null })); }
                if problem.is_empty() { problem = e; }
            }
        }
    }
    Ok(serde_json::json!({ "quotes": out, "problem": problem }))
}

/// Find a coin by name or ticker ("btc", "solana"): CoinGecko's id, symbol and name for the top matches.
#[tauri::command]
async fn coin_search(state: State<'_, Shared>, query: String) -> Result<serde_json::Value, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Type a coin's name or ticker.".into());
    }
    let mut u = url::Url::parse("https://api.coingecko.com/api/v3/search").expect("static url");
    u.query_pairs_mut().append_pair("query", q);
    let v = market_json(state.inner(), u.as_str(), "CoinGecko").await?;
    let found: Vec<serde_json::Value> = v.get("coins").and_then(|c| c.as_array()).map(|a| a.iter().take(6).map(|c| serde_json::json!({
        "id": c.get("id"), "sym": c.get("symbol").and_then(|s| s.as_str()).unwrap_or("").to_uppercase(), "name": c.get("name"),
    })).collect()).unwrap_or_default();
    if found.is_empty() {
        return Err(format!("CoinGecko didn't find “{q}”."));
    }
    Ok(serde_json::Value::Array(found))
}

/// Whether a Finnhub key is saved (the key itself never goes back to the page).
#[tauri::command]
fn markets_key_status() -> bool {
    finnhub_key().is_some()
}

/// Check a Finnhub key with one quote, then keep it in the Keychain. An empty key removes it.
#[tauri::command]
async fn markets_key_set(state: State<'_, Shared>, key: String) -> Result<bool, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        social::secret_delete(FINNHUB_KEY);
        return Ok(false);
    }
    if key.len() > 100 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("That doesn't look like a Finnhub key. Copy it from your Finnhub dashboard.".into());
    }
    stock_quote(state.inner(), &key, "AAPL").await?;
    social::secret_set(FINNHUB_KEY, &serde_json::Value::String(key))?;
    Ok(true)
}

/// Is this a stock Finnhub knows? Its price, so the settings can show it's right.
#[tauri::command]
async fn stock_check(state: State<'_, Shared>, symbol: String) -> Result<serde_json::Value, String> {
    let sym = clean_symbol(&symbol);
    if sym.is_empty() {
        return Err("Type a ticker, like AAPL.".into());
    }
    let key = finnhub_key().ok_or("Add your free Finnhub key first.")?;
    let (price, pct) = stock_quote(state.inner(), &key, &sym).await?;
    Ok(serde_json::json!({ "sym": sym, "price": price, "pct": pct }))
}

// ---- Discover: blogs your sites recommend (see discover.rs)

fn followed_domains(conn: &Connection) -> std::collections::HashSet<String> {
    db::feeds(conn)
        .unwrap_or_default()
        .iter()
        .flat_map(|f| [discover::domain_of(&f.url), discover::domain_of(&f.site)])
        .flatten()
        .collect()
}

fn discover_hidden(conn: &Connection) -> std::collections::HashSet<String> {
    db::get_meta(conn, "discover_hidden")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .collect()
}

/// The last look, minus anything followed or hidden since.
fn discover_cached(conn: &Connection) -> Option<discover::Report> {
    let mut r: discover::Report = serde_json::from_str(&db::get_meta(conn, "discover").ok()??).ok()?;
    let followed = followed_domains(conn);
    let hidden = discover_hidden(conn);
    r.suggestions.retain(|s| {
        !followed.contains(&s.domain) && !hidden.contains(&s.domain) && discover::domain_of(&s.feed).map_or(true, |d| !followed.contains(&d))
    });
    Some(r)
}

#[tauri::command]
fn discover_get(state: State<'_, Shared>) -> serde_json::Value {
    let conn = state.db.lock().unwrap();
    serde_json::json!({ "report": discover_cached(&conn), "running": state.discovering.load(Ordering::SeqCst) })
}

/// A free audiobook from LibriVox: its chapters, reader and cover. Kept after the first look.
#[tauri::command]
async fn audiobook(state: State<'_, Shared>, input: String) -> Result<audiobooks::Audiobook, String> {
    if let Some(id) = audiobooks::id_from(&input) {
        if let Ok(Some(j)) = db::get_meta(&state.db.lock().unwrap(), &format!("ab:{id}")) {
            if let Ok(b) = serde_json::from_str::<audiobooks::Audiobook>(&j) { return Ok(b); }
        }
    }
    let b = audiobooks::find(&state.client, &input).await?;
    if let Ok(j) = serde_json::to_string(&b) { let _ = db::set_meta(&state.db.lock().unwrap(), &format!("ab:{}", b.id), &j); }
    Ok(b)
}

/// A free classic from Standard Ebooks, as one page. Kept after the first download, so it opens offline.
#[tauri::command]
async fn book_text(state: State<'_, Shared>, slug: String) -> Result<String, String> {
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '/') || slug.contains("..") {
        return Err("That book can’t be found.".into());
    }
    let key = format!("book:{slug}");
    if let Ok(Some(html)) = db::get_meta(&state.db.lock().unwrap(), &key) {
        if html.len() > 1000 { return Ok(html); }
    }
    let url = format!("https://standardebooks.org/ebooks/{slug}/text/single-page");
    let (body, _, _) = feeds::get(&state.client, &url).await
        .map_err(|_| "Couldn’t download the book. Check your connection and try again.".to_string())?;
    let html = String::from_utf8_lossy(&body).to_string();
    if !html.contains("<section") && !html.contains("<article") {
        return Err("The book didn’t download in full. Try again.".into());
    }
    let _ = db::set_meta(&state.db.lock().unwrap(), &key, &html);
    Ok(html)
}

/// The featured pictures of a few web pages (search results), looked up side by side.
#[tauri::command]
async fn page_images(state: State<'_, Shared>, urls: Vec<String>) -> Result<Vec<(String, String)>, String> {
    use futures::stream::{self, StreamExt};
    let client = state.client.clone();
    Ok(stream::iter(urls.into_iter().take(40))
        .map(|u| { let c = client.clone(); async move { let img = feeds::page_image(&c, &u).await.unwrap_or_default(); (u, img) } })
        .buffer_unordered(8)
        .collect()
        .await)
}

/// Search a topic for Discover: news coverage and personal sites, without following anything yet.
#[tauri::command]
async fn topic_search(state: State<'_, Shared>, query: String) -> Result<topics::Results, String> {
    if query.trim().len() < 2 { return Err("Type a few words to search for.".into()); }
    Ok(topics::search(&state.client, &query).await)
}

/// The newest posts from personal sites, from Kagi Small Web, for Discover.
#[tauri::command]
async fn smallweb_feed(state: State<'_, Shared>) -> Result<Vec<topics::SmallPost>, String> {
    topics::smallweb(&state.client).await.map(|p| p.into_iter().take(30).collect())
}

/// Everyone on one writer's blogroll, for their page in Conversations.
#[tauri::command]
async fn person_blogroll(state: State<'_, Shared>, site: String) -> Result<Vec<discover::Entry>, String> {
    tokio::time::timeout(std::time::Duration::from_secs(45), discover::blogroll(&state.client, &site))
        .await
        .map_err(|_| "Their site took too long to answer.".to_string())
}

#[tauri::command]
async fn discover_scan(app: AppHandle, state: State<'_, Shared>) -> Result<Option<discover::Report>, String> {
    if state.discovering.swap(true, Ordering::SeqCst) {
        return Ok(None); // already looking; a "discover-done" event follows
    }
    let (sources, followed, hidden) = {
        let conn = state.db.lock().unwrap();
        let sources: Vec<discover::Source> = db::feeds(&conn)
            .unwrap_or_default()
            .into_iter()
            .filter(|f| !f.url.contains("news.google.com"))
            .map(|f| discover::Source { title: f.title, url: f.url, site: f.site })
            .collect();
        (sources, followed_domains(&conn), discover_hidden(&conn))
    };
    let handle = app.clone();
    let report = discover::run(&state.client, sources, followed, hidden, move |done, total| {
        let _ = handle.emit("discover-progress", (done, total));
    })
    .await;
    {
        let conn = state.db.lock().unwrap();
        if let Ok(json) = serde_json::to_string(&report) {
            let _ = db::set_meta(&conn, "discover", &json);
        }
    }
    state.discovering.store(false, Ordering::SeqCst);
    let _ = app.emit("discover-done", ());
    Ok(Some(report))
}

/// "Not for me": keep this site out of suggestions.
#[tauri::command]
fn discover_hide(state: State<'_, Shared>, domain: String) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    let mut hidden: Vec<String> = discover_hidden(&conn).into_iter().collect();
    if !hidden.contains(&domain) {
        hidden.push(domain);
    }
    db::set_meta(&conn, "discover_hidden", &serde_json::to_string(&hidden).unwrap_or_default()).map_err(err)
}

/// Write back: the ways this story's writer can be reached (email, comments, Mastodon, Bluesky, contact page).
#[tauri::command]
async fn reply_options(state: State<'_, Shared>, item_id: String) -> Result<reply::Options, String> {
    let (link, feed_url): (String, String) = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT COALESCE(i.link,''), COALESCE(f.url,'') FROM items i LEFT JOIN feeds f ON f.id = i.feed_id WHERE i.id=?1",
            [&item_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?
    };
    if !link.starts_with("http") {
        return Err("This story has no web page to reply to.".into());
    }
    let mut opts = reply::find(&state.client, &link, &feed_url).await;
    // Some sites name their Webmention address only in the server's Link header, not in the page
    if !opts.webmention {
        opts.webmention = webmention::discover(&state.client, &link).await.is_some();
    }
    Ok(opts)
}

/// Which kind of device the page is running on, so it can lay itself out to match.
#[tauri::command]
fn app_info() -> serde_json::Value {
    let platform = if cfg!(target_os = "ios") { "ios" } else if cfg!(target_os = "macos") { "macos" } else { "other" };
    serde_json::json!({ "platform": platform, "mobile": cfg!(mobile), "version": env!("CARGO_PKG_VERSION") })
}

#[tauri::command]
fn refresh(app: AppHandle) {
    tauri::async_runtime::spawn(refresh_feeds(app, None));
}

#[tauri::command]
async fn import_opml(app: AppHandle, state: State<'_, Shared>) -> Result<usize, String> {
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Import subscriptions")
        .add_filter("OPML", &["opml", "xml"])
        .blocking_pick_file()
    else {
        return Ok(0); // cancelled
    };
    let path = file.into_path().map_err(|_| "Couldn't open that file.".to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|_| "Couldn't read that file.".to_string())?;
    let outlines = opml::parse(&text)?;
    let mut new_ids = Vec::new();
    {
        let conn = state.db.lock().unwrap();
        for o in &outlines {
            let folder_id = match &o.folder {
                Some(name) => {
                    let parent = match &o.parent {
                        Some(p) => Some(db::folder_named_in(&conn, p, None).map_err(err)?),
                        None => None,
                    };
                    Some(db::folder_named_in(&conn, name, parent).map_err(err)?)
                }
                None => None,
            };
            if let Some(id) = db::add_feed_if_new(&conn, &o.url, &o.title, folder_id).map_err(err)? {
                new_ids.push(id);
            }
        }
    }
    if !new_ids.is_empty() {
        tauri::async_runtime::spawn(refresh_feeds(app, Some(new_ids.clone())));
    }
    Ok(new_ids.len())
}

/// Save some text (your highlights as Markdown) to a file you choose. Mac only; iPhone uses the share sheet.
#[tauri::command]
async fn save_text(app: AppHandle, name: String, text: String) -> Result<bool, String> {
    let name: String = name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).take(80).collect();
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Save highlights")
        .set_file_name(if name.trim().is_empty() { "Highlights.md".to_string() } else { format!("{}.md", name.trim()) })
        .add_filter("Markdown", &["md", "txt"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
    std::fs::write(&path, text).map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
    Ok(true)
}

/// Save a picture the app made (a quote card, PNG) to a file you choose. Mac only; iPhone uses the share sheet.
#[tauri::command]
async fn save_image(app: AppHandle, name: String, data: String) -> Result<bool, String> {
    use base64::Engine;
    let b64 = data.split_once(',').map(|(_, b)| b).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|_| "Couldn't make the picture.".to_string())?;
    let name: String = name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).take(80).collect();
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Save picture")
        .set_file_name(if name.trim().is_empty() { "Quote.png".to_string() } else { format!("{}.png", name.trim()) })
        .add_filter("PNG picture", &["png"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
    std::fs::write(&path, bytes).map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
    Ok(true)
}

#[tauri::command]
async fn export_opml(app: AppHandle, state: State<'_, Shared>) -> Result<bool, String> {
    let text = {
        let conn = state.db.lock().unwrap();
        opml::export(&db::folders(&conn).map_err(err)?, &db::feeds(&conn).map_err(err)?, &feeds::now_iso())
    };
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Export subscriptions")
        .set_file_name("Reading Room feeds.opml")
        .add_filter("OPML", &["opml"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
    std::fs::write(&path, text).map_err(|_| "Couldn't save there. Pick another folder.".to_string())?;
    Ok(true)
}

// ------------------------------------------------------------------ setup

/// Data folder, carrying over the earlier Python version's reader the first time.
fn open_database(app: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("reader.db");
    let mut fresh = !path.exists();
    if fresh {
        if let Some(home) = app.path().home_dir().ok() {
            // The earlier Python version (front_porch.py) kept its data here.
            let legacy: PathBuf = home.join(".front-porch").join("reader.db");
            if legacy.exists() && std::fs::copy(&legacy, &path).is_ok() {
                fresh = false;
            }
        }
    }
    Ok(db::open(&path, fresh)?)
}

#[cfg(desktop)]
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let feeds_menu = Submenu::with_items(
        app,
        "Feeds",
        true,
        &[
            &MenuItem::with_id(app, "refresh", "Refresh All", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "add-feed", "Add Feed…", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-folder", "New Folder…", true, Some("CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "import", "Import OPML…", true, None::<&str>)?,
            &MenuItem::with_id(app, "export", "Export OPML…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sync", "Sync Between Macs…", true, Some("CmdOrCtrl+,"))?,
        ],
    )?;
    menu.append(&feeds_menu)?;
    let go = Submenu::with_items(
        app,
        "Go",
        true,
        &[
            &MenuItem::with_id(app, "back", "Back", true, Some("CmdOrCtrl+["))?,
            &MenuItem::with_id(app, "forward", "Forward", true, Some("CmdOrCtrl+]"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "browser", "Open Page in Browser", true, Some("CmdOrCtrl+Shift+O"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "text-bigger", "Bigger Text", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "text-smaller", "Smaller Text", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(app, "text-reset", "Actual Size Text", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "slim", "Sidebar: Icons Only / Full", true, Some("Ctrl+Cmd+S"))?,
        ],
    )?;
    menu.append(&go)?;
    // The Window menu lists the main window, so it can always be brought back after it's closed (Apple guideline 4)
    let main_item = MenuItem::with_id(app, "show-main", "The Reading Room", true, Some("CmdOrCtrl+1"))?;
    let mut in_window = false;
    for it in menu.items()? {
        if let Some(sm) = it.as_submenu() {
            if sm.text().unwrap_or_default() == "Window" {
                sm.prepend(&PredefinedMenuItem::separator(app)?)?;
                sm.prepend(&main_item)?;
                in_window = true;
            }
        }
    }
    if !in_window {
        menu.append(&Submenu::with_items(app, "Window", true, &[&main_item, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::minimize(app, None)?])?)?;
    }
    // The guide goes in the standard Help menu
    let guide = MenuItem::with_id(app, "help", "The Reading Room Guide", true, None::<&str>)?;
    let mut placed = false;
    for it in menu.items()? {
        if let Some(sm) = it.as_submenu() {
            if sm.text().unwrap_or_default() == "Help" {
                sm.append(&guide)?;
                placed = true;
            }
        }
    }
    if !placed {
        menu.append(&Submenu::with_items(app, "Help", true, &[&guide])?)?;
    }
    Ok(menu)
}

/// A feed address from a link outside the app, waiting for the window to pick it up:
/// "Open in The Reading Room" buttons on websites (readingroom://subscribe?url=https://example.com/feed/)
/// and plain feed:// links. The window asks before following anything.
#[derive(Default)]
pub struct PendingLink(Mutex<Option<String>>);

/// The http(s) feed address inside a readingroom:// or feed: link, or None.
fn feed_from_open_link(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let lower = raw.to_ascii_lowercase();
    let candidate = if lower.starts_with("readingroom:") {
        let u = url::Url::parse(raw).ok()?;
        let found = u.query_pairs().find(|(k, _)| k == "url" || k == "feed").map(|(_, v)| v.into_owned());
        found?
    } else if lower.starts_with("feed:") {
        let rest = raw[5..].trim_start_matches('/');
        let rl = rest.to_ascii_lowercase();
        if rl.starts_with("http:") || rl.starts_with("https:") { rest.to_string() } else { format!("https://{rest}") }
    } else {
        return None;
    };
    let u = url::Url::parse(candidate.trim()).ok()?;
    if matches!(u.scheme(), "http" | "https") && u.host_str().is_some() { Some(u.to_string()) } else { None }
}

#[tauri::command]
fn take_open_link(state: tauri::State<PendingLink>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

/// Bring the main window back: after it was closed (it's only hidden), or minimized to the Dock.
#[cfg(desktop)]
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn now_iso_utc() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M UTC").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // If something goes wrong in a way Rust can't recover from, write down what and where before the app closes,
    // so the next launch can show it (crash reports from the App Store builds have no names in them).
    std::panic::set_hook(Box::new(|info| {
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info.payload().downcast_ref::<&str>().map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "unknown".into());
        let _ = std::fs::write(std::env::temp_dir().join("reading-room-last-crash.txt"),
            format!("{} {} at {} (version {})", now_iso_utc(), what, place, env!("CARGO_PKG_VERSION")));
        eprintln!("panic: {what} at {place}");
    }));
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_iap::init())
        .plugin(tauri_plugin_icloud_folder::init())
        .setup(|app| {
            // tell the window about a crash last time, once
            let crash = std::env::temp_dir().join("reading-room-last-crash.txt");
            if let Ok(t) = std::fs::read_to_string(&crash) {
                let _ = std::fs::remove_file(&crash);
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                    let _ = h.emit_to("main", "last-crash", t);
                });
            }
            let handle = app.handle().clone();
            let conn = open_database(&handle)?;
            reopen_sync_folder(&conn);
            app.manage(PendingLink::default());
            app.manage::<Shared>(Arc::new(AppState {
                db: Mutex::new(conn),
                refreshing: AtomicBool::new(false),
                finding_images: AtomicBool::new(false),
                discovering: AtomicBool::new(false),
                client: feeds::client(),
                sync: Mutex::new(SyncInfo::default()),
                sync_now: tokio::sync::Notify::new(),
            }));

            #[cfg(desktop)]
            app.set_menu(build_menu(&handle)?)?;
            #[cfg(desktop)]
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "show-main" {
                    show_main(app);
                    return;
                }
                // Back / Forward / Open in Browser act on the web window when it's in front.
                let focused = app.get_window("web").is_some_and(|w| w.is_focused().unwrap_or(false));
                let web = app.get_webview("webpage").filter(|_| focused);
                match (event.id().as_ref(), &web) {
                    ("refresh", Some(w)) => {
                        let _ = w.reload();
                        return;
                    }
                    ("back", Some(w)) => {
                        let _ = w.eval("history.back()");
                        return;
                    }
                    ("forward", Some(w)) => {
                        let _ = w.eval("history.forward()");
                        return;
                    }
                    ("browser", Some(w)) => {
                        if let Ok(u) = w.url() {
                            let _ = app.opener().open_url(u.as_str(), None::<&str>);
                        }
                        return;
                    }
                    _ => {}
                }
                let name = match event.id().as_ref() {
                    "back" => "menu-back",
                    "forward" => "menu-forward",
                    "browser" => "menu-browser",
                    "refresh" => "menu-refresh",
                    "add-feed" => "menu-add-feed",
                    "new-folder" => "menu-new-folder",
                    "import" => "menu-import",
                    "export" => "menu-export",
                    "sync" => "menu-sync",
                    "help" => "menu-help",
                    "text-bigger" => "menu-text-bigger",
                    "text-smaller" => "menu-text-smaller",
                    "text-reset" => "menu-text-reset",
                    "slim" => "menu-slim",
                    _ => return,
                };
                let _ = app.emit(name, ());
            });

            update_badge(&handle);
            // Sync with your other Macs now, then every 30 seconds (or right away when asked).
            let sync_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                #[cfg(mobile)]
                reopen_ios(&sync_handle);
                loop {
                    run_sync(&sync_handle);
                    let st: Shared = sync_handle.state::<Shared>().inner().clone();
                    tokio::select! {
                        _ = st.sync_now.notified() => {}
                        _ = tokio::time::sleep(SYNC_EVERY) => {}
                    }
                }
            });
            // Check feeds now, then every 30 minutes while the app is open.
            tauri::async_runtime::spawn(async move {
                loop {
                    refresh_feeds(handle.clone(), None).await;
                    tokio::time::sleep(REFRESH_EVERY).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Mac convention: closing the window keeps the app running (and refreshing) in the Dock.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            reply_options,
            circles,
            social::social_accounts,
            social::bsky_connect,
            social::masto_begin,
            social::masto_finish,
            social::social_disconnect,
            social::social_post,
            social::social_conversations,
            social::social_thread,
            social::social_whole,
            social::site_connect,
            tumblr::tumblr_begin,
            tumblr::tumblr_finish,
            tumblr::tumblr_pick_blog,
            tumblr::tumblr_disconnect,
            tumblr::tumblr_write,
            tumblr::tumblr_stats,
            tumblr::tumblr_activity,
            tumblr::tumblr_post,
            tumblr::tumblr_list,
            tumblr::tumblr_publish,
            tumblr::tumblr_delete,
            ychannel::youtube_begin,
            ychannel::youtube_finish,
            ychannel::youtube_disconnect,
            ychannel::youtube_channel,
            ychannel::youtube_upload,
            micropub::micropub_begin,
            micropub::micropub_finish,
            micropub::micropub_disconnect,
            social::site_avatar,
            social::site_comments,
            social::people_likes,
            social::post_comments,
            person_blogroll,
            social::site_like,
            social::social_like,
            webmention::wm_counts,
            webmention::wm_mentions,
            social::site_note,
            social::blog_stats,
            social::site_categories,
            social::site_posts,
            social::site_post_get,
            social::site_post,
            social::site_post_publish,
            social::site_post_trash,
            social::site_preview,
            social::site_post_view,
            social::site_post_restore,
            social::site_post_gone,
            offline::offline_save,
            youtube::video_channels,
            offline::offline_path,
            offline::offline_remove,
            offline::offline_usage,
            offline::offline_clear,
            social::social_share_note,
            social::social_reply,
            social::social_moderate,
            social::social_profiles,
            social::social_followers,
            social::social_follow,
            social::social_shared,
            social::social_search,
            social::social_blog_mentions,
            topic_search,
            smallweb_feed,
            set_badge,
            book_text,
            audiobook,
            page_images,
            social::site_accounts,
            social::social_resolve,
            social::social_lookup,
            social::social_following_blogs,
            discover_get,
            discover_scan,
            discover_hide,
            app_info,
            weather_place,
            weather_now,
            markets_now,
            day_today,
            reminder_done,
            reminder_lists,
            reminder_add,
            event_add,
            email_from,
            day_one,
            coin_search,
            markets_key_status,
            markets_key_set,
            stock_check,
            set_mutes,
            set_prefs,
            speak,
            speech_control,
            speech_status,
            speech_voices,
            get_state,
            mark,
            add_feed,
            watch_page,
            newsletter_address,
            email_account,
            email_connect,
            email_disconnect,
            email_refresh,
            email_reply_to,
            email_reply,
            email_send,
            email_delete,
            email_archive,
            email_meta_all,
            email_unsubscribe,
            email_attachment,
            email_older,
            email_search,
            email_folders,
            email_folder,
            email_move,
            email_empty_trash,
            email_newsletter_feed,
            save_url,
            share_inbox,
            widget_data,
            search_all,
            notify,
            print_page,
            remove_feed,
            rename_feed,
            create_folder,
            set_folder_parent,
            rename_folder,
            delete_folder,
            set_feed_folder,
            get_article,
            open_web,
            web_nav,
            web_state,
            open_share,
            open_player,
            open_external,
            review::request_review,
            add_highlight,
            set_note,
            delete_highlight,
            sync_status,
            sync_use_icloud,
            sync_choose_folder,
            sync_turn_off,
            sync_now,
            refresh,
            import_opml,
            export_opml,
            follow_list,
            list_check,
            list_set_auto,
            list_keep,
            list_pending,
            list_unfollow,
            save_text,
            save_image,
            take_open_link
        ])
        .build(tauri::generate_context!())
        .expect("error while starting The Reading Room")
        .run(|app, event| {
            // readingroom:// and feed:// links (Mac and iPhone): keep the feed for the window, then tell it
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                for u in urls {
                    if let Some(feed) = feed_from_open_link(u.as_str()) {
                        if let Some(p) = app.try_state::<PendingLink>() {
                            if let Ok(mut g) = p.0.lock() { *g = Some(feed); }
                        }
                        let _ = app.emit_to("main", "link-follow", ());
                        #[cfg(target_os = "macos")]
                        show_main(app);
                    }
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app, event);
        });
}
