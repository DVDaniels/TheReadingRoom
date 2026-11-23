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
    /// Who else it went to (addresses, comma-separated), for Reply All
    pub to: String,
    pub cc: String,
    /// Sent to a list (a newsletter, a store, a service), not written to you by a person
    pub bulk: bool,
    /// Where to unsubscribe (the List-Unsubscribe header as sent), and whether one click does it (RFC 8058)
    pub unsub: String,
    pub unsub_post: bool,
    /// The conversation it belongs to: the Message-ID that started it
    pub thread: String,
}

// ---------------------------------------------------------------- connections

/// A mail server on this computer: Proton Mail Bridge, which Proton's own app runs on your Mac
/// (it speaks IMAP and SMTP for Proton, whose servers don't).
pub fn is_local(host: &str) -> bool {
    matches!(host.trim().to_lowercase().as_str(), "127.0.0.1" | "localhost" | "::1" | "[::1]")
}

fn tls(host: &str) -> TlsConnector {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone()).with_safe_default_protocol_versions().expect("TLS versions");
    let cfg = if is_local(host) {
        // Bridge makes its own certificate, which no authority vouches for. It's accepted only from a
        // server on this same computer; everything else must have a real certificate.
        builder.dangerous().with_custom_certificate_verifier(Arc::new(LocalBridge(provider))).with_no_client_auth()
    } else {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        builder.with_root_certificates(roots).with_no_client_auth()
    };
    TlsConnector::from(Arc::new(cfg))
}

