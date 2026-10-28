//! The Reading Room — app wiring: window, menus, background refresh and the commands the page calls.

mod db;
mod feeds;
mod opml;

use futures::stream::{self, StreamExt};
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const REFRESH_EVERY: Duration = Duration::from_secs(30 * 60);
const ITEM_LIMIT: i64 = 2000;

pub struct AppState {
    db: Mutex<Connection>,
    refreshing: AtomicBool,
    client: reqwest::Client,
}

type Shared = Arc<AppState>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    feeds: Vec<db::Feed>,
    items: Vec<db::Item>,
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
        feeds: db::feeds(&conn).map_err(err)?,
        items: db::items(&conn, ITEM_LIMIT).map_err(err)?,
        refreshing: state.refreshing.load(Ordering::SeqCst),
        last_refresh: db::get_meta(&conn, "last_refresh").map_err(err)?,
    })
}

#[tauri::command]
fn mark(app: AppHandle, state: State<'_, Shared>, ids: Vec<String>, read: Option<bool>, saved: Option<bool>) -> Result<(), String> {
    {
        let mut conn = state.db.lock().unwrap();
        db::mark(&mut conn, &ids, read, saved).map_err(err)?;
    }
    update_badge(&app);
    Ok(())
}

#[tauri::command]
async fn add_feed(app: AppHandle, state: State<'_, Shared>, url: String, title: Option<String>) -> Result<Added, String> {
    let mut url = url.trim().to_string();
    if url.is_empty() {
        return Err("Paste a feed or website address first.".into());
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
        let id = db::add_feed(&conn, &fetched.url, &name, &fetched.site).map_err(err)?;
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
            if let Some(id) = db::add_feed_if_new(&conn, &o.url, &o.title).map_err(err)? {
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
        opml::export(&db::feeds(&conn).map_err(err)?, &feeds::now_iso())
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
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "import", "Import OPML…", true, None::<&str>)?,
            &MenuItem::with_id(app, "export", "Export OPML…", true, None::<&str>)?,
        ],
    )?;
    menu.append(&feeds_menu)?;
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
            }));

            app.set_menu(build_menu(&handle)?)?;
            app.on_menu_event(|app, event| {
                let name = match event.id().as_ref() {
                    "refresh" => "menu-refresh",
                    "add-feed" => "menu-add-feed",
                    "import" => "menu-import",
                    "export" => "menu-export",
                    _ => return,
                };
                let _ = app.emit(name, ());
            });

            update_badge(&handle);
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
                api.prevent_close();
                let _ = window.hide();
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
