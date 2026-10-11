//! Plan passwords (roadmap S8.3b, ADR 0010): locking, changing and removing a password, backups
//! that follow it, restore and recovery keeping it, and a process killed mid-change.

use hafb_store::backup;
use hafb_store::error::ErrorKind;
use hafb_store::lock::{self, Password};
use hafb_store::wire::{LoadedTables, RowChanges};
use hafb_store::{OpenOptions, Plan, newest_good_backup, relock_backups};
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
        let dir = std::env::temp_dir().join(format!("hafb-pw-{}-{}-{name}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
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

fn pw(s: &str) -> Password {
    Password::new(s).unwrap()
}

fn with(password: Option<&Password>) -> OpenOptions {
    OpenOptions { password: password.cloned(), ..OpenOptions::default() }
}

fn open(path: &Path, password: Option<&Password>) -> Plan {
    Plan::open(path, &with(password)).unwrap().0
}

/// The tables of a backup or copy, read from a copy of it (opening a plan switches it to WAL).
fn peek(file: &Path, password: Option<&Password>) -> LoadedTables {
    static N: AtomicU32 = AtomicU32::new(0);
    let copy = std::env::temp_dir().join(format!("hafb-pw-peek-{}-{}.hafb", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::copy(file, &copy).unwrap();
    let tables = open(&copy, password).load().unwrap();
    let _ = std::fs::remove_file(&copy);
    tables
}

fn open_err(path: &Path, password: Option<&Password>) -> ErrorKind {
    Plan::open(path, &with(password)).err().expect("must not open").kind
}

fn create(dir: &TempDir) -> (PathBuf, LoadedTables) {
    let path = dir.join("Plan.hafb");
    Plan::create(&path, &sample(), false).unwrap();
    let tables = open(&path, None).load().unwrap();
    (path, tables)
}

/// A name from the sample that would show up in a plain file's bytes.
fn leaks(path: &Path) -> bool {
    let bytes = std::fs::read(path).unwrap();
    bytes.windows(11).any(|w| w == b"Sample Plan") || bytes.windows(8).any(|w| w == b"Checking")
}

#[test]
fn a_password_locks_the_file_and_can_be_changed_and_removed() {
    let dir = TempDir::new("lock");
    let (path, tables) = create(&dir);
    assert!(leaks(&path), "the sample's names are readable in a plain file");
    assert!(!lock::is_locked(&path).unwrap());

    let mut plan = open(&path, None);
    plan.set_password(Some(pw("first pass"))).unwrap();
    assert!(plan.password().is_some());
    assert_eq!(plan.load().unwrap(), tables, "the open plan reads the same after locking");
    drop(plan);
    assert!(lock::is_locked(&path).unwrap());
    assert!(!leaks(&path), "nothing readable in a locked file");
    assert!(!dir.join(".Plan.hafb.locking").exists(), "no file left beside the plan");

    assert_eq!(open_err(&path, None), ErrorKind::NeedsPassword);
    assert_eq!(open_err(&path, Some(&pw("wrong"))), ErrorKind::WrongPassword);
    let mut plan = open(&path, Some(&pw("first pass")));
    assert!(plan.info(&Default::default()).unwrap().locked);
    assert_eq!(plan.load().unwrap(), tables);

    plan.set_password(Some(pw("second ' pass \" with quotes"))).unwrap();
    drop(plan);
    assert_eq!(open_err(&path, Some(&pw("first pass"))), ErrorKind::WrongPassword);
    let mut plan = open(&path, Some(&pw("second ' pass \" with quotes")));
    assert_eq!(plan.load().unwrap(), tables);

    plan.set_password(None).unwrap();
    drop(plan);
    assert!(!lock::is_locked(&path).unwrap());
    // A password given for a plain plan (a stale remembered one, say) is ignored.
    let plan = open(&path, Some(&pw("anything")));
    assert!(!plan.info(&Default::default()).unwrap().locked);
    assert_eq!(plan.load().unwrap(), tables);
}

#[test]
fn an_empty_password_is_refused() {
    assert_eq!(Password::new("").unwrap_err().kind, ErrorKind::Invalid);
    assert_eq!(format!("{:?}", pw("secret")), "Password(…)", "never printed");
}

#[test]
fn a_new_plan_can_start_locked() {
    let dir = TempDir::new("create");
    let path = dir.join("Fresh.hafb");
    Plan::create_locked(&path, &sample(), false, &pw("fresh")).unwrap();
    assert!(lock::is_locked(&path).unwrap());
    assert!(!leaks(&path));
    assert_eq!(open_err(&path, None), ErrorKind::NeedsPassword);
    assert!(open(&path, Some(&pw("fresh"))).name().is_ok());
}

#[test]
fn backups_and_copies_of_a_locked_plan_are_locked_with_its_password() {
    let dir = TempDir::new("copies");
    let backups = dir.join("backups");
    let (path, tables) = create(&dir);
    let mut plan = open(&path, None);
    plan.set_password(Some(pw("pw"))).unwrap();
    let copy = plan.backup_now(&backups, 5).unwrap();
    let saved = dir.join("Copy.hafb");
    plan.save_copy(&saved).unwrap();
    drop(plan);
    for file in [&copy, &saved] {
        assert!(lock::is_locked(file).unwrap(), "{}", file.display());
        assert!(!leaks(file), "{}", file.display());
        assert_eq!(peek(file, Some(&pw("pw"))), tables);
    }
    assert!(newest_good_backup(&backups, &[]).unwrap().is_none(), "a locked backup needs its password");
    assert!(newest_good_backup(&backups, &[&pw("pw")]).unwrap().is_some());
}

/// A backup made from another plan locked with `password`, under a backup name.
fn foreign_backup(dir: &TempDir, backups: &Path, password: &str) -> PathBuf {
    let other = dir.join(&format!("Other-{password}.hafb"));
    Plan::create_locked(&other, &sample(), false, &pw(password)).unwrap();
    let dest = backups.join(format!("manual-20200101-000000-00{}Z.hafb", password.len() % 10));
    std::fs::copy(&other, &dest).unwrap();
    dest
}

#[test]
fn backups_follow_the_password_and_ones_under_an_older_password_are_reported() {
    let dir = TempDir::new("relock");
    let backups = dir.join("backups");
    let (path, tables) = create(&dir);
    let mut plan = open(&path, None);
    plan.backup_now(&backups, 10).unwrap();
    std::thread::sleep(Duration::from_millis(5));
    plan.backup_now(&backups, 10).unwrap();

    // Setting a password: the plain backups are locked with it.
    plan.set_password(Some(pw("A"))).unwrap();
    let r = relock_backups(&backups, &[], Some(&pw("A"))).unwrap();
    assert_eq!((r.relocked, r.unchanged, r.left.len()), (2, 0, 0));
    for b in backup::list_backups(&backups).unwrap() {
        assert!(!leaks(Path::new(&b.path)));
        assert_eq!(peek(Path::new(&b.path), Some(&pw("A"))), tables);
    }

    // A backup under an even older password, then a change from A to B.
    let old = foreign_backup(&dir, &backups, "C");
    plan.set_password(Some(pw("B"))).unwrap();
    let r = relock_backups(&backups, &[&pw("A")], Some(&pw("B"))).unwrap();
    assert_eq!((r.relocked, r.unchanged), (2, 0));
    assert_eq!(r.left.iter().map(|b| PathBuf::from(&b.path)).collect::<Vec<_>>(), vec![old.clone()]);
    assert_eq!(lock::find_key(&old, &[&pw("C")]).unwrap(), Some(pw("C")), "left as it was");

    // Its password entered later: re-locked too; the others are already right.
    let r = relock_backups(&backups, &[&pw("C")], Some(&pw("B"))).unwrap();
    assert_eq!((r.relocked, r.unchanged, r.left.len()), (1, 2, 0));
    assert_eq!(lock::find_key(&old, &[&pw("B")]).unwrap(), Some(pw("B")));

    // Removing the password: the backups are unlocked.
    plan.set_password(None).unwrap();
    let r = relock_backups(&backups, &[&pw("B")], None).unwrap();
    assert_eq!((r.relocked, r.left.len()), (3, 0));
    assert!(backup::list_backups(&backups).unwrap().iter().all(|b| !lock::is_locked(Path::new(&b.path)).unwrap()));
    let leftovers: Vec<String> = std::fs::read_dir(&backups).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".partial")).collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn restoring_keeps_the_plans_current_password() {
    let dir = TempDir::new("restore");
    let backups = dir.join("backups");
    let (path, tables) = create(&dir);
    let plain = open(&path, None).backup_now(&backups, 10).unwrap();
    let mut plan = open(&path, None);
    plan.set_password(Some(pw("now"))).unwrap();

    // A plain backup (made before the password) comes back locked.
    let (plan, _, _) = plan.restore(&plain, &backups, None).unwrap();
    assert_eq!(plan.load().unwrap(), tables);
    drop(plan);
    assert!(lock::is_locked(&path).unwrap());
    assert_eq!(open(&path, Some(&pw("now"))).load().unwrap(), tables);

    // A backup under another password needs that password, then comes back under the current one.
    let other = foreign_backup(&dir, &backups, "then");
    let plan = open(&path, Some(&pw("now")));
    let Err(e) = plan.restore(&other, &backups, None) else { panic!("restored without its password") };
    assert_eq!(e.kind, ErrorKind::WrongPassword);
    let plan = open(&path, Some(&pw("now")));
    let (plan, _, _) = plan.restore(&other, &backups, Some(&pw("then"))).unwrap();
    assert_eq!(plan.password(), Some(&pw("now")));
    drop(plan);
    assert_eq!(open_err(&path, Some(&pw("then"))), ErrorKind::WrongPassword);
    assert!(open(&path, Some(&pw("now"))).name().is_ok());
}

/// Overwrite a run of bytes in the middle of the file: one page fails its HMAC.
fn damage_locked(path: &Path) {
    let mut bytes = std::fs::read(path).unwrap();
    let at = bytes.len() / 2;
    bytes[at..at + 64].fill(0x5A);
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn a_damaged_locked_plan_is_refused_and_recovered_under_its_password() {
    let dir = TempDir::new("damaged");
    let backups = dir.join("backups");
    let (path, _) = create(&dir);
    let mut plan = open(&path, None);
    // Enough rows for many pages, so the damage lands on a data page.
    let rows: Vec<serde_json::Value> = (0..3000)
        .map(|i| {
            serde_json::json!({"id": format!("t-{i:05}"), "account_id": "a-chk", "date": "2026-10-05", "amount": -1 - i, "payee_id": "p-store",
                "category_id": "c-food", "memo": format!("memo {i}"), "cleared": "cleared", "approved": 1, "flag": null, "transfer_account_id": null,
                "transfer_transaction_id": null, "scheduled_transaction_id": null, "is_starting_balance": 0, "import_id": null,
                "imported_payee": null, "imported_memo": null, "created_at": "2026-10-08T12:00:00.000Z", "deleted_at": null})
        })
        .collect();
    let changes: RowChanges = serde_json::from_value(serde_json::json!({"upserts": [{"table": "transactions", "rows": rows}], "deletes": []})).unwrap();
    plan.apply(&changes, None).unwrap();
    plan.set_password(Some(pw("pw"))).unwrap();
    plan.backup_now(&backups, 5).unwrap();
    let expected = plan.load().unwrap();
    drop(plan);

    damage_locked(&path);
    let kind = open_err(&path, Some(&pw("pw")));
    assert_eq!(kind, ErrorKind::Damaged, "a page failing its check is damage, not a wrong password");
    let (plan, _, _, kept) = Plan::recover(&path, &backups, Some(&pw("pw"))).unwrap();
    assert_eq!(plan.load().unwrap(), expected);
    assert_eq!(plan.password(), Some(&pw("pw")));
    drop(plan);
    assert!(lock::is_locked(&path).unwrap());
    assert!(lock::is_locked(&kept).unwrap());
}

// ---- a process killed mid-change ------------------------------------------------------------------

const KILL_A: &str = "kill test A";
const KILL_B: &str = "kill test B";

/// Not a test on its own: `killing_a_password_change_never_breaks_the_plan_or_a_backup` starts it
/// as a child process and kills it. It flips the plan and its backups between two passwords.
#[test]
#[ignore = "child process for the kill test"]
fn password_flipper_child() {
    let Ok(path) = std::env::var("HAFB_PW_PLAN") else { return };
    let path = PathBuf::from(path);
    let backups = PathBuf::from(std::env::var("HAFB_PW_BACKUPS").unwrap());
    let (a, b) = (pw(KILL_A), pw(KILL_B));
    let mut out = std::io::stdout();
    for n in 0..1_000_000 {
        let current = lock::find_key(&path, &[&a, &b]).unwrap();
        let next = if current.as_ref() == Some(&a) { b.clone() } else { a.clone() };
        let mut plan = open(&path, current.as_ref());
        plan.set_password(Some(next.clone())).unwrap();
        drop(plan);
        let from: Vec<&Password> = current.iter().collect();
        relock_backups(&backups, &from, Some(&next)).unwrap();
        writeln!(out, "flipped {n}").unwrap();
        out.flush().unwrap();
    }
}

#[test]
fn killing_a_password_change_never_breaks_the_plan_or_a_backup() {
    let dir = TempDir::new("kill");
    let backups = dir.join("backups");
    let (path, tables) = create(&dir);
    {
        let plan = open(&path, None);
        for _ in 0..2 {
            plan.backup_now(&backups, 10).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    let exe = std::env::current_exe().unwrap();
    let (a, b) = (pw(KILL_A), pw(KILL_B));
    for round in 0..4_u64 {
        let mut child = Command::new(&exe)
            .args(["--exact", "password_flipper_child", "--ignored", "--nocapture", "--test-threads", "1"])
            .env("HAFB_PW_PLAN", &path)
            .env("HAFB_PW_BACKUPS", &backups)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel::<u64>();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(n) = line.strip_prefix("flipped ").and_then(|n| n.parse().ok()) {
                    let _ = tx.send(n);
                }
            }
        });
        rx.recv_timeout(Duration::from_secs(60)).expect("the flipper started");
        // Each flip takes a second or two (several key derivations): kill at a different point each round.
        std::thread::sleep(Duration::from_millis(150 + round * 383));
        child.kill().unwrap();
        child.wait().unwrap();
        reader.join().unwrap();

        // The plan opens with one password or the other and holds exactly the same data.
        let key = lock::find_key(&path, &[&a, &b]).unwrap_or_else(|e| panic!("round {round}: plan under neither password: {e}"));
        assert!(key.is_some(), "round {round}: still locked");
        assert_eq!(open(&path, key.as_ref()).load().unwrap(), tables, "round {round}");
        // Every backup too.
        let list = backup::list_backups(&backups).unwrap();
        assert_eq!(list.len(), 2, "round {round}: no backup lost or added");
        for item in &list {
            let file = Path::new(&item.path);
            let key = lock::find_key(file, &[&a, &b]).unwrap_or_else(|e| panic!("round {round}: {} under neither password: {e}", item.file_name));
            assert_eq!(peek(file, key.as_ref()), tables, "round {round}: {}", item.file_name);
        }
        eprintln!("round {round}: plan and {} backups whole", list.len());
    }
}
