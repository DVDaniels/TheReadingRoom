//! Write back: find how a writer likes to hear from readers, from their post's page and their feed.
//! Reply-by-email links (often only in the feed), a comments section, their Mastodon or Bluesky account,
//! and a contact page. Nothing is sent: the app only opens the way you choose.

use crate::feeds;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Email {
    pub address: String,
    pub subject: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Link {
    pub label: String,
    pub url: String,
}

#[derive(Serialize, Default, Debug)]
pub struct Options {
    pub email: Option<Email>,
    pub comments: Option<String>,
    pub social: Vec<Link>,
    pub contact: Option<String>,
    pub webmention: bool,
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

fn attrs(tag: &str) -> HashMap<String, String> {
    static ATTR: OnceLock<Regex> = OnceLock::new();
    re(&ATTR, r#"(?is)([a-z:-]+)\s*=\s*["']([^"']*)["']"#)
        .captures_iter(tag)
        .map(|c| (c[1].to_ascii_lowercase(), html_escape::decode_html_entities(&c[2]).to_string()))
        .collect()
}

fn decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={}", s.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.to_string())
        .unwrap_or_default()
}

/// A mailto link with a real address (share buttons use mailto:?subject= with no address).
fn mailto(href: &str) -> Option<Email> {
    let rest = href.strip_prefix("mailto:").or_else(|| href.strip_prefix("MAILTO:"))?;
    let (addr, query) = rest.split_once('?').unwrap_or((rest, ""));
    let address = decode(addr);
    if !address.contains('@') || address.contains(' ') {
        return None;
    }
    let subject = query
        .split('&')
        .find_map(|kv| kv.split_once('=').filter(|(k, _)| k.eq_ignore_ascii_case("subject")).map(|(_, v)| decode(v)))
        .unwrap_or_default();
    Some(Email { address, subject })
}

/// Everything a post's page or feed entry says about replying.
pub fn scan(html: &str, page: &url::Url, out: &mut Options) {
    static A: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static IDS: OnceLock<Regex> = OnceLock::new();
    let host = page.host_str().unwrap_or("").trim_start_matches("www.").to_string();

    // <link> and <meta> in the head
    for t in re(&TAG, r"(?is)<(link|meta)\b[^>]*>").find_iter(html) {
        let a = attrs(t.as_str());
        let rel = a.get("rel").map(|r| r.to_ascii_lowercase()).unwrap_or_default();
        if rel.split_whitespace().any(|r| r == "webmention") {
            out.webmention = true;
        }
        if a.get("name").map(|n| n.eq_ignore_ascii_case("fediverse:creator")).unwrap_or(false) {
            if let Some(c) = a.get("content") {
                let h = c.trim().trim_start_matches('@');
                if let Some((user, server)) = h.split_once('@') {
                    push_social(out, "Mastodon", &format!("https://{server}/@{user}"));
                }
            }
        }
        if rel.split_whitespace().any(|r| r == "me") {
            if let Some(h) = a.get("href") {
                me_link(out, h);
            }
        }
    }

    // Links in the page or post
    let mut best_mail: Option<(i32, Email)> = None;
    for c in re(&A, r"(?is)<a\b([^>]*)>(.*?)</a>").captures_iter(html) {
        let a = attrs(&c[1]);
        let Some(href) = a.get("href") else { continue };
        let text = feeds::plain(&c[2], 80).to_lowercase();
        let rel = a.get("rel").map(|r| r.to_ascii_lowercase()).unwrap_or_default();
        if let Some(m) = mailto(href) {
            // Prefer links that say they're for replies
            let mut score = 1;
            if !m.subject.is_empty() { score += 2; }
            if ["reply", "respond", "email", "write", "thoughts", "comment", "feedback"].iter().any(|w| text.contains(w)) { score += 3; }
            if best_mail.as_ref().map_or(true, |(s, _)| score > *s) {
                best_mail = Some((score, m));
            }
            continue;
        }
        if rel.split_whitespace().any(|r| r == "me") {
            me_link(out, href);
        }
        let Ok(u) = page.join(href) else { continue };
        let same_site = u.host_str().map(|h| h.trim_start_matches("www.") == host).unwrap_or(false);
        let frag = u.fragment().unwrap_or("").to_ascii_lowercase();
        let commentish = frag.contains("comment") || frag == "respond" || frag == "replies"
            || text == "comments" || text.ends_with(" comments") || text.contains("leave a comment") || text.contains("leave a reply")
            || text == "reply" || text.contains("join the discussion") || text.contains("add a comment");
        if commentish && out.comments.is_none() && (same_site || text.contains("comment")) {
            out.comments = Some(u.to_string());
        } else if same_site && out.contact.is_none()
            && (text == "contact" || text.starts_with("contact ") || text == "say hello" || text == "say hi" || text == "get in touch" || text == "email me")
        {
            out.contact = Some(u.to_string());
        }
    }
    if out.email.is_none() {
        out.email = best_mail.map(|(_, m)| m);
    }
    // A comments section on the page itself
    if out.comments.is_none() {
        if let Some(c) = re(&IDS, r#"(?i)\bid\s*=\s*["'](comments|respond|replies|webmentions)["']"#).captures(html) {
            let mut u = page.clone();
            u.set_fragment(Some(&c[1]));
            out.comments = Some(u.to_string());
        }
    }
}

fn me_link(out: &mut Options, href: &str) {
    if let Some(m) = mailto(href) {
        if out.email.is_none() {
            out.email = Some(m);
        }
        return;
    }
    let Ok(u) = url::Url::parse(href) else { return };
    let host = u.host_str().unwrap_or("");
    let path = u.path();
    if host == "bsky.app" && path.starts_with("/profile/") {
        push_social(out, "Bluesky", href);
    } else if path.starts_with("/@") && path.len() > 2 && !path[2..].contains('/') {
        push_social(out, "Mastodon", href);
    }
}

fn push_social(out: &mut Options, label: &str, url: &str) {
    if !out.social.iter().any(|l| l.label == label) {
        out.social.push(Link { label: label.into(), url: url.into() });
    }
}

/// Look at the post's page and, for reply-by-email links that only appear in feeds, the feed entry too.
pub async fn find(client: &reqwest::Client, link: &str, feed_url: &str) -> Options {
    let mut out = Options::default();
    let Ok(page) = url::Url::parse(link) else { return out };
    let timeout = std::time::Duration::from_secs(15);

    if let Ok(Ok((body, final_url, _))) = tokio::time::timeout(timeout, feeds::get(client, link)).await {
        let html = String::from_utf8_lossy(&body);
        let base = url::Url::parse(&final_url).unwrap_or(page.clone());
        scan(&html, &base, &mut out);
    }
    if out.email.is_none() && feed_url.starts_with("http") {
        if let Ok(Ok((body, final_url, _))) = tokio::time::timeout(timeout, feeds::get(client, feed_url)).await {
            if let Ok(feed) = feed_rs::parser::Builder::new().base_uri(Some(&final_url)).build().parse(body.as_slice()) {
                let entry = feed.entries.iter().find(|e| e.links.iter().any(|l| l.href.trim_end_matches('/') == link.trim_end_matches('/')));
                if let Some(e) = entry {
                    let html = format!(
                        "{} {}",
                        e.content.as_ref().and_then(|c| c.body.clone()).unwrap_or_default(),
                        e.summary.as_ref().map(|s| s.content.clone()).unwrap_or_default()
                    );
                    let mut from_feed = Options::default();
                    scan(&html, &page, &mut from_feed);
                    out.email = from_feed.email;
                    // An author email in the feed itself
                    if out.email.is_none() {
                        out.email = e.authors.iter().chain(feed.authors.iter())
                            .filter_map(|p| p.email.clone())
                            .find(|m| m.contains('@') && !m.contains("noreply") && !m.contains("no-reply") && !m.contains("example."))
                            .map(|address| Email { address, subject: String::new() });
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_reply_by_email_comments_and_accounts() {
        let page = url::Url::parse("https://kev.example/blog/post/").unwrap();
        let html = r##"<head><link rel="webmention" href="https://webmention.io/x">
            <meta name="fediverse:creator" content="@kev@fosstodon.org">
            <link rel="me" href="https://bsky.app/profile/kev.example"></head>
            <a href="mailto:?subject=Look">Share by email</a>
            <a href="mailto:hi@kev.example?subject=Re%3A%20My%20post">Reply via email</a>
            <a href="#comments">3 comments</a> <a href="/contact/">Contact</a>"##;
        let mut o = Options::default();
        scan(html, &page, &mut o);
        assert_eq!(o.email, Some(Email { address: "hi@kev.example".into(), subject: "Re: My post".into() }));
        assert_eq!(o.comments.as_deref(), Some("https://kev.example/blog/post/#comments"));
        assert_eq!(o.contact.as_deref(), Some("https://kev.example/contact/"));
        assert!(o.webmention);
        assert_eq!(o.social.iter().map(|l| l.label.as_str()).collect::<Vec<_>>(), vec!["Mastodon", "Bluesky"]);
        assert_eq!(o.social[0].url, "https://fosstodon.org/@kev");
    }

    #[test]
    fn share_buttons_are_not_reply_addresses() {
        let page = url::Url::parse("https://a.example/p").unwrap();
        let mut o = Options::default();
        scan(r#"<a href="mailto:?subject=x&body=y">Email</a><div id="respond"></div>"#, &page, &mut o);
        assert!(o.email.is_none());
        assert_eq!(o.comments.as_deref(), Some("https://a.example/p#respond"));
    }
}
