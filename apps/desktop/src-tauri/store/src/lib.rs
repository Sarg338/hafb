//! Plan files (ADR 0002): migrations, the generic snapshot load / batched apply, backups, recent list.
//!
//! Generic on purpose: this crate knows table names, columns (from `PRAGMA table_info`) and primary
//! keys, never entities. Business rules live in TypeScript (`@hafb/store`, `@hafb/engine`).
//! No Tauri and no network: the CLI (`hafb-store`) and the app share this code.

pub mod backup;
pub mod error;
pub mod recent;
pub mod schema;
pub mod time;
pub mod backup_settings;
pub mod app_settings;
pub mod attachments;
pub mod lock;
pub mod wire;

use backup::{BackupInfo, BackupKind, make_backup};
use error::{ErrorKind, Result, StoreError};
pub use lock::Password;
use rusqlite::{Connection, OpenFlags, params_from_iter, types::Value as SqlValue};
use schema::{APPLICATION_ID, MIGRATIONS, SNAPSHOT_TABLES};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;
use wire::{LoadedTables, LogEntry, Row, RowChanges, TableData};

/// `command_log` keeps this many newest rows.
pub const KEEP_COMMAND_LOG: i64 = 2000;

#[derive(Debug, Clone, Default)]
pub struct OpenOptions {
    /// This plan's backup folder (see `backup::plan_backup_dir`). Pre-migration copies go here,
    /// or next to the plan when `None`.
    pub backup_dir: Option<PathBuf>,
    /// Make an `open-<stamp>` backup (needs `backup_dir`).
    pub backup_on_open: bool,
    /// How many open backups to keep (the user's setting, S6.6); `None` = `backup::KEEP_BACKUPS`.
    pub keep_backups: Option<usize>,
    /// The plan's password (S8.3b). Ignored for a plan that isn't locked.
    pub password: Option<Password>,
}

/// What opening did, for the UI ("Upgraded from v1; a copy was saved first").
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenReport {
    pub migrated_from: Option<u32>,
    pub backup_path: Option<String>,
    pub pre_migration_backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInfo {
    pub path: String,
    pub name: String,
    pub schema_version: u32,
    pub migrated_from: Option<u32>,
    pub backup_path: Option<String>,
    pub pre_migration_backup_path: Option<String>,
    /// Locked with a password (S8.3b).
    pub locked: bool,
}

/// What re-locking a plan's backups did (S8.3b).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelockReport {
    /// Backups rewritten under the new password (or without one).
    pub relocked: usize,
    /// Backups that were already that way.
    pub unchanged: usize,
    /// Backups none of the given passwords opened: they stay as they were.
    pub left: Vec<BackupInfo>,
}

struct TableColumns {
    all: HashSet<String>,
    keys: Vec<String>,
}

/// An open plan file. Holds the exclusive lock until dropped.
pub struct Plan {
    conn: Connection,
    path: PathBuf,
    tables: HashMap<&'static str, TableColumns>,
    /// The password the file is locked with; `None` for a plain file.
    key: Option<Password>,
}

fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn not_a_plan(message: &str) -> StoreError {
    StoreError::new(ErrorKind::NotAPlan, message)
}

/// Open an existing file read-write without creating it, and take the plan's exclusive lock.
/// Returns the password the file is locked with (`key` is ignored for a plain file).
fn connect(path: &Path, key: Option<&Password>) -> Result<(Connection, Option<Password>)> {
    if !path.is_file() {
        return Err(not_a_plan("The plan file was not found."));
    }
    // A locked file is recognized by its header first, so it is never mistaken for a damaged
    // one, and a wrong password never leads to backup recovery (S8.3b).
    let key = if lock::is_locked(path)? { Some(key.ok_or_else(lock::needs_password)?) } else { None };
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI;
    let conn = Connection::open_with_flags(path, flags)?;
    lock::apply_key(&conn, key)?;
    conn.busy_timeout(Duration::ZERO)?;
    // EXCLUSIVE before WAL: the WAL index then lives in heap memory (no -shm file), and the
    // locks are held for the connection's life, so a second window fails with AlreadyOpen.
    let _: String = conn.query_row("PRAGMA locking_mode = EXCLUSIVE", [], |r| r.get(0))?;
    // Read the header before changing anything, so a foreign SQLite file is left untouched.
    let app_id = schema::application_id(&conn).map_err(|e| lock::read_error(e, key))?;
    if app_id != APPLICATION_ID {
        return Err(not_a_plan("This file is not a plan."));
    }
    let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; BEGIN EXCLUSIVE; COMMIT;")?;
    Ok((conn, key.cloned()))
}

