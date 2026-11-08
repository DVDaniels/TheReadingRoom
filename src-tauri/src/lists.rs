//! Followed lists ("dynamic OPML"): you follow the address of an OPML file instead of importing a copy.
//! The app checks the list now and then, follows feeds that join it and points out feeds that left it.
//!
//! What you follow travels to your other devices with sync (meta `lists`, newest wins, like muted words).
//! What each device last saw in a list stays on that device (meta `lists_local`), so a check here never
//! counts as a change to sync.

use crate::db;
use crate::opml::Outline;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// How often a list is checked again (it changes far less often than a feed).
pub const CHECK_HOURS: i64 = 12;
/// Lists bigger than this are cut off, so one huge file can't flood your reader.
pub const MAX_FEEDS: usize = 500;

fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ListSub {
    pub url: String,
    pub title: String,
    /// The folder its feeds go in (the folder's sync id)
    #[serde(default)]
    pub folder: Option<String>,
    /// Follow feeds that join the list without asking
    #[serde(default = "yes")]
    pub auto_add: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Local {
    #[serde(default)]
    pub checked: Option<String>,
    #[serde(default)]
    pub error: String,
    /// Feed addresses in the list at the last check
    #[serde(default)]
    pub seen: Vec<String>,
    /// Feeds you follow that have left the list since
    #[serde(default)]
    pub gone: Vec<String>,
    /// New feeds waiting for a yes (when automatic adding is off): (address, name)
    #[serde(default)]
    pub pending: Vec<(String, String)>,
}

/// What the page shows for each list.
#[derive(Serialize, Clone, Debug)]
pub struct ListView {
    pub url: String,
    pub title: String,
    pub folder_id: Option<i64>,
    pub auto_add: bool,
    pub count: usize,
    pub checked: Option<String>,
    pub error: String,
    pub gone: Vec<String>,
    pub pending: Vec<Pending>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Pending {
    pub url: String,
    pub title: String,
}

#[derive(Default, Debug)]
pub struct Applied {
    pub new_ids: Vec<i64>,
    pub pending: usize,
    pub left: usize,
}

fn stamp() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn subs(conn: &Connection) -> rusqlite::Result<Vec<ListSub>> {
    Ok(db::get_meta(conn, "lists")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

/// Save what you follow; it's a change your other devices should hear about.
pub fn save_subs(conn: &Connection, subs: &[ListSub]) -> rusqlite::Result<()> {
    db::set_meta(conn, "lists", &serde_json::to_string(subs).unwrap_or_else(|_| "[]".into()))?;
    db::set_meta(conn, "lists_at", &stamp())
}

fn locals(conn: &Connection) -> rusqlite::Result<HashMap<String, Local>> {
    Ok(db::get_meta(conn, "lists_local")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

fn save_locals(conn: &Connection, l: &HashMap<String, Local>) -> rusqlite::Result<()> {
    db::set_meta(conn, "lists_local", &serde_json::to_string(l).unwrap_or_else(|_| "{}".into()))
}

fn folder_id(conn: &Connection, uid: &Option<String>) -> rusqlite::Result<Option<i64>> {
    match uid {
        Some(u) => conn.query_row("SELECT id FROM folders WHERE uid=?1", [u], |r| r.get(0)).optional(),
        None => Ok(None),
    }
}

fn feed_was_removed(conn: &Connection, url: &str) -> rusqlite::Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM tombstones WHERE kind='feed' AND key=?1", [url], |_| Ok(())).optional()?.is_some())
}

/// Lists due for another look (never checked here, or not for a while).
pub fn due(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let l = locals(conn)?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::hours(CHECK_HOURS)).format("%Y-%m-%dT%H:%M:%SZ").to_string();
    Ok(subs(conn)?
        .into_iter()
        .filter(|s| l.get(&s.url).and_then(|x| x.checked.clone()).map_or(true, |c| c < cutoff))
        .map(|s| s.url)
        .collect())
}

pub fn views(conn: &Connection) -> rusqlite::Result<Vec<ListView>> {
    let l = locals(conn)?;
    let mut out = Vec::new();
    for s in subs(conn)? {
        let loc = l.get(&s.url).cloned().unwrap_or_default();
        out.push(ListView {
            folder_id: folder_id(conn, &s.folder)?,
            count: loc.seen.len(),
            checked: loc.checked,
            error: loc.error,
            gone: loc.gone,
            pending: loc.pending.into_iter().map(|(url, title)| Pending { url, title }).collect(),
            url: s.url,
            title: s.title,
            auto_add: s.auto_add,
        });
    }
    Ok(out)
}

/// Start following a list. Returns false if you already follow it.
pub fn subscribe(conn: &Connection, url: &str, title: &str) -> rusqlite::Result<bool> {
    let mut all = subs(conn)?;
    if all.iter().any(|s| s.url == url) {
        return Ok(false);
    }
    // Its own folder, named after the list (a second list with the same name gets a number).
    let mut name: String = title.trim().chars().take(60).collect();
    if name.is_empty() {
        name = "Followed list".into();
    }
    let base = name.clone();
    let mut n = 2;
    while db::folder_name_taken(conn, &name, None)? && all.iter().any(|s| s.title.eq_ignore_ascii_case(&name)) {
        name = format!("{base} {n}");
        n += 1;
    }
    let fid = db::folder_named(conn, &name)?;
    let uid: Option<String> = conn.query_row("SELECT uid FROM folders WHERE id=?1", [fid], |r| r.get(0))?;
    all.push(ListSub { url: url.into(), title: name, folder: uid, auto_add: true });
    save_subs(conn, &all)?;
    Ok(true)
}

/// Bring this device up to date with what a list holds now.
/// `first` is the check right after you followed it: everything in the list is followed.
pub fn apply(conn: &Connection, url: &str, outlines: &[Outline], first: bool, now: &str) -> rusqlite::Result<Applied> {
    let mut out = Applied::default();
    let mut all = subs(conn)?;
    let Some(pos) = all.iter().position(|s| s.url == url) else { return Ok(out) };
    let mut l = locals(conn)?;
    let mut loc = l.remove(url).unwrap_or_default();
    // Never looked at on this device (it came from another one): feeds you unfollowed somewhere stay unfollowed.
    let fresh_here = loc.checked.is_none();

    let mut urls: Vec<String> = Vec::new();
    let mut entries: Vec<&Outline> = Vec::new();
    for o in outlines {
        if urls.len() >= MAX_FEEDS {
            break;
        }
        if !urls.contains(&o.url) {
            urls.push(o.url.clone());
            entries.push(o);
        }
    }

    let auto = all[pos].auto_add;
    // The list's folder, made again if it was deleted
    let mut fid = folder_id(conn, &all[pos].folder)?;
    let mut make_folder = || -> rusqlite::Result<i64> {
        if let Some(id) = fid {
            return Ok(id);
        }
        let id = db::folder_named(conn, &all[pos].title)?;
        all[pos].folder = conn.query_row("SELECT uid FROM folders WHERE id=?1", [id], |r| r.get(0))?;
        save_subs(conn, &all)?;
        fid = Some(id);
        Ok(id)
    };

    for o in &entries {
        if db::url_exists(conn, &o.url)? {
            continue;
        }
        let joined = fresh_here || !loc.seen.contains(&o.url);
        if !joined {
            continue; // was in the list before and you unfollowed it: leave it be
        }
        if !first && feed_was_removed(conn, &o.url)? {
            continue;
        }
        if first || auto {
            let folder = make_folder()?;
            if let Some(id) = db::add_feed_if_new(conn, &o.url, &o.title, Some(folder))? {
                out.new_ids.push(id);
            }
        } else if !loc.pending.iter().any(|(u, _)| u == &o.url) {
            loc.pending.push((o.url.clone(), o.title.clone()));
            out.pending += 1;
        }
    }

    // Feeds that left the list, and that you still follow
    for s in &loc.seen {
        if !urls.contains(s) && !loc.gone.contains(s) && db::url_exists(conn, s)? {
            loc.gone.push(s.clone());
            out.left += 1;
        }
    }
    let mut gone = std::mem::take(&mut loc.gone);
    gone.retain(|g| !urls.contains(g) && db::url_exists(conn, g).unwrap_or(false));
    loc.gone = gone;
    let mut pending = std::mem::take(&mut loc.pending);
    pending.retain(|(u, _)| urls.contains(u) && !db::url_exists(conn, u).unwrap_or(true));
    loc.pending = pending;

    loc.seen = urls;
    loc.checked = Some(now.into());
    loc.error.clear();
    l.insert(url.into(), loc);
    save_locals(conn, &l)?;
    Ok(out)
}

/// Remember that a check failed (the feeds you have stay as they are).
pub fn failed(conn: &Connection, url: &str, msg: &str, now: &str) -> rusqlite::Result<()> {
    let mut l = locals(conn)?;
    let loc = l.entry(url.into()).or_default();
    loc.error = msg.into();
    loc.checked = Some(now.into());
    save_locals(conn, &l)
}

pub fn set_auto(conn: &Connection, url: &str, on: bool) -> rusqlite::Result<()> {
    let mut all = subs(conn)?;
    if let Some(s) = all.iter_mut().find(|s| s.url == url) {
        s.auto_add = on;
        save_subs(conn, &all)?;
    }
    Ok(())
}

/// Keep following a feed that left the list (it stops being pointed out).
pub fn keep(conn: &Connection, url: &str, feed_url: &str) -> rusqlite::Result<()> {
    let mut l = locals(conn)?;
    if let Some(loc) = l.get_mut(url) {
        loc.gone.retain(|g| g != feed_url);
        save_locals(conn, &l)?;
    }
    Ok(())
}

/// Follow the new feeds that were waiting, or (when `follow` is false) let them go.
pub fn take_pending(conn: &Connection, url: &str, follow: bool) -> rusqlite::Result<Vec<i64>> {
    let mut l = locals(conn)?;
    let Some(loc) = l.get_mut(url) else { return Ok(vec![]) };
    let waiting = std::mem::take(&mut loc.pending);
    save_locals(conn, &l)?;
    let mut ids = Vec::new();
    if follow && !waiting.is_empty() {
        let all = subs(conn)?;
        let Some(s) = all.iter().find(|s| s.url == url) else { return Ok(ids) };
        let fid = match folder_id(conn, &s.folder)? {
            Some(id) => id,
            None => db::folder_named(conn, &s.title)?,
        };
        for (u, t) in waiting {
            if let Some(id) = db::add_feed_if_new(conn, &u, &t, Some(fid))? {
                ids.push(id);
            }
        }
    }
    Ok(ids)
}

/// Stop following a list. Its feeds stay (in their folder) unless `remove_feeds`.
pub fn unsubscribe(conn: &Connection, url: &str, remove_feeds: bool) -> rusqlite::Result<usize> {
    let mut all = subs(conn)?;
    let Some(pos) = all.iter().position(|s| s.url == url) else { return Ok(0) };
    let sub = all.remove(pos);
    save_subs(conn, &all)?;
    let mut l = locals(conn)?;
    let loc = l.remove(url).unwrap_or_default();
    save_locals(conn, &l)?;
    let mut removed = 0;
    if remove_feeds {
        let fid = folder_id(conn, &sub.folder)?;
        for u in loc.seen.iter().chain(loc.gone.iter()) {
            let id: Option<i64> = conn.query_row("SELECT id FROM feeds WHERE url=?1", [u], |r| r.get(0)).optional()?;
            if let Some(id) = id {
                db::remove_feed(conn, id)?;
                removed += 1;
            }
        }
        if let Some(fid) = fid {
            let left: i64 = conn.query_row("SELECT COUNT(*) FROM feeds WHERE folder_id=?1", params![fid], |r| r.get(0))?;
            if left == 0 {
                db::delete_folder(conn, fid)?;
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh(name: &str) -> (Connection, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("rr-lists-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (db::open(&dir.join("t.db"), false).unwrap(), dir)
    }
    fn o(url: &str) -> Outline {
        Outline { url: url.into(), title: url.trim_start_matches("https://").into(), folder: None, parent: None }
    }
    const L: &str = "https://club.example/list.opml";

    #[test]
    fn follows_joins_and_points_out_leavers() {
        let (c, dir) = fresh("flow");
        assert!(subscribe(&c, L, "RSS Club").unwrap());
        assert!(!subscribe(&c, L, "RSS Club").unwrap());
        let a = apply(&c, L, &[o("https://a.blog/feed"), o("https://b.blog/feed")], true, "2026-11-06T10:00:00Z").unwrap();
        assert_eq!(a.new_ids.len(), 2);
        let v = &views(&c).unwrap()[0];
        assert_eq!((v.count, v.title.as_str()), (2, "RSS Club"));
        let fid = v.folder_id.unwrap();
        assert!(db::feeds(&c).unwrap().iter().all(|f| f.folder_id == Some(fid)));

        // c joins, b leaves
        let a = apply(&c, L, &[o("https://a.blog/feed"), o("https://c.blog/feed")], false, "2026-11-07T10:00:00Z").unwrap();
        assert_eq!((a.new_ids.len(), a.left), (1, 1));
        assert_eq!(views(&c).unwrap()[0].gone, vec!["https://b.blog/feed".to_string()]);
        keep(&c, L, "https://b.blog/feed").unwrap();
        assert!(views(&c).unwrap()[0].gone.is_empty());

        // you unfollow a; it stays unfollowed on the next check
        let id = db::feeds(&c).unwrap().into_iter().find(|f| f.url == "https://a.blog/feed").unwrap().id;
        db::remove_feed(&c, id).unwrap();
        let a = apply(&c, L, &[o("https://a.blog/feed"), o("https://c.blog/feed")], false, "2026-11-08T10:00:00Z").unwrap();
        assert!(a.new_ids.is_empty());

        // with automatic adding off, newcomers wait
        set_auto(&c, L, false).unwrap();
        let a = apply(&c, L, &[o("https://c.blog/feed"), o("https://d.blog/feed")], false, "2026-11-09T10:00:00Z").unwrap();
        assert_eq!((a.new_ids.len(), a.pending), (0, 1));
        assert_eq!(take_pending(&c, L, true).unwrap().len(), 1);
        assert!(views(&c).unwrap()[0].pending.is_empty());

        // unfollow the list and its feeds; the empty folder goes too
        let n = unsubscribe(&c, L, true).unwrap();
        assert!(n >= 2);
        assert!(views(&c).unwrap().is_empty());
        // b, which you chose to keep after it left the list, stays (and so does its folder)
        let left: Vec<_> = db::feeds(&c).unwrap().into_iter().map(|f| (f.url, f.folder_id)).collect();
        assert_eq!(left, vec![("https://b.blog/feed".to_string(), Some(fid))]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn another_device_respects_unfollows() {
        let (c, dir) = fresh("peer");
        subscribe(&c, L, "Club").unwrap();
        // this device never checked the list, but you'd unfollowed b somewhere
        c.execute("INSERT INTO tombstones VALUES ('feed', 'https://b.blog/feed', '2026-11-01T00:00:00Z')", []).unwrap();
        let a = apply(&c, L, &[o("https://a.blog/feed"), o("https://b.blog/feed")], false, &crate::feeds::now_iso()).unwrap();
        assert_eq!(a.new_ids.len(), 1);
        assert!(due(&c).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
