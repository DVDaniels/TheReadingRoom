//! OPML: the standard subscription-list format (Feedly, NetNewsWire, Inoreader all use it).
//! Folders are outlines that hold other outlines; feeds are outlines with an xmlUrl.

use crate::db::{Feed, Folder};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

pub struct Outline {
    pub url: String,
    pub title: String,
    pub folder: Option<String>,
}

struct Attrs {
    url: String,
    title: String,
    text: String,
}

fn attrs(e: &BytesStart) -> Attrs {
    let mut a = Attrs { url: String::new(), title: String::new(), text: String::new() };
    for at in e.attributes().flatten() {
        let key = String::from_utf8_lossy(at.key.local_name().as_ref()).to_ascii_lowercase();
        let val = at.unescape_value().map(|v| v.trim().to_string()).unwrap_or_default();
        match key.as_str() {
            "xmlurl" => a.url = val,
            "title" => a.title = val,
            "text" => a.text = val,
            _ => {}
        }
    }
    a
}

fn is_outline(e: &BytesStart) -> bool {
    String::from_utf8_lossy(e.local_name().as_ref()).eq_ignore_ascii_case("outline")
}

pub fn parse(text: &str) -> Result<Vec<Outline>, String> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut out = Vec::new();
    let mut saw_opml = false;
    // One entry per open <outline>: Some(name) when it's a folder.
    let mut stack: Vec<Option<String>> = Vec::new();

    let mut push_feed = |a: Attrs, folder: Option<String>| {
        if a.url.starts_with("http://") || a.url.starts_with("https://") {
            let title = [a.title, a.text]
                .into_iter()
                .find(|t| !t.is_empty())
                .unwrap_or_else(|| url::Url::parse(&a.url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or(a.url.clone()));
            out.push(Outline { url: a.url, title, folder });
        }
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                if String::from_utf8_lossy(e.local_name().as_ref()).eq_ignore_ascii_case("opml") {
                    saw_opml = true;
                }
                if !is_outline(&e) {
                    continue;
                }
                let a = attrs(&e);
                if a.url.is_empty() {
                    let name = if a.title.is_empty() { a.text } else { a.title };
                    stack.push(Some(name).filter(|n| !n.is_empty()));
                } else {
                    let folder = stack.iter().rev().flatten().next().cloned();
                    push_feed(a, folder);
                    stack.push(None);
                }
            }
            Ok(Event::Empty(e)) => {
                if is_outline(&e) {
                    let folder = stack.iter().rev().flatten().next().cloned();
                    push_feed(attrs(&e), folder);
                }
            }
            Ok(Event::End(e)) => {
                if String::from_utf8_lossy(e.local_name().as_ref()).eq_ignore_ascii_case("outline") {
                    stack.pop();
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

fn feed_line(f: &Feed, indent: &str) -> String {
    format!(
        "{indent}<outline type=\"rss\" text=\"{t}\" title=\"{t}\" xmlUrl=\"{u}\" htmlUrl=\"{h}\"/>\n",
        t = esc(&f.title),
        u = esc(&f.url),
        h = esc(&f.site)
    )
}

pub fn export(folders: &[Folder], feeds: &[Feed], now: &str) -> String {
    let mut s = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n");
    s += &format!("  <head><title>The Reading Room subscriptions</title><dateCreated>{now}</dateCreated></head>\n  <body>\n");
    for folder in folders {
        let inside: Vec<_> = feeds.iter().filter(|f| f.folder_id == Some(folder.id)).collect();
        s += &format!("    <outline text=\"{n}\" title=\"{n}\">\n", n = esc(&folder.name));
        for f in inside {
            s += &feed_line(f, "      ");
        }
        s += "    </outline>\n";
    }
    for f in feeds.iter().filter(|f| f.folder_id.map_or(true, |id| !folders.iter().any(|x| x.id == id))) {
        s += &feed_line(f, "    ");
    }
    s += "  </body>\n</opml>\n";
    s
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_folders_like_feedly() {
        let o = super::parse(r#"<?xml version="1.0"?><opml version="1.0"><head><title>David Daniels subscriptions in feedly Cloud</title></head><body>
          <outline text="Web Design" title="Web Design">
            <outline type="rss" text="Smashing" title="Smashing" xmlUrl="https://www.smashingmagazine.com/feed/" htmlUrl="https://www.smashingmagazine.com"/>
          </outline>
          <outline text="Tech &amp; News"><outline title="A &amp; B" xmlUrl="https://ab.com/rss"/></outline>
          <outline text="Loose" xmlUrl="https://loose.com/feed"/>
        </body></opml>"#).unwrap();
        assert_eq!(o.len(), 3);
        assert_eq!((o[0].title.as_str(), o[0].folder.as_deref()), ("Smashing", Some("Web Design")));
        assert_eq!((o[1].title.as_str(), o[1].folder.as_deref()), ("A & B", Some("Tech & News")));
        assert_eq!(o[2].folder, None);
    }

    #[test]
    fn round_trips_folders() {
        use crate::db::{Feed, Folder};
        let folders = vec![Folder { id: 1, name: "Crypto".into() }];
        let f = |id, folder_id| Feed { id, url: format!("https://f{id}.com/rss"), title: format!("F{id}"), site: String::new(), status: "ok".into(), error: String::new(), last_fetched: None, folder_id, recent: 0 };
        let xml = super::export(&folders, &[f(1, Some(1)), f(2, None)], "now");
        let back = super::parse(&xml).unwrap();
        assert_eq!(back[0].folder.as_deref(), Some("Crypto"));
        assert_eq!(back[1].folder, None);
    }
}
