//! Flickr, in its own tab (David, Nov 26: "What are some options to access my flickr account from the app?" → the
//! full sign-in).
//!
//! - Connect: Flickr's own page opens in your browser; you sign in there and approve the app. Flickr then sends you
//!   to readingroomapp.com/connect/flickr/, which shows a code to copy back into the app (the page only shows the
//!   code; it keeps nothing). The sign-in is kept in the Keychain, like the other accounts. Flickr's sign-ins don't
//!   run out; you take one back on Flickr (Settings › Sharing & Extending, or flickr.com/services/auth/list.gne).
//! - Reading (free): the latest photos from your contacts, friends-only and family-only ones included (the public
//!   feeds leave those out), your own photos with their views, faves and comments, and the comments people leave
//!   on your photos.
//! - Posting (Plus): upload a photo, at the size you took it, with a title, description, tags and who can see it.
//!
//! Flickr still signs in the older way (OAuth 1.0a): every call is signed with the app's secret and yours
//! (HMAC-SHA1), so there's no token to renew.

use crate::social::{client, photo_bytes, secret_delete, secret_get, secret_set, social_accounts, st, Accounts};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Mutex;

const REST: &str = "https://api.flickr.com/services/rest";
const UPLOAD: &str = "https://up.flickr.com/services/upload/";
const OAUTH: &str = "https://www.flickr.com/services/oauth";
const CALLBACK: &str = "https://readingroomapp.com/connect/flickr/";
const KEY: &str = "flickr";

fn app_key() -> Result<(&'static str, &'static str), String> {
    let k = option_env!("FLICKR_KEY").unwrap_or("").trim();
    let s = option_env!("FLICKR_SECRET").unwrap_or("").trim();
    if k.is_empty() || s.is_empty() {
        return Err("This version of the app can't connect to Flickr yet.".into());
    }
    Ok((k, s))
}

/// The connected account, for the accounts list.
pub fn account() -> Option<Value> {
    let s = secret_get(KEY)?;
    let user = st(&s, "username");
    Some(json!({
        "handle": user, "name": if st(&s, "fullname").is_empty() { user.clone() } else { st(&s, "fullname") },
        "nsid": st(&s, "nsid"), "site": format!("https://www.flickr.com/photos/{}/", st(&s, "nsid")),
    }))
}

// ------------------------------------------------------------------ signing (OAuth 1.0a, HMAC-SHA1)

