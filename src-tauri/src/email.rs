//! Email in the app: one mailbox of your own (best: an address on your own domain used only for
//! the app, like reading@yoursite.com). The app reads its inbox over IMAP, shows each email as a
//! story in the Email tab, and sends replies over SMTP, the same way Apple's Mail does. Nothing
//! goes through a server of ours. The sign-in lives in the Keychain (see social.rs).
//!
//! The inbox is only read: the app doesn't mark mail read on the server, move it or delete it.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_rustls::{client::TlsStream, rustls, TlsConnector};

/// The feed that holds your email: it has nothing to download (see share::is_saved_feed).
pub const FEED: &str = "saved:email";
pub const TITLE: &str = "Email";
/// How many of the newest emails in the inbox the app looks at.
const NEWEST: u32 = 100;
/// Emails bigger than this (mostly attachments) are shown as a short note instead.
const MAX_BYTES: u32 = 8 * 1024 * 1024;
const WAIT: Duration = Duration::from_secs(25);

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Account {
    pub address: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub password: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
}

impl Account {
    /// Everything but the password, for the interface.
    pub fn public(&self) -> serde_json::Value {
        serde_json::json!({ "address": self.address, "name": self.name, "imap_host": self.imap_host,
            "imap_port": self.imap_port, "smtp_host": self.smtp_host, "smtp_port": self.smtp_port })
    }
    fn domain(&self) -> &str {
        self.address.rsplit('@').next().unwrap_or("localhost")
    }
}

/// One email, ready to become a story.
#[derive(Debug, Clone)]
pub struct Mail {
    /// "email:" + the Message-ID: the same on every device, so read marks travel with sync
    pub link: String,
    /// "<uidvalidity>:<uid>" in this inbox, to skip emails already fetched
    pub uid: String,
    pub subject: String,
    pub from_name: String,
    pub from_addr: String,
    pub reply_to: String,
    pub message_id: String,
    pub references: String,
    pub date: String,
    pub summary: String,
    /// The email's own HTML (not yet cleaned), or its text turned into paragraphs
    pub html: String,
}

// ---------------------------------------------------------------- connections

fn tls() -> TlsConnector {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("TLS versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    TlsConnector::from(Arc::new(cfg))
}

async fn tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    match tokio::time::timeout(WAIT, TcpStream::connect((host, port))).await {
        Ok(Ok(s)) => Ok(s),
        Ok(Err(_)) => Err(format!("Couldn't reach {host}. Check the server name and your connection.")),
        Err(_) => Err(format!("{host} didn't answer. Check the server name and port.")),
    }
}

async fn secure<S: AsyncRead + AsyncWrite + Unpin>(host: &str, s: S) -> Result<TlsStream<S>, String> {
    let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|_| format!("“{host}” isn't a server name."))?;
    match tokio::time::timeout(WAIT, tls().connect(name, s)).await {
        Ok(Ok(t)) => Ok(t),
        Ok(Err(e)) => Err(format!("Couldn't make a secure connection to {host} ({e}).")),
        Err(_) => Err(format!("{host} didn't answer.")),
    }
}

type Imap = async_imap::Session<TlsStream<TcpStream>>;

async fn imap_login(a: &Account) -> Result<Imap, String> {
    let s = secure(&a.imap_host, tcp(&a.imap_host, a.imap_port).await?).await?;
    let mut client = async_imap::Client::new(s);
    let _greeting = tokio::time::timeout(WAIT, client.read_response())
        .await
        .map_err(|_| format!("{} didn't answer.", a.imap_host))?;
    match tokio::time::timeout(WAIT, client.login(&a.address, &a.password)).await {
        Ok(Ok(s)) => Ok(s),
        Ok(Err((e, _))) => Err(format!("The mail server didn't accept that address and password. Check them (some providers need an app password). The server said: {}", said(&e))),
        Err(_) => Err("The mail server didn't answer the sign-in.".into()),
    }
}

/// What a server said, without the protocol wrapping.
fn said(e: &async_imap::error::Error) -> String {
    let t = e.to_string();
    let t = t.trim_start_matches("No Response: ").trim_start_matches("Bad Response: ");
    t.chars().take(200).collect()
}

