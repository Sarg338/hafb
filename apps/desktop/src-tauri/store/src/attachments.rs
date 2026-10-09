//! Transaction photos (S7.6, ADR 0009). They live inside the plan file (BLOBs in `attachments`), so
//! a plan is still one file: backups, Save a copy and restore carry them. One photo per
//! transaction, as in YNAB (attaching another replaces it). They aren't part of the snapshot or of
//! undo: YNAB confirms before deleting an image instead.

use crate::Plan;
use crate::error::{Result, StoreError};
use rusqlite::{OptionalExtension, params};
use serde::Serialize;

/// The largest photo accepted (a phone photo is 2–8 MB).
pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
/// The largest thumbnail accepted (the webview makes ~10 KB JPEGs).
pub const MAX_THUMBNAIL_BYTES: usize = 512 * 1024;

/// Image types a webview can show, by file extension.
pub const IMAGE_TYPES: &[(&str, &str)] = &[
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("jfif", "image/jpeg"),
    ("png", "image/png"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
];

/// The MIME type for a file name, if it is an image we take.
pub fn image_type(file_name: &str) -> Option<&'static str> {
    let ext = file_name.rsplit_once('.')?.1.to_ascii_lowercase();
    IMAGE_TYPES.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub id: String,
    pub transaction_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub created_at: String,
    pub has_thumbnail: bool,
}

impl Plan {
    /// Every photo's details (not the bytes), oldest first.
    pub fn attachments(&self) -> Result<Vec<AttachmentInfo>> {
        let mut stmt = self.connection().prepare(
            "SELECT id, transaction_id, file_name, mime_type, length(data), created_at, thumbnail IS NOT NULL FROM attachments ORDER BY created_at, id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(AttachmentInfo {
                id: r.get(0)?,
                transaction_id: r.get(1)?,
                file_name: r.get(2)?,
                mime_type: r.get(3)?,
                size_bytes: r.get(4)?,
                created_at: r.get(5)?,
                has_thumbnail: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Attach a photo to a transaction, replacing the one it had.
    pub fn attachment_add(&mut self, id: &str, transaction_id: &str, file_name: &str, data: &[u8], created_at: &str) -> Result<AttachmentInfo> {
        let mime = image_type(file_name).ok_or_else(|| StoreError::invalid("Attach a photo: a JPEG, PNG, GIF, WebP or BMP file."))?;
        if data.is_empty() {
            return Err(StoreError::invalid("That file is empty."));
        }
        if data.len() > MAX_ATTACHMENT_BYTES {
            return Err(StoreError::invalid(format!("That photo is too large ({} MB; up to 20 MB).", data.len() / 1_000_000)));
        }
        let tx = self.connection().unchecked_transaction()?;
        let exists: bool = tx.query_row("SELECT EXISTS (SELECT 1 FROM transactions WHERE id = ?1 AND deleted_at IS NULL)", params![transaction_id], |r| r.get(0))?;
        if !exists {
            return Err(StoreError::invalid("That transaction no longer exists."));
        }
        tx.execute("DELETE FROM attachments WHERE transaction_id = ?1", params![transaction_id])?;
        tx.execute(
            "INSERT INTO attachments (id, transaction_id, file_name, mime_type, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, transaction_id, file_name, mime, data, created_at],
        )?;
        tx.commit()?;
        Ok(AttachmentInfo {
            id: id.to_owned(),
            transaction_id: transaction_id.to_owned(),
            file_name: file_name.to_owned(),
            mime_type: mime.to_owned(),
            size_bytes: i64::try_from(data.len()).unwrap_or(i64::MAX),
            created_at: created_at.to_owned(),
            has_thumbnail: false,
        })
    }

    pub fn attachment_set_thumbnail(&mut self, id: &str, thumbnail: &[u8]) -> Result<()> {
        if thumbnail.is_empty() || thumbnail.len() > MAX_THUMBNAIL_BYTES {
            return Err(StoreError::invalid("The thumbnail is empty or too large."));
        }
        let n = self.connection().execute("UPDATE attachments SET thumbnail = ?2 WHERE id = ?1", params![id, thumbnail])?;
        if n == 0 { Err(not_found()) } else { Ok(()) }
    }

    /// The photo's bytes.
    pub fn attachment_data(&self, id: &str) -> Result<Vec<u8>> {
        self.connection()
            .query_row("SELECT data FROM attachments WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?
            .ok_or_else(not_found)
    }

    /// The thumbnail's bytes, if one was made.
    pub fn attachment_thumbnail(&self, id: &str) -> Result<Option<Vec<u8>>> {
        self.connection()
            .query_row("SELECT thumbnail FROM attachments WHERE id = ?1", params![id], |r| r.get::<_, Option<Vec<u8>>>(0))
            .optional()?
            .ok_or_else(not_found)
    }

    pub fn attachment_delete(&mut self, id: &str) -> Result<()> {
        let n = self.connection().execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
        if n == 0 { Err(not_found()) } else { Ok(()) }
    }
}

fn not_found() -> StoreError {
    StoreError::invalid("That photo is no longer attached.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_types_by_extension() {
        assert_eq!(image_type("receipt.JPG"), Some("image/jpeg"));
        assert_eq!(image_type("scan.png"), Some("image/png"));
        assert_eq!(image_type("notes.pdf"), None);
        assert_eq!(image_type("noext"), None);
    }
}
