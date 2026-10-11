//! Reliability and data safety (roadmap S8.2): upgrades from every older schema, a damaged file
//! refused and recovered from its newest good backup, backups cut short, the app killed mid-write,
//! and backup-restore drills.

use hafb_store::backup::{self, BackupKind};
use hafb_store::error::ErrorKind;
use hafb_store::schema::MIGRATIONS;
use hafb_store::wire::{LoadedTables, Row, RowChanges, TableRows};
use hafb_store::{OpenOptions, Plan, newest_good_backup};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::time::Duration;

const SAMPLE_CHANGES: &str = include_str!("fixtures/sample-changes.json");

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!("hafb-safety-{}-{}-{name}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
    fn join(&self, p: &str) -> PathBuf {
        self.0.join(p)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn sample() -> RowChanges {
    serde_json::from_str(SAMPLE_CHANGES).unwrap()
}

fn no_backups() -> OpenOptions {
    OpenOptions::default()
}

fn with_backups(dir: &Path) -> OpenOptions {
    OpenOptions { backup_dir: Some(dir.to_path_buf()), backup_on_open: true, keep_backups: None, password: None }
}

fn row(v: Value) -> Row {
    match v {
        Value::Object(m) => m,
        _ => panic!("not an object"),
    }
}

/// A transaction row in the sample's checking account.
fn transaction(id: &str, amount: i64, memo: &str) -> Value {
    json!({
        "id": id, "account_id": "a-chk", "date": "2026-10-05", "amount": amount, "payee_id": "p-store",
        "category_id": "c-food", "memo": memo, "cleared": "cleared", "approved": 1, "flag": null,
        "transfer_account_id": null, "transfer_transaction_id": null, "scheduled_transaction_id": null,
        "is_starting_balance": 0, "import_id": null, "imported_payee": null, "imported_memo": null,
        "created_at": "2026-10-08T12:00:00.000Z", "deleted_at": null,
    })
}

fn upsert(table: &str, rows: Vec<Value>) -> RowChanges {
    RowChanges { upserts: vec![TableRows { table: table.into(), rows: rows.into_iter().map(row).collect() }], deletes: vec![] }
}

/// The sample plus `n` transactions, so the file spans many pages.
fn create_big(dir: &TempDir, n: usize) -> PathBuf {
    let path = dir.join("Plan.hafb");
    Plan::create(&path, &sample(), false).unwrap();
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let rows = (0..n).map(|i| transaction(&format!("bulk-{i:05}"), -(i64::try_from(i).unwrap() + 1), &format!("memo {i}"))).collect();
    plan.apply(&upsert("transactions", rows), None).unwrap();
    path
}

fn column_info(conn: &Connection, table: &str) -> Vec<(String, Option<String>)> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{table}\")")).unwrap();
    stmt.query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, Option<String>>(4)?))).unwrap().collect::<Result<_, _>>().unwrap()
}

/// The schema after the first `version` migrations: table → columns (with SQL defaults).
fn schema_at(version: usize) -> HashMap<String, Vec<(String, Option<String>)>> {
    let conn = Connection::open_in_memory().unwrap();
    for m in &MIGRATIONS[..version] {
        conn.execute_batch(m).unwrap();
    }
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    tables.into_iter().map(|t| (t.clone(), column_info(&conn, &t))).collect()
}

/// The sample cut down to what a file at `version` could hold.
fn sample_at(version: usize) -> RowChanges {
    let schema = schema_at(version);
    let mut changes = sample();
    changes.upserts.retain(|b| schema.contains_key(&b.table));
    for batch in &mut changes.upserts {
        let cols: HashSet<&str> = schema[&batch.table].iter().map(|(c, _)| c.as_str()).collect();
        for r in &mut batch.rows {
            r.retain(|c, _| cols.contains(c.as_str()));
        }
    }
    changes
}

/// A SQL column default as the loaded JSON value (NULL when there is none).
fn default_value(sql: Option<&str>) -> Value {
    match sql {
        None | Some("NULL") => Value::Null,
        Some(s) => s.parse::<i64>().map(Value::from).unwrap_or_else(|_| Value::from(s.trim_matches('\'').to_owned())),
    }
}

// ---- upgrades ------------------------------------------------------------------------------------

