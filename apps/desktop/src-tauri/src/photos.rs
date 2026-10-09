//! Transaction photos (S7.6, ADR 0009): pick a photo and attach it, read photos and thumbnails back,
//! set the thumbnail the webview made, delete. The bytes stay inside the plan file.

use crate::commands::PlanState;
use hafb_store::attachments::{AttachmentInfo, IMAGE_TYPES, MAX_ATTACHMENT_BYTES};
use hafb_store::error::{ErrorKind, Result, StoreError};
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{State, WebviewWindow};

fn not_open() -> StoreError {
    StoreError::new(ErrorKind::NotOpen, "No plan is open.")
}

fn lock_err<T>(_: T) -> StoreError {
    StoreError::new(ErrorKind::Io, "Internal state lock was poisoned; restart the app.")
}

#[tauri::command]
pub async fn attachment_list(state: State<'_, PlanState>) -> Result<Vec<AttachmentInfo>> {
    let slot = state.open.lock().map_err(lock_err)?;
    slot.as_ref().ok_or_else(not_open)?.plan.attachments()
}

/// Native open dialog for a photo, then attach it to the transaction. Null if cancelled.
#[tauri::command]
pub async fn attachment_pick_add(window: WebviewWindow, state: State<'_, PlanState>, id: String, transaction_id: String, created_at: String) -> Result<Option<AttachmentInfo>> {
    // The smoke suite sets HAFB_PICK_FILES instead of clicking a dialog (as for bank files).
    let picked = match std::env::var("HAFB_PICK_FILES").ok().filter(|v| !v.is_empty()) {
        Some(list) => list.split(';').find(|p| !p.is_empty()).map(PathBuf::from),
        None => {
            let exts: Vec<&str> = IMAGE_TYPES.iter().map(|(e, _)| *e).collect();
            rfd::FileDialog::new().set_parent(&window).set_title("Attach a photo").add_filter("Photos", &exts).pick_file()
        }
    };
    let Some(path) = picked else { return Ok(None) };
    let size = std::fs::metadata(&path)?.len();
    if usize::try_from(size).map_or(true, |s| s > MAX_ATTACHMENT_BYTES) {
        return Err(StoreError::invalid(format!("That photo is too large ({} MB; up to 20 MB).", size / 1_000_000)));
    }
    let bytes = std::fs::read(&path)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "photo".to_owned());
    let mut slot = state.open.lock().map_err(lock_err)?;
    let open = slot.as_mut().ok_or_else(not_open)?;
    Ok(Some(open.plan.attachment_add(&id, &transaction_id, &name, &bytes, &created_at)?))
}

/// The photo's bytes (an ArrayBuffer in JS).
#[tauri::command]
pub async fn attachment_data(state: State<'_, PlanState>, id: String) -> Result<Response> {
    let slot = state.open.lock().map_err(lock_err)?;
    Ok(Response::new(slot.as_ref().ok_or_else(not_open)?.plan.attachment_data(&id)?))
}

/// The thumbnail's bytes; empty when there is none yet.
#[tauri::command]
pub async fn attachment_thumbnail(state: State<'_, PlanState>, id: String) -> Result<Response> {
    let slot = state.open.lock().map_err(lock_err)?;
    Ok(Response::new(slot.as_ref().ok_or_else(not_open)?.plan.attachment_thumbnail(&id)?.unwrap_or_default()))
}

/// Store the thumbnail the webview made: raw body, header `x-attachment-id`.
#[tauri::command]
pub async fn attachment_set_thumbnail(state: State<'_, PlanState>, request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(StoreError::invalid("The thumbnail arrived in an unexpected form."));
    };
    let id = request
        .headers()
        .get("x-attachment-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| StoreError::invalid("The thumbnail has no photo id."))?
        .to_owned();
    let mut slot = state.open.lock().map_err(lock_err)?;
    slot.as_mut().ok_or_else(not_open)?.plan.attachment_set_thumbnail(&id, bytes)
}

#[tauri::command]
pub async fn attachment_delete(state: State<'_, PlanState>, id: String) -> Result<()> {
    let mut slot = state.open.lock().map_err(lock_err)?;
    slot.as_mut().ok_or_else(not_open)?.plan.attachment_delete(&id)
}
