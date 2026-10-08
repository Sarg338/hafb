//! SQLite round-trip spike. Uses a throwaway `spike_rows` table in its own file; this is
//! NOT the HAFB schema (that is Phase 2, as numbered migrations).

use rusqlite::{Connection, params};
use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct SpikeDb(Mutex<Option<Connection>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInfo {
    path: String,
    sqlite_version: String,
    journal_mode: String,
    row_count: i64,
    rust_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    rows: u32,
    amount_sum: i64,
    rust_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpikeRow {
    id: i64,
    label: String,
    amount_minor: i64,
    day: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    rows: Vec<SpikeRow>,
    amount_sum: i64,
    rust_ms: f64,
}

fn text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

#[tauri::command]
pub async fn spike_sqlite_open(app: AppHandle, db: State<'_, SpikeDb>) -> Result<OpenInfo, String> {
    let start = Instant::now();
    let dir = app.path().app_local_data_dir().map_err(text)?;
    std::fs::create_dir_all(&dir).map_err(text)?;
    let path = dir.join("spike.sqlite");

    let conn = Connection::open(&path).map_err(text)?;
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))
        .map_err(text)?;
    conn.execute_batch(
        "PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS spike_rows (
             id INTEGER PRIMARY KEY,
             label TEXT NOT NULL,
             amount_minor INTEGER NOT NULL,
             day TEXT NOT NULL
         );",
    )
    .map_err(text)?;
    let sqlite_version: String = conn
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .map_err(text)?;
    let row_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM spike_rows", [], |r| r.get(0))
        .map_err(text)?;

    *db.0.lock().map_err(text)? = Some(conn);
    Ok(OpenInfo {
        path: path.display().to_string(),
        sqlite_version,
        journal_mode,
        row_count,
        rust_ms: elapsed_ms(start),
    })
}

/// Replaces the table contents with `rows` deterministic rows in one transaction.
#[tauri::command]
pub async fn spike_sqlite_write(rows: u32, db: State<'_, SpikeDb>) -> Result<WriteResult, String> {
    let start = Instant::now();
    let mut guard = db.0.lock().map_err(text)?;
    let conn = guard.as_mut().ok_or("open the database first")?;

    let tx = conn.transaction().map_err(text)?;
    tx.execute("DELETE FROM spike_rows", []).map_err(text)?;
    let mut amount_sum: i64 = 0;
    {
        let mut insert = tx
            .prepare("INSERT INTO spike_rows (id, label, amount_minor, day) VALUES (?1, ?2, ?3, ?4)")
            .map_err(text)?;
        for i in 0..i64::from(rows) {
            // Deterministic spread of positive and negative integer amounts.
            let amount = (i * 7_919) % 200_000 - 100_000;
            let day = format!("{:04}-{:02}-{:02}", 2020 + (i / 336) % 7, (i / 28) % 12 + 1, i % 28 + 1);
            insert
                .execute(params![i + 1, format!("spike row {}", i + 1), amount, day])
                .map_err(text)?;
            amount_sum += amount;
        }
    }
    tx.commit().map_err(text)?;

    Ok(WriteResult {
        rows,
        amount_sum,
        rust_ms: elapsed_ms(start),
    })
}

#[tauri::command]
pub async fn spike_sqlite_read(db: State<'_, SpikeDb>) -> Result<ReadResult, String> {
    let start = Instant::now();
    let guard = db.0.lock().map_err(text)?;
    let conn = guard.as_ref().ok_or("open the database first")?;

    let mut select = conn
        .prepare("SELECT id, label, amount_minor, day FROM spike_rows ORDER BY id")
        .map_err(text)?;
    let rows = select
        .query_map([], |r| {
            Ok(SpikeRow {
                id: r.get(0)?,
                label: r.get(1)?,
                amount_minor: r.get(2)?,
                day: r.get(3)?,
            })
        })
        .map_err(text)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(text)?;
    let amount_sum: i64 = conn
        .query_row("SELECT COALESCE(SUM(amount_minor), 0) FROM spike_rows", [], |r| r.get(0))
        .map_err(text)?;

    Ok(ReadResult {
        rows,
        amount_sum,
        rust_ms: elapsed_ms(start),
    })
}
