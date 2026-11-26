//! Micropub: posting to Micro.blog, Pika and other IndieWeb sites (The Reading Room Plus), the open way.
//!
//! - Connect: you type your site's address. The app reads the page for its Micropub address (rel="micropub") and,
//!   when the site signs in with IndieAuth (rel="authorization_endpoint" / "token_endpoint"), opens your site's own
//!   sign-in page; after you approve, readingroomapp.com/connect/micropub/ shows a code to paste back (it only shows
//!   it). Sites that hand out app tokens instead (Micro.blog, Pika) can be connected by pasting one. What it takes to
//!   stay signed in is kept in the Keychain, like the other accounts.
//! - When your site is a Micropub site (and no WordPress site is connected), Writing's site_* commands come here.
//!   Your words go as Markdown (Micro.blog and Pika both read it), the title as `name`, Weeknotes with the category
//!   "weeknotes", drafts as post-status draft, a photo through the site's media endpoint. Listing posts and drafts
//!   uses `q=source`, which some sites don't offer: then Writing's lists stay empty and say so.
//! - Micropub has no stats, so Your blog doesn't show for these sites.
//!
//! Posts are known by their address; the interface needs numbers, so each address gets a small number of its own.

use crate::social::{call, client, explain, photo_bytes, secret_delete, secret_get, secret_set, social_accounts, st, Accounts, SiteNote};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Mutex;

const KEY: &str = "micropub";
const IDS: &str = "micropub.ids";
const CLIENT_ID: &str = "https://readingroomapp.com/";
const REDIRECT: &str = "https://readingroomapp.com/connect/micropub/";
const SCOPE: &str = "create update delete media draft profile";
/// Weeknotes and Notes, the way Writing sorts posts (Notes: posts without a title)
const CATS: [(i64, &str, &str); 2] = [(1, "notes", "Notes"), (2, "weeknotes", "Weeknotes")];

/// A Micropub site is where Writing posts: it's connected and no WordPress site is.
pub fn is_home() -> bool {
    secret_get("wordpress").is_none() && secret_get(KEY).is_some()
}

/// The connected site, for the accounts list.
pub fn account() -> Option<Value> {
    let s = secret_get(KEY)?;
    let host = url::Url::parse(&st(&s, "me")).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
    Some(json!({ "site": st(&s, "me").trim_end_matches('/'), "name": if st(&s, "name").is_empty() { host.clone() } else { st(&s, "name") }, "handle": host, "service": st(&s, "service") }))
}

// ------------------------------------------------------------------ connecting

struct Pending {
    me: String,
    micropub: String,
    token_endpoint: String,
    verifier: String,
    #[allow(dead_code)] // kept for a later check of the answer's state
    state: String,
    name: String,
}

fn pending() -> &'static Mutex<Option<Pending>> {
    static P: OnceLock<Mutex<Option<Pending>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

/// What a site's home page says about posting to it.
struct Found {
    me: String,
    micropub: String,
    auth: String,
    token: String,
    name: String,
}

fn site_url(input: &str) -> Result<url::Url, String> {
    let t = input.trim().trim_end_matches('/');
    if t.is_empty() || !t.contains('.') {
        return Err("Type your site's address, like you.micro.blog or you.pika.page.".into());
    }
    let full = if t.contains("://") { t.to_string() } else { format!("https://{t}") };
    let mut u = url::Url::parse(&full).map_err(|_| "That doesn't look like a web address.".to_string())?;
    if u.path().is_empty() {
        u.set_path("/");
    }
    Ok(u)
}

async fn find(site: &str) -> Result<Found, String> {
    let u = site_url(site)?;
    let r = client().get(u.as_str()).timeout(Duration::from_secs(20)).send().await.map_err(|_| format!("Couldn't reach {}. Check the address.", u.host_str().unwrap_or("that site")))?;
    let base = r.url().clone();
    let link = r.headers().get_all("link").iter().filter_map(|v| v.to_str().ok()).collect::<Vec<_>>().join(", ");
    let html = r.text().await.unwrap_or_default();
    let mut cut = html.len().min(600_000);
    while !html.is_char_boundary(cut) {
        cut -= 1;
    }
    let html = &html[..cut];
    let rel = |want: &str| crate::webmention::rel_in(&link, html, &base, want).unwrap_or_default();
    let mut auth = rel("authorization_endpoint");
    let mut token = rel("token_endpoint");
    // newer IndieAuth sites list both in a small metadata file
    let meta = rel("indieauth-metadata");
    if !meta.is_empty() {
        if let Ok(m) = call(client().get(&meta).header("Accept", "application/json")).await {
            auth = Some(st(&m, "authorization_endpoint")).filter(|x| !x.is_empty()).unwrap_or(auth);
            token = Some(st(&m, "token_endpoint")).filter(|x| !x.is_empty()).unwrap_or(token);
        }
    }
    static TITLE: OnceLock<regex::Regex> = OnceLock::new();
    let name = TITLE.get_or_init(|| regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap())
        .captures(html).map(|c| html_escape::decode_html_entities(c[1].trim()).to_string()).unwrap_or_default();
    Ok(Found { me: base.to_string(), micropub: rel("micropub"), auth, token, name: name.chars().take(80).collect() })
}

