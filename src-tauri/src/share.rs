//! "Save to The Reading Room" from the Share menu, and the widgets (iPhone, iPad and Mac).
//!
//! The share extension and the widget are small separate programs that can't open the app's
//! database. They meet the app in a shared keychain item instead (keychain sharing needs no
//! extra setup with Apple): the share extension adds pages to an "inbox" the app empties when
//! it comes to the front, and the app leaves a short summary (latest headlines, your streak)
//! for the widget to show.

use crate::feeds::{self, Fetched, ParsedItem};
use serde::{Deserialize, Serialize};

/// The feed that holds pages saved from elsewhere: it has nothing to download.
pub const SAVED_FEED: &str = "saved:pages";
pub const SAVED_TITLE: &str = "Saved pages";

pub fn is_saved_feed(url: &str) -> bool {
    url.starts_with("saved:")
}

pub fn empty_fetch(url: &str) -> Fetched {
    Fetched { url: url.to_string(), title: SAVED_TITLE.to_string(), site: String::new(), items: vec![] }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Shared {
    pub url: String,
    #[serde(default)]
    pub title: String,
}

fn meta(html: &str, names: &[&str]) -> String {
    for n in names {
        for pat in [
            format!(r#"(?is)<meta[^>]+(?:property|name)\s*=\s*["']{n}["'][^>]*content\s*=\s*["']([^"']+)["']"#),
            format!(r#"(?is)<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["']{n}["']"#),
        ] {
            if let Some(c) = regex::Regex::new(&pat).ok().and_then(|r| r.captures(html)) {
                let v = html_escape::decode_html_entities(c[1].trim()).to_string();
                if !v.is_empty() {
                    return v;
                }
            }
        }
    }
    String::new()
}

/// A page you shared: its title, a line about it and its picture, as one story.
pub async fn page_item(client: &reqwest::Client, url: &str, title: &str) -> ParsedItem {
    let mut t = title.trim().to_string();
    let (mut summary, mut image) = (String::new(), String::new());
    if let Ok((body, final_url, _)) = feeds::get(client, url).await {
        let html = String::from_utf8_lossy(&body[..body.len().min(400_000)]).to_string();
        if t.is_empty() || t == url {
            t = meta(&html, &["og:title", "twitter:title"]);
            if t.is_empty() {
                if let Some(c) = regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap().captures(&html) {
                    t = html_escape::decode_html_entities(c[1].trim()).to_string();
                }
            }
        }
        summary = meta(&html, &["og:description", "description", "twitter:description"]);
        image = meta(&html, &["og:image", "twitter:image"]);
        if !image.is_empty() {
            image = url::Url::parse(&final_url).ok().and_then(|b| b.join(&image).ok()).map(|u| u.to_string()).unwrap_or_default();
        }
    }
    if t.is_empty() {
        t = url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or(url.to_string());
    }
    ParsedItem {
        key: url.to_string(),
        title: t,
        link: url.to_string(),
        date: feeds::now_iso(),
        summary,
        image,
        audio: String::new(),
        shares: String::new(),
        paid: false,
        links: String::new(),
        comments: -1,
    }
}

// ---------------------------------------------------------------- the shared keychain (iPhone and iPad)

#[cfg(any(target_os = "ios", target_os = "macos"))]
mod keychain {
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{delete_generic_password_options, generic_password, set_generic_password_options, PasswordOptions};

    const SERVICE: &str = "com.daviddaniels.readingroom.shared";

    /// "TEAMID.com.daviddaniels.readingroom.shared" (the build writes the team into Info.plist)
    fn group() -> Option<String> {
        use objc2_foundation::{NSBundle, NSString};
        let v = NSBundle::mainBundle().objectForInfoDictionaryKey(&NSString::from_str("ReadingRoomKeychainGroup"))?;
        let s = v.downcast::<NSString>().ok()?.to_string();
        (!s.is_empty() && !s.starts_with('$') && !s.starts_with("TEAM_ID")).then_some(s)
    }

    fn options(account: &str) -> Option<PasswordOptions> {
        let mut o = PasswordOptions::new_generic_password(SERVICE, account);
        o.set_access_group(&group()?);
        #[cfg(target_os = "macos")]
        o.use_protected_keychain(); // the Mac's iPhone-style keychain, where access groups work
        Some(o)
    }

    pub fn take(account: &str) -> Option<Vec<u8>> {
        let data = generic_password(options(account)?).ok()?;
        let _ = delete_generic_password_options(options(account)?);
        Some(data)
    }

    pub fn put(account: &str, data: &[u8]) {
        let Some(o) = options(account) else { return };
        let _ = delete_generic_password_options(o);
        let Some(mut o) = options(account) else { return };
        // readable by the widget while the phone is locked (after the first unlock since it started)
        if let Ok(ac) = SecAccessControl::create_with_protection(Some(ProtectionMode::AccessibleAfterFirstUnlock), 0) {
            o.set_access_control(ac);
        }
        let _ = set_generic_password_options(data, o);
    }
}

/// Pages waiting from the Share menu (and clears them).
pub fn take_inbox() -> Vec<Shared> {
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    {
        keychain::take("inbox").and_then(|d| serde_json::from_slice(&d).ok()).unwrap_or_default()
    }
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    {
        vec![]
    }
}

/// The summary the Home Screen widgets show.
pub fn put_widget(json: &str) {
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    keychain::put("widget", json.as_bytes());
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    let _ = json;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_meta() {
        let html = r#"<head><meta property="og:title" content="A &amp; B"><meta content="About it" name="description"><title>X</title></head>"#;
        assert_eq!(meta(html, &["og:title"]), "A & B");
        assert_eq!(meta(html, &["og:description", "description"]), "About it");
        assert_eq!(meta(html, &["og:image"]), "");
    }
}
