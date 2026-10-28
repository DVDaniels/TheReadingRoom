//! The Reading Room — app wiring: window, menus, background refresh and the commands the page calls.

mod article;
mod db;
mod feeds;
mod opml;
mod sync;

use futures::stream::{self, StreamExt};
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const REFRESH_EVERY: Duration = Duration::from_secs(30 * 60);
const ITEM_LIMIT: i64 = 2000;

pub struct AppState {
    db: Mutex<Connection>,
    refreshing: AtomicBool,
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
    refreshing: bool,
    last_refresh: Option<String>,
}

#[derive(Serialize)]
struct Added {
    id: i64,
    title: String,
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
                let r = feeds::fetch(&client, &feed.url).await;
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
}

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
    if let Some(query) = feeds::news_query(&url) {
        if title.as_deref().map_or(true, |t| t.trim().is_empty()) {
            title = Some(format!("Google News: {query}"));
        }
        url = feeds::google_news_url(&query);
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("https://{url}");
    }
    let host = url::Url::parse(&url)
        .ok()
        .and_then(|u| u.host_str().map(String::from))
        .ok_or("That doesn't look like a web address. Paste the full feed or site URL.")?;

    let fetched = feeds::fetch(&state.client, &url).await?;
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
    update_badge(&app);
    Ok(Added { id, title: name })
}

#[tauri::command]
fn remove_feed(app: AppHandle, state: State<'_, Shared>, id: i64) -> Result<(), String> {
    db::remove_feed(&state.db.lock().unwrap(), id).map_err(err)?;
    update_badge(&app);
    Ok(())
}

#[tauri::command]
fn rename_feed(state: State<'_, Shared>, id: i64, title: String) -> Result<(), String> {
    let title: String = title.trim().chars().take(120).collect();
    if title.is_empty() {
        return Err("Give the feed a name.".into());
    }
    db::rename_feed(&state.db.lock().unwrap(), id, &title).map_err(err)
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
    db::folder_named(&conn, &name).map_err(err)
}

#[tauri::command]
fn rename_folder(state: State<'_, Shared>, id: i64, name: String) -> Result<(), String> {
    let name = clean_name(&name)?;
    let conn = state.db.lock().unwrap();
    if db::folder_name_taken(&conn, &name, Some(id)).map_err(err)? {
        return Err(format!("You already have a folder called {name}."));
    }
    db::rename_folder(&conn, id, &name).map_err(err)
}

#[tauri::command]
fn delete_folder(state: State<'_, Shared>, id: i64) -> Result<(), String> {
    db::delete_folder(&state.db.lock().unwrap(), id).map_err(err)
}

#[tauri::command]
fn set_feed_folder(state: State<'_, Shared>, feed_id: i64, folder_id: Option<i64>) -> Result<(), String> {
    db::set_feed_folder(&state.db.lock().unwrap(), feed_id, folder_id).map_err(err)
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

/// A small sharing window (X, LinkedIn). Sign in there once; the app remembers it.
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
    db::add_highlight(&state.db.lock().unwrap(), &item_id, &text, note.as_deref().unwrap_or("").trim(), start, &feeds::now_iso()).map_err(err)
}

#[tauri::command]
fn set_note(state: State<'_, Shared>, id: i64, note: String) -> Result<(), String> {
    db::set_note(&state.db.lock().unwrap(), id, note.trim()).map_err(err)
}

#[tauri::command]
fn delete_highlight(state: State<'_, Shared>, id: i64) -> Result<(), String> {
    db::delete_highlight(&state.db.lock().unwrap(), id).map_err(err)
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

/// One round of sync: take in the other Macs' changes, then publish this Mac's.
fn run_sync(app: &AppHandle) {
    let st: Shared = app.state::<Shared>().inner().clone();
    let (dir, me) = {
        let conn = st.db.lock().unwrap();
        (sync_dir(&conn), device_id(&conn))
    };
    let Some(dir) = dir else { return };
    let result = (|| -> Result<sync::Applied, String> {
        if !dir.is_dir() {
            return Err("The sync folder can't be found. If it's in iCloud Drive, check that iCloud Drive is on for this Mac.".into());
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

        let mut mine = {
            let conn = st.db.lock().unwrap();
            sync::export(&conn, &me, &sync::device_name()).map_err(err)?
        };
        let unchanged = st.sync.lock().unwrap().last_written.as_ref() == Some(&mine);
        let own_file = dir.join(format!("{me}.json"));
        if !unchanged || !own_file.exists() {
            let compare = mine.clone();
            mine.written_at = feeds::now_iso();
            sync::write_own(&dir, &mine).map_err(|_| "Couldn't write to the sync folder. Check that it still exists and isn't full.".to_string())?;
            st.sync.lock().unwrap().last_written = Some(compare);
        }
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
        _ => d.display().to_string(),
    });
    SyncStatus {
        on: dir.is_some(),
        folder: dir.map(|d| d.display().to_string()),
        label,
        icloud_available: icloud.is_some(),
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

#[tauri::command]
fn sync_use_icloud(app: AppHandle, state: State<'_, Shared>) -> Result<SyncStatus, String> {
    let root = sync::icloud_drive()
        .ok_or("iCloud Drive isn't on for this Mac. Turn it on in System Settings › your name › iCloud › iCloud Drive, then try again.")?;
    start_sync(&app, state.inner(), root.join("The Reading Room"))
}

#[tauri::command]
async fn sync_choose_folder(app: AppHandle, state: State<'_, Shared>) -> Result<Option<SyncStatus>, String> {
    let Some(folder) = app.dialog().file().set_title("Choose a folder to sync through").blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = folder.into_path().map_err(|_| "Couldn't use that folder.".to_string())?;
    start_sync(&app, state.inner(), dir).map(Some)
}

#[tauri::command]
fn sync_turn_off(state: State<'_, Shared>) -> Result<SyncStatus, String> {
    db::delete_meta(&state.db.lock().unwrap(), "sync_dir").map_err(err)?;
    *state.sync.lock().unwrap() = SyncInfo::default();
    Ok(status_of(state.inner()))
}

#[tauri::command]
fn sync_now(app: AppHandle, state: State<'_, Shared>) -> SyncStatus {
    run_sync(&app);
    status_of(state.inner())
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
        ],
    )?;
    menu.append(&go)?;
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let conn = open_database(&handle)?;
            app.manage::<Shared>(Arc::new(AppState {
                db: Mutex::new(conn),
                refreshing: AtomicBool::new(false),
                client: feeds::client(),
                sync: Mutex::new(SyncInfo::default()),
                sync_now: tokio::sync::Notify::new(),
            }));

            app.set_menu(build_menu(&handle)?)?;
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
                    _ => return,
                };
                let _ = app.emit(name, ());
            });

            update_badge(&handle);
            // Sync with your other Macs now, then every 30 seconds (or right away when asked).
            let sync_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
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
            export_opml
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
