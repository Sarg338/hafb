//! Launch timing for the 1.5 s launch budget (CLAUDE.md §8): process start → `main` → first
//! painted frame. The UI marks its first paint once; the numbers stay readable for perf checks.

use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

pub struct LaunchTiming {
    main_started_ms: Option<f64>,
    first_paint_ms: Mutex<Option<f64>>,
    plan_ready_ms: Mutex<Option<f64>>,
}

impl LaunchTiming {
    pub fn new(main_started_ms: Option<f64>) -> Self {
        Self {
            main_started_ms,
            first_paint_ms: Mutex::new(None),
            plan_ready_ms: Mutex::new(None),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchInfo {
    process_to_main_ms: Option<f64>,
    process_to_first_paint_ms: Option<f64>,
}

/// Called by the UI once, right after its first painted frame. Later calls return the first value.
#[tauri::command]
pub async fn launch_timing(timing: State<'_, LaunchTiming>) -> Result<LaunchInfo, String> {
    let mut first_paint = timing.first_paint_ms.lock().map_err(|e| e.to_string())?;
    if first_paint.is_none() {
        *first_paint = ms_since_process_start();
    }
    Ok(LaunchInfo {
        process_to_main_ms: timing.main_started_ms,
        process_to_first_paint_ms: *first_paint,
    })
}

/// Called by the UI once the first plan of this run has painted, ready to use (S8.1: launch to a
/// usable plan). Returns milliseconds since process start; later calls return the first value.
#[tauri::command]
pub async fn mark_plan_ready(timing: State<'_, LaunchTiming>) -> Result<Option<f64>, String> {
    let mut ready = timing.plan_ready_ms.lock().map_err(|e| e.to_string())?;
    if ready.is_none() {
        *ready = ms_since_process_start();
    }
    Ok(*ready)
}

/// Milliseconds since the OS created this process (not since `main`), so the number
/// includes loader and runtime start-up.
#[cfg(windows)]
pub fn ms_since_process_start() -> Option<f64> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::SystemInformation::GetSystemTimePreciseAsFileTime;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut creation, mut exit, mut kernel, mut user, mut now) = (zero, zero, zero, zero, zero);
    // SAFETY: every out-pointer is a valid, writable stack local, and GetCurrentProcess
    // returns a pseudo-handle that never needs closing.
    let ok = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    // SAFETY: `now` is a valid, writable stack local.
    unsafe { GetSystemTimePreciseAsFileTime(&mut now) };
    if ok == 0 {
        return None;
    }
    let ticks = |f: FILETIME| (u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime);
    // FILETIME ticks are 100 ns.
    Some(ticks(now).saturating_sub(ticks(creation)) as f64 / 10_000.0)
}

#[cfg(not(windows))]
pub fn ms_since_process_start() -> Option<f64> {
    None
}
