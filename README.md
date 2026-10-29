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
- **Sync between Macs:** **Feeds › Sync Between Macs…** (⌘,) on each Mac, then **Sync with iCloud Drive**. Feeds,
  folders, read and Read later marks, highlights and notes stay the same everywhere; each Mac downloads stories itself.
  Every Mac writes its own small file in *iCloud Drive › The Reading Room* and reads the others', so they never clash;
  when the same thing changes on two Macs, the later change wins.
- **Layout:** on a wide window (1280 px and up, like a full-screen iMac) stories and the article sit side by side;
  narrower windows show the list, and the article opens full width.
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
| `src-tauri/src/sync.rs` | Sync between Macs through a shared folder |
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

## Publishing (Mac App Store and signed downloads)

The App Store listing, privacy policy and support page text are in [`appstore/`](appstore/).
Both workflows need an [Apple Developer Program](https://developer.apple.com/programs/) membership (Individual,
so the store lists **David Daniels** as the developer). Add these under **Settings › Secrets and variables › Actions**:

| Secret | What it is |
| --- | --- |
| `APPLE_TEAM_ID` | Your 10-character Team ID (developer.apple.com › Account › Membership) |
| `APPLE_CERT_PASSWORD` | The password you choose when exporting certificates as .p12 |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` | An App Store Connect API key (Users and Access › Integrations); `_P8` is the key file's text |
| `APPLE_DEVELOPER_ID_CERT`, `APPLE_DEVELOPER_ID_IDENTITY` | *Signed downloads:* "Developer ID Application" certificate as base64 .p12, and its full name |
| `APPLE_APPSTORE_CERTS` | *App Store:* "Apple Distribution" and "Mac Installer Distribution" certificates in one base64 .p12 |
| `APPLE_INSTALLER_CERT` | *App Store, optional:* the "Mac Installer Distribution" certificate on its own as base64 .p12, if it isn't in `APPLE_APPSTORE_CERTS` |
| `APPLE_APPSTORE_IDENTITY`, `APPLE_INSTALLER_IDENTITY` | *App Store:* the full names of those two certificates |
| `APPLE_PROVISION_PROFILE` | *App Store:* a "Mac App Store Connect" provisioning profile for `com.daviddaniels.readingroom`, base64 |

- **Signed downloads:** once the Developer ID secrets exist, every build on `main` signs and notarizes the `.dmg`,
  so it opens without the "Open Anyway" step.
- **App Store:** bump the version, then **Actions › Send to the Mac App Store › Run workflow**. The build appears in
  App Store Connect under TestFlight; from there, add it to a version and submit for review.

The App Store build runs inside Apple's App Sandbox (`src-tauri/Entitlements.appstore.plist`): network access, and
files you pick in Open/Save dialogs. It can't read the old Python version's folder, which only matters for people
who never opened the regular version.
