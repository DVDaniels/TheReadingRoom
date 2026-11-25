//! Tumblr as a home for Writing (The Reading Room Plus), and as a place to copy posts to.
//!
//! - Connect: Tumblr's own sign-in page opens in your browser; you sign in there and approve the app. Tumblr then
//!   sends you to readingroomapp.com/connect/tumblr/, which shows a code to copy back into the app (the page only
//!   shows the code; it keeps nothing). The app trades the code for a sign-in that is kept in the Keychain, like
//!   the other accounts, and renews it by itself.
//! - When Tumblr is your home (no WordPress or Micropub site connected), Writing's commands (site_note, site_post, site_posts…)
//!   come here: Notes, Posts and Weeknotes become text posts on your Tumblr blog, drafts go to Tumblr's drafts,
//!   and "notes" and "weeknotes" are tags, standing in for WordPress's categories.
//! - Your Tumblr: followers and the notes (likes and reblogs) on your recent posts. Tumblr doesn't give apps
//!   visits or search numbers.
//!
//! Tumblr's post ids are too big for the app's interface to hold exactly (JavaScript numbers), so each one gets a
//! small number of its own here, remembered with the sign-in.

use crate::social::{call, client, explain, photo_bytes, secret_delete, secret_get, secret_set, social_accounts, st, with_json, Accounts, SiteNote};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Mutex;

const API: &str = "https://api.tumblr.com/v2";
const REDIRECT: &str = "https://readingroomapp.com/connect/tumblr/";
const SCOPES: &str = "basic write offline_access";
const KEY: &str = "tumblr";
const IDS: &str = "tumblr.ids";
/// The tags that stand in for WordPress's Notes and Weeknotes categories, with the ids the interface uses for them
const TAGS: [(i64, &str, &str); 2] = [(1, "notes", "Notes"), (2, "weeknotes", "Weeknotes")];

fn app_key() -> Result<(&'static str, &'static str), String> {
    let k = option_env!("TUMBLR_KEY").unwrap_or("").trim();
    let s = option_env!("TUMBLR_SECRET").unwrap_or("").trim();
    if k.is_empty() || s.is_empty() {
        return Err("This version of the app can't connect to Tumblr yet.".into());
    }
    Ok((k, s))
}

/// Tumblr is where Writing posts: it's connected and no WordPress or Micropub site is (those stay home when both are).
pub fn is_home() -> bool {
    secret_get("wordpress").is_none() && secret_get("micropub").is_none() && secret_get(KEY).is_some()
}

/// The connected blog, for the accounts list: its name, title and address.
pub fn account() -> Option<Value> {
    let s = secret_get(KEY)?;
    Some(json!({ "blog": st(&s, "blog"), "handle": st(&s, "blog"), "name": st(&s, "title"), "site": st(&s, "url"), "blogs": s["blogs"].clone() }))
}

// ------------------------------------------------------------------ connecting

fn pending() -> &'static Mutex<Option<String>> {
    static P: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

/// Step one: the Tumblr page where you sign in and approve the app.
#[tauri::command]
pub async fn tumblr_begin() -> Result<String, String> {
    let (key, _) = app_key()?;
    let state = format!("rr{}", chrono::Utc::now().timestamp_millis());
    *pending().lock().await = Some(state.clone());
    let mut u = url::Url::parse("https://www.tumblr.com/oauth2/authorize").map_err(|e| e.to_string())?;
    u.query_pairs_mut()
        .append_pair("client_id", key)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("state", &state)
        .append_pair("redirect_uri", REDIRECT);
    Ok(u.to_string())
}

