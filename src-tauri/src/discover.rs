//! Discover: blogs worth following, found through the sites you already read.
//!
//! Two sources, both read straight from those sites (no service in between):
//! - Blogrolls: an OPML list advertised with `<link rel="blogroll">`, `/.well-known/recommendations.opml`,
//!   or a "Blogroll" page linked from the home page.
//! - Links: sites your feeds keep linking to in their recent posts.
//!
//! Each candidate is checked for a working feed before it's suggested.

use crate::{feeds, opml};
use futures::stream::{self, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// Sites that are platforms or references rather than blogs to follow.
const SKIP: &[&str] = &[
    "twitter.com", "x.com", "t.co", "facebook.com", "fb.com", "instagram.com", "linkedin.com", "youtube.com", "youtu.be",
    "tiktok.com", "threads.net", "bsky.app", "mastodon.social", "reddit.com", "pinterest.com", "github.com",
    "gist.github.com", "gitlab.com", "wikipedia.org", "wikimedia.org", "google.com", "goo.gl", "apple.com", "apps.apple.com",
    "amazon.com", "amzn.to", "bit.ly", "buff.ly", "ow.ly", "feedburner.com", "feeds.feedburner.com", "patreon.com",
    "ko-fi.com", "buymeacoffee.com", "paypal.com", "paypal.me", "w3.org", "developer.mozilla.org", "caniuse.com",
    "npmjs.com", "archive.org", "web.archive.org", "creativecommons.org", "wordpress.org", "wordpress.com",
    "gravatar.com", "substack.com", "medium.com", "spotify.com", "open.spotify.com", "podcasts.apple.com", "vimeo.com",
    "flickr.com", "imgur.com", "discord.com", "discord.gg", "slack.com", "zoom.us", "eventbrite.com", "meetup.com",
    "news.google.com", "feedly.com", "inoreader.com", "codepen.io", "stackoverflow.com", "w3c.github.io", "schema.org",
    "unsplash.com", "giphy.com", "tumblr.com", "linktr.ee", "mailchimp.com", "list-manage.com", "ghost.org",
    "microsoft.com", "netlify.app", "vercel.app", "cloudflare.com", "mozilla.org", "chrome.google.com", "addons.mozilla.org",
];

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Post {
    pub title: String,
    pub link: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Suggestion {
    pub domain: String,
    pub title: String,
    pub site: String,
    pub feed: String,
    /// Followed sites whose blogroll lists it
    pub rolls: Vec<String>,
    /// Followed sites that linked to it lately, and how many links in all
    pub linkers: Vec<String>,
    pub links: usize,
    pub posts: Vec<Post>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Report {
    pub at: String,
    pub sites: usize,
    pub rolls_found: Vec<String>,
    pub suggestions: Vec<Suggestion>,
}

pub struct Source {
    pub title: String,
    pub url: String,
    pub site: String,
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

/// "www.example.com" → "example.com"
pub fn domain_of(u: &str) -> Option<String> {
    let host = url::Url::parse(u).ok()?.host_str()?.to_ascii_lowercase();
    Some(host.trim_start_matches("www.").to_string())
}

/// Hosts where each subdomain is someone's own blog (name.substack.com is fine, substack.com isn't).
const BLOG_HOSTS: &[&str] = &["substack.com", "wordpress.com", "tumblr.com", "medium.com", "netlify.app", "vercel.app", "ghost.io"];

fn skipped(domain: &str) -> bool {
    SKIP.iter().any(|s| domain == *s || (domain.ends_with(&format!(".{s}")) && !BLOG_HOSTS.contains(s)))
}

/// Attributes of one tag, lower-cased names.
fn attrs(tag: &str) -> HashMap<String, String> {
    static ATTR: OnceLock<Regex> = OnceLock::new();
    re(&ATTR, r#"(?is)([a-z:-]+)\s*=\s*["']([^"']*)["']"#)
        .captures_iter(tag)
        .map(|c| (c[1].to_ascii_lowercase(), html_escape::decode_html_entities(&c[2]).to_string()))
        .collect()
}

/// Where a home page says its blogroll lives: an OPML file or a page.
pub fn blogroll_links(html: &str, base: &url::Url) -> (Vec<String>, Vec<String>) {
    static LINK: OnceLock<Regex> = OnceLock::new();
    static A: OnceLock<Regex> = OnceLock::new();
    let mut opml = Vec::new();
    let mut pages = Vec::new();
    for tag in re(&LINK, r"(?is)<link\b[^>]*>").find_iter(html) {
        let a = attrs(tag.as_str());
        let rel = a.get("rel").map(|r| r.to_ascii_lowercase()).unwrap_or_default();
        if rel.split_whitespace().any(|r| r == "blogroll") {
            if let Some(u) = a.get("href").and_then(|h| base.join(h).ok()) {
                opml.push(u.to_string());
            }
        }
    }
    for c in re(&A, r#"(?is)<a\b([^>]*)>(.*?)</a>"#).captures_iter(html) {
        let a = attrs(&c[1]);
        let Some(href) = a.get("href") else { continue };
        let text = feeds::plain(&c[2], 80).to_ascii_lowercase();
        let path = href.to_ascii_lowercase();
        let is_roll = path.contains("blogroll") || text == "blogroll" || text.contains("blogs i read") || text.contains("blogs i follow") || text == "links" && path.contains("/links");
        if !is_roll {
            continue;
        }
        if let Ok(u) = base.join(href) {
            if u.host_str() != base.host_str() {
                continue;
            }
            let s = u.to_string();
            if s.ends_with(".opml") || s.ends_with(".xml") {
                opml.push(s);
            } else if !pages.contains(&s) {
                pages.push(s);
            }
        }
    }
    (opml, pages)
}

/// Every outside link in a page or post: (address, link text).
pub fn outside_links(html: &str, own: &str) -> Vec<(String, String)> {
    static A: OnceLock<Regex> = OnceLock::new();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for c in re(&A, r#"(?is)<a\b([^>]*)>(.*?)</a>"#).captures_iter(html) {
        let a = attrs(&c[1]);
        let Some(href) = a.get("href") else { continue };
        if !href.starts_with("http") {
            continue;
        }
        let Some(d) = domain_of(href) else { continue };
        if d == own || d.ends_with(&format!(".{own}")) || own.ends_with(&format!(".{d}")) || skipped(&d) {
            continue;
        }
        if seen.insert(d) {
            out.push((href.clone(), feeds::plain(&c[2], 80)));
        }
    }
    out
}

/// One entry from a blogroll: the site or feed address and its name.
struct Entry {
    url: String,
    feed: Option<String>,
    title: String,
}

struct Scan {
    title: String,
    roll: Vec<Entry>,
    links: Vec<String>,
}

async fn text(client: &reqwest::Client, url: &str) -> Option<(String, String, bool)> {
    let fut = feeds::get(client, url);
    let (body, final_url, ctype) = tokio::time::timeout(std::time::Duration::from_secs(15), fut).await.ok()?.ok()?;
    let html = feeds::looks_like_html(&body, &ctype);
    Some((String::from_utf8_lossy(&body).to_string(), final_url, html))
}

fn opml_entries(text: &str) -> Vec<Entry> {
    opml::parse(text)
        .unwrap_or_default()
        .into_iter()
        .map(|o| Entry { url: o.url.clone(), feed: Some(o.url), title: o.title })
        .collect()
}

/// Read one followed site: its blogroll, and the outside links in its recent posts.
async fn scan_one(client: &reqwest::Client, src: &Source) -> Scan {
    let mut scan = Scan { title: src.title.clone(), roll: Vec::new(), links: Vec::new() };
    let home = if src.site.starts_with("http") { src.site.clone() } else { src.url.clone() };
    let Ok(home_url) = url::Url::parse(&home) else { return scan };
    let Ok(origin) = home_url.join("/") else { return scan };
    let own = domain_of(origin.as_str()).unwrap_or_default();

    // Links in recent posts
    if let Some((body, final_url, html)) = text(client, &src.url).await {
        if !html {
            if let Ok(feed) = feed_rs::parser::Builder::new().base_uri(Some(&final_url)).build().parse(body.as_bytes()) {
                let cutoff = chrono::Utc::now() - chrono::Duration::days(90);
                for e in feed.entries.iter().take(40) {
                    if e.published.or(e.updated).is_some_and(|d| d < cutoff) {
                        continue;
                    }
                    let html = format!(
                        "{} {}",
                        e.content.as_ref().and_then(|c| c.body.clone()).unwrap_or_default(),
                        e.summary.as_ref().map(|s| s.content.clone()).unwrap_or_default()
                    );
                    scan.links.extend(outside_links(&html, &own).into_iter().map(|(u, _)| u));
                }
            }
        }
    }

    // Blogroll: advertised OPML, the well-known file, then a blogroll page
    let mut opml_urls = Vec::new();
    let mut pages = Vec::new();
    if let Some((page, final_url, true)) = text(client, origin.as_str()).await {
        if let Ok(base) = url::Url::parse(&final_url) {
            let (o, p) = blogroll_links(&page, &base);
            opml_urls = o;
            pages = p;
        }
    }
    if let Ok(u) = origin.join("/.well-known/recommendations.opml") {
        opml_urls.push(u.to_string());
    }
    for u in opml_urls.iter().take(3) {
        if let Some((t, _, false)) = text(client, u).await {
            let entries = opml_entries(&t);
            if !entries.is_empty() {
                scan.roll = entries;
                return scan;
            }
        }
    }
    if pages.is_empty() {
        if let Ok(u) = origin.join("/blogroll/") {
            pages.push(u.to_string());
        }
    }
    for p in pages.iter().take(2) {
        if let Some((page, final_url, true)) = text(client, p).await {
            // Only the page's main part, so the header and footer links don't count
            let main = page
                .find("<main")
                .or_else(|| page.find("<article"))
                .map(|i| &page[i..])
                .unwrap_or(&page);
            let own_final = domain_of(&final_url).unwrap_or(own.clone());
            let entries: Vec<Entry> = outside_links(main, &own_final)
                .into_iter()
                .take(200)
                .map(|(url, title)| Entry { url, feed: None, title })
                .collect();
            if entries.len() >= 3 {
                scan.roll = entries;
                return scan;
            }
        }
    }
    scan
}

struct Candidate {
    domain: String,
    url: String,
    feed: Option<String>,
    title: String,
    rolls: Vec<String>,
    linkers: Vec<String>,
    links: usize,
}

impl Candidate {
    fn score(&self) -> usize {
        self.rolls.len() * 4 + self.linkers.len() * 2 + self.links
    }
}

/// Look through every followed site and return suggestions, best first.
/// `followed` holds the domains already followed; `hidden` the ones you said no to.
pub async fn run(
    client: &reqwest::Client,
    sources: Vec<Source>,
    followed: HashSet<String>,
    hidden: HashSet<String>,
    progress: impl Fn(usize, usize),
) -> Report {
    let total = sources.len();
    let client = client.clone();
    let mut done = 0;
    progress(0, total);
    let mut scans = Vec::new();
    let mut s = stream::iter(sources.into_iter().map(|src| {
        let client = client.clone();
        async move { scan_one(&client, &src).await }
    }))
    .buffer_unordered(6)
    .boxed();
    while let Some(scan) = s.next().await {
        done += 1;
        progress(done, total);
        scans.push(scan);
    }

    let mut cands: HashMap<String, Candidate> = HashMap::new();
    let mut rolls_found = Vec::new();
    for scan in &scans {
        if !scan.roll.is_empty() {
            rolls_found.push(scan.title.clone());
        }
        for e in &scan.roll {
            let Some(d) = domain_of(&e.url) else { continue };
            if skipped(&d) {
                continue;
            }
            let c = cands.entry(d.clone()).or_insert_with(|| Candidate {
                domain: d.clone(), url: e.url.clone(), feed: None, title: String::new(), rolls: vec![], linkers: vec![], links: 0,
            });
            if c.feed.is_none() {
                c.feed = e.feed.clone();
            }
            if c.title.is_empty() && !e.title.is_empty() {
                c.title = e.title.clone();
            }
            if !c.rolls.contains(&scan.title) {
                c.rolls.push(scan.title.clone());
            }
        }
        for l in &scan.links {
            let Some(d) = domain_of(l) else { continue };
            let c = cands.entry(d.clone()).or_insert_with(|| Candidate {
                domain: d.clone(), url: l.clone(), feed: None, title: String::new(), rolls: vec![], linkers: vec![], links: 0,
            });
            c.links += 1;
            if !c.linkers.contains(&scan.title) {
                c.linkers.push(scan.title.clone());
            }
        }
    }

    let mut list: Vec<Candidate> = cands
        .into_values()
        .filter(|c| !followed.contains(&c.domain) && !hidden.contains(&c.domain))
        .filter(|c| !c.rolls.is_empty() || c.linkers.len() >= 2 || c.links >= 3)
        .collect();
    list.sort_by(|a, b| b.score().cmp(&a.score()).then(a.domain.cmp(&b.domain)));
    list.truncate(36);

    // Check each one has a feed, and grab its latest posts
    let checked: Vec<Option<Suggestion>> = stream::iter(list.into_iter().map(|c| {
        let client = client.clone();
        async move {
        let try_url = c.feed.clone().unwrap_or_else(|| {
            url::Url::parse(&c.url).ok().and_then(|u| u.join("/").ok()).map(|u| u.to_string()).unwrap_or(c.url.clone())
        });
        let fetched = tokio::time::timeout(std::time::Duration::from_secs(20), feeds::fetch(&client, &try_url)).await.ok()?.ok()?;
        if fetched.items.is_empty() {
            return None;
        }
        let mut items = fetched.items;
        items.sort_by(|a, b| b.date.cmp(&a.date));
        // People, not publications: a site posting seven or more times a week is an outlet
        let week_ago = (chrono::Utc::now() - chrono::Duration::days(7)).format("%Y-%m-%dT%H:%M:%SZ").to_string();
        if items.iter().filter(|i| i.date >= week_ago).count() >= 7 {
            return None;
        }
        let posts = items.iter().take(3).map(|i| Post { title: i.title.clone(), link: i.link.clone(), date: i.date.clone() }).collect();
        let site = if fetched.site.starts_with("http") {
            fetched.site.clone()
        } else {
            url::Url::parse(&c.url).ok().and_then(|u| u.join("/").ok()).map(|u| u.to_string()).unwrap_or_default()
        };
        let title = [fetched.title.clone(), c.title.clone(), c.domain.clone()].into_iter().find(|t| !t.trim().is_empty()).unwrap_or_default();
        Some(Suggestion {
            domain: c.domain,
            title,
            site,
            feed: fetched.url,
            rolls: c.rolls,
            linkers: c.linkers,
            links: c.links,
            posts,
        })
        }
    }))
    .buffered(6)
    .collect()
    .await;

    let mut seen_feeds = HashSet::new();
    let suggestions: Vec<Suggestion> = checked
        .into_iter()
        .flatten()
        .filter(|s| domain_of(&s.feed).map_or(true, |d| !followed.contains(&d)))
        .filter(|s| seen_feeds.insert(s.feed.clone()))
        .take(24)
        .collect();

    Report { at: feeds::now_iso(), sites: total, rolls_found, suggestions }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_blogroll_links() {
        let base = url::Url::parse("https://example.com/").unwrap();
        let html = r#"<head><link rel="blogroll" type="text/xml" href="/blogroll.opml"></head>
            <nav><a href="/about">About</a> <a href="/blogroll/">Blogroll</a> <a href="https://other.com/blogroll">x</a></nav>"#;
        let (o, p) = blogroll_links(html, &base);
        assert_eq!(o, vec!["https://example.com/blogroll.opml"]);
        assert_eq!(p, vec!["https://example.com/blogroll/"]);
    }

    #[test]
    fn outside_links_skip_own_and_platforms() {
        let html = r#"<a href="https://example.com/post">mine</a> <a href="https://www.friend.blog/">Friend</a>
            <a href="https://twitter.com/x">tw</a> <a href="https://friend.blog/again">again</a> <a href="https://name.substack.com/p/1">sub</a>"#;
        let l = outside_links(html, "example.com");
        let ds: Vec<_> = l.iter().map(|(u, _)| domain_of(u).unwrap()).collect();
        assert_eq!(ds, vec!["friend.blog", "name.substack.com"]);
        assert_eq!(l[0].1, "Friend");
    }
}
