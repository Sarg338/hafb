//! Plan-file commands for the webview (ADR 0002 §4, §7). Thin: I/O only; the store crate does the
//! work and `@hafb/store` owns every rule. Errors reach JS as `{ kind, message }`.

use hafb_store::backup::{self, BackupInfo};
use hafb_store::error::{ErrorKind, Result, StoreError};
use hafb_store::recent::{self, RecentPlan};
use hafb_store::wire::{LoadedTables, LogEntry, RowChanges};
use hafb_store::{OpenOptions, OpenReport, Plan, PlanInfo};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// Imports larger than this are refused (a YNAB export of a decade of data is a few MB).
const MAX_IMPORT_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Default)]
pub struct PlanState {
    open: Mutex<Option<OpenPlan>>,
    /// The file the user last picked in the import dialog: the only file `read_import_file` reads.
    picked_import: Mutex<Option<PathBuf>>,
}

pub struct OpenPlan {
    plan: Plan,
    report: OpenReport,
    backup_dir: PathBuf,
}

fn lock_err<T>(_: T) -> StoreError {
    StoreError::new(ErrorKind::Io, "Internal state lock was poisoned; restart the app.")
}

fn not_open() -> StoreError {
    StoreError::new(ErrorKind::NotOpen, "No plan is open.")
}

fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| StoreError::new(ErrorKind::Io, format!("No local data folder: {e}")))
}

fn recent_file(app: &AppHandle) -> Result<PathBuf> {
    Ok(data_dir(app)?.join("recent.json"))
}

