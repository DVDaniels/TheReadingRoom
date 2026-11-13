//! Apple's own "Enjoying The Reading Room?" rating prompt (SKStoreReviewController).
//! The page decides when it's a good moment to ask; Apple decides whether the prompt actually shows
//! (at most three times a year, and never in TestFlight builds). Nothing happens on other systems.

use tauri::AppHandle;

#[tauri::command]
pub fn request_review(app: AppHandle) {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let _ = app.run_on_main_thread(apple::ask);
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = app;
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    /// StoreKit is loaded by hand so the app doesn't need it linked at build time; if it can't be found,
    /// asking simply does nothing.
    fn store_kit() -> Option<&'static AnyClass> {
        if AnyClass::get(c"SKStoreReviewController").is_none() {
            unsafe {
                libc::dlopen(c"/System/Library/Frameworks/StoreKit.framework/StoreKit".as_ptr(), libc::RTLD_LAZY);
            }
        }
        AnyClass::get(c"SKStoreReviewController")
    }

    #[cfg(target_os = "macos")]
    pub fn ask() {
        if let Some(cls) = store_kit() {
            unsafe {
                let _: () = msg_send![cls, requestReview];
            }
        }
    }

    /// iPhone and iPad: the prompt goes in the window scene that's in front.
    #[cfg(target_os = "ios")]
    pub fn ask() {
        let (Some(cls), Some(app_cls), Some(scene_cls)) =
            (store_kit(), AnyClass::get(c"UIApplication"), AnyClass::get(c"UIWindowScene"))
        else {
            return;
        };
        unsafe {
            let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
            if app.is_null() {
                return;
            }
            let scenes: *mut AnyObject = msg_send![app, connectedScenes];
            if scenes.is_null() {
                return;
            }
            let all: *mut AnyObject = msg_send![scenes, allObjects];
            let n: usize = msg_send![all, count];
            let mut fallback: *mut AnyObject = std::ptr::null_mut();
            for i in 0..n {
                let s: *mut AnyObject = msg_send![all, objectAtIndex: i];
                let is_window_scene: bool = msg_send![s, isKindOfClass: scene_cls];
                if !is_window_scene {
                    continue;
                }
                // UISceneActivationStateForegroundActive = 0
                let state: isize = msg_send![s, activationState];
                if state == 0 {
                    let _: () = msg_send![cls, requestReviewInScene: s];
                    return;
                }
                if fallback.is_null() {
                    fallback = s;
                }
            }
            if !fallback.is_null() {
                let _: () = msg_send![cls, requestReviewInScene: fallback];
            }
        }
    }
}
