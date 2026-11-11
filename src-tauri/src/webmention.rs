//! Webmention: telling another site that a page on yours links to one of theirs.
//! The app finds the site's Webmention address (an HTTP Link header, or a <link>/<a rel="webmention"> on the
//! page) and posts the two addresses to it. The other site then reads your page and decides what to show.

use regex::Regex;
use std::sync::OnceLock;
use std::time::Duration;

/// The Webmention address a page gives, from its Link header or its HTML. An empty href means the page itself.
pub fn endpoint_in(link_header: &str, html: &str, base: &url::Url) -> Option<String> {
    static LH: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    for c in LH.get_or_init(|| Regex::new(r#"<([^>]*)>\s*((?:;\s*[^,;]+)*)"#).unwrap()).captures_iter(link_header) {
        let params = c[2].to_ascii_lowercase();
        if Regex::new(r#"rel\s*=\s*"?([^";]*)"?"#).ok()?.captures(&params).is_some_and(|r| r[1].split_whitespace().any(|x| x == "webmention")) {
            return base.join(&c[1]).ok().map(|u| u.to_string());
        }
    }
    let attr = |tag: &str, name: &str| -> Option<String> {
        ATTR.get_or_init(|| Regex::new(r#"(?is)([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap())
            .captures_iter(tag)
            .find(|c| c[1].eq_ignore_ascii_case(name))
            .map(|c| c.get(3).or(c.get(4)).or(c.get(5)).map(|m| m.as_str().to_string()).unwrap_or_default())
    };
    for m in TAG.get_or_init(|| Regex::new(r#"(?is)<(?:link|a)\b[^>]*>"#).unwrap()).find_iter(html) {
        let tag = m.as_str();
        let Some(rel) = attr(tag, "rel") else { continue };
        if !rel.to_ascii_lowercase().split_whitespace().any(|x| x == "webmention") { continue; }
        let Some(href) = attr(tag, "href") else { continue };
        let href = html_escape::decode_html_entities(&href).to_string();
        return base.join(&href).ok().map(|u| u.to_string());
    }
    None
}

/// Find the target's Webmention address. None when the site doesn't take Webmentions.
pub async fn discover(client: &reqwest::Client, target: &str) -> Option<String> {
    let base = url::Url::parse(target).ok()?;
    let r = client.get(target).timeout(Duration::from_secs(15)).send().await.ok()?;
    let final_url = r.url().clone();
    let link = r.headers().get_all("link").iter().filter_map(|v| v.to_str().ok()).collect::<Vec<_>>().join(", ");
    let body = r.text().await.unwrap_or_default();
    let base = if final_url.as_str().is_empty() { base } else { final_url };
    let e = endpoint_in(&link, &body[..body.len().min(400_000)], &base)?;
    // only real web addresses, and never a local one
    let u = url::Url::parse(&e).ok()?;
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    if !matches!(u.scheme(), "http" | "https") || host == "localhost" || host.ends_with(".local") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback() || match ip { std::net::IpAddr::V4(v) => v.is_private() || v.is_link_local(), _ => false }) {
        return None;
    }
    Some(e)
}

/// Send one Webmention. Ok(false) when the target doesn't take Webmentions.
pub async fn send(client: &reqwest::Client, source: &str, target: &str) -> Result<bool, String> {
    let Some(endpoint) = discover(client, target).await else { return Ok(false) };
    let r = client.post(&endpoint).form(&[("source", source), ("target", target)]).timeout(Duration::from_secs(20)).send().await
        .map_err(|e| format!("Couldn't reach their site ({e})."))?;
    if r.status().is_success() { Ok(true) } else { Err(format!("Their site answered {} to the Webmention.", r.status().as_u16())) }
}

// ------------------------------------------------------------------ reactions other sites have received

/// How many likes, replies, reposts and mentions webmention.io has for a post (only sites that use
/// webmention.io have any; for the rest it's all zero).
#[derive(serde::Serialize, Default, Clone)]
pub struct Counts {
    pub url: String,
    pub like: i64,
    pub reply: i64,
    pub repost: i64,
    pub mention: i64,
}

#[tauri::command]
pub async fn wm_counts(urls: Vec<String>) -> Vec<Counts> {
    use futures::stream::{self, StreamExt};
    let client = crate::feeds::client();
    stream::iter(urls.into_iter().filter(|u| u.starts_with("http")).take(60))
        .map(|url| {
            let client = client.clone();
            async move {
                let mut c = Counts { url: url.clone(), ..Default::default() };
                let api = url::Url::parse_with_params("https://webmention.io/api/count.json", &[("target", url.as_str())]).map(|u| u.to_string()).unwrap_or_default();
                if let Ok(r) = client.get(&api).timeout(Duration::from_secs(12)).send().await {
                    if let Ok(v) = r.json::<serde_json::Value>().await {
                        let n = |k: &str| v["type"][k].as_i64().unwrap_or(0);
                        c.like = n("like") + n("bookmark");
                        c.reply = n("reply");
                        c.repost = n("repost");
                        c.mention = n("mention");
                    }
                }
                c
            }
        })
        .buffer_unordered(4)
        .collect()
        .await
}

/// Who liked, replied to, reposted or mentioned a post, from webmention.io (newest first, up to 40).
#[derive(serde::Serialize, Default)]
pub struct Reaction {
    pub kind: String,
    pub name: String,
    pub photo: String,
    pub url: String,
    pub text: String,
    pub date: String,
}

#[tauri::command]
pub async fn wm_mentions(url: String) -> Result<Vec<Reaction>, String> {
    let api = url::Url::parse_with_params("https://webmention.io/api/mentions.jf2", &[("target", url.as_str()), ("per-page", "40"), ("sort-dir", "down")]).map_err(|e| e.to_string())?.to_string();
    let v: serde_json::Value = crate::feeds::client().get(&api).timeout(Duration::from_secs(15)).send().await
        .map_err(|e| format!("Couldn't reach webmention.io ({e})."))?
        .json().await.map_err(|_| "webmention.io sent something unexpected.".to_string())?;
    let s = |x: &serde_json::Value, k: &str| x[k].as_str().unwrap_or("").to_string();
    Ok(v["children"].as_array().cloned().unwrap_or_default().iter().map(|c| Reaction {
        kind: match s(c, "wm-property").as_str() { "like-of" | "bookmark-of" => "like", "in-reply-to" => "reply", "repost-of" => "repost", _ => "mention" }.into(),
        name: s(&c["author"], "name"),
        photo: s(&c["author"], "photo"),
        url: Some(s(c, "url")).filter(|u| !u.is_empty()).unwrap_or_else(|| s(&c["author"], "url")),
        text: crate::feeds::plain(c["content"]["text"].as_str().unwrap_or(""), 400),
        date: Some(s(c, "published")).filter(|d| !d.is_empty()).unwrap_or_else(|| s(c, "wm-received")),
    }).collect())
}

#[cfg(test)]
mod tests {
    #[test]
    fn finds_the_endpoint() {
        let base = url::Url::parse("https://ex.blog/post/1").unwrap();
        assert_eq!(super::endpoint_in(r#"<https://webmention.io/ex/webmention>; rel="webmention""#, "", &base).as_deref(), Some("https://webmention.io/ex/webmention"));
        assert_eq!(super::endpoint_in("", r#"<link rel="webmention" href="/wp-json/webmention/1.0/endpoint">"#, &base).as_deref(), Some("https://ex.blog/wp-json/webmention/1.0/endpoint"));
        assert_eq!(super::endpoint_in(r#"<https://ex.blog/>; rel="canonical""#, r#"<a rel='nofollow webmention' href=''>"#, &base).as_deref(), Some("https://ex.blog/post/1"));
        assert_eq!(super::endpoint_in("", "<p>nothing</p>", &base), None);
    }
}
