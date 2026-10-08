mod commands;
mod spike;

use tauri::Manager;
use tauri_plugin_frame::WebviewWindowExt;

/// Title bar height and caption-button width in CSS px. Must match `.titlebar` in app.css,
/// or the native snap overlay drifts off the maximize button.
const TITLEBAR_HEIGHT: u32 = 32;
const CAPTION_BUTTON_WIDTH: u32 = 46;

pub fn run() {
    let main_started_ms = spike::launch::ms_since_process_start();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_frame::FramePluginBuilder::new()
                .auto_titlebar(false)
                .snap_overlay(true)
                .titlebar_height(TITLEBAR_HEIGHT)
                .button_width(CAPTION_BUTTON_WIDTH)
                .build(),
        )
        .manage(spike::launch::LaunchTiming::new(main_started_ms))
        .manage(spike::sqlite::SpikeDb::default())
        .manage(commands::PlanState::default())
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
            commands::recent_plans,
            commands::recent_remove,
            commands::pick_plan_path,
            commands::pick_import_zip,
            commands::read_import_file,
            spike::launch::spike_mark_first_paint,
            spike::sqlite::spike_sqlite_open,
            spike::sqlite::spike_sqlite_write,
            spike::sqlite::spike_sqlite_read,
            spike::titlebar::spike_get_titlebar_mode,
            spike::titlebar::spike_set_titlebar_mode,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or("main window missing from tauri.conf.json")?;
            match spike::titlebar::read_mode(app.handle()) {
                spike::titlebar::TitlebarMode::Custom => {
                    window.create_overlay_titlebar_with_height(TITLEBAR_HEIGHT)?;
                }
                spike::titlebar::TitlebarMode::Native => {
                    window.set_decorations(true)?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running HAFB");
}
