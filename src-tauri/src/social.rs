//! Talking with people on Mastodon and Bluesky, from the reader.
//!
//! - Connect your own account: Bluesky with an App Password, Mastodon by approving the app on your server.
//!   What it takes to sign in is kept in the Keychain, never in the app's files or the sync folder. On Apple devices it
//!   goes in iCloud Keychain too, so connecting on one Mac, iPhone or iPad connects all of them.
//! - Post a story with your note, as a link card.
//! - Conversations: your recent link posts and the replies to them, replies and mentions, and replying back.
//! - Mute, block and report, through each network's own tools.
//!
//! The app talks straight to your Bluesky or Mastodon server; nothing passes through anyone else.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Mutex;

const SERVICE: &str = "com.daviddaniels.readingroom";
const OOB: &str = "urn:ietf:wg:oauth:2.0:oob";
const MASTO_SCOPES: &str = "read write:statuses write:media write:follows write:mutes write:blocks write:reports write:favourites";
/// Bluesky's own moderation service, which receives reports
const BSKY_MODERATION: &str = "did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler";

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(crate::feeds::client)
}

// ------------------------------------------------------------------ the Keychain

// Two copies of each sign-in:
// - this device's own Keychain (the keyring crate), as it has always been: the fallback
// - iCloud Keychain (synchronizable, data-protection keychain), so your other Apple devices get it
// Once a sign-in has been moved to iCloud Keychain, a "moved" mark is left on this device. From then on
// iCloud Keychain decides: if it no longer has the sign-in (you disconnected on another device), this
// device signs out too, rather than copying its old one back. If iCloud Keychain can't be read at all,
// the device's own copy is used, so nothing ever signs you out by surprise.

pub(crate) fn local_get(key: &str) -> Option<String> {
    keyring::Entry::new(SERVICE, key).ok()?.get_password().ok()
}

pub(crate) fn local_set(key: &str, v: &str) -> Result<(), String> {
    keyring::Entry::new(SERVICE, key)
        .and_then(|e| e.set_password(v))
        .map_err(|e| e.to_string())
}

pub(crate) fn local_delete(key: &str) {
    if let Ok(e) = keyring::Entry::new(SERVICE, key) {
        let _ = e.delete_credential();
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod icloud {
    use security_framework::passwords::{delete_generic_password_options, generic_password, set_generic_password_options, PasswordOptions};

    const NOT_FOUND: i32 = -25300; // errSecItemNotFound

    fn opts(key: &str) -> PasswordOptions {
        let mut o = PasswordOptions::new_generic_password(super::SERVICE, key);
        o.set_access_synchronized(Some(true));
        o.use_protected_keychain();
        o
    }

    /// Ok(Some) found, Ok(None) definitely not there, Err couldn't ask.
    pub fn get(key: &str) -> Result<Option<String>, ()> {
        match generic_password(opts(key)) {
            Ok(b) => Ok(String::from_utf8(b).ok()),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(_) => Err(()),
        }
    }

    pub fn set(key: &str, v: &str) -> bool {
        set_generic_password_options(v.as_bytes(), opts(key)).is_ok()
    }

    pub fn delete(key: &str) {
        let _ = delete_generic_password_options(opts(key));
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod icloud {
    pub fn get(_: &str) -> Result<Option<String>, ()> { Err(()) }
    pub fn set(_: &str, _: &str) -> bool { false }
    pub fn delete(_: &str) {}
}

fn moved_mark(key: &str) -> String {
    format!("{key}.icloud")
}

fn secret_raw(key: &str) -> Option<String> {
    let local = local_get(key);
    match icloud::get(key) {
        Ok(Some(v)) => {
            // keep this device's copy matching, so the fallback is never stale
            if local.as_deref() != Some(v.as_str()) {
                let _ = local_set(key, &v);
            }
            let _ = local_set(&moved_mark(key), "1");
            Some(v)
        }
        Ok(None) => {
            if local_get(&moved_mark(key)).is_some() {
                // it was in iCloud Keychain and has been removed there: disconnected on another device
                local_delete(key);
                local_delete(&moved_mark(key));
                None
            } else {
                // signed in before syncing existed: move it up, once
                let v = local?;
                if icloud::set(key, &v) && matches!(icloud::get(key), Ok(Some(ref back)) if *back == v) {
                    let _ = local_set(&moved_mark(key), "1");
                }
                Some(v)
            }
        }
        Err(()) => local,
    }
}

pub(crate) fn secret_get(key: &str) -> Option<Value> {
    serde_json::from_str(&secret_raw(key)?).ok()
}

pub(crate) fn secret_set(key: &str, v: &Value) -> Result<(), String> {
    let s = v.to_string();
    let here = local_set(key, &s);
    if icloud::set(key, &s) {
        let _ = local_set(&moved_mark(key), "1");
        return Ok(());
    }
    here.map_err(|e| format!("Couldn't save the sign-in to the Keychain ({e})."))
}

pub(crate) fn secret_delete(key: &str) {
    icloud::delete(key);
    local_delete(key);
    local_delete(&moved_mark(key));
}

// ------------------------------------------------------------------ small helpers

type Fail = (u16, String);

async fn call(req: reqwest::RequestBuilder) -> Result<Value, Fail> {
    let resp = req
        .timeout(Duration::from_secs(25))
        .send()
        .await
        .map_err(|_| (0, "Couldn't reach the server. Check your connection.".to_string()))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if status >= 400 {
        return Err((status, text));
    }
    Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::Null) })
}

fn with_json(req: reqwest::RequestBuilder, body: &Value) -> reqwest::RequestBuilder {
    req.header("Content-Type", "application/json").body(body.to_string())
}

/// A server's error, in words a person can use.
fn explain((status, body): Fail) -> String {
    if status == 0 {
        return body;
    }
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let said = ["message", "error_description", "error"].iter().find_map(|k| v.get(k).and_then(|x| x.as_str())).unwrap_or("");
    match status {
        401 | 403 if said.is_empty() => "The server didn't accept the sign-in. Try connecting the account again.".into(),
        429 => "The server says to slow down. Try again in a few minutes.".into(),
        _ if !said.is_empty() => format!("The server said: {said}"),
        _ => format!("The server answered with error {status}."),
    }
}

fn st(v: &Value, path: &str) -> String {
    let mut cur = v;
    for k in path.split('.') {
        cur = match cur.get(k) {
            Some(x) => x,
            None => return String::new(),
        };
    }
    match cur {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Mastodon posts come as HTML: keep the words and the paragraph breaks.
pub fn html_text(html: &str) -> String {
    let s = html.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n").replace("</p>", "\n\n");
    static TAG: OnceLock<regex::Regex> = OnceLock::new();
    let s = TAG.get_or_init(|| regex::Regex::new(r"(?s)<[^>]*>").unwrap()).replace_all(&s, "");
    let s = html_escape::decode_html_entities(&s).to_string();
    s.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

/// Bluesky only makes web addresses in a post clickable if the post says where they are.
pub fn link_facets(text: &str) -> Vec<Value> {
    static URL: OnceLock<regex::Regex> = OnceLock::new();
    URL.get_or_init(|| regex::Regex::new(r#"https?://[^\s<>"]+[^\s<>".,;:!?)\]]"#).unwrap())
        .find_iter(text)
        .map(|m| {
            json!({
                "index": { "byteStart": m.start(), "byteEnd": m.end() },
                "features": [{ "$type": "app.bsky.richtext.facet#link", "uri": m.as_str() }]
            })
        })
        .collect()
}

// ------------------------------------------------------------------ what the page gets

#[derive(Serialize, Clone, Debug, Default)]
pub struct Person {
    pub id: String,
    pub handle: String,
    pub name: String,
    pub avatar: String,
    pub url: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Note {
    pub network: String,
    pub id: String,
    pub cid: String,
    pub url: String,
    pub author: Person,
    pub text: String,
    pub created_at: String,
    pub replies: i64,
    pub link: String,
    pub link_title: String,
    pub root_id: String,
    pub root_cid: String,
    pub parent_id: String,
    pub parent_cid: String,
    pub depth: usize,
    pub kind: String,
    pub link_description: String,
    pub image: String,
    pub likes: i64,
    pub reposts: i64,
    /// Who reposted or boosted it into your timeline, if that's how it arrived
    pub via: String,
}

// ------------------------------------------------------------------ Bluesky

#[derive(Clone)]
struct Bsky {
    pds: String,
    did: String,
    handle: String,
    jwt: String,
}

fn bsky_slot() -> &'static Mutex<Option<Bsky>> {
    static S: OnceLock<Mutex<Option<Bsky>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

/// A handle or DID → the account's DID and the server (PDS) that holds it.
async fn bsky_resolve(who: &str) -> Result<(String, String), String> {
    let who = who.trim().trim_start_matches('@').to_lowercase();
    let did = if who.starts_with("did:") {
        who.clone()
    } else {
        let v = call(client().get("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle").query(&[("handle", &who)]))
            .await
            .map_err(|_| format!("Couldn't find the Bluesky account {who}. Check the handle, like name.bsky.social."))?;
        st(&v, "did")
    };
    let doc_url = if let Some(host) = did.strip_prefix("did:web:") {
        format!("https://{host}/.well-known/did.json")
    } else {
        format!("https://plc.directory/{did}")
    };
    let doc = call(client().get(&doc_url)).await.map_err(|_| "Couldn't look up where that Bluesky account lives.".to_string())?;
    let pds = doc
        .get("service")
        .and_then(|s| s.as_array())
        .and_then(|a| a.iter().find(|x| st(x, "id").ends_with("#atproto_pds")))
        .map(|x| st(x, "serviceEndpoint"))
        .filter(|s| s.starts_with("https://"))
        .ok_or("That Bluesky account doesn't say which server holds it.")?;
    Ok((did, pds.trim_end_matches('/').to_string()))
}

async fn bsky_login(handle: &str, password: &str) -> Result<Bsky, String> {
    let (did, pds) = bsky_resolve(handle).await?;
    let v = call(with_json(
        client().post(format!("{pds}/xrpc/com.atproto.server.createSession")),
        &json!({ "identifier": did, "password": password }),
    ))
    .await
    .map_err(|e| {
        if e.0 == 401 {
            "Bluesky didn't accept that App Password. Make a new one in Bluesky under Settings › Privacy and security › App passwords.".to_string()
        } else {
            explain(e)
        }
    })?;
    Ok(Bsky { pds, did: st(&v, "did"), handle: st(&v, "handle"), jwt: st(&v, "accessJwt") })
}

async fn bsky_session(fresh: bool) -> Result<Bsky, String> {
    let mut slot = bsky_slot().lock().await;
    if !fresh {
        if let Some(s) = slot.as_ref() {
            return Ok(s.clone());
        }
    }
    let saved = secret_get("bluesky").ok_or("Connect your Bluesky account first.")?;
    let s = bsky_login(&st(&saved, "did"), &st(&saved, "password")).await?;
    *slot = Some(s.clone());
    Ok(s)
}

/// One Bluesky request, signing in again once if the session ran out.
async fn bsky(get: bool, nsid: &str, query: &[(&str, String)], body: Option<Value>) -> Result<Value, String> {
    for attempt in 0..2 {
        let s = bsky_session(attempt == 1).await?;
        let url = format!("{}/xrpc/{nsid}", s.pds);
        let mut req = if get { client().get(&url).query(query) } else { client().post(&url) };
        req = req.bearer_auth(&s.jwt);
        if nsid == "com.atproto.moderation.createReport" {
            req = req.header("atproto-proxy", BSKY_MODERATION);
        }
        if let Some(b) = &body {
            req = with_json(req, b);
        }
        match call(req).await {
            Ok(v) => return Ok(v),
            Err((code, body)) if attempt == 0 && (code == 401 || body.contains("ExpiredToken") || body.contains("InvalidToken")) => continue,
            Err(e) => return Err(explain(e)),
        }
    }
    Err("Bluesky wouldn't keep you signed in. Try connecting the account again.".into())
}

fn bsky_person(a: &Value) -> Person {
    let handle = st(a, "handle");
    Person {
        id: st(a, "did"),
        name: Some(st(a, "displayName")).filter(|n| !n.trim().is_empty()).unwrap_or_else(|| handle.clone()),
        avatar: st(a, "avatar"),
        url: format!("https://bsky.app/profile/{handle}"),
        handle: format!("@{handle}"),
    }
}

fn bsky_web_url(uri: &str, handle: &str) -> String {
    let rkey = uri.rsplit('/').next().unwrap_or("");
    format!("https://bsky.app/profile/{}/post/{rkey}", handle.trim_start_matches('@'))
}

fn bsky_note(post: &Value, kind: &str) -> Note {
    let author = bsky_person(&post["author"]);
    let rec = &post["record"];
    let uri = st(post, "uri");
    Note {
        network: "bluesky".into(),
        url: bsky_web_url(&uri, &author.handle),
        id: uri,
        cid: st(post, "cid"),
        text: st(rec, "text"),
        created_at: st(rec, "createdAt"),
        replies: post.get("replyCount").and_then(|x| x.as_i64()).unwrap_or(0),
        likes: post.get("likeCount").and_then(|x| x.as_i64()).unwrap_or(0),
        reposts: post.get("repostCount").and_then(|x| x.as_i64()).unwrap_or(0),
        link: Some(st(post, "embed.external.uri")).filter(|x| !x.is_empty()).unwrap_or_else(|| st(post, "embed.media.external.uri")),
        link_title: Some(st(post, "embed.external.title")).filter(|x| !x.is_empty()).unwrap_or_else(|| st(post, "embed.media.external.title")),
        link_description: Some(st(post, "embed.external.description")).filter(|x| !x.is_empty()).unwrap_or_else(|| st(post, "embed.media.external.description")),
        image: Some(st(post, "embed.external.thumb")).filter(|x| !x.is_empty()).unwrap_or_else(|| st(post, "embed.media.external.thumb")),
        root_id: st(rec, "reply.root.uri"),
        root_cid: st(rec, "reply.root.cid"),
        parent_id: st(rec, "reply.parent.uri"),
        parent_cid: st(rec, "reply.parent.cid"),
        author,
        kind: kind.into(),
        ..Default::default()
    }
}

async fn bsky_post(text: &str, link: &str, title: &str, description: &str, image: &str) -> Result<String, String> {
    let s = bsky_session(false).await?;
    if link.is_empty() {
        if text.is_empty() {
            return Err("Write something first.".into());
        }
        let mut record = json!({ "$type": "app.bsky.feed.post", "text": text, "langs": ["en"],
            "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string() });
        let facets = link_facets(text);
        if !facets.is_empty() {
            record["facets"] = Value::Array(facets);
        }
        let v = bsky(false, "com.atproto.repo.createRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.feed.post", "record": record }))).await?;
        return Ok(bsky_web_url(&st(&v, "uri"), &s.handle));
    }
    let mut external = json!({ "uri": link, "title": title, "description": description });
    // The story's picture on the card (Bluesky takes pictures up to about 1 MB)
    if image.starts_with("http") {
        if let Ok(resp) = client().get(image).timeout(Duration::from_secs(15)).send().await {
            let ctype = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").to_string();
            if ctype.starts_with("image/") {
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() && bytes.len() < 950_000 {
                        let up = client()
                            .post(format!("{}/xrpc/com.atproto.repo.uploadBlob", s.pds))
                            .bearer_auth(&s.jwt)
                            .header("Content-Type", ctype)
                            .body(bytes.to_vec());
                        if let Ok(v) = call(up).await {
                            external["thumb"] = v["blob"].clone();
                        }
                    }
                }
            }
        }
    }
    let mut record = json!({
        "$type": "app.bsky.feed.post",
        "text": text,
        "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        "embed": { "$type": "app.bsky.embed.external", "external": external },
        "langs": ["en"],
    });
    let facets = link_facets(text);
    if !facets.is_empty() {
        record["facets"] = Value::Array(facets);
    }
    let v = bsky(false, "com.atproto.repo.createRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.feed.post", "record": record }))).await?;
    Ok(bsky_web_url(&st(&v, "uri"), &s.handle))
}

// ------------------------------------------------------------------ Mastodon

fn masto_saved() -> Result<Value, String> {
    secret_get("mastodon").ok_or_else(|| "Connect your Mastodon account first.".to_string())
}

async fn masto(method: reqwest::Method, path: &str, query: &[(&str, String)], body: Option<Value>) -> Result<Value, String> {
    let m = masto_saved()?;
    let mut req = client().request(method, format!("https://{}{path}", st(&m, "instance"))).query(query).bearer_auth(st(&m, "token"));
    if let Some(b) = &body {
        req = with_json(req, b);
    }
    call(req).await.map_err(|e| {
        if e.0 == 401 { "Your Mastodon server signed the app out. Connect the account again.".to_string() } else { explain(e) }
    })
}

/// One page of a Mastodon list, and the max_id for the next page (from the Link header), if there's more.
async fn masto_page(path: &str, query: &[(&str, String)]) -> Result<(Value, Option<String>), String> {
    let m = masto_saved()?;
    let resp = client().get(format!("https://{}{path}", st(&m, "instance"))).query(query).bearer_auth(st(&m, "token"))
        .timeout(Duration::from_secs(25)).send().await.map_err(|_| "Couldn't reach your Mastodon server.".to_string())?;
    if !resp.status().is_success() { return Err(format!("Mastodon answered {}", resp.status().as_u16())); }
    let next = resp.headers().get("link").and_then(|v| v.to_str().ok()).and_then(next_max_id);
    let v = resp.json::<Value>().await.unwrap_or(Value::Null);
    Ok((v, next))
}

/// The max_id in a Link header's rel="next" address.
fn next_max_id(link: &str) -> Option<String> {
    link.split(',').find(|p| p.contains("rel=\"next\""))
        .and_then(|p| p.split(['<', '>']).nth(1))
        .and_then(|u| url::Url::parse(u).ok())
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "max_id").map(|(_, v)| v.to_string()))
}