/// SQLite's quick check (structure, pages, constraints; ~35 ms for 20k transactions), so a damaged
/// file is caught on open instead of failing part-way through, and is never backed up over the
/// good backups (S8.2).
pub fn check_integrity(conn: &Connection) -> Result<()> {
    let first: String = conn.query_row("PRAGMA quick_check(1)", [], |r| r.get(0))?;
    if first == "ok" {
        Ok(())
    } else {
        Err(StoreError::new(ErrorKind::Damaged, error::DAMAGED))
    }
}

fn read_columns(conn: &Connection) -> Result<HashMap<&'static str, TableColumns>> {
    let mut out = HashMap::new();
    for &table in SNAPSHOT_TABLES {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", quote(table)))?;
        let mut cols: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(5)?)))?
            .collect::<std::result::Result<_, _>>()?;
        if cols.is_empty() {
            return Err(not_a_plan(&format!("This plan file is damaged: table {table} is missing.")));
        }
        let all = cols.iter().map(|(c, _)| c.clone()).collect();
        cols.retain(|(_, pk)| *pk > 0);
        cols.sort_by_key(|(_, pk)| *pk);
        out.insert(table, TableColumns { all, keys: cols.into_iter().map(|(c, _)| c).collect() });
    }
    Ok(out)
}

impl Plan {
    /// Open an existing plan: lock, refuse newer files, back up then migrate older ones, back up.
    pub fn open(path: &Path, options: &OpenOptions) -> Result<(Plan, OpenReport)> {
        Self::open_with(path, options, MIGRATIONS)
    }

    #[doc(hidden)]
    pub fn open_with(path: &Path, options: &OpenOptions, migrations: &[&str]) -> Result<(Plan, OpenReport)> {
        let (conn, key) = connect(path, options.password.as_ref())?;
        check_integrity(&conn)?;
        let mut report = OpenReport::default();
        let found = schema::user_version(&conn)?;
        schema::check_version(found, migrations)?;
        if (found as usize) < migrations.len() {
            if found > 0 {
                let dir = match &options.backup_dir {
                    Some(d) => d.clone(),
                    None => path.parent().map(Path::to_path_buf).unwrap_or_default(),
                };
                let copy = make_backup(&conn, &dir, BackupKind::BeforeMigration, Some(found), backup::KEEP_BACKUPS)?;
                report.pre_migration_backup_path = Some(copy.to_string_lossy().into_owned());
            }
            schema::migrate(&conn, migrations)?;
            report.migrated_from = Some(found);
        }
        let plan = Plan::from_conn(conn, path.to_path_buf(), key)?;
        plan.name()?; // a plan without its plan row is not a plan
        if options.backup_on_open {
            if let Some(dir) = &options.backup_dir {
                let copy = make_backup(&plan.conn, dir, BackupKind::Open, None, options.keep_backups.unwrap_or(backup::KEEP_BACKUPS))?;
                report.backup_path = Some(copy.to_string_lossy().into_owned());
            }
        }
        Ok((plan, report))
    }

    fn from_conn(conn: Connection, path: PathBuf, key: Option<Password>) -> Result<Plan> {
        conn.set_prepared_statement_cache_capacity(128);
        let tables = read_columns(&conn)?;
        Ok(Plan { conn, path, tables, key })
    }

