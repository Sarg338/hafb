//! Backups (ADR 0002 §7): one folder per plan under the app's local data folder.
//!
//! File names inside a plan's folder:
//! - `open-<stamp>.hafb`: made on every open; the newest `keep` are kept (default `KEEP_BACKUPS`;
//!   a setting, S6.6).
//! - `manual-<stamp>.hafb`: made by Back up now (S6.6); the newest `keep` are kept.
//! - `restore-<stamp>.hafb`: the plan as it was just before a restore; newest `KEEP_BACKUPS` kept.
//! - `before-migration-v<N>-<stamp>.hafb`: made before upgrading a v<N> file; never pruned.

use crate::error::{Result, StoreError};
use crate::time::file_stamp;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const KEEP_BACKUPS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupKind {
    Open,
    Manual,
    Restore,
    BeforeMigration,
}

impl BackupKind {
    fn prefix(self) -> &'static str {
        match self {
            Self::Open => "open-",
            Self::Manual => "manual-",
            Self::Restore => "restore-",
            Self::BeforeMigration => "before-migration-",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    pub kind: BackupKind,
    /// The UTC stamp from the file name, `YYYYMMDD-HHMMSS-mmmZ`.
    pub stamp: String,
    pub size_bytes: u64,
}

/// FNV-1a, 32-bit: stable across Rust versions (unlike `DefaultHasher`), fine for a folder name.
fn fnv1a(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in bytes {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// `<root>/<stem>-<8 hex>`: the stem for people, the hash of the full path to keep two
/// `Budget.hafb` files in different folders apart. Windows paths compare case-insensitively.
pub fn plan_backup_dir(root: &Path, plan_path: &Path) -> PathBuf {
    let full = std::fs::canonicalize(plan_path).unwrap_or_else(|_| plan_path.to_path_buf());
    let key = full.to_string_lossy().to_lowercase();
    let stem: String = plan_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "plan".to_owned())
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .take(60)
        .collect();
    root.join(format!("{stem}-{:08x}", fnv1a(key.as_bytes())))
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(format!("{name}.hafb"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{name}-{n}.hafb")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// `VACUUM INTO` a consistent copy (works mid-WAL, keeps user_version and application_id).
pub fn vacuum_into(conn: &Connection, dest: &Path) -> Result<()> {
    let dest = dest
        .to_str()
        .ok_or_else(|| StoreError::invalid("Backup path is not valid Unicode"))?;
    conn.execute("VACUUM INTO ?1", [dest])?;
    Ok(())
}

/// Write a backup of `conn` into `dir` and keep the newest `keep` of that kind (before-migration
/// copies are never pruned). `migration_from` names before-migration copies.
pub fn make_backup(conn: &Connection, dir: &Path, kind: BackupKind, migration_from: Option<u32>, keep: usize) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let stamp = file_stamp(SystemTime::now());
    let name = match (kind, migration_from) {
        (BackupKind::BeforeMigration, Some(v)) => format!("before-migration-v{v}-{stamp}"),
        _ => format!("{}{stamp}", kind.prefix()),
    };
    let dest = unique_path(dir, &name);
    vacuum_into(conn, &dest)?;
    if kind != BackupKind::BeforeMigration {
        prune(dir, kind, keep.max(1))?;
    }
    Ok(dest)
}

fn kind_of(file_name: &str) -> Option<BackupKind> {
    [BackupKind::BeforeMigration, BackupKind::Restore, BackupKind::Open, BackupKind::Manual]
        .into_iter()
        .find(|k| file_name.starts_with(k.prefix()))
}

fn stamp_of(file_name: &str) -> String {
    // The stamp is the last `YYYYMMDD-HHMMSS-mmmZ` in the name.
    let stem = file_name.strip_suffix(".hafb").unwrap_or(file_name);
    stem.rfind('Z')
        .and_then(|i| stem.get(i.saturating_sub(19)..=i))
        .unwrap_or("")
        .to_owned()
}

/// Every backup in `dir`, newest first.
pub fn list_backups(dir: &Path) -> Result<Vec<BackupInfo>> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.into()),
    };
    for entry in entries {
        let entry = entry?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.ends_with(".hafb") {
            continue;
        }
        let Some(kind) = kind_of(&file_name) else { continue };
        out.push(BackupInfo {
            path: entry.path().to_string_lossy().into_owned(),
            stamp: stamp_of(&file_name),
            file_name,
            kind,
            size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| b.stamp.cmp(&a.stamp).then_with(|| b.file_name.cmp(&a.file_name)));
    Ok(out)
}

/// Keep the newest `keep` backups of `kind`; delete the rest.
pub fn prune(dir: &Path, kind: BackupKind, keep: usize) -> Result<()> {
    for old in list_backups(dir)?.into_iter().filter(|b| b.kind == kind).skip(keep) {
        std::fs::remove_file(&old.path)?;
    }
    Ok(())
}
