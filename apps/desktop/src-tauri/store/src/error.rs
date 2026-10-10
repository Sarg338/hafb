//! One error type for every store operation. Serializes as `{ kind, message }` for the webview.

use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorKind {
    /// Another window or process holds the plan's exclusive lock.
    AlreadyOpen,
    /// The file was written by a newer version of the app.
    NewerVersion,
    /// The file is not a plan (not SQLite, or not ours, or missing).
    NotAPlan,
    /// The plan file failed SQLite's integrity check (S8.2): its backups can replace it.
    Damaged,
    /// The request was malformed (unknown table or column, a float, a missing plan row, ...).
    Invalid,
    /// No plan is open.
    NotOpen,
    Io,
    Sqlite,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoreError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// What a damaged plan says; the app offers to restore its newest good backup.
pub const DAMAGED: &str = "This plan file is damaged and can't be opened safely.";

impl StoreError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Invalid, message)
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        use rusqlite::ffi::ErrorCode;
        let kind = match e.sqlite_error_code() {
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => ErrorKind::AlreadyOpen,
            Some(ErrorCode::NotADatabase) => ErrorKind::NotAPlan,
            Some(ErrorCode::DatabaseCorrupt) => ErrorKind::Damaged,
            _ => ErrorKind::Sqlite,
        };
        let message = match kind {
            ErrorKind::AlreadyOpen => "This plan is already open in another window.".to_owned(),
            ErrorKind::NotAPlan => "This file is not a plan.".to_owned(),
            ErrorKind::Damaged => DAMAGED.to_owned(),
            _ => e.to_string(),
        };
        Self { kind, message }
    }
}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        Self::new(ErrorKind::Io, e.to_string())
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(e: serde_json::Error) -> Self {
        Self::invalid(format!("Malformed JSON: {e}"))
    }
}
