//! Fetching and reading feeds: RSS 0.9x/1.0/2.0, Atom and JSON Feed (via feed-rs),
//! plus finding a site's feed from its home page.

use crate::db::NewItem;
use chrono::Utc;
use regex::Regex;
use sha1::{Digest, Sha1};
use std::sync::OnceLock;
use std::time::Duration;

pub const SUMMARY_CHARS: usize = 700;
const MAX_BYTES: usize = 8_000_000;

pub struct Fetched {
    pub url: String,
    pub title: String,
    pub site: String,
    pub items: Vec<ParsedItem>,
}

pub struct ParsedItem {
    pub key: String,
    pub title: String,
    pub link: String,
    pub date: String,
    pub summary: String,
    pub image: String,
    /// A podcast episode's audio file
    pub audio: String,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("ReadingRoom/", env!("CARGO_PKG_VERSION"), " (+personal RSS reader)"))
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("http client")
}

pub fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

/// Turn HTML into a tidy plain-text snippet.
pub fn plain(s: &str, limit: usize) -> String {
    static SCRIPT: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static WS: OnceLock<Regex> = OnceLock::new();
    let s = re(&SCRIPT, r"(?is)<(script|style)\b.*?</(script|style)>").replace_all(s, " ");
    let s = re(&TAG, r"(?s)<[^>]*>").replace_all(&s, " ");
    let s = html_escape::decode_html_entities(&s);
    let s = re(&WS, r"\s+").replace_all(&s, " ");
    let s = s.trim();
    if s.chars().count() <= limit {
        return s.to_string();
    }
    let cut: String = s.chars().take(limit).collect();
    match cut.rfind(' ') {
        Some(i) if i > limit / 2 => format!("{}…", &cut[..i]),
        _ => format!("{cut}…"),
    }
}

pub(crate) async fn get(client: &reqwest::Client, url: &str) -> Result<(Vec<u8>, String, String), String> {
    let resp = client
        .get(url)
        .header(
            "Accept",
            "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1",
        )
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "The site took too long to answer.".to_string()
            } else if e.is_connect() {
                "Couldn't reach the site. Check the address and your connection.".to_string()
            } else {
                format!("Couldn't reach the site ({e}).")
            }
        })?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("The site answered with error {}.", status.as_u16()));
    }
    let final_url = resp.url().to_string();
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let body = resp.bytes().await.map_err(|_| "The site's answer was cut off. Try again.".to_string())?;
    if body.len() > MAX_BYTES {
        return Err("That feed is too large to read.".into());
    }
    Ok((body.to_vec(), final_url, ctype))
}

pub(crate) fn looks_like_html(body: &[u8], ctype: &str) -> bool {
    if ctype.starts_with("text/html") {
        return true;
    }
    let head = String::from_utf8_lossy(&body[..body.len().min(600)]).trim_start().to_ascii_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html")
}

/// Find `<link rel="alternate" type="application/rss+xml" href="…">` in a web page.
pub fn discover(html: &str, base: &str) -> Option<String> {
    static LINK: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let base = url::Url::parse(base).ok()?;
    let mut fallback = None;
    for tag in re(&LINK, r"(?is)<link\b[^>]*>").find_iter(html) {
        let mut rel = String::new();
        let mut typ = String::new();
        let mut href = String::new();
        for c in re(&ATTR, r#"(?is)([a-z-]+)\s*=\s*["']([^"']*)["']"#).captures_iter(tag.as_str()) {
            match c[1].to_ascii_lowercase().as_str() {
                "rel" => rel = c[2].to_ascii_lowercase(),
                "type" => typ = c[2].to_ascii_lowercase(),
                "href" => href = html_escape::decode_html_entities(&c[2]).to_string(),
                _ => {}
            }
        }
        if !rel.split_whitespace().any(|r| r == "alternate") || href.is_empty() {
            continue;
        }
        let url = base.join(&href).ok()?.to_string();
        match typ.as_str() {
            "application/rss+xml" | "application/atom+xml" => return Some(url),
            "application/feed+json" | "application/json" | "application/rdf+xml" if fallback.is_none() => {
                fallback = Some(url)
            }
            _ => {}
        }
    }
    fallback
}

/// Like `fetch`, but patient with YouTube, whose feeds answer "not found" on and off for channels that
/// exist (a known YouTube problem since late 2025): wait a moment and ask once more.
pub async fn fetch_patient(client: &reqwest::Client, url: &str) -> Result<Fetched, String> {
    match fetch(client, url).await {
        Err(e) if url.contains("youtube.com/") && e.contains("404") => {
            tokio::time::sleep(Duration::from_millis(2500)).await;
            fetch(client, url).await.map_err(|_| YOUTUBE_HICCUP.to_string())
        }
        r => r,
    }
}

