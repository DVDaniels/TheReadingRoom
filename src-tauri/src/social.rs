//! Talking with people on Mastodon and Bluesky, from the reader.
//!
//! - Connect your own account: Bluesky with an App Password, Mastodon by approving the app on your server.
//!   What it takes to sign in is kept in the Keychain on this device, never in the app's files or the sync folder.
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
const MASTO_SCOPES: &str = "read write:statuses write:mutes write:blocks write:reports";
/// Bluesky's own moderation service, which receives reports
const BSKY_MODERATION: &str = "did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler";

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(crate::feeds::client)
}

// ------------------------------------------------------------------ the Keychain

fn secret_get(key: &str) -> Option<Value> {
    let e = keyring::Entry::new(SERVICE, key).ok()?;
    serde_json::from_str(&e.get_password().ok()?).ok()
}

fn secret_set(key: &str, v: &Value) -> Result<(), String> {
    keyring::Entry::new(SERVICE, key)
        .and_then(|e| e.set_password(&v.to_string()))
        .map_err(|e| format!("Couldn't save the sign-in to the Keychain ({e})."))
}

fn secret_delete(key: &str) {
    if let Ok(e) = keyring::Entry::new(SERVICE, key) {
        let _ = e.delete_credential();
    }
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
        link: st(post, "embed.external.uri"),
        link_title: st(post, "embed.external.title"),
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
        link: st(s, "card.url"),
        link_title: st(s, "card.title"),
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
}

#[tauri::command]
pub fn social_accounts() -> Accounts {
    Accounts {
        bluesky: secret_get("bluesky").map(|v| json!({ "handle": format!("@{}", st(&v, "handle")) })),
        mastodon: secret_get("mastodon").map(|v| json!({ "handle": format!("@{}@{}", st(&v, "acct"), st(&v, "instance")) })),
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
        &json!({ "client_name": "The Reading Room", "redirect_uris": OOB, "scopes": MASTO_SCOPES, "website": "https://daviddaniels.com/reading-room/" }),
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
}

/// Post a story with your note to the networks you chose.
#[tauri::command]
pub async fn social_post(networks: Vec<String>, text: String, link: String, title: String, description: String, image: String) -> Vec<Posted> {
    let mut out = Vec::new();
    for n in networks {
        let r = match n.as_str() {
            "bluesky" => bsky_post(text.trim(), &link, &title, &description, &image).await,
            "mastodon" => {
                let status = if text.trim().is_empty() { link.clone() } else { format!("{}\n\n{link}", text.trim()) };
                masto(reqwest::Method::POST, "/api/v1/statuses", &[], Some(json!({ "status": status, "visibility": "public" })))
                    .await
                    .map(|v| st(&v, "url"))
            }
            _ => Err("Unknown network.".into()),
        };
        out.push(match r {
            Ok(url) => Posted { network: n, url, error: String::new() },
            Err(error) => Posted { network: n, url: String::new(), error },
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
                .filter(|n| !n.link.is_empty())
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
                .filter(|n| !n.link.is_empty() || n.text.contains("http"))
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
        ("bluesky", "report") => bsky(false, "com.atproto.moderation.createReport", &[], Some(json!({
            "reasonType": "com.atproto.moderation.defs#reasonOther", "reason": reason,
            "subject": { "$type": "com.atproto.repo.strongRef", "uri": post_id, "cid": post_cid },
        }))).await.map(|_| ()),
        ("mastodon", "mute") => masto(reqwest::Method::POST, &format!("/api/v1/accounts/{person}/mute"), &[], Some(json!({}))).await.map(|_| ()),
        ("mastodon", "block") => masto(reqwest::Method::POST, &format!("/api/v1/accounts/{person}/block"), &[], Some(json!({}))).await.map(|_| ()),
        ("mastodon", "report") => masto(reqwest::Method::POST, "/api/v1/reports", &[],
            Some(json!({ "account_id": person, "status_ids": [post_id], "comment": reason, "forward": true }))).await.map(|_| ()),
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
