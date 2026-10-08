//! Custom title bar (tauri-plugin-frame + Snap Layouts overlay) or the native Windows title bar,
//! the tested fallback (ADR 0001). The choice is read at startup, so switching restarts the app.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TitlebarMode {
    Custom,
    Native,
}

fn mode_file<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    crate::paths::app_data_dir(app).map(|dir| dir.join("titlebar-mode.txt"))
}

pub fn read_mode<R: Runtime>(app: &AppHandle<R>) -> TitlebarMode {
    let stored = mode_file(app).and_then(|path| std::fs::read_to_string(path).ok());
    match stored.as_deref().map(str::trim) {
        Some("native") => TitlebarMode::Native,
        _ => TitlebarMode::Custom,
    }
}

#[tauri::command]
pub fn get_titlebar_mode(app: AppHandle) -> TitlebarMode {
    read_mode(&app)
}

/// Save the choice and restart so the window is rebuilt with it.
#[tauri::command]
pub fn set_titlebar_mode(app: AppHandle, mode: TitlebarMode) -> Result<(), String> {
    let path = mode_file(&app).ok_or("no app data directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let value = match mode {
        TitlebarMode::Custom => "custom",
        TitlebarMode::Native => "native",
    };
    std::fs::write(path, value).map_err(|e| e.to_string())?;
    app.restart()
}
