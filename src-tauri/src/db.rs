//! Storage: one SQLite file in the app's data folder.
//! The base schema matches the earlier Python version, so its reader.db can be carried over;
//! newer columns and tables are added on open.

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
pub struct Folder {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Feed {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub site: String,
    pub status: String,
    pub error: String,
    pub last_fetched: Option<String>,
    pub folder_id: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Item {
    pub id: String,
    pub feed_id: i64,
    pub title: String,
    pub link: String,
    pub date: String,
    pub summary: String,
    pub image: String,
    pub read: bool,
    pub saved: bool,
    pub read_at: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Highlight {
    pub id: i64,
    pub item_id: String,
    pub text: String,
    pub note: String,
    pub start: i64,
    pub created_at: String,
}

pub struct Cached {
    pub html: String,
    pub byline: String,
}

pub struct NewItem {
    pub id: String,
    pub title: String,
    pub link: String,
    pub date: String,
    pub summary: String,
    pub image: String,
}

fn has_column(conn: &Connection, table: &str, col: &str) -> rusqlite::Result<bool> {
    let mut st = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = st.query_map([], |r| r.get::<_, String>(1))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names.iter().any(|n| n == col))
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
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL COLLATE NOCASE
        );
        CREATE TABLE IF NOT EXISTS highlights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            text TEXT NOT NULL,
            note TEXT DEFAULT '',
            start INTEGER DEFAULT -1,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS highlights_item ON highlights(item_id);
        CREATE INDEX IF NOT EXISTS items_feed_date ON items(feed_id, date);
        CREATE INDEX IF NOT EXISTS items_feed_link ON items(feed_id, link);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);",
    )?;
    // Version 0.2 additions
    if !has_column(&conn, "feeds", "folder_id")? {
        conn.execute("ALTER TABLE feeds ADD COLUMN folder_id INTEGER", [])?;
    }
    if !has_column(&conn, "items", "image")? {
        conn.execute("ALTER TABLE items ADD COLUMN image TEXT DEFAULT ''", [])?;
    }
    if !has_column(&conn, "items", "read_at")? {
        conn.execute("ALTER TABLE items ADD COLUMN read_at TEXT", [])?;
    }
    // Version 0.3 additions: the reader's cached copy of each article
    if !has_column(&conn, "items", "content")? {
        conn.execute("ALTER TABLE items ADD COLUMN content TEXT", [])?;
    }
    if !has_column(&conn, "items", "byline")? {
        conn.execute("ALTER TABLE items ADD COLUMN byline TEXT", [])?;
    }
    if seed_defaults {
        for (title, url) in DEFAULT_FEEDS {
            conn.execute("INSERT OR IGNORE INTO feeds(url, title) VALUES (?1, ?2)", params![url, title])?;
        }
    }
    Ok(conn)
}

// ---------------------------------------------------------------- folders

pub fn folders(conn: &Connection) -> rusqlite::Result<Vec<Folder>> {
    let mut st = conn.prepare("SELECT id, name FROM folders ORDER BY name COLLATE NOCASE")?;
    let rows = st.query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)? }))?;
    rows.collect()
}

/// The id of the folder with this name, creating it if needed.
pub fn folder_named(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    if let Some(id) = conn
        .query_row("SELECT id FROM folders WHERE name=?1 COLLATE NOCASE", [name], |r| r.get(0))
        .optional()?
    {
        return Ok(id);
    }
    conn.execute("INSERT INTO folders(name) VALUES (?1)", [name])?;
    Ok(conn.last_insert_rowid())
}

pub fn folder_name_taken(conn: &Connection, name: &str, except: Option<i64>) -> rusqlite::Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM folders WHERE name=?1 COLLATE NOCASE AND id<>?2",
            params![name, except.unwrap_or(-1)],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub fn rename_folder(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE folders SET name=?1 WHERE id=?2", params![name, id])?;
    Ok(())
}

/// Delete a folder; its feeds stay, unfiled.
pub fn delete_folder(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE feeds SET folder_id=NULL WHERE folder_id=?1", [id])?;
    conn.execute("DELETE FROM folders WHERE id=?1", [id])?;
    Ok(())
}

