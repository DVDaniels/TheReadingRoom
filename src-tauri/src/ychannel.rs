//! YouTube for The Reading Room Plus: manage your own channel from the app, the way Writing posts to your site.
//!
//! - Connect: Google's sign-in opens in your browser; you sign in there and approve the app. Google then sends you to
//!   readingroomapp.com/connect/youtube/, which shows a code to copy back into the app (the page only shows the code;
//!   it keeps nothing). The app trades the code (with PKCE) for a sign-in kept in the Keychain, like the other
//!   accounts, and renews it by itself.
//! - Your channel: its name, subscribers and your uploads (newest first) with their visibility and numbers.
//! - Upload: YouTube's resumable upload, in 8 MB pieces. If the connection drops (or iOS pauses the app), the next
//!   try asks YouTube how much arrived and carries on from there instead of starting over.
//!
//! - Several channels: each channel you connect (your own, or a Brand Account channel you manage) keeps its own
//!   sign-in, and Your channel shows one at a time. Everything you do (lists, numbers, uploads) names its channel, so
//!   switching mid-upload never sends a video to the wrong one.
//!
//! Until YouTube audits the app, YouTube makes every upload from it Private; the interface says so where you upload.
//! The whole app shares one daily allowance from YouTube (100 uploads, 10,000 units for everything else), so lists
//! ask only for what they show.

use crate::social::{call, client, explain, secret_delete, secret_get, secret_set, social_accounts, st, with_json, Accounts};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::Mutex;

const API: &str = "https://www.googleapis.com/youtube/v3";
const UPLOAD: &str = "https://www.googleapis.com/upload/youtube/v3/videos";
const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const REDIRECT: &str = "https://readingroomapp.com/connect/youtube/";
/// Upload, manage your videos and playlists, and answer comments; read your channel's numbers.
const SCOPES: &str = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly";
const KEY: &str = "youtube";
/// Upload piece size: a multiple of 256 KB, as YouTube asks.
const PIECE: u64 = 8 * 1024 * 1024;

fn app_key() -> Result<(&'static str, &'static str), String> {
    let k = option_env!("YOUTUBE_CLIENT_ID").unwrap_or("").trim();
    let s = option_env!("YOUTUBE_CLIENT_SECRET").unwrap_or("").trim();
    if k.is_empty() || s.is_empty() {
        return Err("This version of the app can't connect to YouTube yet.".into());
    }
    Ok((k, s))
}

// ------------------------------------------------------------------ the channels you've connected

/// Everything kept in the Keychain under "youtube": every connected channel, by its id, and which one is in use.
/// Version 1.3.0's first builds kept one channel at the top level; that reads as a list of one.
fn store() -> Option<Value> {
    let s = secret_get(KEY)?;
    if s["channels"].is_object() {
        return Some(s);
    }
    let id = st(&s, "channel");
    if id.is_empty() {
        return None;
    }
    let mut chans = serde_json::Map::new();
    chans.insert(id.clone(), s);
    Some(json!({ "current": id, "channels": chans }))
}

/// The channel in use (the first one if the one in use was removed).
fn current_id(s: &Value) -> String {
    let cur = st(s, "current");
    if s["channels"].get(&cur).is_some() {
        return cur;
    }
    s["channels"].as_object().and_then(|m| m.keys().next().cloned()).unwrap_or_default()
}

/// The channel to work with: the one named, or the one in use.
fn pick(channel: Option<&str>) -> Result<String, String> {
    let s = store().ok_or("Connect YouTube first.")?;
    match channel.filter(|c| !c.is_empty()) {
        Some(c) if s["channels"].get(c).is_some() => Ok(c.to_string()),
        Some(_) => Err("That channel isn't connected any more. Pick another in Your channel.".into()),
        None => Ok(current_id(&s)),
    }
}

fn channel_of(id: &str) -> Result<Value, String> {
    store().and_then(|s| s["channels"].get(id).cloned()).ok_or_else(|| "That channel isn't connected any more. Connect it again in Settings › Connections.".to_string())
}

/// Save one channel. `add` connects a new one and makes it the one in use; otherwise it only updates a channel that
/// is still connected (a sign-in renewed after you disconnected doesn't bring the channel back).
fn put_channel(c: &Value, add: bool) -> Result<(), String> {
    let id = st(c, "channel");
    let mut s = store().unwrap_or_else(|| json!({ "current": "", "channels": {} }));
    if !add && s["channels"].get(&id).is_none() {
        return Ok(());
    }
    s["channels"][id.as_str()] = c.clone();
    if add || current_id(&s).is_empty() {
        s["current"] = json!(id);
    }
    secret_set(KEY, &s)
}