/// Percent-encoding as OAuth wants it: everything but A–Z a–z 0–9 - . _ ~
fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn hmac_sha1(key: &[u8], data: &[u8]) -> [u8; 20] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..20].copy_from_slice(&Sha1::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha1::new();
    inner.update(k.map(|b| b ^ 0x36));
    inner.update(data);
    let mut outer = Sha1::new();
    outer.update(k.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

/// The signature for a request: its method, its address without the query, and every parameter (query, form
/// and oauth_*, but never the photo itself).
fn signature(method: &str, url: &str, params: &[(String, String)], consumer_secret: &str, token_secret: &str) -> String {
    use base64::Engine;
    let mut p: Vec<(String, String)> = params.iter().map(|(k, v)| (enc(k), enc(v))).collect();
    p.sort();
    let joined = p.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let base = format!("{}&{}&{}", method.to_uppercase(), enc(url), enc(&joined));
    let key = format!("{}&{}", enc(consumer_secret), enc(token_secret));
    base64::engine::general_purpose::STANDARD.encode(hmac_sha1(key.as_bytes(), base.as_bytes()))
}

fn nonce() -> String {
    let mut b = [0u8; 12];
    let ok = std::fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut b)).is_ok();
    if !ok {
        let t = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0) as u128;
        for (i, x) in b.iter_mut().enumerate() {
            *x = (t >> (i * 5)) as u8;
        }
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// `params` plus the oauth_* ones and the signature, ready to send.
fn signed(method: &str, url: &str, mut params: Vec<(String, String)>, token: Option<(&str, &str)>) -> Result<Vec<(String, String)>, String> {
    let (key, secret) = app_key()?;
    params.push(("oauth_consumer_key".into(), key.into()));
    params.push(("oauth_nonce".into(), nonce()));
    params.push(("oauth_signature_method".into(), "HMAC-SHA1".into()));
    params.push(("oauth_timestamp".into(), chrono::Utc::now().timestamp().to_string()));
    params.push(("oauth_version".into(), "1.0".into()));
    if let Some((t, _)) = token {
        params.push(("oauth_token".into(), t.into()));
    }
    let sig = signature(method, url, &params, secret, token.map(|t| t.1).unwrap_or(""));
    params.push(("oauth_signature".into(), sig));
    Ok(params)
}

/// A GET whose answer is plain text (the sign-in steps answer as a form: a=1&b=2).
async fn get_text(url: &str, params: &[(String, String)]) -> Result<(u16, String), String> {
    let resp = client().get(url).query(params).timeout(Duration::from_secs(25)).send().await
        .map_err(|_| "Couldn't reach Flickr. Check your connection.".to_string())?;
    let code = resp.status().as_u16();
    Ok((code, resp.text().await.unwrap_or_default()))
}

fn form_pairs(text: &str) -> Value {
    let mut o = serde_json::Map::new();
    for (k, v) in url::form_urlencoded::parse(text.trim().as_bytes()) {
        o.insert(k.into_owned(), json!(v.into_owned()));
    }
    Value::Object(o)
}

// ------------------------------------------------------------------ connecting

fn pending() -> &'static Mutex<Option<(String, String)>> {
    static P: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

/// Step one: the Flickr page where you sign in and approve the app ("write" lets it upload; Flickr shows that).
#[tauri::command]
pub async fn flickr_begin() -> Result<String, String> {
    let url = format!("{OAUTH}/request_token");
    let q = signed("GET", &url, vec![("oauth_callback".into(), CALLBACK.into())], None)?;
    let (code, text) = get_text(&url, &q).await?;
    let r = form_pairs(&text);
    let (tok, sec) = (st(&r, "oauth_token"), st(&r, "oauth_token_secret"));
    if code >= 400 || tok.is_empty() {
        return Err(if text.contains("signature_invalid") || text.contains("consumer_key_unknown") {
            "Flickr didn't accept this version of the app. Try again later.".into()
        } else {
            "Flickr didn't answer the way it should. Try again in a minute.".into()
        });
    }
    *pending().lock().await = Some((tok.clone(), sec));
    let mut u = url::Url::parse(&format!("{OAUTH}/authorize")).map_err(|e| e.to_string())?;
    u.query_pairs_mut().append_pair("oauth_token", &tok).append_pair("perms", "delete"); // delete includes write: deleting photos needs it (Nov 27)
    Ok(u.to_string())
}

/// The code alone, from the code or the whole address it came in (…/connect/flickr/?oauth_token=…&oauth_verifier=…).
fn code_from(input: &str) -> String {
    let t = input.trim();
    if let Ok(u) = url::Url::parse(t) {
        if let Some((_, c)) = u.query_pairs().find(|(k, _)| k == "oauth_verifier") {
            return c.trim().to_string();
        }
    }
    let t = t.split("oauth_verifier=").nth(1).unwrap_or(t);
    t.split('&').next().unwrap_or("").trim().to_string()
}

/// Step two: the code readingroomapp.com showed after you approved the app (the whole address works too).
#[tauri::command]
pub async fn flickr_finish(code: String) -> Result<Accounts, String> {
    let verifier = code_from(&code);
    if verifier.is_empty() {
        return Err("Paste the code from the page that opened after you approved the app.".into());
    }
    let (tok, sec) = pending().lock().await.clone().ok_or("Press Connect Flickr first, then paste the code.")?;
    let url = format!("{OAUTH}/access_token");
    let q = signed("GET", &url, vec![("oauth_verifier".into(), verifier)], Some((&tok, &sec)))?;
    let (status, text) = get_text(&url, &q).await?;
    let r = form_pairs(&text);
    let token = st(&r, "oauth_token");
    if status >= 400 || token.is_empty() {
        return Err("That code didn't work. Codes work once and only for a few minutes: press Connect Flickr again.".into());
    }
    secret_set(KEY, &json!({
        "token": token, "secret": st(&r, "oauth_token_secret"),
        "nsid": st(&r, "user_nsid"), "username": st(&r, "username"), "fullname": st(&r, "fullname"),
    }))?;
    *pending().lock().await = None;
    Ok(social_accounts())
}

/// Forget the sign-in on this device (and your other devices, through iCloud Keychain). Flickr has no way for an
/// app to take back its own sign-in; the app says where to do that on Flickr.
#[tauri::command]
pub fn flickr_disconnect() -> Accounts {
    secret_delete(KEY);
    social_accounts()
}

// ------------------------------------------------------------------ Flickr's API

/// Call a Flickr method as you. Flickr answers 200 even when something's wrong, with stat "fail".
async fn api(method: &str, args: &[(&str, String)]) -> Result<Value, String> {
    let s = secret_get(KEY).ok_or("Connect Flickr first.")?;
    let mut p: Vec<(String, String)> = vec![("method".into(), method.into()), ("format".into(), "json".into()), ("nojsoncallback".into(), "1".into())];
    p.extend(args.iter().map(|(k, v)| (k.to_string(), v.clone())));
    let q = signed("GET", REST, p, Some((&st(&s, "token"), &st(&s, "secret"))))?;
    let (code, text) = get_text(REST, &q).await?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if st(&v, "stat") == "ok" {
        return Ok(v);
    }
    Err(flickr_fail(code, &v))
}

fn flickr_fail(status: u16, v: &Value) -> String {
    let said = st(v, "message");
    match v["code"].as_i64().unwrap_or(0) {
        98 | 96 | 97 => "Flickr didn't accept the sign-in. Connect Flickr again in Settings › Connections.".into(),
        99 => "Flickr says the app isn't allowed to do that. Connect Flickr again in Settings › Connections.".into(),
        105 | 106 => "Flickr isn't answering right now. Try again in a few minutes.".into(),
        _ if status == 429 => "Flickr says to slow down. Try again in a few minutes.".into(),
        _ if !said.is_empty() => format!("Flickr said: {said}"),
        _ if status >= 500 => "Flickr isn't answering right now. Try again in a few minutes.".into(),
        _ => "Flickr didn't answer the way it should. Try again.".into(),
    }
}

/// Flickr's words come as text or as {"_content": text}.
fn words(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Object(_) => st(v, "_content"),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// A photo's address at a size: q (150 square), n (320), z (640), b (1024).
fn img(p: &Value, size: &str) -> String {
    let (server, id, secret) = (st(p, "server"), st(p, "id"), st(p, "secret"));
    if server.is_empty() || id.is_empty() || secret.is_empty() {
        return String::new();
    }
    format!("https://live.staticflickr.com/{server}/{id}_{secret}_{size}.jpg")
}

/// Someone's picture on Flickr (Flickr's grey face when they have none).
fn face(nsid: &str, iconserver: &str, iconfarm: &str) -> String {
    if nsid.is_empty() || iconserver.is_empty() || iconserver == "0" {
        return "https://www.flickr.com/images/buddyicon.gif".into();
    }
    format!("https://farm{}.staticflickr.com/{iconserver}/buddyicons/{nsid}.jpg", if iconfarm.is_empty() { "1" } else { iconfarm })
}

fn num(v: &Value) -> i64 {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0)
}

fn when(unix: &Value) -> String {
    chrono::DateTime::from_timestamp(num(unix), 0).map(|d| d.to_rfc3339()).unwrap_or_default()
}

/// A photo as the Flickr tab shows it.
fn photo(p: &Value, me: &str) -> Value {
    let owner = if st(p, "owner").is_empty() { me.to_string() } else { st(p, "owner") };
    let name = if st(p, "ownername").is_empty() { st(p, "username") } else { st(p, "ownername") };
    json!({
        "id": st(p, "id"),
        "title": words(&p["title"]),
        "owner": owner,
        "name": name,
        "face": face(&owner, &st(p, "iconserver"), &st(p, "iconfarm")),
        "page": format!("https://www.flickr.com/photos/{owner}/{}/", st(p, "id")),
        "thumb": img(p, "q"),
        "img": img(p, "z"),
        "big": img(p, "b"),
        "date": when(&p["dateupload"]),
        "public": num(&p["ispublic"]) == 1,
        "friend": num(&p["isfriend"]) == 1,
        "family": num(&p["isfamily"]) == 1,
        "views": num(&p["views"]),
        "faves": num(&p["count_faves"]),
        "comments": num(&p["count_comments"]),
        "description": short(&plain(&words(&p["description"])), 280),
    })
}

/// The first `n` characters, with … when there's more.
fn short(s: &str, n: usize) -> String {
    if s.chars().count() > n { format!("{}…", s.chars().take(n - 2).collect::<String>().trim_end()) } else { s.to_string() }
}

/// The web addresses a Flickr description links to (photographers often link their blog or shop), in order, once each.
fn links_in(html: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in html.split("href=").skip(1) {
        let q = part.chars().next().unwrap_or(' ');
        let rest = if q == '"' || q == '\'' { &part[1..] } else { part };
        let end = rest.find(|c: char| c == '"' || c == '\'' || c == '>' || c.is_whitespace()).unwrap_or(rest.len());
        let u = rest[..end].replace("&amp;", "&");
        if (u.starts_with("https://") || u.starts_with("http://")) && !out.contains(&u) {
            out.push(u);
        }
    }
    out.truncate(8);
    out
}

fn me() -> String {
    secret_get(KEY).map(|s| st(&s, "nsid")).unwrap_or_default()
}

/// The latest photos from people you follow on Flickr (up to 50), friends-only and family-only ones included.
/// `friends`: only your friends and family.
#[tauri::command]
pub async fn flickr_contacts(friends: Option<bool>) -> Result<Vec<Value>, String> {
    let mut a = vec![("count", "50".to_string()), ("extras", "date_upload,owner_name,icon_server".to_string()), ("include_self", "0".to_string())];
    if friends.unwrap_or(false) {
        a.push(("just_friends", "1".to_string()));
    }
    let r = api("flickr.photos.getContactsPhotos", &a).await?;
    let me = me();
    let mut list: Vec<Value> = r["photos"]["photo"].as_array().cloned().unwrap_or_default().iter().map(|p| photo(p, &me)).collect();
    list.sort_by(|a, b| st(b, "date").cmp(&st(a, "date")));
    Ok(list)
}

/// Your photos, newest first (30 a page, `page` from 1), with views, faves and comments, and your totals.
#[tauri::command]
pub async fn flickr_mine(page: Option<u32>) -> Result<Value, String> {
    let me = me();
    let r = api("flickr.people.getPhotos", &[
        ("user_id", "me".to_string()), ("per_page", "30".to_string()), ("page", page.unwrap_or(1).max(1).to_string()),
        ("extras", "date_upload,views,count_faves,count_comments,description".to_string()),
    ]).await?;
    let photos: Vec<Value> = r["photos"]["photo"].as_array().cloned().unwrap_or_default().iter().map(|p| photo(p, &me)).collect();
    Ok(json!({ "photos": photos, "total": num(&r["photos"]["total"]), "pages": num(&r["photos"]["pages"]), "page": num(&r["photos"]["page"]) }))
}

/// Comments people left on your photos in the last 30 days, newest first ("keep conversations about people
/// talking": faves are counted on each photo, not listed here).
#[tauri::command]
pub async fn flickr_activity() -> Result<Vec<Value>, String> {
    let Some(_) = secret_get(KEY) else { return Ok(Vec::new()) };
    let r = api("flickr.activity.userPhotos", &[("timeframe", "30d".to_string()), ("per_page", "50".to_string())]).await?;
    Ok(activity_items(&r, &me()))
}

fn activity_items(r: &Value, me: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for item in r["items"]["item"].as_array().cloned().unwrap_or_default() {
        let p = json!({ "id": st(&item, "id"), "server": st(&item, "server"), "secret": st(&item, "secret"), "owner": st(&item, "owner") });
        let (title, thumb) = (words(&item["title"]), img(&p, "q"));
        for ev in item["activity"]["event"].as_array().cloned().unwrap_or_default() {
            let who = st(&ev, "user");
            if st(&ev, "type") != "comment" || who.is_empty() || who == me {
                continue;
            }
            let name = if st(&ev, "realname").is_empty() { st(&ev, "username") } else { st(&ev, "realname") };
            let owner = if st(&item, "owner").is_empty() { me.to_string() } else { st(&item, "owner") };
            out.push(json!({
                "name": name,
                "user": who.clone(),
                "face": face(&who, &st(&ev, "iconserver"), &st(&ev, "iconfarm")),
                "text": words(&ev),
                "date": when(&ev["dateadded"]),
                "photo": title.clone(),
                "thumb": thumb.clone(),
                "link": format!("https://www.flickr.com/photos/{owner}/{}/", st(&item, "id")),
                "photo_id": st(&item, "id"),
                "id": format!("{}:{}", st(&item, "id"), st(&ev, "commentid")),
                "profile": format!("https://www.flickr.com/photos/{who}/"),
            }));
        }
    }
    out.sort_by(|a, b| st(b, "date").cmp(&st(a, "date")));
    out
}

/// Tags as you typed them ("street, new york" or "#street #nyc") in Flickr's form: separated by spaces, with
/// quotes around a tag that has a space in it.
fn tag_line(tags: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let parts: Vec<&str> = if tags.contains(',') { tags.split(',').collect() } else { tags.split_whitespace().collect() };
    for t in parts {
        let t = t.trim().trim_start_matches('#').replace('"', "").trim().to_string();
        if t.is_empty() || out.iter().any(|o| o.trim_matches('"').eq_ignore_ascii_case(&t)) {
            continue;
        }
        out.push(if t.contains(' ') { format!("\"{t}\"") } else { t });
    }
    out.join(" ")
}

/// Upload a photo (The Reading Room Plus), as it is, not made smaller. `who`: "public", "friends", "family",
/// "both" (friends and family) or "private". Flickr's answer is a little XML with the new photo's id.
#[tauri::command]
pub async fn flickr_upload(photo: String, name: Option<String>, mime: Option<String>, title: String, description: String, tags: String, who: String) -> Result<Value, String> {
    let s = secret_get(KEY).ok_or("Connect Flickr first.")?;
    let bytes = photo_bytes(&photo)?;
    if bytes.is_empty() {
        return Err("Pick a photo first.".into());
    }
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("Flickr takes photos up to 200 MB. This one is bigger.".into());
    }
    let (public, friend, family) = match who.as_str() { "public" => ("1", "0", "0"), "friends" => ("0", "1", "0"), "family" => ("0", "0", "1"), "both" => ("0", "1", "1"), _ => ("0", "0", "0") };
    let mut fields: Vec<(String, String)> = vec![("is_public".into(), public.into()), ("is_friend".into(), friend.into()), ("is_family".into(), family.into()), ("content_type".into(), "1".into())];
    for (k, v) in [("title", title.trim().to_string()), ("description", description.trim().to_string()), ("tags", tag_line(&tags))] {
        if !v.is_empty() {
            fields.push((k.into(), v));
        }
    }
    let fields = signed("POST", UPLOAD, fields, Some((&st(&s, "token"), &st(&s, "secret"))))?;
    let file = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "photo.jpg".into()).replace(['"', '\r', '\n'], "");
    let mime = mime.filter(|m| m.starts_with("image/")).unwrap_or_else(|| "image/jpeg".into());
    let boundary = format!("rr{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let mut body = Vec::with_capacity(bytes.len() + 2048);
    for (k, v) in &fields {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").as_bytes());
    }
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"{file}\"\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let resp = client().post(UPLOAD).header("Content-Type", format!("multipart/form-data; boundary={boundary}")).body(body)
        .timeout(Duration::from_secs(300)).send().await
        .map_err(|_| "Couldn't reach Flickr. Check your connection and try again.".to_string())?;
    let text = resp.text().await.unwrap_or_default();
    let id = upload_id(&text).ok_or_else(|| {
        let said = upload_error(&text);
        if said.is_empty() { "Flickr didn't take the photo. Try again.".to_string() } else { format!("Flickr said: {said}") }
    })?;
    Ok(json!({ "id": id, "url": format!("https://www.flickr.com/photos/{}/{id}/", st(&s, "nsid")) }))
}

