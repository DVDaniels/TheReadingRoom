//! Save for offline: a podcast episode or a video file a feed attaches, downloaded to this device so it plays
//! without a connection. Kept in the app's Caches folder (the system may clear it if the device runs out of
//! space, and it isn't backed up), named by the file's address. Not for YouTube or Vimeo, which don't allow it.

use serde::Serialize;
use sha1::{Digest, Sha1};
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("offline");
    std::fs::create_dir_all(&d).map_err(|e| format!("Couldn't make a place to keep it ({e})."))?;
    Ok(d)
}

/// The file's name: a short fingerprint of its address, and its kind (mp3, m4a, mp4…).
fn name(url: &str) -> String {
    let clean = url.split('#').next().unwrap_or(url);
    let path = url::Url::parse(clean).map(|u| u.path().to_ascii_lowercase()).unwrap_or_default();
    let ext = ["mp3", "m4a", "aac", "ogg", "opus", "mp4", "m4v", "mov", "webm"]
        .into_iter()
        .find(|x| path.ends_with(&format!(".{x}")))
        .unwrap_or(if url.ends_with("#video") { "mp4" } else { "mp3" });
    let hash = Sha1::digest(clean.as_bytes());
    let hex: String = hash.iter().take(10).map(|b| format!("{b:02x}")).collect();
    format!("{hex}.{ext}")
}

fn is_streaming_site(url: &str) -> bool {
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_ascii_lowercase())).unwrap_or_default();
    ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com", "vimeo.com", "player.vimeo.com", "tiktok.com", "rumble.com"].contains(&host.as_str())
}

#[derive(Serialize, Clone)]
struct Progress {
    url: String,
    got: u64,
    total: u64,
}

/// Download it (if it isn't here already) and say where it is.
#[tauri::command]
pub async fn offline_save(app: AppHandle, url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("That isn't a file the app can save.".into());
    }
    if is_streaming_site(&url) {
        return Err("YouTube and Vimeo don't allow saving their videos in other apps.".into());
    }
    let d = dir(&app)?;
    let target = d.join(name(&url));
    if target.exists() {
        return Ok(target.to_string_lossy().into_owned());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("ReadingRoom/", env!("CARGO_PKG_VERSION"), " (+personal RSS reader)"))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(url.split('#').next().unwrap_or(&url))
        .send()
        .await
        .map_err(|_| "Couldn't reach the file. Check your connection and try again.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("The file's site answered with error {}.", resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(0);
    let part = d.join(format!("{}.part", name(&url)));
    let mut file = std::fs::File::create(&part).map_err(|e| format!("Couldn't save it ({e})."))?;
    let (mut got, mut last) = (0u64, Instant::now());
    loop {
        let chunk = match tokio::time::timeout(Duration::from_secs(60), resp.chunk()).await {
            Ok(Ok(Some(c))) => c,
            Ok(Ok(None)) => break,
            _ => {
                let _ = std::fs::remove_file(&part);
                return Err("The download stopped partway. Try again when the connection is steadier.".into());
            }
        };
        if let Err(e) = file.write_all(&chunk) {
            let _ = std::fs::remove_file(&part);
            return Err(if e.raw_os_error() == Some(28) { "There isn't enough space on this device to save it.".into() } else { format!("Couldn't save it ({e}).") });
        }
        got += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(400) {
            last = Instant::now();
            let _ = app.emit("offline-progress", Progress { url: url.clone(), got, total });
        }
    }
    drop(file);
    if got == 0 {
        let _ = std::fs::remove_file(&part);
        return Err("The file came back empty.".into());
    }
    std::fs::rename(&part, &target).map_err(|e| format!("Couldn't save it ({e})."))?;
    let _ = app.emit("offline-progress", Progress { url: url.clone(), got, total: got });
    Ok(target.to_string_lossy().into_owned())
}

/// Where the saved copy is, if there is one.
#[tauri::command]
pub fn offline_path(app: AppHandle, url: String) -> Option<String> {
    let p = dir(&app).ok()?.join(name(url.trim()));
    p.exists().then(|| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn offline_remove(app: AppHandle, url: String) -> Result<(), String> {
    let p = dir(&app)?.join(name(url.trim()));
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Usage {
    count: usize,
    bytes: u64,
}

/// How many saved files, and how much space they take.
#[tauri::command]
pub fn offline_usage(app: AppHandle) -> Usage {
    let mut u = Usage { count: 0, bytes: 0 };
    if let Ok(rd) = dir(&app).and_then(|d| std::fs::read_dir(d).map_err(|e| e.to_string())) {
        for e in rd.flatten() {
            if e.path().extension().is_some_and(|x| x != "part") {
                u.count += 1;
                u.bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    u
}

/// Remove every saved file (and any half-finished download).
#[tauri::command]
pub fn offline_clear(app: AppHandle) -> Result<(), String> {
    let d = dir(&app)?;
    for e in std::fs::read_dir(&d).map_err(|e| e.to_string())?.flatten() {
        let _ = std::fs::remove_file(e.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_keep_the_kind_of_file() {
        assert!(name("https://cdn.example/ep/12.mp3?x=1").ends_with(".mp3"));
        assert!(name("https://cdn.example/clip.MP4").ends_with(".mp4"));
        assert!(name("https://cdn.example/stream#video").ends_with(".mp4"));
        assert!(name("https://cdn.example/stream").ends_with(".mp3"));
        assert_eq!(name("https://a.b/x.mp3"), name("https://a.b/x.mp3"));
        assert_ne!(name("https://a.b/x.mp3"), name("https://a.b/y.mp3"));
        assert_eq!(name("https://a.b/v#video"), name("https://a.b/v").replace(".mp3", ".mp4"));
    }
    #[test]
    fn streaming_sites_are_not_saved() {
        assert!(is_streaming_site("https://www.youtube.com/watch?v=x"));
        assert!(is_streaming_site("https://vimeo.com/1"));
        assert!(!is_streaming_site("https://cdn.example/ep.mp3"));
    }
}
