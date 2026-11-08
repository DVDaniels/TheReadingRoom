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
    let body = unlazy(&a.content);
    let body = match lead_image(html, url, &body) {
        Some(src) => format!(r#"<figure><img src="{}" alt=""></figure>{body}"#, html_escape::encode_double_quoted_attribute(&src)),
        None => body,
    };
    Ok(Article { html: clean(&body, url), byline: a.byline.unwrap_or_default().trim().to_string() })
}

/// The post's featured image, when pulling out the article left it behind. WordPress and most blogs put it
/// above the article body, in the post header, so the reader drops it along with the menus. The page still
/// names it as its sharing picture (og:image), so bring that back at the top, unless the article already
/// shows the same picture (often in another size: photo-1024x683.jpg is photo.jpg).
fn lead_image(page: &str, url: &str, body: &str) -> Option<String> {
    let base = url::Url::parse(url).ok()?;
    let src = crate::feeds::pick_page_image(page, &base)?;
    let low = src.to_ascii_lowercase();
    // Stand-ins, not a post's own picture: Jetpack's blank, site icons, logos, avatars.
    if ["blank.jpg", "/i/blank", "cropped-", "logo", "gravatar", "avatar", "site-icon", "favicon"].iter().any(|x| low.contains(x)) {
        return None;
    }
    let stem = picture_stem(&src);
    if stem.len() >= 3 && body.to_ascii_lowercase().contains(&stem) {
        return None;
    }
    Some(src)
}

/// "https://x.com/wp-content/uploads/2026/11/My-Photo-1024x683.jpg?w=1200" → "my-photo"
fn picture_stem(src: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;
    static SIZE: OnceLock<Regex> = OnceLock::new();
    let file = src.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("").to_ascii_lowercase();
    let name = file.rsplit_once('.').map_or(file.as_str(), |(n, _)| n).to_string();
    let size = SIZE.get_or_init(|| Regex::new(r"(-\d+x\d+|-scaled|-e\d{10,})+$").unwrap());
    size.replace(&name, "").to_string()
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

/// Embedded YouTube players can't be kept as they are (no frames from other sites in the reader), so each
/// becomes a marked link the reader turns back into a player: `https://www.youtube.com/watch?v=ID#rr-video`.
pub fn mark_videos(html: &str) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r#"(?is)<iframe\b[^>]*?\bsrc\s*=\s*["']?(?:https?:)?//(?:www\.)?youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]{11})[^>]*>.*?</iframe>"#).unwrap()
    });
    re.replace_all(html, |c: &regex::Captures| {
        format!(r#"<p><a href="https://www.youtube.com/watch?v={}#rr-video">Watch the video</a></p>"#, &c[1])
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
    b.clean(&mark_videos(html)).to_string()
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
    fn brings_back_the_featured_image() {
        let body = "<p>".to_string() + &"This is a sentence in the article body. ".repeat(20) + "</p>";
        let page = |inline: &str| format!(r#"<html><head><title>Post</title>
            <meta property="og:image" content="https://daviddaniels.com/wp-content/uploads/2026/11/reading-room.jpg"></head>
            <body><nav>menu</nav><header><img class="wp-post-image" src="/wp-content/uploads/2026/11/reading-room-1024x683.jpg"></header>
            <article><h1>Post</h1>{body}{inline}</article></body></html>"#);
        let a = super::extract(&page(""), "https://daviddaniels.com/technology/post/").unwrap();
        assert!(a.html.starts_with(r#"<figure><img src="https://daviddaniels.com/wp-content/uploads/2026/11/reading-room.jpg""#), "{}", a.html);
        // Already in the article (another size): don't show it twice.
        let a = super::extract(&page(r#"<p><img src="/wp-content/uploads/2026/11/reading-room-768x512.jpg"></p>"#), "https://daviddaniels.com/technology/post/").unwrap();
        assert_eq!(a.html.matches("<img").count(), 1, "{}", a.html);
        assert_eq!(super::picture_stem("https://x.com/u/My-Photo-1024x683.jpg?w=1200"), "my-photo");
        assert_eq!(super::picture_stem("https://x.com/u/big-scaled.jpeg"), "big");
    }

    #[test]
    fn video_players_become_marked_links() {
        let html = r#"<p>Look.</p><figure><div><iframe title="A talk" width="500" src="https://www.youtube.com/embed/WEIXCyrDIaY?feature=oembed&amp;x=1" allowfullscreen></iframe></div></figure><iframe src="https://evil.example/x"></iframe>"#;
        let out = super::clean(html, "https://daviddaniels.com/notes/a/");
        assert!(out.contains(r#"href="https://www.youtube.com/watch?v=WEIXCyrDIaY#rr-video""#), "{out}");
        assert!(!out.contains("<iframe") && !out.contains("evil"), "{out}");
    }

    #[test]
    fn videos_survive_pulling_out_the_article() {
        let body = "<p>".to_string() + &"I am fascinated with this story about the jet that crashed last week. ".repeat(8) + "</p>";
        let html = format!(r#"<html><head><title>Note</title></head><body><nav>menu</nav><main><article><h1>Can you fly private?</h1>{body}
            <figure class="wp-block-embed is-type-video"><div class="wp-block-embed__wrapper"><iframe title="Talk" src="https://www.youtube.com/embed/WEIXCyrDIaY?feature=oembed" allowfullscreen></iframe></div></figure>
            </article></main><footer>foot</footer></body></html>"#);
        let a = super::extract(&html, "https://daviddaniels.com/notes/can-you-fly-private/").unwrap();
        assert!(a.html.contains("watch?v=WEIXCyrDIaY#rr-video"), "{}", a.html);
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
