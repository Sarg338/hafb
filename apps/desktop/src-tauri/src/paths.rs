//! Where the app keeps its own files (recent list, backups, window state, title bar mode).
//!
//! `HAFB_DATA_DIR`, when set and non-empty, replaces the app's local data folder for everything,
//! including the WebView2 profile (UI preferences in localStorage). The smoke suite uses it so a
//! test run never reads or writes the user's real settings.

use std::ffi::OsString;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

pub const DATA_DIR_ENV: &str = "HAFB_DATA_DIR";

/// The override folder from the environment value, if it names one.
pub fn override_dir(value: Option<OsString>) -> Option<PathBuf> {
    value.filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The app's data folder: `HAFB_DATA_DIR`, else the OS local data folder for this app.
pub fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    override_dir(std::env::var_os(DATA_DIR_ENV)).or_else(|| app.path().app_local_data_dir().ok())
}

/// With an override, keep the WebView2 profile there too. Call before any webview exists.
pub fn redirect_webview_profile() {
    let Some(dir) = override_dir(std::env::var_os(DATA_DIR_ENV)) else {
        return;
    };
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return;
    }
    // SAFETY: called at the top of `run()`, before Tauri starts any thread, so nothing else can be
    // reading or writing the environment concurrently.
    unsafe { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("EBWebView")) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_or_empty_means_no_override() {
        assert_eq!(override_dir(None), None);
        assert_eq!(override_dir(Some(OsString::new())), None);
    }

    #[test]
    fn a_value_is_used_as_the_folder() {
        assert_eq!(override_dir(Some(OsString::from(r"C:\tmp\hafb-smoke"))), Some(PathBuf::from(r"C:\tmp\hafb-smoke")));
    }
}
