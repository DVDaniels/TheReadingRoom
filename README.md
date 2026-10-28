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
- **Reading:** click a story to read it in the app, in clean type. **View original** (`o`) opens the real page in the
  app's web window; links inside articles open there too. In the web window, ⌘[ and ⌘] go back and forward and
  ⇧⌘O opens the page in your regular browser.
- **Highlights and notes:** select text in an article, then choose **Highlight** or **Add note**. Click a highlight to
  edit its note or remove it. **Annotated** in the sidebar collects every story you've marked up.
- **Share:** the Share button posts to X or LinkedIn (sign in once in the share window), copies the link, or emails it.
- **Add a feed** (⌘N): paste the feed address, or just the website and it finds the feed. Type words instead,
  like `walgreens pharmacy`, to follow that search on Google News.
- **Keyboard:** `j` / `k` next and previous, `Enter` read, `Esc` back, `o` view original, `s` read later,
  `m` read/unread, ⌘R refresh.
- **Feeds menu › Import OPML** brings subscriptions over from Feedly, folders included (Feedly: Settings › OPML Export).
- Stories you had in the earlier Python version are carried over automatically the first time it opens.

Your data lives in `~/Library/Application Support/com.daviddaniels.readingroom/reader.db`.

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The window itself: `index.html`, `styles.css`, `app.js`, and the bundled Geist fonts. Edit these to change the look. |
| `src-tauri/src/feeds.rs` | Fetching and reading RSS, Atom and JSON Feed; finding a site's feed |
| `src-tauri/src/db.rs` | Storage (SQLite) |
| `src-tauri/src/opml.rs` | OPML import and export |
| `src-tauri/src/article.rs` | The reader: pulls the article out of a web page and cleans it |
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

Bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`, then push to `main`.
The workflow publishes the `.dmg` as the Release for that version; pushes without a version bump
refresh that same release's installer.
