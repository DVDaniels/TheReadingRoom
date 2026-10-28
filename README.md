# The Reading Room

A private RSS reader for the Mac. No accounts and no servers: it checks the feeds you follow
and keeps everything on your computer.

## Install

1. Open the **Releases** page (right side of the repo) and download the `.dmg` from the newest version.
   In-between builds are on the **Actions** tab, under *Artifacts* on each green run.
2. Open the `.dmg` and drag **The Reading Room** into **Applications** (choose **Replace** when updating;
   your feeds, folders and read marks are kept).
3. The first time only: macOS says it can't verify the app, because it isn't signed with an Apple
   Developer ID yet. Open **System Settings › Privacy & Security**, scroll down, and click **Open Anyway**.

## Using it

- Checks your feeds when it opens and every 30 minutes while it's running. Closing the window keeps it
  running in the Dock; the Dock icon shows your unread count. Quit with ⌘Q.
- **Today**, **Read later** and **Recently read** sit at the top of the sidebar; **All** and your folders below.
- **Folders:** make one with the folder button beside *Feeds* (⇧⌘N), then drag feeds onto it or pick a folder
  from a feed's folder menu. Click the arrow to collapse a folder; click its name to read everything in it.
- **Add a feed** (⌘N): paste the feed address, or just the website and it finds the feed.
- **Keyboard:** `j` / `k` next and previous, `o` open in your browser, `s` save, `m` read/unread, ⌘R refresh.
- **Feeds menu › Import OPML** brings subscriptions over from Feedly, folders included (Feedly: Settings › OPML Export).
- Stories you had in the earlier Python version are carried over automatically the first time it opens.

Your data lives in `~/Library/Application Support/com.daviddaniels.readingroom/reader.db`.

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The window itself: `index.html`, `styles.css`, `app.js`, bundled fonts. Edit these to change the look. |
| `src-tauri/src/feeds.rs` | Fetching and reading RSS, Atom and JSON Feed; finding a site's feed |
| `src-tauri/src/db.rs` | Storage (SQLite) |
| `src-tauri/src/opml.rs` | OPML import and export |
| `src-tauri/src/lib.rs` | App wiring: window, menus, Dock badge, background refresh, commands the page calls |
| `src-tauri/tauri.conf.json` | App name, version, window size, icon |
| `.github/workflows/build.yml` | Builds the Mac app on every push |

## Building on your own Mac (optional)

Needs Xcode command line tools (`xcode-select --install`), [Rust](https://rustup.rs) and Node 18+.

```sh
npm install
npx tauri dev      # run it with live reload while you edit src/
npx tauri build    # make the .app and .dmg in src-tauri/target/release/bundle/
```

## Releasing a new version

Bump `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then push a tag:
`git tag v0.2.0 && git push --tags`. The workflow publishes the `.dmg` as a Release.
