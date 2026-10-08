//! Startup arguments: `hafb.exe --open <path>`, or a bare `.hafb` path (what Windows passes when a
//! plan file is opened from Explorer, once a file association exists). The UI asks once at mount.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

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
}
