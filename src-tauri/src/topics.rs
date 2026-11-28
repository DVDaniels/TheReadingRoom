//! Search a topic from Discover: current coverage from Google News, personal sites from Marginalia (a search
//! engine for the small, independent web), and fresh posts from Kagi Small Web (an open list of personal
//! sites, with a free feed of their newest posts). Nothing is saved until you follow something.

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct NewsHit {
    pub title: String,
    pub link: String,
    pub date: String,
    pub source: String,
    pub source_url: String,
}

#[derive(Serialize, Debug, Default)]
pub struct WebHit {
    pub title: String,
    pub url: String,
    pub description: String,
    pub site: String,
}

#[derive(Serialize, Debug, Default)]
pub struct Results {
    pub query: String,
    pub feed: String,
    pub news: Vec<NewsHit>,
    pub news_error: String,
    pub web: Vec<WebHit>,
    pub web_error: String,
    /// how many pages of personal sites there are (20 a page)
    pub web_pages: u32,
    /// recent posts from Kagi Small Web that mention the words
    pub small: Vec<SmallPost>,
}

/// A recent post from a personal site, from Kagi Small Web's feed.
#[derive(Serialize, Debug, Clone, Default)]
pub struct SmallPost {
    pub title: String,
    pub link: String,
    pub site: String,
    pub summary: String,
    pub image: String,
    pub date: String,
}

const SMALLWEB_FEED: &str = "https://kagi.com/api/v1/smallweb/feed/";

/// Kagi refreshes its feed every few hours; keep a copy for an hour so Discover doesn't ask every time.
pub async fn smallweb(client: &reqwest::Client) -> Result<Vec<SmallPost>, String> {
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, Vec<SmallPost>)>> = std::sync::Mutex::new(None);
    if let Some((at, posts)) = CACHE.lock().unwrap().as_ref() {
        if at.elapsed() < Duration::from_secs(3600) && !posts.is_empty() {
            return Ok(posts.clone());
        }
    }
    let (body, _, _) = crate::feeds::get(client, SMALLWEB_FEED).await.map_err(|_| "Couldn’t reach Kagi Small Web.".to_string())?;
    let parsed = crate::feeds::parse(&body, SMALLWEB_FEED).map_err(|_| "Kagi Small Web sent something unexpected.".to_string())?;
    let mut seen = std::collections::HashSet::new();
    let posts: Vec<SmallPost> = parsed.items.into_iter().filter_map(|i| {
        let site = url::Url::parse(&i.link).ok()?.host_str()?.trim_start_matches("www.").to_string();
        if i.title.trim().is_empty() || !seen.insert(i.link.clone()) { return None; }
        let summary: String = html_escape::decode_html_entities(&strip_tags(&i.summary)).split_whitespace().collect::<Vec<_>>().join(" ");
        let summary = if summary.chars().count() > 240 { format!("{}…", summary.chars().take(237).collect::<String>().trim_end()) } else { summary };
        Some(SmallPost { title: text(&i.title), link: i.link, site, summary, image: i.image, date: i.date })
    }).collect();
    if !posts.is_empty() {
        *CACHE.lock().unwrap() = Some((std::time::Instant::now(), posts.clone()));
    }
    Ok(posts)
}

fn strip_tags(s: &str) -> String {
    static TAGS: OnceLock<Regex> = OnceLock::new();
    re(&TAGS, r"(?s)<[^>]*>").replace_all(s, " ").into_owned()
}

/// Posts that mention the words: every word in the title counts most, then the summary and the site's name.
pub fn smallweb_matches(posts: &[SmallPost], query: &str) -> Vec<SmallPost> {
    let words: Vec<String> = query.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 2).map(String::from).collect();
    if words.is_empty() { return vec![]; }
    let mut scored: Vec<(usize, &SmallPost)> = posts.iter().filter_map(|p| {
        let (t, rest) = (p.title.to_lowercase(), format!("{} {}", p.summary, p.site).to_lowercase());
        let hits = words.iter().filter(|w| t.contains(w.as_str()) || rest.contains(w.as_str())).count();
        if hits == 0 || (words.len() > 1 && hits * 2 < words.len()) { return None; }
        Some((hits * 2 + words.iter().filter(|w| t.contains(w.as_str())).count() * 3, p))
    }).collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.date.cmp(&a.1.date)));
    scored.into_iter().take(12).map(|(_, p)| p.clone()).collect()
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