/// Step one: find the site's Micropub address. With IndieAuth, returns your site's sign-in page to open;
/// without it (or with `token`), the app asks for an app token instead and this returns "".
#[tauri::command]
pub async fn micropub_begin(site: String) -> Result<String, String> {
    let f = find(&site).await?;
    if f.micropub.is_empty() {
        return Err("That site doesn't say where apps can post to it (no Micropub). Micro.blog, Pika and WordPress with the IndieWeb plugins do.".into());
    }
    if f.auth.is_empty() || f.token.is_empty() {
        *pending().lock().await = Some(Pending { me: f.me, micropub: f.micropub, token_endpoint: String::new(), verifier: String::new(), state: String::new(), name: f.name });
        return Ok(String::new());
    }
    let verifier = random_string(64);
    let state = random_string(24);
    let mut u = url::Url::parse(&f.auth).map_err(|_| "The site's sign-in address isn't a web address.".to_string())?;
    u.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT)
        .append_pair("state", &state)
        .append_pair("code_challenge", &b64url(&sha256(verifier.as_bytes())))
        .append_pair("code_challenge_method", "S256")
        .append_pair("scope", SCOPE)
        .append_pair("me", &f.me);
    *pending().lock().await = Some(Pending { me: f.me, micropub: f.micropub, token_endpoint: f.token, verifier, state, name: f.name });
    Ok(u.to_string())
}

/// Step two: the code from readingroomapp.com (or the whole address), or an app token the site gave you.
#[tauri::command]
pub async fn micropub_finish(code: Option<String>, token: Option<String>) -> Result<Accounts, String> {
    let p = pending().lock().await.take().ok_or("Start again: type your site's address and press Continue.")?;
    let (access, me) = match token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(t) => (t, p.me.clone()),
        None => {
            let code = code_from(code.as_deref().unwrap_or(""));
            if code.is_empty() || p.token_endpoint.is_empty() {
                *pending().lock().await = Some(p);
                return Err("Paste the code from the page that opened after you approved the app.".into());
            }
            let tok = call(client().post(&p.token_endpoint).header("Accept", "application/json").form(&[
                ("grant_type", "authorization_code"), ("code", code.as_str()), ("client_id", CLIENT_ID), ("redirect_uri", REDIRECT), ("code_verifier", p.verifier.as_str()),
            ]))
            .await
            .map_err(|e| if e.0 == 400 || e.0 == 401 { "That code didn't work. Codes work once and only for a few minutes: press Continue again.".to_string() } else { explain(e) })?;
            let t = st(&tok, "access_token");
            if t.is_empty() {
                return Err("Your site didn't send a sign-in back. Try again.".into());
            }
            let me = Some(st(&tok, "me")).filter(|m| !m.is_empty()).unwrap_or(p.me.clone());
            (t, me)
        }
    };
    // check the sign-in works, and find where pictures go
    let cfg = call(client().get(with_q(&p.micropub, &[("q", "config")])).bearer_auth(&access).header("Accept", "application/json")).await;
    let cfg = match cfg {
        Ok(v) => v,
        Err(e) if e.0 == 401 || e.0 == 403 => return Err("Your site didn't accept that sign-in. Check the app token and try again.".into()),
        Err(_) => Value::Null, // some sites don't answer q=config; posting can still work
    };
    let service = url::Url::parse(&p.micropub).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
    // Micro.blog accounts can have several blogs: post to the one you signed in for
    let dest = cfg["destination"].as_array().and_then(|a| a.iter().find(|d| st(d, "uid").trim_end_matches('/') == me.trim_end_matches('/')).or(a.first())).map(|d| st(d, "uid")).unwrap_or_default();
    secret_set(KEY, &json!({ "me": me, "name": p.name, "micropub": p.micropub, "media": st(&cfg, "media-endpoint"), "token": access, "service": service, "destination": dest }))?;
    Ok(social_accounts())
}