pub fn set_feed_folder(conn: &Connection, feed_id: i64, folder_id: Option<i64>) -> rusqlite::Result<()> {
    conn.execute("UPDATE feeds SET folder_id=?1 WHERE id=?2", params![folder_id, feed_id])?;
    Ok(())
}

// ---------------------------------------------------------------- feeds

fn feed_from_row(r: &rusqlite::Row) -> rusqlite::Result<Feed> {
    Ok(Feed {
        id: r.get(0)?,
        url: r.get(1)?,
        title: r.get(2)?,
        site: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
        status: r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "pending".into()),
        error: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
        last_fetched: r.get(6)?,
        folder_id: r.get(7)?,
    })
}

const FEED_COLS: &str = "id, url, title, site, status, error, last_fetched, folder_id";

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

pub fn url_exists(conn: &Connection, url: &str) -> rusqlite::Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM feeds WHERE url=?1", [url], |_| Ok(())).optional()?.is_some())
}

pub fn add_feed(conn: &Connection, url: &str, title: &str, site: &str, folder_id: Option<i64>) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO feeds(url, title, site, folder_id) VALUES (?1, ?2, ?3, ?4)",
        params![url, title, site, folder_id],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert a feed if it isn't there yet; returns the new id when one was added.
/// An existing feed with no folder is moved into `folder_id`.
pub fn add_feed_if_new(conn: &Connection, url: &str, title: &str, folder_id: Option<i64>) -> rusqlite::Result<Option<i64>> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO feeds(url, title, folder_id) VALUES (?1, ?2, ?3)",
        params![url, title, folder_id],
    )?;
    if n > 0 {
        return Ok(Some(conn.last_insert_rowid()));
    }
    if folder_id.is_some() {
        conn.execute("UPDATE feeds SET folder_id=?1 WHERE url=?2 AND folder_id IS NULL", params![folder_id, url])?;
    }
    Ok(None)
}

pub fn remove_feed(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM highlights WHERE item_id IN (SELECT id FROM items WHERE feed_id=?1)", [id])?;
    conn.execute("DELETE FROM items WHERE feed_id=?1", [id])?;
    conn.execute("DELETE FROM feeds WHERE id=?1", [id])?;
    Ok(())
}

pub fn rename_feed(conn: &Connection, id: i64, title: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE feeds SET title=?1 WHERE id=?2", params![title, id])?;
    Ok(())
}

// ---------------------------------------------------------------- stories