fn text(s: &str) -> String {
    let s = s.trim().trim_start_matches("<![CDATA[").trim_end_matches("]]>");
    html_escape::decode_html_entities(s).trim().to_string()
}

/// Google News' feed, with each story's outlet (its <source> element) kept.
pub fn parse_news(xml: &str) -> Vec<NewsHit> {
    static ITEM: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static SRC: OnceLock<Regex> = OnceLock::new();
    let tag = |block: &str, name: &str| -> String {
        let r = re(&TAG, r"(?s)<(title|link|pubDate)>(.*?)</(?:title|link|pubDate)>");
        r.captures_iter(block).find(|c| &c[1] == name).map(|c| text(&c[2])).unwrap_or_default()
    };
    re(&ITEM, r"(?s)<item>(.*?)</item>").captures_iter(xml).map(|c| {
        let b = &c[1];
        let (source, source_url) = re(&SRC, r#"(?s)<source[^>]*url="([^"]*)"[^>]*>(.*?)</source>"#)
            .captures(b).map(|s| (text(&s[2]), text(&s[1]))).unwrap_or_default();
        let mut title = tag(b, "title");
        if !source.is_empty() {
            if let Some(t) = title.strip_suffix(&format!(" - {source}")) { title = t.to_string(); }
        }
        let date = chrono::DateTime::parse_from_rfc2822(&tag(b, "pubDate")).map(|d| d.with_timezone(&chrono::Utc).format("%Y-%m-%dT%H:%M:%SZ").to_string()).unwrap_or_default();
        NewsHit { title, link: tag(b, "link"), date, source, source_url }
    }).filter(|n| !n.title.is_empty() && !n.link.is_empty()).collect()
}

async fn news(client: &reqwest::Client, url: &str) -> Result<Vec<NewsHit>, String> {
    let (body, _, _) = crate::feeds::get(client, url).await?;
    Ok(parse_news(&String::from_utf8_lossy(&body)).into_iter().take(30).collect())
}

// ---- Marginalia (marginalia-search.com), a search engine for the small, independent web. Its shared "public" key
// is often busy; the app's own non-commercial key (MARGINALIA_KEY at build time) also allows filters, a site's feed
// address and "sites like this one". Results are CC-BY-NC-SA 4.0: the app names Marginalia under them.
const MG: &str = "https://api2.marginalia-search.com";
/// Marginalia's own "blogosphere" set, saved under the app's key (filters can only be used by the key that made them).
const BLOGS_FILTER: &str = "readingroom-blogs";
const BLOGS_XML: &str = "<?xml version=\"1.0\"?>\n<filter>\n\t<search-set>BLOGS</search-set>\n</filter>\n";

fn mg_key() -> &'static str {
    option_env!("MARGINALIA_KEY").map(str::trim).filter(|k| !k.is_empty()).unwrap_or("public")
}
fn own_key() -> bool { mg_key() != "public" }

fn mg_err(status: u16, what: &str) -> String {
    match status {
        429 | 503 => format!("The search for {what} is busy right now. Try again in a minute."),
        401 => "Marginalia didn’t accept this version of the app. A newer version should fix it.".into(),
        _ => format!("The search for {what} didn’t answer ({status})."),
    }
}

/// The blogs filter, made once per run. None (search without it) if Marginalia won't take it.
async fn blogs_filter(client: &reqwest::Client) -> Option<&'static str> {
    static STATE: tokio::sync::Mutex<Option<(bool, std::time::Instant)>> = tokio::sync::Mutex::const_new(None);
    if !own_key() { return None; }
    let mut st = STATE.lock().await;
    if let Some((ok, at)) = *st {
        if ok { return Some(BLOGS_FILTER); }
        if at.elapsed() < Duration::from_secs(600) { return None; }
    }
    let ok = match client.post(format!("{MG}/filter/{BLOGS_FILTER}")).header("API-Key", mg_key())
        .header("Content-Type", "application/xml").body(BLOGS_XML).timeout(Duration::from_secs(10)).send().await {
        // 424: saved, but Marginalia's cache may take a moment to notice
        Ok(r) => r.status().is_success() || r.status().as_u16() == 424,
        Err(_) => false,
    };
    *st = Some((ok, std::time::Instant::now()));
    ok.then_some(BLOGS_FILTER)
}

