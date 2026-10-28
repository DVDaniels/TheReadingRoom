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
    Ok(Article { html: clean(&a.content, url), byline: a.byline.unwrap_or_default().trim().to_string() })
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
    fn refuses_thin_pages() {
        assert!(super::extract("<html><body><p>Subscribe to read.</p></body></html>", "https://ex.com/a").is_err());
    }
}
