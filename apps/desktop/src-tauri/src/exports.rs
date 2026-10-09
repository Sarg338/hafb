//! Saving files the webview built (Reflect exports, chart images, plan exports). The webview sends
//! the bytes as the raw request body; Rust only asks where to save them and writes them there.

use hafb_store::error::{Result, StoreError};
use tauri::WebviewWindow;
use tauri::ipc::{InvokeBody, Request};

/// The kinds of file the app writes, by extension: (dialog filter label, extension).
const KINDS: &[(&str, &str)] = &[
    ("CSV file", "csv"),
    ("Tab-separated text", "tsv"),
    ("Zip archive", "zip"),
    ("PNG image", "png"),
    // Download Image (S7.6): a transaction photo, saved as it was attached.
    ("JPEG image", "jpg"),
    ("JPEG image", "jpeg"),
    ("JPEG image", "jfif"),
    ("GIF image", "gif"),
    ("WebP image", "webp"),
    ("Bitmap image", "bmp"),
];

/// Decode `%XX` escapes (the file name travels in a header, which must be ASCII).
pub fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A suggested file name without characters Windows refuses (`\ / : * ? " < > |`).
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.');
    if trimmed.is_empty() { "export".to_owned() } else { trimmed.to_owned() }
}

/// Native Save dialog for an export; writes the request body there. Returns the saved path, or
/// null if the user cancelled. Header `x-file-name`: the suggested name, percent-encoded.
#[tauri::command]
pub async fn save_export(window: WebviewWindow, request: Request<'_>) -> Result<Option<String>> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(StoreError::invalid("The export arrived in an unexpected form."));
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .map(|n| safe_file_name(&n))
        .ok_or_else(|| StoreError::invalid("The export has no file name."))?;
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let Some(&(label, ext)) = KINDS.iter().find(|(_, e)| *e == ext) else {
        return Err(StoreError::invalid(format!("Can't save a .{ext} file.")));
    };
    // The smoke suite sets HAFB_EXPORT_DIR to save without a native dialog it can't click.
    let picked = match std::env::var_os("HAFB_EXPORT_DIR").filter(|d| !d.is_empty()) {
        Some(dir) => Some(std::path::PathBuf::from(dir).join(&name)),
        None => rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Export")
            .set_file_name(&name)
            .add_filter(label, &[ext])
            .save_file(),
    };
    let Some(path) = picked else { return Ok(None) };
    let path = if path.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)) { path } else { path.with_extension(ext) };
    std::fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes_including_utf8() {
        assert_eq!(percent_decode("Caf%C3%A9%20Plan.csv").as_deref(), Some("Café Plan.csv"));
        assert_eq!(percent_decode("plain.zip").as_deref(), Some("plain.zip"));
        assert_eq!(percent_decode("bad%2"), None);
        assert_eq!(percent_decode("bad%zz"), None);
    }

    #[test]
    fn file_names_lose_reserved_characters() {
        assert_eq!(safe_file_name("A/B: Plan?.csv"), "A-B- Plan-.csv");
        assert_eq!(safe_file_name("  ..  "), "export");
    }
}