fn brief(c: &Value) -> Value {
    json!({ "channel": st(c, "channel"), "name": st(c, "title"), "handle": st(c, "handle"), "site": st(c, "url"), "avatar": st(c, "avatar") })
}

/// The channel in use, for the accounts list, with every connected channel in `channels` (by name).
pub fn account() -> Option<Value> {
    let s = store()?;
    let cur = current_id(&s);
    let mut all: Vec<Value> = s["channels"].as_object()?.values().map(brief).collect();
    if all.is_empty() {
        return None;
    }
    all.sort_by_key(|c| st(c, "name").to_lowercase());
    let mut me = all.iter().find(|c| st(c, "channel") == cur).cloned().unwrap_or_else(|| all[0].clone());
    me["channels"] = json!(all);
    Some(me)
}

/// Use another connected channel in Your channel.
#[tauri::command]
pub fn youtube_use(channel: String) -> Result<Accounts, String> {
    let mut s = store().ok_or("Connect YouTube first.")?;
    if s["channels"].get(&channel).is_none() {
        return Err("That channel isn't connected any more.".into());
    }
    s["current"] = json!(channel);
    secret_set(KEY, &s)?;
    Ok(social_accounts())
}

// ------------------------------------------------------------------ connecting

/// The PKCE verifier for the sign-in in progress (kept only while the app is open).
fn pending() -> &'static Mutex<Option<String>> {
    static P: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

/// Step one: Google's page where you sign in and approve the app.
#[tauri::command]
pub async fn youtube_begin() -> Result<String, String> {
    let (id, _) = app_key()?;
    let mut raw = [0u8; 32];
    crate::micropub::getrandom(&mut raw).map_err(|_| "Couldn't start the sign-in. Try again.".to_string())?;
    let verifier = crate::micropub::b64url(&raw);
    let challenge = crate::micropub::b64url(&crate::micropub::sha256(verifier.as_bytes()));
    *pending().lock().await = Some(verifier);
    let mut u = url::Url::parse(AUTH).map_err(|e| e.to_string())?;
    u.query_pairs_mut()
        .append_pair("client_id", id)
        .append_pair("redirect_uri", REDIRECT)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "select_account consent")
        .append_pair("include_granted_scopes", "true")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(u.to_string())
}

/// Step two: the code readingroomapp.com showed after you approved the app (the whole address works too). The channel
/// joins the ones already connected and becomes the one in use; connecting a channel again renews its sign-in.
#[tauri::command]
pub async fn youtube_finish(code: String) -> Result<Accounts, String> {
    let (id, secret) = app_key()?;
    let code = code_from(&code);
    if code.is_empty() {
        return Err("Paste the code from the page that opened after you approved the app.".into());
    }
    let verifier = pending().lock().await.clone().ok_or("Press Connect YouTube first, then paste the code.")?;
    let tok = call(client().post(TOKEN).form(&[
        ("grant_type", "authorization_code"), ("code", code.as_str()), ("client_id", id), ("client_secret", secret),
        ("redirect_uri", REDIRECT), ("code_verifier", verifier.as_str()),
    ]))
    .await
    .map_err(|e| if e.0 == 400 || e.0 == 401 { "That code didn't work. Codes work once and only for a few minutes: press Connect YouTube again.".to_string() } else { explain(e) })?;
    let token = st(&tok, "access_token");
    if token.is_empty() {
        return Err("Google didn't send a sign-in back. Try again.".into());
    }
    let ch = call(client().get(format!("{API}/channels?part=snippet,statistics,contentDetails&mine=true")).bearer_auth(&token)).await.map_err(yt_fail)?;
    let c = ch["items"][0].clone();
    if c.is_null() {
        return Err("That Google account has no YouTube channel yet. Make one on youtube.com, then connect again.".into());
    }
    let mut s = channel_fields(&c);
    s["token"] = json!(token);
    s["refresh"] = json!(st(&tok, "refresh_token"));
    s["expires"] = json!(expires_at(&tok));
    put_channel(&s, true)?;
    *pending().lock().await = None;
    Ok(social_accounts())
}

