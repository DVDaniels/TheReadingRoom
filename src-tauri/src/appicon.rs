//! The app's icon: green (the usual one) or Midnight (black, to go with the Midnight theme; David, Nov 28).
//!
//! iPhone/iPad: an alternate icon (AppIcon-Midnight in the asset catalog, added by ios.yml). iOS keeps the choice
//! and shows its own "You have changed the icon" note each time it changes, so nothing happens if it's already set.
//! Mac: the Dock icon while the app is open (the page asks again at every start). The icon in Finder and
//! Launchpad stays green: a Mac App Store app can't change its own bundle.

use tauri::AppHandle;

#[tauri::command]
pub fn app_icon_set(app: AppHandle, name: String) -> Result<(), String> {
    let midnight = name == "midnight";
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        app.run_on_main_thread(move || apple::set(midnight)).map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = (app, midnight);
    Ok(())
}

#[cfg(target_os = "macos")]
mod apple {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSData;

    static MIDNIGHT: &[u8] = include_bytes!("../icons/mac-midnight.png");

    pub fn set(midnight: bool) {
        let (Some(app_cls), Some(img_cls)) = (AnyClass::get(c"NSApplication"), AnyClass::get(c"NSImage")) else { return };
        unsafe {
            let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
            if app.is_null() { return; }
            let img: *mut AnyObject = if midnight {
                let data = NSData::with_bytes(MIDNIGHT);
                let a: *mut AnyObject = msg_send![img_cls, alloc];
                msg_send![a, initWithData: &*data]
            } else {
                std::ptr::null_mut() // nil puts the app's own (green) icon back
            };
            let _: () = msg_send![app, setApplicationIconImage: img];
        }
    }
}

#[cfg(target_os = "ios")]
mod apple {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    const ALT: &str = "AppIcon-Midnight";

    pub fn set(midnight: bool) {
        let Some(app_cls) = AnyClass::get(c"UIApplication") else { return };
        unsafe {
            let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
            if app.is_null() { return; }
            let ok: bool = msg_send![app, supportsAlternateIcons];
            if !ok { return; }
            let cur: *mut NSString = msg_send![app, alternateIconName];
            let cur = if cur.is_null() { None } else { Some((*cur).to_string()) };
            let want = if midnight { Some(ALT) } else { None };
            if cur.as_deref() == want { return; }
            let name = want.map(NSString::from_str);
            let name_ptr: *const NSString = name.as_deref().map_or(std::ptr::null(), |n| n as *const NSString);
            let done: Option<&block2::Block<dyn Fn(*mut AnyObject)>> = None;
            let _: () = msg_send![app, setAlternateIconName: name_ptr, completionHandler: done];
        }
    }
}