/// One page of Marginalia results: (hits, pages).
async fn mg_search(client: &reqwest::Client, query: &str, page: u32, count: u32, per_site: u32, filter: Option<&str>) -> Result<(Vec<WebHit>, u32), String> {
    let mut q: Vec<(&str, String)> = vec![("query", query.to_string()), ("count", count.to_string()), ("dc", per_site.to_string()), ("page", page.max(1).to_string())];
    if let Some(f) = filter { q.push(("filter", f.to_string())); }
    let r = client.get(format!("{MG}/search")).query(&q).header("API-Key", mg_key()).timeout(Duration::from_secs(15))
        .send().await.map_err(|_| "Couldn’t reach Marginalia, the search for personal sites.".to_string())?;
    let status = r.status().as_u16();
    if !r.status().is_success() {
        // a filter Marginalia has lost or refuses: ask again without it
        if filter.is_some() && (400..500).contains(&status) && status != 429 {
            return Box::pin(mg_search(client, query, page, count, per_site, None)).await;
        }
        return Err(mg_err(status, "personal sites"));
    }
    let body = r.text().await.map_err(|_| "The search for personal sites didn’t answer in full.".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|_| "The search for personal sites sent something unexpected.".to_string())?;
    Ok((web_hits(&v), v["pages"].as_u64().unwrap_or(1) as u32))
}

fn web_hits(v: &serde_json::Value) -> Vec<WebHit> {
    v["results"].as_array().cloned().unwrap_or_default().iter().filter_map(|x| {
        let url = x["url"].as_str()?.to_string();
        let site = url::Url::parse(&url).ok()?.host_str()?.trim_start_matches("www.").to_string();
        Some(WebHit { title: text(x["title"].as_str().unwrap_or("")), description: text(x["description"].as_str().unwrap_or("")), url, site })
    }).collect()
}

/// One page of "Personal sites about …" (20 a page, one page per site).
pub async fn web_page(client: &reqwest::Client, query: &str, page: u32) -> Result<(Vec<WebHit>, u32), String> {
    let f = blogs_filter(client).await;
    let got = mg_search(client, query, page, 20, 1, f).await?;
    if got.0.is_empty() && f.is_some() && page == 1 { return mg_search(client, query, 1, 20, 1, None).await; }
    Ok(got)
}

/// Where a site's feed is, from Marginalia's crawl ("" when it doesn't know one). Kept for the run.
async fn site_feed(client: &reqwest::Client, site: &str) -> String {
    static CACHE: std::sync::Mutex<Option<std::collections::HashMap<String, String>>> = std::sync::Mutex::new(None);
    if let Some(f) = CACHE.lock().unwrap().as_ref().and_then(|m| m.get(site).cloned()) { return f; }
    if !own_key() { return String::new(); }
    let feed = match client.get(format!("{MG}/site/{site}/feed")).header("API-Key", mg_key()).timeout(Duration::from_secs(6)).send().await {
        Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok()
            .and_then(|v| v["url"].as_str().map(str::to_string)).filter(|u| u.starts_with("http")).unwrap_or_default(),
        Ok(r) if r.status().as_u16() == 429 => return String::new(), // don't remember a busy answer
        _ => String::new(),
    };
    CACHE.lock().unwrap().get_or_insert_with(Default::default).insert(site.to_string(), feed.clone());
    feed
}

/// A blog to follow: its site, a post of theirs that matched, and its feed when Marginalia knows it.
#[derive(Serialize, Debug, Clone, Default)]
pub struct BlogHit {
    pub site: String,
    pub feed: String,
    pub post_title: String,
    pub post_url: String,
    pub description: String,
}

