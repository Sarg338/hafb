//! The TS <-> Rust wire contract (ADR 0002 §4). Mirrors `packages/store/src/codec.ts`.

use crate::error::{Result, StoreError};
use rusqlite::types::{Value as SqlValue, ValueRef};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// Largest integer JavaScript represents exactly (2^53 - 1).
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub type Row = Map<String, Value>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TableRows {
    pub table: String,
    pub rows: Vec<Row>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TableKeys {
    pub table: String,
    pub keys: Vec<Row>,
}

/// A batch applied in one SQLite transaction: all upserts in order, then all deletes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RowChanges {
    #[serde(default)]
    pub upserts: Vec<TableRows>,
    #[serde(default)]
    pub deletes: Vec<TableKeys>,
}

/// One table as loaded: column names once, then positional rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

pub type LoadedTables = BTreeMap<String, TableData>;

/// A `command_log` row written in the same transaction as the change it records.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub session_id: String,
    pub created_at: String,
    /// "do" | "undo" | "redo"
    pub direction: String,
    pub label: String,
    pub forward: Value,
    pub inverse: Value,
}

/// JSON value -> SQLite value. Money is never a float: any non-integer number is refused.
pub fn to_sql(table: &str, column: &str, v: &Value) -> Result<SqlValue> {
    let bad = |what: &str| StoreError::invalid(format!("{table}.{column}: {what} is not allowed"));
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Number(n) => match n.as_i64() {
            Some(i) if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&i) => SqlValue::Integer(i),
            Some(_) => return Err(bad(&format!("integer {n} beyond ±2^53"))),
            None if n.is_u64() => return Err(bad(&format!("integer {n} beyond ±2^53"))),
            None => return Err(bad(&format!("non-integer number {n}"))),
        },
        Value::Array(_) => return Err(bad("an array")),
        Value::Object(_) => return Err(bad("an object")),
    })
}

/// SQLite value -> JSON value. REAL and BLOB never belong in a snapshot table.
pub fn from_sql(table: &str, column: &str, v: ValueRef<'_>) -> Result<Value> {
    Ok(match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&i) => Value::from(i),
        ValueRef::Integer(i) => {
            return Err(StoreError::invalid(format!("{table}.{column} holds {i}, beyond what JavaScript represents exactly")));
        }
        ValueRef::Text(t) => Value::String(
            std::str::from_utf8(t)
                .map_err(|_| StoreError::invalid(format!("{table}.{column} holds invalid UTF-8")))?
                .to_owned(),
        ),
        ValueRef::Real(r) => {
            return Err(StoreError::invalid(format!("{table}.{column} holds a REAL ({r}); plan files never store floats")));
        }
        ValueRef::Blob(_) => return Err(StoreError::invalid(format!("{table}.{column} holds a BLOB"))),
    })
}