#[test]
fn every_older_schema_upgrades_keeping_every_value() {
    let dir = TempDir::new("upgrade");
    let latest_path = dir.join("Latest.hafb");
    Plan::create(&latest_path, &sample(), false).unwrap();
    let reference = Plan::open(&latest_path, &no_backups()).unwrap().0.load().unwrap();
    let latest_schema = schema_at(MIGRATIONS.len());

    for version in 1..MIGRATIONS.len() {
        let path = dir.join(&format!("v{version}.hafb"));
        let backups = dir.join(&format!("backups-v{version}"));
        Plan::create_with(&path, &sample_at(version), false, &MIGRATIONS[..version], None).unwrap();
        let (plan, report) = Plan::open(&path, &with_backups(&backups)).unwrap();
        assert_eq!(report.migrated_from, Some(u32::try_from(version).unwrap()), "v{version}");
        let kept = report.pre_migration_backup_path.expect("a copy before migrating");
        assert!(Path::new(&kept).is_file(), "v{version}: {kept}");
        let got = plan.load().unwrap();
        drop(plan);

        // Migrations so far only add columns and system rows, so every table exists in every version.
        let old = schema_at(version);
        for (table, want) in &reference {
            let have = &got[table];
            assert_eq!(have.columns, want.columns, "v{version} {table} columns");
            assert_eq!(have.rows.len(), want.rows.len(), "v{version} {table} rows");
            let old_cols: HashSet<&str> = old[table].iter().map(|(n, _)| n.as_str()).collect();
            let defaults: HashMap<&str, Option<&str>> = latest_schema[table].iter().map(|(n, d)| (n.as_str(), d.as_deref())).collect();
            for (h, w) in have.rows.iter().zip(&want.rows) {
                for (i, col) in want.columns.iter().enumerate() {
                    // What the old file held comes through unchanged; new columns take their default.
                    let expected = if old_cols.contains(col.as_str()) { w[i].clone() } else { default_value(defaults[col.as_str()]) };
                    assert_eq!(h[i], expected, "v{version} {table}.{col}");
                }
            }
        }
        // The pre-migration copy is the untouched old file.
        let (copy, _) = Plan::open_with(Path::new(&kept), &no_backups(), &MIGRATIONS[..version]).unwrap();
        assert_eq!(copy.schema_version().unwrap(), u32::try_from(version).unwrap());
    }
}

// ---- damaged files -------------------------------------------------------------------------------

