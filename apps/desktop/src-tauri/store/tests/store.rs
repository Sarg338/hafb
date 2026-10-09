//! Store contract tests (ADR 0002). The sample fixtures are generated from the TypeScript codec
//! (`encodePlan(samplePlan())`) and the Node reference store, so these tests prove the Rust store
//! and `packages/store/test/helpers/sqliteStore.ts` behave the same on the same input.

use hafb_store::backup::{self, BackupKind, KEEP_BACKUPS};
use hafb_store::error::ErrorKind;
use hafb_store::schema::{self, MIGRATIONS};
use hafb_store::wire::{LoadedTables, LogEntry, Row, RowChanges, TableKeys, TableRows};
use hafb_store::{OpenOptions, Plan};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

const SAMPLE_CHANGES: &str = include_str!("fixtures/sample-changes.json");
const SAMPLE_LOADED: &str = include_str!("fixtures/sample-loaded.json");

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "hafb-store-test-{}-{}-{name}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
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

fn row(v: Value) -> Row {
    match v {
        Value::Object(m) => m,
        _ => panic!("not an object"),
    }
}

fn upsert(table: &str, rows: Vec<Value>) -> RowChanges {
    RowChanges { upserts: vec![TableRows { table: table.into(), rows: rows.into_iter().map(row).collect() }], deletes: vec![] }
}

fn delete(table: &str, keys: Vec<Value>) -> RowChanges {
    RowChanges { upserts: vec![], deletes: vec![TableKeys { table: table.into(), keys: keys.into_iter().map(row).collect() }] }
}

/// A full row from the sample (upserts carry whole rows; SQLite checks NOT NULL before ON CONFLICT).
fn sample_row(table: &str, id: &str, changes: &[(&str, Value)]) -> Value {
    let mut r = sample()
        .upserts
        .into_iter()
        .filter(|b| b.table == table)
        .flat_map(|b| b.rows)
        .find(|r| r.get("id") == Some(&json!(id)))
        .unwrap_or_else(|| panic!("{table} {id} not in sample"));
    for (k, v) in changes {
        r.insert((*k).to_owned(), v.clone());
    }
    Value::Object(r)
}

fn no_backups() -> OpenOptions {
    OpenOptions::default()
}

fn create_sample(dir: &TempDir) -> PathBuf {
    let path = dir.join("Sample.hafb");
    Plan::create(&path, &sample(), false).unwrap();
    path
}

fn cell<'a>(tables: &'a LoadedTables, table: &str, id_col: &str, id: &str, col: &str) -> &'a Value {
    let t = &tables[table];
    let ic = t.columns.iter().position(|c| c == id_col).unwrap();
    let cc = t.columns.iter().position(|c| c == col).unwrap();
    let r = t.rows.iter().find(|r| r[ic] == json!(id)).unwrap_or_else(|| panic!("{table} {id} missing"));
    &r[cc]
}

fn count(tables: &LoadedTables, table: &str) -> usize {
    tables[table].rows.len()
}

// ---- migrations & opening ------------------------------------------------------------------------

#[test]
fn create_migrates_to_latest_and_marks_the_file() {
    let dir = TempDir::new("create");
    let path = create_sample(&dir);
    let (plan, report) = Plan::open(&path, &no_backups()).unwrap();
    assert_eq!(plan.schema_version().unwrap(), schema::latest_version());
    assert_eq!(report.migrated_from, None);
    assert_eq!(plan.name().unwrap(), "Sample Plan");
    assert_eq!(schema::application_id(plan.connection()).unwrap(), schema::APPLICATION_ID);
    let mode: String = plan.connection().query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "wal");
    // No temporary files left behind.
    let names: Vec<String> = std::fs::read_dir(&dir.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(names.iter().all(|n| !n.starts_with('.')), "{names:?}");
}

#[test]
fn reopening_is_idempotent() {
    let dir = TempDir::new("reopen");
    let path = create_sample(&dir);
    let first = Plan::open(&path, &no_backups()).unwrap().0.load().unwrap();
    for _ in 0..3 {
        let (plan, report) = Plan::open(&path, &no_backups()).unwrap();
        assert_eq!(report.migrated_from, None);
        assert_eq!(plan.load().unwrap(), first);
    }
}