#[derive(Debug)]
struct LocalBridge(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for LocalBridge {
    fn verify_server_cert(
        &self,
        _end: &rustls::pki_types::CertificateDer<'_>,
        _rest: &[rustls::pki_types::CertificateDer<'_>],
        _name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

async fn tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    let host_only = host.trim_start_matches('[').trim_end_matches(']');
    match tokio::time::timeout(WAIT, TcpStream::connect((host_only, port))).await {
        Ok(Ok(s)) => Ok(s),
        Ok(Err(_)) if is_local(host) => Err(if cfg!(target_os = "ios") {
            "This mailbox is read through Proton Mail Bridge, which runs on your Mac, so it can only be used there.".into()
        } else {
            "Couldn't reach Proton Mail Bridge. Open Bridge and check it's signed in, then try again.".into()
        }),
        Ok(Err(_)) => Err(format!("Couldn't reach {host}. Check the server name and your connection.")),
        Err(_) => Err(format!("{host} didn't answer. Check the server name and port.")),
    }
}

async fn secure<S: AsyncRead + AsyncWrite + Unpin>(host: &str, s: S) -> Result<TlsStream<S>, String> {
    let bare = host.trim_start_matches('[').trim_end_matches(']').to_string();
    let name = rustls::pki_types::ServerName::try_from(bare).map_err(|_| format!("“{host}” isn't a server name."))?;
    match tokio::time::timeout(WAIT, tls(host).connect(name, s)).await {
        Ok(Ok(t)) => Ok(t),
        Ok(Err(e)) => Err(format!("Couldn't make a secure connection to {host} ({e}).")),
        Err(_) => Err(format!("{host} didn't answer.")),
    }
}

/// How long to wait for a plain greeting before deciding the server wants a secure connection from the
/// first byte. Bridge answers at once; a real server gets longer.
fn quick(host: &str) -> Duration {
    if is_local(host) { Duration::from_secs(3) } else { Duration::from_secs(10) }
}

/// How a server wants to be spoken to: secure from the first byte, or plain and then STARTTLS.
/// The port is only a guess (Bridge can be set either way on any port), so each is tried in turn.
enum Opened<T> {
    Ready(T),
    /// The server said nothing, or the secure handshake failed: try the other way.
    OtherWay(String),
    Failed(String),
}

/// IMAP: returns the stream and whether the greeting still has to be read (secure from the start).
async fn imap_stream(a: &Account) -> Result<(TlsStream<TcpStream>, bool), String> {
    let implicit_first = a.imap_port == 993;
    let first = if implicit_first { imap_implicit(a).await } else { imap_starttls(a).await };
    let why = match first {
        Opened::Ready(t) => return Ok((t, implicit_first)),
        Opened::Failed(e) => return Err(e),
        Opened::OtherWay(e) => e,
    };
    let second = if implicit_first { imap_starttls(a).await } else { imap_implicit(a).await };
    match second {
        Opened::Ready(t) => Ok((t, !implicit_first)),
        Opened::Failed(e) | Opened::OtherWay(e) => Err(if implicit_first { why } else { e }),
    }
}

async fn imap_implicit(a: &Account) -> Opened<TlsStream<TcpStream>> {
    let raw = match tcp(&a.imap_host, a.imap_port).await { Ok(r) => r, Err(e) => return Opened::Failed(e) };
    match secure(&a.imap_host, raw).await { Ok(t) => Opened::Ready(t), Err(e) => Opened::OtherWay(e) }
}

async fn imap_starttls(a: &Account) -> Opened<TlsStream<TcpStream>> {
    let raw = match tcp(&a.imap_host, a.imap_port).await { Ok(r) => r, Err(e) => return Opened::Failed(e) };
    let mut io = BufReader::new(raw);
    let hello = match read_line_within(&mut io, &a.imap_host, quick(&a.imap_host)).await {
        Ok(l) => l,
        Err(e) => return Opened::OtherWay(e),
    };
    if !hello.starts_with("* OK") {
        return Opened::OtherWay(format!("{} didn't greet like a mail server.", a.imap_host));
    }
    if let Err(e) = io.get_mut().write_all(b"rr0 STARTTLS\r\n").await {
        return Opened::Failed(e.to_string());
    }
    loop {
        let l = match read_line(&mut io, &a.imap_host).await { Ok(l) => l, Err(e) => return Opened::Failed(e) };
        if l.starts_with("rr0 ") {
            if !l.starts_with("rr0 OK") {
                return Opened::Failed(format!("{} wouldn't make a secure connection on port {}. Check the port (secure from the start is 993).", a.imap_host, a.imap_port));
            }
            break;
        }
    }
    match secure(&a.imap_host, io.into_inner()).await { Ok(t) => Opened::Ready(t), Err(e) => Opened::Failed(e) }
}

async fn read_line(io: &mut BufReader<TcpStream>, host: &str) -> Result<String, String> {
    read_line_within(io, host, WAIT).await
}

async fn read_line_within(io: &mut BufReader<TcpStream>, host: &str, wait: Duration) -> Result<String, String> {
    let mut l = String::new();
    match tokio::time::timeout(wait, io.read_line(&mut l)).await {
        Ok(Ok(n)) if n > 0 => Ok(l),
        _ => Err(format!("{host} stopped answering.")),
    }
}

type Imap = async_imap::Session<TlsStream<TcpStream>>;

async fn imap_login(a: &Account) -> Result<Imap, String> {
    let (stream, implicit) = imap_stream(a).await?;
    let mut client = async_imap::Client::new(stream);
    if implicit {
        let _greeting = tokio::time::timeout(WAIT, client.read_response())
            .await
            .map_err(|_| format!("{} didn't answer.", a.imap_host))?;
    }
    match tokio::time::timeout(WAIT, client.login(&a.address, &a.password)).await {
        Ok(Ok(s)) => Ok(s),
        Ok(Err((e, _))) if is_local(&a.imap_host) => Err(format!("Bridge didn't accept that address and password. Use the password Bridge shows for your account (not your Proton password). Bridge said: {}", said(&e))),
        Ok(Err((e, _))) => Err(format!("The mail server didn't accept that address and password. Check them (some providers need an app password). The server said: {}", said(&e))),
        Err(_) => Err("The mail server didn't answer the sign-in.".into()),
    }
}

/// What a server said, without the protocol wrapping.
fn said(e: &async_imap::error::Error) -> String {
    let t = e.to_string();
    // "no response: code: None, info: Some(\"[AUTHENTICATIONFAILED] Login failed\")" → "Login failed"
    let t = t.split("info: Some(\"").nth(1).map(|x| x.trim_end_matches("\")").to_string()).unwrap_or(t);
    let t = t.trim_start_matches("No Response: ").trim_start_matches("Bad Response: ");
    let t = match t.strip_prefix('[') { Some(r) => r.split_once("] ").map(|(_, x)| x).unwrap_or(t), None => t };
    t.chars().take(200).collect()
}

/// Sign in and open the inbox, to check an account before saving it.
pub async fn check(a: &Account) -> Result<(), String> {
    let mut s = imap_login(a).await?;
    s.select("INBOX").await.map_err(|e| format!("Signed in, but couldn't open the inbox ({e})."))?;
    let _ = s.logout().await;
    // Sending too, so a wrong SMTP port or setting shows up now rather than on the first email
    let mut out = smtp_open(a).await.map_err(|e| format!("Reading works, but sending doesn't: {e}"))?;
    out.sign_in(a).await.map_err(|e| format!("Reading works, but sending doesn't: {e}"))?;
    let _ = out.cmd("QUIT", 221, "").await;
    Ok(())
}

// ---------------------------------------------------------------- reading the inbox

pub struct Inbox {
    /// New emails (not in `have`)
    pub mails: Vec<Mail>,
    /// How many emails the inbox holds
    pub count: u32,
    /// Emails the app has that aren't in the inbox any more (deleted or moved elsewhere): "<uidvalidity>:<uid>"
    pub gone: Vec<String>,
}

/// The newest emails in the inbox that aren't in `have` yet, and which of `seen` have left it.
pub async fn fetch(a: &Account, have: &HashSet<String>, seen: &HashSet<String>) -> Result<Inbox, String> {
    fetch_in(a, "INBOX", have, seen).await
}

/// An email's key: "<uidvalidity>:<uid>" in the inbox, "<folder>|<uidvalidity>:<uid>" in any other folder
/// (numbers are only unique within a folder).
pub fn mail_key(folder: &str, validity: u32, uid: u32) -> String {
    if folder.eq_ignore_ascii_case("INBOX") { format!("{validity}:{uid}") } else { format!("{folder}|{validity}:{uid}") }
}
/// The folder an email's key belongs to, and the "<uidvalidity>:<uid>" part.
pub fn split_key(key: &str) -> (&str, &str) {
    key.rsplit_once('|').unwrap_or(("INBOX", key))
}

/// The folders the Email tab shows besides the inbox, by what they're for.
#[derive(PartialEq, Clone, Copy, Debug)]
pub enum Kind {
    Sent,
    Archive,
    Trash,
    Spam,
}
impl Kind {
    pub fn from_str(s: &str) -> Option<Kind> {
        match s {
            "sent" => Some(Kind::Sent),
            "archive" => Some(Kind::Archive),
            "trash" => Some(Kind::Trash),
            "spam" => Some(Kind::Spam),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Sent => "sent",
            Kind::Archive => "archive",
            Kind::Trash => "trash",
            Kind::Spam => "spam",
        }
    }
    /// What the server marks the folder with (RFC 6154), best first
    fn marks(self) -> &'static [&'static str] {
        match self {
            Kind::Sent => &["Sent"],
            Kind::Archive => &["Archive", "All"],
            Kind::Trash => &["Trash"],
            Kind::Spam => &["Junk"],
        }
    }
    /// Names it goes by on servers that don't mark folders
    fn names(self) -> &'static [&'static str] {
        match self {
            Kind::Sent => &["Sent", "Sent Items", "Sent Messages", "Sent Mail", "INBOX.Sent", "INBOX.Sent Items", "[Gmail]/Sent Mail", "Gesendet"],
            Kind::Archive => &["Archive", "Archives", "INBOX.Archive", "Archived", "[Gmail]/All Mail"],
            Kind::Trash => &["Trash", "Deleted Items", "Deleted Messages", "INBOX.Trash", "Papierkorb", "[Gmail]/Trash", "[Gmail]/Bin", "Bin"],
            Kind::Spam => &["Spam", "Junk", "Junk E-mail", "Junk Email", "INBOX.Spam", "INBOX.Junk", "[Gmail]/Spam", "Bulk Mail"],
        }
    }
}

/// The mailbox's folders, by name and what the server says they're for (\Sent, \Archive, \All, \Trash, \Junk).
async fn folder_list(s: &mut Imap) -> Vec<(String, String)> {
    use futures::TryStreamExt;
    match s.list(Some(""), Some("*")).await {
        Ok(list) => {
            let got: Vec<_> = list.try_collect().await.unwrap_or_default();
            got.iter().map(|n| (n.name().to_string(), n.attributes().iter().map(|at| format!("{at:?}")).collect::<Vec<_>>().join(" "))).collect()
        }
        Err(_) => vec![],
    }
}

/// Which folder is for `kind`: marked by the server, else by a usual name.
fn pick_folder(names: &[(String, String)], kind: Kind) -> Option<String> {
    kind.marks()
        .iter()
        .find_map(|want| names.iter().find(|(_, at)| at.split(' ').any(|a| a.trim_matches(|c: char| !c.is_alphanumeric()).ends_with(want) && !a.contains("HasNo"))).map(|(n, _)| n.clone()))
        .or_else(|| kind.names().iter().find_map(|want| names.iter().find(|(n, _)| n.eq_ignore_ascii_case(want)).map(|(n, _)| n.clone())))
}

/// The Sent, Archive, Trash and Spam folders this mailbox has (kind, folder name).
pub async fn folders(a: &Account) -> Result<Vec<(Kind, String)>, String> {
    let mut s = imap_login(a).await?;
    let names = folder_list(&mut s).await;
    let _ = s.logout().await;
    Ok([Kind::Sent, Kind::Archive, Kind::Trash, Kind::Spam].into_iter().filter_map(|k| pick_folder(&names, k).map(|n| (k, n))).collect())
}

/// The folder for `kind` in this mailbox (None when it has none).
pub async fn folder_name(a: &Account, kind: Kind) -> Result<Option<String>, String> {
    let mut s = imap_login(a).await?;
    let names = folder_list(&mut s).await;
    let _ = s.logout().await;
    Ok(pick_folder(&names, kind))
}

/// The newest emails in one folder: like the inbox check, for Sent, Archive, Trash or Spam.
pub async fn fetch_in(a: &Account, folder: &str, have: &HashSet<String>, seen: &HashSet<String>) -> Result<Inbox, String> {
    let known = have;
    use futures::TryStreamExt;
    let mut s = imap_login(a).await?;
    let mb = s.select(folder).await.map_err(|e| format!("Couldn't open {} ({e}).", if folder == "INBOX" { "the inbox" } else { folder }))?;
    let validity = mb.uid_validity.unwrap_or(0);
    // Emails from this folder the app has, by number (a different uidvalidity means the server renumbered: can't tell)
    let ours: Vec<(String, u32)> = seen
        .iter()
        .filter(|k| split_key(k).0 == folder)
        .filter_map(|k| split_key(k).1.split_once(':').filter(|(v, _)| v.parse::<u32>().ok() == Some(validity)).and_then(|(_, u)| u.parse().ok().map(|u| (k.clone(), u))))
        .collect();
    if mb.exists == 0 {
        let _ = s.logout().await;
        return Ok(Inbox { mails: vec![], count: 0, gone: ours.into_iter().map(|(k, _)| k).collect() });
    }
    let first = mb.exists.saturating_sub(NEWEST - 1).max(1);
    let heads: Vec<_> = s
        .fetch(format!("{first}:{}", mb.exists), "(UID RFC822.SIZE)")
        .await
        .map_err(|e| format!("Couldn't list the inbox ({e})."))?
        .try_collect()
        .await
        .map_err(|e| format!("Couldn't list the inbox ({e})."))?;
    // Anything at or above the oldest number still looked at, that isn't there now, has left the inbox
    let present: HashSet<u32> = heads.iter().filter_map(|h| h.uid).collect();
    // (when the whole inbox was looked at, anything missing has gone; otherwise only above the oldest looked at)
    let oldest = if first == 1 { 0 } else { present.iter().min().copied().unwrap_or(u32::MAX) };
    let gone: Vec<String> = ours.into_iter().filter(|(_, u)| *u >= oldest && !present.contains(u)).map(|(k, _)| k).collect();
    let mut small = vec![];
    let mut big = vec![];
    for h in &heads {
        let Some(uid) = h.uid else { continue };
        if known.contains(&mail_key(folder, validity, uid)) {
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
            if let Some(mut m) = parse(raw, &mail_key(folder, validity, uid)) {
                if std::ptr::eq(uids, &big) {
                    m.html = "<p><em>This email is too big to show here (it probably has large attachments). Open it in your email app.</em></p>".into();
                }
                out.push(m);
            }
        }
    }
    let _ = s.logout().await;
    Ok(Inbox { mails: out, count: mb.exists, gone })
}

/// Move an email to the mailbox's Trash (or, with no Trash folder, delete it). `uid` is "<uidvalidity>:<uid>";
/// if the server has renumbered since, the email is found by its Message-ID. Returns the folder it went to.
pub async fn trash(a: &Account, uid: &str, message_id: &str) -> Result<Option<String>, String> {
    move_out(a, uid, message_id, Out::Trash).await
}

/// Archive an email: it leaves the inbox for the mailbox's Archive folder (Gmail: All Mail). A mailbox without
/// one gets an "Archive" folder. Returns the folder it went to.
pub async fn archive(a: &Account, uid: &str, message_id: &str) -> Result<Option<String>, String> {
    move_out(a, uid, message_id, Out::Archive).await
}

/// Empty Trash: every email in the mailbox's Trash folder is deleted for good. Returns the folder's name and how
/// many emails it held. (The app asks first; this can't be undone.)
pub async fn empty_trash(a: &Account) -> Result<(String, u32), String> {
    use futures::TryStreamExt;
    let mut s = imap_login(a).await?;
    let names = folder_list(&mut s).await;
    let Some(trash) = pick_folder(&names, Kind::Trash) else {
        let _ = s.logout().await;
        return Err("Your mailbox has no Trash folder.".into());
    };
    let mb = s.select(&trash).await.map_err(|e| format!("Couldn't open {trash} ({e})."))?;
    let n = mb.exists;
    if n > 0 {
        let _: Vec<_> = s
            .store("1:*", "+FLAGS.SILENT (\\Deleted)")
            .await
            .map_err(|e| format!("Couldn't empty {trash} ({e})."))?
            .try_collect()
            .await
            .unwrap_or_default();
        let _: Vec<_> = s.expunge().await.map_err(|e| format!("Couldn't empty {trash} ({e})."))?.try_collect().await.unwrap_or_default();
    }
    let _ = s.logout().await;
    Ok((trash, n))
}

/// Put an email back in the inbox (from Archive, Trash or Spam: Move to Inbox, Not spam).
pub async fn to_inbox(a: &Account, uid: &str, message_id: &str) -> Result<Option<String>, String> {
    move_out(a, uid, message_id, Out::Inbox).await
}

#[derive(PartialEq, Clone, Copy)]
enum Out {
    Trash,
    Archive,
    Inbox,
}

/// The email's number in its folder now (its key, or found again by its Message-ID). Selects that folder.
async fn find_in(s: &mut Imap, key: &str, message_id: &str) -> Result<Option<String>, String> {
    let (folder, uid) = split_key(key);
    let mb = s.select(folder).await.map_err(|e| format!("Couldn't open {} ({e}).", if folder == "INBOX" { "the inbox" } else { folder }))?;
    let validity = mb.uid_validity.unwrap_or(0).to_string();
    let mut target = uid.split_once(':').filter(|(v, _)| *v == validity).map(|(_, u)| u.to_string());
    // still there? (moved or deleted elsewhere since, a move would quietly do nothing)
    if let Some(u) = target.clone() {
        if !s.uid_search(format!("UID {u}")).await.map(|f| f.contains(&u.parse::<u32>().unwrap_or(0))).unwrap_or(true) {
            target = None;
        }
    }
    if target.is_none() && !message_id.is_empty() {
        let id = message_id.trim().trim_start_matches('<').trim_end_matches('>').replace('"', "");
        if let Ok(found) = s.uid_search(format!("HEADER Message-ID \"{id}\"")).await {
            target = found.into_iter().next().map(|u| u.to_string());
        }
    }
    Ok(target)
}

async fn move_out(a: &Account, uid: &str, message_id: &str, to: Out) -> Result<Option<String>, String> {
    use futures::TryStreamExt;
    let mut s = imap_login(a).await?;
    let Some(target) = find_in(&mut s, uid, message_id).await? else {
        let _ = s.logout().await;
        return Ok(None); // not in its folder any more: nothing to do there
    };
    let names = folder_list(&mut s).await;
    let mut folder = match to {
        Out::Inbox => Some("INBOX".to_string()),
        Out::Trash => pick_folder(&names, Kind::Trash),
        Out::Archive => pick_folder(&names, Kind::Archive),
    };
    // already there (Archive from the Archive folder): nothing to move
    if folder.as_deref() == Some(split_key(uid).0) {
        let _ = s.logout().await;
        return Ok(folder);
    }
    if folder.is_none() && to == Out::Archive && !names.is_empty() {
        // no Archive folder yet: make one (inside INBOX on servers that keep every folder there)
        let name = if names.iter().any(|(n, _)| n.starts_with("INBOX.")) { "INBOX.Archive" } else { "Archive" };
        if s.create(name).await.is_ok() {
            folder = Some(name.to_string());
        }
    }
    if to == Out::Archive && folder.is_none() {
        let _ = s.logout().await;
        return Err("Your mailbox has no Archive folder, and the app couldn't make one.".into());
    }
    let moved = match &folder {
        Some(t) => s.uid_mv(&target, t).await.is_ok(),
        None => false,
    };
    if !moved {
        // No MOVE (or no Trash): copy there if there is a folder, then delete from the inbox
        if let Some(t) = &folder {
            s.uid_copy(&target, t).await.map_err(|e| format!("Couldn't move the email to {t} ({e})."))?;
        }
        let _: Vec<_> = s
            .uid_store(&target, "+FLAGS.SILENT (\\Deleted)")
            .await
            .map_err(|e| format!("Couldn't move the email ({e})."))?
            .try_collect()
            .await
            .unwrap_or_default();
        let _: Vec<_> = s.expunge().await.map_err(|e| format!("Couldn't move the email ({e})."))?.try_collect().await.unwrap_or_default();
    }
    let _ = s.logout().await;
    Ok(folder)
}

/// Search the whole inbox on the mail server (subject, sender and text): the newest `NEWEST` matches the app
/// doesn't have yet, and how many matched in all.
pub async fn search(a: &Account, query: &str, have: &HashSet<String>) -> Result<(Vec<Mail>, usize), String> {
    use futures::TryStreamExt;
    let q: String = query.chars().filter(|c| !c.is_control() && *c != '"' && *c != '\\').take(100).collect();
    if q.trim().is_empty() {
        return Ok((vec![], 0));
    }
    let mut s = imap_login(a).await?;
    let mb = s.select("INBOX").await.map_err(|e| format!("Couldn't open the inbox ({e})."))?;
    let validity = mb.uid_validity.unwrap_or(0);
    // non-ASCII words need the server told it's UTF-8; most servers take CHARSET UTF-8, a few only plain ASCII
    let cmd = format!("OR OR SUBJECT \"{q}\" FROM \"{q}\" TEXT \"{q}\"");
    let found = match s.uid_search(if q.is_ascii() { cmd.clone() } else { format!("CHARSET UTF-8 {cmd}") }).await {
        Ok(f) => f,
        Err(_) if !q.is_ascii() => s.uid_search(&cmd).await.unwrap_or_default(),
        Err(e) => return Err(format!("Your mail server couldn't search ({e}).")),
    };
    let mut all: Vec<u32> = found.into_iter().collect();
    all.sort_unstable();
    let total = all.len();
    let missing: Vec<u32> = all.into_iter().rev().filter(|u| !have.contains(&format!("{validity}:{u}"))).take(NEWEST as usize).collect();
    let mut out = vec![];
    if !missing.is_empty() {
        let set = missing.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let sizes: Vec<_> = s.uid_fetch(&set, "(UID RFC822.SIZE)").await.map_err(|e| format!("Couldn't list the inbox ({e})."))?.try_collect().await.map_err(|e| format!("Couldn't list the inbox ({e})."))?;
        let (mut small, mut big) = (vec![], vec![]);
        for f in &sizes {
            if let Some(u) = f.uid {
                if f.size.unwrap_or(0) > MAX_BYTES { big.push(u) } else { small.push(u) }
            }
        }
        for (uids, what, too_big) in [(&small, "(UID BODY.PEEK[])", false), (&big, "(UID BODY.PEEK[HEADER])", true)] {
            if uids.is_empty() {
                continue;
            }
            let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
            let got: Vec<_> = s.uid_fetch(set, what).await.map_err(|e| format!("Couldn't download email ({e})."))?.try_collect().await.map_err(|e| format!("Couldn't download email ({e})."))?;
            for f in &got {
                let (Some(uid), Some(raw)) = (f.uid, f.body().or_else(|| f.header())) else { continue };
                if let Some(mut m) = parse(raw, &format!("{validity}:{uid}")) {
                    if too_big {
                        m.html = "<p><em>This email is too big to show here (it probably has large attachments). Open it in your email app.</em></p>".into();
                    }
                    out.push(m);
                }
            }
        }
    }
    let _ = s.logout().await;
    Ok((out, total))
}

/// Where a newsletter's own site might be, best guess first: the host of its "View in browser" or most-linked
/// page, then the sender's own domain (not a mail service's). Known newsletter platforms give their feed directly.
pub fn newsletter_sites(html: &str, from: &str) -> Vec<String> {
    static HREF: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let href = HREF.get_or_init(|| regex::Regex::new(r#"(?is)<a\b[^>]*\bhref\s*=\s*["'](https?://[^"'\s]+)["'][^>]*>(.*?)</a>"#).unwrap());
    // mail services, trackers, link shorteners and big sites: never the newsletter's own site
    const NOT: &[&str] = &["list-manage.com", "mailchimp.com", "mcusercontent.com", "substackcdn.com", "sendgrid.net", "mailgun", "convertkit", "ck.page", "kit.com", "beehiiv.com/", "cmail", "createsend", "constantcontact", "hubspot", "klaviyo", "mailerlite", "sendinblue", "brevo", "bit.ly", "t.co", "lnkd.in", "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "youtube.com", "tiktok.com", "apple.com", "google.com", "gstatic.com", "medium.com/m/", "unsubscribe", "manage", "preferences", "click.", "links.", "link.", "email.", "e.", "track", "open.", "eotrx", "cdn"];
    let host = |u: &str| url::Url::parse(u).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_ascii_lowercase()));
    let bad = |u: &str| {
        let l = u.to_ascii_lowercase();
        let h = host(&l).unwrap_or_default();
        NOT.iter().any(|n| if n.ends_with('.') { h.starts_with(n) } else { l.contains(n) })
    };
    let mut out: Vec<String> = vec![];
    fn push(out: &mut Vec<String>, h: String) {
        if !h.is_empty() && !out.contains(&h) {
            out.push(h);
        }
    }
    let mut counts: Vec<(String, usize)> = vec![];
    for c in href.captures_iter(html) {
        let (u, words) = (&c[1], c[2].to_ascii_lowercase());
        if bad(u) {
            continue;
        }
        let Some(h) = host(u) else { continue };
        if words.contains("browser") || words.contains("online") || words.contains("on the web") || words.contains("web version") {
            push(&mut out, h.clone());
        }
        match counts.iter_mut().find(|(x, _)| *x == h) {
            Some(x) => x.1 += 1,
            None => counts.push((h, 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    for (h, _) in counts.into_iter().take(2) {
        push(&mut out, h);
    }
    let dom = from.rsplit('@').next().unwrap_or("").to_ascii_lowercase();
    // a newsletter platform: the writer's own page there
    for (platform, feed) in [("substack.com", "/feed"), ("ghost.io", "/rss/"), ("beehiiv.com", "/feed")] {
        if let Some(h) = out.iter().find(|h| h.ends_with(&format!(".{platform}")) && h.split('.').count() == 3).cloned() {
            out.insert(0, format!("{h}{feed}"));
            break;
        }
    }
    let free = ["gmail.com", "googlemail.com", "icloud.com", "me.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "protonmail.com", "substack.com", "beehiiv.com", "buttondown.email", "mailchimp.com", "convertkit.com", "ghost.io"];
    let base = dom.split('.').rev().take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(".");
    if !dom.is_empty() && !free.iter().any(|f| base == *f || dom == *f) {
        push(&mut out, base);
    }
    out.into_iter().take(4).collect()
}

/// The whole email as the server keeps it (to open a file attached to it).
pub async fn fetch_raw(a: &Account, uid: &str, message_id: &str) -> Result<Vec<u8>, String> {
    use futures::TryStreamExt;
    let mut s = imap_login(a).await?;
    let Some(target) = find_in(&mut s, uid, message_id).await? else {
        let _ = s.logout().await;
        return Err("This email isn't in its folder any more, so its files can't be opened from here.".into());
    };
    let got: Vec<_> = s
        .uid_fetch(&target, "(UID BODY.PEEK[])")
        .await
        .map_err(|e| format!("Couldn't download the email ({e})."))?
        .try_collect()
        .await
        .map_err(|e| format!("Couldn't download the email ({e})."))?;
    let _ = s.logout().await;
    got.iter().find_map(|f| f.body().map(|b| b.to_vec())).ok_or_else(|| "The mail server didn't send the email.".to_string())
}

/// Older emails: up to `NEWEST` emails from the inbox that come before the oldest one the app has.
pub async fn fetch_older(a: &Account, have: &HashSet<String>) -> Result<(Vec<Mail>, usize), String> {
    fetch_older_in(a, "INBOX", have).await
}

/// Older emails in any folder (see fetch_older).
pub async fn fetch_older_in(a: &Account, folder: &str, have: &HashSet<String>) -> Result<(Vec<Mail>, usize), String> {
    use futures::TryStreamExt;
    let mut s = imap_login(a).await?;
    let mb = s.select(folder).await.map_err(|e| format!("Couldn't open {folder} ({e})."))?;
    let validity = mb.uid_validity.unwrap_or(0);
    let ours: Vec<u32> = have
        .iter()
        .filter(|k| split_key(k).0 == folder)
        .filter_map(|k| split_key(k).1.split_once(':').filter(|(v, _)| v.parse::<u32>().ok() == Some(validity)).and_then(|(_, u)| u.parse().ok()))
        .collect();
    let oldest = ours.iter().min().copied().unwrap_or(u32::MAX);
    let mut all: Vec<u32> = s.uid_search("ALL").await.map_err(|e| format!("Couldn't look through the inbox ({e})."))?.into_iter().collect();
    all.sort_unstable();
    let before: Vec<u32> = all.into_iter().filter(|u| *u < oldest).collect();
    let left = before.len().saturating_sub(NEWEST as usize);
    let pick = &before[left..];
    let mut out = vec![];
    if !pick.is_empty() {
        let set = pick.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let sizes: Vec<_> = s.uid_fetch(&set, "(UID RFC822.SIZE)").await.map_err(|e| format!("Couldn't list the inbox ({e})."))?.try_collect().await.map_err(|e| format!("Couldn't list the inbox ({e})."))?;
        let (mut small, mut big) = (vec![], vec![]);
        for f in &sizes {
            if let Some(u) = f.uid {
                if f.size.unwrap_or(0) > MAX_BYTES { big.push(u) } else { small.push(u) }
            }
        }
        for (uids, what, too_big) in [(&small, "(UID BODY.PEEK[])", false), (&big, "(UID BODY.PEEK[HEADER])", true)] {
            if uids.is_empty() {
                continue;
            }
            let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
            let got: Vec<_> = s.uid_fetch(set, what).await.map_err(|e| format!("Couldn't download email ({e})."))?.try_collect().await.map_err(|e| format!("Couldn't download email ({e})."))?;
            for f in &got {
                let (Some(uid), Some(raw)) = (f.uid, f.body().or_else(|| f.header())) else { continue };
                if let Some(mut m) = parse(raw, &mail_key(folder, validity, uid)) {
                    if too_big {
                        m.html = "<p><em>This email is too big to show here (it probably has large attachments). Open it in your email app.</em></p>".into();
                    }
                    out.push(m);
                }
            }
        }
    }
    let _ = s.logout().await;
    Ok((out, left))
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
    let html = body(&m);
    // A newsletter's hidden preview line is written to be the line under its subject; otherwise its first words
    let pre = preheader(&html);
    // (an HTML-only email's "text" is mail-parser's rough copy, which runs table cells together: use the HTML)
    let html_only = m.text_part(0).map(|p| p.is_text_html()).unwrap_or(true);
    let mut summary: String = if pre.chars().count() >= 25 { pre } else { squash(if text.trim().is_empty() || html_only { &html } else { &text }) }.chars().take(240).collect();
    if summary.is_empty() {
        // all pictures (a sale, an invitation): their descriptions say what it's about
        static ALT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let alt = ALT.get_or_init(|| regex::Regex::new(r#"(?i)<img\b[^>]*\balt\s*=\s*"([^"]{4,200})""#).unwrap());
        summary = alt.captures_iter(&html).map(|c| html_escape::decode_html_entities(&c[1]).trim().to_string()).filter(|a| !a.contains('.') || a.contains(' ')).collect::<Vec<_>>().join(" · ").chars().take(240).collect();
    }
    let key = if message_id.is_empty() { format!("uid-{uid}") } else { message_id.clone() };
    let addrs = |a: Option<&mail_parser::Address>| a.map(|a| a.iter().filter_map(|x| x.address()).map(|x| x.to_string()).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    let raw_header = |n: &str| m.header_raw(n).map(|v| v.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
    let unsub = raw_header("List-Unsubscribe");
    let precedence = raw_header("Precedence").to_ascii_lowercase();
    let bulk = !unsub.is_empty() || !raw_header("List-Id").is_empty() || matches!(precedence.as_str(), "bulk" | "list" | "junk");
    let thread = refs.first().cloned().filter(|r| !r.trim().is_empty()).unwrap_or_else(|| message_id.clone());
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
        to: addrs(m.to()),
        cc: addrs(m.cc()),
        bulk,
        unsub_post: raw_header("List-Unsubscribe-Post").to_ascii_lowercase().contains("one-click"),
        unsub,
        thread: thread.trim().trim_start_matches('<').trim_end_matches('>').to_string(),
    })
}

/// A file's name as the email gives it, or one made from its type, always with an extension (so Open knows
/// which app opens it): "invite.ics", "Forwarded email.eml", "Delivery report.txt", "Attachment.pdf".
fn file_name(p: &mail_parser::MessagePart) -> String {
    use mail_parser::MimeHeaders;
    let clean = |n: &str| n.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0')).take(120).collect::<String>().trim().to_string();
    if let Some(n) = p.attachment_name().map(clean).filter(|n| !n.is_empty()) {
        return n;
    }
    let (t, sub) = p.content_type().map(|c| (c.ctype().to_ascii_lowercase(), c.subtype().unwrap_or("").to_ascii_lowercase())).unwrap_or_default();
    match (t.as_str(), sub.as_str()) {
        _ if p.is_message() => "Forwarded email.eml".into(),
        ("text", "calendar") | ("application", "ics") => "invite.ics".into(),
        ("message", "delivery-status") | ("message", "global-delivery-status") => "Delivery report.txt".into(),
        ("text", "plain") => "Attachment.txt".into(),
        ("text", "html") => "Attachment.html".into(),
        ("image", s) | ("application", s) | ("audio", s) | ("video", s) if !s.is_empty() && s.len() <= 5 && s.chars().all(|c| c.is_ascii_alphanumeric()) => format!("Attachment.{s}"),
        ("application", "vnd.openxmlformats-officedocument.wordprocessingml.document") => "Attachment.docx".into(),
        ("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet") => "Attachment.xlsx".into(),
        ("application", "msword") => "Attachment.doc".into(),
        _ => "Attachment".into(),
    }
}

/// Parts that aren't files for you: a digital signature (S/MIME, PGP), or the calendar invitation an email
/// carries both inside its text and as invite.ics (only the file is listed).
fn not_a_file(m: &mail_parser::Message, p: &mail_parser::MessagePart) -> bool {
    use mail_parser::MimeHeaders;
    let ct = p.content_type().map(|c| format!("{}/{}", c.ctype(), c.subtype().unwrap_or("")).to_ascii_lowercase()).unwrap_or_default();
    if matches!(ct.as_str(), "application/pkcs7-signature" | "application/x-pkcs7-signature" | "application/pgp-signature" | "application/pgp-keys") {
        return true;
    }
    if ct == "text/calendar" && p.attachment_name().is_none() {
        return m.attachments.iter().filter_map(|&i| m.parts.get(i as usize)).any(|o| o.attachment_name().map(|n| n.to_ascii_lowercase().ends_with(".ics")).unwrap_or(false));
    }
    false
}

/// One file attached to an email (by its place among the email's attachments): its name, type and bytes.
pub fn attachment(raw: &[u8], pos: usize) -> Option<(String, String, Vec<u8>)> {
    use mail_parser::MimeHeaders;
    let m = mail_parser::MessageParser::default().parse(raw)?;
    let p = m.parts.get(*m.attachments.get(pos)? as usize)?;
    let mime = if p.is_message() { "message/rfc822".to_string() } else { p.content_type().map(|c| format!("{}/{}", c.ctype(), c.subtype().unwrap_or("octet-stream"))).unwrap_or_else(|| "application/octet-stream".into()) };
    Some((file_name(p), mime, p.contents().to_vec()))
}

/// Where List-Unsubscribe points: a web address (https) and an email address (mailto), either may be missing.
pub fn unsubscribe_targets(header: &str) -> (Option<String>, Option<String>) {
    let mut web = None;
    let mut mail = None;
    for part in header.split(',') {
        let u = part.trim().trim_start_matches('<').trim_end_matches('>').trim();
        if web.is_none() && u.starts_with("https://") {
            web = Some(u.to_string());
        } else if mail.is_none() && u.to_ascii_lowercase().starts_with("mailto:") {
            mail = Some(u.to_string());
        }
    }
    (web, mail)
}

/// Plain text without tags, quoted replies or runs of spaces (for the line under a title).
fn squash(s: &str) -> String {
    static TAGS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let tags = TAGS.get_or_init(|| {
        regex::Regex::new(r#"(?is)<style\b.*?</style>|<script\b.*?</script>|<title\b.*?</title>|<!--.*?-->|<(?:br|/p|/div|/li|/tr|/h[1-6]|blockquote)\b(?:[^>"']|"[^"]*"|'[^']*')*>|<(?:[^>"']|"[^"]*"|'[^']*')*>"#).unwrap()
    });
    // a tag that ends a line (a paragraph, a line break, a quote) becomes a line break, so "On … wrote:" is a line of its own
    let plain = tags.replace_all(s, |c: &regex::Captures| {
        let t = c[0].to_ascii_lowercase();
        if t.starts_with("<br") || t.starts_with("</p") || t.starts_with("</div") || t.starts_with("</li") || t.starts_with("</tr") || t.starts_with("</h") || t.starts_with("<blockquote") { "\n" } else { " " }
    });
    let plain = html_escape::decode_html_entities(&plain).to_string();
    let mut kept = Vec::new();
    let lines: Vec<&str> = plain.lines().collect();
    for (k, l) in lines.iter().enumerate() {
        let t = l.trim();
        // the email being answered starts here ("On Tue, Nov 17, Sam wrote:" / "-----Original Message-----" /
        // Outlook's "From: … Sent: …" block)
        let outlook = t.starts_with("From:") && lines.iter().skip(k + 1).take(3).any(|n| n.trim_start().starts_with("Sent:") || n.trim_start().starts_with("Date:"));
        let phone_sig = t.starts_with("Sent from my ") && t.len() < 40;
        if (t.starts_with("On ") && t.ends_with("wrote:")) || t.contains("Original Message-----") || t == "--" || outlook || phone_sig {
            break;
        }
        if !t.starts_with('>') {
            kept.push(*l);
        }
    }
    preview_tidy(&kept.join(" "))
}

/// Text for the line under a subject: no invisible spacer characters (newsletters pad their preview line with
/// them), no "[image: …]" stand-ins, no "View this email in your browser" and no bare web addresses.
fn preview_tidy(s: &str) -> String {
    static JUNK: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let junk = JUNK.get_or_init(|| {
        // "View this email in your browser", "Read it online", or a bare "View online" at the very start; not "ready to view online"
        regex::Regex::new(r"(?i)\[image:[^\]]*\]|\b(view|read|open) (this|the|it|our) ?(email|post|newsletter|message|issue)? ?(online|on the web|in (your |a |the )?(web )?browser)\b( at)?:?|^\s*(view|read|open) (online|on the web|in (your |a |the )?(web )?browser)\b:?|<?https?://\S+>?").unwrap()
    });
    let visible: String = s.chars().filter(|c| !matches!(c, '\u{200b}'..='\u{200f}' | '\u{2060}'..='\u{2064}' | '\u{034f}' | '\u{00ad}' | '\u{feff}' | '\u{180e}')).collect();
    let words = junk.replace_all(&visible, " ").split_whitespace().collect::<Vec<_>>().join(" ");
    words.trim_start_matches(|c: char| c == '|' || c == '-' || c == '·' || c.is_whitespace()).to_string()
}

/// The hidden preview line at the top of a newsletter (shown by mail apps under the subject, never in the email).
fn preheader(html: &str) -> String {
    static PRE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pre = PRE.get_or_init(|| {
        regex::Regex::new(r#"(?is)<(div|span|p|td)\b[^>]*\bstyle\s*=\s*["'][^"']*(display\s*:\s*none|max-height\s*:\s*0|mso-hide\s*:\s*all)[^"']*["'][^>]*>(.*?)</(div|span|p|td)>"#).unwrap()
    });
    let Some(c) = pre.captures(html) else { return String::new() };
    let inner = regex::Regex::new(r"<[^>]+>").unwrap().replace_all(&c[3], " ").to_string();
    preview_tidy(&html_escape::decode_html_entities(&inner).replace('\u{a0}', " "))
}

/// What the email shows: its HTML (or its text made into paragraphs), every part of it in order (Apple Mail
/// sends a message with a picture in the middle as text, picture, text), pictures sent in the email itself put
/// where they belong, and a list of the files attached at the end.
fn body(m: &mail_parser::Message) -> String {
    use base64::Engine;
    use mail_parser::{MimeHeaders, PartType};
    const PICTURE_MAX: usize = 4 * 1024 * 1024;
    let picture = |p: &mail_parser::MessagePart| -> Option<String> {
        let ct = p.content_type()?;
        let sub = ct.subtype().unwrap_or("").to_ascii_lowercase();
        if !ct.ctype().eq_ignore_ascii_case("image") || !matches!(sub.as_str(), "png" | "jpeg" | "jpg" | "gif" | "webp" | "heic" | "heif" | "bmp") {
            return None;
        }
        let b = p.contents();
        (!b.is_empty() && b.len() <= PICTURE_MAX).then(|| format!("data:image/{sub};base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
    };
    let name = |p: &mail_parser::MessagePart| -> String { file_name(p) };
    let img = |src: &str, alt: &str| format!(r#"<p><img src="{src}" alt="{}"></p>"#, html_escape::encode_double_quoted_attribute(alt));
    let mut shown: HashSet<usize> = HashSet::new();
    let rich = m.html_body.iter().any(|&i| m.parts.get(i as usize).map(|p| p.is_text_html()).unwrap_or(false));
    let ids = if rich { &m.html_body } else { &m.text_body };
    let mut html = String::new();
    for &i in ids {
        let Some(p) = m.parts.get(i as usize) else { continue };
        match &p.body {
            PartType::Html(h) => html.push_str(h),
            // mail-parser makes HTML out of a text-only part too; use our own paragraphs for those
            PartType::Text(t) => html.push_str(&text_to_html(t)),
            _ => {
                if let Some(src) = picture(p) {
                    html.push_str(&img(&src, &name(p)));
                    shown.insert(i as usize);
                }
            }
        }
        html.push('\n');
    }
    // <img src="cid:…">: a picture sent along with the email
    if html.to_ascii_lowercase().contains("cid:") {
        for (i, p) in m.parts.iter().enumerate() {
            let Some(id) = p.content_id().map(|c| c.trim().trim_start_matches('<').trim_end_matches('>').to_string()).filter(|c| !c.is_empty()) else { continue };
            let pat = regex::Regex::new(&format!(r#"(?i)cid:{}"#, regex::escape(&id))).unwrap();
            if !pat.is_match(&html) {
                continue;
            }
            if let Some(src) = picture(p) {
                html = pat.replace_all(&html, regex::NoExpand(&src)).into_owned();
                shown.insert(i);
            }
        }
    }
    // Files attached: pictures are shown, anything else is listed (the app doesn't keep attachments)
    let mut files = vec![];
    for (pos, &i) in m.attachments.iter().enumerate() {
        let i = i as usize;
        let Some(p) = m.parts.get(i) else { continue };
        if shown.contains(&i) || p.is_multipart() || not_a_file(m, p) {
            continue;
        }
        if let Some(src) = picture(p) {
            html.push_str(&img(&src, &name(p)));
            continue;
        }
        let kb = p.len().div_ceil(1024);
        let size = if kb >= 1024 { format!("{:.1} MB", kb as f64 / 1024.0) } else { format!("{kb} KB") };
        files.push(format!(r#"<li><span data-rr-file="{pos}">{}</span> <small>({size})</small></li>"#, html_escape::encode_text(&name(p))));
    }
    if !files.is_empty() {
        html.push_str(&format!(
            r#"<div data-rr-att="1"><p><b>{}</b></p><ul>{}</ul></div>"#,
            if files.len() == 1 { "1 file attached" } else { "Files attached" },
            files.join("")
        ));
    }
    html
}

pub fn text_to_html(text: &str) -> String {
    static LINK: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let link = LINK.get_or_init(|| regex::Regex::new(r#"https?://[^\s<]+[^\s<.,;:!?)\]'"]"#).unwrap());
    let esc = html_escape::encode_text(text).replace("\r\n", "\n");
    let linked = link.replace_all(&esc, |c: &regex::Captures| format!(r#"<a href="{0}">{0}</a>"#, &c[0]));
    let mut sig = false;
    linked
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .map(|p| {
            let p = p.trim_matches('\n');
            let lines: Vec<&str> = p.lines().collect();
            // "> " lines are the email being answered: a quote, not this email's own words
            if lines.iter().all(|l| l.trim_start().starts_with("&gt;")) {
                let inner = lines.iter().map(|l| l.trim_start().trim_start_matches("&gt;").trim_start()).collect::<Vec<_>>().join("<br>");
                return format!("<blockquote><p>{inner}</p></blockquote>");
            }
            // "-- " on its own line starts the signature
            if lines.first().map(|l| l.trim_end() == "--").unwrap_or(false) {
                sig = true;
            }
            let attr = if sig { " data-rr-sig=\"1\"" } else { "" };
            format!("<p{attr}>{}</p>", p.trim().replace('\n', "<br>"))
        })
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
    if is_local(&a.imap_host) {
        return None;
    }
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
    /// More people, comma-separated (Reply All)
    pub cc: &'a str,
    pub subject: &'a str,
    pub body: &'a str,
    pub in_reply_to: &'a str,
    pub references: &'a str,
    /// Files to attach: name, type, bytes
    pub files: &'a [(String, String, Vec<u8>)],
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
    let cc = cc_list(o.cc);
    if !cc.is_empty() {
        m += &format!("Cc: {}\r\n", cc.iter().map(|c| format!("<{c}>")).collect::<Vec<_>>().join(", "));
    }
    if !o.in_reply_to.is_empty() {
        m += &format!("In-Reply-To: {}\r\n", angle(o.in_reply_to));
        let refs: Vec<String> = o.references.split_whitespace().chain([o.in_reply_to]).map(angle).collect();
        m += &format!("References: {}\r\n", refs.join(" "));
    }
    let lines = |b: &[u8]| -> String {
        let b64 = base64::engine::general_purpose::STANDARD.encode(b);
        b64.as_bytes().chunks(76).map(|c| format!("{}\r\n", std::str::from_utf8(c).unwrap_or(""))).collect()
    };
    let text = o.body.replace("\r\n", "\n").replace('\n', "\r\n");
    m += "MIME-Version: 1.0\r\nX-Mailer: The Reading Room\r\n";
    if o.files.is_empty() {
        m += "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
        m += &lines(text.as_bytes());
        return m;
    }
    // with files: the words first, then each file (names in RFC 2231 form, so any language works)
    let boundary = format!("rr-{id}");
    m += &format!("Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n");
    m += &format!("--{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n");
    m += &lines(text.as_bytes());
    for (name, mime, bytes) in o.files {
        let safe: String = name.chars().filter(|c| !c.is_control() && !matches!(c, '"' | '\\' | '/')).collect();
        let enc: String = url::form_urlencoded::byte_serialize(safe.as_bytes()).collect::<String>().replace('+', "%20");
        let mime = if mime.contains('/') && !mime.contains(['\r', '\n', ';']) { mime.as_str() } else { "application/octet-stream" };
        m += &format!(
            "--{boundary}\r\nContent-Type: {mime}; name=\"{}\"\r\nContent-Disposition: attachment; filename*=UTF-8''{enc}\r\nContent-Transfer-Encoding: base64\r\n\r\n",
            header_text(&safe)
        );
        m += &lines(bytes);
    }
    m += &format!("--{boundary}--\r\n");
    m
}

struct Smtp<S> {
    io: BufReader<S>,
}

impl<S: AsyncRead + AsyncWrite + Unpin> Smtp<S> {
    async fn reply(&mut self) -> Result<(u16, String), String> {
        self.reply_within(WAIT).await
    }
    async fn reply_within(&mut self, wait: Duration) -> Result<(u16, String), String> {
        let mut all = String::new();
        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(wait, self.io.read_line(&mut line))
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
    async fn sign_in(&mut self, a: &Account) -> Result<(), String> {
        use base64::Engine;
        let host = format!("EHLO {}", a.domain());
        self.cmd(&host, 250, "The mail server didn't say hello").await?;
        let auth = base64::engine::general_purpose::STANDARD.encode(format!("\0{}\0{}", a.address, a.password));
        self.cmd(&format!("AUTH PLAIN {auth}"), 235, "The mail server didn't accept the address and password for sending").await?;
        Ok(())
    }
    async fn send(&mut self, a: &Account, to: &[String], msg: &str) -> Result<(), String> {
        self.sign_in(a).await?;
        self.cmd(&format!("MAIL FROM:<{}>", a.address), 250, "The mail server wouldn't send from this address").await?;
        for t in to {
            self.cmd(&format!("RCPT TO:<{}>", t.trim()), 250, &format!("The mail server wouldn't send to {}", t.trim())).await?;
        }
        self.cmd("DATA", 354, "The mail server wouldn't take the email").await?;
        // A line starting with a dot gets a second one, so it isn't read as the end
        let stuffed: String = msg.split("\r\n").map(|l| if l.starts_with('.') { format!(".{l}") } else { l.to_string() }).collect::<Vec<_>>().join("\r\n");
        let body = format!("{}\r\n.\r\n", stuffed.trim_end_matches("\r\n"));
        // The server answers once it has taken the email on. Proton Mail Bridge encrypts and hands it
        // to Proton first, which can take a while: wait up to two minutes.
        self.io.get_mut().write_all(body.as_bytes()).await.map_err(|e| format!("Lost the connection to the mail server ({e})."))?;
        self.io.get_mut().flush().await.map_err(|e| e.to_string())?;
        let (code, text) = self.reply_within(Duration::from_secs(120)).await.map_err(|_| {
            "The mail server took too long to confirm the email. It may have been sent anyway: look in your Sent folder before sending it again.".to_string()
        })?;
        if code / 100 != 2 {
            let said = text.lines().last().unwrap_or("").get(4..).unwrap_or("").trim().to_string();
            return Err(format!("The mail server didn't send the email ({code} {said})"));
        }
        let _ = self.cmd("QUIT", 221, "").await;
        Ok(())
    }
}

/// The address alone, from the ways feeds and people write one: "name@site.com (Name)",
/// "Name <name@site.com>", "mailto:name@site.com".
pub fn plain_address(s: &str) -> Option<String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r#"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#).unwrap());
    let s = s.trim().trim_start_matches("mailto:");
    let found: Vec<&str> = re.find_iter(s).map(|m| m.as_str()).collect();
    match found.as_slice() {
        [one] => Some(one.trim_end_matches('.').to_string()),
        _ => None, // none, or more than one
    }
}

/// The addresses in a comma-separated list (each checked like a single address).
pub fn cc_list(s: &str) -> Vec<String> {
    s.split(',').filter_map(plain_address).collect()
}

/// Send over SMTP: port 465 is secure from the start, other ports (587) switch to secure with STARTTLS.
pub async fn send(a: &Account, o: &Outgoing<'_>) -> Result<String, String> {
    let to = plain_address(o.to).ok_or("Enter one email address to send to.")?;
    let o = &Outgoing { to: &to, ..*o };
    let msg = compose(a, o);
    let mut all = vec![to.clone()];
    all.extend(cc_list(o.cc));
    let mut s = smtp_open(a).await?;
    s.send(a, &all, &msg).await?;
    Ok(msg)
}

/// Open SMTP, ready for EHLO over a secure connection. Port 465 is usually secure from the start and
/// 587 starts plain and switches with STARTTLS, but Proton Mail Bridge uses 1025 either way (SSL is
/// Bridge 3's setting), so if the first way doesn't work the other is tried.
async fn smtp_open(a: &Account) -> Result<Smtp<TlsStream<TcpStream>>, String> {
    let implicit_first = a.smtp_port == 465;
    let first = if implicit_first { smtp_implicit(a).await } else { smtp_starttls(a).await };
    let why = match first {
        Opened::Ready(s) => return Ok(s),
        Opened::Failed(e) => return Err(e),
        Opened::OtherWay(e) => e,
    };
    match if implicit_first { smtp_starttls(a).await } else { smtp_implicit(a).await } {
        Opened::Ready(s) => Ok(s),
        Opened::Failed(e) | Opened::OtherWay(e) => Err(if is_local(&a.smtp_host) {
            format!("Couldn't start sending through Proton Mail Bridge ({why}; then: {e}). Check Bridge is open and signed in, and that the SMTP port matches Mailbox details.")
        } else if implicit_first { why } else { e }),
    }
}

async fn smtp_implicit(a: &Account) -> Opened<Smtp<TlsStream<TcpStream>>> {
    let raw = match tcp(&a.smtp_host, a.smtp_port).await { Ok(r) => r, Err(e) => return Opened::Failed(e) };
    let t = match secure(&a.smtp_host, raw).await { Ok(t) => t, Err(e) => return Opened::OtherWay(e) };
    let mut s = Smtp { io: BufReader::new(t) };
    match s.reply().await {
        Ok((220, _)) => Opened::Ready(s),
        Ok((code, text)) => Opened::Failed(format!("The mail server didn't say hello ({code} {})", text.lines().last().unwrap_or("").get(4..).unwrap_or("").trim())),
        Err(e) => Opened::Failed(e),
    }
}

async fn smtp_starttls(a: &Account) -> Opened<Smtp<TlsStream<TcpStream>>> {
    let raw = match tcp(&a.smtp_host, a.smtp_port).await { Ok(r) => r, Err(e) => return Opened::Failed(e) };
    let mut plain = Smtp { io: BufReader::new(raw) };
    // A server that's secure from the start says nothing until the handshake: don't wait long.
    match plain.reply_within(quick(&a.smtp_host)).await {
        Ok((220, _)) => {}
        Ok(_) => return Opened::OtherWay("The mail server didn't greet like a mail server".into()),
        Err(e) => return Opened::OtherWay(e),
    }
    if let Err(e) = plain.cmd(&format!("EHLO {}", a.domain()), 250, "The mail server didn't say hello").await {
        return Opened::Failed(e);
    }
    if let Err(e) = plain.cmd("STARTTLS", 220, "The mail server wouldn't make a secure connection").await {
        return Opened::Failed(e);
    }
    match secure(&a.smtp_host, plain.io.into_inner()).await {
        Ok(t) => Opened::Ready(Smtp { io: BufReader::new(t) }),
        Err(e) => Opened::Failed(e),
    }
}

/// File a sent reply in the mailbox's Sent folder, as Mail does (best effort).
pub async fn file_sent(a: &Account, msg: &str) {
    if is_local(&a.imap_host) {
        return; // Proton puts what Bridge sends in Sent by itself
    }
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
    fn keeps_every_part_pictures_and_files() {
        // Apple Mail: text, a picture, more text; and a PDF
        let raw = b"From: a@b.c\r\nSubject: Photo\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<div>Before</div>\r\n--x\r\nContent-Type: image/png\r\nContent-Disposition: inline; filename=a.png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--x\r\nContent-Type: text/html\r\n\r\n<div>After</div>\r\n--x\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=hours.pdf\r\n\r\n%PDF\r\n--x--\r\n";
        let m = parse(raw, "1:7").unwrap();
        let (b, p, a) = (m.html.find("Before").unwrap(), m.html.find("data:image/png;base64,").unwrap(), m.html.find("After").unwrap());
        assert!(b < p && p < a, "{}", m.html);
        assert!(m.html.contains("data-rr-att") && m.html.contains("hours.pdf"), "{}", m.html);
        let clean = crate::article::clean_mail(&m.html);
        assert!(clean.contains(r#"src="data:image/png;base64,"#) && clean.contains("After") && clean.contains("data-rr-att"), "{clean}");
    }

    #[test]
    fn shows_pictures_sent_with_the_email() {
        let raw = b"From: a@b.c\r\nSubject: Sunset\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<html><head><title>Sunset</title></head><body><p>Look!</p><img src=\"cid:sun@x\"></body></html>\r\n--x\r\nContent-Type: image/jpeg\r\nContent-ID: <sun@x>\r\nContent-Transfer-Encoding: base64\r\n\r\n/9j/4AAQ\r\n--x--\r\n";
        let m = parse(raw, "1:8").unwrap();
        let clean = crate::article::clean_mail(&m.html);
        assert!(clean.contains(r#"<img src="data:image/jpeg;base64,"#), "{clean}");
        assert!(!clean.contains("Sunset"), "the title isn't part of the email: {clean}");
        // data: never survives as a link
        assert!(!crate::article::clean_mail(r#"<a href="data:text/html,hi">x</a>"#).contains("data:"));
    }

    #[test]
    fn previews_read_well() {
        let raw = "From: n@x.c\r\nSubject: News\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<div style=\"display:none;max-height:0\">Why I quit the algorithm and read blogs&nbsp;\u{34f}\u{200c}&nbsp;\u{34f}\u{200c}</div><p><a href=\"https://x.c/p\">View in browser</a></p><p>Hello</p>";
        assert_eq!(parse(raw.as_bytes(), "1:9").unwrap().summary, "Why I quit the algorithm and read blogs");
        let raw = b"From: a@b.c\r\nSubject: Re\r\nContent-Type: text/plain\r\n\r\nYes, Saturday works.\r\n\r\nFrom: David <d@x.c>\r\nSent: Friday\r\nTo: Lee\r\n\r\nAre you coming?\r\n";
        assert_eq!(parse(raw, "1:10").unwrap().summary, "Yes, Saturday works.");
        let raw = b"From: a@b.c\r\nSubject: Hi\r\nContent-Type: text/plain\r\n\r\nView this post on the web at https://x.substack.com/p/a\r\n\r\nHello friends [image: photo.jpg] here.\r\n";
        assert_eq!(parse(raw, "1:11").unwrap().summary, "Hello friends here.");
    }

    #[test]
    fn knows_newsletters_threads_and_who_else() {
        let raw = b"From: Porch <hello@porch.com>\r\nTo: me@x.com, sam@y.com\r\nCc: Lee <lee@z.com>\r\nSubject: Re: Hi\r\nMessage-ID: <c@x>\r\nReferences: <a@x> <b@x>\r\nList-Unsubscribe: <mailto:u@porch.com?subject=unsub>,\r\n <https://porch.com/u/1>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\nContent-Type: text/plain\r\n\r\nHi\r\n";
        let m = parse(raw, "1:12").unwrap();
        assert!(m.bulk && m.unsub_post);
        assert_eq!(m.thread, "a@x");
        assert_eq!(m.to, "me@x.com, sam@y.com");
        assert_eq!(m.cc, "lee@z.com");
        assert_eq!(unsubscribe_targets(&m.unsub), (Some("https://porch.com/u/1".into()), Some("mailto:u@porch.com?subject=unsub".into())));
        let raw = b"From: Sam <sam@y.com>\r\nTo: me@x.com\r\nSubject: Hi\r\nMessage-ID: <s@y>\r\nContent-Type: text/plain\r\n\r\nHi\r\n";
        let m = parse(raw, "1:13").unwrap();
        assert!(!m.bulk);
        assert_eq!(m.thread, "s@y");
    }

    #[test]
    fn hands_over_an_attached_file() {
        let raw = b"From: a@b.c\r\nSubject: Hours\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nSee attached.\r\n--x\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=\"hours/v2.pdf\"\r\n\r\n%PDF-1.4\r\n--x--\r\n";
        let m = parse(raw, "1:14").unwrap();
        assert!(m.html.contains(r#"data-rr-file="0""#), "{}", m.html);
        let (name, mime, bytes) = attachment(raw, 0).unwrap();
        assert_eq!((name.as_str(), mime.as_str()), ("hoursv2.pdf", "application/pdf"));
        assert!(bytes.starts_with(b"%PDF"));
        assert!(attachment(raw, 1).is_none());
    }

    #[test]
    fn reads_every_language() {
        // Japanese mail is often sent as ISO-2022-JP
        let raw = b"From: =?ISO-2022-JP?b?GyRCOzNFRBsoQiAbJEJCQE86GyhC?= <taro@example.jp>\r\nSubject: =?ISO-2022-JP?b?GyRCJVYlbSUwJEskRCQkJEYbKEI=?=\r\nContent-Type: text/plain; charset=\"iso-2022-jp\"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n\x1b$B$3$s$K$A$O\x1b(B\r\n";
        let m = parse(raw, "1:20").unwrap();
        assert_eq!(m.subject, "\u{30d6}\u{30ed}\u{30b0}\u{306b}\u{3064}\u{3044}\u{3066}", "{}", m.subject);
        assert_eq!(m.from_name, "\u{5c71}\u{7530} \u{592a}\u{90ce}");
        assert!(m.html.contains("\u{3053}\u{3093}\u{306b}\u{3061}\u{306f}"), "{}", m.html);
    }

    #[test]
    fn lists_only_real_files() {
        // a signed email: the signature isn't a file for you
        let raw = b"From: a@b.c\r\nSubject: Statement\r\nMIME-Version: 1.0\r\nContent-Type: multipart/signed; protocol=\"application/pkcs7-signature\"; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nYour statement is ready to view online.\r\n--x\r\nContent-Type: application/pkcs7-signature; name=smime.p7s\r\nContent-Disposition: attachment; filename=smime.p7s\r\n\r\nxx\r\n--x--\r\n";
        let m = parse(raw, "1:21").unwrap();
        assert!(!m.html.contains("data-rr-att"), "{}", m.html);
        assert_eq!(m.summary, "Your statement is ready to view online.");
        // an invitation: listed once, as invite.ics; a file with no name still gets an extension
        let raw = b"From: a@b.c\r\nSubject: Invite\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: multipart/alternative; boundary=y\r\n\r\n--y\r\nContent-Type: text/plain\r\n\r\nYou're invited.\r\n--y\r\nContent-Type: text/calendar; method=REQUEST\r\n\r\nBEGIN:VCALENDAR\r\n--y--\r\n--x\r\nContent-Type: application/ics; name=invite.ics\r\nContent-Disposition: attachment; filename=invite.ics\r\n\r\nBEGIN:VCALENDAR\r\n--x\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment\r\n\r\n%PDF\r\n--x--\r\n";
        let m = parse(raw, "1:22").unwrap();
        assert_eq!(m.html.matches("invite.ics").count(), 1, "{}", m.html);
        assert!(m.html.contains("Attachment.pdf"), "{}", m.html);
    }

    #[test]
    fn previews_leave_out_code_and_quotes() {
        let raw = b"From: x@y.z\r\nSubject: Won\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script><p>Hi <a href=\"data:text/html,<script>alert(6)</script>\">there</a></p>";
        assert_eq!(parse(raw, "1:23").unwrap().summary, "Hi there");
        let raw = b"From: m@icloud.com\r\nSubject: Re: Dinner\r\nContent-Type: text/html\r\n\r\nSounds good!<br><br><div>Sent from my iPhone</div><div><br><blockquote type=\"cite\">On Nov 21, 2026, at 7:02 PM, David wrote:<br></blockquote></div><blockquote>Dinner?</blockquote>";
        assert_eq!(parse(raw, "1:24").unwrap().summary, "Sounds good!");
    }

    #[test]
    fn finds_a_newsletters_site() {
        let html = r#"<p><a href="https://slowweb.substack.com/p/week-47?utm_source=email">View in browser</a></p><a href="https://eotrx.substackcdn.com/open?x">x</a><a href="https://slowweb.substack.com/p/week-47/comments">Leave a comment</a><a href="https://slowweb.substack.com/action/disable_email">Unsubscribe</a>"#;
        assert_eq!(newsletter_sites(html, "janedoe@substack.com"), vec!["slowweb.substack.com/feed", "slowweb.substack.com"]);
        let html = r#"<a href="https://porchletter.us1.list-manage.com/track/click?u=1">Read</a><a href="https://www.porchletter.com/47">Read the full letter</a><a href="https://www.instagram.com/porch">IG</a>"#;
        assert_eq!(newsletter_sites(html, "hello@news.porchletter.com"), vec!["porchletter.com"]);
        assert!(newsletter_sites("<p>Hi</p>", "sam@gmail.com").is_empty());
    }

    #[test]
    fn sends_files() {
        let a = Account { address: "reading@daviddaniels.com".into(), ..Default::default() };
        let files = vec![("Café menu.pdf".to_string(), "application/pdf".to_string(), b"%PDF-1.4".to_vec())];
        let m = compose(&a, &Outgoing { to: "a@b.c", cc: "", subject: "Menu", body: "Here it is.", in_reply_to: "", references: "", files: &files });
        assert!(m.contains("Content-Type: multipart/mixed; boundary="), "{m}");
        assert!(m.contains("filename*=UTF-8''Caf%C3%A9%20menu.pdf"), "{m}");
        let back = parse(m.as_bytes(), "1:30").unwrap();
        assert!(back.html.contains("Here it is.") && back.html.contains("Café menu.pdf"), "{}", back.html);
        assert_eq!(attachment(m.as_bytes(), 0).unwrap().2, b"%PDF-1.4");
    }

    #[test]
    fn finds_the_address() {
        assert_eq!(plain_address("hello@mikebifulco.com (Mike Bifulco @irreverentmike)").as_deref(), Some("hello@mikebifulco.com"));
        assert_eq!(plain_address("Sam Rivera <sam@example.com>").as_deref(), Some("sam@example.com"));
        assert_eq!(plain_address("mailto:sam@example.com").as_deref(), Some("sam@example.com"));
        assert_eq!(plain_address("a@b.com, c@d.com"), None);
        assert_eq!(plain_address("nobody"), None);
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
        let m = compose(&a, &Outgoing { to: "hello@example.com", subject: "Re: The year", body: "Thanks!\n.\nDavid", in_reply_to: "abc@example.com", references: "<x@y>", cc: "sam@example.com, Lee <lee@example.com>", files: &[] });
        assert!(m.contains("From: David Daniels <reading@daviddaniels.com>\r\n"));
        assert!(m.contains("In-Reply-To: <abc@example.com>\r\n"));
        assert!(m.contains("References: <x@y> <abc@example.com>\r\n"));
        assert!(m.contains("Message-ID: <") && m.contains("@daviddaniels.com>"));
        assert!(m.contains("Cc: <sam@example.com>, <lee@example.com>\r\n"), "{m}");
    }
}