    /// Write a new plan file from `changes` (which must include the `plan` row). The file is built
    /// under a temporary name and renamed into place, so a failure never leaves a half-written plan.
    pub fn create(path: &Path, changes: &RowChanges, replace_existing: bool) -> Result<()> {
        Self::create_with(path, changes, replace_existing, MIGRATIONS, None)
    }

    /// `create`, locked with `password` from the start (Fresh Start of a locked plan, S8.3b).
    pub fn create_locked(path: &Path, changes: &RowChanges, replace_existing: bool, password: &Password) -> Result<()> {
        Self::create_with(path, changes, replace_existing, MIGRATIONS, Some(password))
    }

    #[doc(hidden)]
    pub fn create_with(path: &Path, changes: &RowChanges, replace_existing: bool, migrations: &[&str], password: Option<&Password>) -> Result<()> {
        if path.exists() && !replace_existing {
            return Err(StoreError::invalid(format!("{} already exists.", path.display())));
        }
        let tmp = sibling(path, "creating");
        remove_with_sidecars(&tmp)?;
        let built = (|| -> Result<()> {
            let conn = Connection::open(&tmp)?;
            lock::apply_key(&conn, password)?;
            conn.execute_batch("PRAGMA foreign_keys = ON")?;
            schema::migrate(&conn, migrations)?;
            let mut plan = Plan::from_conn(conn, tmp.clone(), password.cloned())?;
            plan.apply(changes, None)?;
            plan.name()?;
            Ok(())
        })();
        if let Err(e) = built {
            let _ = remove_with_sidecars(&tmp);
            return Err(e);
        }
        if replace_existing {
            remove_sidecars(path)?;
        }
        // Rename replaces the old file in one step: there is never a moment without a plan file.
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> Result<u32> {
        schema::user_version(&self.conn)
    }

    pub fn name(&self) -> Result<String> {
        self.conn
            .query_row("SELECT name FROM plan WHERE id = 1", [], |r| r.get(0))
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => not_a_plan("This plan file is damaged: its plan row is missing."),
                other => other.into(),
            })
    }

    pub fn info(&self, report: &OpenReport) -> Result<PlanInfo> {
        Ok(PlanInfo {
            path: self.path.to_string_lossy().into_owned(),
            name: self.name()?,
            schema_version: self.schema_version()?,
            migrated_from: report.migrated_from,
            backup_path: report.backup_path.clone(),
            pre_migration_backup_path: report.pre_migration_backup_path.clone(),
            locked: self.key.is_some(),
        })
    }

    /// The password this plan is locked with, if any (S8.3b).
    pub fn password(&self) -> Option<&Password> {
        self.key.as_ref()
    }

    /// Lock the plan with `new`, change its password, or (`None`) remove it (S8.3b). The plan is
    /// written to a new file beside it, checked, and renamed over the old one, so a process killed
    /// at any point leaves the plan under one password or the other, never broken. On failure the
    /// plan stays open as it was.
    pub fn set_password(&mut self, new: Option<Password>) -> Result<()> {
        let tmp = sibling(&self.path, "locking");
        remove_with_sidecars(&tmp)?;
        if let Err(e) = lock::export(&self.conn, &tmp, new.as_ref()).and_then(|()| lock::verify(&tmp, new.as_ref())) {
            let _ = remove_with_sidecars(&tmp);
            return Err(e);
        }
        // Close the plan (checkpointing its WAL), put the new file in its place, and reopen.
        let old_key = self.key.clone();
        let closed = std::mem::replace(&mut self.conn, Connection::open_in_memory()?);
        drop(closed);
        let swapped = remove_sidecars(&self.path).and_then(|()| std::fs::rename(&tmp, &self.path).map_err(StoreError::from));
        let key = if swapped.is_ok() { new } else { old_key };
        let (conn, key) = connect(&self.path, key.as_ref())?;
        *self = Plan::from_conn(conn, self.path.clone(), key)?;
        if swapped.is_err() {
            let _ = remove_with_sidecars(&tmp);
        }
        swapped
    }

    /// Every snapshot table, positional (ADR 0002 §4).
    pub fn load(&self) -> Result<LoadedTables> {
        let mut out = LoadedTables::new();
        for &table in SNAPSHOT_TABLES {
            // Key order: the UI keeps collections sorted by key, and sorting sorted rows is cheap.
            let order = self.tables.get(table).map(|t| t.keys.iter().map(|k| quote(k)).collect::<Vec<_>>().join(", ")).unwrap_or_default();
            let sql = if order.is_empty() { format!("SELECT * FROM {}", quote(table)) } else { format!("SELECT * FROM {} ORDER BY {order}", quote(table)) };
            let mut stmt = self.conn.prepare_cached(&sql)?;
            let columns: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
            let n = columns.len();
            let mut rows = Vec::new();
            let mut cursor = stmt.query([])?;
            while let Some(r) = cursor.next()? {
                let mut row = Vec::with_capacity(n);
                for (i, column) in columns.iter().enumerate() {
                    row.push(wire::from_sql(table, column, r.get_ref(i)?)?);
                }
                rows.push(row);
            }
            out.insert(table.to_owned(), TableData { columns, rows });
        }
        Ok(out)
    }

    /// `load()` as JSON text, ready to hand to the webview without another conversion.
    pub fn load_json(&self) -> Result<String> {
        serde_json::to_string(&self.load()?).map_err(|e| StoreError::new(ErrorKind::Io, e.to_string()))
    }

    fn table(&self, table: &str) -> Result<(&'static str, &TableColumns)> {
        self.tables
            .get_key_value(table)
            .map(|(k, v)| (*k, v))
            .ok_or_else(|| StoreError::invalid(format!("Unknown or protected table {table:?}")))
    }

    /// Apply a batch in one transaction: upserts, deletes, split check, optional log row, commit.
    pub fn apply(&mut self, changes: &RowChanges, log: Option<&LogEntry>) -> Result<()> {
        self.conn.execute_batch("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON;")?;
        match self.apply_in_transaction(changes, log).and_then(|()| self.commit()) {
            Ok(()) => Ok(()),
            Err(e) => {
                if !self.conn.is_autocommit() {
                    let _ = self.conn.execute_batch("ROLLBACK");
                }
                Err(e)
            }
        }
    }

    fn apply_in_transaction(&self, changes: &RowChanges, log: Option<&LogEntry>) -> Result<()> {
        for batch in &changes.upserts {
            let (table, cols) = self.table(&batch.table)?;
            // Rows in a batch usually share a column list: build the SQL once per distinct list.
            let mut last: Option<(Vec<&String>, String)> = None;
            for row in &batch.rows {
                let names: Vec<&String> = row.keys().collect();
                if last.as_ref().is_none_or(|(n, _)| *n != names) {
                    let sql = Self::upsert_sql(table, cols, row)?;
                    last = Some((names, sql));
                }
                if let Some((_, sql)) = &last {
                    let values: Vec<SqlValue> = row.iter().map(|(c, v)| wire::to_sql(table, c, v)).collect::<Result<_>>()?;
                    self.conn.prepare_cached(sql)?.execute(params_from_iter(values))?;
                }
            }
        }
        for batch in &changes.deletes {
            let (table, cols) = self.table(&batch.table)?;
            for key in &batch.keys {
                self.delete(table, cols, key)?;
            }
        }
        let bad: Vec<(String, String)> = self
            .conn
            .prepare_cached("SELECT transaction_id, kind FROM split_violations LIMIT 5")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        if !bad.is_empty() {
            let list: Vec<String> = bad.iter().map(|(id, kind)| format!("{kind} {id}")).collect();
            return Err(StoreError::invalid(format!(
                "Split invariant violated (lines must add up to the parent, which has no category): {}",
                list.join(", ")
            )));
        }
        if let Some(entry) = log {
            self.conn
                .prepare_cached(
                    "INSERT INTO command_log (session_id, created_at, direction, label, forward, inverse) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )?
                .execute(rusqlite::params![
                    entry.session_id,
                    entry.created_at,
                    entry.direction,
                    entry.label,
                    serde_json::to_string(&entry.forward)?,
                    serde_json::to_string(&entry.inverse)?,
                ])?;
            self.conn
                .prepare_cached("DELETE FROM command_log WHERE seq <= (SELECT MAX(seq) FROM command_log) - ?1")?
                .execute([KEEP_COMMAND_LOG])?;
        }
        Ok(())
    }

    fn commit(&self) -> Result<()> {
        match self.conn.execute_batch("COMMIT") {
            Ok(()) => Ok(()),
            Err(e) if e.sqlite_error_code() == Some(rusqlite::ffi::ErrorCode::ConstraintViolation) => {
                // Deferred foreign keys failed; the transaction is still open, so say which ones.
                let found: Vec<String> = self
                    .conn
                    .prepare("PRAGMA foreign_key_check")?
                    .query_map([], |r| Ok(format!("{} row {} -> {}", r.get::<_, String>(0)?, r.get::<_, i64>(1).unwrap_or(-1), r.get::<_, String>(2)?)))?
                    .take(5)
                    .collect::<std::result::Result<_, _>>()?;
                Err(StoreError::invalid(format!("Foreign key violation: {}", found.join(", "))))
            }
            Err(e) => Err(e.into()),
        }
    }

    /// `INSERT … ON CONFLICT (pk) DO UPDATE SET …` for this row's columns, after validating them.
    fn upsert_sql(table: &str, cols: &TableColumns, row: &Row) -> Result<String> {
        if row.is_empty() {
            return Err(StoreError::invalid(format!("Empty row for {table}")));
        }
        for c in row.keys() {
            if !cols.all.contains(c) {
                return Err(StoreError::invalid(format!("Unknown column {table}.{c}")));
            }
        }
        for k in &cols.keys {
            if !row.contains_key(k) {
                return Err(StoreError::invalid(format!("Row for {table} is missing key column {k}")));
            }
        }
        let names: Vec<&String> = row.keys().collect();
        let updates: Vec<String> = names
            .iter()
            .filter(|c| !cols.keys.contains(c))
            .map(|c| format!("{0} = excluded.{0}", quote(c)))
            .collect();
        Ok(format!(
            "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) DO {}",
            quote(table),
            names.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", "),
            vec!["?"; names.len()].join(", "),
            cols.keys.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", "),
            if updates.is_empty() { "NOTHING".to_owned() } else { format!("UPDATE SET {}", updates.join(", ")) },
        ))
    }

    fn delete(&self, table: &str, cols: &TableColumns, key: &Row) -> Result<()> {
        if key.len() != cols.keys.len() || cols.keys.iter().any(|k| !key.contains_key(k)) {
            return Err(StoreError::invalid(format!(
                "A delete key for {table} must be exactly ({})",
                cols.keys.join(", ")
            )));
        }
        let sql = format!(
            "DELETE FROM {} WHERE {}",
            quote(table),
            cols.keys.iter().map(|k| format!("{} = ?", quote(k))).collect::<Vec<_>>().join(" AND ")
        );
        let values: Vec<SqlValue> = cols
            .keys
            .iter()
            .map(|k| wire::to_sql(table, k, &key[k]))
            .collect::<Result<_>>()?;
        self.conn.prepare_cached(&sql)?.execute(params_from_iter(values))?;
        Ok(())
    }

    /// "Save a copy": a consistent snapshot at `dest`, replacing it atomically if it exists.
    pub fn save_copy(&self, dest: &Path) -> Result<()> {
        if same_file(dest, &self.path) {
            return Err(StoreError::invalid("Choose a different file than the open plan."));
        }
        let tmp = sibling(dest, "copying");
        remove_with_sidecars(&tmp)?;
        if let Err(e) = backup::vacuum_into(&self.conn, &tmp) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        std::fs::rename(&tmp, dest)?;
        Ok(())
    }

    /// Back up this plan, then replace it with `backup_file` and reopen it (migrating if older).
    /// Returns the reopened plan and the path of the `restore-` copy of what was replaced.
    /// Restoring keeps the plan's current password (S8.3b): a backup made under another password,
    /// or none, is rewritten under it. `backup_password` is for a backup under another password.
    pub fn restore(self, backup_file: &Path, backup_dir: &Path, backup_password: Option<&Password>) -> Result<(Plan, OpenReport, PathBuf)> {
        let keys: Vec<&Password> = backup_password.into_iter().chain(self.key.as_ref()).collect();
        let found = check_restorable(backup_file, &keys)?;
        let saved = make_backup(&self.conn, backup_dir, BackupKind::Restore, None, backup::KEEP_BACKUPS)?;
        let path = self.path.clone();
        let key = self.key.clone();
        drop(self);
        install_copy(backup_file, found.as_ref(), &path, key.as_ref(), "restoring")?;
        let options = OpenOptions { backup_dir: Some(backup_dir.to_path_buf()), password: key, ..OpenOptions::default() };
        let (plan, report) = Plan::open(&path, &options)?;
        Ok((plan, report, saved))
    }

    /// Replace a damaged plan at `path` with its newest good backup in `backup_dir`, and open it
    /// (S8.2). The damaged file is copied into `backup_dir` as `damaged-<stamp>.hafb` first (its
    /// `-wal` too), so nothing is thrown away. Returns the plan, the backup used and the copy.
    /// `password` is the damaged plan's: the recovered plan keeps it (S8.3b).
    pub fn recover(path: &Path, backup_dir: &Path, password: Option<&Password>) -> Result<(Plan, OpenReport, BackupInfo, PathBuf)> {
        let keys: Vec<&Password> = password.into_iter().collect();
        let backup = newest_good_backup(backup_dir, &keys)?.ok_or_else(|| {
            StoreError::new(ErrorKind::Damaged, "This plan file is damaged and there is no good backup of it to restore.")
        })?;
        let found = check_restorable(Path::new(&backup.path), &keys)?;
        std::fs::create_dir_all(backup_dir)?;
        let stamp = time::file_stamp(std::time::SystemTime::now());
        let kept = backup_dir.join(format!("damaged-{stamp}.hafb"));
        if path.is_file() {
            std::fs::copy(path, &kept)?;
            let mut wal = path.as_os_str().to_owned();
            wal.push("-wal");
            let wal = PathBuf::from(wal);
            if wal.is_file() {
                let mut kept_wal = kept.as_os_str().to_owned();
                kept_wal.push("-wal");
                std::fs::copy(&wal, PathBuf::from(kept_wal))?;
            }
        }
        install_copy(Path::new(&backup.path), found.as_ref(), path, password, "recovering")?;
        let options = OpenOptions { backup_dir: Some(backup_dir.to_path_buf()), password: password.cloned(), ..OpenOptions::default() };
        let (plan, report) = Plan::open(path, &options)?;
        Ok((plan, report, backup, kept))
    }

    /// The backup on open (`open-<stamp>`), for an app that opened with `backup_on_open: false`
    /// so the file could be read first (S8.1). Make it before the first write.
    pub fn backup_open(&self, dir: &Path, keep: usize) -> Result<PathBuf> {
        make_backup(&self.conn, dir, BackupKind::Open, None, keep)
    }

    /// Back up now (S6.6): a `manual-<stamp>` copy in `dir`, keeping the newest `keep`.
    pub fn backup_now(&self, dir: &Path, keep: usize) -> Result<PathBuf> {
        make_backup(&self.conn, dir, BackupKind::Manual, None, keep)
    }

    #[doc(hidden)]
    pub fn connection(&self) -> &Connection {
        &self.conn
    }
}