#[tauri::command]
pub fn micropub_disconnect() -> Accounts {
    secret_delete(KEY);
    secret_delete(IDS);
    *ids().lock().unwrap_or_else(|e| e.into_inner()) = (None, false);
    social_accounts()
}

fn code_from(input: &str) -> String {
    let t = input.trim();
    if let Ok(u) = url::Url::parse(t) {
        if let Some((_, c)) = u.query_pairs().find(|(k, _)| k == "code") {
            return c.trim().to_string();
        }
    }
    t.trim_start_matches("code=").split('&').next().unwrap_or("").trim().to_string()
}

fn with_q(base: &str, q: &[(&str, &str)]) -> String {
    match url::Url::parse(base) {
        Ok(mut u) => {
            u.query_pairs_mut().extend_pairs(q);
            u.to_string()
        }
        Err(_) => base.to_string(),
    }
}

/// A random string for the sign-in (PKCE verifier, state), from the system's randomness.
fn random_string(n: usize) -> String {
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut bytes = vec![0u8; n];
    if getrandom(&mut bytes).is_err() {
        // never expected; still unpredictable enough for one sign-in
        let seed = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0) as u64 ^ (std::process::id() as u64) << 32;
        let mut x = seed | 1;
        for b in bytes.iter_mut() {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            *b = x as u8;
        }
    }
    bytes.iter().map(|b| ABC[*b as usize % ABC.len()] as char).collect()
}

pub(crate) fn getrandom(buf: &mut [u8]) -> std::io::Result<()> {
    use std::io::Read;
    std::fs::File::open("/dev/urandom")?.read_exact(buf)
}

pub(crate) fn b64url(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// SHA-256 (for the PKCE code challenge), so the app needs no new library for one hash.
pub(crate) fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&((data.len() as u64) * 8).to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    let mut out = [0u8; 32];
    for (i, x) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&x.to_be_bytes());
    }
    out
}

// ------------------------------------------------------------------ talking to the site

fn saved() -> Result<Value, String> {
    secret_get(KEY).ok_or_else(|| "Connect your site first.".to_string())
}

fn fail(e: (u16, String)) -> String {
    let v: Value = serde_json::from_str(&e.1).unwrap_or(Value::Null);
    let said = [st(&v, "error_description"), st(&v, "error")].into_iter().find(|x| !x.is_empty()).unwrap_or_default();
    match e.0 {
        401 | 403 => "Your site didn't accept the sign-in. Connect it again in Settings › Connections.".into(),
        404 => "Your site couldn't find that post. It may have been deleted there.".into(),
        _ if !said.is_empty() => format!("Your site said: {said}"),
        _ => explain(e),
    }
}

/// POST to the Micropub address: a new post (201 + Location), or an action (update, delete).
async fn send(body: &Value) -> Result<String, String> {
    let s = saved()?;
    let mut body = body.clone();
    if !st(&s, "destination").is_empty() {
        body["mp-destination"] = json!(st(&s, "destination"));
    }
    let r = client().post(st(&s, "micropub")).bearer_auth(st(&s, "token")).header("Content-Type", "application/json").header("Accept", "application/json")
        .body(body.to_string()).timeout(Duration::from_secs(40)).send().await
        .map_err(|_| "Couldn't reach your site. Check your connection.".to_string())?;
    let status = r.status().as_u16();
    let loc = r.headers().get("location").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let text = r.text().await.unwrap_or_default();
    if status >= 400 {
        return Err(fail((status, text)));
    }
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    Ok(if loc.is_empty() { [st(&v, "url"), st(&v, "location")].into_iter().find(|x| !x.is_empty()).unwrap_or_default() } else { loc })
}

/// GET from the Micropub address with a query (q=source, q=config…).
async fn query(q: &[(&str, &str)]) -> Result<Value, String> {
    let s = saved()?;
    let mut q: Vec<(&str, &str)> = q.to_vec();
    let dest = st(&s, "destination");
    if !dest.is_empty() {
        q.push(("mp-destination", dest.as_str()));
    }
    call(client().get(with_q(&st(&s, "micropub"), &q)).bearer_auth(st(&s, "token")).header("Accept", "application/json")).await.map_err(fail)
}

