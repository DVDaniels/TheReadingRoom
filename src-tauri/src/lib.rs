//! The Reading Room — app wiring: window, menus, background refresh and the commands the page calls.

mod article;
mod bookmark;
mod db;
mod discover;
mod feeds;
mod opml;
mod reply;
mod social;
mod sources;
mod sync;

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
                Ok(f) => {
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

/// Unread count on the Dock icon (Mac only; on iPhone it would need notification permission).
#[cfg(mobile)]
fn update_badge(_app: &AppHandle) {}

#[cfg(desktop)]
fn update_badge(app: &AppHandle) {
    let st: Shared = app.state::<Shared>().inner().clone();
    let n = st.db.lock().ok().and_then(|c| db::unread_count(&c).ok()).unwrap_or(0);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if n > 0 { Some(n) } else { None });
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

#[tauri::command]
fn create_folder(state: State<'_, Shared>, name: String) -> Result<i64, String> {
    let name = clean_name(&name)?;
    let conn = state.db.lock().unwrap();
    if db::folder_name_taken(&conn, &name, None).map_err(err)? {
        return Err(format!("You already have a folder called {name}."));
    }
    let r = db::folder_named(&conn, &name).map_err(err);
    changed(state.inner());
    r
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

/// Show a web page in the app's own browsing window (one window, reused).
#[cfg(desktop)]
#[tauri::command]
async fn open_web(app: AppHandle, url: String) -> Result<(), String> {
    let u = web_url(&url)?;
    if let Some(w) = app.get_webview_window("web") {
        w.navigate(u).map_err(|e| e.to_string())?;
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "web", WebviewUrl::External(u))
        .title("The Reading Room — Web")
        .inner_size(1120.0, 860.0)
        .min_inner_size(420.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

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
    Ok(reply::find(&state.client, &link, &feed_url).await)
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
                Some(name) => Some(db::folder_named(&conn, name).map_err(err)?),
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
        ],
    )?;
    menu.append(&go)?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_icloud_folder::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let conn = open_database(&handle)?;
            reopen_sync_folder(&conn);
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
                // Back / Forward / Open in Browser act on the web window when it's in front.
                let web = app.get_webview_window("web").filter(|w| w.is_focused().unwrap_or(false));
                match (event.id().as_ref(), &web) {
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
            social::social_accounts,
            social::bsky_connect,
            social::masto_begin,
            social::masto_finish,
            social::social_disconnect,
            social::social_post,
            social::social_conversations,
            social::social_thread,
            social::social_reply,
            social::social_moderate,
            discover_get,
            discover_scan,
            discover_hide,
            app_info,
            weather_place,
            weather_now,
            set_mutes,
            set_prefs,
            speak,
            speech_control,
            speech_status,
            speech_voices,
            get_state,
            mark,
            add_feed,
            remove_feed,
            rename_feed,
            create_folder,
            rename_folder,
            delete_folder,
            set_feed_folder,
            get_article,
            open_web,
            open_share,
            open_external,
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
            save_text
        ])
        .build(tauri::generate_context!())
        .expect("error while starting The Reading Room")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
