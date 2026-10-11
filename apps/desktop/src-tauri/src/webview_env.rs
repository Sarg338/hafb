//! The WebView2 environment, created by HAFB instead of by Tauri so it can set Microsoft's
//! documented privacy options (S8.3, ADR 0001 §7). Tauri's own environment leaves them at their
//! defaults; in testing, WebView2 then fetched Microsoft's experiment config and component updates.
//!
//! - `IsCustomCrashReportingEnabled`: crash dumps stay on this PC; Windows doesn't send them to
//!   Microsoft (CLAUDE.md §1: no crash reporting).
//! - `AllowSingleSignOnUsingOSPrimaryAccount`: off, explicitly; HAFB never signs in to anything.
//! - Browser arguments: Tauri's defaults (no SmartScreen) plus a proxy on a closed loopback port,
//!   so anything WebView2 would fetch on its own (Microsoft's Experimentation and Configuration
//!   Service, component updates) fails on this PC. HAFB's pages and IPC are served in-process and
//!   never touch the network stack.

use std::path::Path;
use std::sync::mpsc;
use webview2_com::Microsoft::Web::WebView2::Win32::{CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2Environment, ICoreWebView2EnvironmentOptions};
use webview2_com::{CoreWebView2EnvironmentOptions, CreateCoreWebView2EnvironmentCompletedHandler};
use windows_core::{HSTRING, PCWSTR};
use windows_sys::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};

/// Tauri's (wry's) default arguments, plus the closed proxy. The port is never listened on.
pub const BROWSER_ARGUMENTS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --proxy-server=http://127.0.0.1:9";

/// Create the environment for the main window, with its profile in `data_dir` (the app's data
/// folder, `paths::app_data_dir`); `WEBVIEW2_USER_DATA_FOLDER` still overrides it (tests).
pub fn create(data_dir: &Path) -> Result<ICoreWebView2Environment, String> {
    // Tauri's setup runs before wry initializes COM on this (the UI) thread; WebView2 needs a
    // single-threaded apartment. wry's own OleInitialize later finds it already set up.
    // SAFETY: called on the main thread, once, before any window exists.
    let hr = unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) };
    if hr < 0 {
        return Err(format!("COM initialization failed (0x{hr:08x})"));
    }
    let options = CoreWebView2EnvironmentOptions::default();
    // SAFETY: plain property setters on a COM object this function owns.
    unsafe {
        options.set_additional_browser_arguments(BROWSER_ARGUMENTS.to_owned());
        options.set_is_custom_crash_reporting_enabled(true);
        options.set_allow_single_sign_on_using_os_primary_account(false);
    }
    let (tx, rx) = mpsc::channel();
    let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |error_code, environment| {
        let result = error_code.map_err(|e| e.to_string()).and_then(|()| environment.ok_or_else(|| "WebView2 returned no environment".to_owned()));
        tx.send(result).map_err(|_| windows_core::Error::from(windows_core::HRESULT(-2_147_418_113)))
    }));
    let folder = HSTRING::from(data_dir.as_os_str());
    // SAFETY: the arguments outlive the call; completion is delivered through the message pump below.
    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &folder, &ICoreWebView2EnvironmentOptions::from(options), &handler).map_err(|e| e.to_string())?;
    }
    webview2_com::wait_with_pump(rx).map_err(|e| e.to_string())?
}