pub const YOUTUBE_HICCUP: &str = "YouTube's feed didn't answer just now. YouTube has been doing this on and off for every RSS reader; try again in a little while.";

/// Fetch a feed, following a website address to the feed it advertises.
pub async fn fetch(client: &reqwest::Client, url: &str) -> Result<Fetched, String> {
    let (mut body, mut final_url, ctype) = get(client, url).await?;
    if looks_like_html(&body, &ctype) {
        let page = String::from_utf8_lossy(&body).to_string();
        let found = discover(&page, &final_url)
            .ok_or("That page doesn't list an RSS or Atom feed. Try the feed's own address.")?;
        let (b, u, _) = get(client, &found).await?;
        body = b;
        final_url = u;
    }
    parse(&body, &final_url)
}

pub fn parse(body: &[u8], base: &str) -> Result<Fetched, String> {
    let feed = feed_rs::parser::Builder::new()
        .base_uri(Some(base))
        .build()
        .parse(body)
        .map_err(|_| "This address isn't an RSS or Atom feed.".to_string())?;

    let title = feed.title.as_ref().map(|t| plain(&t.content, 120)).unwrap_or_default();
    let site = feed
        .links
        .iter()
        .find(|l| l.rel.as_deref().map_or(true, |r| r == "alternate") && !l.href.ends_with(".xml") && !l.href.contains("/feed"))
        .or_else(|| feed.links.iter().find(|l| l.rel.as_deref() != Some("self")))
        .map(|l| l.href.clone())
        .unwrap_or_default();

    let base_url = url::Url::parse(base).ok();
    let now = now_iso();
    let items = feed
        .entries
        .iter()
        .map(|e| {
            let raw_link = e
                .links
                .iter()
                .find(|l| l.rel.as_deref().map_or(true, |r| r == "alternate"))
                .or_else(|| e.links.first())
                .map(|l| l.href.clone())
                .unwrap_or_default();
            let link = match (&base_url, raw_link.is_empty()) {
                (Some(b), false) => b.join(&raw_link).map(|u| u.to_string()).unwrap_or(raw_link),
                _ => raw_link,
            };
            let body = e
                .summary
                .as_ref()
                .map(|s| s.content.clone())
                .or_else(|| e.content.as_ref().and_then(|c| c.body.clone()))
                .unwrap_or_default();
            let full = e.content.as_ref().and_then(|c| c.body.clone()).unwrap_or_default();
            let image = story_image(e, &format!("{full} {body}"), base_url.as_ref());
            let audio = story_audio(e);
            let summary = plain(&body, SUMMARY_CHARS);
            let mut title = e.title.as_ref().map(|t| plain(&t.content, 300)).unwrap_or_default();
            if title.is_empty() {
                title = if summary.is_empty() { "(untitled)".into() } else { plain(&summary, 90) };
            }
            let date = e
                .published
                .or(e.updated)
                .map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                .unwrap_or_else(|| now.clone());
            // feed-rs makes up an id when a feed has none; prefer the link in that case.
            let key = if !link.is_empty() { link.clone() } else { e.id.clone() };
            ParsedItem { key, title, link, date, summary, image, audio }
        })
        .collect();
    Ok(Fetched { url: base.to_string(), title, site, items })
}

/// A podcast episode's audio: an enclosure that's audio, or ends like an audio file.
fn story_audio(e: &feed_rs::model::Entry) -> String {
    for m in &e.media {
        for c in &m.content {
            let typ = c.content_type.as_ref().map(|t| t.to_string()).unwrap_or_default();
            let Some(u) = c.url.as_ref() else { continue };
            let p = u.path().to_ascii_lowercase();
            if typ.starts_with("audio") || [".mp3", ".m4a", ".aac", ".ogg", ".opus"].iter().any(|x| p.ends_with(x)) {
                if u.scheme() == "https" || u.scheme() == "http" {
                    return u.to_string();
                }
            }
        }
    }
    String::new()
}