/// Disconnect one channel (the one in use if none is named): forget its sign-in here and ask Google to cancel it too.
/// The others stay connected.
#[tauri::command]
pub async fn youtube_disconnect(channel: Option<String>) -> Accounts {
    let Some(mut s) = store() else { return social_accounts() };
    let id = channel.filter(|c| !c.is_empty()).unwrap_or_else(|| current_id(&s));
    if let Some(c) = s["channels"].get(&id).cloned() {
        let t = if st(&c, "refresh").is_empty() { st(&c, "token") } else { st(&c, "refresh") };
        let _ = client().post("https://oauth2.googleapis.com/revoke").form(&[("token", t.as_str())]).timeout(Duration::from_secs(10)).send().await;
    }
    if let Some(m) = s["channels"].as_object_mut() {
        m.remove(&id);
    }
    if s["channels"].as_object().map_or(true, |m| m.is_empty()) {
        secret_delete(KEY);
    } else {
        let next = current_id(&s);
        s["current"] = json!(next);
        let _ = secret_set(KEY, &s);
    }
    social_accounts()
}

fn channel_fields(c: &Value) -> Value {
    let id = st(c, "id");
    let handle = st(c, "snippet.customUrl");
    json!({
        "channel": id,
        "title": st(c, "snippet.title"),
        "handle": handle,
        "url": if handle.is_empty() { format!("https://www.youtube.com/channel/{id}") } else { format!("https://www.youtube.com/{handle}") },
        "avatar": st(c, "snippet.thumbnails.default.url"),
        "uploads": st(c, "contentDetails.relatedPlaylists.uploads"),
    })
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

fn expires_at(tok: &Value) -> i64 {
    chrono::Utc::now().timestamp() + tok["expires_in"].as_i64().unwrap_or(3600)
}

/// A channel's sign-in that's good for the next minute, renewed with its refresh token when it's about to run out.
async fn token(ch: &str, force: bool) -> Result<String, String> {
    let mut s = channel_of(ch)?;
    if !force && s["expires"].as_i64().unwrap_or(0) > chrono::Utc::now().timestamp() + 60 {
        return Ok(st(&s, "token"));
    }
    let refresh = st(&s, "refresh");
    if refresh.is_empty() {
        return Err("Your YouTube sign-in ran out. Connect YouTube again in Settings › Connections.".into());
    }
    let (id, secret) = app_key()?;
    let tok = call(client().post(TOKEN).form(&[("grant_type", "refresh_token"), ("refresh_token", refresh.as_str()), ("client_id", id), ("client_secret", secret)]))
        .await
        .map_err(|e| if e.0 == 400 || e.0 == 401 { "Google signed the app out. Connect YouTube again in Settings › Connections.".to_string() } else { explain(e) })?;
    s["token"] = json!(st(&tok, "access_token"));
    s["expires"] = json!(expires_at(&tok));
    put_channel(&s, false)?;
    Ok(st(&s, "token"))
}

/// Call the YouTube Data API as one channel. A refused sign-in is renewed once.
async fn api(ch: &str, method: reqwest::Method, path: &str, body: Option<&Value>) -> Result<Value, String> {
    for attempt in 0..2 {
        let tok = token(ch, attempt > 0).await?;
        let mut req = client().request(method.clone(), format!("{API}{path}")).bearer_auth(&tok);
        if let Some(b) = body {
            req = with_json(req, b);
        }
        match call(req).await {
            Ok(v) => return Ok(v),
            Err(e) if e.0 == 401 && attempt == 0 => continue,
            Err(e) => return Err(yt_fail(e)),
        }
    }
    Err("YouTube didn't accept the sign-in.".into())
}

/// YouTube's errors, in words a person can use.
fn yt_fail(e: (u16, String)) -> String {
    let v: Value = serde_json::from_str(&e.1).unwrap_or(Value::Null);
    let reason = st(&v, "error.errors.0.reason");
    let reason = if reason.is_empty() { v["error"]["errors"][0]["reason"].as_str().unwrap_or("").to_string() } else { reason };
    match (e.0, reason.as_str()) {
        (_, "quotaExceeded") | (_, "uploadLimitExceeded") => "YouTube's daily allowance for The Reading Room is used up. Try again tomorrow, or upload on youtube.com today.".into(),
        (_, "youtubeSignupRequired") => "That Google account has no YouTube channel yet. Make one on youtube.com, then connect again.".into(),
        (401, _) | (403, "insufficientPermissions") => "YouTube didn't accept the sign-in. Connect YouTube again in Settings › Connections.".into(),
        (404, _) => "YouTube couldn't find that video. It may have been deleted on YouTube.".into(),
        _ => {
            let said = st(&v, "error.message");
            if said.is_empty() { explain(e) } else { format!("YouTube said: {said}") }
        }
    }
}

// ------------------------------------------------------------------ your channel

/// A channel (the one in use if none is named) and its latest uploads (newest first, 25 at a time; `page` continues
/// a list). `channel` in the answer says which channel it is, so a list that arrives after you switched is ignored.
#[tauri::command]
pub async fn youtube_channel(page: Option<String>, channel: Option<String>) -> Result<Value, String> {
    let id = pick(channel.as_deref())?;
    let mut s = channel_of(&id)?;
    let ch = api(&id, reqwest::Method::GET, "/channels?part=snippet,statistics,contentDetails&mine=true", None).await?;
    let c = ch["items"][0].clone();
    if !c.is_null() {
        let f = channel_fields(&c);
        for k in ["title", "handle", "url", "avatar", "uploads"] {
            s[k] = f[k].clone();
        }
        let _ = put_channel(&s, false);
    }
    let uploads = st(&s, "uploads");
    let mut path = format!("/playlistItems?part=contentDetails&maxResults=25&playlistId={uploads}");
    if let Some(p) = page.filter(|p| !p.is_empty()) {
        path.push_str(&format!("&pageToken={}", urlencoding(&p)));
    }
    let list = if uploads.is_empty() { json!({}) } else { api(&id, reqwest::Method::GET, &path, None).await? };
    let ids: Vec<String> = list["items"].as_array().cloned().unwrap_or_default().iter().map(|i| st(i, "contentDetails.videoId")).filter(|i| !i.is_empty()).collect();
    let vids = if ids.is_empty() { json!({ "items": [] }) } else {
        api(&id, reqwest::Method::GET, &format!("/videos?part=snippet,status,statistics,contentDetails&id={}", ids.join(",")), None).await?
    };
    let mut by: HashMap<String, Value> = HashMap::new();
    for v in vids["items"].as_array().cloned().unwrap_or_default() {
        by.insert(st(&v, "id"), video_row(&v));
    }
    let videos: Vec<Value> = ids.iter().filter_map(|i| by.remove(i)).collect();
    Ok(json!({
        "channel": st(&s, "channel"), "name": st(&s, "title"), "handle": st(&s, "handle"), "url": st(&s, "url"), "avatar": st(&s, "avatar"),
        "subscribers": c["statistics"]["hiddenSubscriberCount"].as_bool().unwrap_or(false).then_some(Value::Null).unwrap_or_else(|| num(&c["statistics"]["subscriberCount"])),
        "views": num(&c["statistics"]["viewCount"]),
        "count": num(&c["statistics"]["videoCount"]),
        "videos": videos,
        "next": st(&list, "nextPageToken"),
    }))
}

fn num(v: &Value) -> Value {
    match v {
        Value::String(s) => s.parse::<i64>().map(Value::from).unwrap_or(Value::Null),
        Value::Number(_) => v.clone(),
        _ => Value::Null,
    }
}

fn video_row(v: &Value) -> Value {
    let id = st(v, "id");
    let thumbs = &v["snippet"]["thumbnails"];
    let thumb = ["medium", "high", "default"].iter().map(|k| st(&thumbs[*k], "url")).find(|u| !u.is_empty()).unwrap_or_default();
    let publish_at = st(v, "status.publishAt");
    json!({
        "id": id,
        "title": st(v, "snippet.title"),
        "description": st(v, "snippet.description"),
        "tags": v["snippet"]["tags"].clone(),
        "thumb": thumb,
        "privacy": st(v, "status.privacyStatus"),
        "publishAt": publish_at,
        "state": st(v, "status.uploadStatus"),
        "date": st(v, "snippet.publishedAt"),
        "duration": st(v, "contentDetails.duration"),
        "views": num(&v["statistics"]["viewCount"]),
        "likes": num(&v["statistics"]["likeCount"]),
        "comments": num(&v["statistics"]["commentCount"]),
        "link": format!("https://www.youtube.com/watch?v={id}"),
        "studio": format!("https://studio.youtube.com/video/{id}/edit"),
    })
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// ------------------------------------------------------------------ your channel's numbers

const ANALYTICS: &str = "https://youtubeanalytics.googleapis.com/v2/reports";

/// One YouTube Analytics report for your channel (YouTube Analytics API; read-only, its own allowance).
async fn report(ch: &str, start: &str, end: &str, metrics: &str, extra: &str) -> Result<Value, String> {
    let path = format!("{ANALYTICS}?ids=channel%3D%3DMINE&startDate={start}&endDate={end}&metrics={metrics}{extra}");
    for attempt in 0..2 {
        let tok = token(ch, attempt > 0).await?;
        match call(client().get(&path).bearer_auth(&tok)).await {
            Ok(v) => return Ok(v),
            Err(e) if e.0 == 401 && attempt == 0 => continue,
            Err(e) if e.0 == 403 => return Err("YouTube didn't let the app read your channel's numbers. Disconnect YouTube and connect it again to allow it.".into()),
            Err(e) => return Err(yt_fail(e)),
        }
    }
    Err("YouTube didn't accept the sign-in.".into())
}

/// The rows of a report as (first column as text, the other columns as numbers).
fn rows(r: &Value) -> Vec<(String, Vec<f64>)> {
    r["rows"].as_array().cloned().unwrap_or_default().iter().filter_map(|row| {
        let a = row.as_array()?;
        let key = match a.first()? { Value::String(s) => s.clone(), v => v.to_string() };
        Some((key, a.iter().skip(1).map(|x| x.as_f64().unwrap_or(0.0)).collect()))
    }).collect()
}

/// The totals row of a report with no dimension.
fn totals(r: &Value) -> Vec<f64> {
    r["rows"][0].as_array().map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect()).unwrap_or_default()
}

/// What YouTube calls each way people found a video, in plain words.
fn source_name(k: &str) -> &'static str {
    match k {
        "YT_SEARCH" => "YouTube search",
        "SUBSCRIBER" => "Subscribers' feeds",
        "RELATED_VIDEO" => "Suggested next to other videos",
        "BROWSE" | "YT_CHANNEL" => "Your channel and Home",
        "EXT_URL" => "Links from other sites",
        "NO_LINK_OTHER" | "NO_LINK_EMBEDDED" => "Typed in or embedded",
        "PLAYLIST" | "YT_PLAYLIST_PAGE" => "Playlists",
        "SHORTS" => "The Shorts feed",
        "NOTIFICATION" => "Notifications",
        "END_SCREEN" | "ANNOTATION" => "End screens",
        "HASHTAGS" => "Hashtags",
        _ => "Other",
    }
}

