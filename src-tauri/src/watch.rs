//! Watch a page that has no feed: check it on every refresh and turn a change into a story.
//!
//! A watched page is kept as a feed whose address starts with `watch:`. Each check keeps the page's
//! main text (the article, or the whole page's text when there isn't one); when it differs from
//! the last check, the new lines become a story "… changed".

use crate::feeds::{self, Fetched, ParsedItem};
use rusqlite::Connection;
use sha1::{Digest, Sha1};
use std::collections::HashSet;

pub const PREFIX: &str = "watch:";
const KEEP_TEXT: usize = 60_000;

pub fn is_watch(url: &str) -> bool {
    url.starts_with(PREFIX)
}

pub fn page_of(url: &str) -> &str {
    url.strip_prefix(PREFIX).unwrap_or(url)
}

/// A web address as typed (with or without https://) to the feed address that watches it.
pub fn watch_url(typed: &str) -> Result<String, String> {
    let t = typed.trim();
    let t = t.strip_prefix(PREFIX).unwrap_or(t);
    let full = if t.contains("://") { t.to_string() } else { format!("https://{t}") };
    let u = url::Url::parse(&full).map_err(|_| "That doesn't look like a web address.".to_string())?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        return Err("That doesn't look like a web address.".into());
    }
    Ok(format!("{PREFIX}{u}"))
}

fn hash(s: &str) -> String {
    let mut h = Sha1::new();
    h.update(s.as_bytes());
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// The page's readable text, one line per paragraph, with the bits that change on every visit
/// (blank lines, runs of spaces) smoothed out.
fn text_of(html: &str, url: &str) -> (String, String) {
    let mut title = String::new();
    let mut text = String::new();
    if let Ok(mut r) = dom_smoothie::Readability::new(html, Some(url), None) {
        if let Ok(a) = r.parse() {
            title = a.title.trim().to_string();
            if a.text_content.trim().chars().count() > 80 {
                text = a.text_content.to_string();
            }
        }
    }
    if text.is_empty() {
        let mut no_scripts = html.to_string();
        for tag in ["script", "style", "noscript", "svg", "head"] {
            no_scripts = regex::Regex::new(&format!(r"(?is)<{tag}\b.*?</{tag}>")).unwrap().replace_all(&no_scripts, " ").to_string();
        }
        let breaks = regex::Regex::new(r"(?i)<(br|/p|/div|/li|/h\d|/tr|/section|/article)\b[^>]*>").unwrap().replace_all(&no_scripts, "\n");
        let tags = regex::Regex::new(r"(?s)<[^>]*>").unwrap().replace_all(&breaks, " ");
        text = html_escape::decode_html_entities(&tags).to_string();
    }
    if title.is_empty() {
        if let Some(c) = regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap().captures(html) {
            title = html_escape::decode_html_entities(c[1].trim()).to_string();
        }
    }
    let lines: Vec<String> = text
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| l.chars().count() > 1)
        .collect();
    (title, lines.join("\n"))
}

/// Download the page. The one story it returns carries the whole text for now; `finalize` turns it into
/// "changed" (or nothing at all, when the page is the same as last time).
pub async fn fetch(client: &reqwest::Client, url: &str) -> Result<Fetched, String> {
    let page = page_of(url).to_string();
    let (body, final_url, _) = feeds::get(client, &page).await?;
    let html = String::from_utf8_lossy(&body).to_string();
    let (title, text) = text_of(&html, &final_url);
    if text.is_empty() {
        return Err("That page has no text to watch (it may be built by scripts).".into());
    }
    let title = if title.is_empty() { url::Url::parse(&page).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or(page.clone()) } else { title };
    Ok(Fetched {
        url: url.to_string(),
        title,
        site: page.clone(),
        items: vec![ParsedItem {
            key: String::new(),
            title: String::new(),
            link: page,
            date: feeds::now_iso(),
            summary: text,
            image: String::new(),
            audio: String::new(),
            shares: String::new(),
            paid: false,
            links: String::new(),
        }],
    })
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n).collect::<String>().trim_end()) }
}

/// Compare with the last check: no change → no story; a change → one story listing what's new.
pub fn finalize(conn: &Connection, name: &str, f: &mut Fetched) {
    let Some(item) = f.items.pop() else { return };
    let text = item.summary;
    let key = format!("watch:{}", f.url);
    let before = crate::db::get_meta(conn, &key).ok().flatten();
    let h = hash(&text);
    let mut keep = text.clone();
    if keep.len() > KEEP_TEXT {
        let mut cut = KEEP_TEXT;
        while !keep.is_char_boundary(cut) { cut -= 1; }
        keep.truncate(cut);
    }
    let name = if name.trim().is_empty() { f.title.clone() } else { name.trim().to_string() };
    let (title, summary) = match &before {
        Some(old) if hash(old) == h || old == &keep => return, // the same page as last time
        Some(old) => {
            let was: HashSet<&str> = old.lines().collect();
            let now: HashSet<&str> = keep.lines().collect();
            let added: Vec<&str> = keep.lines().filter(|l| !was.contains(l)).collect();
            let gone = old.lines().filter(|l| !now.contains(l)).count();
            let summary = if added.is_empty() {
                format!("{gone} line{} came off the page.", if gone == 1 { "" } else { "s" })
            } else {
                let mut s = String::from("New on the page: ");
                s.push_str(&clip(&added.join(" · "), 600));
                s
            };
            (format!("{name} changed"), summary)
        }
        None => (format!("Watching {name}"), format!("The Reading Room will let you know when this page changes. It starts: {}", clip(&keep.replace('\n', " "), 300))),
    };
    let _ = crate::db::set_meta(conn, &key, &keep);
    f.items.push(ParsedItem {
        key: format!("{}#{h}", f.url),
        title,
        // a fragment keeps each change its own story (stories are also matched by link)
        link: format!("{}#rr-{}", item.link, &h[..8]),
        summary,
        ..item
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses() {
        assert_eq!(watch_url("example.com/jobs").unwrap(), "watch:https://example.com/jobs");
        assert!(watch_url("not an address").is_err());
        assert_eq!(page_of("watch:https://a.b/"), "https://a.b/");
    }

    #[test]
    fn page_text() {
        let (t, x) = text_of("<html><head><title>Jobs</title><style>p{}</style></head><body><p>One  opening</p><p>Two</p><script>var x</script></body></html>", "https://a.b/");
        assert_eq!(t, "Jobs");
        assert!(x.contains("One opening") && x.contains("Two") && !x.contains("var x"));
    }

    #[test]
    fn changes() {
        let conn = crate::db::open(std::path::Path::new(":memory:"), false).unwrap();
        let mk = |text: &str| Fetched { url: "watch:https://a.b/".into(), title: "A".into(), site: "https://a.b/".into(), items: vec![ParsedItem {
            key: String::new(), title: String::new(), link: "https://a.b/".into(), date: "2026-01-01T00:00:00Z".into(), summary: text.into(),
            image: String::new(), audio: String::new(), shares: String::new(), paid: false, links: String::new() }] };
        let mut f = mk("one\ntwo");
        finalize(&conn, "A", &mut f);
        assert!(f.items[0].title.starts_with("Watching"));
        let mut f = mk("one\ntwo");
        finalize(&conn, "A", &mut f);
        assert!(f.items.is_empty());
        let mut f = mk("one\ntwo\nthree");
        finalize(&conn, "A", &mut f);
        assert_eq!(f.items[0].title, "A changed");
        assert!(f.items[0].summary.contains("three"));
    }
}
