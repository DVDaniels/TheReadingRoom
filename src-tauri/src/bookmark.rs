//! Remembering a folder you picked.
//!
//! The App Store version runs in Apple's App Sandbox, which only lets the app use a folder you
//! chose in an Open dialog. A "security-scoped bookmark" is macOS's way of keeping that permission
//! between launches. The regular (GitHub) version doesn't need one, but it doesn't hurt either.

use std::path::PathBuf;

/// True inside Apple's App Sandbox (the App Store version).
pub fn sandboxed() -> bool {
    std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some()
}

/// Your real home folder. In the sandbox, $HOME points inside the app's private container instead.
pub fn real_home() -> Option<PathBuf> {
    #[cfg(unix)]
    unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if !pw.is_null() && !(*pw).pw_dir.is_null() {
            let dir = std::ffi::CStr::from_ptr((*pw).pw_dir).to_string_lossy().into_owned();
            if !dir.is_empty() {
                return Some(PathBuf::from(dir));
            }
        }
    }
    std::env::var_os("HOME").map(PathBuf::from)
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::Bool;
    use objc2_foundation::{NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL};
    use std::path::{Path, PathBuf};

    pub fn create(path: &Path) -> Result<Vec<u8>, String> {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map(|d| d.to_vec())
        .map_err(|e| e.localizedDescription().to_string())
    }

    /// Reopen a remembered folder and start using it. Returns its path and whether the
    /// bookmark should be made again (macOS says "stale" when a folder moved, for example).
    pub fn open(data: &[u8]) -> Result<(PathBuf, bool), String> {
        let d = NSData::with_bytes(data);
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &d,
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                &mut stale,
            )
        }
        .map_err(|e| e.localizedDescription().to_string())?;
        // Access lasts until the app quits (we never call stopAccessing...).
        let _ = unsafe { url.startAccessingSecurityScopedResource() };
        let path = url.path().map(|p| PathBuf::from(p.to_string())).ok_or("The remembered folder has no path.")?;
        Ok((path, stale.as_bool()))
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    use std::path::{Path, PathBuf};
    pub fn create(_path: &Path) -> Result<Vec<u8>, String> {
        Ok(Vec::new())
    }
    pub fn open(_data: &[u8]) -> Result<(PathBuf, bool), String> {
        Err("Folder bookmarks are only used on a Mac.".into())
    }
}

pub use mac::{create, open};

#[cfg(test)]
mod tests {
    #[test]
    fn hex_round_trip() {
        let b = vec![0u8, 1, 127, 128, 255];
        assert_eq!(super::from_hex(&super::to_hex(&b)).unwrap(), b);
        assert!(super::from_hex("abc").is_none());
    }
}
