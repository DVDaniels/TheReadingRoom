//! Sync between Macs through a shared folder (normally iCloud Drive).
//!
//! Each Mac writes only its own file, `<device id>.json`, holding its feeds, folders, read and saved
//! marks, highlights and notes, and what it deleted, each with the time it last changed. Every Mac
//! reads the other files and keeps the newest version of each thing. Because no Mac ever writes
//! another's file, iCloud never has to resolve a conflict.

use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const FORMAT: u32 = 1;
const MARK_DAYS: i64 = 120; // plain read marks older than this aren't shared

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SyncFile {
    pub format: u32,
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub written_at: String,
    #[serde(default)]
    pub folders: Vec<FolderRec>,
    #[serde(default)]
    pub feeds: Vec<FeedRec>,
    #[serde(default)]
    pub marks: Vec<MarkRec>,
    #[serde(default)]
    pub highlights: Vec<HighlightRec>,
    /// Muted words (version 1.1 and later); the whole list travels together, newest wins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutes: Option<MuteRec>,
    /// Reading preferences: which feeds are people, hidden news sources, your own site
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefs: Option<PrefsRec>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MuteRec {
    pub words: Vec<String>,
    pub at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PrefsRec {
    pub data: serde_json::Value,
    pub at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FolderRec {
    pub uid: String,
    #[serde(default)]
    pub name: String,
    pub at: Option<String>,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FeedRec {
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub folder: Option<String>,
    pub at: Option<String>,
    #[serde(default)]
    pub deleted: bool,
}

/// Read / saved state for one story, found by its link. Stories you saved or highlighted carry
/// enough of the story to show it even on a Mac that never downloaded it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MarkRec {
    pub link: String,
    pub feed: String,
    pub read: bool,
    pub saved: bool,
    pub read_at: Option<String>,
    pub at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story: Option<Story>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Story {
    pub title: String,
    pub date: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub image: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HighlightRec {
    pub uid: String,
    #[serde(default)]
    pub link: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub start: i64,
    #[serde(default)]
    pub created_at: String,
    pub at: Option<String>,
    #[serde(default)]
    pub deleted: bool,
}

/// What a merge changed here.
#[derive(Default, Debug)]
pub struct Applied {
    pub changes: usize,
    pub new_feeds: Vec<i64>,
}

/// `a` is newer than `b` (a missing time is the oldest possible).
fn newer(a: &Option<String>, b: &Option<String>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a > b,
        (Some(_), None) => true,
        _ => false,
    }
}

fn tombstone(conn: &Connection, kind: &str, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT at FROM tombstones WHERE kind=?1 AND key=?2", params![kind, key], |r| r.get(0)).optional()
}

fn put_tombstone(conn: &Connection, kind: &str, key: &str, at: &Option<String>) -> rusqlite::Result<()> {
    if let Some(at) = at {
        conn.execute("INSERT OR REPLACE INTO tombstones VALUES (?1, ?2, ?3)", params![kind, key, at])?;
    }
    Ok(())
}

// ---------------------------------------------------------------- export this Mac

pub fn export(conn: &Connection, device_id: &str, device_name: &str) -> rusqlite::Result<SyncFile> {
    let mut f = SyncFile { format: FORMAT, device_id: device_id.into(), device_name: device_name.into(), ..Default::default() };

    let mut st = conn.prepare("SELECT uid, name, updated_at FROM folders WHERE uid IS NOT NULL ORDER BY uid")?;
    f.folders = st
        .query_map([], |r| Ok(FolderRec { uid: r.get(0)?, name: r.get(1)?, at: r.get(2)?, deleted: false }))?
        .collect::<rusqlite::Result<_>>()?;

    let mut st = conn.prepare(
        // starter feeds you never touched (no time) stay on this Mac
        "SELECT f.url, f.title, fo.uid, f.updated_at FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id
         WHERE f.updated_at IS NOT NULL ORDER BY f.url",
    )?;
    f.feeds = st
        .query_map([], |r| Ok(FeedRec { url: r.get(0)?, title: r.get(1)?, folder: r.get(2)?, at: r.get(3)?, deleted: false }))?
        .collect::<rusqlite::Result<_>>()?;

    let mut st = conn.prepare(&format!(
        "SELECT i.link, f.url, i.read, i.saved, i.read_at, i.marks_at, i.title, i.date, COALESCE(i.summary,''), COALESCE(i.image,''),
                (i.saved = 1 OR i.id IN (SELECT item_id FROM highlights)) AS keep
         FROM items i JOIN feeds f ON f.id = i.feed_id
         WHERE i.link <> '' AND (
               i.saved = 1 OR i.id IN (SELECT item_id FROM highlights)
            OR (i.marks_at IS NOT NULL AND i.marks_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-{MARK_DAYS} days')))
         ORDER BY i.link"
    ))?;
    f.marks = st
        .query_map([], |r| {
            let keep: bool = r.get(10)?;
            let summary: String = r.get(8)?;
            Ok(MarkRec {
                link: r.get(0)?,
                feed: r.get(1)?,
                read: r.get::<_, i64>(2)? != 0,
                saved: r.get::<_, i64>(3)? != 0,
                read_at: r.get(4)?,
                at: r.get(5)?,
                story: keep.then(|| Story {
                    title: r.get(6).unwrap_or_default(),
                    date: r.get(7).unwrap_or_default(),
                    summary: summary.chars().take(300).collect(),
                    image: r.get(9).unwrap_or_default(),
                }),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut st = conn.prepare(
        "SELECT h.uid, i.link, h.text, COALESCE(h.note,''), COALESCE(h.start,-1), h.created_at, h.updated_at
         FROM highlights h JOIN items i ON i.id = h.item_id WHERE h.uid IS NOT NULL ORDER BY h.uid",
    )?;
    f.highlights = st
        .query_map([], |r| {
            Ok(HighlightRec {
                uid: r.get(0)?,
                link: r.get(1)?,
                text: r.get(2)?,
                note: r.get(3)?,
                start: r.get(4)?,
                created_at: r.get(5)?,
                at: r.get(6)?,
                deleted: false,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Deletions, so other Macs remove the same things (kept for six months).
    conn.execute("DELETE FROM tombstones WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 days')", [])?;
    let mut st = conn.prepare("SELECT kind, key, at FROM tombstones ORDER BY kind, key")?;
    let gone: Vec<(String, String, String)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    for (kind, key, at) in gone {
        let at = Some(at);
        match kind.as_str() {
            "folder" => f.folders.push(FolderRec { uid: key, name: String::new(), at, deleted: true }),
            "feed" => f.feeds.push(FeedRec { url: key, title: String::new(), folder: None, at, deleted: true }),
            "highlight" => f.highlights.push(HighlightRec {
                uid: key, link: String::new(), text: String::new(), note: String::new(), start: -1,
                created_at: String::new(), at, deleted: true,
            }),
            _ => {}
        }
    }
    f.mutes = match (db::get_meta(conn, "mutes")?, db::get_meta(conn, "mutes_at")?) {
        (Some(w), Some(at)) => Some(MuteRec { words: serde_json::from_str(&w).unwrap_or_default(), at }),
        _ => None,
    };
    f.prefs = match (db::get_meta(conn, "prefs")?, db::get_meta(conn, "prefs_at")?) {
        (Some(p), Some(at)) => serde_json::from_str(&p).ok().map(|data| PrefsRec { data, at }),
        _ => None,
    };
    Ok(f)
}

// ---------------------------------------------------------------- merge another Mac

pub fn merge(conn: &mut Connection, remote: &SyncFile) -> rusqlite::Result<Applied> {
    let tx = conn.transaction()?;
    db::set_applying(&tx, true)?;
    let mut out = Applied::default();

    // Folders, by their id
    for r in &remote.folders {
        let local: Option<(i64, Option<String>)> = tx
            .query_row("SELECT id, updated_at FROM folders WHERE uid=?1", [&r.uid], |x| Ok((x.get(0)?, x.get(1)?)))
            .optional()?;
        if r.deleted {
            if let Some((id, at)) = local {
                if !newer(&at, &r.at) {
                    tx.execute("UPDATE feeds SET folder_id=NULL WHERE folder_id=?1", [id])?;
                    tx.execute("DELETE FROM folders WHERE id=?1", [id])?;
                    out.changes += 1;
                }
            }
            put_tombstone(&tx, "folder", &r.uid, &r.at)?;
            continue;
        }
        match local {
            Some((id, at)) => {
                if newer(&r.at, &at) {
                    let clash: bool = tx
                        .query_row("SELECT 1 FROM folders WHERE name=?1 COLLATE NOCASE AND id<>?2", params![r.name, id], |_| Ok(()))
                        .optional()?
                        .is_some();
                    if !clash {
                        tx.execute("UPDATE folders SET name=?1, updated_at=?2 WHERE id=?3", params![r.name, r.at, id])?;
                        out.changes += 1;
                    }
                }
            }
            None => {
                if newer(&tombstone(&tx, "folder", &r.uid)?, &r.at) {
                    continue; // deleted here after that change
                }
                // The same folder name made separately on each Mac becomes one folder.
                let same: Option<i64> =
                    tx.query_row("SELECT id FROM folders WHERE name=?1 COLLATE NOCASE", [&r.name], |x| x.get(0)).optional()?;
                match same {
                    Some(id) => {
                        let mine: Option<String> = tx.query_row("SELECT uid FROM folders WHERE id=?1", [id], |x| x.get(0))?;
                        // keep the smaller id on both Macs so they settle on the same one
                        if mine.as_deref().map_or(true, |m| r.uid.as_str() < m) {
                            tx.execute("UPDATE folders SET uid=?1 WHERE id=?2", params![r.uid, id])?;
                            out.changes += 1;
                        }
                    }
                    None => {
                        tx.execute("INSERT INTO folders(name, uid, updated_at) VALUES (?1, ?2, ?3)", params![r.name, r.uid, r.at])?;
                        out.changes += 1;
                    }
                }
            }
        }
    }

    // Feeds, by address
    for r in &remote.feeds {
        let local: Option<(i64, Option<String>)> = tx
            .query_row("SELECT id, updated_at FROM feeds WHERE url=?1", [&r.url], |x| Ok((x.get(0)?, x.get(1)?)))
            .optional()?;
        if r.deleted {
            if let Some((id, at)) = local {
                if !newer(&at, &r.at) {
                    tx.execute("DELETE FROM highlights WHERE item_id IN (SELECT id FROM items WHERE feed_id=?1)", [id])?;
                    tx.execute("DELETE FROM items WHERE feed_id=?1", [id])?;
                    tx.execute("DELETE FROM feeds WHERE id=?1", [id])?;
                    out.changes += 1;
                }
            }
            put_tombstone(&tx, "feed", &r.url, &r.at)?;
            continue;
        }
        let folder_id: Option<i64> = match &r.folder {
            Some(uid) => tx.query_row("SELECT id FROM folders WHERE uid=?1", [uid], |x| x.get(0)).optional()?,
            None => None,
        };
        match local {
            Some((id, at)) => {
                if newer(&r.at, &at) {
                    tx.execute(
                        "UPDATE feeds SET title=?1, folder_id=?2, updated_at=?3 WHERE id=?4",
                        params![r.title, folder_id, r.at, id],
                    )?;
                    out.changes += 1;
                }
            }
            None => {
                if newer(&tombstone(&tx, "feed", &r.url)?, &r.at) || tombstone(&tx, "feed", &r.url)?.is_some() && r.at.is_none() {
                    continue;
                }
                tx.execute(
                    "INSERT INTO feeds(url, title, folder_id, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    params![r.url, r.title, folder_id, r.at],
                )?;
                tx.execute("DELETE FROM tombstones WHERE kind='feed' AND key=?1", [&r.url])?;
                out.new_feeds.push(tx.last_insert_rowid());
                out.changes += 1;
            }
        }
    }

    // Read and saved marks, by story link
    for r in &remote.marks {
        let local: Option<(String, Option<String>)> = tx
            .query_row("SELECT id, marks_at FROM items WHERE link=?1 LIMIT 1", [&r.link], |x| Ok((x.get(0)?, x.get(1)?)))
            .optional()?;
        match local {
            Some((id, at)) => {
                if newer(&r.at, &at) {
                    tx.execute(
                        "UPDATE items SET read=?1, saved=?2, read_at=?3, marks_at=?4 WHERE id=?5",
                        params![r.read as i64, r.saved as i64, r.read_at, r.at, id],
                    )?;
                    out.changes += 1;
                }
            }
            None => {
                // A story saved or highlighted on the other Mac that this one doesn't have yet.
                let (Some(story), Some(fid)) = (
                    &r.story,
                    tx.query_row("SELECT id FROM feeds WHERE url=?1", [&r.feed], |x| x.get::<_, i64>(0)).optional()?,
                ) else {
                    continue;
                };
                let id = crate::feeds::item_id(fid, &r.link);
                tx.execute(
                    "INSERT OR IGNORE INTO items(id, feed_id, title, link, date, summary, image, read, saved, read_at, marks_at, fetched_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![id, fid, story.title, r.link, story.date, story.summary, story.image, r.read as i64, r.saved as i64,
                            r.read_at, r.at, crate::feeds::now_iso()],
                )?;
                out.changes += 1;
            }
        }
    }

    // Highlights and notes, by their id
    for r in &remote.highlights {
        let local: Option<(i64, Option<String>)> = tx
            .query_row("SELECT id, updated_at FROM highlights WHERE uid=?1", [&r.uid], |x| Ok((x.get(0)?, x.get(1)?)))
            .optional()?;
        if r.deleted {
            if let Some((id, at)) = local {
                if !newer(&at, &r.at) {
                    tx.execute("DELETE FROM highlights WHERE id=?1", [id])?;
                    out.changes += 1;
                }
            }
            put_tombstone(&tx, "highlight", &r.uid, &r.at)?;
            continue;
        }
        match local {
            Some((id, at)) => {
                if newer(&r.at, &at) {
                    tx.execute("UPDATE highlights SET text=?1, note=?2, updated_at=?3 WHERE id=?4", params![r.text, r.note, r.at, id])?;
                    out.changes += 1;
                }
            }
            None => {
                if tombstone(&tx, "highlight", &r.uid)?.is_some() {
                    continue;
                }
                let item: Option<String> =
                    tx.query_row("SELECT id FROM items WHERE link=?1 LIMIT 1", [&r.link], |x| x.get(0)).optional()?;
                let Some(item) = item else { continue }; // story not here yet; next sync will try again
                tx.execute(
                    "INSERT INTO highlights(item_id, text, note, start, created_at, uid, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![item, r.text, r.note, r.start, r.created_at, r.uid, r.at],
                )?;
                out.changes += 1;
            }
        }
    }

    // Muted words: the newest list wins.
    if let Some(m) = &remote.mutes {
        let local_at = db::get_meta(&tx, "mutes_at")?;
        if newer(&Some(m.at.clone()), &local_at) {
            db::set_meta(&tx, "mutes", &serde_json::to_string(&m.words).unwrap_or_else(|_| "[]".into()))?;
            db::set_meta(&tx, "mutes_at", &m.at)?;
            out.changes += 1;
        }
    }

    // Reading preferences: the newest set wins.
    if let Some(p) = &remote.prefs {
        let local_at = db::get_meta(&tx, "prefs_at")?;
        if newer(&Some(p.at.clone()), &local_at) {
            db::set_meta(&tx, "prefs", &p.data.to_string())?;
            db::set_meta(&tx, "prefs_at", &p.at)?;
            out.changes += 1;
        }
    }

    db::set_applying(&tx, false)?;
    tx.commit()?;
    Ok(out)
}

/// The first time this Mac finds another Mac's feeds, it lets go of starter feeds it never touched,
/// so a new Mac takes on your real list instead of adding the starters back to it.
pub fn join(conn: &mut Connection, peers: &[SyncFile]) -> rusqlite::Result<bool> {
    if db::get_meta(conn, "sync_joined")?.is_some() || !peers.iter().any(|p| p.feeds.iter().any(|f| !f.deleted)) {
        return Ok(false);
    }
    let tx = conn.transaction()?;
    db::set_applying(&tx, true)?;
    tx.execute("DELETE FROM items WHERE feed_id IN (SELECT id FROM feeds WHERE updated_at IS NULL) AND saved = 0
                AND id NOT IN (SELECT item_id FROM highlights)", [])?;
    tx.execute("DELETE FROM feeds WHERE updated_at IS NULL AND id NOT IN (SELECT feed_id FROM items)", [])?;
    db::set_applying(&tx, false)?;
    db::set_meta(&tx, "sync_joined", "1")?;
    tx.commit()?;
    Ok(true)
}

// ---------------------------------------------------------------- the shared folder

/// Read every other Mac's file. iCloud may keep a file in the cloud only (shown as a
/// `.name.json.icloud` placeholder); we ask macOS to download it and pick it up next time.
pub fn read_peers(dir: &Path, own_id: &str) -> Vec<SyncFile> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(".json.icloud") && name.starts_with('.') {
            let real = dir.join(name.trim_start_matches('.').trim_end_matches(".icloud"));
            let _ = std::process::Command::new("/usr/bin/brctl").arg("download").arg(&real).spawn();
            continue;
        }
        if !name.ends_with(".json") || name.starts_with('.') || name == format!("{own_id}.json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        match serde_json::from_str::<SyncFile>(&text) {
            Ok(f) if f.format <= FORMAT && f.device_id != own_id => out.push(f),
            _ => {} // half-written, or from a newer version of the app
        }
    }
    out
}

/// Write this Mac's file (via a temporary file, so other Macs never see half of it).
pub fn write_own(dir: &Path, file: &SyncFile) -> std::io::Result<()> {
    let tmp = dir.join(format!(".{}.writing", file.device_id));
    std::fs::write(&tmp, serde_json::to_vec_pretty(file)?)?;
    std::fs::rename(&tmp, dir.join(format!("{}.json", file.device_id)))
}

pub fn icloud_drive() -> Option<PathBuf> {
    let p = crate::bookmark::real_home()?.join("Library/Mobile Documents/com~apple~CloudDocs");
    // The sandboxed App Store version can't look there until you pick it, so assume it exists.
    (crate::bookmark::sandboxed() || p.is_dir()).then_some(p)
}

/// Set at launch on iPhone and iPad, where the name comes from the system.
pub static DEVICE_NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn device_name() -> String {
    if let Some(n) = DEVICE_NAME.get() {
        return n.clone();
    }
    if cfg!(target_os = "macos") {
        if let Ok(out) = std::process::Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).output() {
            let n = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !n.is_empty() {
                return n;
            }
        }
    }
    std::env::var("HOSTNAME").ok().filter(|h| !h.is_empty()).unwrap_or_else(|| "This computer".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn muted_words_travel_newest_wins() {
        let (mut a, _da) = fresh("mute-a");
        let (mut b, _db) = fresh("mute-b");
        db::set_meta(&a, "mutes", r#"["crypto"]"#).unwrap();
        db::set_meta(&a, "mutes_at", "2026-10-30T08:00:00.000Z").unwrap();
        let fa = export(&a, "a", "A").unwrap();
        assert_eq!(fa.mutes.as_ref().unwrap().words, vec!["crypto".to_string()]);
        merge(&mut b, &fa).unwrap();
        assert_eq!(db::get_meta(&b, "mutes").unwrap().as_deref(), Some(r#"["crypto"]"#));
        // an older list doesn't overwrite a newer one
        db::set_meta(&b, "mutes", r#"["crypto","football"]"#).unwrap();
        db::set_meta(&b, "mutes_at", "2026-10-30T09:00:00.000Z").unwrap();
        merge(&mut b, &fa).unwrap();
        assert!(db::get_meta(&b, "mutes").unwrap().unwrap().contains("football"));
        let fb = export(&b, "b", "B").unwrap();
        merge(&mut a, &fb).unwrap();
        assert!(db::get_meta(&a, "mutes").unwrap().unwrap().contains("football"));
    }

    #[test]
    fn prefs_travel_newest_wins() {
        let (mut a, _da) = fresh("prefs-a");
        let (mut b, _db) = fresh("prefs-b");
        db::set_meta(&a, "prefs", r#"{"kinds":{"https://x.blog/feed":"person"}}"#).unwrap();
        db::set_meta(&a, "prefs_at", "2026-10-30T08:00:00.000Z").unwrap();
        let fa = export(&a, "a", "A").unwrap();
        merge(&mut b, &fa).unwrap();
        assert!(db::get_meta(&b, "prefs").unwrap().unwrap().contains("x.blog"));
        db::set_meta(&b, "prefs", r#"{"hidden":["Bitcoinist.com"]}"#).unwrap();
        db::set_meta(&b, "prefs_at", "2026-10-30T09:00:00.000Z").unwrap();
        merge(&mut b, &fa).unwrap();
        assert!(db::get_meta(&b, "prefs").unwrap().unwrap().contains("Bitcoinist"));
        let fb = export(&b, "b", "B").unwrap();
        merge(&mut a, &fb).unwrap();
        assert!(db::get_meta(&a, "prefs").unwrap().unwrap().contains("Bitcoinist"));
    }

    fn fresh(name: &str) -> (Connection, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("rr-sync-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = db::open(&dir.join("r.db"), false).unwrap();
        (conn, dir)
    }

    fn story(conn: &mut Connection, feed: i64, link: &str) -> String {
        let f = db::feed(conn, feed).unwrap().unwrap();
        let it = db::NewItem { id: crate::feeds::item_id(feed, link), title: format!("T {link}"), link: link.into(),
            date: "2026-10-28T00:00:00Z".into(), summary: "s".into(), image: String::new() };
        db::store_fetch(conn, &f, "", "", &[it], "2026-10-28T00:00:00Z").unwrap();
        crate::feeds::item_id(feed, link)
    }

    fn pause() { std::thread::sleep(std::time::Duration::from_millis(5)); }

    #[test]
    fn two_macs_converge() {
        let (mut a, _da) = fresh("a");
        let (mut b, _db) = fresh("b");

        // iMac: a folder, a feed in it, a read story, a saved story with a highlight
        let folder = db::folder_named(&a, "Web Design").unwrap();
        let fa = db::add_feed(&a, "https://ex.com/feed", "Ex", "", Some(folder)).unwrap();
        let s1 = story(&mut a, fa, "https://ex.com/1");
        let s2 = story(&mut a, fa, "https://ex.com/2");
        db::mark(&mut a, &[s1.clone()], Some(true), None, "2026-10-28T01:00:00Z").unwrap();
        db::mark(&mut a, &[s2.clone()], None, Some(true), "2026-10-28T01:00:00Z").unwrap();
        db::add_highlight(&a, &s2, "a passage", "a note", 3, "2026-10-28T01:00:00Z").unwrap();

        // MacBook catches up
        let fa_file = export(&a, "A", "iMac").unwrap();
        let got = merge(&mut b, &fa_file).unwrap();
        assert_eq!(got.new_feeds.len(), 1);
        let fb = db::feeds(&b).unwrap();
        assert_eq!(fb[0].title, "Ex");
        assert_eq!(db::folders(&b).unwrap()[0].name, "Web Design");
        assert!(fb[0].folder_id.is_some());
        let items = db::items(&b, 50).unwrap();
        assert_eq!(items.len(), 1, "the saved story comes over; the merely-read one waits for a refresh");
        assert!(items[0].saved);
        assert_eq!(db::highlights(&b).unwrap()[0].note, "a note");

        // MacBook later downloads story 1 itself: the read mark applies on the next sync
        let fb_id = fb[0].id;
        story(&mut b, fb_id, "https://ex.com/1");
        merge(&mut b, &fa_file).unwrap();
        assert!(db::items(&b, 50).unwrap().iter().find(|i| i.link.ends_with("/1")).unwrap().read);

        // MacBook renames the folder and edits the note; iMac picks that up
        pause();
        let bf = db::folders(&b).unwrap()[0].id;
        db::rename_folder(&b, bf, "Design").unwrap();
        let bh = db::highlights(&b).unwrap()[0].id;
        db::set_note(&b, bh, "edited on the MacBook").unwrap();
        merge(&mut a, &export(&b, "B", "MacBook").unwrap()).unwrap();
        assert_eq!(db::folders(&a).unwrap()[0].name, "Design");
        assert_eq!(db::highlights(&a).unwrap()[0].note, "edited on the MacBook");

        // iMac unfollows the feed; MacBook removes it too, and doesn't bring it back
        pause();
        db::remove_feed(&a, fa).unwrap();
        let after = export(&a, "A", "iMac").unwrap();
        merge(&mut b, &after).unwrap();
        assert!(db::feeds(&b).unwrap().is_empty());
        merge(&mut a, &export(&b, "B", "MacBook").unwrap()).unwrap();
        assert!(db::feeds(&a).unwrap().is_empty());

        // A second merge of the same file changes nothing
        assert_eq!(merge(&mut b, &after).unwrap().changes, 0);
    }

    #[test]
    fn new_mac_drops_untouched_starters() {
        let (a, _da) = fresh("e");
        let dir = std::env::temp_dir().join(format!("rr-sync-{}-f", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut b = db::open(&dir.join("r.db"), true).unwrap(); // brand new: starter feeds
        assert_eq!(db::feeds(&b).unwrap().len(), db::DEFAULT_FEEDS.len());
        assert!(export(&b, "B", "b").unwrap().feeds.is_empty(), "untouched starters aren't shared");
        db::add_feed(&a, "https://mine.com/feed", "Mine", "", None).unwrap();
        let peer = export(&a, "A", "a").unwrap();
        assert!(join(&mut b, &[peer.clone()]).unwrap());
        merge(&mut b, &peer).unwrap();
        let urls: Vec<_> = db::feeds(&b).unwrap().into_iter().map(|f| f.url).collect();
        assert_eq!(urls, vec!["https://mine.com/feed".to_string()]);
        assert!(!join(&mut b, &[peer]).unwrap(), "only happens once");
    }

    #[test]
    fn same_folder_made_on_both_macs_becomes_one() {
        let (mut a, _da) = fresh("c");
        let (mut b, _db) = fresh("d");
        db::folder_named(&a, "Crypto").unwrap();
        db::folder_named(&b, "Crypto").unwrap();
        merge(&mut b, &export(&a, "A", "a").unwrap()).unwrap();
        merge(&mut a, &export(&b, "B", "b").unwrap()).unwrap();
        let ua = export(&a, "A", "a").unwrap().folders;
        let ub = export(&b, "B", "b").unwrap().folders;
        assert_eq!(ua.len(), 1);
        assert_eq!(ua[0].uid, ub[0].uid);
    }
}
