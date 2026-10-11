//! Where the app keeps its own files: recent list, backups, settings, window state, title bar mode
//! and the WebView2 profile (UI preferences in localStorage).
//!
//! - `HAFB_DATA_DIR`, when set and non-empty, replaces the app's local data folder for everything.
//!   The smoke suite uses it so a test run never reads or writes the user's real settings.
//! - **Portable mode** (S8.4): a folder named `HAFB Data` beside the exe does the same, so HAFB can
//!   run from a USB stick or a synced folder and leave nothing in the PC's AppData. The portable
//!   download ships with that folder; deleting it makes the exe use AppData like the installed app.
//! - Otherwise the OS local data folder for this app (`%LOCALAPPDATA%\app.hafb.desktop`), which
//!   uninstalling leaves in place.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

pub const DATA_DIR_ENV: &str = "HAFB_DATA_DIR";
pub const PORTABLE_DIR: &str = "HAFB Data";

/// The override folder from the environment value, if it names one.
pub fn override_dir(value: Option<OsString>) -> Option<PathBuf> {
    value.filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The portable data folder beside the exe, if there is one.
pub fn portable_dir(exe_dir: &Path) -> Option<PathBuf> {
    let dir = exe_dir.join(PORTABLE_DIR);
    dir.is_dir().then_some(dir)
}

/// `HAFB_DATA_DIR`, else the portable folder. Decided once, at the first call, so the app never
/// splits its files between two places.
fn fixed_dir() -> Option<&'static PathBuf> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        override_dir(std::env::var_os(DATA_DIR_ENV)).or_else(|| {
            let exe = std::env::current_exe().ok()?;
            portable_dir(exe.parent()?)
        })
    })
    .as_ref()
}

/// The app's data folder: `HAFB_DATA_DIR`, else the portable folder, else the OS local data folder.
pub fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    fixed_dir().cloned().or_else(|| app.path().app_local_data_dir().ok())
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

    #[test]
    fn portable_mode_needs_the_folder_beside_the_exe() {
        let dir = std::env::temp_dir().join(format!("hafb-portable-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(portable_dir(&dir), None);
        // A file of that name isn't the folder.
        std::fs::write(dir.join(PORTABLE_DIR), b"").unwrap();
        assert_eq!(portable_dir(&dir), None);
        std::fs::remove_file(dir.join(PORTABLE_DIR)).unwrap();
        std::fs::create_dir(dir.join(PORTABLE_DIR)).unwrap();
        assert_eq!(portable_dir(&dir), Some(dir.join(PORTABLE_DIR)));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