/// Your channel's numbers for the last 28 days, like Your blog's: views each day (and the 28 days before, to
/// compare), watch time, subscribers gained and lost, the videos watched most, how people found them and the
/// YouTube searches that brought them. YouTube's numbers run two or three days behind; `through` says to when.
#[tauri::command]
pub async fn youtube_stats(channel: Option<String>) -> Result<Value, String> {
    let id = pick(channel.as_deref())?;
    let s = channel_of(&id)?;
    let today = chrono::Utc::now().date_naive();
    let end = today - chrono::Duration::days(1);
    let start = end - chrono::Duration::days(27);
    let (pend, pstart) = (start - chrono::Duration::days(1), start - chrono::Duration::days(28));
    let (a, b) = (start.to_string(), end.to_string());
    let m = "views,estimatedMinutesWatched,subscribersGained,subscribersLost";
    let (pa, pb) = (pstart.to_string(), pend.to_string());
    let (daily, before, vids, srcs, terms) = tokio::join!(
        report(&id, &a, &b, m, "&dimensions=day&sort=day"),
        report(&id, &pa, &pb, m, ""),
        report(&id, &a, &b, "views,estimatedMinutesWatched", "&dimensions=video&sort=-views&maxResults=5"),
        report(&id, &a, &b, "views", "&dimensions=insightTrafficSourceType&sort=-views"),
        report(&id, &a, &b, "views", "&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType%3D%3DYT_SEARCH&sort=-views&maxResults=6"),
    );
    let daily = daily?;
    let days: Vec<(String, Vec<f64>)> = rows(&daily).into_iter().filter(|(_, v)| v.iter().any(|x| *x > 0.0)).collect::<Vec<_>>();
    let all_days = rows(&daily);
    let sum = |i: usize| all_days.iter().map(|(_, v)| v.get(i).copied().unwrap_or(0.0)).sum::<f64>();
    let prev = before.ok().map(|r| totals(&r)).unwrap_or_default();
    let through = days.last().map(|(d, _)| d.clone()).unwrap_or_default();
    // the top videos' titles (one cheap call for all of them)
    let top_rows = vids.ok().map(|r| rows(&r)).unwrap_or_default();
    let mut titles: HashMap<String, (String, String)> = HashMap::new();
    if !top_rows.is_empty() {
        let ids: Vec<String> = top_rows.iter().map(|(id, _)| id.clone()).collect();
        if let Ok(v) = api(&id, reqwest::Method::GET, &format!("/videos?part=snippet&id={}", ids.join(",")), None).await {
            for it in v["items"].as_array().cloned().unwrap_or_default() {
                let thumbs = &it["snippet"]["thumbnails"];
                titles.insert(st(&it, "id"), (st(&it, "snippet.title"), st(&thumbs["default"], "url")));
            }
        }
    }
    let top: Vec<Value> = top_rows.iter().map(|(id, v)| {
        let (title, thumb) = titles.get(id).cloned().unwrap_or_default();
        json!({ "id": id, "title": title, "thumb": thumb, "views": v.first().copied().unwrap_or(0.0) as i64,
            "minutes": v.get(1).copied().unwrap_or(0.0) as i64, "link": format!("https://www.youtube.com/watch?v={id}") })
    }).collect();
    let mut found: Vec<(String, i64)> = Vec::new();
    for (k, v) in srcs.ok().map(|r| rows(&r)).unwrap_or_default() {
        let name = source_name(&k).to_string();
        let n = v.first().copied().unwrap_or(0.0) as i64;
        match found.iter_mut().find(|(f, _)| *f == name) { Some(f) => f.1 += n, None => found.push((name, n)) }
    }
    found.sort_by(|x, y| y.1.cmp(&x.1));
    let searches: Vec<Value> = terms.ok().map(|r| rows(&r)).unwrap_or_default().into_iter()
        .map(|(q, v)| json!({ "q": q, "views": v.first().copied().unwrap_or(0.0) as i64 })).collect();
    let p = |i: usize| prev.get(i).map(|x| *x as i64);
    Ok(json!({
        "kind": "youtube", "channel": id,
        "name": st(&s, "title"), "url": st(&s, "url"), "studio": format!("https://studio.youtube.com/channel/{}/analytics", st(&s, "channel")),
        "window": 28, "through": through,
        "views": { "total": sum(0) as i64, "prev": p(0), "days": all_days.iter().map(|(d, v)| json!({ "d": d, "n": v.first().copied().unwrap_or(0.0) as i64 })).collect::<Vec<_>>() },
        "hours": { "total": (sum(1) / 60.0).round() as i64, "prev": p(1).map(|m| (m as f64 / 60.0).round() as i64) },
        "subs": { "gained": sum(2) as i64, "lost": sum(3) as i64, "prevNet": match (p(2), p(3)) { (Some(g), Some(l)) => Some(g - l), _ => None } },
        "top": top,
        "found": found.iter().take(5).map(|(n, v)| json!({ "name": n, "views": v })).collect::<Vec<_>>(),
        "searches": searches,
    }))
}

