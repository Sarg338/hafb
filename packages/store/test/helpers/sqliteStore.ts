// A Node reference implementation of the Rust store's generic load/apply (ADR 0002 §4), on the real
// migration SQL via node:sqlite. Tests use it to prove the codec and the schema agree; the Rust store
// (apps/desktop/src-tauri/src/store) implements the same contract and is tested with cargo.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KEY_COLUMNS, type LoadedTables, type RowChanges, type SqlValue, type TableData } from '../../src/codec.ts';

export const MIGRATIONS_DIR = join(import.meta.dirname, '../../../../apps/desktop/src-tauri/migrations');

export function openMemoryPlan(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec('BEGIN');
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    db.exec('COMMIT');
  }
  return db;
}

const q = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export function applyRows(db: DatabaseSync, changes: RowChanges): void {
  db.exec('BEGIN');
  try {
    db.exec('PRAGMA defer_foreign_keys = ON');
    for (const { table, rows } of changes.upserts) {
      const keys = KEY_COLUMNS[table];
      if (!keys) throw new Error(`unknown table ${table}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        const updates = cols.filter((c) => !keys.includes(c));
        const sql =
          `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
          `ON CONFLICT (${keys.map(q).join(', ')}) DO ` +
          (updates.length === 0 ? 'NOTHING' : `UPDATE SET ${updates.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`);
        db.prepare(sql).run(...cols.map((c) => row[c] ?? null));
      }
    }
    for (const { table, keys: keyRows } of changes.deletes) {
      const keys = KEY_COLUMNS[table];
      if (!keys) throw new Error(`unknown table ${table}`);
      const stmt = db.prepare(`DELETE FROM ${q(table)} WHERE ${keys.map((k) => `${q(k)} = ?`).join(' AND ')}`);
      for (const key of keyRows) stmt.run(...keys.map((k) => key[k] ?? null));
    }
    const bad = db.prepare('SELECT transaction_id, kind FROM split_violations').all();
    if (bad.length > 0) throw new Error(`split invariant violated: ${JSON.stringify(bad)}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function loadTables(db: DatabaseSync): LoadedTables {
  const out: Record<string, TableData> = {};
  for (const table of Object.keys(KEY_COLUMNS)) {
    const stmt = db.prepare(`SELECT * FROM ${q(table)}`);
    const columns = stmt.columns().map((c) => c.name);
    const rows = stmt.all().map((r) => columns.map((c): SqlValue => {
      const v: unknown = r[c];
      if (v === null || typeof v === 'string' || typeof v === 'number') return v;
      if (typeof v === 'bigint') return Number(v);
      throw new Error(`unexpected ${typeof v} in ${table}.${c}`);
    }));
    out[table] = { columns, rows };
  }
  return out;
}