fn masto_person(a: &Value) -> Person {
    let acct = st(a, "acct");
    Person {
        id: st(a, "id"),
        name: Some(st(a, "display_name")).filter(|n| !n.trim().is_empty()).unwrap_or_else(|| acct.clone()),
        avatar: st(a, "avatar_static"),
        url: st(a, "url"),
        handle: format!("@{acct}"),
    }
}

fn masto_note(s: &Value, kind: &str) -> Note {
    Note {
        network: "mastodon".into(),
        id: st(s, "id"),
        url: st(s, "url"),
        author: masto_person(&s["account"]),
        text: html_text(&st(s, "content")),
        created_at: st(s, "created_at"),
        replies: s.get("replies_count").and_then(|x| x.as_i64()).unwrap_or(0),
        likes: s.get("favourites_count").and_then(|x| x.as_i64()).unwrap_or(0),
        reposts: s.get("reblogs_count").and_then(|x| x.as_i64()).unwrap_or(0),
        link: st(s, "card.url"),
        link_title: st(s, "card.title"),
        link_description: st(s, "card.description"),
        image: st(s, "card.image"),
        parent_id: st(s, "in_reply_to_id"),
        kind: kind.into(),
        ..Default::default()
    }
}

/// "mastodon.social", "https://mastodon.social/", "@me@mastodon.social" → "mastodon.social"
pub fn masto_host(input: &str) -> String {
    let t = input.trim().trim_start_matches("https://").trim_start_matches("http://");
    let t = t.split('/').next().unwrap_or("");
    let t = t.rsplit('@').next().unwrap_or(t);
    t.to_lowercase()
}

// ------------------------------------------------------------------ commands: accounts

#[derive(Serialize, Default)]
pub struct Accounts {
    bluesky: Option<Value>,
    mastodon: Option<Value>,
    /// your own WordPress site, for notes
    wordpress: Option<Value>,
}

#[tauri::command]
pub fn social_accounts() -> Accounts {
    Accounts {
        bluesky: secret_get("bluesky").map(|v| json!({ "handle": format!("@{}", st(&v, "handle")) })),
        mastodon: secret_get("mastodon").map(|v| json!({ "handle": format!("@{}@{}", st(&v, "acct"), st(&v, "instance")) })),
        wordpress: secret_get("wordpress").map(|v| json!({ "site": st(&v, "site"), "name": st(&v, "name"), "user": st(&v, "user") })),
    }
}

#[tauri::command]
pub async fn bsky_connect(handle: String, password: String) -> Result<Accounts, String> {
    let password = password.trim().to_string();
    if handle.trim().is_empty() || password.is_empty() {
        return Err("Type your Bluesky handle and an App Password.".into());
    }
    let s = bsky_login(&handle, &password).await?;
    secret_set("bluesky", &json!({ "did": s.did, "handle": s.handle, "password": password }))?;
    *bsky_slot().lock().await = Some(s);
    Ok(social_accounts())
}

fn masto_pending() -> &'static Mutex<Option<Value>> {
    static P: OnceLock<Mutex<Option<Value>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

/// Step one: register the app with your server and return the page where you approve it.
#[tauri::command]
pub async fn masto_begin(server: String) -> Result<String, String> {
    let host = masto_host(&server);
    if !host.contains('.') {
        return Err("Type your Mastodon server, like mastodon.social.".into());
    }
    let app = call(with_json(
        client().post(format!("https://{host}/api/v1/apps")),
        &json!({ "client_name": "The Reading Room", "redirect_uris": OOB, "scopes": MASTO_SCOPES, "website": "https://readingroomapp.com/" }),
    ))
    .await
    .map_err(|e| if e.0 == 0 { format!("Couldn't reach {host}. Check the server name.") } else { explain(e) })?;
    let (id, secret) = (st(&app, "client_id"), st(&app, "client_secret"));
    if id.is_empty() {
        return Err(format!("{host} didn't let the app register. It may not be a Mastodon server."));
    }
    *masto_pending().lock().await = Some(json!({ "instance": host, "client_id": id, "client_secret": secret }));
    let mut u = url::Url::parse(&format!("https://{host}/oauth/authorize")).map_err(|e| e.to_string())?;
    u.query_pairs_mut()
        .append_pair("client_id", &id)
        .append_pair("scope", MASTO_SCOPES)
        .append_pair("redirect_uri", OOB)
        .append_pair("response_type", "code");
    Ok(u.to_string())
}

/// Step two: the code your server showed after you approved the app.
#[tauri::command]
pub async fn masto_finish(code: String) -> Result<Accounts, String> {
    let p = masto_pending().lock().await.clone().ok_or("Start again: type your server and press Continue.")?;
    let host = st(&p, "instance");
    let tok = call(with_json(
        client().post(format!("https://{host}/oauth/token")),
        &json!({ "grant_type": "authorization_code", "code": code.trim(), "client_id": st(&p, "client_id"),
                 "client_secret": st(&p, "client_secret"), "redirect_uri": OOB, "scope": MASTO_SCOPES }),
    ))
    .await
    .map_err(|e| if e.0 == 400 || e.0 == 401 { "That code didn't work. Copy the whole code from the page and try again.".to_string() } else { explain(e) })?;
    let token = st(&tok, "access_token");
    let me = call(client().get(format!("https://{host}/api/v1/accounts/verify_credentials")).bearer_auth(&token)).await.map_err(explain)?;
    secret_set("mastodon", &json!({ "instance": host, "token": token, "acct": st(&me, "acct"), "id": st(&me, "id") }))?;
    *masto_pending().lock().await = None;
    Ok(social_accounts())
}

#[tauri::command]
pub async fn social_disconnect(network: String) -> Accounts {
    secret_delete(&network);
    if network == "bluesky" {
        *bsky_slot().lock().await = None;
    }
    social_accounts()
}

// ------------------------------------------------------------------ commands: posting and conversations

#[derive(Serialize)]
pub struct Posted {
    network: String,
    url: String,
    error: String,
    /// posted, but not quite as asked (a photo the server wouldn't take)
    warning: String,
}

/// Post a story with your note to the networks you chose.
#[tauri::command]
pub async fn social_post(networks: Vec<String>, text: String, link: String, title: String, description: String, image: String) -> Vec<Posted> {
    let mut out = Vec::new();
    for n in networks {
        let r = match n.as_str() {
            "bluesky" => bsky_post(text.trim(), &link, &title, &description, &image).await,
            "mastodon" => {
                let status = if link.is_empty() { text.trim().to_string() } else if text.trim().is_empty() { link.clone() } else { format!("{}\n\n{link}", text.trim()) };
                masto(reqwest::Method::POST, "/api/v1/statuses", &[], Some(json!({ "status": status, "visibility": "public" })))
                    .await
                    .map(|v| st(&v, "url"))
            }
            _ => Err("Unknown network.".into()),
        };
        out.push(match r {
            Ok(url) => Posted { network: n, url, error: String::new(), warning: String::new() },
            Err(error) => Posted { network: n, url: String::new(), error, warning: String::new() },
        });
    }
    out
}

#[derive(Serialize, Default)]
pub struct Conversations {
    posts: Vec<Note>,
    replies: Vec<Note>,
    errors: Vec<String>,
}

/// Your recent posts that share a link (with their reply counts), and replies and mentions to you.
#[tauri::command]
pub async fn social_conversations() -> Conversations {
    let mut c = Conversations::default();
    if secret_get("bluesky").is_some() {
        match bsky_conversations().await {
            Ok((p, r)) => {
                c.posts.extend(p);
                c.replies.extend(r);
            }
            Err(e) => c.errors.push(format!("Bluesky: {e}")),
        }
    }
    if secret_get("mastodon").is_some() {
        match masto_conversations().await {
            Ok((p, r)) => {
                c.posts.extend(p);
                c.replies.extend(r);
            }
            Err(e) => c.errors.push(format!("Mastodon: {e}")),
        }
    }
    c.posts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    c.replies.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    c
}

async fn bsky_conversations() -> Result<(Vec<Note>, Vec<Note>), String> {
    let s = bsky_session(false).await?;
    let feed = bsky(true, "app.bsky.feed.getAuthorFeed", &[("actor", s.did.clone()), ("filter", "posts_no_replies".into()), ("limit", "50".into())], None).await?;
    let posts = feed["feed"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|x| x.get("reason").is_none()) // not reposts
                .map(|x| bsky_note(&x["post"], "post"))
                .collect()
        })
        .unwrap_or_default();
    let notes = bsky(true, "app.bsky.notification.listNotifications", &[("limit", "50".into())], None).await?;
    let replies = notes["notifications"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|x| matches!(st(x, "reason").as_str(), "reply" | "mention" | "quote"))
                .map(|x| {
                    let post = json!({ "uri": x["uri"], "cid": x["cid"], "author": x["author"], "record": x["record"] });
                    let mut n = bsky_note(&post, &st(x, "reason"));
                    n.created_at = Some(st(x, "record.createdAt")).filter(|d| !d.is_empty()).unwrap_or_else(|| st(x, "indexedAt"));
                    n
                })
                .collect()
        })
        .unwrap_or_default();
    Ok((posts, replies))
}

async fn masto_conversations() -> Result<(Vec<Note>, Vec<Note>), String> {
    let m = masto_saved()?;
    let id = st(&m, "id");
    let list = masto(reqwest::Method::GET, &format!("/api/v1/accounts/{id}/statuses"),
        &[("exclude_replies", "true".into()), ("exclude_reblogs", "true".into()), ("limit", "40".into())], None).await?;
    let posts = list
        .as_array()
        .map(|a| {
            a.iter()
                .map(|s| masto_note(s, "post"))
                .collect()
        })
        .unwrap_or_default();
    let notes = masto(reqwest::Method::GET, "/api/v1/notifications", &[("types[]", "mention".into()), ("limit", "40".into())], None).await?;
    let replies = notes
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|x| x.get("status").is_some_and(|s| s.is_object()))
                .map(|x| masto_note(&x["status"], if st(x, "status.in_reply_to_id").is_empty() { "mention" } else { "reply" }))
                .collect()
        })
        .unwrap_or_default();
    Ok((posts, replies))
}