#[test]
fn create_refuses_an_existing_file_unless_replacing() {
    let dir = TempDir::new("exists");
    let path = create_sample(&dir);
    let e = Plan::create(&path, &sample(), false).unwrap_err();
    assert_eq!(e.kind, ErrorKind::Invalid);
    Plan::create(&path, &sample(), true).unwrap();
}

#[test]
fn create_without_a_plan_row_fails_and_leaves_nothing() {
    let dir = TempDir::new("noplanrow");
    let path = dir.join("Empty.hafb");
    let e = Plan::create(&path, &RowChanges::default(), false).unwrap_err();
    assert_eq!(e.kind, ErrorKind::NotAPlan);
    assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 0);
}

#[test]
fn a_newer_file_is_refused_untouched() {
    let dir = TempDir::new("newer");
    let path = create_sample(&dir);
    {
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch("PRAGMA user_version = 99").unwrap();
    }
    let e = Plan::open(&path, &no_backups()).err().unwrap();
    assert_eq!(e.kind, ErrorKind::NewerVersion);
    let c = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(schema::user_version(&c).unwrap(), 99);
}

#[test]
fn foreign_and_missing_files_are_not_plans() {
    let dir = TempDir::new("foreign");
    assert_eq!(Plan::open(&dir.join("nope.hafb"), &no_backups()).err().unwrap().kind, ErrorKind::NotAPlan);

    let text = dir.join("notes.hafb");
    std::fs::write(&text, "hello, this is not SQLite at all, just some text padding padding").unwrap();
    assert_eq!(Plan::open(&text, &no_backups()).err().unwrap().kind, ErrorKind::NotAPlan);

    // Someone else's SQLite file: refused, and its journal mode is left alone.
    let other = dir.join("other.sqlite");
    rusqlite::Connection::open(&other).unwrap().execute_batch("CREATE TABLE t (x)").unwrap();
    assert_eq!(Plan::open(&other, &no_backups()).err().unwrap().kind, ErrorKind::NotAPlan);
    let mode: String = rusqlite::Connection::open(&other).unwrap().query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "delete");
}

#[test]
fn an_older_file_is_backed_up_then_migrated() {
    // A real upgrade path: build a v1 file, then open it with an app that has a second migration.
    let dir = TempDir::new("migrate");
    let backups = dir.join("backups");
    let path = dir.join("Old.hafb");
    // The sample as a v1 file: without the columns later migrations added (0002: payees.hidden;
    // 0003: the transactions' import-matching columns; 0004: plan.display_decimals).
    let mut v1 = sample();
    for t in v1.upserts.iter_mut().filter(|t| t.table == "payees") {
        for r in &mut t.rows {
            r.remove("hidden");
        }
    }
    for t in v1.upserts.iter_mut().filter(|t| t.table == "plan") {
        for r in &mut t.rows {
            r.remove("display_decimals");
        }
    }
    for t in v1.upserts.iter_mut().filter(|t| t.table == "transactions") {
        for r in &mut t.rows {
            for c in ["imported_date", "imported_amount", "entered_amount", "matched_at"] {
                r.remove(c);
            }
        }
    }
    Plan::create_with(&path, &v1, false, &MIGRATIONS[..1]).unwrap();
    let next: Vec<&str> = MIGRATIONS
        .iter()
        .copied()
        .chain(std::iter::once("ALTER TABLE accounts ADD COLUMN test_only_color TEXT;"))
        .collect();
    let options = OpenOptions { backup_dir: Some(backups.clone()), backup_on_open: false, keep_backups: None };
    let (plan, report) = Plan::open_with(&path, &options, &next).unwrap();
    assert_eq!(report.migrated_from, Some(1));
    assert_eq!(plan.schema_version().unwrap(), u32::try_from(next.len()).unwrap());
    let copy = PathBuf::from(report.pre_migration_backup_path.unwrap());
    assert!(copy.file_name().unwrap().to_string_lossy().starts_with("before-migration-v1-"));
    drop(plan);
    // The copy is the untouched v1 file, still openable by the v1 app.
    let (old, _) = Plan::open_with(&copy, &no_backups(), &MIGRATIONS[..1]).unwrap();
    assert_eq!(old.schema_version().unwrap(), 1);
    assert_eq!(old.name().unwrap(), "Sample Plan");
    assert_eq!(backup::list_backups(&backups).unwrap()[0].kind, BackupKind::BeforeMigration);
}

