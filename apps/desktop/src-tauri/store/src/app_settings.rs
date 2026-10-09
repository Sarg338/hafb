//! Settings of this PC (S7.1): the folder the plan Open and Save dialogs start in. Like the backup
//! settings, it lives in the app's data folder (`app-settings.json`), never in a plan file.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Where new plans are saved and the Open dialog starts; `None` = Windows' default (Documents).
    #[serde(default)]
    pub plan_folder: Option<String>,
}

impl AppSettings {
    /// Drop blank values (a hand-edited file can hold anything).
    pub fn sanitized(self) -> Self {
        Self { plan_folder: self.plan_folder.filter(|f| !f.trim().is_empty()) }
    }

    /// The plans folder, if it was chosen and still exists.
    pub fn plan_dir(&self) -> Option<PathBuf> {
        self.plan_folder.as_ref().map(PathBuf::from).filter(|p| p.is_dir())
    }
}

pub fn file(data_dir: &Path) -> PathBuf {
    data_dir.join("app-settings.json")
}

/// The saved settings, or the defaults when there are none or the file is unreadable.
pub fn load(data_dir: &Path) -> AppSettings {
    std::fs::read_to_string(file(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str::<AppSettings>(&t).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn save(data_dir: &Path, settings: &AppSettings) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let text = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    std::fs::write(file(data_dir), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_missing_or_broken_and_drops_blank_or_missing_folders() {
        let dir = std::env::temp_dir().join(format!("hafb-as-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), AppSettings::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(file(&dir), "not json").unwrap();
        assert_eq!(load(&dir), AppSettings::default());
        std::fs::write(file(&dir), r#"{"planFolder": "   "}"#).unwrap();
        assert_eq!(load(&dir).plan_folder, None);
        let plans = dir.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();
        save(&dir, &AppSettings { plan_folder: Some(plans.to_string_lossy().into_owned()) }).unwrap();
        assert_eq!(load(&dir).plan_dir(), Some(plans.clone()));
        // A folder that was deleted since is ignored, not an error.
        std::fs::remove_dir_all(&plans).unwrap();
        assert_eq!(load(&dir).plan_dir(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