pub fn items(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<Item>> {
    let mut st = conn.prepare(
        "SELECT id, feed_id, title, link, date, summary, image, read, saved, read_at
         FROM items
         WHERE id IN (SELECT id FROM items ORDER BY date DESC LIMIT ?1)
            OR saved=1 OR id IN (SELECT item_id FROM highlights)
         ORDER BY date DESC",
    )?;
    let rows = st.query_map([limit], |r| {
        Ok(Item {
            id: r.get(0)?,
            feed_id: r.get(1)?,
            title: r.get(2)?,
            link: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            date: r.get(4)?,
            summary: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            image: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            read: r.get::<_, i64>(7)? != 0,
            saved: r.get::<_, i64>(8)? != 0,
            read_at: r.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn unread_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM items WHERE read=0", [], |r| r.get(0))
}

pub fn mark(conn: &mut Connection, ids: &[String], read: Option<bool>, saved: Option<bool>, now: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for id in ids {
        if let Some(v) = read {
            if v {
                tx.execute("UPDATE items SET read=1, read_at=COALESCE(read_at, ?1) WHERE id=?2", params![now, id])?;
            } else {
                tx.execute("UPDATE items SET read=0, read_at=NULL WHERE id=?1", params![id])?;
            }
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
        // Already have it (by id, or by link for stories carried over from older versions)?
        let known: Option<(String, String)> = tx
            .query_row(
                "SELECT id, COALESCE(image,'') FROM items WHERE id=?1 OR (feed_id=?2 AND link<>'' AND link=?3)",
                params![it.id, feed.id, it.link],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((id, image)) = known {
            if image.is_empty() && !it.image.is_empty() {
                tx.execute("UPDATE items SET image=?1 WHERE id=?2", params![it.image, id])?;
            }
            continue;
        }
        tx.execute(
            "INSERT INTO items(id, feed_id, title, link, date, summary, image, fetched_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![it.id, feed.id, it.title, it.link, it.date, it.summary, it.image, now],
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
        "DELETE FROM items WHERE feed_id=?1 AND saved=0
           AND id NOT IN (SELECT item_id FROM highlights)
           AND id NOT IN (SELECT id FROM items WHERE feed_id=?1 ORDER BY date DESC LIMIT ?2)",
        params![feed.id, KEEP_PER_FEED],
    )?;
    tx.commit()?;
    Ok(added)
}

// ---------------------------------------------------------------- reader copy

pub fn item_link(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT link FROM items WHERE id=?1", [id], |r| r.get(0)).optional()
}

pub fn cached_article(conn: &Connection, id: &str) -> rusqlite::Result<Option<Cached>> {
    conn.query_row(
        "SELECT content, COALESCE(byline,'') FROM items WHERE id=?1 AND content IS NOT NULL AND content<>''",
        [id],
        |r| Ok(Cached { html: r.get(0)?, byline: r.get(1)? }),
    )
    .optional()
}

pub fn cache_article(conn: &Connection, id: &str, html: &str, byline: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE items SET content=?1, byline=?2 WHERE id=?3", params![html, byline, id])?;
    Ok(())
}

// ---------------------------------------------------------------- highlights and notes

pub fn highlights(conn: &Connection) -> rusqlite::Result<Vec<Highlight>> {
    let mut st = conn.prepare("SELECT id, item_id, text, COALESCE(note,''), COALESCE(start,-1), created_at FROM highlights ORDER BY created_at")?;
    let rows = st.query_map([], |r| {
        Ok(Highlight { id: r.get(0)?, item_id: r.get(1)?, text: r.get(2)?, note: r.get(3)?, start: r.get(4)?, created_at: r.get(5)? })
    })?;
    rows.collect()
}

pub fn add_highlight(conn: &Connection, item_id: &str, text: &str, note: &str, start: i64, now: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO highlights(item_id, text, note, start, created_at) VALUES (?1,?2,?3,?4,?5)",
        params![item_id, text, note, start, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn set_note(conn: &Connection, id: i64, note: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE highlights SET note=?1 WHERE id=?2", params![note, id])?;
    Ok(())
}

pub fn delete_highlight(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM highlights WHERE id=?1", [id])?;
    Ok(())
}

pub fn get_meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)", params![key, value])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_and_upgrade() {
        let dir = std::env::temp_dir().join(format!("rr-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let _ = std::fs::remove_file(&path);
        // an old-style database without the 0.2 columns
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch("CREATE TABLE feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL, site TEXT DEFAULT '', status TEXT DEFAULT 'pending', error TEXT DEFAULT '', last_fetched TEXT);
                CREATE TABLE items (id TEXT PRIMARY KEY, feed_id INTEGER NOT NULL, title TEXT NOT NULL, link TEXT DEFAULT '', date TEXT NOT NULL, summary TEXT DEFAULT '', read INTEGER DEFAULT 0, saved INTEGER DEFAULT 0, fetched_at TEXT);
                INSERT INTO feeds(url,title) VALUES ('https://a.com/feed','A');").unwrap();
        }
        let mut c = open(&path, false).unwrap();
        let f = folder_named(&c, "Web Design").unwrap();
        assert_eq!(folder_named(&c, "web design").unwrap(), f);
        set_feed_folder(&c, 1, Some(f)).unwrap();
        assert_eq!(feeds(&c).unwrap()[0].folder_id, Some(f));
        let feed = feed(&c, 1).unwrap().unwrap();
        let it = NewItem { id: "x".into(), title: "T".into(), link: "https://a.com/1".into(), date: "2026-10-28T00:00:00Z".into(), summary: "".into(), image: "https://a.com/i.jpg".into() };
        store_fetch(&mut c, &feed, "A", "", &[it], "2026-10-28T01:00:00Z").unwrap();
        mark(&mut c, &["x".into()], Some(true), None, "2026-10-28T02:00:00Z").unwrap();
        let i = &items(&c, 10).unwrap()[0];
        assert!(i.read && i.read_at.as_deref() == Some("2026-10-28T02:00:00Z") && i.image.ends_with("i.jpg"));
        delete_folder(&c, f).unwrap();
        assert_eq!(feeds(&c).unwrap()[0].folder_id, None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
