mod commands;
mod credentials;
mod diagnostics;
mod exports;
mod paths;
mod photos;
mod startup;
mod titlebar;
#[cfg(windows)]
mod webview_env;
mod window_state;

use tauri::{Manager, WindowEvent};
use tauri_plugin_frame::WebviewWindowExt;

/// Title bar height and caption-button width in CSS px. Must match `.titlebar` in app.css,
/// or the native snap overlay drifts off the maximize button.
const TITLEBAR_HEIGHT: u32 = 32;
const CAPTION_BUTTON_WIDTH: u32 = 46;

pub fn run() {
    let main_started_ms = diagnostics::ms_since_process_start();
    let named_plan = startup::plan_path_from_args(std::env::args_os().skip(1));

    tauri::Builder::default()
        .plugin(
            tauri_plugin_frame::FramePluginBuilder::new()
                .auto_titlebar(false)
                .snap_overlay(true)
                .titlebar_height(TITLEBAR_HEIGHT)
                .button_width(CAPTION_BUTTON_WIDTH)
                .build(),
        )
        .manage(diagnostics::LaunchTiming::new(main_started_ms))
        .manage(commands::PlanState::default())
        .manage(window_state::WindowTracker::default())
        .manage(startup::StartupPlan::default())
        .invoke_handler(tauri::generate_handler![
            commands::plan_create,
            commands::plan_open,
            commands::plan_current,
            commands::plan_close,
            commands::plan_load,
            commands::plan_apply,
            commands::plan_save_copy,
            commands::plan_backups,
            commands::plan_restore,
            commands::plan_recovery_candidate,
            commands::plan_recover,
            commands::plan_password_status,
            commands::plan_set_password,
            commands::plan_relock_backups,
            commands::plan_backup_now,
            commands::backup_settings_get,
            commands::backup_settings_set,
            commands::pick_backup_folder,
            commands::app_settings_get,
            commands::app_settings_set,
            commands::pick_plan_folder,
            commands::recent_plans,
            commands::recent_remove,
            commands::pick_plan_path,
            commands::pick_import_zip,
            commands::pick_bank_files,
            commands::read_import_file,
            exports::save_export,
            photos::attachment_list,
            photos::attachment_pick_add,
            photos::attachment_data,
            photos::attachment_thumbnail,
            photos::attachment_set_thumbnail,
            photos::attachment_delete,
            diagnostics::launch_timing,
            diagnostics::mark_plan_ready,
            startup::startup_plan_path,
            titlebar::get_titlebar_mode,
            titlebar::set_titlebar_mode,
        ])
        .setup(move |app| {
            // The plan named at launch, else the one open at the last quit (startup.rs). It's read
            // while the webview starts (S8.1). Before this returns, no IPC is served, so the UI's
            // plan_open always finds the preload.
            let launch_plan = named_plan.or_else(|| paths::app_data_dir(app.handle()).and_then(|data| startup::last_open(&data)));
            if let Some(path) = launch_plan {
                if let Ok(mut slot) = app.state::<startup::StartupPlan>().0.lock() {
                    *slot = Some(path.clone());
                }
                commands::preload(app.handle(), path);
            }
            // The main window is built here, not from config, so its WebView2 environment carries
            // HAFB's privacy options (S8.3, webview_env.rs).
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("main window missing from tauri.conf.json")?;
            #[allow(unused_mut)]
            let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
            #[cfg(windows)]
            {
                // The profile goes in the app's data folder: AppData, the portable folder or HAFB_DATA_DIR.
                let data = paths::app_data_dir(app.handle()).ok_or("no local data folder")?;
                let environment = webview_env::create(&data)?;
                builder = builder.with_environment(environment);
            }
            let window = builder.build()?;
            match titlebar::read_mode(app.handle()) {
                titlebar::TitlebarMode::Custom => {
                    window.create_overlay_titlebar_with_height(TITLEBAR_HEIGHT)?;
                }
                titlebar::TitlebarMode::Native => {
                    window.set_decorations(true)?;
                }
            }
            // The window starts hidden (tauri.conf.json) so it never flashes at the default spot.
            window_state::restore_and_show(&window);
            Ok(())
        })
        .on_window_event(|window, event| {
            let Some(window) = window.app_handle().get_webview_window(window.label()) else {
                return;
            };
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => window_state::track(&window),
                WindowEvent::CloseRequested { .. } => window_state::save(&window),
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building HAFB")
        .run(|app, event| {
            // Quitting (window X, Alt+F4) closes the plan like the Close button does.
            if let tauri::RunEvent::Exit = event {
                app.state::<commands::PlanState>().close();
            }
        });
}

#[cfg(test)]
mod tests {
    /// One version everywhere (S8.4): Cargo.toml feeds Tauri and the installer, package.json feeds
    /// About HAFB. `pnpm version:set` changes them together.
    #[test]
    fn versions_agree() {
        let version = env!("CARGO_PKG_VERSION");
        assert!(include_str!("../../package.json").contains(&format!("\"version\": \"{version}\"")), "apps/desktop/package.json");
        assert!(include_str!("../store/Cargo.toml").contains(&format!("\nversion = \"{version}\"")), "store/Cargo.toml");
        assert!(!include_str!("../tauri.conf.json").contains("\"version\""), "tauri.conf.json takes its version from Cargo.toml");
    }
}
