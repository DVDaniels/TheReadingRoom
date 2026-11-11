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
    /// The page a post points to (a toot or skeet sharing a blog post); a full address, or the start of one
    /// when the feed only has the shortened text
    pub shares: String,
    /// The feed says this post is for paying subscribers or members (Substack, Ghost and others)
    pub paid: bool,
    /// Every outside page the post links to (space-separated, up to 25): how the app spots one blog
    /// answering another, and posts that link to your own site
    pub links: String,
    /// How many comments the post has, when the feed says (slash:comments, thr:total); -1 when it doesn't
    pub comments: i64,
}

/// Comment counts feeds give for each post (WordPress's slash:comments, Atom's thr:total or thr:count),
/// keyed by the post's link and its guid or id as they appear in the feed.
pub fn comment_counts(body: &str) -> std::collections::HashMap<String, i64> {
    use regex::Regex;
    static ENTRY: OnceLock<Regex> = OnceLock::new();
    static COUNT: OnceLock<Regex> = OnceLock::new();
    static RSS_LINK: OnceLock<Regex> = OnceLock::new();
    static ATOM_LINK: OnceLock<Regex> = OnceLock::new();
    static ID: OnceLock<Regex> = OnceLock::new();
    static REL: OnceLock<Regex> = OnceLock::new();
    static HREF: OnceLock<Regex> = OnceLock::new();
    let rel_re = REL.get_or_init(|| Regex::new(r#"(?i)\brel\s*=\s*["']([^"']*)["']"#).unwrap());
    let href_re = HREF.get_or_init(|| Regex::new(r#"(?i)\bhref\s*=\s*["']([^"']+)["']"#).unwrap());
    let entry = ENTRY.get_or_init(|| Regex::new(r"(?is)<(item|entry)\b.*?</(item|entry)>").unwrap());
    let count = COUNT.get_or_init(|| Regex::new(r#"(?is)<[a-z0-9]+:(?:comments|total)>\s*(\d+)\s*<|\b[a-z0-9]+:count\s*=\s*["'](\d+)["']"#).unwrap());
    let rss_link = RSS_LINK.get_or_init(|| Regex::new(r"(?is)<link>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)").unwrap());
    let atom_link = ATOM_LINK.get_or_init(|| Regex::new(r"(?is)<link\b[^>]*>").unwrap());
    let id = ID.get_or_init(|| Regex::new(r"(?is)<(?:guid|id)\b[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)").unwrap());
    let mut out = std::collections::HashMap::new();
    if !body.contains(":comments>") && !body.contains(":total>") && !body.contains(":count=") { return out }
    for m in entry.find_iter(body) {
        let e = m.as_str();
        let Some(c) = count.captures(e) else { continue };
        let n: i64 = c.get(1).or(c.get(2)).and_then(|x| x.as_str().parse().ok()).unwrap_or(-1);
        if n < 0 { continue }
        let mut keys: Vec<String> = Vec::new();
        if let Some(l) = rss_link.captures(e) { keys.push(l[1].to_string()); }
        for t in atom_link.find_iter(e) {
            let t = t.as_str();
            let rel = rel_re.captures(t).map(|c| c[1].to_ascii_lowercase());
            if rel.as_deref().map_or(true, |r| r == "alternate") {
                if let Some(h) = href_re.captures(t) { keys.push(html_escape::decode_html_entities(&h[1]).to_string()); }
            }
        }
        if let Some(g) = id.captures(e) { keys.push(g[1].to_string()); }
        for k in keys { out.entry(k).or_insert(n); }
    }
    out
}

/// Words feeds use when a post is only for paying subscribers or members. Only the post's own
/// text is checked; known subscription sites are marked in the app.
pub fn looks_paid(html: &str) -> bool {
    let t = html.to_lowercase();
    const SIGNS: [&str; 12] = [
        "this post is for paid subscribers",
        "this post is for paying subscribers",
        "for paid subscribers only",
        "this post is for subscribers",
        "keep reading with a 7-day free trial",
        "to keep reading this post and get",
        "become a paid subscriber to read",
        "upgrade to paid to read",
        "subscribe to continue reading",
        "this post is for members",
        "members-only post",
        "this content is for paying members",
    ];
    SIGNS.iter().any(|s| t.contains(s))
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
    if crate::share::is_saved_feed(url) {
        return Ok(crate::share::empty_fetch(url));
    }
    if crate::watch::is_watch(url) {
        return crate::watch::fetch(client, url).await;
    }
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
    let page = match get(client, url).await {
        Ok(p) => p,
        // Big sites (The Atlantic, many newspapers) turn away apps at their web pages but welcome
        // readers at their feeds: look where feeds usually live before giving up.
        Err(e) => return usual_feeds(client, url).await.ok_or(if e.contains("403") || e.contains("401") {
            "The site doesn't let apps open its pages, and no feed turned up at the usual addresses. Try the feed's own address.".to_string()
        } else { e }),
    };
    let (mut body, mut final_url, ctype) = page;
    if looks_like_html(&body, &ctype) {
        let html = String::from_utf8_lossy(&body).to_string();
        match discover(&html, &final_url) {
            Some(found) => {
                let (b, u, _) = get(client, &found).await?;
                body = b;
                final_url = u;
            }
            None => {
                return usual_feeds(client, &final_url)
                    .await
                    .ok_or("That page doesn't list an RSS or Atom feed. Try the feed's own address.".to_string())
            }
        }
    }
    parse(&body, &final_url)
}

/// Where sites usually keep their feed, tried in order from the site's front door.
const USUAL_FEEDS: [&str; 8] = ["/feed/", "/feed/all/", "/rss/", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/feeds/posts/default"];

/// Only for a site's address (its home page or a section), not a page deep inside it or a feed.
fn feed_candidates(url: &str) -> Vec<String> {
    let Ok(u) = url::Url::parse(url) else { return vec![] };
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() { return vec![] }
    let path = u.path().trim_end_matches('/');
    if path.split('/').filter(|p| !p.is_empty()).count() > 1 { return vec![] }
    let root = format!("{}://{}", u.scheme(), u.host_str().unwrap_or_default());
    USUAL_FEEDS.iter().map(|p| format!("{root}{p}")).collect()
}

async fn usual_feeds(client: &reqwest::Client, url: &str) -> Option<Fetched> {
    for c in feed_candidates(url) {
        let Ok((body, final_url, ctype)) = get(client, &c).await else { continue };
        if looks_like_html(&body, &ctype) { continue }
        if let Ok(f) = parse(&body, &final_url) {
            if !f.items.is_empty() { return Some(f) }
        }
    }
    None
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
    let counts = comment_counts(&String::from_utf8_lossy(body));
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
                (Some(b), false) => b.join(&raw_link).map(|u| u.to_string()).unwrap_or(raw_link.clone()),
                _ => raw_link.clone(),
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
            let shares = story_shares(&format!("{full} {body}"), &link);
            let links = story_links(&format!("{full} {body}"), &link);
            let paid = looks_paid(&format!("{full} {body}"));
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
            let comments = [&raw_link, &link, &e.id].iter().find_map(|k| counts.get(k.as_str()).copied()).unwrap_or(-1);
            ParsedItem { key, title, link, date, summary, image, audio, shares, paid, links, comments }
        })
        .collect();
    Ok(Fetched { url: base.to_string(), title, site, items })
}

/// The outside page a post links to: the first link that isn't a mention, a hashtag, or the post's own site.
/// Bluesky's feeds only carry the shortened text ("kevquirk.com/blog/pure-c..."), so that start is kept instead.
pub fn story_shares(html: &str, own_link: &str) -> String {
    static A: OnceLock<Regex> = OnceLock::new();
    static BARE: OnceLock<Regex> = OnceLock::new();
    let own_host = url::Url::parse(own_link).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_default();
    let social = |h: &str| h == own_host || h.ends_with("bsky.app") || h.contains("mastodon") || h.ends_with(".social") || h == "t.co";
    for c in A.get_or_init(|| Regex::new(r#"(?is)<a\b([^>]*)>"#).unwrap()).captures_iter(html) {
        let attrs = &c[1];
        let low = attrs.to_ascii_lowercase();
        if low.contains("mention") || low.contains("hashtag") || low.contains("u-url") {
            continue;
        }
        let Some(h) = Regex::new(r#"(?i)href\s*=\s*["']([^"']+)["']"#).ok().and_then(|r| r.captures(attrs).map(|m| html_escape::decode_html_entities(&m[1]).to_string())) else { continue };
        let Ok(u) = url::Url::parse(&h) else { continue };
        if !matches!(u.scheme(), "http" | "https") || u.path().starts_with("/tags/") || u.path().starts_with("/hashtag/") {
            continue;
        }
        let host = u.host_str().unwrap_or("").trim_start_matches("www.").to_string();
        if !social(&host) {
            return u.to_string();
        }
    }
    let text = plain(html, 2000);
    for c in BARE.get_or_init(|| Regex::new(r"(?i)\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,}/[^\s<>\x22]*)").unwrap()).captures_iter(&text) {
        let frag = c[1].trim_end_matches(['…', '.', ',', ')', '!', '?']).trim_end_matches("...").to_string();
        let host = frag.split('/').next().unwrap_or("").trim_start_matches("www.").to_lowercase();
        if !social(&host) && frag.len() > host.len() + 1 {
            return frag;
        }
    }
    String::new()
}

/// Every outside page a post links to, in order, once each (up to 25), space-separated. Links to the post's own
/// site, social networks, tag pages and feeds are left out, so what's left is who the writer is talking about.
pub fn story_links(html: &str, own_link: &str) -> String {
    static A: OnceLock<Regex> = OnceLock::new();
    static HREF: OnceLock<Regex> = OnceLock::new();
    let host_of = |u: &url::Url| u.host_str().unwrap_or("").trim_start_matches("www.").to_lowercase();
    let own_host = url::Url::parse(own_link).ok().map(|u| host_of(&u)).unwrap_or_default();
    let skip = ["bsky.app", "twitter.com", "x.com", "t.co", "facebook.com", "instagram.com", "threads.net", "linkedin.com",
        "youtube.com", "youtu.be", "tiktok.com", "patreon.com", "ko-fi.com", "buymeacoffee.com", "paypal.com", "amazon.com",
        "feedburner.com", "gravatar.com", "wordpress.com", "creativecommons.org"];
    let mut out: Vec<String> = Vec::new();
    for c in A.get_or_init(|| Regex::new(r#"(?is)<a\b([^>]*)>"#).unwrap()).captures_iter(html) {
        let attrs = &c[1];
        let low = attrs.to_ascii_lowercase();
        if low.contains("mention") || low.contains("hashtag") || low.contains("rel=\"tag") {
            continue;
        }
        let Some(h) = HREF.get_or_init(|| Regex::new(r#"(?i)href\s*=\s*["']([^"']+)["']"#).unwrap())
            .captures(attrs).map(|m| html_escape::decode_html_entities(&m[1]).to_string()) else { continue };
        let Ok(mut u) = url::Url::parse(&h) else { continue };
        if !matches!(u.scheme(), "http" | "https") {
            continue;
        }
        let host = host_of(&u);
        let path = u.path().to_lowercase();
        if host.is_empty() || host == own_host || host.ends_with(".social") || host.contains("mastodon")
            || skip.iter().any(|s| host == *s || host.ends_with(&format!(".{s}")))
            || path.starts_with("/tag/") || path.starts_with("/tags/") || path.starts_with("/hashtag/") || path.ends_with("/feed/")
            || path.ends_with(".xml") || path.ends_with(".rss") || path.ends_with(".jpg") || path.ends_with(".png") || path.ends_with(".gif")
            || path.ends_with(".webp") || path.ends_with(".jpeg") {
            continue;
        }
        u.set_fragment(None);
        // tracking tails (utm_…) don't change which page it is
        let keep: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| !k.starts_with("utm_")).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        if keep.is_empty() { u.set_query(None); } else { u.query_pairs_mut().clear().extend_pairs(keep); }
        let s = u.to_string();
        if !out.contains(&s) {
            out.push(s);
            if out.len() >= 25 { break; }
        }
    }
    out.join(" ")
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
            shares: p.shares.clone(),
            paid: p.paid,
            links: p.links.clone(),
            comments: p.comments,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn usual_feed_places() {
        let c = super::feed_candidates("https://www.theatlantic.com/");
        assert!(c.contains(&"https://www.theatlantic.com/feed/all/".to_string()));
        assert_eq!(super::feed_candidates("https://example.com/2026/11/a-post")[..].len(), 0);
        assert_eq!(super::feed_candidates("https://example.com/blog")[0], "https://example.com/feed/");
    }

    #[test]
    fn comment_counts_from_feeds() {
        let rss = br#"<?xml version="1.0"?><rss version="2.0" xmlns:slash="http://purl.org/rss/1.0/modules/slash/"><channel><title>B</title><link>https://b.blog/</link>
            <item><title>One</title><link>https://b.blog/one/</link><guid>https://b.blog/?p=1</guid><comments>https://b.blog/one/#comments</comments><slash:comments>12</slash:comments></item>
            <item><title>Two</title><link>https://b.blog/two/</link></item></channel></rss>"#;
        let f = super::parse(rss, "https://b.blog/feed/").unwrap();
        assert_eq!(f.items[0].comments, 12);
        assert_eq!(f.items[1].comments, -1);
        let atom = br#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:thr="http://purl.org/syndication/thread/1.0"><title>A</title>
            <entry><title>X</title><id>tag:a,1</id><link rel="alternate" href="https://a.blog/x"/><link rel="replies" href="https://a.blog/x#c" thr:count="3"/><updated>2026-11-01T00:00:00Z</updated></entry></feed>"#;
        assert_eq!(super::parse(atom, "https://a.blog/feed").unwrap().items[0].comments, 3);
    }

    #[test]
    fn paid_posts() {
        assert!(super::looks_paid("<p>Intro…</p><p>Keep reading with a 7-day free trial</p>"));
        assert!(super::looks_paid("This post is for paid subscribers"));
        assert!(!super::looks_paid("<p>A free post about subscribers and members.</p>"));
    }

    use super::*;

    #[test]
    fn finds_the_pages_a_post_links_to() {
        let html = r#"<p>Replying to <a href="https://tracydurnell.com/2026/11/09/sunset/?utm_source=rss#more">Tracy</a>,
            see <a href="https://me.example/older/">my older post</a>, <a href="https://bsky.app/profile/x">x</a>,
            <a class="hashtag" href="https://a.b/tags/x">#x</a> and <a href='https://kottke.org/26/11/thing'>Jason</a>
            (<a href="https://tracydurnell.com/2026/11/09/sunset/">again</a>).</p>"#;
        assert_eq!(super::story_links(html, "https://me.example/new/"),
            "https://tracydurnell.com/2026/11/09/sunset/ https://kottke.org/26/11/thing");
    }

    #[test]
    fn finds_what_a_post_shares() {
        let toot = r#"<p>New post: Pure comments <a href="https://fosstodon.org/tags/indieweb" class="mention hashtag">#<span>indieweb</span></a> <a href="https://kevquirk.com/blog/pure-comments" rel="nofollow"><span class="invisible">https://</span>kevquirk.com/blog/pure-c<span class="invisible">omments</span></a> cc <a href="https://m.s/@jim" class="u-url mention">@jim</a></p>"#;
        assert_eq!(story_shares(toot, "https://fosstodon.org/@kev/1"), "https://kevquirk.com/blog/pure-comments");
        assert_eq!(story_shares("Wrote about feeds: jim-nielsen.com/blog/2026/fe...", "https://bsky.app/profile/jim/post/1"), "jim-nielsen.com/blog/2026/fe");
        assert_eq!(story_shares("Just a thought, no links. See bsky.app/profile/x", "https://bsky.app/profile/a/post/1"), "");
    }

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