fn upload_id(xml: &str) -> Option<String> {
    let a = xml.find("<photoid")?;
    let rest = &xml[a..];
    let s = rest.find('>')? + 1;
    let e = rest.find("</photoid>")?;
    let id = rest[s..e].trim();
    (!id.is_empty() && id.chars().all(|c| c.is_ascii_digit())).then(|| id.to_string())
}

fn upload_error(xml: &str) -> String {
    xml.split("msg=\"").nth(1).and_then(|r| r.split('"').next()).unwrap_or("").to_string()
}

// ------------------------------------------------------------------ the photo viewer, faves, comments, people, editing
// (David, Nov 26: "Everytime I click a photo it takes me to the flickr website" → all six: open photos in the app,
// fave and comment, a person's photos with Follow, edit your own, a Flickr photo in a note, Flickr in Conversations)

/// A signed POST to Flickr's API (anything that changes something: faves, comments, edits).
async fn api_post(method: &str, args: &[(&str, String)]) -> Result<Value, String> {
    let s = secret_get(KEY).ok_or("Connect Flickr first.")?;
    let mut p: Vec<(String, String)> = vec![("method".into(), method.into()), ("format".into(), "json".into()), ("nojsoncallback".into(), "1".into())];
    p.extend(args.iter().map(|(k, v)| (k.to_string(), v.clone())));
    let form = signed("POST", REST, p, Some((&st(&s, "token"), &st(&s, "secret"))))?;
    let resp = client().post(REST).form(&form).timeout(Duration::from_secs(25)).send().await
        .map_err(|_| "Couldn't reach Flickr. Check your connection.".to_string())?;
    let code = resp.status().as_u16();
    let v: Value = serde_json::from_str(&resp.text().await.unwrap_or_default()).unwrap_or(Value::Null);
    if st(&v, "stat") == "ok" {
        return Ok(v);
    }
    Err(flickr_fail(code, &v))
}

/// Flickr comments and descriptions can carry a little HTML: keep the words, the line breaks and the links' text.
fn plain(html: &str) -> String {
    let t = html.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n");
    let mut out = String::with_capacity(t.len());
    let mut in_tag = false;
    for c in t.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&#039;", "'").replace("&nbsp;", " ");
    out.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

fn who_sees(vis: &Value) -> &'static str {
    match (num(&vis["ispublic"]) == 1, num(&vis["isfriend"]) == 1, num(&vis["isfamily"]) == 1) {
        (true, _, _) => "public",
        (false, true, true) => "both",
        (false, true, false) => "friends",
        (false, false, true) => "family",
        _ => "private",
    }
}

fn comment_item(c: &Value, me: &str) -> Value {
    let author = st(c, "author");
    let name = if st(c, "realname").is_empty() { st(c, "authorname") } else { st(c, "realname") };
    json!({
        "id": st(c, "id"), "user": author.clone(), "name": name, "mine": author == me,
        "face": face(&author, &st(c, "iconserver"), &st(c, "iconfarm")),
        "text": plain(&words(c)), "date": when(&c["datecreate"]), "link": st(c, "permalink"),
    })
}

/// Everything about one photo for the viewer: bigger picture, words, tags, dates, who can see it, counts,
/// whether you faved it, what you may do with it, and its comments (oldest first, as on Flickr).
#[tauri::command]
pub async fn flickr_photo(id: String) -> Result<Value, String> {
    let me = me();
    let info = api("flickr.photos.getInfo", &[("photo_id", id.clone())]).await?;
    let p = &info["photo"];
    let owner = &p["owner"];
    let nsid = st(owner, "nsid");
    let faves = api("flickr.photos.getFavorites", &[("photo_id", id.clone()), ("per_page", "1".to_string())]).await
        .map(|f| num(&f["photo"]["total"])).unwrap_or(-1);
    let comments: Vec<Value> = api("flickr.photos.comments.getList", &[("photo_id", id.clone())]).await
        .map(|c| c["comments"]["comment"].as_array().cloned().unwrap_or_default().iter().map(|c| comment_item(c, &me)).collect())
        .unwrap_or_default();
    let tags: Vec<String> = p["tags"]["tag"].as_array().cloned().unwrap_or_default().iter()
        .filter(|t| st(t, "author") == nsid || st(t, "author").is_empty())
        .map(|t| if st(t, "raw").is_empty() { words(t) } else { st(t, "raw") }).filter(|t| !t.is_empty()).collect();
    let name = if words(&owner["realname"]).is_empty() { st(owner, "username") } else { words(&owner["realname"]) };
    let can = &p["editability"];
    let taken = st(&p["dates"], "taken");
    Ok(json!({
        "id": id.clone(), "owner": nsid.clone(), "name": name, "handle": st(owner, "username"), "mine": nsid == me,
        "face": face(&nsid, &st(owner, "iconserver"), &st(owner, "iconfarm")),
        "title": words(&p["title"]), "description": plain(&words(&p["description"])), "tags": tags,
        "img": img(p, "b"), "small": img(p, "z"),
        "page": format!("https://www.flickr.com/photos/{nsid}/{id}/"),
        "posted": when(&p["dates"]["posted"]), "taken": if num(&p["dates"]["takenunknown"]) == 1 { String::new() } else { taken.replacen(' ', "T", 1) },
        "who": who_sees(&p["visibility"]),
        "views": num(&p["views"]), "faves": faves, "count": num(&p["comments"]["_content"]),
        "faved": num(&p["isfavorite"]) == 1,
        "license": num(&p["license"]),
        "links": links_in(&words(&p["description"])),
        "can_share": nsid == me || p["usage"]["canshare"].is_null() || num(&p["usage"]["canshare"]) == 1,
        "can_comment": num(&can["cancomment"]) == 1 || nsid == me,
        "comments": comments,
    }))
}

