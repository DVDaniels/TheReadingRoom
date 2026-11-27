//! When YouTube won't give out a channel's feed (it answers "not found" for some channels, again and again,
//! while their pages work fine), read the channel's Videos page instead and make the same list from it.

use crate::feeds::{Fetched, ParsedItem};
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

/// The channel's id (UC…) from a feed address, a /channel/ page, or an uploads playlist (UU…, UULF… → UC…).
pub fn channel_from_url(url: &str) -> Option<String> {
    static CH: OnceLock<Regex> = OnceLock::new();
    static UU: OnceLock<Regex> = OnceLock::new();
    if let Some(c) = re(&CH, r"(?:channel_id=|/channel/)(UC[A-Za-z0-9_-]{22})").captures(url) {
        return Some(c[1].to_string());
    }
    re(&UU, r"playlist_id=UU(?:LF|SH)?([A-Za-z0-9_-]{22})").captures(url).map(|c| format!("UC{}", &c[1]))
}

/// The channel's id from its page.
fn channel_from_html(html: &str) -> Option<String> {
    static ID: OnceLock<Regex> = OnceLock::new();
    re(&ID, r#""(?:externalId|channelId)":"(UC[A-Za-z0-9_-]{22})""#)
        .captures(html)
        .map(|c| c[1].to_string())
        .or_else(|| channel_from_url(html))
}

/// The page to read: the channel's Videos tab.
fn videos_page(url: &str) -> Option<String> {
    if let Some(id) = channel_from_url(url) {
        return Some(format!("https://www.youtube.com/channel/{id}/videos"));
    }
    let u = url::Url::parse(url).ok()?;
    let host = u.host_str()?.trim_start_matches("www.").trim_start_matches("m.");
    if host != "youtube.com" {
        return None;
    }
    let segs: Vec<&str> = u.path_segments()?.filter(|s| !s.is_empty()).collect();
    match segs.as_slice() {
        [h, ..] if h.starts_with('@') => Some(format!("https://www.youtube.com/{h}/videos")),
        ["c" | "user", name, ..] => Some(format!("https://www.youtube.com/{}/{name}/videos", segs[0])),
        _ => None,
    }
}

/// "4 days ago", "2 weeks ago", "Streamed 3 hours ago" → about when, counted back from now.
fn when(ago: &str, now: chrono::DateTime<chrono::Utc>) -> String {
    static AGO: OnceLock<Regex> = OnceLock::new();
    let t = ago.to_ascii_lowercase();
    let back = re(&AGO, r"(\d+)\s*(second|minute|hour|day|week|month|year)").captures(&t).map(|c| {
        let n: i64 = c[1].parse().unwrap_or(0);
        match &c[2] {
            "second" => chrono::Duration::seconds(n),
            "minute" => chrono::Duration::minutes(n),
            "hour" => chrono::Duration::hours(n),
            "day" => chrono::Duration::days(n),
            "week" => chrono::Duration::weeks(n),
            "month" => chrono::Duration::days(30 * n),
            _ => chrono::Duration::days(365 * n),
        }
    });
    // whole days and longer are rounded to the start of the hour, so the time doesn't wander between checks
    let at = now - back.unwrap_or_else(chrono::Duration::zero);
    at.format("%Y-%m-%dT%H:00:00Z").to_string()
}

fn text(v: &Value) -> String {
    v["content"].as_str().or_else(|| v["simpleText"].as_str()).map(String::from).unwrap_or_else(|| {
        v["runs"].as_array().map(|r| r.iter().filter_map(|x| x["text"].as_str()).collect::<String>()).unwrap_or_default()
    })
}

/// The videos listed in a channel page's ytInitialData (the new "lockup" layout and the older one).
pub fn parse_page(html: &str, now: chrono::DateTime<chrono::Utc>) -> Option<Fetched> {
    let start = html.find("ytInitialData = ").map(|i| i + "ytInitialData = ".len())?;
    let rest = &html[start..];
    let end = rest.find(";</script>")?;
    let data: Value = serde_json::from_str(&rest[..end]).ok()?;
    let meta = &data["metadata"]["channelMetadataRenderer"];
    let title = meta["title"].as_str().unwrap_or_default().trim().to_string();
    let site = meta["channelUrl"].as_str().map(String::from).or_else(|| channel_from_html(html).map(|id| format!("https://www.youtube.com/channel/{id}")))?;
    let id = channel_from_url(&site)?;

    let mut items = Vec::new();
    let mut stack = vec![&data["contents"]];
    while let Some(v) = stack.pop() {
        match v {
            Value::Array(a) => stack.extend(a.iter().rev()),
            Value::Object(o) => {
                if let Some(l) = o.get("lockupViewModel").filter(|l| l["contentType"] == "LOCKUP_CONTENT_TYPE_VIDEO") {
                    let vid = l["contentId"].as_str().unwrap_or_default();
                    let m = &l["metadata"]["lockupMetadataViewModel"];
                    let rows = m["metadata"]["contentMetadataViewModel"]["metadataRows"].as_array().cloned().unwrap_or_default();
                    let parts: Vec<String> = rows.iter().flat_map(|r| r["metadataParts"].as_array().cloned().unwrap_or_default()).map(|p| p["accessibilityLabel"].as_str().map(String::from).unwrap_or_else(|| text(&p["text"]))).collect();
                    let ago = parts.iter().find(|p| p.contains("ago")).cloned().unwrap_or_default();
                    let members = rows.iter().flat_map(|r| r["badges"].as_array().cloned().unwrap_or_default()).any(|b| b["badgeViewModel"]["badgeStyle"] == "BADGE_MEMBERS_ONLY");
                    let thumb = l["contentImage"]["thumbnailViewModel"]["image"]["sources"].as_array().and_then(|s| s.last()).and_then(|s| s["url"].as_str()).unwrap_or_default();
                    push(&mut items, vid, &text(&m["title"]), &ago, thumb, members, now);
                } else if let Some(r) = o.get("videoRenderer") {
                    let vid = r["videoId"].as_str().unwrap_or_default();
                    let members = r["badges"].as_array().is_some_and(|b| b.iter().any(|x| x["metadataBadgeRenderer"]["style"] == "BADGE_STYLE_TYPE_MEMBERS_ONLY"));
                    let thumb = r["thumbnail"]["thumbnails"].as_array().and_then(|s| s.last()).and_then(|s| s["url"].as_str()).unwrap_or_default();
                    push(&mut items, vid, &text(&r["title"]), &text(&r["publishedTimeText"]), thumb, members, now);
                } else {
                    stack.extend(o.values().rev());
                }
            }
            _ => {}
        }
    }
    if items.is_empty() {
        return None;
    }
    Some(Fetched { url: format!("https://www.youtube.com/feeds/videos.xml?channel_id={id}"), title, site, items, tips: String::new() })
}

fn push(items: &mut Vec<ParsedItem>, vid: &str, title: &str, ago: &str, thumb: &str, members: bool, now: chrono::DateTime<chrono::Utc>) {
    let ok = vid.len() == 11 && vid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok || items.iter().any(|i| i.link.ends_with(vid)) {
        return;
    }
    // the same address the feed uses, so a video read here isn't shown twice once the feed comes back
    let link = format!("https://www.youtube.com/watch?v={vid}");
    let title = title.trim();
    let image = thumb.split('?').next().unwrap_or_default().to_string();
    items.push(ParsedItem {
        key: link.clone(),
        title: if members { format!("{title} (members only)") } else { title.to_string() },
        link,
        date: when(ago, now),
        summary: String::new(),
        image: if image.starts_with("https://") { image } else { format!("https://i.ytimg.com/vi/{vid}/hqdefault.jpg") },
        audio: String::new(),
        shares: String::new(),
        paid: members,
        links: String::new(),
        comments: -1,
        tags: String::new(),
        videos: String::new(),
    });
}

/// A single video's id, from any of YouTube's video addresses (watch, youtu.be, shorts, live, embed).
pub fn video_id(url: &str) -> Option<String> {
    static V: OnceLock<Regex> = OnceLock::new();
    re(&V, r"^(?:https?://)?(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:[^#]*?&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})")
        .captures(url.trim())
        .map(|c| c[1].to_string())
}

/// Who made a video, from YouTube's oEmbed answer: its title, the channel's name and address.
#[derive(serde::Serialize, Clone, Debug)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_url: String,
}