/// The replies under one of your posts, in conversation order, each with how deep it sits.
#[tauri::command]
pub async fn social_thread(network: String, id: String) -> Result<Vec<Note>, String> {
    if network == "bluesky" {
        let t = bsky(true, "app.bsky.feed.getPostThread", &[("uri", id.clone()), ("depth", "8".into()), ("parentHeight", "0".into())], None).await?;
        let root = &t["thread"]["post"];
        let (root_id, root_cid) = (st(root, "uri"), st(root, "cid"));
        let mut out = Vec::new();
        fn walk(node: &Value, depth: usize, root: (&str, &str), out: &mut Vec<Note>) {
            let mut kids: Vec<&Value> = node["replies"].as_array().map(|a| a.iter().filter(|r| r.get("post").is_some()).collect()).unwrap_or_default();
            kids.sort_by_key(|r| st(&r["post"], "record.createdAt"));
            for r in kids {
                let mut n = bsky_note(&r["post"], "reply");
                n.depth = depth;
                n.root_id = root.0.into();
                n.root_cid = root.1.into();
                out.push(n);
                walk(r, depth + 1, root, out);
            }
        }
        walk(&t["thread"], 1, (&root_id, &root_cid), &mut out);
        Ok(out)
    } else {
        let ctx = masto(reqwest::Method::GET, &format!("/api/v1/statuses/{id}/context"), &[], None).await?;
        let all: Vec<Note> = ctx["descendants"].as_array().map(|a| a.iter().map(|s| masto_note(s, "reply")).collect()).unwrap_or_default();
        Ok(order_thread(&id, all))
    }
}

/// The whole conversation a post belongs to, from the post that started it down through every reply,
/// yours included, in conversation order. The first note is the one that started it (depth 0).
#[tauri::command]
pub async fn social_whole(network: String, id: String, root: String) -> Result<Vec<Note>, String> {
    if network == "bluesky" {
        let top = if root.is_empty() { id.clone() } else { root };
        let t = bsky(true, "app.bsky.feed.getPostThread", &[("uri", top), ("depth", "40".into()), ("parentHeight", "0".into())], None).await?;
        let first = &t["thread"]["post"];
        if first.is_null() {
            return Err("Bluesky couldn't find that conversation. It may have been deleted.".into());
        }
        let (root_id, root_cid) = (st(first, "uri"), st(first, "cid"));
        let mut head = bsky_note(first, "post");
        head.root_id = root_id.clone();
        head.root_cid = root_cid.clone();
        let mut out = vec![head];
        fn walk(node: &Value, depth: usize, root: (&str, &str), out: &mut Vec<Note>) {
            let mut kids: Vec<&Value> = node["replies"].as_array().map(|a| a.iter().filter(|r| r.get("post").is_some()).collect()).unwrap_or_default();
            kids.sort_by_key(|r| st(&r["post"], "record.createdAt"));
            for r in kids {
                let mut n = bsky_note(&r["post"], "reply");
                n.depth = depth;
                n.root_id = root.0.into();
                n.root_cid = root.1.into();
                out.push(n);
                walk(r, depth + 1, root, out);
            }
        }
        walk(&t["thread"], 1, (&root_id, &root_cid), &mut out);
        Ok(out)
    } else {
        // find where it started, then everything under that
        let ctx = masto(reqwest::Method::GET, &format!("/api/v1/statuses/{id}/context"), &[], None).await?;
        let top_id = ctx["ancestors"].as_array().and_then(|a| a.first()).map(|s| st(s, "id")).unwrap_or_else(|| id.clone());
        let first = masto(reqwest::Method::GET, &format!("/api/v1/statuses/{top_id}"), &[], None).await?;
        let all_ctx = if top_id == id { ctx } else { masto(reqwest::Method::GET, &format!("/api/v1/statuses/{top_id}/context"), &[], None).await? };
        let all: Vec<Note> = all_ctx["descendants"].as_array().map(|a| a.iter().map(|s| masto_note(s, "reply")).collect()).unwrap_or_default();
        let mut out = vec![masto_note(&first, "post")];
        out.extend(order_thread(&top_id, all));
        Ok(out)
    }
}

/// Put replies under their parents, depth first.
pub fn order_thread(root: &str, all: Vec<Note>) -> Vec<Note> {
    fn add(parent: &str, depth: usize, all: &[Note], out: &mut Vec<Note>) {
        let mut kids: Vec<&Note> = all.iter().filter(|n| n.parent_id == parent).collect();
        kids.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        for k in kids {
            let mut n = k.clone();
            n.depth = depth;
            let id = n.id.clone();
            out.push(n);
            if depth < 12 {
                add(&id, depth + 1, all, out);
            }
        }
    }
    let mut out = Vec::new();
    add(root, 1, &all, &mut out);
    out
}

/// Answer a reply (or reply to your own post) on its network.
#[tauri::command]
pub async fn social_reply(network: String, text: String, parent_id: String, parent_cid: String, root_id: String, root_cid: String) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Write something first.".into());
    }
    if network == "bluesky" {
        let s = bsky_session(false).await?;
        let (root_id, root_cid) = if root_id.is_empty() { (parent_id.clone(), parent_cid.clone()) } else { (root_id, root_cid) };
        let mut record = json!({
            "$type": "app.bsky.feed.post", "text": text, "langs": ["en"],
            "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            "reply": { "root": { "uri": root_id, "cid": root_cid }, "parent": { "uri": parent_id, "cid": parent_cid } },
        });
        let facets = link_facets(&text);
        if !facets.is_empty() {
            record["facets"] = Value::Array(facets);
        }
        let v = bsky(false, "com.atproto.repo.createRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.feed.post", "record": record }))).await?;
        Ok(bsky_web_url(&st(&v, "uri"), &s.handle))
    } else {
        let v = masto(reqwest::Method::POST, "/api/v1/statuses", &[], Some(json!({ "status": text, "in_reply_to_id": parent_id, "visibility": "public" }))).await?;
        Ok(st(&v, "url"))
    }
}

#[derive(Serialize, Debug, Default)]
pub struct Resolved {
    network: String,
    id: String,
    cid: String,
    root_id: String,
    root_cid: String,
    handle: String,
    name: String,
    text: String,
}

/// A post on the web (bsky.app/profile/x/post/y, or a Mastodon post anywhere) as a post your connected account
/// can reply to, so Write back answers it from the app instead of a website you'd have to sign in to.
#[tauri::command]
pub async fn social_resolve(url: String) -> Result<Resolved, String> {
    static BSKY: OnceLock<regex::Regex> = OnceLock::new();
    if let Some(c) = BSKY.get_or_init(|| regex::Regex::new(r"bsky\.app/profile/([^/]+)/post/([A-Za-z0-9]+)").unwrap()).captures(&url) {
        if secret_get("bluesky").is_none() { return Err("Connect Bluesky to reply from the app.".into()); }
        let (who, rkey) = (c[1].to_string(), c[2].to_string());
        let did = if who.starts_with("did:") { who } else { bsky_resolve(&who).await?.0 };
        let uri = format!("at://{did}/app.bsky.feed.post/{rkey}");
        let v = bsky(true, "app.bsky.feed.getPosts", &[("uris", uri.clone())], None).await?;
        let p = v["posts"].as_array().and_then(|a| a.first()).cloned().ok_or("That Bluesky post couldn't be found.")?;
        let root = &p["record"]["reply"]["root"];
        let a = bsky_person(&p["author"]);
        return Ok(Resolved { network: "bluesky".into(), id: st(&p, "uri"), cid: st(&p, "cid"), root_id: st(root, "uri"), root_cid: st(root, "cid"),
            handle: a.handle, name: a.name, text: st(&p, "record.text") });
    }
    if masto_saved().is_err() { return Err("Connect Mastodon to reply from the app.".into()); }
    let v = masto(reqwest::Method::GET, "/api/v2/search", &[("q", url.clone()), ("type", "statuses".into()), ("resolve", "true".into()), ("limit", "1".into())], None).await?;
    let p = v["statuses"].as_array().and_then(|a| a.first()).cloned().ok_or("That post couldn't be found from your Mastodon server.")?;
    let a = masto_person(&p["account"]);
    Ok(Resolved { network: "mastodon".into(), id: st(&p, "id"), handle: a.handle, name: a.name, text: html_text(&st(&p, "content")), ..Default::default() })
}

/// Mute or block someone, or report a post, with the network's own tools.
#[tauri::command]
pub async fn social_moderate(network: String, action: String, person: String, post_id: String, post_cid: String, reason: String) -> Result<(), String> {
    match (network.as_str(), action.as_str()) {
        ("bluesky", "mute") => bsky(false, "app.bsky.graph.muteActor", &[], Some(json!({ "actor": person }))).await.map(|_| ()),
        ("bluesky", "block") => {
            let s = bsky_session(false).await?;
            let record = json!({ "$type": "app.bsky.graph.block", "subject": person, "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string() });
            bsky(false, "com.atproto.repo.createRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.graph.block", "record": record }))).await.map(|_| ())
        }
        // An account itself (a spam follower) when there's no post
        ("bluesky", "report") if post_id.is_empty() => bsky(false, "com.atproto.moderation.createReport", &[], Some(json!({
            "reasonType": if reason == "spam" { "com.atproto.moderation.defs#reasonSpam" } else { "com.atproto.moderation.defs#reasonOther" },
            "reason": if reason == "spam" { "Spam account" } else { reason.as_str() },
            "subject": { "$type": "com.atproto.admin.defs#repoRef", "did": person },
        }))).await.map(|_| ()),
        ("bluesky", "report") => bsky(false, "com.atproto.moderation.createReport", &[], Some(json!({
            "reasonType": "com.atproto.moderation.defs#reasonOther", "reason": reason,
            "subject": { "$type": "com.atproto.repo.strongRef", "uri": post_id, "cid": post_cid },
        }))).await.map(|_| ()),
        ("mastodon", "mute") => masto(reqwest::Method::POST, &format!("/api/v1/accounts/{person}/mute"), &[], Some(json!({}))).await.map(|_| ()),
        ("mastodon", "block") => masto(reqwest::Method::POST, &format!("/api/v1/accounts/{person}/block"), &[], Some(json!({}))).await.map(|_| ()),
        ("mastodon", "report") => {
            let ids: Vec<&str> = if post_id.is_empty() { vec![] } else { vec![post_id.as_str()] };
            let mut body = json!({ "account_id": person, "status_ids": ids, "comment": if reason == "spam" { "Spam account" } else { reason.as_str() }, "forward": true });
            if reason == "spam" { body["category"] = json!("spam"); }
            masto(reqwest::Method::POST, "/api/v1/reports", &[], Some(body)).await.map(|_| ())
        }
        _ => Err("That can't be done here.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mastodon_html_becomes_text() {
        assert_eq!(html_text("<p>Hi <span class=\"h-card\"><a href=\"x\">@<span>kev</span></a></span> &amp; all</p><p>Second<br>line</p>"), "Hi @kev & all\n\nSecond\nline");
    }

    #[test]
    fn links_get_facets_with_byte_offsets() {
        let f = link_facets("Read “this”: https://kev.example/post. Nice");
        assert_eq!(f.len(), 1);
        let start = f[0]["index"]["byteStart"].as_u64().unwrap() as usize;
        let end = f[0]["index"]["byteEnd"].as_u64().unwrap() as usize;
        assert_eq!(&"Read “this”: https://kev.example/post. Nice"[start..end], "https://kev.example/post");
    }

    #[test]
    fn server_names_are_tidied() {
        assert_eq!(masto_host("https://Mastodon.Social/about"), "mastodon.social");
        assert_eq!(masto_host("@me@fosstodon.org"), "fosstodon.org");
    }

    #[test]
    fn threads_nest_under_parents() {
        let n = |id: &str, parent: &str, at: &str| Note { id: id.into(), parent_id: parent.into(), created_at: at.into(), ..Default::default() };
        let out = order_thread("root", vec![n("b", "root", "2"), n("c", "a", "3"), n("a", "root", "1"), n("x", "elsewhere", "0")]);
        let got: Vec<(String, usize)> = out.iter().map(|n| (n.id.clone(), n.depth)).collect();
        assert_eq!(got, vec![("a".into(), 1), ("c".into(), 2), ("b".into(), 1)]);
    }
}


// ------------------------------------------------------------------ Conversations: you, your followers, and what people share

#[derive(Serialize, Default, Debug)]
pub struct Profile {
    network: String,
    handle: String,
    name: String,
    avatar: String,
    url: String,
    followers: i64,
    following: i64,
    posts: i64,
}

/// Your own profile on each connected network, with follower, following and post counts.
#[tauri::command]
pub async fn social_profiles() -> Vec<Profile> {
    let mut out = Vec::new();
    if secret_get("bluesky").is_some() {
        if let Ok(s) = bsky_session(false).await {
            if let Ok(p) = bsky(true, "app.bsky.actor.getProfile", &[("actor", s.did.clone())], None).await {
                let n = |k: &str| p.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
                out.push(Profile {
                    network: "bluesky".into(), handle: format!("@{}", st(&p, "handle")),
                    name: Some(st(&p, "displayName")).filter(|x| !x.trim().is_empty()).unwrap_or_else(|| st(&p, "handle")),
                    avatar: st(&p, "avatar"), url: format!("https://bsky.app/profile/{}", st(&p, "handle")),
                    followers: n("followersCount"), following: n("followsCount"), posts: n("postsCount"),
                });
            }
        }
    }
    if let Ok(m) = masto_saved() {
        if let Ok(p) = masto(reqwest::Method::GET, "/api/v1/accounts/verify_credentials", &[], None).await {
            let n = |k: &str| p.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
            out.push(Profile {
                network: "mastodon".into(), handle: format!("@{}@{}", st(&p, "acct"), st(&m, "instance")),
                name: Some(st(&p, "display_name")).filter(|x| !x.trim().is_empty()).unwrap_or_else(|| st(&p, "acct")),
                avatar: st(&p, "avatar_static"), url: st(&p, "url"),
                followers: n("followers_count"), following: n("following_count"), posts: n("statuses_count"),
            });
        }
    }
    out
}