/// Fave or un-fave someone's photo (you can't fave your own on Flickr).
#[tauri::command]
pub async fn flickr_fave(id: String, on: bool) -> Result<bool, String> {
    let r = api_post(if on { "flickr.favorites.add" } else { "flickr.favorites.remove" }, &[("photo_id", id)]).await;
    match r {
        Ok(_) => Ok(on),
        Err(e) if e.contains("already") || e.contains("not in favorites") => Ok(on),
        Err(e) => Err(e),
    }
}

/// Write a comment on a photo, as you. Flickr comments aren't threaded: a reply is a comment that starts with
/// the person's name, which the app fills in.
#[tauri::command]
pub async fn flickr_comment(id: String, text: String) -> Result<Value, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Write something first.".into());
    }
    let r = api_post("flickr.photos.comments.addComment", &[("photo_id", id), ("comment_text", text.clone())]).await?;
    let s = secret_get(KEY).unwrap_or(Value::Null);
    let me = st(&s, "nsid");
    Ok(json!({
        "id": st(&r["comment"], "id"), "user": me.clone(), "mine": true,
        "name": if st(&s, "fullname").is_empty() { st(&s, "username") } else { st(&s, "fullname") },
        "face": "", "text": text, "date": chrono::Utc::now().to_rfc3339(), "link": st(&r["comment"], "permalink"),
    }))
}

/// Someone on Flickr: their name, a line about them, where they are, and their latest photos you can see (30 a
/// page), plus their public photo feed to follow in the app.
#[tauri::command]
pub async fn flickr_person(nsid: String, page: Option<u32>) -> Result<Value, String> {
    let me = me();
    let info = api("flickr.people.getInfo", &[("user_id", nsid.clone())]).await?;
    let p = &info["person"];
    let r = api("flickr.people.getPhotos", &[
        ("user_id", nsid.clone()), ("per_page", "30".to_string()), ("page", page.unwrap_or(1).max(1).to_string()),
        ("extras", "date_upload,owner_name,views,count_faves,count_comments,description".to_string()),
    ]).await?;
    let photos: Vec<Value> = r["photos"]["photo"].as_array().cloned().unwrap_or_default().iter().map(|x| {
        let mut x = x.clone();
        if st(&x, "owner").is_empty() { x["owner"] = json!(nsid.clone()); }
        photo(&x, &me)
    }).collect();
    let name = if words(&p["realname"]).is_empty() { words(&p["username"]) } else { words(&p["realname"]) };
    let about = plain(&words(&p["description"]));
    Ok(json!({
        "nsid": nsid.clone(), "name": name, "handle": words(&p["username"]), "me": nsid == me,
        "face": face(&nsid, &st(p, "iconserver"), &st(p, "iconfarm")),
        "about": if about.chars().count() > 400 { format!("{}…", about.chars().take(390).collect::<String>()) } else { about },
        "location": words(&p["location"]),
        "count": num(&p["photos"]["count"]["_content"]),
        "site": format!("https://www.flickr.com/photos/{nsid}/"),
        "feed": format!("https://www.flickr.com/services/feeds/photos_public.gne?id={nsid}&format=atom"),
        "photos": photos, "page": num(&r["photos"]["page"]), "pages": num(&r["photos"]["pages"]),
    }))
}

/// Change one of your photos: its title, description, tags and who can see it ("public", "friends", "family",
/// "both", "private"). Only what changed is sent; returns the photo as the viewer shows it.
#[tauri::command]
pub async fn flickr_edit(id: String, title: Option<String>, description: Option<String>, tags: Option<String>, who: Option<String>, taken: Option<String>, license: Option<i64>) -> Result<Value, String> {
    if let Some(t) = taken.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        api_post("flickr.photos.setDates", &[("photo_id", id.clone()), ("date_taken", taken_for_flickr(t)?), ("date_taken_granularity", "0".to_string())]).await?;
    }
    if let Some(l) = license {
        api_post("flickr.photos.licenses.setLicense", &[("photo_id", id.clone()), ("license_id", l.to_string())]).await?;
    }
    if title.is_some() || description.is_some() {
        api_post("flickr.photos.setMeta", &[
            ("photo_id", id.clone()), ("title", title.unwrap_or_default().trim().to_string()), ("description", description.unwrap_or_default().trim().to_string()),
        ]).await?;
    }
    if let Some(t) = tags {
        api_post("flickr.photos.setTags", &[("photo_id", id.clone()), ("tags", tag_line(&t))]).await?;
    }
    if let Some(w) = who {
        let (public, friend, family) = match w.as_str() { "public" => ("1", "0", "0"), "friends" => ("0", "1", "0"), "family" => ("0", "0", "1"), "both" => ("0", "1", "1"), _ => ("0", "0", "0") };
        api_post("flickr.photos.setPerms", &[("photo_id", id.clone()), ("is_public", public.into()), ("is_friend", friend.into()), ("is_family", family.into())]).await?;
    }
    flickr_photo(id).await
}