static INFO: OnceLock<std::sync::Mutex<std::collections::HashMap<String, Option<VideoInfo>>>> = OnceLock::new();

pub async fn video_info(client: &reqwest::Client, id: &str) -> Option<VideoInfo> {
    let cache = INFO.get_or_init(Default::default);
    if let Some(hit) = cache.lock().ok().and_then(|c| c.get(id).cloned()) {
        return hit;
    }
    let watch = format!("https://www.youtube.com/watch?v={id}");
    let resp = client.get("https://www.youtube.com/oembed").query(&[("url", watch.as_str()), ("format", "json")]).timeout(Duration::from_secs(12)).send().await.ok()?;
    let found = if resp.status().is_success() {
        let v: Value = resp.json().await.ok()?;
        let channel_url = v["author_url"].as_str().unwrap_or_default().to_string();
        (!channel_url.is_empty()).then(|| VideoInfo {
            id: id.to_string(),
            title: v["title"].as_str().unwrap_or_default().trim().to_string(),
            channel: v["author_name"].as_str().unwrap_or_default().trim().to_string(),
            channel_url,
        })
    } else if resp.status().as_u16() == 404 || resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        None // gone, private, or not allowed to be shown elsewhere: remember that
    } else {
        return None; // a hiccup: ask again next time
    };
    if let Ok(mut c) = cache.lock() {
        c.insert(id.to_string(), found.clone());
    }
    found
}

