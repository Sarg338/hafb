//! Startup arguments: `hafb.exe --open <path>`, or a bare `.hafb` path (what Windows passes when a
//! plan file is opened from Explorer, once a file association exists). The UI asks once at mount.
//!
//! With neither, HAFB reopens the plan that was open when it last quit, as YNAB goes straight to
//! your last plan (Sarg, 2026-10-12). Close plan forgets it, so quitting from the welcome screen
//! starts there next time.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// In the app's data folder: the path of the plan open now, or at the last quit.
const LAST_PLAN_FILE: &str = "last-plan.txt";

/// Note that `plan` is open. A failed write only means the next launch starts at the welcome screen.
pub fn remember_open(data_dir: &Path, plan: &Path) {
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(data_dir.join(LAST_PLAN_FILE), plan.to_string_lossy().as_bytes());
}

/// The user closed the plan: the next launch starts at the welcome screen.
pub fn forget_open(data_dir: &Path) {
    let _ = std::fs::remove_file(data_dir.join(LAST_PLAN_FILE));
}

/// The plan to reopen at launch, if one was open at the last quit and its file is still there.
pub fn last_open(data_dir: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(data_dir.join(LAST_PLAN_FILE)).ok()?;
    let path = PathBuf::from(text.trim());
    (!text.trim().is_empty() && path.is_file()).then_some(path)
}

/// The plan to open at launch, from the process arguments (program name excluded).
pub fn plan_path_from_args(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    let mut args = args.into_iter();
    let mut bare: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        if arg == "--open" {
            return args.next().filter(|p| !p.is_empty()).map(PathBuf::from);
        }
        let path = PathBuf::from(&arg);
        if bare.is_none() && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("hafb")) {
            bare = Some(path);
        }
    }
    bare
}

/// Handed to the UI once; a reload of the page doesn't reopen it.
#[derive(Default)]
pub struct StartupPlan(pub Mutex<Option<PathBuf>>);

#[tauri::command]
pub fn startup_plan_path(state: State<'_, StartupPlan>) -> Option<String> {
    state.0.lock().ok()?.take().map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn open_flag_takes_the_next_argument() {
        assert_eq!(plan_path_from_args(args(&["--open", r"C:\Plans\Home.hafb"])), Some(PathBuf::from(r"C:\Plans\Home.hafb")));
    }

    #[test]
    fn a_bare_plan_file_is_opened() {
        assert_eq!(plan_path_from_args(args(&[r"D:\x\Family.HAFB"])), Some(PathBuf::from(r"D:\x\Family.HAFB")));
    }

    #[test]
    fn other_arguments_are_ignored() {
        assert_eq!(plan_path_from_args(args(&["--verbose", "notes.txt"])), None);
        assert_eq!(plan_path_from_args(args(&["--open"])), None);
        assert_eq!(plan_path_from_args(args(&[])), None);
    }

    #[test]
    fn the_flag_wins_over_a_bare_path() {
        assert_eq!(plan_path_from_args(args(&["a.hafb", "--open", "b.hafb"])), Some(PathBuf::from("b.hafb")));
    }

    #[test]
    fn the_last_open_plan_is_reopened_until_closed() {
        let dir = std::env::temp_dir().join(format!("hafb-last-plan-{}", std::process::id()));
        let data = dir.join("data");
        let plan = dir.join("Home Budget.hafb");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&plan, b"").unwrap();
        assert_eq!(last_open(&data), None, "nothing opened yet");
        remember_open(&data, &plan);
        assert_eq!(last_open(&data), Some(plan.clone()));
        forget_open(&data);
        assert_eq!(last_open(&data), None, "Close plan forgets it");
        remember_open(&data, &plan);
        std::fs::remove_file(&plan).unwrap();
        assert_eq!(last_open(&data), None, "a moved or deleted plan isn't reopened");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