/// The newest backup in `dir` that passes the integrity check and this app can read (S8.2), with
/// one of `keys` if it is locked (S8.3b).
pub fn newest_good_backup(dir: &Path, keys: &[&Password]) -> Result<Option<BackupInfo>> {
    Ok(backup::list_backups(dir)?.into_iter().find(|b| check_restorable(Path::new(&b.path), keys).is_ok()))
}

/// A backup is restorable when it is one of our files at a version this app can read, and opens
/// with one of `keys` if it is locked. Returns the key it needs.
pub fn check_restorable(file: &Path, keys: &[&Password]) -> Result<Option<Password>> {
    if !file.is_file() {
        return Err(not_a_plan("The backup file was not found."));
    }
    let (conn, key) = lock::open_with_any(file, keys, false).map_err(|e| match e.kind {
        ErrorKind::NotAPlan => not_a_plan("The backup is not a plan file."),
        _ => e,
    })?;
    check_integrity(&conn).map_err(|_| StoreError::new(ErrorKind::Damaged, "That backup is damaged too; choose another."))?;
    schema::check_version(schema::user_version(&conn)?, MIGRATIONS)?;
    Ok(key)
}

/// Rewrite this plan's backups in `dir` under `to` (`None` = no password), so they need the same
/// password as the plan (S8.3b). A backup is opened with one of `from` (a plain one needs none);
/// each is written beside itself as `*.hafb.partial` (which the list ignores), checked, then
/// renamed over the old one, so a killed process leaves every backup under one password or the
/// other. Backups none of `from` opens, or that fail, are left as they were and reported.
pub fn relock_backups(dir: &Path, from: &[&Password], to: Option<&Password>) -> Result<RelockReport> {
    let mut report = RelockReport::default();
    let keys: Vec<&Password> = from.iter().copied().chain(to).collect();
    for b in backup::list_backups(dir)? {
        let file = PathBuf::from(&b.path);
        let rewritten = (|| -> Result<bool> {
            let (conn, key) = lock::open_with_any(&file, &keys, true)?;
            if key.as_ref() == to {
                return Ok(false);
            }
            let partial = file.with_extension("hafb.partial");
            remove_file_if_present(&partial)?;
            let written = lock::export(&conn, &partial, to).and_then(|()| {
                drop(conn);
                lock::verify(&partial, to)
            });
            if let Err(e) = written.and_then(|()| std::fs::rename(&partial, &file).map_err(StoreError::from)) {
                let _ = std::fs::remove_file(&partial);
                return Err(e);
            }
            Ok(true)
        })();
        match rewritten {
            Ok(true) => report.relocked += 1,
            Ok(false) => report.unchanged += 1,
            Err(_) => report.left.push(b),
        }
    }
    Ok(report)
}