/// Upload a photo to the site's media endpoint; its address goes in the post.
async fn upload(photo: &str) -> Result<String, String> {
    let s = saved()?;
    let media = st(&s, "media");
    if media.is_empty() {
        return Err("Your site doesn't take pictures from apps (no media endpoint), so post the photo on your site itself.".into());
    }
    let bytes = photo_bytes(photo)?;
    let boundary = format!("rr{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let mut form = Vec::new();
    form.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").as_bytes());
    form.extend_from_slice(&bytes);
    form.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let r = client().post(&media).bearer_auth(st(&s, "token")).header("Content-Type", format!("multipart/form-data; boundary={boundary}")).body(form)
        .timeout(Duration::from_secs(90)).send().await.map_err(|_| "Couldn't send the photo to your site.".to_string())?;
    let status = r.status().as_u16();
    let loc = r.headers().get("location").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let text = r.text().await.unwrap_or_default();
    if status >= 400 {
        return Err(fail((status, text)));
    }
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    Some(loc).filter(|l| !l.is_empty()).or_else(|| Some(st(&v, "url")).filter(|u| !u.is_empty())).ok_or_else(|| "Your site took the photo but didn't say where it is.".to_string())
}

// ------------------------------------------------------------------ post numbers the interface can hold

fn ids() -> &'static std::sync::Mutex<(Option<Value>, bool)> {
    static M: OnceLock<std::sync::Mutex<(Option<Value>, bool)>> = OnceLock::new();
    M.get_or_init(|| std::sync::Mutex::new((None, false)))
}

fn with_ids<T>(f: impl FnOnce(&mut Value, &mut bool) -> T) -> T {
    let mut g = ids().lock().unwrap_or_else(|e| e.into_inner());
    let (m, dirty) = &mut *g;
    let m = m.get_or_insert_with(|| secret_get(IDS).unwrap_or_else(|| json!({ "next": 1000, "ids": {} })));
    f(m, dirty)
}

fn flush_ids() {
    if let Some(m) = with_ids(|m, dirty| std::mem::take(dirty).then(|| m.clone())) {
        let _ = secret_set(IDS, &m);
    }
}

fn local_id(url: &str) -> i64 {
    if url.is_empty() {
        return 0;
    }
    with_ids(|m, dirty| {
        if let Some(n) = m["ids"][url].as_i64() {
            return n;
        }
        let n = m["next"].as_i64().unwrap_or(1000);
        m["next"] = json!(n + 1);
        m["ids"][url] = json!(n);
        *dirty = true;
        if let Some(o) = m["ids"].as_object_mut() {
            if o.len() > 600 {
                let mut all: Vec<(String, i64)> = o.iter().map(|(k, v)| (k.clone(), v.as_i64().unwrap_or(0))).collect();
                all.sort_by_key(|(_, v)| *v);
                for (k, _) in all.iter().take(o.len() - 600) {
                    o.remove(k);
                }
            }
        }
        n
    })
}

fn post_address(local: i64) -> Result<String, String> {
    with_ids(|m, _| m["ids"].as_object().and_then(|o| o.iter().find(|(_, v)| v.as_i64() == Some(local)).map(|(k, _)| k.clone())))
        .ok_or_else(|| "The app lost track of that post. Open Writing again to reload your posts.".to_string())
}

// ------------------------------------------------------------------ Writing's commands, for Micropub sites

fn first(p: &Value, key: &str) -> String {
    let v = &p["properties"][key][0];
    match v {
        Value::String(s) => s.clone(),
        Value::Object(_) => [st(v, "markdown"), st(v, "value"), st(v, "html")].into_iter().find(|x| !x.is_empty()).unwrap_or_default(),
        _ => String::new(),
    }
}

/// A post as the Writing tab lists it, from a q=source answer.
fn item(p: &Value) -> Value {
    let url = [first(p, "url"), st(p, "url")].into_iter().find(|x| !x.is_empty()).unwrap_or_default();
    let title = first(p, "name");
    let text = first(p, "content");
    let cats: Vec<String> = p["properties"]["category"].as_array().map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_lowercase)).collect()).unwrap_or_default();
    let mut ids: Vec<i64> = Vec::new();
    if cats.iter().any(|c| c == "weeknotes") {
        ids.push(2);
    } else if title.trim().is_empty() {
        ids.push(1);
    }
    let status = match first(p, "post-status").as_str() { "draft" => "draft", _ => "publish" };
    let when = first(p, "published");
    let modified = [first(p, "updated"), when.clone()].into_iter().find(|x| !x.is_empty()).unwrap_or_default();
    json!({
        "id": local_id(&url),
        "title": title.trim(),
        "excerpt": crate::social::html_text(&text).replace('\n', " ").chars().take(240).collect::<String>().trim(),
        "date": when, "modified": modified,
        "link": url,
        "status": status,
        "categories": ids,
        "image": first(p, "photo"),
    })
}