/// Sign in and open the inbox, to check an account before saving it.
pub async fn check(a: &Account) -> Result<(), String> {
    let mut s = imap_login(a).await?;
    s.select("INBOX").await.map_err(|e| format!("Signed in, but couldn't open the inbox ({e})."))?;
    let _ = s.logout().await;
    Ok(())
}

// ---------------------------------------------------------------- reading the inbox

/// The newest emails in the inbox that aren't in `known` yet.
pub async fn fetch(a: &Account, known: &HashSet<String>) -> Result<(Vec<Mail>, u32), String> {
    use futures::TryStreamExt;
    let mut s = imap_login(a).await?;
    let mb = s.select("INBOX").await.map_err(|e| format!("Couldn't open the inbox ({e})."))?;
    let validity = mb.uid_validity.unwrap_or(0);
    if mb.exists == 0 {
        let _ = s.logout().await;
        return Ok((vec![], 0));
    }
    let first = mb.exists.saturating_sub(NEWEST - 1).max(1);
    let heads: Vec<_> = s
        .fetch(format!("{first}:{}", mb.exists), "(UID RFC822.SIZE)")
        .await
        .map_err(|e| format!("Couldn't list the inbox ({e})."))?
        .try_collect()
        .await
        .map_err(|e| format!("Couldn't list the inbox ({e})."))?;
    let mut small = vec![];
    let mut big = vec![];
    for h in &heads {
        let Some(uid) = h.uid else { continue };
        if known.contains(&format!("{validity}:{uid}")) {
            continue;
        }
        if h.size.unwrap_or(0) > MAX_BYTES { big.push(uid) } else { small.push(uid) }
    }
    let mut out = vec![];
    for (uids, what) in [(&small, "(UID BODY.PEEK[])"), (&big, "(UID BODY.PEEK[HEADER])")] {
        if uids.is_empty() {
            continue;
        }
        let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let got: Vec<_> = s
            .uid_fetch(set, what)
            .await
            .map_err(|e| format!("Couldn't download email ({e})."))?
            .try_collect()
            .await
            .map_err(|e| format!("Couldn't download email ({e})."))?;
        for f in &got {
            let (Some(uid), Some(raw)) = (f.uid, f.body().or_else(|| f.header())) else { continue };
            if let Some(mut m) = parse(raw, &format!("{validity}:{uid}")) {
                if std::ptr::eq(uids, &big) {
                    m.html = "<p><em>This email is too big to show here (it probably has large attachments). Open it in your email app.</em></p>".into();
                }
                out.push(m);
            }
        }
    }
    let _ = s.logout().await;
    Ok((out, mb.exists))
}

pub fn parse(raw: &[u8], uid: &str) -> Option<Mail> {
    let m = mail_parser::MessageParser::default().parse(raw)?;
    let from = m.from().and_then(|a| a.first());
    let from_addr = from.and_then(|a| a.address()).unwrap_or("").to_string();
    let from_name = from.and_then(|a| a.name()).map(|n| n.to_string()).filter(|n| !n.trim().is_empty()).unwrap_or_else(|| from_addr.clone());
    let reply_to = m.reply_to().and_then(|a| a.first()).and_then(|a| a.address()).unwrap_or("").to_string();
    let message_id = m.message_id().unwrap_or("").to_string();
    let mut refs: Vec<String> = m.references().as_text_list().map(|l| l.iter().map(|s| s.to_string()).collect()).unwrap_or_default();
    if refs.is_empty() {
        if let Some(r) = m.in_reply_to().as_text() {
            refs.push(r.to_string());
        }
    }
    let date = m
        .date()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(&d.to_rfc3339()).ok())
        .map(|d| d.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    let text = m.body_text(0).map(|t| t.to_string()).unwrap_or_default();
    let html = match m.body_html(0) {
        // mail-parser makes HTML out of a text-only email too; use our own paragraphs for those
        Some(h) if m.html_body_count() > 0 && m.html_part(0).map(|p| p.is_text_html()).unwrap_or(false) => h.to_string(),
        _ => text_to_html(&text),
    };
    let summary: String = squash(if text.trim().is_empty() { &html } else { &text }).chars().take(240).collect();
    let key = if message_id.is_empty() { format!("uid-{uid}") } else { message_id.clone() };
    Some(Mail {
        link: format!("email:{key}"),
        uid: uid.to_string(),
        subject: m.subject().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "(No subject)".into()),
        from_name,
        from_addr,
        reply_to,
        message_id,
        references: refs.join(" "),
        date,
        summary,
        html,
    })
}

