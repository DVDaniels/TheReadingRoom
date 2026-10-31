//! Following people wherever they post: turn a Mastodon handle, a Bluesky profile, a YouTube channel or an
//! Apple Podcasts link into the feed behind it. Every one of these services already publishes RSS;
//! people just don't know where to find it.

use regex::Regex;
use std::sync::OnceLock;

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

/// What the person typed, as feed addresses to try in order (the last one is always what they typed).
/// Apple Podcasts needs a lookup, so it's returned separately as the show's id.
pub struct Plan {
    pub tries: Vec<String>,
    pub podcast_id: Option<String>,
}

pub fn plan(input: &str) -> Plan {
    static MASTO: OnceLock<Regex> = OnceLock::new();
    static BSKY_HANDLE: OnceLock<Regex> = OnceLock::new();
    let t = input.trim().trim_end_matches('/');
    let mut tries = Vec::new();
    let mut podcast_id = None;

    // @name@instance.social → that account's feed
    if let Some(c) = re(&MASTO, r"^@?([A-Za-z0-9_.]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$").captures(t) {
        tries.push(format!("https://{}/@{}.rss", &c[2], &c[1]));
        return Plan { tries, podcast_id };
    }
    // @name.bsky.social (one @, a domain) → a Bluesky handle
    if let Some(c) = re(&BSKY_HANDLE, r"^@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$").captures(t) {
        tries.push(format!("https://bsky.app/profile/{}/rss", &c[1]));
        return Plan { tries, podcast_id };
    }

    let with_scheme = if t.starts_with("http://") || t.starts_with("https://") { t.to_string() } else { format!("https://{t}") };
    if let Ok(u) = url::Url::parse(&with_scheme) {
        let host = u.host_str().unwrap_or("").trim_start_matches("www.").trim_start_matches("m.").to_ascii_lowercase();
        let segs: Vec<&str> = u.path_segments().map(|s| s.filter(|x| !x.is_empty()).collect()).unwrap_or_default();
        match host.as_str() {
            "bsky.app" if segs.first() == Some(&"profile") && segs.len() >= 2 => {
                tries.push(format!("https://bsky.app/profile/{}/rss", segs[1]));
            }
            "youtube.com" => {
                if segs.first() == Some(&"channel") && segs.len() >= 2 {
                    tries.push(format!("https://www.youtube.com/feeds/videos.xml?channel_id={}", segs[1]));
                } else if let Some(list) = u.query_pairs().find(|(k, _)| k == "list").map(|(_, v)| v.to_string()) {
                    tries.push(format!("https://www.youtube.com/feeds/videos.xml?playlist_id={list}"));
                }
                // @handle, /c/ and /user/ pages name their feed; the page itself is tried last
            }
            "medium.com" if segs.first().is_some_and(|s| s.starts_with('@')) => {
                tries.push(format!("https://medium.com/feed/{}", segs[0]));
            }
            "podcasts.apple.com" | "itunes.apple.com" => {
                static ID: OnceLock<Regex> = OnceLock::new();
                podcast_id = re(&ID, r"/id(\d+)").captures(u.path()).map(|c| c[1].to_string());
            }
            _ => {
                // instance.social/@name (Mastodon and friends) → instance.social/@name.rss
                if segs.len() == 1 && segs[0].starts_with('@') && segs[0].len() > 1 && !segs[0].contains('.') {
                    tries.push(format!("https://{}/{}.rss", u.host_str().unwrap_or(""), segs[0]));
                }
            }
        }
    }
    tries.push(with_scheme);
    Plan { tries, podcast_id }
}

/// Apple Podcasts show id → the podcast's own feed (Apple's public lookup, no account).
pub async fn podcast_feed(client: &reqwest::Client, id: &str) -> Result<String, String> {
    let url = format!("https://itunes.apple.com/lookup?id={id}&entity=podcast");
    let text = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Couldn't reach Apple Podcasts to find that show's feed.".to_string())?
        .text()
        .await
        .map_err(|_| "Apple Podcasts didn't answer in full. Try again.".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| "Apple Podcasts sent something unexpected.".to_string())?;
    v.get("results")
        .and_then(|r| r.as_array())
        .and_then(|a| a.iter().find_map(|x| x.get("feedUrl").and_then(|f| f.as_str()).map(String::from)))
        .ok_or_else(|| "That podcast doesn't list a public feed, so it can't be followed here.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_for_each_kind_of_address() {
        assert_eq!(plan("@kev@fosstodon.org").tries, vec!["https://fosstodon.org/@kev.rss"]);
        assert_eq!(plan("https://mastodon.social/@Gargron").tries[0], "https://mastodon.social/@Gargron.rss");
        assert_eq!(plan("@jay.bsky.team").tries, vec!["https://bsky.app/profile/jay.bsky.team/rss"]);
        assert_eq!(plan("https://bsky.app/profile/kevquirk.com").tries[0], "https://bsky.app/profile/kevquirk.com/rss");
        assert_eq!(plan("youtube.com/channel/UC123").tries[0], "https://www.youtube.com/feeds/videos.xml?channel_id=UC123");
        assert_eq!(plan("https://www.youtube.com/@veritasium").tries, vec!["https://www.youtube.com/@veritasium"]);
        assert_eq!(plan("https://podcasts.apple.com/us/podcast/the-talk-show/id528458508").podcast_id.as_deref(), Some("528458508"));
        assert_eq!(plan("https://medium.com/@someone").tries[0], "https://medium.com/feed/@someone");
        assert_eq!(plan("daviddaniels.com").tries, vec!["https://daviddaniels.com"]);
    }
}
