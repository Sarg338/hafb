// Typed wrappers for the Phase 0 spike commands in src-tauri/src/spike/. Throwaway.
import { invoke } from '@tauri-apps/api/core';

export interface LaunchInfo {
  processToMainMs: number | null;
  processToFirstPaintMs: number | null;
}

export interface SqliteOpenInfo {
  path: string;
  sqliteVersion: string;
  journalMode: string;
  rowCount: number;
  rustMs: number;
}

export interface SqliteWriteResult {
  rows: number;
  amountSum: number;
  rustMs: number;
}

export interface SqliteRow {
  id: number;
  label: string;
  amountMinor: number;
  day: string;
}

export interface SqliteReadResult {
  rows: SqliteRow[];
  amountSum: number;
  rustMs: number;
}

export type TitlebarMode = 'custom' | 'native';

export const spikeIpc = {
  markFirstPaint: () => invoke<LaunchInfo>('spike_mark_first_paint'),
  sqliteOpen: () => invoke<SqliteOpenInfo>('spike_sqlite_open'),
  sqliteWrite: (rows: number) => invoke<SqliteWriteResult>('spike_sqlite_write', { rows }),
  sqliteRead: () => invoke<SqliteReadResult>('spike_sqlite_read'),
  getTitlebarMode: () => invoke<TitlebarMode>('spike_get_titlebar_mode'),
  setTitlebarMode: (mode: TitlebarMode) => invoke<null>('spike_set_titlebar_mode', { mode }),
};