fn entry(title: &str, text: &str, cats: &[&str], photo: Option<(String, String)>, draft: bool) -> Value {
    let mut props = json!({ "content": [text.trim()] });
    if !title.trim().is_empty() {
        props["name"] = json!([title.trim()]);
    }
    if !cats.is_empty() {
        props["category"] = json!(cats);
    }
    if let Some((url, alt)) = photo {
        props["photo"] = if alt.trim().is_empty() { json!([url]) } else { json!([{ "value": url, "alt": alt.trim() }]) };
    }
    if draft {
        props["post-status"] = json!(["draft"]);
    }
    json!({ "type": ["h-entry"], "properties": props })
}

async fn photo_of(photo: &str, alt: &str) -> Result<Option<(String, String)>, String> {
    if photo.is_empty() {
        return Ok(None);
    }
    Ok(Some((upload(photo).await?, alt.to_string())))
}

/// site_note: a note, Weeknotes, a reply (in-reply-to) or a repost (repost-of).
pub async fn note(title: String, text: String, link: String, link_title: String, photo: String, alt: String, draft: bool, repost: bool, reply: bool, category: Option<String>) -> Result<SiteNote, String> {
    if title.trim().is_empty() && text.trim().is_empty() && link.trim().is_empty() && photo.is_empty() {
        return Err("Write something first.".into());
    }
    let cats: Vec<&str> = if category.as_deref() == Some("weeknotes") { vec!["weeknotes"] } else { vec![] };
    let mut words = text.trim().to_string();
    // a post you're writing about (not a reply or repost) goes at the end as a link with its title
    if link.starts_with("http") && !reply && !repost && !words.contains(&link) {
        let t = if link_title.trim().is_empty() { link.clone() } else { link_title.trim().to_string() };
        words = format!("{words}\n\n[{t}]({link})").trim().to_string();
    }
    let mut body = entry(&title, &words, &cats, photo_of(&photo, &alt).await?, draft);
    if link.starts_with("http") && (reply || repost) {
        body["properties"][if reply { "in-reply-to" } else { "repost-of" }] = json!([link]);
    }
    let url = send(&body).await?;
    let mut out = SiteNote { url: if draft { String::new() } else { url.clone() }, id: local_id(&url), ..Default::default() };
    flush_ids();
    if !draft && (repost || reply) && link.starts_with("http") && url.starts_with("http") {
        match crate::webmention::send(client(), &url, &link).await {
            Ok(t) => out.told = Some(t),
            Err(e) => { out.told = Some(false); out.told_error = e; }
        }
    }
    Ok(out)
}

pub fn categories() -> Value {
    json!(CATS.iter().map(|(id, slug, name)| json!({ "id": id, "name": name, "slug": slug, "count": 0 })).collect::<Vec<_>>())
}

/// site_posts, through q=source. A site that doesn't list posts gives an empty list.
pub async fn posts(status: Option<String>, categories: Option<Vec<i64>>, exclude: Option<Vec<i64>>, per_page: Option<u32>, after: Option<String>, page: Option<u32>) -> Result<Value, String> {
    let n = per_page.unwrap_or(30).clamp(1, 100);
    let offset = (page.unwrap_or(1).max(1) - 1) * n;
    if status.as_deref() == Some("future") {
        return Ok(json!([]));
    }
    let limit = (offset + n).to_string();
    let mut q = vec![("q", "source"), ("limit", limit.as_str())];
    if status.as_deref() == Some("draft") {
        q.push(("post-status", "draft"));
    }
    let r = match query(&q).await {
        Ok(v) => v,
        Err(e) if e.starts_with("Your site said") || e.contains("error 400") || e.contains("error 501") => return Ok(json!([])),
        Err(e) => return Err(e),
    };
    let want_draft = status.as_deref() == Some("draft");
    let mut list: Vec<Value> = r["items"].as_array().cloned().unwrap_or_default().iter().map(item)
        .filter(|p| (st(p, "status") == "draft") == want_draft).collect();
    if let Some(c) = categories.filter(|c| !c.is_empty()) {
        list.retain(|p| p["categories"].as_array().is_some_and(|a| a.iter().any(|x| c.contains(&x.as_i64().unwrap_or(0)))));
    }
    if let Some(ex) = exclude.filter(|e| !e.is_empty()) {
        list.retain(|p| !p["categories"].as_array().is_some_and(|a| a.iter().any(|x| ex.contains(&x.as_i64().unwrap_or(0)))));
    }
    if let Some(a) = after.filter(|a| !a.trim().is_empty()) {
        list.retain(|p| st(p, "date").as_str() > a.trim());
    }
    let list: Vec<Value> = list.into_iter().skip(offset as usize).take(n as usize).collect();
    flush_ids();
    Ok(json!(list))
}