/// A picture for the story list: the feed's own thumbnail, an image attachment, or the first picture in the post.
fn story_image(e: &feed_rs::model::Entry, html: &str, base: Option<&url::Url>) -> String {
    static IMG: OnceLock<Regex> = OnceLock::new();
    let mut found: Option<String> = None;
    for m in &e.media {
        if let Some(t) = m.thumbnails.first() {
            found = Some(t.image.uri.clone());
            break;
        }
        if let Some(c) = m.content.iter().find(|c| {
            c.content_type.as_ref().map_or(false, |t| t.to_string().starts_with("image"))
                || c.url.as_ref().map_or(false, |u| {
                    let p = u.path().to_ascii_lowercase();
                    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].iter().any(|x| p.ends_with(x))
                })
        }) {
            found = c.url.as_ref().map(|u| u.to_string());
            break;
        }
    }
    if found.is_none() {
        found = re(&IMG, r#"(?is)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']"#)
            .captures_iter(html)
            .map(|c| html_escape::decode_html_entities(&c[1]).to_string())
            // skip tracking pixels and emoji
            .find(|u| !u.contains("pixel") && !u.contains("emoji") && !u.contains("gravatar") && !u.starts_with("data:"));
    }
    let Some(u) = found else { return String::new() };
    let abs = match base {
        Some(b) => b.join(&u).map(|x| x.to_string()).unwrap_or(u),
        None => u,
    };
    if abs.starts_with("https://") || abs.starts_with("http://") { abs } else { String::new() }
}

/// Words instead of a web address ("walgreens pharmacy") mean a Google News search.
pub fn news_query(input: &str) -> Option<String> {
    let t = input.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        return None;
    }
    let looks_like_address = !t.contains(' ') && t.contains('.') && !t.ends_with('.');
    if looks_like_address || t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

pub fn google_news_url(query: &str) -> String {
    let mut u = url::Url::parse("https://news.google.com/rss/search").expect("static url");
    u.query_pairs_mut().append_pair("q", query).append_pair("hl", "en-US").append_pair("gl", "US").append_pair("ceid", "US:en");
    u.to_string()
}

