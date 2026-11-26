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
    u.query_pairs_mut().append_pair("oauth_token", &tok).append_pair("perms", "write");
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
    })
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
        ("extras", "date_upload,views,count_faves,count_comments".to_string()),
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
