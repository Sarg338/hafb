//! Migrations (append-only, CLAUDE.md §8) and the snapshot table set (ADR 0002 §3–4).

use crate::error::{ErrorKind, Result, StoreError};
use rusqlite::Connection;

/// Every migration, in order. `PRAGMA user_version` = how many have been applied.
/// Never edit a shipped entry; append a new file instead.
pub const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/0001_init.sql"),
    include_str!("../../migrations/0002_payee_hidden.sql"),
    include_str!("../../migrations/0003_import_matching.sql"),
    include_str!("../../migrations/0004_display_decimals.sql"),
    include_str!("../../migrations/0005_attachment_thumbnails.sql"),
    include_str!("../../migrations/0006_credit_card_interest.sql"),
];

/// Marks a SQLite file as a plan (`PRAGMA application_id`, header offset 68): ASCII "HAFB".
pub const APPLICATION_ID: i32 = 0x4841_4642;

/// Tables `load` returns and `apply` may write. Must equal `KEY_COLUMNS` in packages/store/src/codec.ts.
/// `attachments` (BLOBs) and `command_log` are deliberately absent.
pub const SNAPSHOT_TABLES: &[&str] = &[
    "plan",
    "accounts",
    "category_groups",
    "categories",
    "targets",
    "payees",
    "payee_rename_rules",
    "scheduled_transactions",
    "scheduled_subtransactions",
    "transactions",
    "subtransactions",
    "month_categories",
    "month_notes",
    "money_moves",
    "focused_views",
    "flag_names",
    "reconciliations",
    "rejected_imports",
    "import_profiles",
];

pub fn latest_version() -> u32 {
    u32::try_from(MIGRATIONS.len()).unwrap_or(u32::MAX)
}

pub fn user_version(conn: &Connection) -> Result<u32> {
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    u32::try_from(v).map_err(|_| StoreError::new(ErrorKind::NotAPlan, "This file has an invalid schema version."))
}

pub fn application_id(conn: &Connection) -> Result<i32> {
    Ok(conn.query_row("PRAGMA application_id", [], |r| r.get(0))?)
}

/// Refuse files from a newer app; report whether `migrations` would change the file.
pub fn check_version(found: u32, migrations: &[&str]) -> Result<()> {
    let latest = u32::try_from(migrations.len()).unwrap_or(u32::MAX);
    if found > latest {
        return Err(StoreError::new(
            ErrorKind::NewerVersion,
            format!(
                "This plan was saved by a newer version of the app (schema v{found}; this app reads up to v{latest}). Update the app to open it."
            ),
        ));
    }
    Ok(())
}

/// Apply every pending migration, each in its own transaction with foreign keys deferred.
/// Returns the version the file had before.
pub fn migrate(conn: &Connection, migrations: &[&str]) -> Result<u32> {
    let from = user_version(conn)?;
    check_version(from, migrations)?;
    for (i, sql) in migrations.iter().enumerate().skip(from as usize) {
        let to = i + 1;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let applied = (|| -> Result<()> {
            conn.execute_batch("PRAGMA defer_foreign_keys = ON")?;
            conn.execute_batch(sql)?;
            conn.execute_batch(&format!("PRAGMA user_version = {to}"))?;
            if to == 1 {
                conn.execute_batch(&format!("PRAGMA application_id = {APPLICATION_ID}"))?;
            }
            conn.execute_batch("COMMIT")?;
            Ok(())
        })();
        if let Err(e) = applied {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(StoreError::new(e.kind, format!("Migration {to} failed: {}", e.message)));
        }
    }
    Ok(from)
}
