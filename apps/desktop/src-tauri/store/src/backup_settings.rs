//! Backup settings (S6.6): how many backups to keep and where they go. A setting of this PC, not of
//! the plan, so it lives in the app's data folder (`backup-settings.json`), never in a plan file.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Kept within 1..=100; the default matches the store's `KEEP_BACKUPS`.
pub const MIN_KEEP: usize = 1;
pub const MAX_KEEP: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    pub keep: usize,
    /// A folder the user chose; `None` = the app's data folder.
    #[serde(default)]
    pub folder: Option<String>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self { keep: crate::backup::KEEP_BACKUPS, folder: None }
    }
}

impl BackupSettings {
    /// Clamp what was read or sent (a hand-edited file can hold anything).
    pub fn sanitized(self) -> Self {
        let folder = self.folder.filter(|f| !f.trim().is_empty());
        Self { keep: self.keep.clamp(MIN_KEEP, MAX_KEEP), folder }
    }

    /// The folder that holds every plan's backup folder.
    pub fn root(&self, data_dir: &Path) -> PathBuf {
        match &self.folder {
            Some(f) => PathBuf::from(f),
            None => data_dir.join("backups"),
        }
    }
}

pub fn file(data_dir: &Path) -> PathBuf {
    data_dir.join("backup-settings.json")
}

/// The saved settings, or the defaults when there are none or the file is unreadable.
pub fn load(data_dir: &Path) -> BackupSettings {
    std::fs::read_to_string(file(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str::<BackupSettings>(&t).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn save(data_dir: &Path, settings: &BackupSettings) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let text = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    std::fs::write(file(data_dir), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_missing_or_broken_and_clamps_what_it_reads() {
        let dir = std::env::temp_dir().join(format!("hafb-bs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), BackupSettings::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(file(&dir), "not json").unwrap();
        assert_eq!(load(&dir), BackupSettings::default());
        std::fs::write(file(&dir), r#"{"keep": 500, "folder": "  "}"#).unwrap();
        assert_eq!(load(&dir), BackupSettings { keep: MAX_KEEP, folder: None });
        save(&dir, &BackupSettings { keep: 3, folder: Some("D:/Backups".into()) }).unwrap();
        let back = load(&dir);
        assert_eq!(back.keep, 3);
        assert_eq!(back.root(&dir), PathBuf::from("D:/Backups"));
        assert_eq!(BackupSettings::default().root(&dir), dir.join("backups"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