/// One of Flickr's pictures as a data address, to use as a note's or Weeknotes' picture (only Flickr's own
/// picture servers; the note then copies it to your site like any picture you pick).
#[tauri::command]
pub async fn flickr_picture(url: String) -> Result<String, String> {
    use base64::Engine;
    let u = url::Url::parse(&url).map_err(|_| "That isn't a Flickr picture.".to_string())?;
    let host = u.host_str().unwrap_or("");
    if u.scheme() != "https" || !(host == "live.staticflickr.com" || host.ends_with(".staticflickr.com")) {
        return Err("That isn't a Flickr picture.".into());
    }
    let resp = client().get(u).timeout(Duration::from_secs(40)).send().await.map_err(|_| "Couldn't get the picture from Flickr.".to_string())?;
    if !resp.status().is_success() {
        return Err("Couldn't get the picture from Flickr.".into());
    }
    let mime = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").to_string();
    let bytes = resp.bytes().await.map_err(|_| "Couldn't get the picture from Flickr.".to_string())?;
    Ok(format!("data:{};base64,{}", if mime.starts_with("image/") { &mime } else { "image/jpeg" }, base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

// ------------------------------------------------------------------ albums, faves, search (David, Nov 26: "Folders? Albums?
// Search for other users pictures?")

const LIST_EXTRAS: &str = "date_upload,owner_name,icon_server,views,count_faves,count_comments,description";

fn photo_list(r: &Value, key: &str, owner: &str) -> Value {
    let me = me();
    let photos: Vec<Value> = r[key]["photo"].as_array().cloned().unwrap_or_default().iter().map(|x| {
        let mut x = x.clone();
        if st(&x, "owner").is_empty() && !owner.is_empty() {
            x["owner"] = json!(owner);
        }
        photo(&x, &me)
    }).collect();
    json!({ "photos": photos, "page": num(&r[key]["page"]), "pages": num(&r[key]["pages"]), "total": num(&r[key]["total"]) })
}

fn album_item(a: &Value, owner: &str) -> Value {
    let cover = json!({ "id": st(a, "primary"), "server": st(a, "server"), "secret": st(a, "secret") });
    let count = num(&a["photos"]) + num(&a["videos"]);
    json!({
        "id": st(a, "id"), "owner": owner, "title": words(&a["title"]), "description": plain(&words(&a["description"])),
        "count": if count > 0 { count } else { num(&a["count_photos"]) },
        "cover": img(&cover, "z"), "thumb": img(&cover, "q"),
        "updated": when(&a["date_update"]),
        "created": when(&a["date_create"]),
        "page": format!("https://www.flickr.com/photos/{owner}/albums/{}/", st(a, "id")),
    })
}

/// Albums: yours, or someone else's (the ones you can see), newest first as Flickr orders them.
#[tauri::command]
pub async fn flickr_albums(nsid: Option<String>) -> Result<Vec<Value>, String> {
    let owner = nsid.filter(|n| !n.is_empty()).unwrap_or_else(me);
    let r = api("flickr.photosets.getList", &[("user_id", owner.clone()), ("per_page", "200".to_string())]).await?;
    Ok(r["photosets"]["photoset"].as_array().cloned().unwrap_or_default().iter().map(|a| album_item(a, &owner)).collect())
}

/// The photos in an album (60 a page), oldest first as on Flickr.
#[tauri::command]
pub async fn flickr_album(id: String, owner: String, page: Option<u32>) -> Result<Value, String> {
    let r = api("flickr.photosets.getPhotos", &[
        ("photoset_id", id), ("user_id", owner.clone()), ("per_page", "60".to_string()), ("page", page.unwrap_or(1).max(1).to_string()),
        ("extras", LIST_EXTRAS.to_string()),
    ]).await?;
    let mut out = photo_list(&r, "photoset", &owner);
    out["title"] = json!(words(&r["photoset"]["title"]));
    Ok(out)
}

/// Photos you faved on Flickr, newest fave first (50 a page).
#[tauri::command]
pub async fn flickr_faves(page: Option<u32>) -> Result<Value, String> {
    let r = api("flickr.favorites.getList", &[
        ("user_id", me()), ("per_page", "50".to_string()), ("page", page.unwrap_or(1).max(1).to_string()), ("extras", LIST_EXTRAS.to_string()),
    ]).await?;
    Ok(photo_list(&r, "photos", ""))
}

/// Everyone's photos: words searched in titles, descriptions and tags, sorted "relevance", "interesting" or
/// "recent"; SafeSearch on. With no words, Flickr's Explore (its pick of interesting photos lately). A word that
/// is someone's exact Flickr name also brings them up, to open their page.
#[tauri::command]
pub async fn flickr_search(text: String, sort: Option<String>, page: Option<u32>, mine: Option<bool>) -> Result<Value, String> {
    let q = text.trim().to_string();
    let page = page.unwrap_or(1).max(1).to_string();
    if q.is_empty() {
        let r = match api("flickr.interestingness.getList", &[("per_page", "48".to_string()), ("page", page), ("extras", LIST_EXTRAS.to_string())]).await {
            Ok(r) => r,
            Err(e) if refused_for_others(&e) => return Ok(json!({ "photos": [], "page": 1, "pages": 1, "total": 0, "explore": true, "restricted": true })),
            Err(e) => return Err(e),
        };
        let mut out = photo_list(&r, "photos", "");
        out["explore"] = json!(true);
        return Ok(out);
    }
    let mine = mine.unwrap_or(false);
    let sort = match sort.as_deref() { Some("interesting") => "interestingness-desc", Some("recent") => "date-posted-desc", _ => "relevance" };
    let mut args = vec![
        ("text", q.clone()), ("sort", sort.to_string()), ("safe_search", "1".to_string()), ("content_types", "0".to_string()),
        ("media", "photos".to_string()), ("per_page", "48".to_string()), ("page", page.clone()), ("extras", LIST_EXTRAS.to_string()),
    ];
    if mine { args.push(("user_id", "me".to_string())); }
    // Flickr lets this app's key search only your own photos (photos.search error 22): say so plainly instead of failing.
    let mut out = match api("flickr.photos.search", &args).await {
        Ok(r) => photo_list(&r, "photos", ""),
        Err(e) if !mine && refused_for_others(&e) => json!({ "photos": [], "page": 1, "pages": 1, "total": 0, "restricted": true }),
        Err(e) => return Err(e),
    };
    if page == "1" && !mine && !q.contains(' ') {
        if let Ok(u) = api("flickr.people.findByUsername", &[("username", q.clone())]).await {
            let nsid = st(&u["user"], "nsid");
            if !nsid.is_empty() {
                out["person"] = json!({ "nsid": nsid, "name": words(&u["user"]["username"]) });
            }
        }
    }
    Ok(out)
}

/// Flickr refuses this app's key anything about other members' photos: "This API key can only search the calling
/// user's own photos" (error 22) or "…can only access the calling user's own photos".
fn refused_for_others(e: &str) -> bool {
    let e = e.to_lowercase();
    e.contains("api key can only") || e.contains("calling user's own photos") || e.contains("calling user’s own photos")
}

/// The albums one of your photos is in.
#[tauri::command]
pub async fn flickr_contexts(id: String) -> Result<Vec<Value>, String> {
    let r = api("flickr.photos.getAllContexts", &[("photo_id", id)]).await?;
    Ok(r["set"].as_array().cloned().unwrap_or_default().iter().map(|s| json!({ "id": st(s, "id"), "title": words(&s["title"]) })).collect())
}

/// Put one of your photos in one of your albums, or in a new album named `new_title` (Flickr makes an album with
/// its first photo). Returns the albums it's in now.
#[tauri::command]
pub async fn flickr_add_to_album(photo_id: String, album_id: Option<String>, new_title: Option<String>) -> Result<Vec<Value>, String> {
    if let Some(t) = new_title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        api_post("flickr.photosets.create", &[("title", t), ("primary_photo_id", photo_id.clone())]).await?;
    } else if let Some(a) = album_id.filter(|a| !a.is_empty()) {
        if let Err(e) = api_post("flickr.photosets.addPhoto", &[("photoset_id", a), ("photo_id", photo_id.clone())]).await {
            if !e.contains("already in") {
                return Err(e);
            }
        }
    } else {
        return Err("Pick an album, or name a new one.".into());
    }
    flickr_contexts(photo_id).await
}

// ------------------------------------------------------------------ people, descriptions (David, Nov 27: "Contacts needs
// to be organized by account", "does not pull in descriptions")

/// Everyone you follow on Flickr (up to 1,000), with whether they're a friend or family, their public photo feed
/// (to follow in the app) and their page. Flickr's API can read who you follow but has no way to follow someone new:
/// that's done on their Flickr page.
#[tauri::command]
pub async fn flickr_people() -> Result<Vec<Value>, String> {
    let r = api("flickr.contacts.getList", &[("per_page", "1000".to_string()), ("sort", "name".to_string())]).await?;
    Ok(r["contacts"]["contact"].as_array().cloned().unwrap_or_default().iter().map(person_item).collect())
}

fn person_item(c: &Value) -> Value {
    let nsid = st(c, "nsid");
    let name = if st(c, "realname").trim().is_empty() { st(c, "username") } else { st(c, "realname").trim().to_string() };
    json!({
        "nsid": nsid.clone(), "name": name, "handle": st(c, "username"),
        "face": face(&nsid, &st(c, "iconserver"), &st(c, "iconfarm")),
        "friend": num(&c["friend"]) == 1, "family": num(&c["family"]) == 1,
        "site": format!("https://www.flickr.com/photos/{}/", if st(c, "path_alias").is_empty() { nsid.clone() } else { st(c, "path_alias") }),
        "feed": format!("https://www.flickr.com/services/feeds/photos_public.gne?id={nsid}&format=atom"),
    })
}

/// The descriptions of some photos (up to 50), for lists Flickr sends without them (your contacts' latest photos)
/// and for other people's photos. Flickr's API now refuses details of other members' photos to keys like the app's
/// ("This API key can only access the calling user's own photos", Nov 27), so: your own photos through
/// photos.getInfo, everyone else's from their public photo feed (the one Follow in The Reading Room uses), which
/// carries each recent public photo's description. One feed per person, four at a time; photos it doesn't cover
/// (older, or friends-only) are left out.
#[tauri::command]
pub async fn flickr_descriptions(photos: Vec<Value>) -> Result<Value, String> {
    use futures::stream::{self, StreamExt};
    let me = me();
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    let photos: Vec<(String, String)> = photos.iter().map(|p| (st(p, "id"), st(p, "owner"))).filter(|(i, _)| digits(i)).take(50).collect();
    let mut out = serde_json::Map::new();
    let mine: Vec<String> = photos.iter().filter(|(_, o)| *o == me).map(|(i, _)| i.clone()).collect();
    let got: Vec<(String, String)> = stream::iter(mine.into_iter().map(|id| async move {
        let d = api("flickr.photos.getInfo", &[("photo_id", id.clone())]).await.map(|v| short(&plain(&words(&v["photo"]["description"])), 280)).unwrap_or_default();
        (id, d)
    })).buffer_unordered(6).collect().await;
    for (id, d) in got {
        out.insert(id, json!(d));
    }
    let mut owners: Vec<String> = photos.iter().filter(|(_, o)| *o != me && !o.is_empty()).map(|(_, o)| o.clone()).collect();
    owners.sort();
    owners.dedup();
    owners.truncate(16);
    let feeds: Vec<Vec<(String, String)>> = stream::iter(owners.into_iter().map(|o| async move { public_descriptions(&o).await })).buffer_unordered(4).collect().await;
    let want: std::collections::HashSet<&String> = photos.iter().map(|(i, _)| i).collect();
    for (id, d) in feeds.into_iter().flatten() {
        if want.contains(&id) {
            out.insert(id, json!(d));
        }
    }
    Ok(Value::Object(out))
}

/// Someone's public photo feed → (photo id, description) for each of their latest public photos.
async fn public_descriptions(nsid: &str) -> Vec<(String, String)> {
    let url = "https://www.flickr.com/services/feeds/photos_public.gne";
    let q = vec![("id".to_string(), nsid.to_string()), ("format".to_string(), "atom".to_string())];
    match get_text(url, &q).await {
        Ok((200, xml)) => feed_descriptions(&xml),
        _ => Vec::new(),
    }
}

/// Flickr's public feed puts "<p>Name posted a photo:</p> <p><a><img></a></p>" before the photo's own description.
fn feed_descriptions(xml: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for entry in xml.split("<entry>").skip(1) {
        let id = entry.split("<id>").nth(1).and_then(|r| r.split("</id>").next()).and_then(|t| t.rsplit('/').next()).unwrap_or("").trim().to_string();
        let html = entry.split("<content type=\"html\">").nth(1).and_then(|r| r.split("</content>").next()).unwrap_or("");
        let html = html_escape::decode_html_entities(html).to_string();
        let parts: Vec<&str> = html.split("</p>").collect();
        let body = if parts.len() > 2 { parts[2..].join("</p>") } else { String::new() };
        let d = short(&plain(&body), 280);
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) && !d.is_empty() {
            out.push((id, d));
        }
    }
    out
}

/// A photo's comments on their own, for when Flickr won't give the app the photo's details (someone else's photo).
#[tauri::command]
pub async fn flickr_comments(id: String) -> Result<Vec<Value>, String> {
    let me = me();
    let c = api("flickr.photos.comments.getList", &[("photo_id", id)]).await?;
    Ok(c["comments"]["comment"].as_array().cloned().unwrap_or_default().iter().map(|c| comment_item(c, &me)).collect())
}

/// Who can see every photo in one of your albums (David, Nov 27: "make an entire album for everyone when it's on
/// Friends and Family"). Flickr albums have no privacy of their own; each photo has. Goes through the album's photos
/// (500 a page) and sets each one ("public", "friends", "family", "both", "private"), four at a time, skipping ones
/// already set that way. Returns {changed, same, failed}.
#[tauri::command]
pub async fn flickr_album_who(id: String, who: String) -> Result<Value, String> {
    use futures::stream::{self, StreamExt};
    let me = me();
    let (public, friend, family) = match who.as_str() { "public" => (1, 0, 0), "friends" => (0, 1, 0), "family" => (0, 0, 1), "both" => (0, 1, 1), "private" => (0, 0, 0), _ => return Err("Pick who can see them.".into()) };
    let mut todo: Vec<String> = Vec::new();
    let mut same = 0;
    let mut page = 1;
    loop {
        let r = api("flickr.photosets.getPhotos", &[("photoset_id", id.clone()), ("user_id", me.clone()), ("per_page", "500".to_string()), ("page", page.to_string())]).await?;
        for x in r["photoset"]["photo"].as_array().cloned().unwrap_or_default() {
            if (num(&x["ispublic"]), num(&x["isfriend"]), num(&x["isfamily"])) == (public, friend, family) {
                same += 1;
            } else {
                todo.push(st(&x, "id"));
            }
        }
        if page >= num(&r["photoset"]["pages"]).max(1) || page >= 20 {
            break;
        }
        page += 1;
    }
    let results: Vec<bool> = stream::iter(todo.into_iter().map(|pid| async move {
        api_post("flickr.photos.setPerms", &[("photo_id", pid), ("is_public", public.to_string()), ("is_friend", friend.to_string()), ("is_family", family.to_string())]).await.is_ok()
    })).buffer_unordered(4).collect().await;
    let changed = results.iter().filter(|ok| **ok).count();
    Ok(json!({ "changed": changed, "same": same, "failed": results.len() - changed }))
}

// ------------------------------------------------------------------ managing your photos and albums (David, Nov 27:
// "can I manage my own flickr profile from the app?" → "both": albums and photos here, the profile on Flickr's site,
// because Flickr's API has no way to change a profile)

/// "2026-11-26T07:12" (a date-and-time box) or "2026-11-26" → Flickr's "2026-11-26 07:12:00".
fn taken_for_flickr(t: &str) -> Result<String, String> {
    let t = t.replace('T', " ");
    let (d, h) = t.split_once(' ').unwrap_or((t.as_str(), "00:00"));
    let ok = chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok();
    if !ok {
        return Err("That date doesn't look right.".into());
    }
    let h = if h.len() == 5 { format!("{h}:00") } else { h.chars().take(8).collect() };
    Ok(format!("{d} {h}"))
}

/// The licenses you can put on a photo, as Flickr names them (Flickr's Commons-only ones left out).
#[tauri::command]
pub async fn flickr_licenses() -> Result<Vec<Value>, String> {
    let r = api("flickr.photos.licenses.getInfo", &[]).await?;
    Ok(r["licenses"]["license"].as_array().cloned().unwrap_or_default().iter()
        .filter(|l| !matches!(num(&l["id"]), 7 | 8))
        .map(|l| json!({ "id": num(&l["id"]), "name": st(l, "name") })).collect())
}

/// Rename an album and change its description.
#[tauri::command]
pub async fn flickr_album_edit(id: String, title: String, description: String) -> Result<(), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("An album needs a name.".into());
    }
    api_post("flickr.photosets.editMeta", &[("photoset_id", id), ("title", title), ("description", description.trim().to_string())]).await.map(|_| ())
}

