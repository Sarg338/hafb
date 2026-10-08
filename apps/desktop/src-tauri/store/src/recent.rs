//! Recent plans: a JSON array of paths (newest first, at most `MAX_RECENT`) in the app's data folder.

use crate::error::Result;
use serde::Serialize;
use std::path::Path;

pub const MAX_RECENT: usize = 10;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlan {
    pub path: String,
    /// False when the file was moved or deleted since; the UI offers to remove it.
    pub exists: bool,
}

fn read(file: &Path) -> Vec<String> {
    // A missing or damaged list is an empty list, never an error: it is a convenience.
    std::fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn write(file: &Path, paths: &[String]) -> Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(paths)?)?;
    std::fs::rename(&tmp, file)?;
    Ok(())
}

fn same(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

pub fn list(file: &Path) -> Vec<RecentPlan> {
    read(file)
        .into_iter()
        .map(|path| RecentPlan { exists: Path::new(&path).is_file(), path })
        .collect()
}

pub fn add(file: &Path, path: &str) -> Result<()> {
    let mut paths = read(file);
    paths.retain(|p| !same(p, path));
    paths.insert(0, path.to_owned());
    paths.truncate(MAX_RECENT);
    write(file, &paths)
}

pub fn remove(file: &Path, path: &str) -> Result<()> {
    let mut paths = read(file);
    paths.retain(|p| !same(p, path));
    write(file, &paths)
}
