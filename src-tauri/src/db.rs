//! Storage: one SQLite file in the app's data folder.
//! The schema matches the earlier Python version, so its reader.db can be carried over as-is.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

pub const KEEP_PER_FEED: i64 = 200;

pub const DEFAULT_FEEDS: &[(&str, &str)] = &[
    ("Adactio: Journal", "https://adactio.com/journal/rss"),
    ("Smashing Magazine", "https://www.smashingmagazine.com/feed/"),
    ("Chris Coyier", "https://chriscoyier.net/feed/"),
    ("Jim Nielsen", "https://blog.jim-nielsen.com/feed.xml"),
    ("DavidDaniels.com", "https://daviddaniels.com/feed/"),
];

#[derive(Serialize, Clone, Debug)]
pub struct Feed {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub site: String,
    pub status: String,
    pub error: String,
    pub last_fetched: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Item {
    pub id: String,
    pub feed_id: i64,
    pub title: String,
    pub link: String,
    pub date: String,
    pub summary: String,
    pub read: bool,
    pub saved: bool,
}

pub struct NewItem {
    pub id: String,
    pub title: String,
    pub link: String,
    pub date: String,
    pub summary: String,
}

pub fn open(path: &Path, seed_defaults: bool) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS feeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            site TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            error TEXT DEFAULT '',
            last_fetched TEXT
        );
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            feed_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            link TEXT DEFAULT '',
            date TEXT NOT NULL,
            summary TEXT DEFAULT '',
            read INTEGER DEFAULT 0,
            saved INTEGER DEFAULT 0,
            fetched_at TEXT
        );
        CREATE INDEX IF NOT EXISTS items_feed_date ON items(feed_id, date);
        CREATE INDEX IF NOT EXISTS items_feed_link ON items(feed_id, link);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);",
    )?;
    if seed_defaults {
        for (title, url) in DEFAULT_FEEDS {
            conn.execute("INSERT OR IGNORE INTO feeds(url, title) VALUES (?1, ?2)", params![url, title])?;
        }
    }
    Ok(conn)
}

fn feed_from_row(r: &rusqlite::Row) -> rusqlite::Result<Feed> {
    Ok(Feed {
        id: r.get(0)?,
        url: r.get(1)?,
        title: r.get(2)?,
        site: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
        status: r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "pending".into()),
        error: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
        last_fetched: r.get(6)?,
    })
}

const FEED_COLS: &str = "id, url, title, site, status, error, last_fetched";

pub fn feeds(conn: &Connection) -> rusqlite::Result<Vec<Feed>> {
    let mut st = conn.prepare(&format!("SELECT {FEED_COLS} FROM feeds ORDER BY title COLLATE NOCASE"))?;
    let rows = st.query_map([], feed_from_row)?;
    rows.collect()
}

pub fn feeds_by_ids(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<Feed>> {
    Ok(feeds(conn)?.into_iter().filter(|f| ids.contains(&f.id)).collect())
}

pub fn feed(conn: &Connection, id: i64) -> rusqlite::Result<Option<Feed>> {
    conn.query_row(&format!("SELECT {FEED_COLS} FROM feeds WHERE id=?1"), [id], feed_from_row)
        .optional()
}

pub fn items(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<Item>> {
    let mut st = conn.prepare(
        "SELECT id, feed_id, title, link, date, summary, read, saved FROM items ORDER BY date DESC LIMIT ?1",
    )?;
    let rows = st.query_map([limit], |r| {
        Ok(Item {
            id: r.get(0)?,
            feed_id: r.get(1)?,
            title: r.get(2)?,
            link: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            date: r.get(4)?,
            summary: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            read: r.get::<_, i64>(6)? != 0,
            saved: r.get::<_, i64>(7)? != 0,
        })
    })?;
    rows.collect()
}

pub fn unread_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM items WHERE read=0", [], |r| r.get(0))
}

pub fn url_exists(conn: &Connection, url: &str) -> rusqlite::Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM feeds WHERE url=?1", [url], |_| Ok(())).optional()?.is_some())
}

pub fn add_feed(conn: &Connection, url: &str, title: &str, site: &str) -> rusqlite::Result<i64> {
    conn.execute("INSERT INTO feeds(url, title, site) VALUES (?1, ?2, ?3)", params![url, title, site])?;
    Ok(conn.last_insert_rowid())
}

/// Insert a feed if it isn't there yet; returns the new id when one was added.
pub fn add_feed_if_new(conn: &Connection, url: &str, title: &str) -> rusqlite::Result<Option<i64>> {
    let n = conn.execute("INSERT OR IGNORE INTO feeds(url, title) VALUES (?1, ?2)", params![url, title])?;
    Ok(if n > 0 { Some(conn.last_insert_rowid()) } else { None })
}

pub fn remove_feed(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM items WHERE feed_id=?1", [id])?;
    conn.execute("DELETE FROM feeds WHERE id=?1", [id])?;
    Ok(())
}

pub fn rename_feed(conn: &Connection, id: i64, title: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE feeds SET title=?1 WHERE id=?2", params![title, id])?;
    Ok(())
}

pub fn mark(conn: &mut Connection, ids: &[String], read: Option<bool>, saved: Option<bool>) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for id in ids {
        if let Some(v) = read {
            tx.execute("UPDATE items SET read=?1 WHERE id=?2", params![v as i64, id])?;
        }
        if let Some(v) = saved {
            tx.execute("UPDATE items SET saved=?1 WHERE id=?2", params![v as i64, id])?;
        }
    }
    tx.commit()
}

pub fn feed_error(conn: &Connection, id: i64, msg: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE feeds SET status='error', error=?1, last_fetched=?2 WHERE id=?3",
        params![msg, now, id],
    )?;
    Ok(())
}

/// Store a successful fetch. Returns how many stories were new.
pub fn store_fetch(
    conn: &mut Connection,
    feed: &Feed,
    fetched_title: &str,
    site: &str,
    items: &[NewItem],
    now: &str,
) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut added = 0;
    for it in items {
        // Skip a story we already have, by id or by link (covers stories carried over from older versions).
        let known: bool = tx
            .query_row(
                "SELECT 1 FROM items WHERE id=?1 OR (feed_id=?2 AND link<>'' AND link=?3)",
                params![it.id, feed.id, it.link],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if known {
            continue;
        }
        tx.execute(
            "INSERT INTO items(id, feed_id, title, link, date, summary, fetched_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![it.id, feed.id, it.title, it.link, it.date, it.summary, now],
        )?;
        added += 1;
    }
    // Replace a placeholder name (the bare web address) with the feed's own title.
    let host = url::Url::parse(&feed.url).ok().and_then(|u| u.host_str().map(|h| h.to_string())).unwrap_or_default();
    let title = if !fetched_title.is_empty() && (feed.title.is_empty() || feed.title == host) {
        fetched_title.to_string()
    } else {
        feed.title.clone()
    };
    let site = if site.is_empty() { feed.site.clone() } else { site.to_string() };
    tx.execute(
        "UPDATE feeds SET status='ok', error='', site=?1, title=?2, last_fetched=?3 WHERE id=?4",
        params![site, title, now, feed.id],
    )?;
    tx.execute(
        "DELETE FROM items WHERE feed_id=?1 AND saved=0 AND id NOT IN
           (SELECT id FROM items WHERE feed_id=?1 ORDER BY date DESC LIMIT ?2)",
        params![feed.id, KEEP_PER_FEED],
    )?;
    tx.commit()?;
    Ok(added)
}

pub fn get_meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)", params![key, value])?;
    Ok(())
}
