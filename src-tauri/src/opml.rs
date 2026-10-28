//! OPML: the standard subscription-list format (Feedly, NetNewsWire, Inoreader all use it).

use crate::db::Feed;
use quick_xml::events::Event;
use quick_xml::Reader;

pub struct Outline {
    pub url: String,
    pub title: String,
}

pub fn parse(text: &str) -> Result<Vec<Outline>, String> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut out = Vec::new();
    let mut saw_opml = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = e.local_name();
                let name = String::from_utf8_lossy(name.as_ref()).to_ascii_lowercase();
                if name == "opml" {
                    saw_opml = true;
                }
                if name != "outline" {
                    continue;
                }
                let mut url = String::new();
                let mut title = String::new();
                let mut text_attr = String::new();
                for a in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(a.key.local_name().as_ref()).to_ascii_lowercase();
                    let val = a.unescape_value().map(|v| v.to_string()).unwrap_or_default();
                    match key.as_str() {
                        "xmlurl" => url = val.trim().to_string(),
                        "title" => title = val.trim().to_string(),
                        "text" => text_attr = val.trim().to_string(),
                        _ => {}
                    }
                }
                if url.starts_with("http://") || url.starts_with("https://") {
                    if title.is_empty() {
                        title = if text_attr.is_empty() {
                            url::Url::parse(&url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or(url.clone())
                        } else {
                            text_attr
                        };
                    }
                    out.push(Outline { url, title });
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err("That file isn't a valid OPML export.".into()),
            _ => {}
        }
    }
    if !saw_opml {
        return Err("That file isn't an OPML subscription list.".into());
    }
    Ok(out)
}

fn esc(s: &str) -> String {
    html_escape::encode_double_quoted_attribute(s).to_string()
}

pub fn export(feeds: &[Feed], now: &str) -> String {
    let mut s = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n");
    s += &format!("  <head><title>The Reading Room subscriptions</title><dateCreated>{now}</dateCreated></head>\n  <body>\n");
    for f in feeds {
        s += &format!(
            "    <outline type=\"rss\" text=\"{t}\" title=\"{t}\" xmlUrl=\"{u}\" htmlUrl=\"{h}\"/>\n",
            t = esc(&f.title),
            u = esc(&f.url),
            h = esc(&f.site)
        );
    }
    s += "  </body>\n</opml>\n";
    s
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_nested_outlines() {
        let o = super::parse(r#"<?xml version="1.0"?><opml version="2.0"><body><outline text="Design"><outline text="Smashing" xmlUrl="https://www.smashingmagazine.com/feed/"/><outline title="A &amp; B" xmlUrl="https://ab.com/rss"/></outline></body></opml>"#).unwrap();
        assert_eq!(o.len(), 2);
        assert_eq!(o[0].title, "Smashing");
        assert_eq!(o[1].title, "A & B");
    }
}