fn backup_dir_for(app: &AppHandle, plan: &Path) -> Result<PathBuf> {
    Ok(backup::plan_backup_dir(&data_dir(app)?.join("backups"), plan))
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Open `path` (closing any open plan first), back it up, and remember it in the recent list.
fn open_into(app: &AppHandle, state: &PlanState, path: &Path, backup_on_open: bool) -> Result<PlanInfo> {
    let mut slot = state.open.lock().map_err(lock_err)?;
    *slot = None; // release the previous plan's lock before opening (it may be the same file)
    let backup_dir = backup_dir_for(app, path)?;
    let options = OpenOptions { backup_dir: Some(backup_dir.clone()), backup_on_open };
    let (plan, report) = Plan::open(path, &options)?;
    let info = plan.info(&report)?;
    recent::add(&recent_file(app)?, &info.path)?;
    *slot = Some(OpenPlan { plan, report, backup_dir });
    Ok(info)
}

#[tauri::command]
pub async fn plan_create(
    app: AppHandle,
    state: State<'_, PlanState>,
    path: String,
    changes: RowChanges,
    overwrite: Option<bool>,
) -> Result<PlanInfo> {
    let path = PathBuf::from(path);
    if state.open.lock().map_err(lock_err)?.as_ref().is_some_and(|o| same_path(o.plan.path(), &path)) {
        return Err(StoreError::invalid("That plan is open; choose a different file."));
    }
    Plan::create(&path, &changes, overwrite.unwrap_or(false))?;
    open_into(&app, &state, &path, false)
}

#[tauri::command]
pub async fn plan_open(app: AppHandle, state: State<'_, PlanState>, path: String) -> Result<PlanInfo> {
    open_into(&app, &state, Path::new(&path), true)
}

/// The open plan, if any (the webview reloads during development).
#[tauri::command]
pub async fn plan_current(state: State<'_, PlanState>) -> Result<Option<PlanInfo>> {
    let slot = state.open.lock().map_err(lock_err)?;
    slot.as_ref().map(|o| o.plan.info(&o.report)).transpose()
}

#[tauri::command]
pub async fn plan_close(state: State<'_, PlanState>) -> Result<()> {
    *state.open.lock().map_err(lock_err)? = None;
    Ok(())
}

#[tauri::command]
pub async fn plan_load(state: State<'_, PlanState>) -> Result<LoadedTables> {
    let slot = state.open.lock().map_err(lock_err)?;
    slot.as_ref().ok_or_else(not_open)?.plan.load()
}

#[tauri::command]
pub async fn plan_apply(state: State<'_, PlanState>, changes: RowChanges, log: Option<LogEntry>) -> Result<()> {
    let mut slot = state.open.lock().map_err(lock_err)?;
    slot.as_mut().ok_or_else(not_open)?.plan.apply(&changes, log.as_ref())
}

#[tauri::command]
pub async fn plan_save_copy(state: State<'_, PlanState>, dest: String) -> Result<()> {
    let slot = state.open.lock().map_err(lock_err)?;
    slot.as_ref().ok_or_else(not_open)?.plan.save_copy(Path::new(&dest))
}

#[tauri::command]
pub async fn plan_backups(state: State<'_, PlanState>) -> Result<Vec<BackupInfo>> {
    let slot = state.open.lock().map_err(lock_err)?;
    backup::list_backups(&slot.as_ref().ok_or_else(not_open)?.backup_dir)
}

/// Replace the open plan with one of its own backups (from `plan_backups`).
#[tauri::command]
pub async fn plan_restore(app: AppHandle, state: State<'_, PlanState>, backup_path: String) -> Result<PlanInfo> {
    let mut slot = state.open.lock().map_err(lock_err)?;
    let open = slot.take().ok_or_else(not_open)?;
    let backup_file = PathBuf::from(backup_path);
    if !backup_file.parent().is_some_and(|p| same_path(p, &open.backup_dir)) {
        *slot = Some(open);
        return Err(StoreError::invalid("Only this plan's own backups can be restored; use Open for other files."));
    }
    let backup_dir = open.backup_dir.clone();
    let (plan, mut report, saved) = open.plan.restore(&backup_file, &backup_dir)?;
    report.backup_path = Some(path_string(&saved));
    let info = plan.info(&report)?;
    recent::add(&recent_file(&app)?, &info.path)?;
    *slot = Some(OpenPlan { plan, report, backup_dir });
    Ok(info)
}

#[tauri::command]
pub async fn recent_plans(app: AppHandle) -> Result<Vec<RecentPlan>> {
    Ok(recent::list(&recent_file(&app)?))
}

#[tauri::command]
pub async fn recent_remove(app: AppHandle, path: String) -> Result<()> {
    recent::remove(&recent_file(&app)?, &path)
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PickMode {
    Open,
    Save,
}

/// Native open/save dialog for plan files. Returns the chosen path, or null if cancelled.
#[tauri::command]
pub async fn pick_plan_path(window: WebviewWindow, mode: PickMode, default_name: Option<String>) -> Result<Option<String>> {
    let dialog = rfd::FileDialog::new().set_parent(&window).add_filter("Plan", &["hafb"]);
    let picked = match mode {
        PickMode::Open => dialog.set_title("Open plan").pick_file(),
        PickMode::Save => {
            let name = default_name.unwrap_or_else(|| "My Plan.hafb".to_owned());
            dialog.set_title("Save plan").set_file_name(name).save_file().map(|p| {
                if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("hafb")) { p } else { p.with_extension("hafb") }
            })
        }
    };
    Ok(picked.map(|p| path_string(&p)))
}

/// Native open dialog for a plan export (.zip). The picked file becomes readable by `read_import_file`.
#[tauri::command]
pub async fn pick_import_zip(window: WebviewWindow, state: State<'_, PlanState>) -> Result<Option<String>> {
    let picked = rfd::FileDialog::new()
        .set_parent(&window)
        .set_title("Import a plan export")
        .add_filter("Plan export", &["zip"])
        .pick_file();
    *state.picked_import.lock().map_err(lock_err)? = picked.clone();
    Ok(picked.map(|p| path_string(&p)))
}

/// The bytes of the file last picked with `pick_import_zip` (an ArrayBuffer in JS). Any other
/// path is refused: the webview cannot read arbitrary files through this command.
#[tauri::command]
pub async fn read_import_file(state: State<'_, PlanState>, path: String) -> Result<tauri::ipc::Response> {
    let allowed = state.picked_import.lock().map_err(lock_err)?.clone();
    let path = PathBuf::from(path);
    if !allowed.is_some_and(|a| same_path(&a, &path)) {
        return Err(StoreError::invalid("Pick the file with the import dialog first."));
    }
    let size = std::fs::metadata(&path)?.len();
    if size > MAX_IMPORT_BYTES {
        return Err(StoreError::invalid(format!("The file is too large to import ({} MB).", size / 1_000_000)));
    }
    Ok(tauri::ipc::Response::new(std::fs::read(&path)?))
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a.as_os_str().eq_ignore_ascii_case(b.as_os_str()),
    }
}