// ------------------------------------------------------------------ uploading

/// Upload sessions in progress, by file path, so a second try picks up where the first stopped.
fn sessions() -> &'static Mutex<HashMap<String, String>> {
    static S: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// What you fill in on the upload sheet.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadInfo {
    pub path: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// YouTube's category id; 22 is People & Blogs
    #[serde(default)]
    pub category: Option<String>,
    /// YouTube asks every upload whether it's made for kids
    pub for_kids: bool,
    /// public, unlisted or private
    pub privacy: String,
    /// RFC 3339 time to go public (the video stays private until then)
    #[serde(default)]
    pub publish_at: Option<String>,
    /// the channel it goes to (the one in use if empty)
    #[serde(default)]
    pub channel: Option<String>,
}

fn snippet_status(i: &UploadInfo) -> Value {
    let scheduled = i.publish_at.as_deref().filter(|p| !p.is_empty());
    let mut status = json!({ "privacyStatus": if scheduled.is_some() { "private" } else { i.privacy.as_str() }, "selfDeclaredMadeForKids": i.for_kids });
    if let Some(p) = scheduled {
        status["publishAt"] = json!(p);
    }
    json!({
        "snippet": { "title": i.title.trim(), "description": i.description, "tags": i.tags, "categoryId": i.category.clone().unwrap_or_else(|| "22".into()) },
        "status": status,
    })
}

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "mov" => "video/quicktime",
        "m4v" => "video/x-m4v",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        _ => "video/mp4",
    }
}