/// Make one of an album's photos its cover.
#[tauri::command]
pub async fn flickr_album_cover(id: String, photo_id: String) -> Result<(), String> {
    api_post("flickr.photosets.setPrimaryPhoto", &[("photoset_id", id), ("photo_id", photo_id)]).await.map(|_| ())
}

/// Take a photo out of an album (the photo stays on Flickr). Returns the albums it's in now.
#[tauri::command]
pub async fn flickr_album_remove(id: String, photo_id: String) -> Result<Vec<Value>, String> {
    api_post("flickr.photosets.removePhoto", &[("photoset_id", id), ("photo_id", photo_id.clone())]).await?;
    flickr_contexts(photo_id).await
}

/// Delete an album. Its photos stay on Flickr.
#[tauri::command]
pub async fn flickr_album_delete(id: String) -> Result<(), String> {
    api_post("flickr.photosets.delete", &[("photoset_id", id)]).await.map(|_| ())
}

/// Put your albums in this order (the ones left out follow, as they were).
#[tauri::command]
pub async fn flickr_albums_order(ids: Vec<String>) -> Result<(), String> {
    let ids: Vec<String> = ids.into_iter().filter(|i| !i.is_empty()).collect();
    if ids.is_empty() {
        return Ok(());
    }
    api_post("flickr.photosets.orderSets", &[("photoset_ids", ids.join(","))]).await.map(|_| ())
}