/// Who made each of these videos (up to 60, six at a time); videos that can't be looked up are left out.
#[tauri::command]
pub async fn video_channels(ids: Vec<String>) -> Vec<VideoInfo> {
    use futures::stream::{self, StreamExt};
    let client = crate::feeds::client();
    let ids: Vec<String> = ids.into_iter().filter(|i| i.len() == 11).take(60).collect();
    stream::iter(ids)
        .map(|id| { let c = client.clone(); async move { video_info(&c, &id).await } })
        .buffered(6)
        .filter_map(|x| async move { x })
        .collect()
        .await
}

/// Read the channel's Videos page for a YouTube feed or channel address.
pub async fn from_page(client: &reqwest::Client, url: &str) -> Result<Fetched, String> {
    let page = videos_page(url).ok_or("Not a YouTube channel.")?;
    let get = |u: String| async move {
        client
            .get(u)
            // YouTube gives apps it doesn't recognize a bare page; ask for the page a browser gets
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")
            .header("Accept-Language", "en-US,en;q=0.9")
            // skips the cookie-consent page YouTube shows in Europe first
            .header("Cookie", "SOCS=CAI")
            .timeout(Duration::from_secs(25))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())
    };
    let html = get(page.clone()).await?;
    if let Some(f) = parse_page(&html, chrono::Utc::now()) {
        return Ok(f);
    }
    // an @name page that didn't list videos: try the channel's own address once
    if let Some(id) = channel_from_html(&html).filter(|_| !page.contains("/channel/")) {
        let html = get(format!("https://www.youtube.com/channel/{id}/videos")).await?;
        if let Some(f) = parse_page(&html, chrono::Utc::now()) {
            return Ok(f);
        }
    }
    Err("No videos on the channel's page.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    // trimmed from a real channel's Videos page (Nov 16, 2026): one members-only video, two public ones
    const PAGE: &str = r#"<script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"title":"Jessa Lynn ASMR","channelUrl":"https://www.youtube.com/channel/UCsDghDG43xzVzFYs8mnumHw","rssUrl":"https://www.youtube.com/feeds/videos.xml?channel_id=UCsDghDG43xzVzFYs8mnumHw"}},"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"title":"Home"}},{"tabRenderer":{"title":"Videos","content":{"richGridRenderer":{"contents":[{"richItemRenderer":{"content":{"lockupViewModel":{"contentId":"3FSBEl552KQ","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","contentImage":{"thumbnailViewModel":{"image":{"sources":[{"url":"https://i.ytimg.com/vi/3FSBEl552KQ/hq720.jpg?sqp=x","width":360,"height":202},{"url":"https://i.ytimg.com/vi/3FSBEl552KQ/hq720.jpg?sqp=y","width":720,"height":404}]}}},"metadata":{"lockupMetadataViewModel":{"title":{"content":"Penelope and Peace | The End of the Odyssey | ASMR Soft Spoken "},"metadata":{"contentMetadataViewModel":{"metadataRows":[{"metadataParts":[{"text":{"content":"4d ago"},"accessibilityLabel":"4 days ago"}]},{"badges":[{"badgeViewModel":{"badgeText":"Members only","badgeStyle":"BADGE_MEMBERS_ONLY"}}]}]}}}}}}}},{"richItemRenderer":{"content":{"lockupViewModel":{"contentId":"fB3eRnhh-48","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","contentImage":{"thumbnailViewModel":{"image":{"sources":[{"url":"https://i.ytimg.com/vi/fB3eRnhh-48/hq720.jpg","width":720,"height":404}]}}},"metadata":{"lockupMetadataViewModel":{"title":{"content":"Journey to Miantho (help me revise!) | ASMR Soft Spoken"},"metadata":{"contentMetadataViewModel":{"metadataRows":[{"metadataParts":[{"text":{"content":"18K"},"accessibilityLabel":"18 thousand views"},{"text":{"content":"6d ago"},"accessibilityLabel":"6 days ago"}]}]}}}}}}}},{"richItemRenderer":{"content":{"lockupViewModel":{"contentId":"JVaJqZRzQGQ","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","contentImage":{"thumbnailViewModel":{"image":{"sources":[]}}},"metadata":{"lockupMetadataViewModel":{"title":{"content":"Bookshelf Tour 🥰 | ASMR Soft Spoken "},"metadata":{"contentMetadataViewModel":{"metadataRows":[{"metadataParts":[{"text":{"content":"55K"},"accessibilityLabel":"55 thousand views"},{"text":{"content":"2w ago"},"accessibilityLabel":"2 weeks ago"}]}]}}}}}}}},{"continuationItemRenderer":{}}]}}}}]}}};</script>"#;

    #[test]
    fn reads_a_channel_page() {
        let now = chrono::Utc.with_ymd_and_hms(2026, 11, 16, 6, 30, 0).unwrap();
        let f = parse_page(PAGE, now).expect("videos");
        assert_eq!(f.title, "Jessa Lynn ASMR");
        assert_eq!(f.url, "https://www.youtube.com/feeds/videos.xml?channel_id=UCsDghDG43xzVzFYs8mnumHw");
        assert_eq!(f.items.len(), 3);
        let a = &f.items[0];
        assert_eq!(a.link, "https://www.youtube.com/watch?v=3FSBEl552KQ");
        assert_eq!(a.key, a.link);
        assert!(a.title.ends_with("(members only)") && a.paid);
        assert_eq!(a.date, "2026-11-12T06:00:00Z");
        assert_eq!(a.image, "https://i.ytimg.com/vi/3FSBEl552KQ/hq720.jpg");
        assert_eq!(f.items[1].title, "Journey to Miantho (help me revise!) | ASMR Soft Spoken");
        assert!(!f.items[1].paid);
        assert_eq!(f.items[1].date, "2026-11-10T06:00:00Z");
        assert_eq!(f.items[2].date, "2026-11-02T06:00:00Z");
        assert_eq!(f.items[2].image, "https://i.ytimg.com/vi/JVaJqZRzQGQ/hqdefault.jpg");
        assert!(parse_page("<html>no data</html>", now).is_none());
    }

    #[test]
    fn finds_a_video_id() {
        assert_eq!(video_id("https://www.youtube.com/watch?v=S9dOX-Xtfbc").as_deref(), Some("S9dOX-Xtfbc"));
        assert_eq!(video_id("https://youtu.be/S9dOX-Xtfbc?si=abc").as_deref(), Some("S9dOX-Xtfbc"));
        assert_eq!(video_id("youtube.com/shorts/S9dOX-Xtfbc").as_deref(), Some("S9dOX-Xtfbc"));
        assert_eq!(video_id("https://m.youtube.com/watch?feature=share&v=S9dOX-Xtfbc").as_deref(), Some("S9dOX-Xtfbc"));
        assert_eq!(video_id("https://www.youtube.com/@JessaLynnASMR"), None);
        assert_eq!(video_id("https://example.com/watch?v=S9dOX-Xtfbc"), None);
    }

    #[test]
    fn finds_the_videos_page() {
        assert_eq!(videos_page("https://www.youtube.com/feeds/videos.xml?channel_id=UCsDghDG43xzVzFYs8mnumHw").as_deref(), Some("https://www.youtube.com/channel/UCsDghDG43xzVzFYs8mnumHw/videos"));
        assert_eq!(videos_page("https://www.youtube.com/feeds/videos.xml?playlist_id=UUsDghDG43xzVzFYs8mnumHw").as_deref(), Some("https://www.youtube.com/channel/UCsDghDG43xzVzFYs8mnumHw/videos"));
        assert_eq!(videos_page("https://www.youtube.com/@JessaLynnASMR/videos").as_deref(), Some("https://www.youtube.com/@JessaLynnASMR/videos"));
        assert_eq!(videos_page("https://m.youtube.com/@JessaLynnASMR").as_deref(), Some("https://www.youtube.com/@JessaLynnASMR/videos"));
        assert_eq!(videos_page("https://www.youtube.com/c/Name/featured").as_deref(), Some("https://www.youtube.com/c/Name/videos"));
        assert_eq!(videos_page("https://www.youtube.com/watch?v=abc"), None);
        assert_eq!(videos_page("https://example.com/@x"), None);
    }
}