#[test]
fn a_second_open_of_the_same_plan_fails_with_already_open() {
    let dir = TempDir::new("lock");
    let path = create_sample(&dir);
    let (first, _) = Plan::open(&path, &no_backups()).unwrap();
    let e = Plan::open(&path, &no_backups()).err().unwrap();
    assert_eq!(e.kind, ErrorKind::AlreadyOpen, "{e}");
    drop(first);
    Plan::open(&path, &no_backups()).unwrap();
}

// ---- load & apply ----------------------------------------------------------------------------------

#[test]
fn load_matches_the_node_reference_store_exactly() {
    let dir = TempDir::new("reference");
    let path = create_sample(&dir);
    let (plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let expected: LoadedTables = serde_json::from_str(SAMPLE_LOADED).unwrap();
    let got = plan.load().unwrap();
    assert_eq!(got.keys().collect::<Vec<_>>(), expected.keys().collect::<Vec<_>>());
    for (table, data) in &expected {
        assert_eq!(&got[table], data, "table {table}");
    }
}

#[test]
fn upsert_inserts_new_rows_and_updates_existing_ones() {
    let dir = TempDir::new("upsert");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    plan.apply(&upsert("accounts", vec![sample_row("accounts", "a-chk", &[("name", json!("Main checking"))])]), None).unwrap();
    plan.apply(
        &upsert("month_categories", vec![json!({"month": "2026-11", "category_id": "c-rent", "assigned": 150000})]),
        None,
    )
    .unwrap();
    let t = plan.load().unwrap();
    assert_eq!(cell(&t, "accounts", "id", "a-chk", "name"), &json!("Main checking"));
    assert_eq!(cell(&t, "accounts", "id", "a-chk", "note"), &json!("main"));
    assert_eq!(count(&t, "month_categories"), 3);
}

#[test]
fn booleans_are_stored_as_integers() {
    let dir = TempDir::new("bool");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    plan.apply(&upsert("accounts", vec![sample_row("accounts", "a-chk", &[("closed", json!(true))])]), None).unwrap();
    assert_eq!(cell(&plan.load().unwrap(), "accounts", "id", "a-chk", "closed"), &json!(1));
}

#[test]
fn delete_by_key_cascades_split_lines() {
    let dir = TempDir::new("delete");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    assert_eq!(count(&plan.load().unwrap(), "subtransactions"), 2);
    plan.apply(&delete("transactions", vec![json!({"id": "t-split"})]), None).unwrap();
    let t = plan.load().unwrap();
    assert_eq!(count(&t, "subtransactions"), 0);
    assert!(t["transactions"].rows.iter().all(|r| r[0] != json!("t-split")));
    // Composite keys.
    plan.apply(&delete("month_categories", vec![json!({"month": "2026-09", "category_id": "c-rent"})]), None).unwrap();
    assert_eq!(count(&plan.load().unwrap(), "month_categories"), 1);
}

#[test]
fn a_split_that_does_not_add_up_rolls_back_the_whole_batch() {
    let dir = TempDir::new("split");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let before = plan.load().unwrap();
    let changes = RowChanges {
        upserts: vec![
            TableRows { table: "accounts".into(), rows: vec![row(sample_row("accounts", "a-chk", &[("name", json!("Renamed"))]))] },
            TableRows { table: "transactions".into(), rows: vec![row(sample_row("transactions", "t-split", &[("amount", json!(-7501))]))] },
        ],
        deletes: vec![],
    };
    let e = plan.apply(&changes, None).unwrap_err();
    assert_eq!(e.kind, ErrorKind::Invalid);
    assert!(e.message.contains("Split invariant"), "{e}");
    assert_eq!(plan.load().unwrap(), before);
}

#[test]
fn a_dangling_foreign_key_rolls_back_at_commit() {
    let dir = TempDir::new("fk");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let before = plan.load().unwrap();
    let e = plan
        .apply(&upsert("month_categories", vec![json!({"month": "2026-12", "category_id": "no-such-category", "assigned": 5})]), None)
        .unwrap_err();
    assert_eq!(e.kind, ErrorKind::Invalid);
    assert!(e.message.contains("Foreign key"), "{e}");
    assert_eq!(plan.load().unwrap(), before);
    // The connection is usable afterwards.
    plan.apply(&upsert("month_notes", vec![json!({"month": "2026-12", "note": "ok"})]), None).unwrap();
}

#[test]
fn forward_references_inside_one_batch_are_fine() {
    // A new card account and its payment category reference each other; order doesn't matter.
    let dir = TempDir::new("forward");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let changes = RowChanges {
        upserts: vec![
            TableRows {
                table: "categories".into(),
                rows: vec![row(json!({"id": "c-amex", "group_id": "g-cc", "name": "Amex", "sort_order": 1, "credit_card_account_id": "a-amex"}))],
            },
            TableRows {
                table: "accounts".into(),
                rows: vec![row(json!({"id": "a-amex", "name": "Amex", "type": "creditCard", "on_budget": 1, "sort_order": 9, "created_at": "x"}))],
            },
        ],
        deletes: vec![],
    };
    plan.apply(&changes, None).unwrap();
}

#[test]
fn floats_and_unsafe_integers_are_refused() {
    let dir = TempDir::new("float");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    for v in [json!(1.5), json!(1.0), json!(9_007_199_254_740_992_i64), json!(u64::MAX), json!([1]), json!({"a": 1})] {
        let e = plan
            .apply(&upsert("month_categories", vec![json!({"month": "2026-11", "category_id": "c-rent", "assigned": v})]), None)
            .unwrap_err();
        assert_eq!(e.kind, ErrorKind::Invalid, "{v}");
    }
}

#[test]
fn unknown_tables_columns_and_bad_keys_are_refused() {
    let dir = TempDir::new("unknown");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let cases = [
        upsert("nope", vec![json!({"id": "x"})]),
        upsert("command_log", vec![json!({"seq": 1})]),
        upsert("attachments", vec![json!({"id": "x"})]),
        upsert("accounts", vec![json!({"id": "a-chk", "colour": "red"})]),
        upsert("accounts", vec![json!({"name": "no key"})]),
        delete("month_categories", vec![json!({"month": "2026-09"})]),
        delete("accounts", vec![json!({"id": "a-chk", "name": "extra"})]),
    ];
    for c in &cases {
        let e = plan.apply(c, None).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Invalid, "{c:?}: {e}");
    }
}