/// Delete one of your photos from Flickr for good. Needs the "delete" permission: a Flickr connection made before
/// Nov 27 only has "write", so Flickr refuses and the app asks you to connect again.
#[tauri::command]
pub async fn flickr_delete(id: String) -> Result<(), String> {
    match api_post("flickr.photos.delete", &[("photo_id", id)]).await {
        Ok(_) => Ok(()),
        Err(e) if e.contains("isn't allowed") || e.contains("Insufficient") || e.contains("permission") =>
            Err("To delete photos, connect Flickr again (Settings › Connections › Disconnect, then Connect Flickr): the app now asks Flickr for permission to delete.".into()),
        Err(e) => Err(e),
    }
}

/// Several of your photos at once (David, Nov 27: "pick multiple pictures to delete", "change their status from
/// public to private"): who can see them, or delete them. Four at a time; returns {done, failed, done_ids}.
#[tauri::command]
pub async fn flickr_photos_who(ids: Vec<String>, who: String) -> Result<Value, String> {
    use futures::stream::{self, StreamExt};
    let (public, friend, family) = match who.as_str() { "public" => (1, 0, 0), "friends" => (0, 1, 0), "family" => (0, 0, 1), "both" => (0, 1, 1), "private" => (0, 0, 0), _ => return Err("Pick who can see them.".into()) };
    let ids: Vec<String> = ids.into_iter().filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_digit())).take(500).collect();
    let res: Vec<(String, bool)> = stream::iter(ids.into_iter().map(|pid| async move {
        let ok = api_post("flickr.photos.setPerms", &[("photo_id", pid.clone()), ("is_public", public.to_string()), ("is_friend", friend.to_string()), ("is_family", family.to_string())]).await.is_ok();
        (pid, ok)
    })).buffer_unordered(4).collect().await;
    Ok(batch_result(res))
}

#[tauri::command]
pub async fn flickr_delete_many(ids: Vec<String>) -> Result<Value, String> {
    use futures::stream::{self, StreamExt};
    let ids: Vec<String> = ids.into_iter().filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_digit())).take(500).collect();
    // ask once first: an old connection without the delete permission fails every photo the same way
    if let Some(first) = ids.first().cloned() {
        flickr_delete(first.clone()).await?;
        let rest = ids[1..].to_vec();
        let mut res: Vec<(String, bool)> = stream::iter(rest.into_iter().map(|pid| async move {
            let ok = api_post("flickr.photos.delete", &[("photo_id", pid.clone())]).await.is_ok();
            (pid, ok)
        })).buffer_unordered(4).collect().await;
        res.insert(0, (first, true));
        return Ok(batch_result(res));
    }
    Ok(batch_result(Vec::new()))
}

// Several photos at once from the selection bar (David, Nov 27: "select multiple pictures to make them an album or
// add to a current album", "edit titles and descriptions on multiple pictures").

/// Titles and full descriptions of your photos, for the Edit box (the grid only has the first 280 characters).
#[tauri::command]
pub async fn flickr_meta_get(ids: Vec<String>) -> Result<Vec<Value>, String> {
    use futures::stream::{self, StreamExt};
    let ids: Vec<String> = ids.into_iter().filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_digit())).take(100).collect();
    let got: Vec<Value> = stream::iter(ids.into_iter().map(|id| async move {
        match api("flickr.photos.getInfo", &[("photo_id", id.clone())]).await {
            Ok(v) => json!({ "id": id, "title": words(&v["photo"]["title"]), "description": plain(&words(&v["photo"]["description"])), "ok": true }),
            Err(e) => json!({ "id": id, "title": "", "description": "", "ok": false, "err": e }),
        }
    })).buffered(6).collect().await;
    Ok(got)
}

#[derive(serde::Deserialize)]
pub struct MetaItem {
    id: String,
    title: Option<String>,
    description: Option<String>,
}

/// New titles and/or descriptions for several photos, and tags added to all of them. Flickr sets a title and a
/// description together, so a photo whose description wasn't changed gets its own back exactly as it was (links kept).
#[tauri::command]
pub async fn flickr_meta_many(items: Vec<MetaItem>, tags: Option<String>) -> Result<Value, String> {
    use futures::stream::{self, StreamExt};
    let tags = tags.map(|t| tag_line(&t)).filter(|t| !t.is_empty());
    let items: Vec<MetaItem> = items.into_iter().filter(|m| !m.id.is_empty() && m.id.chars().all(|c| c.is_ascii_digit())).take(500).collect();
    let res: Vec<(String, bool)> = stream::iter(items.into_iter().map(|m| {
        let tags = tags.clone();
        async move {
            let ok = meta_one(&m, tags.as_deref()).await.is_ok();
            (m.id, ok)
        }
    })).buffer_unordered(4).collect().await;
    Ok(batch_result(res))
}

async fn meta_one(m: &MetaItem, tags: Option<&str>) -> Result<(), String> {
    if m.title.is_some() || m.description.is_some() {
        let (title, description) = match (&m.title, &m.description) {
            (Some(t), Some(d)) => (t.trim().to_string(), d.trim().to_string()),
            _ => {
                let v = api("flickr.photos.getInfo", &[("photo_id", m.id.clone())]).await?;
                (m.title.as_deref().map(|t| t.trim().to_string()).unwrap_or_else(|| words(&v["photo"]["title"])),
                 m.description.as_deref().map(|d| d.trim().to_string()).unwrap_or_else(|| words(&v["photo"]["description"])))
            }
        };
        api_post("flickr.photos.setMeta", &[("photo_id", m.id.clone()), ("title", title), ("description", description)]).await?;
    }
    if let Some(t) = tags {
        api_post("flickr.photos.addTags", &[("photo_id", m.id.clone()), ("tags", t.to_string())]).await?;
    }
    Ok(())
}

/// Put several photos in one of your albums, or in a new album (the first photo becomes its cover).
#[tauri::command]
pub async fn flickr_album_add_many(ids: Vec<String>, album_id: Option<String>, new_title: Option<String>) -> Result<Value, String> {
    use futures::stream::{self, StreamExt};
    let ids: Vec<String> = ids.into_iter().filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_digit())).take(500).collect();
    let Some(first) = ids.first().cloned() else { return Err("Select some photos first.".into()) };
    let (album, rest) = if let Some(t) = new_title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        let v = api_post("flickr.photosets.create", &[("title", t), ("primary_photo_id", first.clone())]).await?;
        let a = st(&v["photoset"], "id");
        if a.is_empty() { return Err("Flickr didn’t say which album it made.".into()); }
        (a, ids[1..].to_vec())
    } else if let Some(a) = album_id.filter(|a| !a.is_empty() && a.chars().all(|c| c.is_ascii_digit())) {
        (a, ids.clone())
    } else {
        return Err("Pick an album, or name a new one.".into());
    };
    let made_with_first = rest.len() < ids.len();
    // one at a time keeps them in the order they were selected
    let mut res: Vec<(String, bool)> = stream::iter(rest.into_iter().map(|pid| {
        let a = album.clone();
        async move {
            let ok = match api_post("flickr.photosets.addPhoto", &[("photoset_id", a), ("photo_id", pid.clone())]).await { Ok(_) => true, Err(e) => e.contains("already in") };
            (pid, ok)
        }
    })).buffered(1).collect().await;
    if made_with_first { res.insert(0, (first, true)); }
    let mut out = batch_result(res);
    out["album_id"] = json!(album);
    Ok(out)
}