/// Plain text without tags, quoted replies or runs of spaces (for the line under a title).
fn squash(s: &str) -> String {
    static TAGS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let tags = TAGS.get_or_init(|| regex::Regex::new(r"(?s)<style.*?</style>|<[^>]+>").unwrap());
    let plain = html_escape::decode_html_entities(&tags.replace_all(s, " ")).to_string();
    plain.lines().filter(|l| !l.trim_start().starts_with('>')).collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn text_to_html(text: &str) -> String {
    static LINK: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let link = LINK.get_or_init(|| regex::Regex::new(r#"https?://[^\s<]+[^\s<.,;:!?)\]'"]"#).unwrap());
    let esc = html_escape::encode_text(text).replace("\r\n", "\n");
    let linked = link.replace_all(&esc, |c: &regex::Captures| format!(r#"<a href="{0}">{0}</a>"#, &c[0]));
    linked
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .map(|p| format!("<p>{}</p>", p.trim().replace('\n', "<br>")))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------- where mail is delivered

/// The last two parts of a host name (mx00.ionos.com → ionos.com).
fn base(host: &str) -> String {
    let parts: Vec<&str> = host.trim_end_matches('.').split('.').collect();
    parts[parts.len().saturating_sub(2)..].join(".").to_lowercase()
}

/// Providers whose incoming mail servers have a different name than their IMAP server.
fn same_provider(mx: &str, imap: &str) -> bool {
    let (m, i) = (base(mx), base(imap));
    if m == i {
        return true;
    }
    let groups: [&[&str]; 5] = [
        &["gmail.com", "google.com", "googlemail.com"],
        &["me.com", "icloud.com", "apple.com"],
        &["fastmail.com", "messagingengine.com"],
        &["yahoo.com", "yahoodns.net"],
        &["ionos.com", "ionos.de", "1and1.com", "ui-dns.com"],
    ];
    groups.iter().any(|g| g.contains(&m.as_str()) && g.contains(&i.as_str()))
}

/// If the address's domain sends its mail somewhere other than this mail server, say where
/// (an address can exist on one server while the domain's mail goes to another).
pub async fn delivered_elsewhere(client: &reqwest::Client, a: &Account) -> Option<String> {
    let url = format!("https://dns.google/resolve?name={}&type=MX", a.domain());
    let v: serde_json::Value = client.get(url).send().await.ok()?.json().await.ok()?;
    let hosts: Vec<String> = v["Answer"]
        .as_array()?
        .iter()
        .filter_map(|r| r["data"].as_str())
        .filter_map(|d| d.split_whitespace().last().map(|h| h.trim_end_matches('.').to_string()))
        .collect();
    if hosts.is_empty() || hosts.iter().any(|h| same_provider(h, &a.imap_host)) {
        return None;
    }
    Some(hosts[0].clone())
}

// ---------------------------------------------------------------- sending a reply

pub struct Outgoing<'a> {
    pub to: &'a str,
    pub subject: &'a str,
    pub body: &'a str,
    pub in_reply_to: &'a str,
    pub references: &'a str,
}

fn header_text(s: &str) -> String {
    use base64::Engine;
    if s.is_ascii() {
        s.replace(['\r', '\n'], " ")
    } else {
        format!("=?UTF-8?B?{}?=", base64::engine::general_purpose::STANDARD.encode(s.replace(['\r', '\n'], " ")))
    }
}

fn angle(id: &str) -> String {
    let id = id.trim().trim_start_matches('<').trim_end_matches('>');
    format!("<{id}>")
}

/// The email as it goes out (and as it's filed in Sent).
pub fn compose(a: &Account, o: &Outgoing<'_>) -> String {
    use base64::Engine;
    use sha1::{Digest, Sha1};
    let now = chrono::Local::now();
    let mut h = Sha1::new();
    h.update(format!("{}|{}|{}", now.timestamp_nanos_opt().unwrap_or(0), a.address, o.to).as_bytes());
    let id: String = h.finalize().iter().take(12).map(|b| format!("{b:02x}")).collect();
    let from = if a.name.trim().is_empty() { format!("<{}>", a.address) } else { format!("{} <{}>", header_text(a.name.trim()), a.address) };
    let mut m = format!(
        "From: {from}\r\nTo: <{}>\r\nSubject: {}\r\nDate: {}\r\nMessage-ID: <{id}.reading-room@{}>\r\n",
        o.to.trim(),
        header_text(o.subject),
        now.to_rfc2822(),
        a.domain()
    );
    if !o.in_reply_to.is_empty() {
        m += &format!("In-Reply-To: {}\r\n", angle(o.in_reply_to));
        let refs: Vec<String> = o.references.split_whitespace().chain([o.in_reply_to]).map(angle).collect();
        m += &format!("References: {}\r\n", refs.join(" "));
    }
    m += "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\nX-Mailer: The Reading Room\r\n\r\n";
    let b64 = base64::engine::general_purpose::STANDARD.encode(o.body.replace("\r\n", "\n").replace('\n', "\r\n"));
    for chunk in b64.as_bytes().chunks(76) {
        m += std::str::from_utf8(chunk).unwrap_or("");
        m += "\r\n";
    }
    m
}

struct Smtp<S> {
    io: BufReader<S>,
}

impl<S: AsyncRead + AsyncWrite + Unpin> Smtp<S> {
    async fn reply(&mut self) -> Result<(u16, String), String> {
        let mut all = String::new();
        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(WAIT, self.io.read_line(&mut line))
                .await
                .map_err(|_| "The mail server stopped answering.".to_string())?
                .map_err(|e| format!("Lost the connection to the mail server ({e})."))?;
            if n == 0 {
                return Err("The mail server closed the connection.".into());
            }
            all.push_str(&line);
            if line.len() < 4 || line.as_bytes()[3] != b'-' {
                let code = line.get(..3).and_then(|c| c.parse().ok()).unwrap_or(0);
                return Ok((code, all));
            }
        }
    }
    async fn cmd(&mut self, line: &str, want: u16, what: &str) -> Result<String, String> {
        self.io.get_mut().write_all(format!("{line}\r\n").as_bytes()).await.map_err(|e| format!("Lost the connection to the mail server ({e})."))?;
        self.io.get_mut().flush().await.map_err(|e| e.to_string())?;
        let (code, text) = self.reply().await?;
        if code / 100 != want / 100 {
            let said = text.lines().last().unwrap_or("").get(4..).unwrap_or("").trim().to_string();
            return Err(format!("{what} ({code} {said})"));
        }
        Ok(text)
    }
    async fn send(&mut self, a: &Account, to: &str, msg: &str) -> Result<(), String> {
        use base64::Engine;
        let host = format!("EHLO {}", a.domain());
        self.cmd(&host, 250, "The mail server didn't say hello").await?;
        let auth = base64::engine::general_purpose::STANDARD.encode(format!("\0{}\0{}", a.address, a.password));
        self.cmd(&format!("AUTH PLAIN {auth}"), 235, "The mail server didn't accept the address and password for sending").await?;
        self.cmd(&format!("MAIL FROM:<{}>", a.address), 250, "The mail server wouldn't send from this address").await?;
        self.cmd(&format!("RCPT TO:<{}>", to.trim()), 250, "The mail server wouldn't send to that address").await?;
        self.cmd("DATA", 354, "The mail server wouldn't take the email").await?;
        // A line starting with a dot gets a second one, so it isn't read as the end
        let stuffed: String = msg.split("\r\n").map(|l| if l.starts_with('.') { format!(".{l}") } else { l.to_string() }).collect::<Vec<_>>().join("\r\n");
        let body = format!("{}\r\n.", stuffed.trim_end_matches("\r\n"));
        self.cmd(&body, 250, "The mail server didn't send the email").await?;
        let _ = self.cmd("QUIT", 221, "").await;
        Ok(())
    }
}

/// Send over SMTP: port 465 is secure from the start, other ports (587) switch to secure with STARTTLS.
pub async fn send(a: &Account, o: &Outgoing<'_>) -> Result<String, String> {
    if !o.to.contains('@') || o.to.contains(['\r', '\n', '<', '>']) {
        return Err("There's no address to reply to.".into());
    }
    let msg = compose(a, o);
    let raw = tcp(&a.smtp_host, a.smtp_port).await?;
    if a.smtp_port == 465 {
        let mut s = Smtp { io: BufReader::new(secure(&a.smtp_host, raw).await?) };
        s.reply().await?;
        s.send(a, o.to, &msg).await?;
    } else {
        let mut plain = Smtp { io: BufReader::new(raw) };
        plain.reply().await?;
        plain.cmd(&format!("EHLO {}", a.domain()), 250, "The mail server didn't say hello").await?;
        plain.cmd("STARTTLS", 220, "The mail server wouldn't make a secure connection").await?;
        let mut s = Smtp { io: BufReader::new(secure(&a.smtp_host, plain.io.into_inner()).await?) };
        s.send(a, o.to, &msg).await?;
    }
    Ok(msg)
}

/// File a sent reply in the mailbox's Sent folder, as Mail does (best effort).
pub async fn file_sent(a: &Account, msg: &str) {
    use futures::TryStreamExt;
    let Ok(mut s) = imap_login(a).await else { return };
    let mut sent = None;
    if let Ok(list) = s.list(Some(""), Some("*")).await {
        let names: Vec<_> = list.try_collect().await.unwrap_or_default();
        sent = names.iter().find(|n| n.attributes().iter().any(|at| format!("{at:?}").contains("Sent"))).map(|n| n.name().to_string());
        if sent.is_none() {
            for want in ["Sent", "Sent Items", "Sent Messages", "INBOX.Sent", "Sent Mail", "[Gmail]/Sent Mail"] {
                if let Some(n) = names.iter().find(|n| n.name().eq_ignore_ascii_case(want)) {
                    sent = Some(n.name().to_string());
                    break;
                }
            }
        }
    }
    if let Some(folder) = sent {
        let _ = s.append(&folder, Some("(\\Seen)"), None, msg.as_bytes()).await;
    }
    let _ = s.logout().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_email() {
        let raw = b"From: Porch Letter <hello@example.com>\r\nReply-To: replies@example.com\r\nTo: reading@daviddaniels.com\r\nSubject: =?UTF-8?B?VGhlIHllYXIgb2YgdGhlIHNsb3cgd2Vi?=\r\nMessage-ID: <abc@example.com>\r\nDate: Sun, 8 Nov 2026 09:00:00 -0500\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHi friends,\r\n\r\nSee https://daviddaniels.com/now.\r\n";
        let m = parse(raw, "1:5").unwrap();
        assert_eq!(m.subject, "The year of the slow web");
        assert_eq!(m.from_name, "Porch Letter");
        assert_eq!(m.from_addr, "hello@example.com");
        assert_eq!(m.reply_to, "replies@example.com");
        assert_eq!(m.link, "email:abc@example.com");
        assert_eq!(m.date, "2026-11-08T14:00:00Z");
        assert!(m.html.contains(r#"<a href="https://daviddaniels.com/now">"#), "{}", m.html);
        assert!(m.summary.starts_with("Hi friends, See"));
    }

    #[test]
    fn keeps_an_html_email() {
        let raw = b"From: a@b.c\r\nSubject: Hi\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nplain\r\n--x\r\nContent-Type: text/html\r\n\r\n<p><b>rich</b></p>\r\n--x--\r\n";
        let m = parse(raw, "1:6").unwrap();
        assert!(m.html.contains("<b>rich</b>"), "{}", m.html);
        assert_eq!(m.summary, "plain");
        assert!(m.link.starts_with("email:uid-1:6"));
    }

    #[test]
    fn knows_providers() {
        assert!(same_provider("mx00.ionos.com", "imap.ionos.com"));
        assert!(same_provider("aspmx.l.google.com", "imap.gmail.com"));
        assert!(!same_provider("mail.protonmail.ch", "imap.ionos.com"));
    }

    #[test]
    fn writes_a_reply() {
        let a = Account { address: "reading@daviddaniels.com".into(), name: "David Daniels".into(), ..Default::default() };
        let m = compose(&a, &Outgoing { to: "hello@example.com", subject: "Re: The year", body: "Thanks!\n.\nDavid", in_reply_to: "abc@example.com", references: "<x@y>" });
        assert!(m.contains("From: David Daniels <reading@daviddaniels.com>\r\n"));
        assert!(m.contains("In-Reply-To: <abc@example.com>\r\n"));
        assert!(m.contains("References: <x@y> <abc@example.com>\r\n"));
        assert!(m.contains("Message-ID: <") && m.contains("@daviddaniels.com>"));
    }
}