pub fn item_id(feed_id: i64, key: &str) -> String {
    let mut h = Sha1::new();
    h.update(format!("{feed_id}|{key}").as_bytes());
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

pub fn to_new_items(feed_id: i64, items: &[ParsedItem]) -> Vec<NewItem> {
    items
        .iter()
        .map(|p| NewItem {
            id: item_id(feed_id, &p.key),
            title: p.title.clone(),
            link: p.link.clone(),
            date: p.date.clone(),
            summary: p.summary.clone(),
            image: p.image.clone(),
            audio: p.audio.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rss_and_strips_html() {
        let xml = br#"<?xml version="1.0"?><rss version="2.0"><channel><title>Test &amp; Co</title><link>https://ex.com/</link>
        <item><title>First</title><link>/1</link><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[<p>Hello <script>x()</script>world &amp; friends.</p>]]></description></item></channel></rss>"#;
        let f = parse(xml, "https://ex.com/feed").unwrap();
        assert_eq!(f.title, "Test & Co");
        assert_eq!(f.items[0].link, "https://ex.com/1");
        assert_eq!(f.items[0].summary, "Hello world & friends.");
        assert_eq!(f.items[0].date, "2026-10-27T10:00:00Z");
        assert_eq!(f.items[0].image, "");
    }

    #[test]
    fn finds_story_images() {
        let xml = br#"<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title><link>https://ex.com/</link>
        <item><title>With thumb</title><link>https://ex.com/a</link><media:thumbnail url="https://cdn.ex.com/a.jpg"/></item>
        <item><title>With enclosure</title><link>https://ex.com/b</link><enclosure url="https://cdn.ex.com/b.png" type="image/png" length="1"/></item>
        <item><title>Inline</title><link>https://ex.com/c</link><description><![CDATA[<p><img src="/img/c.webp" alt=""> text</p>]]></description></item>
        </channel></rss>"#;
        let f = parse(xml, "https://ex.com/feed").unwrap();
        assert_eq!(f.items[0].image, "https://cdn.ex.com/a.jpg");
        assert_eq!(f.items[1].image, "https://cdn.ex.com/b.png");
        assert_eq!(f.items[2].image, "https://ex.com/img/c.webp");
    }

    #[test]
    fn parses_atom() {
        let xml = br#"<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><id>x</id>
        <link href="https://ex.com/blog/"/><entry><title>One</title><id>a1</id>
        <link rel="alternate" href="https://ex.com/a1"/><updated>2026-10-26T12:00:00Z</updated><summary>Sum</summary></entry></feed>"#;
        let f = parse(xml, "https://ex.com/atom.xml").unwrap();
        assert_eq!(f.items.len(), 1);
        assert_eq!(f.items[0].link, "https://ex.com/a1");
        assert_eq!(f.site, "https://ex.com/blog/");
    }

    #[test]
    fn finds_feed_in_page() {
        let html = r#"<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed/"></head></html>"#;
        assert_eq!(discover(html, "https://ex.com/about").as_deref(), Some("https://ex.com/feed/"));
    }

    #[test]
    fn spots_news_searches() {
        assert_eq!(news_query("walgreens pharmacy").as_deref(), Some("walgreens pharmacy"));
        assert_eq!(news_query("bitcoin").as_deref(), Some("bitcoin"));
        assert_eq!(news_query("adactio.com"), None);
        assert_eq!(news_query("https://ex.com/feed"), None);
        assert!(google_news_url("walgreens pharmacy").contains("q=walgreens+pharmacy"));
    }

    #[test]
    fn trims_long_text() {
        let s = plain(&"word ".repeat(400), 50);
        assert!(s.ends_with('…') && s.chars().count() <= 51);
    }
}

// ------------------------------------------------------------------ pictures from the story's web page

/// The picture a web page offers for sharing (og:image, twitter:image or image_src), if any.
/// Only reads the top of the page, where those tags live.
pub async fn page_image(client: &reqwest::Client, link: &str) -> Option<String> {
    let base = url::Url::parse(link).ok()?;
    // Google News links lead to a redirect page whose picture is Google's logo.
    if base.host_str().map_or(true, |h| h.ends_with("news.google.com")) {
        return None;
    }
    let mut resp = client.get(link).timeout(Duration::from_secs(12)).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let is_html = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map_or(true, |t| t.contains("html"));
    if !is_html {
        return None;
    }
    let final_url = resp.url().clone();
    let mut buf: Vec<u8> = Vec::new();
    while let Ok(Some(chunk)) = resp.chunk().await {
        buf.extend_from_slice(&chunk);
        if buf.len() > 400_000 || find_ci(&buf, b"</head>") {
            break;
        }
    }
    let html = String::from_utf8_lossy(&buf);
    pick_page_image(&html, &final_url)
}

fn find_ci(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w.eq_ignore_ascii_case(needle))
}

pub fn pick_page_image(html: &str, base: &url::Url) -> Option<String> {
    static TAG: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let tag = TAG.get_or_init(|| Regex::new(r"(?is)<(meta|link)\b[^>]*>").unwrap());
    let attr = ATTR.get_or_init(|| Regex::new(r#"(?is)([a-z][a-z:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap());
    // Best first: Open Graph, then Twitter, then the old image_src link.
    let mut found: [Option<String>; 3] = [None, None, None];
    for m in tag.captures_iter(html) {
        let kind = m[1].to_ascii_lowercase();
        let mut key = String::new();
        let mut value = String::new();
        for a in attr.captures_iter(&m[0]) {
            let name = a[1].to_ascii_lowercase();
            let v = a.get(2).or(a.get(3)).or(a.get(4)).map(|x| x.as_str()).unwrap_or("").trim().to_string();
            match (kind.as_str(), name.as_str()) {
                ("meta", "property" | "name" | "itemprop") | ("link", "rel") => key = v.to_ascii_lowercase(),
                ("meta", "content") | ("link", "href") => value = v,
                _ => {}
            }
        }
        if value.is_empty() {
            continue;
        }
        let slot = match key.as_str() {
            "og:image" | "og:image:url" | "og:image:secure_url" => 0,
            "twitter:image" | "twitter:image:src" => 1,
            "image_src" | "image" => 2,
            _ => continue,
        };
        if found[slot].is_none() {
            found[slot] = Some(value);
        }
    }
    let raw = found.into_iter().flatten().next()?;
    let raw = html_escape::decode_html_entities(&raw).to_string();
    let u = base.join(&raw).ok()?;
    (u.scheme() == "https" || u.scheme() == "http").then(|| u.to_string())
}

#[cfg(test)]
mod page_image_tests {
    use super::pick_page_image;
    #[test]
    fn picks_open_graph_and_resolves_relative() {
        let base = url::Url::parse("https://example.com/post/1").unwrap();
        let html = r#"<head><meta name="twitter:image" content="https://cdn.example.com/t.jpg">
            <meta content="/img/og.jpg?a=1&amp;b=2" property="og:image"></head>"#;
        assert_eq!(pick_page_image(html, &base).as_deref(), Some("https://example.com/img/og.jpg?a=1&b=2"));
        assert_eq!(pick_page_image("<head><link rel='image_src' href='//x.org/i.png'></head>", &base).as_deref(), Some("https://x.org/i.png"));
        assert_eq!(pick_page_image("<head><title>None</title></head>", &base), None);
    }
}