/// site_post_get: a post's words to keep writing.
pub async fn post_get(id: i64) -> Result<Value, String> {
    let url = post_address(id)?;
    let p = query(&[("q", "source"), ("url", url.as_str())]).await?;
    let mut it = item(&json!({ "properties": p["properties"], "url": url }));
    it["title"] = json!(first(&p, "name"));
    it["text"] = json!(first(&p, "content"));
    it["simple"] = json!(p["properties"]["photo"].as_array().map_or(true, |a| a.is_empty()));
    it["edit"] = json!(url);
    flush_ids();
    Ok(it)
}

pub async fn post_view(id: i64) -> Result<Value, String> {
    let mut it = post_get(id).await?;
    let text = st(&it, "text");
    it["html"] = json!(crate::social::preview_for(&text));
    Ok(it)
}

/// site_post: a new post, or the draft you're finishing (Micropub's update action).
pub async fn post(id: Option<i64>, title: String, text: String, photo: String, alt: String, draft: bool, kind: Option<String>) -> Result<SiteNote, String> {
    if title.trim().is_empty() && text.trim().is_empty() {
        return Err("Write something first.".into());
    }
    let cats: Vec<&str> = if kind.as_deref() == Some("weeknotes") { vec!["weeknotes"] } else { vec![] };
    let pic = photo_of(&photo, &alt).await?;
    match id.filter(|i| *i > 0) {
        None => {
            let url = send(&entry(&title, &text, &cats, pic, draft)).await?;
            let id = local_id(&url);
            flush_ids();
            Ok(SiteNote { url: if draft { String::new() } else { url }, id, ..Default::default() })
        }
        Some(i) => {
            let url = post_address(i)?;
            let mut replace = json!({ "content": [text.trim()], "post-status": [if draft { "draft" } else { "published" }] });
            if !title.trim().is_empty() {
                replace["name"] = json!([title.trim()]);
            }
            if !cats.is_empty() {
                replace["category"] = json!(cats);
            }
            if let Some((u, a)) = pic {
                replace["photo"] = if a.trim().is_empty() { json!([u]) } else { json!([{ "value": u, "alt": a.trim() }]) };
            }
            send(&json!({ "action": "update", "url": url, "replace": replace })).await?;
            Ok(SiteNote { url: if draft { String::new() } else { url }, id: i, ..Default::default() })
        }
    }
}

pub async fn publish(id: i64) -> Result<SiteNote, String> {
    let url = post_address(id)?;
    send(&json!({ "action": "update", "url": url, "replace": { "post-status": ["published"] } })).await?;
    Ok(SiteNote { url, id, ..Default::default() })
}

/// site_post_trash: Micropub's delete. Some sites keep deleted posts to undelete; the app doesn't count on it.
pub async fn delete(id: i64) -> Result<(), String> {
    let url = post_address(id)?;
    send(&json!({ "action": "delete", "url": url })).await.map(|_| ())
}

pub async fn undelete(id: i64) -> Result<(), String> {
    let url = post_address(id)?;
    send(&json!({ "action": "undelete", "url": url })).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_answers() {
        let hex = |b: [u8; 32]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        assert_eq!(hex(sha256(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(hex(sha256(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        // the PKCE example from RFC 7636
        assert_eq!(b64url(&sha256(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn addresses_and_entries() {
        assert_eq!(site_url("you.micro.blog").unwrap().as_str(), "https://you.micro.blog/");
        assert!(site_url("nothing").is_err());
        let e = entry("A title", "Words", &["weeknotes"], Some(("https://x/p.jpg".into(), "A cat".into())), true);
        assert_eq!(e["properties"]["name"][0], "A title");
        assert_eq!(e["properties"]["post-status"][0], "draft");
        assert_eq!(e["properties"]["photo"][0]["alt"], "A cat");
        assert_eq!(random_string(43).len(), 43);
    }
}