/// Break the root page of `transactions` (an invalid page type), as a bad sector or a torn copy
/// would. The file header stays readable, so it still looks like a plan.
fn damage(path: &Path) {
    let (page_size, root): (i64, i64) = {
        let conn = Connection::open(path).unwrap();
        let ps = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
        let root = conn.query_row("SELECT rootpage FROM sqlite_master WHERE name = 'transactions'", [], |r| r.get(0)).unwrap();
        (ps, root)
    };
    let mut bytes = std::fs::read(path).unwrap();
    let at = usize::try_from((root - 1) * page_size).unwrap() + if root == 1 { 100 } else { 0 };
    bytes[at] = 0x00;
    bytes[at + 1..at + 8].fill(0xFF);
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn a_damaged_plan_is_refused_untouched_and_recovered_from_its_newest_good_backup() {
    let dir = TempDir::new("damaged");
    let backups = dir.join("backups");
    let path = create_big(&dir, 3000);
    // Two opens: two backups, the second one with an extra edit in it.
    drop(Plan::open(&path, &with_backups(&backups)).unwrap());
    std::thread::sleep(Duration::from_millis(5));
    {
        let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
        plan.apply(&upsert("transactions", vec![transaction("late", -999, "after the first backup")]), None).unwrap();
    }
    drop(Plan::open(&path, &with_backups(&backups)).unwrap());
    let expected = Plan::open(&path, &no_backups()).unwrap().0.load().unwrap();
    let list = backup::list_backups(&backups).unwrap();
    assert_eq!(list.len(), 2);

    damage(&path);
    let before = std::fs::read(&path).unwrap();
    let e = Plan::open(&path, &with_backups(&backups)).err().expect("a damaged plan must not open");
    assert_eq!(e.kind, ErrorKind::Damaged, "{e}");
    assert_eq!(std::fs::read(&path).unwrap(), before, "the damaged file is left as it was");
    assert_eq!(backup::list_backups(&backups).unwrap().len(), 2, "no backup of a damaged file");

    // A damaged backup is skipped: damage the newest, and the older one is offered.
    let newest = PathBuf::from(&list[0].path);
    let newest_bytes = std::fs::read(&newest).unwrap();
    damage(&newest);
    assert_eq!(newest_good_backup(&backups, &[]).unwrap().unwrap().path, list[1].path);
    std::fs::write(&newest, newest_bytes).unwrap();
    assert_eq!(newest_good_backup(&backups, &[]).unwrap().unwrap().path, list[0].path);

    let (plan, _, used, kept) = Plan::recover(&path, &backups, None).unwrap();
    assert_eq!(used.path, list[0].path);
    assert_eq!(plan.load().unwrap(), expected);
    assert_eq!(std::fs::read(&kept).unwrap(), before, "the damaged file is kept");
    assert!(kept.starts_with(&backups));
    assert!(backup::list_backups(&backups).unwrap().iter().all(|b| b.path != kept.to_string_lossy()), "not offered as a backup");
}

#[test]
fn with_no_good_backup_recovery_says_so_and_changes_nothing() {
    let dir = TempDir::new("nobackup");
    let backups = dir.join("backups");
    let path = create_big(&dir, 2000);
    damage(&path);
    let before = std::fs::read(&path).unwrap();
    let e = Plan::recover(&path, &backups, None).err().expect("nothing to recover from");
    assert_eq!(e.kind, ErrorKind::Damaged);
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

// ---- backups -------------------------------------------------------------------------------------

#[test]
fn a_backup_cut_short_is_never_listed_and_is_cleared_by_the_next_backup() {
    let dir = TempDir::new("partial");
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    let path = create_big(&dir, 10);
    let partial = backups.join("open-20260101-000000-000Z.hafb.partial");
    std::fs::write(&partial, b"half a backup").unwrap();
    assert!(backup::list_backups(&backups).unwrap().is_empty());
    let (plan, _) = Plan::open(&path, &no_backups()).unwrap();
    plan.backup_now(&backups, 5).unwrap();
    assert!(!partial.exists());
    let list = backup::list_backups(&backups).unwrap();
    assert_eq!(list.len(), 1);
    assert!(newest_good_backup(&backups, &[]).unwrap().is_some());
}

#[test]
fn backup_restore_drill_every_backup_restores_exactly_what_it_saved() {
    let dir = TempDir::new("drill");
    let backups = dir.join("backups");
    let path = create_big(&dir, 500);
    let mut saved: BTreeMap<String, LoadedTables> = BTreeMap::new();
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    for round in 0..5_i64 {
        plan.apply(
            &RowChanges {
                upserts: vec![
                    TableRows { table: "transactions".into(), rows: vec![row(transaction(&format!("drill-{round}"), -100 * (round + 1), "drill"))] },
                    TableRows { table: "month_categories".into(), rows: vec![row(json!({"month": "2026-10", "category_id": "c-food", "assigned": 1000 * (round + 1)}))] },
                ],
                deletes: vec![],
            },
            None,
        )
        .unwrap();
        let copy = plan.backup_now(&backups, 10).unwrap();
        saved.insert(copy.to_string_lossy().into_owned(), plan.load().unwrap());
        std::thread::sleep(Duration::from_millis(5));
    }
    // Restore each, oldest first; each restore keeps the replaced plan as a restore- backup.
    for (copy, want) in &saved {
        let (restored, _, _) = plan.restore(Path::new(copy), &backups, None).unwrap();
        assert_eq!(&restored.load().unwrap(), want, "{copy}");
        plan = restored;
    }
    drop(plan);
    let kinds: Vec<BackupKind> = backup::list_backups(&backups).unwrap().iter().map(|b| b.kind).collect();
    assert_eq!(kinds.iter().filter(|k| **k == BackupKind::Restore).count(), 5);
    assert_eq!(Plan::open(&path, &no_backups()).unwrap().0.load().unwrap(), saved.values().last().cloned().unwrap());
}

// ---- the app killed mid-write --------------------------------------------------------------------

/// A month no sample row uses: the crash writer assigns its last batch number + 1 there (an
/// assignment is never 0).
const CRASH_MONTH: &str = "2030-01";

fn crash_assignment(tables: &LoadedTables) -> Option<i64> {
    let mc = &tables["month_categories"];
    let col = |name: &str| mc.columns.iter().position(|c| c == name).unwrap();
    let (month, cat, assigned) = (col("month"), col("category_id"), col("assigned"));
    mc.rows.iter().find(|r| r[month] == json!(CRASH_MONTH) && r[cat] == json!("c-rent")).and_then(|r| r[assigned].as_i64()).map(|a| a - 1)
}

/// Not a test on its own: the writer that `killing_the_writer_never_loses_a_committed_change`
/// starts as a child process and kills. Each batch adds three transactions and sets one
/// assignment to the batch number, then prints the number once committed.
#[test]
#[ignore = "child process for the crash test"]
fn crash_writer_child() {
    let Ok(path) = std::env::var("HAFB_CRASH_PLAN") else { return };
    let (mut plan, _) = Plan::open(Path::new(&path), &no_backups()).unwrap();
    let start = crash_assignment(&plan.load().unwrap()).map_or(0, |n| n + 1);
    let mut out = std::io::stdout();
    // The parent kills it long before this many.
    for batch in start..start + 1_000_000 {
        let rows: Vec<Value> = (0..3).map(|k| transaction(&format!("crash-{batch:06}-{k}"), -1, &"x".repeat(200))).collect();
        let changes = RowChanges {
            upserts: vec![
                TableRows { table: "transactions".into(), rows: rows.into_iter().map(row).collect() },
                TableRows { table: "month_categories".into(), rows: vec![row(json!({"month": CRASH_MONTH, "category_id": "c-rent", "assigned": batch + 1}))] },
            ],
            deletes: vec![],
        };
        plan.apply(&changes, None).unwrap();
        writeln!(out, "committed {batch}").unwrap();
        out.flush().unwrap();
    }
}

#[test]
fn killing_the_writer_never_loses_a_committed_change() {
    let dir = TempDir::new("crash");
    let path = dir.join("Crash.hafb");
    Plan::create(&path, &sample(), false).unwrap();
    let exe = std::env::current_exe().unwrap();

    for round in 0..6_u64 {
        let mut child = Command::new(&exe)
            .args(["--exact", "crash_writer_child", "--ignored", "--nocapture", "--test-threads", "1"])
            .env("HAFB_CRASH_PLAN", &path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel::<i64>();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(n) = line.strip_prefix("committed ").and_then(|n| n.parse().ok()) {
                    let _ = tx.send(n);
                }
            }
        });
        // Let it write for a while (a different time each round), then kill it mid-stream.
        let first = rx.recv_timeout(Duration::from_secs(30)).expect("the writer started");
        let mut last_ack = first;
        std::thread::sleep(Duration::from_millis(40 + round * 37));
        child.kill().unwrap();
        child.wait().unwrap();
        reader.join().unwrap();
        while let Ok(n) = rx.try_recv() {
            last_ack = n;
        }

        // Reopening runs the integrity check; every batch is whole, in order, and none of the
        // acknowledged ones is missing.
        let (plan, _) = Plan::open(&path, &no_backups()).unwrap();
        let tables = plan.load().unwrap();
        drop(plan);
        let t = &tables["transactions"];
        let id_col = t.columns.iter().position(|c| c == "id").unwrap();
        let mut per_batch: BTreeMap<i64, usize> = BTreeMap::new();
        for r in &t.rows {
            if let Some(b) = r[id_col].as_str().and_then(|id| id.strip_prefix("crash-")).and_then(|s| s.split('-').next()).and_then(|n| n.parse().ok()) {
                *per_batch.entry(b).or_default() += 1;
            }
        }
        assert!(per_batch.values().all(|n| *n == 3), "round {round}: a batch was cut in half {per_batch:?}");
        let batches: Vec<i64> = per_batch.keys().copied().collect();
        let max = *batches.last().unwrap();
        let ack = last_ack;
        assert!(max >= ack, "round {round}: batch {ack} was acknowledged but is missing (max {max})");
        assert_eq!(crash_assignment(&tables), Some(max), "round {round}: the assignment matches the last whole batch");
        assert_eq!(batches, (batches[0]..=max).collect::<Vec<_>>(), "round {round}: no batch skipped");
        eprintln!("round {round}: {} batches whole, last acknowledged {ack}, last on disk {max}", batches.len());
    }
}
