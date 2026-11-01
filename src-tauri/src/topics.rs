//! Search a topic from Discover: current coverage from Google News, and personal sites from Marginalia,
//! a search engine for the small, independent web. Nothing is saved until you follow something.

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

/// Marginalia's public key is shared and often busy; a free key of your own can be set at build time.
async fn small_web(client: &reqwest::Client, query: &str) -> Result<Vec<WebHit>, String> {
    let key = option_env!("MARGINALIA_KEY").filter(|k| !k.trim().is_empty()).unwrap_or("public");
    let r = client.get("https://api2.marginalia-search.com/search")
        .query(&[("query", query), ("count", "20"), ("dc", "1")])
        .header("API-Key", key)
        .timeout(Duration::from_secs(15))
        .send().await.map_err(|_| "Couldn’t reach Marginalia, the search for personal sites.".to_string())?;
    if r.status().as_u16() == 503 || r.status().as_u16() == 429 {
        return Err("The search for personal sites is busy right now. Try again later.".into());
    }
    if !r.status().is_success() {
        return Err(format!("The search for personal sites didn’t answer ({}).", r.status().as_u16()));
    }
    let body = r.text().await.map_err(|_| "The search for personal sites didn’t answer in full.".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|_| "The search for personal sites sent something unexpected.".to_string())?;
    Ok(v["results"].as_array().cloned().unwrap_or_default().iter().filter_map(|x| {
        let url = x["url"].as_str()?.to_string();
        let site = url::Url::parse(&url).ok()?.host_str()?.trim_start_matches("www.").to_string();
        Some(WebHit { title: text(x["title"].as_str().unwrap_or("")), description: text(x["description"].as_str().unwrap_or("")), url, site })
    }).collect())
}

pub async fn search(client: &reqwest::Client, query: &str) -> Results {
    let q = query.trim();
    let feed = crate::feeds::google_news_url(q);
    let (n, w) = tokio::join!(news(client, &feed), small_web(client, q));
    let mut out = Results { query: q.to_string(), feed, ..Default::default() };
    match n { Ok(v) => out.news = v, Err(e) => out.news_error = e }
    match w { Ok(v) => out.web = v, Err(e) => out.web_error = e }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_google_news_items_with_their_outlet() {
        let xml = r#"<rss><channel><item><title>Small sites are back - The Verge</title><link>https://news.google.com/rss/articles/abc</link>
            <pubDate>Sun, 01 Nov 2026 14:00:00 GMT</pubDate><source url="https://www.theverge.com">The Verge</source></item></channel></rss>"#;
        let n = parse_news(xml);
        assert_eq!(n, vec![NewsHit { title: "Small sites are back".into(), link: "https://news.google.com/rss/articles/abc".into(),
            date: "2026-11-01T14:00:00Z".into(), source: "The Verge".into(), source_url: "https://www.theverge.com".into() }]);
    }
}