/// Put a copy of `src` (opened with `src_key`) at `path`, under `key`, replacing what is there in
/// one rename. Same password both sides: a byte copy; otherwise the file is rewritten.
fn install_copy(src: &Path, src_key: Option<&Password>, path: &Path, key: Option<&Password>, what: &str) -> Result<()> {
    let tmp = sibling(path, what);
    remove_with_sidecars(&tmp)?;
    let written = if src_key == key {
        std::fs::copy(src, &tmp).map(|_| ()).map_err(StoreError::from)
    } else {
        lock::open_file(src, src_key, true).and_then(|conn| lock::export(&conn, &tmp, key))
    };
    if let Err(e) = written {
        let _ = remove_with_sidecars(&tmp);
        return Err(e);
    }
    // A stale -wal beside the replaced file would be replayed onto the new one. The plan file
    // itself is replaced by the rename, so it never goes missing (S8.2).
    remove_sidecars(path)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn sibling(path: &Path, what: &str) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.{what}"))
}

fn remove_with_sidecars(path: &Path) -> Result<()> {
    remove_file_if_present(path)?;
    remove_sidecars(path)
}

/// SQLite's files beside `path` (not `path` itself).
fn remove_sidecars(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut p = path.as_os_str().to_owned();
        p.push(suffix);
        remove_file_if_present(&PathBuf::from(p))?;
    }
    Ok(())
}

fn remove_file_if_present(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a.as_os_str().eq_ignore_ascii_case(b.as_os_str()),
    }
}