/// "Find blogs about …": sites rather than pages. Marginalia's blogs set, one result per site; each with its feed.
pub async fn blogs_about(client: &reqwest::Client, query: &str, page: u32) -> Result<(Vec<BlogHit>, u32), String> {
    use futures::stream::{self, StreamExt};
    let f = blogs_filter(client).await;
    let (mut hits, mut pages) = mg_search(client, query, page, 30, 1, f).await?;
    if hits.is_empty() && f.is_some() && page == 1 { (hits, pages) = mg_search(client, query, 1, 30, 1, None).await?; }
    let mut seen = std::collections::HashSet::new();
    hits.retain(|h| !big_site(&h.site) && seen.insert(h.site.clone()));
    hits.truncate(18);
    let out: Vec<BlogHit> = stream::iter(hits).map(|h| async move {
        let feed = site_feed(client, &h.site).await;
        BlogHit { site: h.site, feed, post_title: h.title, post_url: h.url, description: h.description }
    }).buffered(4).collect().await;
    Ok((out, pages))
}

/// Sites Marginalia finds most like this one (by who links to both), that it can still reach. With feeds.
#[derive(Serialize, Debug, Clone, Default)]
pub struct Similar {
    pub site: String,
    pub feed: String,
    pub relatedness: f64,
}

pub async fn similar_sites(client: &reqwest::Client, site: &str) -> Result<Vec<Similar>, String> {
    use futures::stream::{self, StreamExt};
    static CACHE: std::sync::Mutex<Option<std::collections::HashMap<String, (std::time::Instant, Vec<Similar>)>>> = std::sync::Mutex::new(None);
    let site = site.trim().trim_start_matches("www.").to_lowercase();
    if site.is_empty() || !site.contains('.') { return Ok(vec![]); }
    if let Some((at, v)) = CACHE.lock().unwrap().as_ref().and_then(|m| m.get(&site).cloned()) {
        if at.elapsed() < Duration::from_secs(6 * 3600) { return Ok(v); }
    }
    if !own_key() { return Err("Finding sites like this one needs a newer version of the app.".into()); }
    let r = client.get(format!("{MG}/site/{site}/similar")).query(&[("count", "30")]).header("API-Key", mg_key())
        .timeout(Duration::from_secs(10)).send().await.map_err(|_| "Couldn’t reach Marginalia.".to_string())?;
    let status = r.status().as_u16();
    if status == 404 { return Ok(vec![]); } // Marginalia hasn't crawled this site
    if !r.status().is_success() { return Err(mg_err(status, "similar sites")); }
    let v: serde_json::Value = r.json().await.map_err(|_| "Marginalia sent something unexpected.".to_string())?;
    let cands = similar_list(&v, &site);
    let mut out: Vec<Similar> = stream::iter(cands).map(|(d, rel)| async move {
        Similar { feed: site_feed(client, &d).await, site: d, relatedness: rel }
    }).buffered(4).collect().await;
    // blogs first: ones with a feed
    out.sort_by(|a, b| (b.feed.is_empty() as u8).cmp(&(a.feed.is_empty() as u8)).reverse().then(b.relatedness.total_cmp(&a.relatedness)));
    out.truncate(10);
    CACHE.lock().unwrap().get_or_insert_with(Default::default).insert(site, (std::time::Instant::now(), out.clone()));
    Ok(out)
}

/// The answer of /site/{domain}/similar → (domain, relatedness), indexed and still up, not the site itself or a big one.
fn similar_list(v: &serde_json::Value, site: &str) -> Vec<(String, f64)> {
    let mut seen = std::collections::HashSet::new();
    let mut list: Vec<(String, f64)> = v["results"].as_array().cloned().unwrap_or_default().iter().filter_map(|x| {
        let d = x["domain"].as_str()?.trim_start_matches("www.").to_lowercase();
        if x["active"].as_bool() == Some(false) || x["indexed"].as_bool() == Some(false) { return None; }
        if d == site || big_site(&d) || !seen.insert(d.clone()) { return None; }
        Some((d, x["relatedness"].as_f64().unwrap_or(0.0)))
    }).collect();
    list.sort_by(|a, b| b.1.total_cmp(&a.1));
    list.truncate(16);
    list
}