/// The first web address in a bit of text, if it looks like someone's own site (not a social network).
pub fn own_site(text: &str) -> String {
    static URL: OnceLock<regex::Regex> = OnceLock::new();
    let skip = ["bsky.app", "mastodon", "twitter.com", "x.com", "instagram.com", "threads.net", "facebook.com", "linkedin.com",
        "youtube.com", "tiktok.com", "linktr.ee", "github.com", "patreon.com", "ko-fi.com", "buymeacoffee.com", "paypal", "venmo"];
    // Without https:// in front, only addresses ending like a website count ("St.Louis" isn't one)
    let tlds = ["com", "net", "org", "blog", "io", "dev", "me", "co", "uk", "ca", "au", "de", "fr", "nl", "info", "xyz", "page", "site",
        "website", "online", "ink", "pub", "life", "world", "space", "studio", "design", "photo", "photography", "art", "us", "eu", "ie", "nz"];
    URL.get_or_init(|| regex::Regex::new(r#"(?i)\b(https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})(/[^\s<>"]*)?"#).unwrap())
        .captures_iter(text)
        .filter(|c| c.get(1).is_some() || tlds.contains(&c[2].rsplit('.').next().unwrap_or("").to_lowercase().as_str()))
        .map(|c| c[2].to_lowercase())
        .find(|h| !skip.iter().any(|s| h.contains(s)) && !h.ends_with(".social") && h.contains('.'))
        .map(|h| format!("https://{h}/"))
        .unwrap_or_default()
}

#[derive(Serialize, Debug)]
pub struct Follower {
    network: String,
    person: Person,
    followed_at: String,
    following: bool,
    blog: String,
}

/// People who followed you lately, whether you follow them back, and their blog if they have one.
#[tauri::command]
pub async fn social_followers() -> Vec<Follower> {
    let mut out = Vec::new();
    if secret_get("bluesky").is_some() {
        if let Ok(v) = bsky(true, "app.bsky.notification.listNotifications", &[("limit", "60".into()), ("reasons", "follow".into())], None).await {
            for x in v["notifications"].as_array().cloned().unwrap_or_default() {
                if st(&x, "reason") != "follow" {
                    continue;
                }
                let a = &x["author"];
                out.push(Follower {
                    network: "bluesky".into(), person: bsky_person(a), followed_at: st(&x, "indexedAt"),
                    following: bsky_following(a), blog: bsky_blog(a),
                });
            }
        }
    }
    if masto_saved().is_ok() {
        if let Ok(v) = masto(reqwest::Method::GET, "/api/v1/notifications", &[("types[]", "follow".into()), ("limit", "40".into())], None).await {
            let list = v.as_array().cloned().unwrap_or_default();
            let ids: Vec<(&str, String)> = list.iter().map(|x| ("id[]", st(x, "account.id"))).collect();
            let rel = if ids.is_empty() { Value::Null } else { masto(reqwest::Method::GET, "/api/v1/accounts/relationships", &ids, None).await.unwrap_or(Value::Null) };
            for x in &list {
                let a = &x["account"];
                let id = st(a, "id");
                let following = rel.as_array().and_then(|r| r.iter().find(|r| st(r, "id") == id)).and_then(|r| r.get("following")).and_then(|f| f.as_bool()).unwrap_or(false);
                out.push(Follower { network: "mastodon".into(), person: masto_person(a), followed_at: st(x, "created_at"), following, blog: masto_blog(a) });
            }
        }
    }
    out.sort_by(|a, b| b.followed_at.cmp(&a.followed_at));
    out
}

/// A Bluesky account's own site: a handle on their own domain, or an address in their bio.
fn bsky_blog(a: &Value) -> String {
    let handle = st(a, "handle");
    if !handle.ends_with(".bsky.social") && handle.contains('.') && !handle.ends_with(".bsky.team") { format!("https://{handle}/") } else { own_site(&st(a, "description")) }
}
fn bsky_following(a: &Value) -> bool {
    a.get("viewer").and_then(|v| v.get("following")).map(|f| f.is_string()).unwrap_or(false)
}
/// A Mastodon account's own site: a verified website field first, then any site in their fields or bio.
fn masto_blog(a: &Value) -> String {
    let fields = a.get("fields").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    let verified = fields.iter().find(|f| !st(f, "verified_at").is_empty()).map(|f| own_site(&html_text(&st(f, "value")))).unwrap_or_default();
    let any = fields.iter().map(|f| own_site(&html_text(&st(f, "value")))).find(|u| !u.is_empty()).unwrap_or_default();
    [verified, any, own_site(&html_text(&st(a, "note")))].into_iter().find(|u| !u.is_empty()).unwrap_or_default()
}

#[derive(Serialize, Debug)]
pub struct SiteAccounts {
    site: String,
    links: Vec<crate::reply::Link>,
    /// The site's own icon (its apple-touch-icon or the largest icon it lists), for the writer's face
    icon: String,
}

/// The best picture a site gives for itself: an apple-touch-icon, else the largest rel="icon" (SVG counts as
/// large), else /favicon.ico is left to the app to skip (too small to use as a face).
pub fn site_icon(html: &str, base: &url::Url) -> String {
    static LINK: OnceLock<regex::Regex> = OnceLock::new();
    static ATTR: OnceLock<regex::Regex> = OnceLock::new();
    let attr = |tag: &str, name: &str| -> String {
        ATTR.get_or_init(|| regex::Regex::new(r#"(?is)([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)')"#).unwrap())
            .captures_iter(tag)
            .find(|c| c[1].eq_ignore_ascii_case(name))
            .map(|c| c.get(3).or(c.get(4)).map(|m| m.as_str().to_string()).unwrap_or_default())
            .unwrap_or_default()
    };
    let head = &html[..html.len().min(200_000)];
    let mut best: Option<(i64, String)> = None;
    for m in LINK.get_or_init(|| regex::Regex::new(r#"(?is)<link\b[^>]*>"#).unwrap()).find_iter(head) {
        let tag = m.as_str();
        let rel = attr(tag, "rel").to_lowercase();
        let href = html_escape::decode_html_entities(&attr(tag, "href")).to_string();
        if href.is_empty() || href.starts_with("data:") { continue; }
        let size = attr(tag, "sizes").split(|c: char| c == 'x' || c == 'X').next().and_then(|n| n.trim().parse::<i64>().ok()).unwrap_or(0);
        let score = if rel.contains("apple-touch-icon") { 1000 + size.max(180) }
            else if rel.split_whitespace().any(|r| r == "icon") { if href.to_lowercase().ends_with(".svg") { 900 } else { size } }
            else { continue };
        // tiny favicons look like smudges at face size
        if score < 64 { continue; }
        if let Ok(u) = base.join(&href) {
            if matches!(u.scheme(), "http" | "https") && best.as_ref().map_or(true, |(b, _)| score > *b) { best = Some((score, u.to_string())); }
        }
    }
    best.map(|(_, u)| u).unwrap_or_default()
}

/// The Mastodon and Bluesky accounts people list on their own sites (rel="me" links, fediverse:creator),
/// so their blog, toots and skeets can be known as one person, and you can follow them there.
#[tauri::command]
pub async fn site_accounts(sites: Vec<String>) -> Vec<SiteAccounts> {
    use futures::stream::{self, StreamExt};
    stream::iter(sites.into_iter().take(200))
        .map(|site| async move {
            let mut o = crate::reply::Options::default();
            let mut icon = String::new();
            if let Ok(page) = url::Url::parse(&site) {
                if let Ok(Ok((body, final_url, _))) = tokio::time::timeout(Duration::from_secs(12), crate::feeds::get(client(), &site)).await {
                    let base = url::Url::parse(&final_url).unwrap_or(page);
                    let html = String::from_utf8_lossy(&body);
                    crate::reply::scan(&html, &base, &mut o);
                    icon = site_icon(&html, &base);
                }
            }
            SiteAccounts { site, links: o.social, icon }
        })
        .buffer_unordered(6)
        .collect()
        .await
}

#[derive(Serialize, Debug)]
pub struct Lookup {
    url: String,
    network: String,
    person: Person,
    following: bool,
}

/// Find people's accounts from their profile addresses, and whether you already follow them.
/// Bluesky in batches of 25; Mastodon one by one, through your own server so they can be followed.
#[tauri::command]
pub async fn social_lookup(urls: Vec<String>) -> Vec<Lookup> {
    let mut out = Vec::new();
    let bsky_urls: Vec<(String, String)> = urls.iter()
        .filter_map(|u| u.split("bsky.app/profile/").nth(1).map(|h| (u.clone(), h.trim_end_matches('/').split('/').next().unwrap_or("").to_lowercase())))
        .filter(|(_, h)| !h.is_empty())
        .collect();
    if secret_get("bluesky").is_some() {
        for chunk in bsky_urls.chunks(25) {
            let q: Vec<(&str, String)> = chunk.iter().map(|(_, h)| ("actors", h.clone())).collect();
            if let Ok(v) = bsky(true, "app.bsky.actor.getProfiles", &q, None).await {
                for p in v["profiles"].as_array().cloned().unwrap_or_default() {
                    let (h, did) = (st(&p, "handle").to_lowercase(), st(&p, "did"));
                    if let Some((u, _)) = chunk.iter().find(|(_, x)| *x == h || *x == did) {
                        out.push(Lookup { url: u.clone(), network: "bluesky".into(), person: bsky_person(&p), following: bsky_following(&p) });
                    }
                }
            }
        }
    }
    if let Ok(m) = masto_saved() {
        let mine = st(&m, "instance").trim_start_matches("https://").trim_end_matches('/').to_lowercase();
        static ACCT: OnceLock<regex::Regex> = OnceLock::new();
        let re = ACCT.get_or_init(|| regex::Regex::new(r"(?i)^https?://([^/]+)/@([A-Za-z0-9_.]+)/?$").unwrap());
        let wanted: Vec<(String, String)> = urls.iter().filter(|u| !u.contains("bsky.app/"))
            .filter_map(|u| re.captures(u).map(|c| (u.clone(), if c[1].to_lowercase() == mine { c[2].to_string() } else { format!("{}@{}", &c[2], &c[1]) })))
            .take(40).collect();
        let mut found: Vec<(String, Value)> = Vec::new();
        for (u, acct) in wanted {
            let a = if acct.contains('@') {
                masto(reqwest::Method::GET, "/api/v2/search", &[("q", format!("@{acct}")), ("type", "accounts".into()), ("resolve", "true".into()), ("limit", "1".into())], None).await
                    .ok().and_then(|v| v["accounts"].as_array().and_then(|a| a.first().cloned()))
            } else {
                masto(reqwest::Method::GET, "/api/v1/accounts/lookup", &[("acct", acct)], None).await.ok()
            };
            if let Some(a) = a.filter(|a| !st(a, "id").is_empty()) {
                found.push((u, a));
            }
        }
        if !found.is_empty() {
            let ids: Vec<(&str, String)> = found.iter().map(|(_, a)| ("id[]", st(a, "id"))).collect();
            let rel = masto(reqwest::Method::GET, "/api/v1/accounts/relationships", &ids, None).await.unwrap_or(Value::Null);
            for (u, a) in &found {
                let id = st(a, "id");
                let r = rel.as_array().and_then(|r| r.iter().find(|r| st(r, "id") == id));
                let following = r.map(|r| r.get("following").and_then(|f| f.as_bool()).unwrap_or(false) || r.get("requested").and_then(|f| f.as_bool()).unwrap_or(false)).unwrap_or(false);
                out.push(Lookup { url: u.clone(), network: "mastodon".into(), person: masto_person(a), following });
            }
        }
    }
    out
}

#[derive(Serialize, Debug)]
pub struct FollowedBlog {
    network: String,
    person: Person,
    blog: String,
}

/// People you follow on Bluesky and Mastodon who keep a site of their own, so you can read them here.
#[tauri::command]
pub async fn social_following_blogs() -> Vec<FollowedBlog> {
    let mut out = Vec::new();
    if secret_get("bluesky").is_some() {
        if let Ok(s) = bsky_session(false).await {
            let mut cursor = String::new();
            for _ in 0..10 {
                let mut q = vec![("actor", s.did.clone()), ("limit", "100".to_string())];
                if !cursor.is_empty() { q.push(("cursor", cursor.clone())); }
                let Ok(v) = bsky(true, "app.bsky.graph.getFollows", &q, None).await else { break };
                for a in v["follows"].as_array().cloned().unwrap_or_default() {
                    let blog = bsky_blog(&a);
                    if !blog.is_empty() { out.push(FollowedBlog { network: "bluesky".into(), person: bsky_person(&a), blog }); }
                }
                cursor = st(&v, "cursor");
                if cursor.is_empty() { break; }
            }
        }
    }
    if masto_saved().is_ok() {
        if let Ok(me) = masto(reqwest::Method::GET, "/api/v1/accounts/verify_credentials", &[], None).await {
            let path = format!("/api/v1/accounts/{}/following", st(&me, "id"));
            let mut max_id: Option<String> = None;
            for _ in 0..13 {
                let mut q = vec![("limit", "80".to_string())];
                if let Some(m) = &max_id { q.push(("max_id", m.clone())); }
                let Ok((v, next)) = masto_page(&path, &q).await else { break };
                for a in v.as_array().cloned().unwrap_or_default() {
                    let blog = masto_blog(&a);
                    if !blog.is_empty() { out.push(FollowedBlog { network: "mastodon".into(), person: masto_person(&a), blog }); }
                }
                match next { Some(n) if Some(&n) != max_id.as_ref() => max_id = Some(n), _ => break }
            }
        }
    }
    // Once per site, even when you follow them on both
    let mut seen = std::collections::HashSet::new();
    out.retain(|f| seen.insert(f.blog.trim_end_matches('/').trim_start_matches("https://").trim_start_matches("www.").to_lowercase()));
    out
}

/// Follow someone back.
#[tauri::command]
pub async fn social_follow(network: String, person: String) -> Result<(), String> {
    if network == "bluesky" {
        let s = bsky_session(false).await?;
        let record = json!({ "$type": "app.bsky.graph.follow", "subject": person, "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string() });
        bsky(false, "com.atproto.repo.createRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.graph.follow", "record": record }))).await.map(|_| ())
    } else {
        masto(reqwest::Method::POST, &format!("/api/v1/accounts/{person}/follow"), &[], Some(json!({}))).await.map(|_| ()).map_err(|e| {
            if e.contains("403") || e.to_lowercase().contains("scope") || e.contains("signed the app out") {
                "Following needs a newer permission. Disconnect Mastodon and connect it again (Mastodon & Bluesky in the sidebar), then try once more.".into()
            } else { e }
        })
    }
}

/// Posts from people you follow (your own and replies left out). The ones sharing something to read fill
/// "From people you follow"; the Neighborhood also shows the plain posts of the writers you read.
#[tauri::command]
pub async fn social_shared() -> Conversations {
    let mut c = Conversations::default();
    if secret_get("bluesky").is_some() {
        match bsky_session(false).await {
            Ok(s) => match bsky(true, "app.bsky.feed.getTimeline", &[("limit", "100".into())], None).await {
                Ok(v) => {
                    for x in v["feed"].as_array().cloned().unwrap_or_default() {
                        let mut n = bsky_note(&x["post"], "shared");
                        if n.author.id == s.did || !st(&x, "reply.parent.uri").is_empty() {
                            continue;
                        }
                        if st(&x, "reason.$type").ends_with("reasonRepost") {
                            if st(&x, "reason.by.did") == s.did { continue; }
                            n.via = bsky_person(&x["reason"]["by"]).name;
                        }
                        c.posts.push(n);
                    }
                }
                Err(e) => c.errors.push(format!("Bluesky: {e}")),
            },
            Err(e) => c.errors.push(format!("Bluesky: {e}")),
        }
    }
    if let Ok(m) = masto_saved() {
        let me = st(&m, "id");
        // Mastodon gives 40 at a time; two pages keep it level with Bluesky's 100
        let mut page: Vec<Value> = Vec::new();
        let mut failed = None;
        for _ in 0..2 {
            let mut q = vec![("limit", "40".to_string())];
            if let Some(last) = page.last() { q.push(("max_id", st(last, "id"))); }
            match masto(reqwest::Method::GET, "/api/v1/timelines/home", &q, None).await {
                Ok(v) => {
                    let got = v.as_array().cloned().unwrap_or_default();
                    let more = got.len() == 40;
                    page.extend(got);
                    if !more { break; }
                }
                Err(e) => { if page.is_empty() { failed = Some(e); } break; }
            }
        }
        match failed.map_or(Ok(Value::Array(page)), Err) {
            Ok(v) => {
                for x in v.as_array().cloned().unwrap_or_default() {
                    let boosted = x.get("reblog").is_some_and(|r| r.is_object());
                    let inner = if boosted { &x["reblog"] } else { &x };
                    let mut n = masto_note(inner, "shared");
                    if n.author.id == me || !st(inner, "in_reply_to_id").is_empty() || st(&x, "account.id") == me {
                        continue;
                    }
                    if boosted {
                        n.via = masto_person(&x["account"]).name;
                    }
                    c.posts.push(n);
                }
            }
            Err(e) => c.errors.push(format!("Mastodon: {e}")),
        }
    }
    c.posts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    c
}

/// People on Bluesky (and Mastodon, where its search allows) linking to your site.
#[tauri::command]
pub async fn social_blog_mentions(domain: String) -> Vec<Note> {
    let domain = domain.trim().trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.").trim_end_matches('/').to_lowercase();
    let mut out = Vec::new();
    if domain.is_empty() || !domain.contains('.') {
        return out;
    }
    if secret_get("bluesky").is_some() {
        if let Ok(s) = bsky_session(false).await {
            if let Ok(v) = bsky(true, "app.bsky.feed.searchPosts", &[("q", domain.clone()), ("domain", domain.clone()), ("sort", "latest".into()), ("limit", "40".into())], None).await {
                for p in v["posts"].as_array().cloned().unwrap_or_default() {
                    let n = bsky_note(&p, "mention");
                    if n.author.id != s.did {
                        out.push(n);
                    }
                }
            }
        }
    }
    if let Ok(m) = masto_saved() {
        let me = st(&m, "id");
        if let Ok(v) = masto(reqwest::Method::GET, "/api/v2/search", &[("q", domain.clone()), ("type", "statuses".into()), ("limit", "20".into())], None).await {
            for x in v["statuses"].as_array().cloned().unwrap_or_default() {
                let n = masto_note(&x, "mention");
                if n.author.id != me && (n.link.contains(&domain) || n.text.to_lowercase().contains(&domain)) {
                    out.push(n);
                }
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

#[cfg(test)]
mod more_tests {
    use super::own_site;

    #[test]
    fn finds_a_persons_own_site_not_their_socials() {
        assert_eq!(own_site("Writer. Posts at https://rosa.example/blog and @rosa@mastodon.social"), "https://rosa.example/");
        assert_eq!(own_site("bsky.app/profile/x · linktr.ee/x"), "");
        assert_eq!(own_site("writing at samokafor.net"), "https://samokafor.net/");
        assert_eq!(own_site("Born in St.Louis, now in Mr.Smith's town"), "");
    }
}


// ------------------------------------------------------------------ your own site: notes, posted home first

/// The site's address, cleaned up: https:// and no trailing slash.
fn site_base(raw: &str) -> Result<String, String> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() {
        return Err("Type your site's address.".into());
    }
    let full = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let u = url::Url::parse(&full).map_err(|_| "That doesn't look like a web address.".to_string())?;
    if u.scheme() != "https" && u.scheme() != "http" {
        return Err("That doesn't look like a web address.".into());
    }
    Ok(full.trim_end_matches('/').to_string())
}

fn wp_fail(e: Fail) -> String {
    let v: Value = serde_json::from_str(&e.1).unwrap_or(Value::Null);
    let code = st(&v, "code");
    match (e.0, code.as_str()) {
        (_, "rest_not_logged_in") => "Your site didn't receive the sign-in. Some web hosts block it; your site needs the small “The Reading Room sign-in header” snippet.".into(),
        (401, _) | (403, "rest_cannot_create") | (_, "incorrect_password") | (_, "invalid_username") =>
            "Your site didn't accept that username and Application Password. Check both, or make a new Application Password.".into(),
        (404, "rest_no_route") | (404, "") => "Couldn't find WordPress's API at that address. Check the site address.".into(),
        _ => explain(e),
    }
}

/// The sign-in, also sent as X-Reading-Room-Auth: some hosts (IONOS among them) drop the Authorization header
/// before WordPress sees it. A small snippet on the site hands this one to WordPress instead.
fn wp_auth(req: reqwest::RequestBuilder, user: &str, pass: &str) -> reqwest::RequestBuilder {
    use base64::Engine;
    let token = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
    req.basic_auth(user, Some(pass)).header("X-Reading-Room-Auth", format!("Basic {token}"))
}

async fn wp_call(base: &str, user: &str, pass: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let mut req = wp_auth(client().request(method, format!("{base}/wp-json{path}")), user, pass);
    if let Some(b) = &body {
        req = with_json(req, b);
    }
    call(req).await.map_err(wp_fail)
}

async fn wp(method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let s = secret_get("wordpress").ok_or("Connect your site first.")?;
    wp_call(&st(&s, "site"), &st(&s, "user"), &st(&s, "password"), method, path, body).await
}

#[derive(Serialize, Default)]
pub struct SiteComment {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub url: String,
    pub avatar: String,
    pub text: String,
    pub date: String,
    pub link: String,
    pub post_title: String,
}

#[derive(Serialize, Default)]
pub struct SiteComments {
    pub comments: Vec<SiteComment>,
    /// Comments waiting for you to approve them, and where to do that
    pub waiting: usize,
    pub admin: String,
}

/// A comment left on someone else's post, read from their site.
#[derive(Serialize, Debug, Default, Clone, PartialEq)]
pub struct PostComment {
    pub id: String,
    pub parent: String,
    pub name: String,
    pub url: String,
    pub avatar: String,
    pub text: String,
    pub date: String,
}

#[derive(Serialize, Debug, Default)]
pub struct PostComments {
    pub comments: Vec<PostComment>,
    /// Where to leave a comment on their site
    pub page: String,
    /// The site doesn't show its comments to apps (or has none we could find)
    pub found: bool,
}

/// The post's WordPress API address (WordPress puts it in every post's head), or its comments feed.
fn comment_sources(html: &str, base: &url::Url) -> (Option<String>, Option<String>) {
    static LINK: OnceLock<regex::Regex> = OnceLock::new();
    let re = LINK.get_or_init(|| regex::Regex::new(r#"(?is)<link\b[^>]*>"#).unwrap());
    let attr = |tag: &str, name: &str| -> String {
        let r = regex::Regex::new(&format!(r#"(?is)\b{name}\s*=\s*["']([^"']*)["']"#)).unwrap();
        r.captures(tag).map(|c| html_escape::decode_html_entities(&c[1]).to_string()).unwrap_or_default()
    };
    let (mut api, mut feed) = (None, None);
    for m in re.find_iter(html) {
        let t = m.as_str();
        if !attr(t, "rel").split_whitespace().any(|r| r.eq_ignore_ascii_case("alternate")) { continue }
        let (kind, href) = (attr(t, "type").to_lowercase(), attr(t, "href"));
        let Ok(u) = base.join(&href) else { continue };
        if kind == "application/json" && u.path().contains("/wp/v2/posts/") && api.is_none() { api = Some(u.to_string()); }
        if kind.contains("rss") || kind.contains("atom") {
            let title = attr(t, "title").to_lowercase();
            if (title.contains("comment") || u.path().contains("/comments/feed") || u.path().ends_with(&format!("{}feed/", base.path()))) && feed.is_none() && u.path() != "/comments/feed/" {
                feed = Some(u.to_string());
            }
        }
    }
    (api, feed)
}

/// Comments people left on a post: through WordPress's own API when the site has it, or its comments feed.
#[tauri::command]
pub async fn post_comments(url: String) -> Result<PostComments, String> {
    let base = url::Url::parse(&url).map_err(|_| "That post has no web address.".to_string())?;
    let mut out = PostComments { page: format!("{}#respond", url.split('#').next().unwrap_or(&url)), ..Default::default() };
    let Ok(Ok((body, final_url, _))) = tokio::time::timeout(Duration::from_secs(15), crate::feeds::get(client(), &url)).await else {
        return Err("Couldn't reach their site.".into());
    };
    let page_base = url::Url::parse(&final_url).unwrap_or(base);
    let (api, feed) = comment_sources(&String::from_utf8_lossy(&body), &page_base);
    if let Some(api) = api {
        if let Some(id) = api.rsplit('/').find(|s| !s.is_empty()).and_then(|s| s.split('?').next()).filter(|s| s.chars().all(|c| c.is_ascii_digit())) {
            let root = api.split("/wp/v2/").next().unwrap_or("").to_string();
            let q = format!("{root}/wp/v2/comments?post={id}&per_page=100&order=asc&_fields=id,parent,author_name,author_url,author_avatar_urls,date_gmt,content,type");
            if let Ok(v) = call(client().get(&q)).await {
                if let Some(list) = v.as_array() {
                    out.found = true;
                    for c in list {
                        let avatar = ["96", "48", "24"].iter().map(|k| st(&c["author_avatar_urls"], k)).find(|u| !u.is_empty()).unwrap_or_default();
                        out.comments.push(PostComment {
                            id: c["id"].to_string(), parent: c["parent"].as_i64().filter(|p| *p > 0).map(|p| p.to_string()).unwrap_or_default(),
                            name: st(c, "author_name"), url: st(c, "author_url"), avatar,
                            text: html_text(&st(&c["content"], "rendered")).trim().to_string(),
                            date: format!("{}Z", st(c, "date_gmt").trim_end_matches('Z')),
                        });
                    }
                    return Ok(out);
                }
            }
        }
    }
    if let Some(feed) = feed {
        if let Ok(Ok((body, final_url, _))) = tokio::time::timeout(Duration::from_secs(15), crate::feeds::get(client(), &feed)).await {
            if let Ok(f) = feed_rs::parser::Builder::new().base_uri(Some(&final_url)).build().parse(&body[..]) {
                out.found = true;
                let mut list: Vec<PostComment> = f.entries.iter().map(|e| PostComment {
                    id: e.id.clone(),
                    parent: String::new(),
                    name: e.authors.first().map(|a| a.name.clone()).or_else(|| e.title.as_ref().map(|t| t.content.trim_start_matches("By: ").to_string())).unwrap_or_default(),
                    url: e.authors.first().and_then(|a| a.uri.clone()).unwrap_or_default(),
                    avatar: String::new(),
                    text: html_text(&e.content.as_ref().and_then(|c| c.body.clone()).or_else(|| e.summary.as_ref().map(|s| s.content.clone())).unwrap_or_default()).trim().to_string(),
                    date: e.published.or(e.updated).map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string()).unwrap_or_default(),
                }).collect();
                list.sort_by(|a, b| a.date.cmp(&b.date));
                out.comments = list;
            }
        }
    }
    Ok(out)
}

/// What one writer likes: the posts their site marks as liked or bookmarked (h-entry u-like-of / u-bookmark-of),
/// on a Likes or Bookmarks page of their own site.
#[derive(Serialize, Clone, Debug)]
pub struct TheirLikes {
    pub site: String,
    pub page: String,
    pub links: Vec<String>,
}

const LIKE_PAGES: &[&str] = &["/likes/", "/liked-posts/", "/liked/", "/bookmarks/"];

/// The addresses a page marks as liked or bookmarked, in page order, up to 200.
fn liked_links(html: &str, base: &url::Url) -> Vec<String> {
    static A: OnceLock<regex::Regex> = OnceLock::new();
    static CLS: OnceLock<regex::Regex> = OnceLock::new();
    static HREF: OnceLock<regex::Regex> = OnceLock::new();
    let a = A.get_or_init(|| regex::Regex::new(r#"(?is)<a\b[^>]*>"#).unwrap());
    let cls = CLS.get_or_init(|| regex::Regex::new(r#"(?is)\bclass\s*=\s*["']([^"']*)["']"#).unwrap());
    let href = HREF.get_or_init(|| regex::Regex::new(r#"(?is)\bhref\s*=\s*["']([^"']+)["']"#).unwrap());
    let mut out: Vec<String> = Vec::new();
    for tag in a.find_iter(html) {
        let t = tag.as_str();
        let Some(c) = cls.captures(t) else { continue };
        if !c[1].split_whitespace().any(|k| k == "u-like-of" || k == "u-bookmark-of") { continue }
        let Some(h) = href.captures(t) else { continue };
        let h = html_escape::decode_html_entities(&h[1]).to_string();
        let Ok(u) = base.join(&h) else { continue };
        if !matches!(u.scheme(), "http" | "https") || u.host_str() == base.host_str() { continue }
        let s = u.to_string();
        if !out.contains(&s) { out.push(s); }
        if out.len() >= 200 { break }
    }
    out
}

/// For each site, the posts it says it liked, read from its Likes (or Bookmarks) page. Sites without one are left out.
#[tauri::command]
pub async fn people_likes(sites: Vec<String>) -> Vec<TheirLikes> {
    use futures::stream::{self, StreamExt};
    let c = client().clone();
    stream::iter(sites.into_iter().take(80).map(|site| {
        let c = c.clone();
        async move {
            let base = url::Url::parse(&site).ok()?.join("/").ok()?;
            for p in LIKE_PAGES {
                let Ok(page) = base.join(p) else { continue };
                let got = tokio::time::timeout(Duration::from_secs(12), crate::feeds::get(&c, page.as_str())).await;
                let Ok(Ok((body, final_url, _))) = got else { continue };
                let html = String::from_utf8_lossy(&body);
                if !html.contains("u-like-of") && !html.contains("u-bookmark-of") { continue }
                let fin = url::Url::parse(&final_url).unwrap_or(page.clone());
                let links = liked_links(&html, &fin);
                if !links.is_empty() {
                    return Some(TheirLikes { site, page: final_url, links });
                }
            }
            None
        }
    }))
    .buffer_unordered(6)
    .filter_map(|x| async { x })
    .collect()
    .await
}

/// The newest comments and Webmentions on your own WordPress site (not your own), with the post each is on,
/// and how many are waiting for approval.
#[tauri::command]
pub async fn site_comments() -> Result<SiteComments, String> {
    let s = secret_get("wordpress").ok_or("Connect your site first.")?;
    let me = wp(reqwest::Method::GET, "/wp/v2/users/me", None).await.ok().map(|m| m["id"].as_i64().unwrap_or(0)).unwrap_or(0);
    let list = wp(reqwest::Method::GET, "/wp/v2/comments?per_page=40&orderby=date&order=desc", None).await?;
    let mut out = SiteComments { admin: format!("{}/wp-admin/edit-comments.php?comment_status=moderated", st(&s, "site")), ..Default::default() };
    let mut posts: Vec<i64> = Vec::new();
    for c in list.as_array().cloned().unwrap_or_default() {
        if me != 0 && c["author"].as_i64() == Some(me) { continue; }
        let post = c["post"].as_i64().unwrap_or(0);
        if post != 0 && !posts.contains(&post) { posts.push(post); }
        let avatars = &c["author_avatar_urls"];
        out.comments.push(SiteComment {
            id: c["id"].as_i64().unwrap_or(0),
            kind: Some(st(&c, "type")).filter(|t| !t.is_empty()).unwrap_or_else(|| "comment".into()),
            name: st(&c, "author_name"),
            url: st(&c, "author_url"),
            avatar: ["96", "48", "24"].iter().map(|k| st(avatars, k)).find(|u| !u.is_empty()).unwrap_or_default(),
            text: crate::feeds::plain(&st(&c, "content.rendered"), 600),
            date: { let d = st(&c, "date_gmt"); if d.is_empty() { d } else { format!("{d}Z") } },
            link: st(&c, "link"),
            post_title: post.to_string(),
        });
    }
    // The posts' titles, in one call
    if !posts.is_empty() {
        let ids = posts.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        if let Ok(v) = wp(reqwest::Method::GET, &format!("/wp/v2/posts?include={ids}&per_page=100&_fields=id,title"), None).await {
            for p in v.as_array().cloned().unwrap_or_default() {
                let (id, title) = (p["id"].as_i64().unwrap_or(0).to_string(), crate::feeds::plain(&st(&p, "title.rendered"), 200));
                for c in out.comments.iter_mut().filter(|c| c.post_title == id) { c.post_title = title.clone(); }
            }
        }
        for c in out.comments.iter_mut().filter(|c| c.post_title.parse::<i64>().is_ok()) { c.post_title.clear(); }
    }
    if let Ok(v) = wp(reqwest::Method::GET, "/wp/v2/comments?status=hold&per_page=50&context=edit&_fields=id", None).await {
        out.waiting = v.as_array().map(|a| a.len()).unwrap_or(0);
    }
    Ok(out)
}

#[derive(Serialize, Default)]
pub struct Liked {
    /// Your Likes page
    pub page: String,
    /// The post's site was told (it takes Webmentions)
    pub told: bool,
    /// Why it couldn't be told, if it tried and failed
    pub error: String,
}

const LIKES_START: &str = "<ul class=\"h-feed rr-likes\">";

/// Your Likes page: a page on your site listing the posts you liked, each marked up as a like (h-entry u-like-of),
/// so sites that take Webmentions can show your like. Made the first time; "likes" unless you already have a
/// page by that name that isn't this one.
async fn likes_page(create: bool) -> Result<Option<(i64, String, String)>, String> {
    for slug in ["likes", "liked-posts"] {
        let v = wp(reqwest::Method::GET, &format!("/wp/v2/pages?slug={slug}&context=edit&status=publish,draft,private"), None).await?;
        if let Some(p) = v.as_array().and_then(|a| a.first()) {
            let raw = st(p, "content.raw");
            if raw.contains(LIKES_START) {
                return Ok(Some((p["id"].as_i64().unwrap_or(0), st(p, "link"), raw)));
            }
            continue; // your own page by that name: leave it alone
        }
        if !create { return Ok(None); }
        let content = format!("<!-- wp:paragraph -->\n<p>Posts from other blogs that I liked.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:html -->\n{LIKES_START}\n</ul>\n<!-- /wp:html -->");
        let p = wp(reqwest::Method::POST, "/wp/v2/pages", Some(json!({ "title": "Likes", "slug": slug, "status": "publish", "content": content }))).await?;
        return Ok(Some((p["id"].as_i64().unwrap_or(0), st(&p, "link"), content)));
    }
    Err("Couldn't find a free name for your Likes page.".into())
}

/// The Likes page's content with this post's entry taken out, and put back at the top when liking (newest 300 kept).
fn likes_update(raw: &str, target: &str, title: &str, author: &str, on: bool, now: chrono::DateTime<chrono::Utc>) -> String {
    static LI: OnceLock<regex::Regex> = OnceLock::new();
    let href = format!("href=\"{}\"", html_escape::encode_double_quoted_attribute(target));
    let Some((head, tail)) = raw.split_once(LIKES_START) else { return raw.to_string() };
    let (list, rest) = tail.split_once("</ul>").unwrap_or((tail, ""));
    let mut entries: Vec<String> = LI.get_or_init(|| regex::Regex::new(r#"(?s)<li class="h-entry".*?</li>"#).unwrap())
        .find_iter(list).map(|m| m.as_str().to_string()).filter(|e| !e.contains(&href)).collect();
    if on {
        entries.insert(0, format!(
            "<li class=\"h-entry\">Liked <a class=\"u-like-of\" href=\"{}\">{}</a>{} · <time class=\"dt-published\" datetime=\"{}\">{}</time></li>",
            html_escape::encode_double_quoted_attribute(target), esc_html(if title.trim().is_empty() { target } else { title.trim() }),
            if author.trim().is_empty() { String::new() } else { format!(" by {}", esc_html(author.trim())) },
            now.format("%Y-%m-%dT%H:%M:%SZ"), now.format("%B %-d, %Y")));
    }
    entries.truncate(300);
    let items: String = entries.iter().map(|e| format!("\n{e}")).collect();
    format!("{head}{LIKES_START}{items}\n</ul>{rest}")
}

/// Like (or un-like) a post: add it to your Likes page on your site, then tell the post's site with a Webmention.
#[tauri::command]
pub async fn site_like(url: String, title: String, author: String, on: bool) -> Result<Liked, String> {
    let target = url::Url::parse(&url).map_err(|_| "That post has no web address.".to_string())?.to_string();
    let Some((id, link, raw)) = likes_page(on).await? else { return Ok(Liked::default()) };
    let body = likes_update(&raw, &target, &title, &author, on, chrono::Utc::now());
    wp(reqwest::Method::POST, &format!("/wp/v2/pages/{id}"), Some(json!({ "content": body, "status": "publish" }))).await?;
    // tell their site (an un-like is told too: their site sees the link is gone and takes the like down)
    let mut out = Liked { page: link.clone(), ..Default::default() };
    match crate::webmention::send(client(), &link, &target).await {
        Ok(t) => out.told = t,
        Err(e) => out.error = e,
    }
    Ok(out)
}

/// Like or un-like a post on Bluesky or Mastodon. On Bluesky, liking returns the like's own address,
/// which un-liking needs.
#[tauri::command]
pub async fn social_like(network: String, id: String, cid: String, on: bool, like_uri: Option<String>) -> Result<String, String> {
    if network == "bluesky" {
        let s = bsky_session(false).await?;
        if on {
            let record = json!({ "$type": "app.bsky.feed.like", "subject": { "uri": id, "cid": cid }, "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string() });
            let v = bsky(false, "com.atproto.repo.createRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.feed.like", "record": record }))).await?;
            return Ok(st(&v, "uri"));
        }
        let uri = like_uri.unwrap_or_default();
        let rkey = uri.rsplit('/').next().unwrap_or("").to_string();
        if rkey.is_empty() { return Err("Couldn't find that like to take back.".into()); }
        bsky(false, "com.atproto.repo.deleteRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.feed.like", "rkey": rkey }))).await?;
        return Ok(String::new());
    }
    let path = format!("/api/v1/statuses/{id}/{}", if on { "favourite" } else { "unfavourite" });
    masto(reqwest::Method::POST, &path, &[], Some(json!({}))).await.map(|_| String::new()).map_err(|e| {
        if e.contains("403") || e.to_lowercase().contains("scope") {
            "Favoriting needs a newer permission. Disconnect Mastodon and connect it again, then try once more.".into()
        } else { e }
    })
}

/// Your picture from your WordPress profile (WordPress uses Gravatar), larger than WordPress's own 96 px.
/// "d=404" so a missing Gravatar fails to load (and the app falls back) instead of showing the grey silhouette.
#[tauri::command]
pub async fn site_avatar() -> String {
    let Ok(me) = wp(reqwest::Method::GET, "/wp/v2/users/me", None).await else { return String::new() };
    let urls = &me["avatar_urls"];
    let best = ["96", "48", "24"].iter().map(|k| st(urls, k)).find(|u| !u.is_empty()).unwrap_or_default();
    let Ok(mut u) = url::Url::parse(&best) else { return String::new() };
    if u.host_str().is_some_and(|h| h.ends_with("gravatar.com")) {
        let keep: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| k != "s" && k != "d").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        u.query_pairs_mut().clear().extend_pairs(keep).append_pair("s", "256").append_pair("d", "404");
    }
    u.to_string()
}

/// Connect your WordPress site with an Application Password (made in your WordPress profile).
#[tauri::command]
pub async fn site_connect(site: String, user: String, password: String) -> Result<Accounts, String> {
    let base = site_base(&site)?;
    let user = user.trim().to_string();
    let password = password.trim().to_string();
    if user.is_empty() || password.is_empty() {
        return Err("Type your WordPress username and the Application Password.".into());
    }
    let me = wp_call(&base, &user, &password, reqwest::Method::GET, "/wp/v2/users/me?context=edit", None).await?;
    let caps = &me["capabilities"];
    if !(caps["publish_posts"].as_bool().unwrap_or(false) || caps["administrator"].as_bool().unwrap_or(false)) {
        return Err("That WordPress user can't publish posts.".into());
    }
    let info = call(client().get(format!("{base}/wp-json/"))).await.unwrap_or(Value::Null);
    let name = Some(st(&info, "name")).filter(|n| !n.trim().is_empty()).unwrap_or_else(|| url::Url::parse(&base).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default());
    secret_set("wordpress", &json!({ "site": base, "user": user, "password": password, "name": name }))?;
    Ok(social_accounts())
}

#[derive(Serialize)]
pub struct SiteNote {
    pub url: String,
    pub id: i64,
    pub image: String,
}

fn esc_html(s: &str) -> String {
    html_escape::encode_text(s).to_string()
}

/// Services WordPress turns into a player by itself: (provider slug, embed type), if the address is one.
fn embeddable(url: &str) -> Option<(&'static str, &'static str)> {
    let u = url::Url::parse(url.trim()).ok()?;
    let host = u.host_str()?.trim_start_matches("www.").trim_start_matches("m.").to_ascii_lowercase();
    let path = u.path();
    match host.as_str() {
        "youtube.com" | "music.youtube.com" if path == "/watch" || path.starts_with("/shorts/") || path.starts_with("/live/") || path == "/playlist" => Some(("youtube", "video")),
        "youtu.be" if path.len() > 1 => Some(("youtube", "video")),
        "vimeo.com" if path.len() > 1 => Some(("vimeo", "video")),
        "open.spotify.com" if path.len() > 1 => Some(("spotify", "rich")),
        "soundcloud.com" if path.len() > 1 => Some(("soundcloud", "rich")),
        "tiktok.com" if path.contains("/video/") => Some(("tiktok", "video")),
        _ => None,
    }
}

/// A YouTube video's thumbnail picture, from its address.
fn video_thumb(url: &str) -> Option<String> {
    let u = url::Url::parse(url.trim()).ok()?;
    let host = u.host_str()?.trim_start_matches("www.").trim_start_matches("m.").to_ascii_lowercase();
    let id = match host.as_str() {
        "youtu.be" => u.path().trim_start_matches('/').split('/').next().map(String::from),
        "youtube.com" | "music.youtube.com" => {
            if u.path() == "/watch" {
                u.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.to_string())
            } else {
                let mut seg = u.path().trim_start_matches('/').split('/');
                match seg.next() {
                    Some("shorts") | Some("live") | Some("embed") => seg.next().map(String::from),
                    _ => None,
                }
            }
        }
        _ => None,
    }?;
    let ok = !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| format!("https://img.youtube.com/vi/{id}/hqdefault.jpg"))
}

/// The video a note is about: the one attached, or else the first one on a line of its own.
fn note_video(text: &str, attached: &str) -> Option<String> {
    if embeddable(attached).is_some() {
        return Some(attached.trim().to_string());
    }
    text.lines().map(str::trim).find(|l| !l.contains(' ') && embeddable(l).is_some()).map(String::from)
}

/// An embed block: WordPress shows the video or player itself, not a link.
fn embed_block(url: &str) -> Option<String> {
    let (slug, kind) = embeddable(url)?;
    let url = url.trim();
    let aspect = if kind == "video" { " wp-embed-aspect-16-9 wp-has-aspect-ratio" } else { "" };
    let attrs = json!({
        "url": url, "type": kind, "providerNameSlug": slug, "responsive": true,
        "className": aspect.trim(),
    });
    let mut attrs = attrs;
    if aspect.is_empty() {
        attrs.as_object_mut().unwrap().remove("className");
    }
    Some(format!(
        "<!-- wp:embed {attrs} -->\n<figure class=\"wp-block-embed is-type-{kind} is-provider-{slug} wp-block-embed-{slug}{aspect}\"><div class=\"wp-block-embed__wrapper\">\n{}\n</div></figure>\n<!-- /wp:embed -->",
        esc_html(url)
    ))
}

/// A note's words as HTML paragraphs, with web addresses made into links.
/// A YouTube (or Vimeo, Spotify…) address on a line of its own becomes the player.
fn note_html(text: &str) -> String {
    static URL: OnceLock<regex::Regex> = OnceLock::new();
    let re = URL.get_or_init(|| regex::Regex::new(r#"https?://[^\s<>"]+[^\s<>".,;:!?)\]]"#).unwrap());
    text.trim()
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .flat_map(|p| {
            // lines starting with ">" are a quote from the post you're answering
            if p.lines().all(|l| l.trim_start().starts_with('>')) {
                let q: Vec<&str> = p.lines().map(|l| l.trim_start().trim_start_matches('>').trim_start()).collect();
                let inner = para(&q.join("\n"), re);
                return vec![format!("<!-- wp:quote -->\n<blockquote class=\"wp-block-quote\">{inner}</blockquote>\n<!-- /wp:quote -->")];
            }
            // a line that's only a playable address becomes a player; the lines around it stay words
            let mut parts: Vec<String> = Vec::new();
            let mut words: Vec<&str> = Vec::new();
            for line in p.lines() {
                match embed_block(line).filter(|_| !line.trim().contains(' ')) {
                    Some(block) => {
                        if !words.is_empty() {
                            parts.push(para(&words.join("\n"), re));
                            words.clear();
                        }
                        parts.push(block);
                    }
                    None => words.push(line),
                }
            }
            if !words.is_empty() && !words.join("").trim().is_empty() {
                parts.push(para(&words.join("\n"), re));
            }
            parts
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn para(p: &str, re: &regex::Regex) -> String {
    // [words](https://…) is a link with its own words: how a reply mentions someone (their name, linking to
    // their site, so the Webmention plugin tells them). Bare web addresses become links too.
    static MD: OnceLock<regex::Regex> = OnceLock::new();
    let md = MD.get_or_init(|| regex::Regex::new(r#"\[([^\]\n]{1,80})\]\((https?://[^\s<>"()]+)\)"#).unwrap());
    let bare = |t: &str| -> String {
        let mut out = String::new();
        let mut last = 0;
        for m in re.find_iter(t) {
            out.push_str(&esc_html(&t[last..m.start()]));
            let u = html_escape::encode_double_quoted_attribute(m.as_str());
            out.push_str(&format!("<a href=\"{u}\">{}</a>", esc_html(m.as_str())));
            last = m.end();
        }
        out.push_str(&esc_html(&t[last..]));
        out
    };
    let mut out = String::new();
    let mut last = 0;
    for c in md.captures_iter(p) {
        let m = c.get(0).unwrap();
        out.push_str(&bare(&p[last..m.start()]));
        let u = html_escape::encode_double_quoted_attribute(&c[2]);
        out.push_str(&format!("<a class=\"u-mention\" href=\"{u}\">{}</a>", esc_html(&c[1])));
        last = m.end();
    }
    out.push_str(&bare(&p[last..]));
    format!("<!-- wp:paragraph -->\n<p>{}</p>\n<!-- /wp:paragraph -->", out.trim().replace('\n', "<br>\n"))
}

/// The Notes category's id, made the first time.
async fn notes_category() -> Result<i64, String> {
    let found = wp(reqwest::Method::GET, "/wp/v2/categories?slug=notes", None).await?;
    if let Some(id) = found.as_array().and_then(|a| a.first()).and_then(|c| c["id"].as_i64()) {
        return Ok(id);
    }
    let made = wp(reqwest::Method::POST, "/wp/v2/categories", Some(json!({ "name": "Notes", "slug": "notes", "description": "Short notes, posted from The Reading Room." }))).await?;
    made["id"].as_i64().ok_or_else(|| "Couldn't make the Notes category on your site.".to_string())
}

fn photo_bytes(photo: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let b64 = photo.split_once(',').map(|(_, b)| b).unwrap_or(photo);
    base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|_| "Couldn't read that photo.".to_string())
}

/// Post a note to your own site: the words, an optional photo (in the note and as its featured image, with its
/// description), and an optional link. Notes go in the Notes category. A draft stays on your site, unpublished.
#[tauri::command]
pub async fn site_note(title: Option<String>, text: String, link: String, link_title: String, photo: String, alt: String, draft: bool, link_image: Option<String>, link_site: Option<String>, repost: Option<bool>) -> Result<SiteNote, String> {
    let repost = repost.unwrap_or(false) && link.starts_with("http");
    if text.trim().is_empty() && photo.is_empty() && !repost {
        return Err("Write something first.".into());
    }
    let s = secret_get("wordpress").ok_or("Connect your site first.")?;
    let cat = notes_category().await?;
    let mut html = note_html(&text);
    let (mut media_id, mut image) = (0i64, String::new());
    if !photo.is_empty() {
        let bytes = photo_bytes(&photo)?;
        let name = format!("note-{}.jpg", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
        let up = wp_auth(client().post(format!("{}/wp-json/wp/v2/media", st(&s, "site"))), &st(&s, "user"), &st(&s, "password"))
            .header("Content-Type", "image/jpeg")
            .header("Content-Disposition", format!("attachment; filename=\"{name}\""))
            .body(bytes)
            .timeout(Duration::from_secs(90));
        let m = call(up).await.map_err(wp_fail)?;
        media_id = m["id"].as_i64().unwrap_or(0);
        image = st(&m, "source_url");
        if media_id > 0 && !alt.trim().is_empty() {
            let _ = wp(reqwest::Method::POST, &format!("/wp/v2/media/{media_id}"), Some(json!({ "alt_text": alt.trim() }))).await;
        }
        if !image.is_empty() {
            // an image block with "click to enlarge" on, so readers can see the photo full size
            html.push_str(&format!(
                "\n<!-- wp:image {{\"id\":{media_id},\"sizeSlug\":\"large\",\"linkDestination\":\"none\",\"lightbox\":{{\"enabled\":true}},\"className\":\"note-photo\"}} -->\n<figure class=\"wp-block-image size-large note-photo\"><img src=\"{}\" alt=\"{}\" class=\"wp-image-{media_id}\"/></figure>\n<!-- /wp:image -->",
                html_escape::encode_double_quoted_attribute(&image),
                html_escape::encode_double_quoted_attribute(alt.trim())
            ));
        }
    }
    // a video you're writing about plays right in the post (unless the note already shows it)
    if let Some(block) = embed_block(&link).filter(|_| !html.contains(&format!("\"url\":\"{}\"", link.trim()))) {
        html.push('\n');
        html.push_str(&block);
    } else if link.starts_with("http") && embeddable(&link).is_none() {
        let label = if link_title.trim().is_empty() { link.clone() } else { link_title.trim().to_string() };
        let site = link_site.unwrap_or_default().trim().to_string();
        let pic_url = link_image.unwrap_or_default().trim().to_string();
        // the post's own picture, copied to your Media Library (credited to its site), for a card and the featured image
        let mut pic = (0i64, String::new());
        if pic_url.starts_with("http") {
            if let Some((bytes, kind)) = fetch_picture(&pic_url).await {
                let ext = match kind.as_str() { "image/png" => "png", "image/webp" => "webp", "image/gif" => "gif", _ => "jpg" };
                let name = format!("note-link-{}.{ext}", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
                let up = wp_auth(client().post(format!("{}/wp-json/wp/v2/media", st(&s, "site"))), &st(&s, "user"), &st(&s, "password"))
                    .header("Content-Type", kind)
                    .header("Content-Disposition", format!("attachment; filename=\"{name}\""))
                    .body(bytes)
                    .timeout(Duration::from_secs(90));
                if let Ok(m) = call(up).await {
                    let id = m["id"].as_i64().unwrap_or(0);
                    if id > 0 {
                        let credit = if site.is_empty() { label.clone() } else { site.clone() };
                        let _ = wp(reqwest::Method::POST, &format!("/wp/v2/media/{id}"), Some(json!({
                            "caption": format!("Photo: <a href=\"{}\">{}</a>", html_escape::encode_double_quoted_attribute(&link), esc_html(&credit)),
                            "alt_text": format!("Photo from “{}”", label),
                        }))).await;
                    }
                    pic = (id, st(&m, "source_url"));
                }
            }
        }
        html.push('\n');
        html.push_str(&link_card(&link, &label, &site, &pic.1, repost));
        if media_id == 0 && pic.0 > 0 {
            media_id = pic.0; // your own photo, if you added one, stays the featured image
        }
    }
    // a title is optional: without one, the site shows the note's first words
    let title = title.unwrap_or_default().trim().to_string();
    let mut post = json!({ "title": title, "content": html, "status": if draft { "draft" } else { "publish" }, "categories": [cat] });
    if media_id > 0 {
        post["featured_media"] = json!(media_id);
    }
    let p = wp(reqwest::Method::POST, "/wp/v2/posts", Some(post)).await?;
    Ok(SiteNote { url: st(&p, "link"), id: p["id"].as_i64().unwrap_or(0), image })
}

/// Download a post's picture to put on your site: an image under 10 MB, or nothing.
async fn fetch_picture(url: &str) -> Option<(Vec<u8>, String)> {
    let resp = client().get(url).timeout(Duration::from_secs(30)).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let kind = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if !matches!(kind.as_str(), "image/jpeg" | "image/jpg" | "image/png" | "image/webp" | "image/gif") {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > 10_000_000 {
        return None;
    }
    Some((bytes.to_vec(), if kind == "image/jpg" { "image/jpeg".into() } else { kind }))
}

/// A card for the post a note is about: its picture (if any), title and site, all one link to it. Marked up as
/// a bookmark (u-bookmark-of h-cite), so sites that take Webmentions can show the note as a share of their post.
/// A repost is the same card marked u-repost-of, with a "Reposted" line, so the post's site can show it as one.
fn link_card(link: &str, title: &str, site: &str, image: &str, repost: bool) -> String {
    let href = html_escape::encode_double_quoted_attribute(link);
    let (kind, lead) = if repost { ("u-repost-of", "<span style=\"display:block;font-size:.8em;opacity:.7;margin-bottom:.2em\">↻ Reposted</span>") } else { ("u-bookmark-of", "") };
    let pic = if image.is_empty() {
        String::new()
    } else {
        format!("<img class=\"u-photo\" src=\"{}\" alt=\"\" style=\"display:block;width:100%;height:auto;margin:0;aspect-ratio:auto\">", html_escape::encode_double_quoted_attribute(image))
    };
    let from = if site.is_empty() { String::new() } else { format!("<span class=\"p-author h-card\" style=\"display:block;font-size:.85em;opacity:.7;margin-top:.2em\">{}</span>", esc_html(site)) };
    format!(
        "<!-- wp:html -->\n<a class=\"note-link note-card {kind} h-cite\" href=\"{href}\" style=\"display:block;border:1px solid rgba(128,128,128,.35);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit\">{pic}<span style=\"display:block;padding:.75em 1em\">{lead}<strong class=\"p-name\">→ {}</strong>{from}</span></a>\n<!-- /wp:html -->",
        esc_html(title)
    )
}

/// Shorten words to fit a network's limit with room for the link home, ending on a word.
fn fit(text: &str, room: usize) -> String {
    let t = text.trim();
    if t.chars().count() <= room {
        return t.to_string();
    }
    let cut: String = t.chars().take(room.saturating_sub(1)).collect();
    let cut = match cut.rfind(char::is_whitespace) {
        Some(i) if i > room / 2 => cut[..i].to_string(),
        _ => cut,
    };
    format!("{}…", cut.trim_end())
}

async fn masto_media(bytes: &[u8], alt: &str) -> Result<String, String> {
    let m = masto_saved()?;
    let boundary = format!("rr{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"description\"\r\n\r\n{}\r\n", alt.trim()).as_bytes());
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let req = client()
        .post(format!("https://{}/api/v2/media", st(&m, "instance")))
        .bearer_auth(st(&m, "token"))
        .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
        .body(body)
        .timeout(Duration::from_secs(90));
    let v = call(req).await.map_err(explain)?;
    let id = st(&v, "id");
    // big pictures are processed after the upload; wait for them before posting
    if v["url"].is_null() {
        for _ in 0..15 {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Ok(x) = masto(reqwest::Method::GET, &format!("/api/v1/media/{id}"), &[], None).await {
                if !x["url"].is_null() {
                    break;
                }
            }
        }
    }
    Ok(id)
}

/// Share copies of a note you posted on your site: the words (shortened if needed), the photo attached
/// with its description, and the link home. A note about a video gets the video's picture on its Bluesky
/// card (still linking home), and on Mastodon the video's address, so its preview shows the video.
#[tauri::command]
pub async fn social_share_note(networks: Vec<String>, text: String, link: String, title: String, photo: String, alt: String, video: Option<String>) -> Vec<Posted> {
    let bytes = if photo.is_empty() { None } else { photo_bytes(&photo).ok() };
    let video = note_video(&text, video.as_deref().unwrap_or("")).filter(|v| v != &link);
    let thumb = video.as_deref().and_then(video_thumb).or_else(|| video_thumb(&link)).unwrap_or_default();
    // on Mastodon the video's address goes before the link home (the first link makes the preview),
    // unless your words already include it
    let masto_video = video.clone().filter(|v| !text.contains(v.as_str()));
    let mut out = Vec::new();
    for n in networks {
        let mut warn = String::new();
        let r: Result<String, String> = match n.as_str() {
            "bluesky" => async {
                let s = bsky_session(false).await?;
                if let Some(b) = &bytes {
                    let words = fit(&text, if link.is_empty() { 300 } else { 300 - link.chars().count() - 2 });
                    let full = if link.is_empty() { words } else if words.is_empty() { link.clone() } else { format!("{words}\n\n{link}") };
                    let up = client()
                        .post(format!("{}/xrpc/com.atproto.repo.uploadBlob", s.pds))
                        .bearer_auth(&s.jwt)
                        .header("Content-Type", "image/jpeg")
                        .body(b.clone())
                        .timeout(Duration::from_secs(60));
                    let blob = call(up).await.map_err(explain)?;
                    let mut record = json!({
                        "$type": "app.bsky.feed.post", "text": full, "langs": ["en"],
                        "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
                        "embed": { "$type": "app.bsky.embed.images", "images": [{ "alt": alt.trim(), "image": blob["blob"] }] },
                    });
                    let facets = link_facets(&full);
                    if !facets.is_empty() {
                        record["facets"] = Value::Array(facets);
                    }
                    let v = bsky(false, "com.atproto.repo.createRecord", &[], Some(json!({ "repo": s.did, "collection": "app.bsky.feed.post", "record": record }))).await?;
                    Ok(bsky_web_url(&st(&v, "uri"), &s.handle))
                } else {
                    // no photo: the words, and a card for the note on your site
                    let words = fit(&text, 300);
                    bsky_post(&words, &link, &title, &fit(&text, 200), &thumb).await
                }
            }
            .await,
            "mastodon" => async {
                let links: Vec<&str> = masto_video.iter().map(String::as_str).chain(Some(link.as_str()).filter(|l| !l.is_empty())).collect();
                let words = fit(&text, 500 - links.len() * 25); // Mastodon counts every link as 23
                let status = std::iter::once(words.as_str()).chain(links.iter().copied()).filter(|p| !p.trim().is_empty()).collect::<Vec<_>>().join("\n\n");
                let mut body = json!({ "status": status, "visibility": "public" });
                if let Some(b) = &bytes {
                    // if the server won't take the photo, post the words and link anyway, and say why
                    match masto_media(b, &alt).await {
                        Ok(id) => body["media_ids"] = json!([id]),
                        Err(e) => {
                            warn = if e.contains("scope") {
                                "Posted without the photo: your Mastodon connection doesn't allow pictures yet. Disconnect Mastodon and connect it again to allow them.".into()
                            } else {
                                format!("Posted without the photo: {e}")
                            };
                        }
                    }
                }
                masto(reqwest::Method::POST, "/api/v1/statuses", &[], Some(body)).await.map(|v| st(&v, "url"))
            }
            .await,
            _ => Err("Unknown network.".into()),
        };
        out.push(match r {
            Ok(url) => Posted { network: n, url, error: String::new(), warning: warn },
            Err(error) => Posted { network: n, url: String::new(), error, warning: String::new() },
        });
    }
    out
}

#[cfg(test)]
mod note_tests {
    use super::*;
    #[test]
    fn notes_become_paragraphs_with_links() {
        let h = note_html("Hello <you> & me\nsecond line\n\nSee https://example.com/a?b=1&c=2.");
        assert_eq!(h, "<!-- wp:paragraph -->\n<p>Hello &lt;you&gt; &amp; me<br>\nsecond line</p>\n<!-- /wp:paragraph -->\n<!-- wp:paragraph -->\n<p>See <a href=\"https://example.com/a?b=1&amp;c=2\">https://example.com/a?b=1&amp;c=2</a>.</p>\n<!-- /wp:paragraph -->");
    }
    #[test]
    fn long_notes_are_shortened_on_a_word() {
        assert_eq!(fit("short", 10), "short");
        let f = fit("one two three four five six", 15);
        assert!(f.chars().count() <= 15 && f.ends_with('…'), "{f}");
        assert_eq!(f, "one two three…");
    }
}

#[cfg(test)]
mod embed_tests {
    use super::*;

    #[test]
    fn video_addresses_become_players() {
        let h = note_html("Worth a watch.\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nMore at https://youtu.be/abc in a sentence.");
        assert!(h.contains("<!-- wp:embed {"));
        assert!(h.contains("\"providerNameSlug\":\"youtube\""));
        assert!(h.contains("<p>Worth a watch.</p>"));
        // inside a sentence it stays a link
        assert!(h.contains("<a href=\"https://youtu.be/abc\">"));
        assert_eq!(h.matches("wp:embed {").count(), 1);
        assert!(embed_block("https://open.spotify.com/episode/x").unwrap().contains("is-type-rich"));
        assert!(embeddable("https://www.youtube.com/@someone").is_none());
        assert!(embeddable("https://daverupert.com/2026/post/").is_none());
    }

    #[test]
    fn notes_about_videos_find_the_video_and_its_picture() {
        assert_eq!(video_thumb("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10").as_deref(), Some("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"));
        assert_eq!(video_thumb("https://youtu.be/dQw4w9WgXcQ?si=x").as_deref(), Some("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"));
        assert!(video_thumb("https://youtube.com/shorts/abc_-1").is_some());
        assert!(video_thumb("https://vimeo.com/123").is_none());
        assert_eq!(note_video("hi", "https://youtu.be/x1").as_deref(), Some("https://youtu.be/x1"));
        assert_eq!(note_video("Look:\nhttps://www.youtube.com/watch?v=x1\nnice", "https://blog.example/post").as_deref(), Some("https://www.youtube.com/watch?v=x1"));
        assert!(note_video("see https://youtu.be/x1 in a sentence", "").is_none());
    }
}

#[cfg(test)]
mod icon_tests {
    #[test]
    fn picks_the_biggest_site_icon() {
        let base = url::Url::parse("https://ex.blog/").unwrap();
        let html = r#"<head><link rel="icon" href="/fav-32.png" sizes="32x32"><link rel="icon" href="/fav-192.png" sizes="192x192">
            <link rel='apple-touch-icon' href='https://cdn.ex.blog/touch.png'></head>"#;
        assert_eq!(super::site_icon(html, &base), "https://cdn.ex.blog/touch.png");
        assert_eq!(super::site_icon(r#"<link rel="icon" href="/fav-192.png" sizes="192x192">"#, &base), "https://ex.blog/fav-192.png");
        assert_eq!(super::site_icon(r#"<link rel="shortcut icon" href="/favicon.ico">"#, &base), "");
    }
}

#[cfg(test)]
mod likes_tests {
    #[test]
    fn likes_page_entries() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-10T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        let raw = format!("<p>Intro</p>\n<!-- wp:html -->\n{}\n</ul>\n<!-- /wp:html -->", super::LIKES_START);
        let one = super::likes_update(&raw, "https://a.blog/x", "A & B", "Ann", true, now);
        assert!(one.contains(r#"<a class="u-like-of" href="https://a.blog/x">A &amp; B</a> by Ann"#));
        let two = super::likes_update(&one, "https://b.blog/y", "Y", "", true, now);
        assert!(two.find("b.blog/y").unwrap() < two.find("a.blog/x").unwrap());
        let again = super::likes_update(&two, "https://a.blog/x", "A & B", "Ann", true, now);
        assert_eq!(again.matches("a.blog/x").count(), 1);
        let gone = super::likes_update(&again, "https://a.blog/x", "", "", false, now);
        assert!(!gone.contains("a.blog/x") && gone.contains("b.blog/y") && gone.ends_with("</ul>\n<!-- /wp:html -->"));
    }
}

#[cfg(test)]
mod their_likes_tests {
    #[test]
    fn mentions_become_links() {
        let h = super::note_html("Thanks [Jo Hart](https://johart.blog/) and see https://a.b/c too.");
        assert!(h.contains(r#"<a class="u-mention" href="https://johart.blog/">Jo Hart</a>"#), "{h}");
        assert!(h.contains(r#"<a href="https://a.b/c">https://a.b/c</a>"#), "{h}");
        assert!(!h.contains("[Jo"));
    }

    #[test]
    fn finds_a_posts_comments() {
        let base = url::Url::parse("https://b.blog/2026/11/hello/").unwrap();
        let html = r#"<head><link rel="alternate" type="application/rss+xml" title="B &raquo; Feed" href="https://b.blog/feed/">
            <link rel="alternate" type="application/rss+xml" title="B &raquo; Comments Feed" href="https://b.blog/comments/feed/">
            <link rel="alternate" type="application/rss+xml" title="B &raquo; Hello Comments Feed" href="https://b.blog/2026/11/hello/feed/">
            <link rel="alternate" title="JSON" type="application/json" href="https://b.blog/wp-json/wp/v2/posts/412"></head>"#;
        let (api, feed) = super::comment_sources(html, &base);
        assert_eq!(api.as_deref(), Some("https://b.blog/wp-json/wp/v2/posts/412"));
        assert_eq!(feed.as_deref(), Some("https://b.blog/2026/11/hello/feed/"));
    }

    #[test]
    fn mastodon_next_page() {
        let l = r#"<https://m.s/api/v1/accounts/1/following?limit=80&max_id=7731>; rel="next", <https://m.s/api/v1/accounts/1/following?limit=80&since_id=9>; rel="prev""#;
        assert_eq!(super::next_max_id(l).as_deref(), Some("7731"));
        assert_eq!(super::next_max_id(r#"<https://m.s/x?since_id=9>; rel="prev""#), None);
    }

    #[test]
    fn repost_card_is_marked_as_a_repost() {
        let c = super::link_card("https://b.blog/p/", "A post", "B", "", true);
        assert!(c.contains("u-repost-of h-cite") && c.contains("Reposted"));
        assert!(super::link_card("https://b.blog/p/", "A post", "B", "", false).contains("u-bookmark-of"));
    }

    #[test]
    fn quotes_in_notes() {
        let h = super::note_html("> They said this.\n> And this.\n\nMy answer.");
        assert!(h.starts_with("<!-- wp:quote -->\n<blockquote class=\"wp-block-quote\"><!-- wp:paragraph -->\n<p>They said this.<br>\nAnd this.</p>"));
        assert!(h.contains("<p>My answer.</p>"));
        assert!(!super::note_html("a > b").contains("blockquote"));
    }
    #[test]
    fn reads_likes_and_bookmarks() {
        let base = url::Url::parse("https://ann.blog/likes/").unwrap();
        let html = r#"<li class="h-entry">Liked <a class="u-like-of" href="https://bob.blog/post">P</a></li>
            <a href="https://ann.blog/x" class="u-like-of">own</a> <a class="p-name u-bookmark-of h-cite" href="https://cat.blog/a?x=1&amp;y=2">B</a>
            <a class="u-url" href="https://dan.blog/">not a like</a> <a class="u-like-of" href="https://bob.blog/post">again</a>"#;
        assert_eq!(super::liked_links(html, &base), vec!["https://bob.blog/post", "https://cat.blog/a?x=1&y=2"]);
    }
}
