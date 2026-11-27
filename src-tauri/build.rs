// The keys the app is built with (Flickr, Tumblr, YouTube, Marginalia) reach the Rust code as option_env!. On the
// Mac they come from the workflow's environment. On iPhone and iPad the Rust code is compiled inside Xcode's build
// step, which doesn't pass that environment through, so those builds came out without any keys ("This version of
// the app can't connect to Flickr yet", David, Nov 27). The workflows therefore also write them to
// src-tauri/build-keys.env (never committed: .gitignore), and this hands them to the compiler either way.
const KEYS: [&str; 7] = ["MARGINALIA_KEY", "TUMBLR_KEY", "TUMBLR_SECRET", "FLICKR_KEY", "FLICKR_SECRET", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"];

fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let file = std::path::Path::new(&dir).join("build-keys.env");
    println!("cargo:rerun-if-changed={}", file.display());
    let from_file = std::fs::read_to_string(&file).unwrap_or_default();
    for k in KEYS {
        println!("cargo:rerun-if-env-changed={k}");
        let v = std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).or_else(|| {
            from_file.lines().find_map(|l| l.strip_prefix(k).and_then(|r| r.strip_prefix('='))).map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
        });
        if let Some(v) = v {
            println!("cargo:rustc-env={k}={v}");
        }
    }
    tauri_build::build()
}
