//! Free audiobooks from LibriVox (public domain books read by volunteers), through LibriVox's own API.
//! A book is found from its LibriVox page, its RSS link or its project number, and kept once found.

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Chapter {
    pub title: String,
    pub url: String,
    pub secs: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Audiobook {
    pub id: String,
    pub title: String,
    pub author: String,
    pub reader: String,
    pub secs: u64,
    pub cover: String,
    pub page: String,
    pub chapters: Vec<Chapter>,
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

/// A LibriVox project number straight from what was pasted, when it carries one.
pub fn id_from(input: &str) -> Option<String> {
    static ID: OnceLock<Regex> = OnceLock::new();
    let t = input.trim();
    if t.chars().all(|c| c.is_ascii_digit()) && !t.is_empty() { return Some(t.to_string()); }
    re(&ID, r"(?i)librivox\.(?:org|app|us|biz)/(?:rss/|book/|api/feed/audiobooks/\?id=|(?:[a-z]{2}/)?book/)?(\d{1,6})(?:[/?#]|$)").captures(t).map(|c| c[1].to_string())
}

fn secs_of(v: &Value) -> u64 {
    v.as_u64().or_else(|| v.as_str().and_then(|s| {
        if s.contains(':') { let p: Vec<u64> = s.split(':').filter_map(|x| x.parse().ok()).collect(); Some(p.iter().fold(0, |a, x| a * 60 + x)) } else { s.parse().ok() }
    })).unwrap_or(0)
}

pub fn from_api(v: &Value) -> Option<Audiobook> {
    let b = v.get("books")?.as_array()?.first()?.clone();
    let st = |k: &str| b.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let author = b.get("authors").and_then(|a| a.as_array()).map(|a| a.iter().map(|x| format!("{} {}",
        x.get("first_name").and_then(|s| s.as_str()).unwrap_or(""), x.get("last_name").and_then(|s| s.as_str()).unwrap_or("")).trim().to_string()).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    let sections = b.get("sections").and_then(|s| s.as_array()).cloned().unwrap_or_default();
    let mut readers: Vec<String> = Vec::new();
    let chapters: Vec<Chapter> = sections.iter().filter_map(|s| {
        for r in s.get("readers").and_then(|r| r.as_array()).cloned().unwrap_or_default() {
            let n = r.get("display_name").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            if !n.is_empty() && !readers.contains(&n) { readers.push(n); }
        }
        let url = s.get("listen_url").and_then(|x| x.as_str())?.trim().replacen("http://", "https://", 1);
        if url.is_empty() { return None; }
        Some(Chapter { title: s.get("title").and_then(|x| x.as_str()).unwrap_or("").trim().to_string(), url, secs: secs_of(s.get("playtime").unwrap_or(&Value::Null)) })
    }).collect();
    if chapters.is_empty() { return None; }
    let ia = st("url_iarchive");
    let ident = ia.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
    let cover = [st("coverart_jpg"), st("coverart_thumbnail")].into_iter().find(|c| c.starts_with("http"))
        .unwrap_or_else(|| if ident.is_empty() { String::new() } else { format!("https://archive.org/services/img/{ident}") });
    let reader = match readers.len() { 0 => String::new(), 1 => readers[0].clone(), 2 => readers.join(" and "), _ => "various readers".into() };
    Some(Audiobook {
        id: st("id"), title: st("title"), author, reader,
        secs: chapters.iter().map(|c| c.secs).sum::<u64>().max(secs_of(b.get("totaltimesecs").unwrap_or(&Value::Null))),
        cover: cover.replacen("http://", "https://", 1), page: st("url_librivox").replacen("http://", "https://", 1), chapters,
    })
}

/// Find the book: its number from the link, or from its LibriVox page; then the book from the API.
pub async fn find(client: &reqwest::Client, input: &str) -> Result<Audiobook, String> {
    static RSS: OnceLock<Regex> = OnceLock::new();
    let id = match id_from(input) {
        Some(id) => id,
        None => {
            let t = input.trim();
            let url = if t.starts_with("http") { t.to_string() } else { format!("https://{t}") };
            if !url.contains("librivox.org/") { return Err("Paste the link of a book’s page on librivox.org.".into()); }
            let (body, _, _) = crate::feeds::get(client, &url).await.map_err(|_| "Couldn’t open that LibriVox page. Check the link and your connection.".to_string())?;
            let html = String::from_utf8_lossy(&body);
            re(&RSS, r"librivox\.org/rss/(\d+)").captures(&html).map(|c| c[1].to_string())
                .ok_or_else(|| "That page doesn’t look like a LibriVox audiobook. Open a book’s page and copy its link.".to_string())?
        }
    };
    let api = format!("https://librivox.org/api/feed/audiobooks/?id={id}&format=json&extended=1");
    let (body, _, _) = crate::feeds::get(client, &api).await.map_err(|_| "Couldn’t reach LibriVox. Try again in a moment.".to_string())?;
    let v: Value = serde_json::from_slice(&body).map_err(|_| "LibriVox sent something unexpected. Try again.".to_string())?;
    from_api(&v).ok_or_else(|| "That LibriVox book has no recordings yet (it may still be in progress).".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_project_numbers() {
        assert_eq!(id_from("https://librivox.org/rss/549").as_deref(), Some("549"));
        assert_eq!(id_from("549").as_deref(), Some("549"));
        assert_eq!(id_from("https://librivox.app/book/253").as_deref(), Some("253"));
        assert_eq!(id_from("https://librivox.org/walden-by-henry-david-thoreau/"), None);
    }

    #[test]
    fn reads_the_api() {
        let v = serde_json::json!({ "books": [{ "id": "549", "title": "Walden", "url_librivox": "http://librivox.org/walden-by-henry-david-thoreau/",
            "url_iarchive": "http://www.archive.org/details/walden_librivox", "totaltimesecs": 100,
            "authors": [{ "first_name": "Henry David", "last_name": "Thoreau" }],
            "sections": [
              { "title": "Economy", "listen_url": "http://www.archive.org/download/walden_librivox/walden_c01_p01_64kb.mp3", "playtime": "1816", "readers": [{ "display_name": "Gord Mackenzie" }] },
              { "title": "Reading", "listen_url": "http://www.archive.org/download/walden_librivox/b.mp3", "playtime": "00:10:00", "readers": [{ "display_name": "Gord Mackenzie" }] } ] }] });
        let b = from_api(&v).unwrap();
        assert_eq!((b.title.as_str(), b.author.as_str(), b.reader.as_str()), ("Walden", "Henry David Thoreau", "Gord Mackenzie"));
        assert_eq!(b.chapters.len(), 2);
        assert_eq!(b.chapters[1].secs, 600);
        assert!(b.chapters[0].url.starts_with("https://"));
        assert_eq!(b.cover, "https://archive.org/services/img/walden_librivox");
        assert_eq!(b.secs, 2416);
    }
}
