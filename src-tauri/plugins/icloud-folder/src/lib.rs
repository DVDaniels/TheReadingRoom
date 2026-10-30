//! A small native helper for iPhone and iPad (Swift in `ios/`), used for syncing through iCloud Drive.
//!
//! - `pick`: Apple's Files picker for a folder; returns its path and a bookmark that keeps access to it
//! - `open`: reopen a folder from its bookmark after the app restarts
//! - `download`: ask iCloud for the newest copy of the files in a folder and wait briefly for them
//! - `device_name`: what to call this iPhone or iPad in the sync panel
//!
//! On other platforms the calls return an error; the Mac version has its own way of doing these things.
//! Calls block until the Swift side answers, so make them from a background thread or an async command.

use serde::Deserialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_icloud_folder);

pub struct Folder<R: Runtime> {
    #[cfg(target_os = "ios")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "ios"))]
    _r: std::marker::PhantomData<fn() -> R>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Picked {
    path: Option<String>,
    bookmark: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Opened {
    path: String,
    bookmark: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Name {
    name: String,
}

#[derive(serde::Serialize)]
struct BookmarkArgs<'a> {
    bookmark: &'a str,
}

#[derive(serde::Serialize)]
struct PathArgs<'a> {
    path: &'a str,
}

#[allow(dead_code)]
const ONLY_IOS: &str = "This only works on iPhone and iPad.";

impl<R: Runtime> Folder<R> {
    /// Show the folder picker. `Ok(None)` if you cancel; otherwise (path, bookmark as base64).
    pub fn pick(&self) -> Result<Option<(String, String)>, String> {
        #[cfg(target_os = "ios")]
        {
            let p: Picked = self.handle.run_mobile_plugin("pickFolder", ()).map_err(|e| e.to_string())?;
            return Ok(match (p.path, p.bookmark) {
                (Some(path), Some(b)) => Some((path, b)),
                _ => None,
            });
        }
        #[cfg(not(target_os = "ios"))]
        Err(ONLY_IOS.into())
    }

    /// Reopen a folder you picked before. Returns its path and the bookmark to keep (renewed if needed).
    pub fn open(&self, bookmark: &str) -> Result<(String, String), String> {
        #[cfg(target_os = "ios")]
        {
            let o: Opened = self.handle.run_mobile_plugin("openBookmark", BookmarkArgs { bookmark }).map_err(|e| e.to_string())?;
            return Ok((o.path, o.bookmark));
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = BookmarkArgs { bookmark };
            Err(ONLY_IOS.into())
        }
    }

    /// Make iCloud bring down the folder's files (waits up to about 20 seconds).
    pub fn download(&self, path: &str) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            let _: serde::de::IgnoredAny = self.handle.run_mobile_plugin("download", PathArgs { path }).map_err(|e| e.to_string())?;
            return Ok(());
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = PathArgs { path };
            Err(ONLY_IOS.into())
        }
    }

    pub fn device_name(&self) -> Option<String> {
        #[cfg(target_os = "ios")]
        {
            return self.handle.run_mobile_plugin::<Name>("deviceName", ()).ok().map(|n| n.name).filter(|n| !n.is_empty());
        }
        #[cfg(not(target_os = "ios"))]
        None
    }
}

/// Where reading aloud stands: idle, playing, paused or done; `position` of `length` characters.
#[derive(serde::Serialize, Deserialize, Default, Clone)]
pub struct SpeechState {
    pub state: String,
    pub position: i64,
    pub length: i64,
    pub rate: f32,
}

#[derive(serde::Serialize)]
struct SpeakArgs<'a> {
    text: &'a str,
    title: &'a str,
    source: &'a str,
    rate: f32,
    offset: i64,
}

#[derive(serde::Serialize)]
struct ControlArgs<'a> {
    action: &'a str,
    value: Option<f32>,
}

impl<R: Runtime> Folder<R> {
    /// Read `text` aloud from character `offset`, with the system voice (keeps going with the screen locked).
    pub fn speak(&self, text: &str, title: &str, source: &str, rate: f32, offset: i64) -> Result<SpeechState, String> {
        #[cfg(target_os = "ios")]
        {
            return self.handle.run_mobile_plugin("speak", SpeakArgs { text, title, source, rate, offset }).map_err(|e| e.to_string());
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = SpeakArgs { text, title, source, rate, offset };
            Err(ONLY_IOS.into())
        }
    }

    /// pause, resume, stop, skip (value = seconds, negative to go back) or rate (value = speed).
    pub fn speech_control(&self, action: &str, value: Option<f32>) -> Result<SpeechState, String> {
        #[cfg(target_os = "ios")]
        {
            return self.handle.run_mobile_plugin("speechControl", ControlArgs { action, value }).map_err(|e| e.to_string());
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = ControlArgs { action, value };
            Err(ONLY_IOS.into())
        }
    }

    pub fn speech_status(&self) -> Result<SpeechState, String> {
        #[cfg(target_os = "ios")]
        {
            return self.handle.run_mobile_plugin("speechStatus", ()).map_err(|e| e.to_string());
        }
        #[cfg(not(target_os = "ios"))]
        Err(ONLY_IOS.into())
    }
}

pub trait FolderExt<R: Runtime> {
    fn icloud_folder(&self) -> &Folder<R>;
}

impl<R: Runtime, T: Manager<R>> FolderExt<R> for T {
    fn icloud_folder(&self) -> &Folder<R> {
        self.state::<Folder<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("icloud-folder")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let folder = Folder { handle: api.register_ios_plugin(init_plugin_icloud_folder)? };
            #[cfg(not(target_os = "ios"))]
            let folder = {
                let _ = api;
                Folder::<R> { _r: std::marker::PhantomData }
            };
            app.manage(folder);
            Ok(())
        })
        .build()
}