fn batch_result(res: Vec<(String, bool)>) -> Value {
    let done: Vec<&String> = res.iter().filter(|(_, ok)| *ok).map(|(i, _)| i).collect();
    json!({ "done": done.len(), "failed": res.len() - done.len(), "done_ids": done })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_rfc2202() {
        let h = hmac_sha1(b"Jefe", b"what do ya want for nothing?");
        let hex: String = h.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
    }

    #[test]
    fn signature_matches_rfc5849() {
        // RFC 5849 section 1.2: the photos.example.net request
        let p: Vec<(String, String)> = [
            ("file", "vacation.jpg"), ("size", "original"), ("oauth_consumer_key", "dpf43f3p2l4k3l03"), ("oauth_token", "nnch734d00sl2jdk"),
            ("oauth_signature_method", "HMAC-SHA1"), ("oauth_timestamp", "137131202"), ("oauth_nonce", "chapoH"),
        ].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        assert_eq!(signature("GET", "http://photos.example.net/photos", &p, "kd94hf93k423kf44", "pfkkdhi9sl3r4s00"), "MdpQcU8iPSUjWoN/UDMsK2sui9I=");
    }

    #[test]
    fn encodes_like_oauth() {
        assert_eq!(enc("a b+c/~é"), "a%20b%2Bc%2F~%C3%A9");
    }

    #[test]
    fn code_from_address() {
        assert_eq!(code_from("https://readingroomapp.com/connect/flickr/?oauth_token=72157-abc&oauth_verifier=5d1b96a26b494074"), "5d1b96a26b494074");
        assert_eq!(code_from(" 5d1b96a26b494074 "), "5d1b96a26b494074");
        assert_eq!(code_from("oauth_token=x&oauth_verifier=abc"), "abc");
    }

    #[test]
    fn tags_in_flickrs_form() {
        assert_eq!(tag_line("street, new york, #NYC, Street"), "street \"new york\" NYC");
        assert_eq!(tag_line("#film #35mm"), "film 35mm");
    }

    #[test]
    fn upload_answer() {
        assert_eq!(upload_id("<?xml version=\"1.0\"?>\n<rsp stat=\"ok\">\n<photoid>54123456789</photoid>\n</rsp>").as_deref(), Some("54123456789"));
        let bad = "<rsp stat=\"fail\">\n<err code=\"5\" msg=\"Filetype was not recognised\" />\n</rsp>";
        assert_eq!(upload_id(bad), None);
        assert_eq!(upload_error(bad), "Filetype was not recognised");
    }

    #[test]
    fn refused_for_others_matches_flickr() {
        assert!(super::refused_for_others("Flickr said: This API key can only search the calling user's own photos"));
        assert!(super::refused_for_others("This API key can only access the calling user's own photos"));
        assert!(!super::refused_for_others("Flickr didn't answer."));
    }

    #[test]
    fn descriptions_from_public_feed() {
        let xml = r#"<feed><entry><title>Fog</title><id>tag:flickr.com,2005:/photo/54001</id><content type="html">&lt;p&gt;&lt;a href=&quot;https://www.flickr.com/people/ana/&quot;&gt;Ana&lt;/a&gt; posted a photo:&lt;/p&gt;

&lt;p&gt;&lt;a href=&quot;https://www.flickr.com/photos/ana/54001/&quot; title=&quot;Fog&quot;&gt;&lt;img src=&quot;x.jpg&quot; /&gt;&lt;/a&gt;&lt;/p&gt;

&lt;p&gt;Fog lifting off the harbor. &lt;a href=&quot;https://ana.blog&quot;&gt;More here&lt;/a&gt;&lt;/p&gt;</content></entry><entry><id>tag:flickr.com,2005:/photo/54002</id><content type="html">&lt;p&gt;Ana posted a photo:&lt;/p&gt; &lt;p&gt;&lt;img src=&quot;y.jpg&quot;&gt;&lt;/p&gt; </content></entry></feed>"#;
        let d = feed_descriptions(xml);
        assert_eq!(d, vec![("54001".to_string(), "Fog lifting off the harbor. More here".to_string())]);
    }

    #[test]
    fn dates_for_flickr() {
        assert_eq!(taken_for_flickr("2026-11-26T07:12").unwrap(), "2026-11-26 07:12:00");
        assert_eq!(taken_for_flickr("2026-11-26").unwrap(), "2026-11-26 00:00:00");
        assert_eq!(taken_for_flickr("2026-11-26 07:12:30").unwrap(), "2026-11-26 07:12:30");
        assert!(taken_for_flickr("Nov 26").is_err());
    }

    #[test]
    fn people_and_links() {
        let c = person_item(&json!({ "nsid": "44@N00", "username": "lenslady", "realname": "Ana Ruiz ", "iconserver": "7", "iconfarm": 8, "friend": 1, "family": 0, "path_alias": "anaruiz" }));
        assert_eq!(st(&c, "name"), "Ana Ruiz");
        assert_eq!(c["friend"], true);
        assert_eq!(st(&c, "site"), "https://www.flickr.com/photos/anaruiz/");
        assert_eq!(st(&c, "feed"), "https://www.flickr.com/services/feeds/photos_public.gne?id=44@N00&format=atom");
        let l = links_in("Prints at <a href=\"https://ana.shop/p?a=1&amp;b=2\" rel=\"nofollow\">my shop</a>, blog <a href='http://ana.blog'>here</a>, again <a href=\"https://ana.shop/p?a=1&amp;b=2\">x</a> <a href=\"/photos/x\">y</a>");
        assert_eq!(l, vec!["https://ana.shop/p?a=1&b=2".to_string(), "http://ana.blog".to_string()]);
        assert_eq!(short("abcdefghij", 6), "abcd…");
        let x = photo(&json!({ "id": "1", "secret": "s", "server": "2", "description": { "_content": "Fog <b>lifting</b>" } }), "me@N00");
        assert_eq!(st(&x, "description"), "Fog lifting");
    }

    #[test]
    fn albums_read() {
        let a = album_item(&json!({ "id": "721", "primary": "54", "secret": "s", "server": "65535", "photos": 12, "videos": 1, "title": { "_content": "Fall walks" }, "description": { "_content": "" }, "date_update": "1764200000", "date_create": "1764100000" }), "me@N00");
        assert!(st(&a, "created").starts_with("2025-11-25"));
        assert_eq!(st(&a, "title"), "Fall walks");
        assert_eq!(a["count"], 13);
        assert_eq!(st(&a, "cover"), "https://live.staticflickr.com/65535/54_s_z.jpg");
        assert_eq!(st(&a, "page"), "https://www.flickr.com/photos/me@N00/albums/721/");
    }

    #[test]
    fn plain_words() {
        assert_eq!(plain("Lovely <a href=\"x\">light</a>!<br />Thanks &amp; well done"), "Lovely light!\nThanks & well done");
        assert_eq!(who_sees(&json!({"ispublic": 0, "isfriend": 1, "isfamily": 1})), "both");
        assert_eq!(who_sees(&json!({"ispublic": "1", "isfriend": 0, "isfamily": 0})), "public");
        let c = comment_item(&json!({"id": "1-2", "author": "44@N00", "authorname": "lenslady", "realname": "", "datecreate": "1764200000", "_content": "Great <b>shot</b>"}), "me@N00");
        assert_eq!(st(&c, "name"), "lenslady");
        assert_eq!(st(&c, "text"), "Great shot");
        assert_eq!(c["mine"], false);
    }

    #[test]
    fn photos_and_comments() {
        let p = json!({ "id": "5412", "owner": "12037949754@N01", "secret": "abc", "server": "65535", "title": "Rain on 5th", "ownername": "Ana", "iconserver": "7", "iconfarm": 8, "dateupload": "1764100000", "ispublic": 0, "isfriend": 1, "isfamily": 0 });
        let x = photo(&p, "me@N00");
        assert_eq!(st(&x, "img"), "https://live.staticflickr.com/65535/5412_abc_z.jpg");
        assert_eq!(st(&x, "page"), "https://www.flickr.com/photos/12037949754@N01/5412/");
        assert_eq!(st(&x, "face"), "https://farm8.staticflickr.com/7/buddyicons/12037949754@N01.jpg");
        assert_eq!(x["friend"], true);
        assert!(st(&x, "date").starts_with("2025-11-25"));
        let r = json!({ "items": { "item": [{ "type": "photo", "id": "9", "owner": "me@N00", "secret": "s", "server": "1", "title": { "_content": "Porch" },
            "activity": { "event": [
                { "type": "comment", "user": "44@N00", "username": "lenslady", "realname": "", "dateadded": "1764200000", "_content": "Lovely light." },
                { "type": "fave", "user": "45@N00", "username": "x", "dateadded": "1764200001" },
                { "type": "comment", "user": "me@N00", "username": "me", "dateadded": "1764200002", "_content": "Thanks!" }
            ] } }] } });
        let a = activity_items(&r, "me@N00");
        assert_eq!(a.len(), 1);
        assert_eq!(st(&a[0], "name"), "lenslady");
        assert_eq!(st(&a[0], "text"), "Lovely light.");
        assert_eq!(st(&a[0], "photo"), "Porch");
        assert_eq!(st(&a[0], "link"), "https://www.flickr.com/photos/me@N00/9/");
    }
}