/// Upload a video from a file on this device to the channel named in `info` (fixed when the upload starts, so
/// switching channels meanwhile changes nothing). Progress goes out as "youtube-upload" events ({path, sent, total}).
/// Returns the new video (as in Your channel's list), with `channel`.
#[tauri::command]
pub async fn youtube_upload(app: tauri::AppHandle, info: UploadInfo) -> Result<Value, String> {
    if info.title.trim().is_empty() {
        return Err("Give the video a title first.".into());
    }
    if info.title.chars().count() > 100 {
        return Err("YouTube titles can be up to 100 characters.".into());
    }
    let meta = tokio::fs::metadata(&info.path).await.map_err(|_| "Couldn't open that video file.".to_string())?;
    let total = meta.len();
    if total == 0 {
        return Err("That video file is empty.".into());
    }
    let mime = mime_for(&info.path);
    let ch = pick(info.channel.as_deref())?;
    // a session already started for this file and channel carries on; otherwise start one
    let skey = format!("{ch}\n{}", info.path);
    let known = sessions().lock().await.get(&skey).cloned();
    let session = match known {
        Some(s) => s,
        None => {
            let tok = token(&ch, false).await?;
            let resp = client()
                .post(format!("{UPLOAD}?uploadType=resumable&part=snippet,status"))
                .bearer_auth(&tok)
                .header("X-Upload-Content-Length", total.to_string())
                .header("X-Upload-Content-Type", mime)
                .header("Content-Type", "application/json; charset=UTF-8")
                .body(snippet_status(&info).to_string())
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .map_err(|_| "Couldn't reach YouTube. Check your connection.".to_string())?;
            let code = resp.status().as_u16();
            let loc = resp.headers().get("location").and_then(|h| h.to_str().ok()).unwrap_or("").to_string();
            if code >= 400 || loc.is_empty() {
                return Err(yt_fail((code, resp.text().await.unwrap_or_default())));
            }
            sessions().lock().await.insert(skey.clone(), loc.clone());
            loc
        }
    };
    let done = send_pieces(&app, &info.path, &skey, &session, total, mime).await?;
    sessions().lock().await.remove(&skey);
    let mut row = video_row(&done);
    row["channel"] = json!(ch);
    Ok(row)
}