/// Step two: the code readingroomapp.com showed after you approved the app (the whole address works too).
#[tauri::command]
pub async fn tumblr_finish(code: String) -> Result<Accounts, String> {
    let (key, secret) = app_key()?;
    let code = code_from(&code);
    if code.is_empty() {
        return Err("Paste the code from the page that opened after you approved the app.".into());
    }
    let tok = call(client().post(format!("{API}/oauth2/token")).form(&[
        ("grant_type", "authorization_code"), ("code", code.as_str()), ("client_id", key), ("client_secret", secret), ("redirect_uri", REDIRECT),
    ]))
    .await
    .map_err(|e| if e.0 == 400 || e.0 == 401 { "That code didn't work. Codes work once and only for a few minutes: press Connect Tumblr again.".to_string() } else { explain(e) })?;
    let token = st(&tok, "access_token");
    if token.is_empty() {
        return Err("Tumblr didn't send a sign-in back. Try again.".into());
    }
    let info = call(client().get(format!("{API}/user/info")).bearer_auth(&token)).await.map_err(explain)?;
    let blogs: Vec<Value> = info["response"]["user"]["blogs"].as_array().cloned().unwrap_or_default().iter()
        .filter(|b| b["admin"].as_bool().unwrap_or(true))
        .map(|b| json!({ "blog": st(b, "name"), "title": st(b, "title"), "url": st(b, "url"), "primary": b["primary"].as_bool().unwrap_or(false) }))
        .collect();
    let first = blogs.iter().find(|b| b["primary"].as_bool().unwrap_or(false)).or(blogs.first()).cloned().ok_or("Your Tumblr account has no blog to post to.")?;
    secret_set(KEY, &json!({
        "token": token, "refresh": st(&tok, "refresh_token"), "expires": expires_at(&tok),
        "blog": st(&first, "blog"), "title": st(&first, "title"), "url": st(&first, "url"), "blogs": blogs,
    }))?;
    *pending().lock().await = None;
    Ok(social_accounts())
}

/// Post to another of your Tumblr blogs (when the account has more than one).
#[tauri::command]
pub fn tumblr_pick_blog(blog: String) -> Result<Accounts, String> {
    let mut s = secret_get(KEY).ok_or("Connect Tumblr first.")?;
    let b = s["blogs"].as_array().and_then(|a| a.iter().find(|b| st(b, "blog") == blog)).cloned().ok_or("That blog isn't on your Tumblr account.")?;
    s["blog"] = json!(st(&b, "blog"));
    s["title"] = json!(st(&b, "title"));
    s["url"] = json!(st(&b, "url"));
    secret_set(KEY, &s)?;
    Ok(social_accounts())
}

#[tauri::command]
pub fn tumblr_disconnect() -> Accounts {
    secret_delete(KEY);
    secret_delete(IDS);
    *ids().lock().unwrap_or_else(|e| e.into_inner()) = (None, false);
    social_accounts()
}

/// The code alone, from the code or the whole address it came in (…/connect/tumblr/?code=…&state=…).
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
    chrono::Utc::now().timestamp() + tok["expires_in"].as_i64().unwrap_or(2400)
}

/// A sign-in that's good for the next minute, renewed with the refresh token when it's about to run out.
async fn token(force: bool) -> Result<(String, String), String> {
    let mut s = secret_get(KEY).ok_or("Connect Tumblr first.")?;
    let fresh = s["expires"].as_i64().unwrap_or(0) > chrono::Utc::now().timestamp() + 60;
    if fresh && !force {
        return Ok((st(&s, "token"), st(&s, "blog")));
    }
    let refresh = st(&s, "refresh");
    if refresh.is_empty() {
        return Err("Your Tumblr sign-in ran out. Connect Tumblr again in Settings › Connections.".into());
    }
    let (key, secret) = app_key()?;
    let tok = call(client().post(format!("{API}/oauth2/token")).form(&[
        ("grant_type", "refresh_token"), ("refresh_token", refresh.as_str()), ("client_id", key), ("client_secret", secret),
    ]))
    .await
    .map_err(|e| if e.0 == 400 || e.0 == 401 { "Tumblr signed the app out. Connect Tumblr again in Settings › Connections.".to_string() } else { explain(e) })?;
    s["token"] = json!(st(&tok, "access_token"));
    let next = st(&tok, "refresh_token");
    if !next.is_empty() {
        s["refresh"] = json!(next);
    }
    s["expires"] = json!(expires_at(&tok));
    secret_set(KEY, &s)?;
    Ok((st(&s, "token"), st(&s, "blog")))
}

/// Call Tumblr's API for your blog ("{blog}" in the path is your blog's name). A refused sign-in is renewed once.
async fn api(method: reqwest::Method, path: &str, body: Option<&Value>) -> Result<Value, String> {
    for attempt in 0..2 {
        let (tok, blog) = token(attempt > 0).await?;
        let mut req = client().request(method.clone(), format!("{API}{}", path.replace("{blog}", &blog))).bearer_auth(&tok);
        if let Some(b) = body {
            req = with_json(req, b);
        }
        match call(req).await {
            Ok(v) => return Ok(v["response"].clone()),
            Err(e) if e.0 == 401 && attempt == 0 => continue,
            Err(e) => return Err(tumblr_fail(e)),
        }
    }
    Err("Tumblr didn't accept the sign-in.".into())
}