/// Platforms and big outlets: not "a blog like this one".
fn big_site(d: &str) -> bool {
    const BIG: [&str; 24] = ["wikipedia.org", "github.com", "youtube.com", "twitter.com", "x.com", "facebook.com", "reddit.com", "medium.com",
        "google.com", "amazon.com", "apple.com", "microsoft.com", "linkedin.com", "instagram.com", "nytimes.com", "theguardian.com",
        "bbc.co.uk", "archive.org", "stackoverflow.com", "news.ycombinator.com", "substack.com", "wordpress.com", "blogspot.com", "tumblr.com"];
    BIG.iter().any(|b| d == *b || d.ends_with(&format!(".{b}")) && !matches!(*b, "substack.com" | "wordpress.com" | "blogspot.com" | "tumblr.com"))
}

pub async fn search(client: &reqwest::Client, query: &str) -> Results {
    let q = query.trim();
    let feed = crate::feeds::google_news_url(q);
    let (n, w, sw) = tokio::join!(news(client, &feed), web_page(client, q, 1), smallweb(client));
    let mut out = Results { query: q.to_string(), feed, ..Default::default() };
    if let Ok(posts) = sw { out.small = smallweb_matches(&posts, q); }
    match n { Ok(v) => out.news = v, Err(e) => out.news_error = e }
    match w { Ok((v, p)) => { out.web = v; out.web_pages = p; } Err(e) => out.web_error = e }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_web_matches_the_words() {
        let p = |t: &str, s: &str| SmallPost { title: t.into(), summary: s.into(), site: "x.com".into(), ..Default::default() };
        let posts = vec![p("Notes on home espresso", ""), p("Gardening", "my espresso machine broke"), p("Cats", "nothing here")];
        let m = smallweb_matches(&posts, "home espresso");
        assert_eq!(m.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), vec!["Notes on home espresso", "Gardening"]);
        assert!(smallweb_matches(&posts, "a").is_empty());
    }

    #[test]
    fn similar_sites_from_marginalia() {
        let v: serde_json::Value = serde_json::from_str(r#"{"domain":"kevquirk.com","results":[
            {"domain":"www.rknight.me","relatedness":0.5,"ranking":1.0,"linkType":"BIDIRECTIONAL","indexed":true,"active":true},
            {"domain":"danq.me","relatedness":0.8,"ranking":1.0,"linkType":"FOWARD","indexed":true,"active":true},
            {"domain":"gone.example","relatedness":0.9,"ranking":1.0,"linkType":"NONE","indexed":true,"active":false},
            {"domain":"github.com","relatedness":0.9,"ranking":1.0,"linkType":"NONE","indexed":true,"active":true},
            {"domain":"kevquirk.com","relatedness":1.0,"ranking":1.0,"linkType":"NONE","indexed":true,"active":true}]}"#).unwrap();
        assert_eq!(similar_list(&v, "kevquirk.com"), vec![("danq.me".to_string(), 0.8), ("rknight.me".to_string(), 0.5)]);
    }

    #[test]
    fn big_sites_but_not_personal_blogs_on_platforms() {
        assert!(big_site("github.com") && big_site("en.wikipedia.org") && big_site("medium.com"));
        assert!(!big_site("someone.substack.com") && !big_site("ann.wordpress.com") && !big_site("danq.me"));
    }

    #[test]
    fn reads_marginalia_results() {
        let v: serde_json::Value = serde_json::from_str(r#"{"license":"CC-BY-NC-SA 4.0","query":"x","page":1,"pages":3,"results":[
            {"url":"https://www.example.org/post","title":"A &amp; B","description":"About it","quality":1.0,"format":"html","resultsFromDomain":1,"details":[]}]}"#).unwrap();
        let h = web_hits(&v);
        assert_eq!((h[0].site.as_str(), h[0].title.as_str()), ("example.org", "A & B"));
    }

    #[test]
    fn reads_google_news_items_with_their_outlet() {
        let xml = r#"<rss><channel><item><title>Small sites are back - The Verge</title><link>https://news.google.com/rss/articles/abc</link>
            <pubDate>Sun, 01 Nov 2026 14:00:00 GMT</pubDate><source url="https://www.theverge.com">The Verge</source></item></channel></rss>"#;
        let n = parse_news(xml);
        assert_eq!(n, vec![NewsHit { title: "Small sites are back".into(), link: "https://news.google.com/rss/articles/abc".into(),
            date: "2026-11-01T14:00:00Z".into(), source: "The Verge".into(), source_url: "https://www.theverge.com".into() }]);
    }
}
