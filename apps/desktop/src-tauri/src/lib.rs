mod commands;
mod diagnostics;
mod paths;
mod startup;
mod titlebar;
mod window_state;

use tauri::{Manager, WindowEvent};
use tauri_plugin_frame::WebviewWindowExt;

/// Title bar height and caption-button width in CSS px. Must match `.titlebar` in app.css,
/// or the native snap overlay drifts off the maximize button.
const TITLEBAR_HEIGHT: u32 = 32;
const CAPTION_BUTTON_WIDTH: u32 = 46;

pub fn run() {
    let main_started_ms = diagnostics::ms_since_process_start();
    paths::redirect_webview_profile();
    let startup_plan = startup::plan_path_from_args(std::env::args_os().skip(1));

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
        .manage(startup::StartupPlan(std::sync::Mutex::new(startup_plan)))
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
            diagnostics::launch_timing,
            startup::startup_plan_path,
            titlebar::get_titlebar_mode,
            titlebar::set_titlebar_mode,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or("main window missing from tauri.conf.json")?;
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