fn tumblr_fail(e: (u16, String)) -> String {
    let v: Value = serde_json::from_str(&e.1).unwrap_or(Value::Null);
    let said = v["errors"][0]["detail"].as_str().or(v["meta"]["msg"].as_str()).unwrap_or("").to_string();
    match e.0 {
        401 | 403 => "Tumblr didn't accept the sign-in. Connect Tumblr again in Settings › Connections.".into(),
        404 => "Tumblr couldn't find that post. It may have been deleted on Tumblr.".into(),
        429 => "Tumblr says to slow down. Try again in a few minutes.".into(),
        _ if !said.is_empty() && said != "Bad Request" => format!("Tumblr said: {said}"),
        _ => explain(e),
    }
}

// ------------------------------------------------------------------ post ids the interface can hold

/// The ids, kept in memory and saved to the Keychain once after a batch (flush), not once per post.
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

/// Save new ids, if any were made.
fn flush_ids() {
    let todo = with_ids(|m, dirty| std::mem::take(dirty).then(|| m.clone()));
    if let Some(m) = todo {
        let _ = secret_set(IDS, &m);
    }
}

/// The small number the interface uses for a Tumblr post id (made the first time it's seen).
fn local_id(tumblr_id: &str) -> i64 {
    if tumblr_id.is_empty() {
        return 0;
    }
    with_ids(|m, dirty| {
        if let Some(n) = m["ids"][tumblr_id].as_i64() {
            return n;
        }
        let n = m["next"].as_i64().unwrap_or(1000);
        m["next"] = json!(n + 1);
        m["ids"][tumblr_id] = json!(n);
        *dirty = true;
        // keep the newest 600, so the list stays small
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

fn tumblr_id(local: i64) -> Result<String, String> {
    with_ids(|m, _| m["ids"].as_object().and_then(|o| o.iter().find(|(_, v)| v.as_i64() == Some(local)).map(|(k, _)| k.clone())))
        .ok_or_else(|| "The app lost track of that Tumblr post. Open Writing again to reload your posts.".to_string())
}

// ------------------------------------------------------------------ your words as Tumblr blocks (NPF)

/// "[words](https://…)" and bare addresses become links; offsets count characters, as Tumblr's blocks do.
fn text_block(p: &str, subtype: Option<&str>) -> Value {
    static MD: OnceLock<regex::Regex> = OnceLock::new();
    let md = MD.get_or_init(|| regex::Regex::new(r#"\[([^\]\n]{1,80})\]\((https?://[^\s<>"()]+)\)|https?://[^\s<>"]+[^\s<>".,;:!?)\]]"#).unwrap());
    let mut text = String::new();
    let mut links = Vec::new();
    let mut last = 0;
    for c in md.captures_iter(p) {
        let m = c.get(0).unwrap();
        text.push_str(&p[last..m.start()]);
        let (words, url) = match (c.get(1), c.get(2)) { (Some(w), Some(u)) => (w.as_str(), u.as_str()), _ => (m.as_str(), m.as_str()) };
        let start = text.chars().count();
        text.push_str(words);
        links.push(json!({ "start": start, "end": start + words.chars().count(), "type": "link", "url": url }));
        last = m.end();
    }
    text.push_str(&p[last..]);
    let mut b = json!({ "type": "text", "text": text });
    if let Some(s) = subtype {
        b["subtype"] = json!(s);
    }
    if !links.is_empty() {
        b["formatting"] = json!(links);
    }
    b
}

/// A title (as a heading, since Tumblr text posts have none of their own), then the paragraphs: "## " headings,
/// "> " quotes, words with links, and a line that's only a web address as a link card.
fn blocks(title: &str, text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    if !title.trim().is_empty() {
        out.push(json!({ "type": "text", "subtype": "heading1", "text": title.trim() }));
    }
    for p in text.trim().split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        if let Some(h) = p.strip_prefix("## ").filter(|h| !h.contains('\n')) {
            out.push(text_block(h.trim(), Some("heading2")));
        } else if p.lines().all(|l| l.trim_start().starts_with('>')) {
            let q: Vec<&str> = p.lines().map(|l| l.trim_start().trim_start_matches('>').trim_start()).collect();
            out.push(text_block(&q.join("\n"), Some("quote")));
        } else if p.starts_with("http") && !p.contains(char::is_whitespace) {
            out.push(json!({ "type": "link", "url": p }));
        } else {
            out.push(text_block(p, None));
        }
    }
    out
}

/// Back from Tumblr's blocks to the way you write in the app: the first heading is the title.
fn words_of(content: &Value) -> (String, String, bool) {
    let mut title = String::new();
    let mut paras = Vec::new();
    let mut simple = true;
    for (i, b) in content.as_array().cloned().unwrap_or_default().iter().enumerate() {
        match st(b, "type").as_str() {
            "text" => {
                let mut t = st(b, "text");
                // links back to [words](address), from the end so the offsets stay right
                let mut f: Vec<Value> = b["formatting"].as_array().cloned().unwrap_or_default().into_iter().filter(|f| st(f, "type") == "link").collect();
                f.sort_by_key(|f| std::cmp::Reverse(f["start"].as_u64().unwrap_or(0)));
                for l in f {
                    let chars: Vec<char> = t.chars().collect();
                    let (s, e) = (l["start"].as_u64().unwrap_or(0) as usize, l["end"].as_u64().unwrap_or(0) as usize);
                    if s < e && e <= chars.len() {
                        let words: String = chars[s..e].iter().collect();
                        let url = st(&l, "url");
                        let rep = if words == url { url } else { format!("[{words}]({url})") };
                        t = format!("{}{}{}", chars[..s].iter().collect::<String>(), rep, chars[e..].iter().collect::<String>());
                    }
                }
                match st(b, "subtype").as_str() {
                    "heading1" if i == 0 && title.is_empty() => title = t,
                    "heading1" | "heading2" => paras.push(format!("## {t}")),
                    "quote" | "indented" => paras.push(t.lines().map(|l| format!("> {l}")).collect::<Vec<_>>().join("\n")),
                    _ => paras.push(t),
                }
            }
            "link" => paras.push(st(b, "url")),
            _ => simple = false, // photos, video, audio…: keep writing those on Tumblr
        }
    }
    (title, paras.join("\n\n"), simple)
}

/// A post as the Writing tab lists it, the same shape as a WordPress one.
fn item(p: &Value) -> Value {
    let (title, text, _) = words_of(&p["content"]);
    let excerpt: String = (if text.is_empty() { st(p, "summary") } else { text }).replace('\n', " ").chars().take(240).collect();
    let tags: Vec<String> = p["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_lowercase)).collect()).unwrap_or_default();
    let cats: Vec<i64> = TAGS.iter().filter(|(_, slug, _)| tags.iter().any(|t| t == slug)).map(|(id, _, _)| *id).collect();
    let image = p["content"].as_array().and_then(|a| a.iter().find(|b| st(b, "type") == "image"))
        .and_then(|b| b["media"].as_array().and_then(|m| m.first()).map(|m| st(m, "url"))).unwrap_or_default();
    let when = chrono::DateTime::from_timestamp(p["timestamp"].as_i64().unwrap_or(0), 0).unwrap_or_default().format("%Y-%m-%dT%H:%M:%S").to_string();
    let status = match st(p, "state").as_str() { "draft" => "draft", "queued" | "queue" => "future", "private" => "private", _ => "publish" };
    json!({
        "id": local_id(&st(p, "id_string")),
        "title": if title.is_empty() { st(p, "summary").lines().next().unwrap_or("").chars().take(120).collect::<String>() } else { title },
        "excerpt": excerpt.trim(),
        "date": when, "modified": when,
        "link": st(p, "post_url"),
        "status": status,
        "categories": cats,
        "image": image,
        "notes": p["note_count"].as_i64().unwrap_or(0),
    })
}

fn post_url(blog_url: &str, id: &str) -> String {
    format!("{}/post/{id}", blog_url.trim_end_matches('/'))
}

/// Make or change a post. A photo goes first, with its description, sent with the post.
async fn save(id: Option<&str>, content: Vec<Value>, tags: &[&str], photo: &str, alt: &str, draft: bool) -> Result<SiteNote, String> {
    let s = secret_get(KEY).ok_or("Connect Tumblr first.")?;
    let mut content = content;
    let bytes = if photo.is_empty() { None } else { Some(photo_bytes(photo)?) };
    if bytes.is_some() {
        let mut img = json!({ "type": "image", "media": [{ "type": "image/jpeg", "identifier": "photo" }] });
        if !alt.trim().is_empty() {
            img["alt_text"] = json!(alt.trim());
        }
        // after the title, before the words
        let at = usize::from(content.first().is_some_and(|b| st(b, "subtype") == "heading1"));
        content.insert(at, img);
    }
    let body = json!({ "content": content, "state": if draft { "draft" } else { "published" }, "tags": tags.join(",") });
    let path = match id { Some(i) => format!("/blog/{{blog}}/posts/{i}"), None => "/blog/{blog}/posts".into() };
    let method = if id.is_some() { reqwest::Method::PUT } else { reqwest::Method::POST };
    let r = match bytes {
        None => api(method, &path, Some(&body)).await?,
        Some(b) => {
            // with a photo the post goes as a form
            let mut out = Err(String::new());
            for attempt in 0..2 {
                let (tok, blog) = token(attempt > 0).await?;
                // built by hand (as for Mastodon's photos): the post itself, and the photo as the part it names
                let boundary = format!("rr{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
                let mut form = Vec::new();
                form.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"json\"\r\nContent-Type: application/json\r\n\r\n{body}\r\n").as_bytes());
                form.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").as_bytes());
                form.extend_from_slice(&b);
                form.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
                let req = client().request(method.clone(), format!("{API}{}", path.replace("{blog}", &blog))).bearer_auth(&tok)
                    .header("Content-Type", format!("multipart/form-data; boundary={boundary}")).body(form).timeout(Duration::from_secs(90));
                match call(req).await {
                    Ok(v) => { out = Ok(v["response"].clone()); break; }
                    Err(e) if e.0 == 401 && attempt == 0 => continue,
                    Err(e) => { out = Err(tumblr_fail(e)); break; }
                }
            }
            out?
        }
    };
    let tid = [st(&r, "id_string"), st(&r, "id")].into_iter().find(|x| !x.is_empty()).or_else(|| id.map(String::from)).unwrap_or_default();
    let id = local_id(&tid);
    flush_ids();
    Ok(SiteNote { url: if draft { String::new() } else { post_url(&st(&s, "url"), &tid) }, id, ..Default::default() })
}

// ------------------------------------------------------------------ Writing's commands, for Tumblr

/// site_note: a Note (tagged "notes"), Weeknotes (tagged "weeknotes"), a reply or a repost of a post you read.
pub async fn note(title: String, text: String, link: String, link_title: String, photo: String, alt: String, draft: bool, repost: bool, reply: bool, category: Option<String>) -> Result<SiteNote, String> {
    if title.trim().is_empty() && text.trim().is_empty() && link.trim().is_empty() && photo.is_empty() {
        return Err("Write something first.".into());
    }
    let mut content = blocks(&title, &text);
    if link.starts_with("http") {
        // the post you're answering or passing along, as a link card (with "In reply to" for a reply)
        if reply {
            content.insert(0, text_block(&format!("In reply to [{}]({link})", if link_title.trim().is_empty() { "this post" } else { link_title.trim() }), None));
        } else {
            content.push(json!({ "type": "link", "url": link, "title": link_title.trim() }));
        }
    }
    let tag = match category.as_deref() { Some("weeknotes") => "weeknotes", _ if repost || reply => "", _ => "notes" };
    let tags: Vec<&str> = [tag].into_iter().filter(|t| !t.is_empty()).collect();
    let mut out = save(None, content, &tags, &photo, &alt, draft).await?;
    if !draft && (repost || reply) && link.starts_with("http") && out.url.starts_with("http") {
        match crate::webmention::send(client(), &out.url, &link).await {
            Ok(t) => out.told = Some(t),
            Err(e) => { out.told = Some(false); out.told_error = e; }
        }
    }
    Ok(out)
}

/// site_categories: Notes and Weeknotes, which are tags on Tumblr.
pub fn categories() -> Value {
    json!(TAGS.iter().map(|(id, slug, name)| json!({ "id": id, "name": name, "slug": slug, "count": 0 })).collect::<Vec<_>>())
}

/// site_posts: published posts (or only those tagged notes/weeknotes), drafts, or the queue.
pub async fn posts(status: Option<String>, categories: Option<Vec<i64>>, exclude: Option<Vec<i64>>, per_page: Option<u32>, after: Option<String>, page: Option<u32>) -> Result<Value, String> {
    let n = per_page.unwrap_or(30).clamp(1, 50);
    let offset = (page.unwrap_or(1).max(1) - 1) * n;
    let path = match status.as_deref() {
        Some("draft") => "/blog/{blog}/posts/draft?npf=true".to_string(),
        Some("future") => format!("/blog/{{blog}}/posts/queue?npf=true&limit={n}&offset={offset}"),
        _ => {
            let mut p = format!("/blog/{{blog}}/posts?npf=true&limit={n}&offset={offset}");
            if let Some(tag) = categories.as_ref().and_then(|c| c.first()).and_then(|c| TAGS.iter().find(|t| t.0 == *c)) {
                p.push_str(&format!("&tag={}", tag.1));
            }
            p
        }
    };
    let r = api(reqwest::Method::GET, &path, None).await?;
    let mut list: Vec<Value> = r["posts"].as_array().cloned().unwrap_or_default().iter().map(item).collect();
    if let Some(ex) = exclude.filter(|e| !e.is_empty()) {
        list.retain(|p| !p["categories"].as_array().is_some_and(|c| c.iter().any(|x| ex.contains(&x.as_i64().unwrap_or(0)))));
    }
    if let Some(a) = after.filter(|a| !a.trim().is_empty()) {
        list.retain(|p| st(p, "date").as_str() > a.trim());
    }
    if status.as_deref() == Some("draft") {
        // drafts come all at once from Tumblr (newest first); the app asks for them a page at a time
        list = list.into_iter().skip(offset as usize).take(n as usize).collect();
    }
    flush_ids();
    Ok(json!(list))
}

/// site_post_get: a post's words to keep writing in the app. Photos and videos make it `simple: false`.
pub async fn post_get(id: i64) -> Result<Value, String> {
    let s = secret_get(KEY).ok_or("Connect Tumblr first.")?;
    let tid = tumblr_id(id)?;
    let p = api(reqwest::Method::GET, &format!("/blog/{{blog}}/posts/{tid}?post_format=npf"), None).await?;
    let p = if p["content"].is_array() { p } else { p["post"].clone() };
    let (title, text, simple) = words_of(&p["content"]);
    let mut it = item(&p);
    it["title"] = json!(title);
    it["text"] = json!(text);
    it["simple"] = json!(simple);
    it["edit"] = json!(format!("https://www.tumblr.com/edit/{}/{tid}", st(&s, "blog")));
    Ok(it)
}

/// site_post_view: a post as it will look (the app's own preview of the words).
pub async fn post_view(id: i64) -> Result<Value, String> {
    let mut it = post_get(id).await?;
    let text = st(&it, "text");
    it["html"] = json!(crate::social::preview_for(&text));
    Ok(it)
}

/// site_post: a full post. Notes and Weeknotes made from a draft keep their tag.
pub async fn post(id: Option<i64>, title: String, text: String, photo: String, alt: String, draft: bool, kind: Option<String>) -> Result<SiteNote, String> {
    if title.trim().is_empty() && text.trim().is_empty() {
        return Err("Write something first.".into());
    }
    let tid = match id.filter(|i| *i > 0) { Some(i) => Some(tumblr_id(i)?), None => None };
    let tags: Vec<&str> = match kind.as_deref() { Some("note") => vec!["notes"], Some("weeknotes") => vec!["weeknotes"], _ => vec![] };
    save(tid.as_deref(), blocks(&title, &text), &tags, &photo, &alt, draft).await
}

/// site_post_publish: a draft on Tumblr goes up as it is.
pub async fn publish(id: i64) -> Result<SiteNote, String> {
    let s = secret_get(KEY).ok_or("Connect Tumblr first.")?;
    let tid = tumblr_id(id)?;
    let p = api(reqwest::Method::GET, &format!("/blog/{{blog}}/posts/{tid}?post_format=npf"), None).await?;
    let p = if p["content"].is_array() { p } else { p["post"].clone() };
    let mut body = json!({ "content": p["content"], "tags": p["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str()).collect::<Vec<_>>().join(",")).unwrap_or_default(), "state": "published" });
    if p["layout"].is_array() {
        body["layout"] = p["layout"].clone();
    }
    api(reqwest::Method::PUT, &format!("/blog/{{blog}}/posts/{tid}"), Some(&body)).await?;
    Ok(SiteNote { url: post_url(&st(&s, "url"), &tid), id, ..Default::default() })
}

/// site_post_trash: Tumblr has no trash, so a deleted draft is gone for good (the app asks first and says so).
pub async fn delete(id: i64) -> Result<(), String> {
    let tid = tumblr_id(id)?;
    match api(reqwest::Method::POST, "/blog/{blog}/post/delete", Some(&json!({ "id": tid }))).await {
        Ok(_) => Ok(()),
        Err(e) if e.contains("couldn't find") => Ok(()),
        Err(e) => Err(e),
    }
}

/// Your blog's picture.
pub async fn avatar() -> String {
    secret_get(KEY).map(|s| format!("{API}/blog/{}/avatar/128", st(&s, "blog"))).unwrap_or_default()
}

/// Your Tumblr, in Writing: followers and the notes (likes and reblogs) on your recent posts.
/// Tumblr doesn't give apps visits or search numbers; the panel says so.
pub async fn stats() -> Result<Value, String> {
    let s = secret_get(KEY).ok_or("Connect Tumblr first.")?;
    let info = api(reqwest::Method::GET, "/blog/{blog}/info", None).await?;
    let followers = api(reqwest::Method::GET, "/blog/{blog}/followers?limit=1", None).await.ok().and_then(|f| f["total_users"].as_i64());
    let r = api(reqwest::Method::GET, "/blog/{blog}/posts?npf=true&limit=20&notes_info=false", None).await?;
    let posts: Vec<Value> = r["posts"].as_array().cloned().unwrap_or_default().iter().map(item).collect();
    flush_ids();
    let total: i64 = posts.iter().map(|p| p["notes"].as_i64().unwrap_or(0)).sum();
    let mut top = posts.clone();
    top.sort_by_key(|p| std::cmp::Reverse(p["notes"].as_i64().unwrap_or(0)));
    top.retain(|p| p["notes"].as_i64().unwrap_or(0) > 0);
    top.truncate(5);
    Ok(json!({
        "kind": "tumblr",
        "site": st(&s, "blog"),
        "name": st(&info, "blog.title"),
        "url": st(&s, "url"),
        "followers": followers.or(info["blog"]["followers"].as_i64()),
        "posts": info["blog"]["posts"].as_i64().unwrap_or(0),
        "recentNotes": total,
        "recentCount": posts.len(),
        "top": top.iter().map(|p| json!({ "title": if st(p, "title").is_empty() { st(p, "excerpt") } else { st(p, "title") }, "link": st(p, "link"), "notes": p["notes"], "date": st(p, "date") })).collect::<Vec<_>>(),
    }))
}

/// A copy on Tumblr of a note you posted at home (the "Tumblr" choice beside Bluesky and Mastodon): your words,
/// the photo if there is one, and the link home as a card.
pub async fn share(text: &str, link: &str, title: &str, photo: &str, alt: &str) -> Result<String, String> {
    let mut content = blocks("", text);
    if link.starts_with("http") {
        content.push(json!({ "type": "link", "url": link, "title": title.trim() }));
    }
    let s = secret_get(KEY).ok_or("Connect Tumblr first.")?;
    let saved = save(None, content, &[], photo, alt, false).await?;
    Ok(if saved.url.is_empty() { st(&s, "url") } else { saved.url })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_go_to_blocks_and_back() {
        let text = "Hello [Ben](https://ben.example/) and https://a.example/x.\n\n## Part two\n\n> quoted\n> lines\n\nhttps://card.example/post";
        let b = blocks("My title", text);
        assert_eq!(st(&b[0], "subtype"), "heading1");
        assert_eq!(st(&b[1], "text"), "Hello Ben and https://a.example/x.");
        assert_eq!(b[1]["formatting"][0]["start"], 6);
        assert_eq!(b[1]["formatting"][0]["end"], 9);
        assert_eq!(st(&b[2], "subtype"), "heading2");
        assert_eq!(st(&b[3], "subtype"), "quote");
        assert_eq!(st(&b[4], "type"), "link");
        let (t, w, simple) = words_of(&json!(b));
        assert_eq!(t, "My title");
        assert_eq!(w, text);
        assert!(simple);
    }

    #[test]
    fn code_from_address() {
        assert_eq!(code_from("https://readingroomapp.com/connect/tumblr/?code=abc123&state=rr1"), "abc123");
        assert_eq!(code_from("  abc123 "), "abc123");
    }
}
