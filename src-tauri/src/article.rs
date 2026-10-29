//! The reader: download a story's web page, keep just the article, and make it safe to show.

use dom_smoothie::Readability;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize, Clone)]
pub struct Article {
    pub html: String,
    pub byline: String,
}

const MIN_TEXT: usize = 280; // shorter than this usually means a paywall, a cookie wall, or a page built by scripts

pub async fn fetch(client: &reqwest::Client, url: &str) -> Result<Article, String> {
    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
        .send()
        .await
        .map_err(|_| "Couldn't reach the site for this story.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("The site answered with error {}.", resp.status().as_u16()));
    }
    let final_url = resp.url().to_string();
    let html = resp.text().await.map_err(|_| "The page was cut off. Try again.".to_string())?;
    extract(&html, &final_url)
}

pub fn extract(html: &str, url: &str) -> Result<Article, String> {
    let mut r = Readability::new(html, Some(url), None).map_err(|_| "This story's address isn't a normal web page.".to_string())?;
    let a = r.parse().map_err(|_| "This page doesn't have an article the reader can pull out.".to_string())?;
    if a.text_content.trim().chars().count() < MIN_TEXT {
        return Err("This page didn't share its full article (it may be behind a paywall or built by scripts).".into());
    }
    Ok(Article { html: clean(&unlazy(&a.content), url), byline: a.byline.unwrap_or_default().trim().to_string() })
}

/// Many sites (the New York Post, for one) load photos as you scroll: the page carries a blank stand-in as
/// `src` and the real address in `data-src` / `data-srcset` for their scripts to swap in. Do that swap here.
pub fn unlazy(html: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;
    static TAG: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let tag = TAG.get_or_init(|| Regex::new(r"(?is)<(img|source)\b([^>]*?)(/?)>").unwrap());
    let attr = ATTR.get_or_init(|| Regex::new(r#"(?is)([a-z][a-z0-9:_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?"#).unwrap());
    tag.replace_all(html, |c: &regex::Captures| {
        let name = &c[1];
        let mut attrs: Vec<(String, String)> = attr
            .captures_iter(&c[2])
            .map(|a| (a[1].to_ascii_lowercase(), a.get(2).or(a.get(3)).or(a.get(4)).map_or("", |m| m.as_str()).to_string()))
            .collect();
        let get = |attrs: &Vec<(String, String)>, k: &str| attrs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).filter(|v| !v.trim().is_empty());
        let placeholder = |v: &Option<String>| v.as_deref().map_or(true, |v| v.starts_with("data:") || v.contains("placeholder") || v.contains("blank.gif") || v.contains("spacer"));
        let lazy_src = ["data-src", "data-lazy-src", "data-original", "data-url", "data-hi-res-src"].iter().find_map(|k| get(&attrs, k));
        let lazy_set = ["data-srcset", "data-lazy-srcset"].iter().find_map(|k| get(&attrs, k));
        let set = |attrs: &mut Vec<(String, String)>, k: &str, v: String| {
            attrs.retain(|(n, _)| n != k);
            attrs.push((k.to_string(), v));
        };
        if let Some(v) = lazy_src {
            if placeholder(&get(&attrs, "src")) {
                set(&mut attrs, "src", v);
            }
        }
        if let Some(v) = lazy_set {
            if placeholder(&get(&attrs, "srcset")) {
                set(&mut attrs, "srcset", v);
            }
        }
        // No usable picture left: a srcset can stand in for the src.
        if name.eq_ignore_ascii_case("img") && placeholder(&get(&attrs, "src")) {
            if let Some(first) = get(&attrs, "srcset").and_then(|s| s.split(',').next().map(|p| p.trim().split_whitespace().next().unwrap_or("").to_string())) {
                if !first.is_empty() && !first.starts_with("data:") {
                    set(&mut attrs, "src", first);
                }
            }
        }
        let body: String = attrs
            .iter()
            .map(|(k, v)| format!(" {k}=\"{}\"", v.replace('"', "&quot;")))
            .collect();
        format!("<{name}{body}{}>", &c[3])
    })
    .into_owned()
}

/// Keep ordinary article markup only: no scripts, styles, forms, embeds or event handlers.
/// Links and pictures are made absolute so they work inside the app.
pub fn clean(html: &str, base: &str) -> String {
    let base = url::Url::parse(base).ok();
    let mut b = ammonia::Builder::default();
    b.add_tags(["figure", "figcaption", "picture", "source", "time", "aside"])
        .add_tag_attributes("img", ["srcset", "sizes", "loading"])
        .add_tag_attributes("source", ["srcset", "type", "media"])
        .add_tag_attributes("time", ["datetime"])
        .rm_tags(["mark"]) // reserved for your highlights
        .link_rel(Some("noopener noreferrer"))
        .url_schemes(HashSet::from(["http", "https", "mailto"]));
    if let Some(u) = base {
        b.url_relative(ammonia::UrlRelative::RewriteWithBase(u));
    } else {
        b.url_relative(ammonia::UrlRelative::Deny);
    }
    b.clean(html).to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn extracts_and_cleans() {
        let body = "<p>".to_string() + &"This is a sentence in the article body. ".repeat(20) + "</p>";
        let html = format!(r#"<html><head><title>Post</title></head><body><nav>menu</nav><article><h1>Post</h1>{body}
            <p><img src="/pic.jpg" onerror="alert(1)"><a href="/next" onclick="x()">next</a></p><script>alert(2)</script></article></body></html>"#);
        let a = super::extract(&html, "https://ex.com/2026/post").unwrap();
        assert!(a.html.contains("https://ex.com/pic.jpg"));
        assert!(a.html.contains("https://ex.com/next"));
        assert!(!a.html.contains("onerror") && !a.html.contains("onclick") && !a.html.contains("<script"));
    }

    #[test]
    fn swaps_in_lazy_pictures() {
        let html = r#"<p><img src="data:image/gif;base64,R0lGOD" data-src="https://cdn.nypost.com/a.jpg" alt="x">
            <img class="lazy" data-srcset="https://cdn.x/b-400.jpg 400w, https://cdn.x/b-800.jpg 800w"></p>"#;
        let out = super::clean(&super::unlazy(html), "https://nypost.com/2026/10/29/story/");
        assert!(out.contains(r#"src="https://cdn.nypost.com/a.jpg""#), "{out}");
        assert!(out.contains(r#"src="https://cdn.x/b-400.jpg""#), "{out}");
        assert!(!out.contains("data:image"));
    }

    #[test]
    fn refuses_thin_pages() {
        assert!(super::extract("<html><body><p>Subscribe to read.</p></body></html>", "https://ex.com/a").is_err());
    }
}
