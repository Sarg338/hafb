//! Window size, position and maximized state across launches (S3.3).
//!
//! The last *normal* (not maximized, not minimized) outer bounds are tracked from Moved/Resized
//! events and written on close, together with the maximized flag. At startup the saved bounds are
//! clamped to the monitors that exist now, so a window never opens off-screen after a monitor is
//! unplugged or the resolution changes. Physical pixels throughout.

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// Same minimums as tauri.conf.json (logical); scaled by the monitor at restore time.
const MIN_WIDTH: u32 = 480;
const MIN_HEIGHT: u32 = 360;
/// How much of the window's top edge must be on a monitor for the saved position to stand: enough
/// of the title bar to grab and move it.
const GRAB_WIDTH: i64 = 120;
const GRAB_HEIGHT: i64 = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// A monitor's work area (excludes the taskbar), physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Area {
    fn right(&self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }
    fn bottom(&self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }
    /// Overlap of the rectangle with this area, in px².
    fn overlap(&self, x: i64, y: i64, w: i64, h: i64) -> i64 {
        let ox = (x + w).min(self.right()) - x.max(i64::from(self.x));
        let oy = (y + h).min(self.bottom()) - y.max(i64::from(self.y));
        if ox <= 0 || oy <= 0 { 0 } else { ox * oy }
    }
}

/// Where to put a saved window given the monitors that exist now.
///
/// * The window keeps its saved position when a grabbable strip of its title bar lies on some
///   monitor; its size is reduced to fit that monitor and it is nudged fully inside it.
/// * Otherwise it is centred on the primary monitor (or the first one) at the saved size,
///   reduced to fit.
/// * With no monitors at all the state is returned unchanged.
pub fn clamp(saved: WindowState, areas: &[Area], primary: Option<Area>) -> WindowState {
    let Some(fallback) = primary.or_else(|| areas.first().copied()) else {
        return saved;
    };
    let (x, y) = (i64::from(saved.x), i64::from(saved.y));
    let home = areas
        .iter()
        .copied()
        .filter(|a| a.overlap(x, y, GRAB_WIDTH.min(i64::from(saved.width)), GRAB_HEIGHT) > 0)
        .max_by_key(|a| a.overlap(x, y, i64::from(saved.width), i64::from(saved.height)));
    let area = home.unwrap_or(fallback);
    let width = saved.width.clamp(MIN_WIDTH.min(area.width), area.width);
    let height = saved.height.clamp(MIN_HEIGHT.min(area.height), area.height);
    let (nx, ny) = if home.is_some() {
        // Nudge inside the work area.
        let max_x = area.right() - i64::from(width);
        let max_y = area.bottom() - i64::from(height);
        (x.clamp(i64::from(area.x), max_x), y.clamp(i64::from(area.y), max_y))
    } else {
        (
            i64::from(area.x) + (i64::from(area.width) - i64::from(width)) / 2,
            i64::from(area.y) + (i64::from(area.height) - i64::from(height)) / 2,
        )
    };
    WindowState {
        x: i32::try_from(nx).unwrap_or(area.x),
        y: i32::try_from(ny).unwrap_or(area.y),
        width,
        height,
        maximized: saved.maximized,
    }
}

impl WindowState {
    /// One line, `x y width height maximized`: no JSON dependency in the app crate.
    pub fn to_line(self) -> String {
        format!("{} {} {} {} {}", self.x, self.y, self.width, self.height, u8::from(self.maximized))
    }

    pub fn from_line(line: &str) -> Option<Self> {
        let mut parts = line.split_whitespace();
        let state = WindowState {
            x: parts.next()?.parse().ok()?,
            y: parts.next()?.parse().ok()?,
            width: parts.next()?.parse().ok()?,
            height: parts.next()?.parse().ok()?,
            maximized: parts.next()? == "1",
        };
        parts.next().is_none().then_some(state)
    }
}

/// The last normal bounds seen this session (maximized/minimized bounds are not remembered).
#[derive(Default)]
pub struct WindowTracker {
    normal: Mutex<Option<WindowState>>,
}

fn state_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    crate::paths::app_data_dir(app).map(|d| d.join("window-state.txt"))
}

fn read_saved<R: Runtime>(app: &AppHandle<R>) -> Option<WindowState> {
    WindowState::from_line(&std::fs::read_to_string(state_file(app)?).ok()?)
}

fn current_normal<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowState> {
    if window.is_maximized().ok()? || window.is_minimized().ok()? {
        return None;
    }
    let pos = window.outer_position().ok()?;
    // Outer size: what the window occupies on screen, which is what the monitor clamp needs.
    let size = window.outer_size().ok()?;
    Some(WindowState { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: false })
}

/// Record the current bounds if the window is in its normal state (call on Moved/Resized).
pub fn track<R: Runtime>(window: &WebviewWindow<R>) {
    if let Some(state) = current_normal(window) {
        if let Ok(mut slot) = window.state::<WindowTracker>().normal.lock() {
            *slot = Some(state);
        }
    }
}

