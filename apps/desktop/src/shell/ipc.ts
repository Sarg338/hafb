// Typed wrappers for the plan-file commands in src-tauri/src/commands.rs (ADR 0002 §7).
// Tauri maps camelCase argument names to the Rust snake_case parameters.
import { invoke } from '@tauri-apps/api/core';
import type { ChangeSet, LoadedTables, RowChanges } from '@hafb/store';

export interface PlanInfo {
  path: string;
  name: string;
  schemaVersion: number;
  migratedFrom: number | null;
  backupPath: string | null;
  preMigrationBackupPath: string | null;
}

export interface BackupInfo {
  path: string;
  fileName: string;
  kind: 'open' | 'restore' | 'beforeMigration';
  stamp: string;
  sizeBytes: number;
}

export interface RecentPlan {
  path: string;
  exists: boolean;
}

export interface CommandLogEntry {
  sessionId: string;
  createdAt: string;
  direction: 'do' | 'undo' | 'redo';
  label: string;
  forward: ChangeSet;
  inverse: ChangeSet;
}

/** Every store error arrives as { kind, message }. */
export interface StoreError {
  kind: 'AlreadyOpen' | 'NewerVersion' | 'NotAPlan' | 'Invalid' | 'NotOpen' | 'Io' | 'Sqlite';
  message: string;
}

export function errorMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') return e.message;
  return String(e);
}

export const planIpc = {
  create: (path: string, changes: RowChanges, overwrite = false) => invoke<PlanInfo>('plan_create', { path, changes, overwrite }),
  open: (path: string) => invoke<PlanInfo>('plan_open', { path }),
  current: () => invoke<PlanInfo | null>('plan_current'),
  close: () => invoke<null>('plan_close'),
  load: () => invoke<LoadedTables>('plan_load'),
  apply: (changes: RowChanges, log?: CommandLogEntry) => invoke<null>('plan_apply', { changes, log }),
  saveCopy: (dest: string) => invoke<null>('plan_save_copy', { dest }),
  backups: () => invoke<BackupInfo[]>('plan_backups'),
  restore: (backupPath: string) => invoke<PlanInfo>('plan_restore', { backupPath }),
  recent: () => invoke<RecentPlan[]>('recent_plans'),
  removeRecent: (path: string) => invoke<null>('recent_remove', { path }),
  pickPlanPath: (mode: 'open' | 'save', defaultName?: string) => invoke<string | null>('pick_plan_path', { mode, defaultName }),
  pickImportZip: () => invoke<string | null>('pick_import_zip'),
  readImportFile: (path: string) => invoke<ArrayBuffer>('read_import_file', { path }),
};

export type TitlebarMode = 'custom' | 'native';

export interface LaunchTiming {
  processToMainMs: number | null;
  processToFirstPaintMs: number | null;
}

/** App-level commands (src-tauri/src/{startup,titlebar,diagnostics}.rs). */
export const appIpc = {
  /** The plan passed as `--open <path>` (or a bare .hafb path) at launch; returned once. */
  startupPlanPath: () => invoke<string | null>('startup_plan_path'),
  getTitlebarMode: () => invoke<TitlebarMode>('get_titlebar_mode'),
  /** Saves the choice and restarts the app. */
  setTitlebarMode: (mode: TitlebarMode) => invoke<null>('set_titlebar_mode', { mode }),
  /** Marks first paint (first call wins) and returns the launch timings. */
  launchTiming: () => invoke<LaunchTiming>('launch_timing'),
};