#[test]
fn the_command_log_is_written_with_the_change_and_pruned() {
    let dir = TempDir::new("log");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let entry = LogEntry {
        session_id: "s1".into(),
        created_at: "2026-10-08T12:00:00.000Z".into(),
        direction: "do".into(),
        label: "Rename account".into(),
        forward: json!({"put": {}}),
        inverse: json!({"remove": {}}),
    };
    plan.apply(&upsert("accounts", vec![sample_row("accounts", "a-chk", &[("name", json!("A"))])]), Some(&entry)).unwrap();
    let n: i64 = plan.connection().query_row("SELECT COUNT(*) FROM command_log", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    // A failed change writes no log row.
    let _ = plan.apply(&upsert("accounts", vec![json!({"id": "a-chk", "bogus": 1})]), Some(&entry));
    let n: i64 = plan.connection().query_row("SELECT COUNT(*) FROM command_log", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    // Pruning keeps the newest rows.
    plan.connection()
        .execute_batch(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2100)
             INSERT INTO command_log (session_id, created_at, direction, label, forward, inverse)
             SELECT 's0', 'x', 'do', 'filler', '{}', '{}' FROM n",
        )
        .unwrap();
    plan.apply(&upsert("accounts", vec![sample_row("accounts", "a-chk", &[("name", json!("B"))])]), Some(&entry)).unwrap();
    let (n, last): (i64, String) = plan
        .connection()
        .query_row("SELECT COUNT(*), (SELECT label FROM command_log ORDER BY seq DESC LIMIT 1) FROM command_log", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(n, hafb_store::KEEP_COMMAND_LOG);
    assert_eq!(last, "Rename account");
}

// ---- backups, copies, restore ------------------------------------------------------------------------

fn open_with_backups(path: &Path, dir: &Path) -> (Plan, hafb_store::OpenReport) {
    Plan::open(path, &OpenOptions { backup_dir: Some(dir.to_path_buf()), backup_on_open: true, keep_backups: None }).unwrap()
}

#[test]
fn every_open_backs_up_and_only_the_newest_ten_are_kept() {
    let dir = TempDir::new("prune");
    let path = create_sample(&dir);
    let backups = dir.join("backups");
    let mut made = Vec::new();
    for _ in 0..(KEEP_BACKUPS + 3) {
        let (_, report) = open_with_backups(&path, &backups);
        made.push(report.backup_path.unwrap());
    }
    let list = backup::list_backups(&backups).unwrap();
    assert_eq!(list.len(), KEEP_BACKUPS);
    assert!(list.iter().all(|b| b.kind == BackupKind::Open));
    // Newest first, and the newest are the ones kept.
    let kept: Vec<&String> = list.iter().map(|b| &b.path).collect();
    for p in &made[made.len() - KEEP_BACKUPS..] {
        assert!(kept.contains(&p), "{p} pruned");
    }
    assert_eq!(&list[0].path, made.last().unwrap());
    // A backup is a complete, openable plan with the same contents.
    let expected = Plan::open(&path, &no_backups()).unwrap().0.load().unwrap();
    let (copy, _) = Plan::open(Path::new(&list[0].path), &no_backups()).unwrap();
    assert_eq!(copy.load().unwrap(), expected);
}

#[test]
fn the_number_kept_is_a_setting_and_back_up_now_keeps_its_own() {
    let dir = TempDir::new("keep");
    let path = create_sample(&dir);
    let backups = dir.join("backups");
    for _ in 0..5 {
        Plan::open(&path, &OpenOptions { backup_dir: Some(backups.clone()), backup_on_open: true, keep_backups: Some(3) }).unwrap();
    }
    let opens = backup::list_backups(&backups).unwrap();
    assert_eq!(opens.len(), 3);
    let (plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let manual: Vec<PathBuf> = (0..3).map(|_| plan.backup_now(&backups, 2).unwrap()).collect();
    let list = backup::list_backups(&backups).unwrap();
    assert_eq!(list.iter().filter(|b| b.kind == BackupKind::Manual).count(), 2);
    assert_eq!(list.iter().filter(|b| b.kind == BackupKind::Open).count(), 3, "manual backups don't prune open ones");
    assert!(list.iter().any(|b| Path::new(&b.path) == manual[2].as_path()));
    assert!(manual[2].file_name().unwrap().to_string_lossy().starts_with("manual-"));
}

#[test]
fn backup_folders_are_per_plan_path() {
    let root = Path::new("C:/data/backups");
    let a = backup::plan_backup_dir(root, Path::new("C:/one/Budget.hafb"));
    let b = backup::plan_backup_dir(root, Path::new("C:/two/Budget.hafb"));
    let a2 = backup::plan_backup_dir(root, Path::new("c:/ONE/budget.hafb"));
    assert_ne!(a, b);
    assert_eq!(a.parent(), Some(root));
    assert!(a.file_name().unwrap().to_string_lossy().starts_with("Budget-"));
    assert_eq!(a.file_name().unwrap().len(), "Budget-".len() + 8);
    assert_eq!(a.to_string_lossy().to_lowercase(), a2.to_string_lossy().to_lowercase());
}

#[test]
fn save_copy_writes_a_consistent_plan_and_replaces_an_existing_file() {
    let dir = TempDir::new("copy");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    plan.apply(&upsert("month_notes", vec![json!({"month": "2026-12", "note": "uncheckpointed"})]), None).unwrap();
    let dest = dir.join("Copy.hafb");
    std::fs::write(&dest, "old junk").unwrap();
    plan.save_copy(&dest).unwrap();
    assert_eq!(plan.save_copy(&path).unwrap_err().kind, ErrorKind::Invalid);
    let expected = plan.load().unwrap();
    let (copy, _) = Plan::open(&dest, &no_backups()).unwrap();
    assert_eq!(copy.load().unwrap(), expected);
    assert_eq!(copy.schema_version().unwrap(), schema::latest_version());
}

#[test]
fn restore_backs_up_the_current_plan_then_replaces_it() {
    let dir = TempDir::new("restore");
    let path = create_sample(&dir);
    let backups = dir.join("backups");
    let (mut plan, report) = open_with_backups(&path, &backups);
    let original = plan.load().unwrap();
    let snapshot = PathBuf::from(report.backup_path.unwrap());
    plan.apply(&upsert("accounts", vec![sample_row("accounts", "a-chk", &[("name", json!("Changed after backup"))])]), None).unwrap();
    let changed = plan.load().unwrap();

    let (restored, _, saved) = plan.restore(&snapshot, &backups).unwrap();
    assert_eq!(restored.load().unwrap(), original);
    assert!(saved.file_name().unwrap().to_string_lossy().starts_with("restore-"));
    drop(restored);
    let (before_restore, _) = Plan::open(&saved, &no_backups()).unwrap();
    assert_eq!(before_restore.load().unwrap(), changed);
}

#[test]
fn restore_refuses_a_file_that_is_not_a_plan_and_keeps_the_plan_open() {
    let dir = TempDir::new("restore-bad");
    let path = create_sample(&dir);
    let backups = dir.join("backups");
    let junk = dir.join("junk.hafb");
    rusqlite::Connection::open(&junk).unwrap().execute_batch("CREATE TABLE t (x)").unwrap();
    let (plan, _) = open_with_backups(&path, &backups);
    let Err(e) = plan.restore(&junk, &backups) else { panic!("restored junk") };
    assert_eq!(e.kind, ErrorKind::NotAPlan);
}

// ---- performance -------------------------------------------------------------------------------------

#[test]
fn load_of_twenty_thousand_transactions() {
    let dir = TempDir::new("perf");
    let path = create_sample(&dir);
    let (mut plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let rows: Vec<Value> = (0..20_000)
        .map(|i| {
            json!({
                "id": format!("perf-{i:05}"),
                "account_id": "a-chk",
                "date": format!("20{:02}-{:02}-{:02}", 20 + (i / 4000), (i / 300) % 12 + 1, i % 28 + 1),
                "amount": -(i64::from(i) * 37 % 100_000),
                "payee_id": "p-store",
                "category_id": "c-food",
                "memo": format!("memo {i}"),
                "cleared": "cleared",
                "approved": 1,
                "flag": null,
                "transfer_account_id": null,
                "transfer_transaction_id": null,
                "scheduled_transaction_id": null,
                "is_starting_balance": 0,
                "import_id": null,
                "imported_payee": null,
                "imported_memo": null,
                "created_at": "2026-10-08T12:00:00.000Z",
                "deleted_at": null,
            })
        })
        .collect();
    let started = Instant::now();
    plan.apply(&upsert("transactions", rows), None).unwrap();
    let write_ms = started.elapsed().as_secs_f64() * 1000.0;
    drop(plan);
    let started = Instant::now();
    let (plan, _) = Plan::open(&path, &no_backups()).unwrap();
    let tables = plan.load().unwrap();
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let json = serde_json::to_string(&tables).unwrap();
    let json_ms = started.elapsed().as_secs_f64() * 1000.0;
    assert!(count(&tables, "transactions") > 20_000);
    eprintln!(
        "20k transactions: write {write_ms:.0} ms, open+load {load_ms:.0} ms, to JSON {json_ms:.0} ms ({:.1} MB) [{} build]",
        json.len() as f64 / 1e6,
        if cfg!(debug_assertions) { "debug" } else { "release" }
    );
}
