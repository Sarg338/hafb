//! Plan passwords (S8.3b, ADR 0010). A locked plan is a SQLCipher 4 database with SQLCipher's
//! default settings (AES-256 per page with an HMAC, PBKDF2-HMAC-SHA512 at 256,000 iterations), so
//! DB Browser for SQLite's SQLCipher edition opens it with the password ("SQLCipher 4 defaults").
//! A plan without a password is a plain SQLite file, exactly as before.

use crate::error::{ErrorKind, Result, StoreError};
use crate::schema::{self, APPLICATION_ID};
use rusqlite::{Connection, OpenFlags};
use std::fmt;
use std::io::Read;
use std::path::Path;

/// Every plain SQLite file starts with this; a SQLCipher file starts with its random salt.
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

pub const NEEDS_PASSWORD: &str = "This plan is protected with a password.";
pub const WRONG_PASSWORD: &str = "That password isn't right.";
pub const MAX_PASSWORD_CHARS: usize = 256;

/// A plan password. Never printed: `Debug` hides it.
#[derive(Clone, PartialEq, Eq)]
pub struct Password(String);

impl Password {
    pub fn new(text: impl Into<String>) -> Result<Self> {
        let text = text.into();
        if text.is_empty() {
            return Err(StoreError::invalid("A password can't be empty."));
        }
        // Keeps it inside what Windows Credential Manager can remember (2,560 bytes).
        if text.chars().count() > MAX_PASSWORD_CHARS {
            return Err(StoreError::invalid(format!("A password can be at most {MAX_PASSWORD_CHARS} characters.")));
        }
        Ok(Self(text))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Password {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Password(…)")
    }
}

pub fn needs_password() -> StoreError {
    StoreError::new(ErrorKind::NeedsPassword, NEEDS_PASSWORD)
}

pub fn wrong_password() -> StoreError {
    StoreError::new(ErrorKind::WrongPassword, WRONG_PASSWORD)
}

/// Whether `path` looks locked: whole database pages (a size that is a multiple of 512 bytes, the
/// smallest page) without a plain SQLite header. Read from the header alone, so it is checked
/// before SQLite (and the integrity check) ever sees the file. Any other file without the header
/// (a text file, say) is simply not a plan.
pub fn is_locked(path: &Path) -> Result<bool> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    if len == 0 || len % 512 != 0 {
        return Ok(false);
    }
    let mut head = [0u8; 16];
    file.read_exact(&mut head)?;
    Ok(&head != SQLITE_HEADER)
}

/// Give a connection its password. It must come before anything reads the file.
pub(crate) fn apply_key(conn: &Connection, key: Option<&Password>) -> Result<()> {
    if let Some(key) = key {
        conn.pragma_update(None, "key", key.as_str())?;
    }
    Ok(())
}

/// What a failed first read of `path` means when it was opened with `key`.
pub(crate) fn read_error(e: StoreError, key: Option<&Password>) -> StoreError {
    match (e.kind, key) {
        (ErrorKind::NotAPlan, Some(_)) => wrong_password(),
        _ => e,
    }
}

/// Open an existing file (not a plan that is open in the app) with its password (`None` for a
/// plain file) and check it is a plan. `export` needs it writable: an attached file inherits the
/// connection's mode.
pub(crate) fn open_file(file: &Path, key: Option<&Password>, writable: bool) -> Result<Connection> {
    let mode = if writable { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY };
    let conn = Connection::open_with_flags(file, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    apply_key(&conn, key)?;
    let id = schema::application_id(&conn).map_err(|e| read_error(e, key))?;
    if id != APPLICATION_ID {
        return Err(StoreError::new(ErrorKind::NotAPlan, "This file is not a plan."));
    }
    Ok(conn)
}

/// Open `file` with whichever of `keys` opens it (none needed for a plain file), and say which.
/// Each try on a locked file costs one key derivation (~175 ms).
pub(crate) fn open_with_any(file: &Path, keys: &[&Password], writable: bool) -> Result<(Connection, Option<Password>)> {
    if !is_locked(file)? {
        return Ok((open_file(file, None, writable)?, None));
    }
    for key in keys {
        match open_file(file, Some(key), writable) {
            Ok(conn) => return Ok((conn, Some((*key).clone()))),
            Err(e) if e.kind == ErrorKind::WrongPassword => {}
            Err(e) => return Err(e),
        }
    }
    Err(if keys.is_empty() { needs_password() } else { wrong_password() })
}

/// The key among `keys` that opens `file`: `None` for a plain file.
pub fn find_key(file: &Path, keys: &[&Password]) -> Result<Option<Password>> {
    open_with_any(file, keys, false).map(|(_, key)| key)
}

/// Write everything in `conn` to a new file `dest` under `key` (`None` = plain), keeping the
/// header fields `sqlcipher_export` doesn't copy. `dest` must not exist.
pub(crate) fn export(conn: &Connection, dest: &Path, key: Option<&Password>) -> Result<()> {
    let dest = dest.to_str().ok_or_else(|| StoreError::invalid("The path is not valid Unicode"))?;
    let version = schema::user_version(conn)?;
    let id = schema::application_id(conn)?;
    // A plan's connection may not create files: an empty file is an empty database to attach.
    std::fs::File::create(dest)?;
    conn.execute("ATTACH DATABASE ?1 AS locking KEY ?2", [dest, key.map_or("", Password::as_str)])?;
    let done = (|| -> Result<()> {
        conn.query_row("SELECT sqlcipher_export('locking')", [], |_| Ok(()))?;
        conn.execute_batch(&format!("PRAGMA locking.user_version = {version}; PRAGMA locking.application_id = {id};"))?;
        Ok(())
    })();
    let detached = conn.execute_batch("DETACH DATABASE locking");
    done?;
    detached?;
    Ok(())
}

/// Check a file just written by `export`: it opens with `key`, is a plan, and passes the quick check.
pub(crate) fn verify(file: &Path, key: Option<&Password>) -> Result<()> {
    let conn = open_file(file, key, false)?;
    crate::check_integrity(&conn)
}
