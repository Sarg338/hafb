//! Lets the spike switch between the custom title bar (tauri-plugin-frame + snap overlay)
//! and the native Windows title bar. The choice is read at startup, so switching restarts the app.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TitlebarMode {
    Custom,
    Native,
}

fn mode_file<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("spike-titlebar-mode.txt"))
}

pub fn read_mode<R: Runtime>(app: &AppHandle<R>) -> TitlebarMode {
    let stored = mode_file(app).and_then(|path| std::fs::read_to_string(path).ok());
    match stored.as_deref().map(str::trim) {
        Some("native") => TitlebarMode::Native,
        _ => TitlebarMode::Custom,
    }
}

#[tauri::command]
pub fn spike_get_titlebar_mode(app: AppHandle) -> TitlebarMode {
    read_mode(&app)
}

#[tauri::command]
pub fn spike_set_titlebar_mode(app: AppHandle, mode: TitlebarMode) -> Result<(), String> {
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