/// Write the remembered normal bounds plus the maximized flag (call when the window closes).
pub fn save<R: Runtime>(window: &WebviewWindow<R>) {
    let maximized = window.is_maximized().unwrap_or(false);
    let normal = window.state::<WindowTracker>().normal.lock().ok().and_then(|s| *s).or_else(|| current_normal(window));
    let (Some(normal), Some(path)) = (normal, state_file(window.app_handle())) else {
        return;
    };
    let state = WindowState { maximized, ..normal };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, state.to_line());
}

/// Put the window where it was last time (clamped to today's monitors), then show it.
pub fn restore_and_show<R: Runtime>(window: &WebviewWindow<R>) {
    if let Some(saved) = read_saved(window.app_handle()) {
        let to_area = |m: &tauri::Monitor| {
            let r = m.work_area();
            Area { x: r.position.x, y: r.position.y, width: r.size.width, height: r.size.height }
        };
        let areas: Vec<Area> = window.available_monitors().unwrap_or_default().iter().map(to_area).collect();
        let primary = window.primary_monitor().ok().flatten().as_ref().map(to_area);
        let placed = clamp(saved, &areas, primary);
        // set_size takes the inner size; the frame difference is measured on this window as created.
        let (dw, dh) = match (window.outer_size(), window.inner_size()) {
            (Ok(o), Ok(i)) => (o.width.saturating_sub(i.width), o.height.saturating_sub(i.height)),
            _ => (0, 0),
        };
        let _ = window.set_size(PhysicalSize::new(placed.width.saturating_sub(dw), placed.height.saturating_sub(dh)));
        let _ = window.set_position(PhysicalPosition::new(placed.x, placed.y));
        if let Ok(mut slot) = window.state::<WindowTracker>().normal.lock() {
            *slot = Some(WindowState { maximized: false, ..placed });
        }
        if placed.maximized {
            let _ = window.maximize();
        }
    } else {
        let _ = window.center();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: Area = Area { x: 0, y: 0, width: 1920, height: 1040 };
    const RIGHT: Area = Area { x: 1920, y: 0, width: 2560, height: 1400 };

    fn state(x: i32, y: i32, width: u32, height: u32) -> WindowState {
        WindowState { x, y, width, height, maximized: false }
    }

    #[test]
    fn keeps_a_window_that_is_on_screen() {
        assert_eq!(clamp(state(100, 80, 1280, 820), &[MAIN], Some(MAIN)), state(100, 80, 1280, 820));
    }

    #[test]
    fn keeps_a_window_on_a_second_monitor() {
        assert_eq!(clamp(state(2100, 100, 1400, 900), &[MAIN, RIGHT], Some(MAIN)), state(2100, 100, 1400, 900));
    }

    #[test]
    fn centres_on_primary_when_its_monitor_is_gone() {
        let placed = clamp(state(2100, 100, 1400, 900), &[MAIN], Some(MAIN));
        assert_eq!(placed, state((1920 - 1400) / 2, (1040 - 900) / 2, 1400, 900));
    }

    #[test]
    fn shrinks_to_fit_a_smaller_monitor() {
        let placed = clamp(state(50, 40, 2400, 1300), &[MAIN], Some(MAIN));
        assert_eq!(placed, state(0, 0, 1920, 1040));
    }

    #[test]
    fn nudges_a_window_hanging_off_the_edge_back_inside() {
        // Title bar on screen, but the window extends past the right and bottom edges.
        let placed = clamp(state(1800, 900, 1280, 820), &[MAIN], Some(MAIN));
        assert_eq!(placed, state(1920 - 1280, 1040 - 820, 1280, 820));
    }

    #[test]
    fn a_title_bar_above_the_screen_does_not_count_as_on_screen() {
        let placed = clamp(state(100, -200, 1280, 820), &[MAIN], Some(MAIN));
        assert_eq!(placed, state((1920 - 1280) / 2, (1040 - 820) / 2, 1280, 820));
    }

    #[test]
    fn keeps_the_maximized_flag_and_enforces_minimums() {
        let placed = clamp(WindowState { x: 10, y: 10, width: 100, height: 50, maximized: true }, &[MAIN], Some(MAIN));
        assert_eq!(placed, WindowState { x: 10, y: 10, width: MIN_WIDTH, height: MIN_HEIGHT, maximized: true });
    }

    #[test]
    fn negative_coordinates_on_a_left_monitor() {
        let left = Area { x: -1920, y: 0, width: 1920, height: 1040 };
        assert_eq!(clamp(state(-1700, 50, 1200, 800), &[left, MAIN], Some(MAIN)), state(-1700, 50, 1200, 800));
    }

    #[test]
    fn the_saved_line_round_trips_and_rejects_junk() {
        let s = WindowState { x: -1700, y: 50, width: 1200, height: 800, maximized: true };
        assert_eq!(WindowState::from_line(&s.to_line()), Some(s));
        assert_eq!(WindowState::from_line("1 2 3"), None);
        assert_eq!(WindowState::from_line("a b c d 0"), None);
        assert_eq!(WindowState::from_line("1 2 3 4 0 extra"), None);
    }

    #[test]
    fn no_monitors_leaves_the_state_alone() {
        assert_eq!(clamp(state(5, 5, 900, 700), &[], None), state(5, 5, 900, 700));
    }
}