/// How much of the file YouTube already has (after a dropped connection), from the Range header of a 308.
fn received(range: &str) -> u64 {
    range.rsplit('-').next().and_then(|n| n.trim().parse::<u64>().ok()).map(|n| n + 1).unwrap_or(0)
}

async fn send_pieces(app: &tauri::AppHandle, path: &str, skey: &str, session: &str, total: u64, mime: &str) -> Result<Value, String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    // ask where to start (0 for a new session)
    let mut from = {
        let r = client().put(session).header("Content-Range", format!("bytes */{total}")).header("Content-Length", "0").timeout(Duration::from_secs(30)).send().await;
        match r {
            Ok(r) if r.status().as_u16() == 308 => r.headers().get("range").and_then(|h| h.to_str().ok()).map(received).unwrap_or(0),
            Ok(r) if r.status().is_success() => return Ok(r.json::<Value>().await.unwrap_or(Value::Null)),
            Ok(r) if r.status().as_u16() == 404 || r.status().as_u16() == 410 => {
                sessions().lock().await.remove(skey);
                return Err("YouTube let that upload go after it stopped for too long. Press Upload again to start it over.".into());
            }
            _ => 0,
        }
    };
    let mut f = tokio::fs::File::open(path).await.map_err(|_| "Couldn't open that video file.".to_string())?;
    let mut tries = 0;
    loop {
        let _ = app.emit("youtube-upload", json!({ "path": path, "sent": from, "total": total }));
        let len = PIECE.min(total - from);
        f.seek(std::io::SeekFrom::Start(from)).await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; len as usize];
        f.read_exact(&mut buf).await.map_err(|_| "Couldn't read the video file. Was it moved?".to_string())?;
        let r = client()
            .put(session)
            .header("Content-Type", mime)
            .header("Content-Range", format!("bytes {}-{}/{}", from, from + len - 1, total))
            .body(buf)
            .timeout(Duration::from_secs(300))
            .send()
            .await;
        match r {
            Ok(r) if r.status().is_success() => {
                let _ = app.emit("youtube-upload", json!({ "path": path, "sent": total, "total": total }));
                return Ok(r.json::<Value>().await.unwrap_or(Value::Null));
            }
            Ok(r) if r.status().as_u16() == 308 => {
                from = r.headers().get("range").and_then(|h| h.to_str().ok()).map(received).unwrap_or(from + len);
                tries = 0;
            }
            Ok(r) if r.status().is_server_error() && tries < 4 => {
                tries += 1;
                tokio::time::sleep(Duration::from_secs(2u64.pow(tries))).await;
            }
            Ok(r) => {
                let code = r.status().as_u16();
                return Err(yt_fail((code, r.text().await.unwrap_or_default())));
            }
            Err(_) if tries < 4 => {
                tries += 1;
                tokio::time::sleep(Duration::from_secs(2u64.pow(tries))).await;
                // ask YouTube how much arrived before carrying on
                if let Ok(q) = client().put(session).header("Content-Range", format!("bytes */{total}")).header("Content-Length", "0").timeout(Duration::from_secs(30)).send().await {
                    if q.status().as_u16() == 308 {
                        from = q.headers().get("range").and_then(|h| h.to_str().ok()).map(received).unwrap_or(0);
                    }
                }
            }
            Err(_) => return Err("The upload stopped: the connection dropped. Press Upload again and it carries on where it stopped.".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_rows_and_sources() {
        let r = json!({ "rows": [["2026-11-20", 10, 30.0, 1, 0], ["2026-11-21", 5, 12.5, 0, 1]] });
        let x = rows(&r);
        assert_eq!(x.len(), 2);
        assert_eq!(x[1].0, "2026-11-21");
        assert_eq!(x[0].1, vec![10.0, 30.0, 1.0, 0.0]);
        assert_eq!(totals(&json!({ "rows": [[40, 90]] })), vec![40.0, 90.0]);
        assert_eq!(source_name("YT_SEARCH"), "YouTube search");
        assert_eq!(source_name("SOMETHING_NEW"), "Other");
    }

    #[test]
    fn channel_briefs_for_the_list() {
        let c = json!({ "channel": "UC1", "title": "Walks", "handle": "@walks", "url": "https://www.youtube.com/@walks", "avatar": "a.jpg", "token": "secret" });
        let b = brief(&c);
        assert_eq!(b["name"], "Walks");
        assert_eq!(b["site"], "https://www.youtube.com/@walks");
        assert!(b.get("token").is_none(), "sign-ins never go to the interface");
        let s = json!({ "current": "gone", "channels": { "UC2": {}, "UC3": {} } });
        assert_eq!(current_id(&s), "UC2", "a removed channel falls back to the first one left");
        assert_eq!(current_id(&json!({ "current": "UC3", "channels": { "UC2": {}, "UC3": {} } })), "UC3");
    }

    #[test]
    fn resume_point_from_range() {
        assert_eq!(received("bytes=0-8388607"), 8388608);
        assert_eq!(received(""), 0);
    }

    #[test]
    fn scheduled_uploads_start_private() {
        let i = UploadInfo { path: "/a.mov".into(), title: " Hi ".into(), description: String::new(), tags: vec!["blog".into()], category: None, for_kids: false, privacy: "public".into(), publish_at: Some("2026-12-01T15:00:00Z".into()), channel: None };
        let b = snippet_status(&i);
        assert_eq!(b["status"]["privacyStatus"], "private");
        assert_eq!(b["status"]["publishAt"], "2026-12-01T15:00:00Z");
        assert_eq!(b["snippet"]["title"], "Hi");
        assert_eq!(b["snippet"]["categoryId"], "22");
        assert_eq!(mime_for("/x/clip.MOV"), "video/quicktime");
    }

    #[test]
    fn rows_from_youtube() {
        let v = json!({ "id": "abc", "snippet": { "title": "T", "publishedAt": "2026-11-20T10:00:00Z", "thumbnails": { "medium": { "url": "https://i.ytimg.com/x.jpg" } } },
            "status": { "privacyStatus": "private", "uploadStatus": "processed" }, "statistics": { "viewCount": "12", "likeCount": "3" } });
        let r = video_row(&v);
        assert_eq!(r["views"], 12);
        assert_eq!(r["thumb"], "https://i.ytimg.com/x.jpg");
        assert_eq!(r["link"], "https://www.youtube.com/watch?v=abc");
    }
}
