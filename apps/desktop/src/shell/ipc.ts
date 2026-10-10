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
  kind: 'open' | 'manual' | 'restore' | 'beforeMigration';
  stamp: string;
  sizeBytes: number;
}

/** Backup settings (S6.6): kept per PC in the app's data folder. */
export interface BackupSettingsInfo {
  keep: number;
  /** A chosen folder, or null for the default. */
  folder: string | null;
  defaultFolder: string;
  /** Where the open plan's backups go now. */
  planFolder: string | null;
}

/** Settings of this PC (S7.1), in the app's data folder. */
export interface AppSettingsInfo {
  /** Where plans are saved and opened from; null = Windows' default (Documents). */
  planFolder: string | null;
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
  kind: 'AlreadyOpen' | 'NewerVersion' | 'NotAPlan' | 'Damaged' | 'Invalid' | 'NotOpen' | 'Io' | 'Sqlite';
  message: string;
}

/** A damaged plan replaced by its newest good backup (S8.2). */
export interface Recovered {
  info: PlanInfo;
  backup: BackupInfo;
  /** Where the damaged file was kept (the plan's backup folder). */
  damagedCopy: string;
}

export function errorKind(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'kind' in e && typeof e.kind === 'string' ? e.kind : null;
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
  /** The backup that would replace a damaged plan at `path`, or null if none is good. */
  recoveryCandidate: (path: string) => invoke<BackupInfo | null>('plan_recovery_candidate', { path }),
  recover: (path: string) => invoke<Recovered>('plan_recover', { path }),
  backupNow: () => invoke<string>('plan_backup_now'),
  backupSettings: () => invoke<BackupSettingsInfo>('backup_settings_get'),
  setBackupSettings: (keep: number, folder: string | null) => invoke<BackupSettingsInfo>('backup_settings_set', { keep, folder }),
  pickBackupFolder: () => invoke<string | null>('pick_backup_folder'),
  /** Settings of this PC (S7.1): the plans folder the Open and Save dialogs start in. */
  appSettings: () => invoke<AppSettingsInfo>('app_settings_get'),
  setAppSettings: (planFolder: string | null) => invoke<AppSettingsInfo>('app_settings_set', { planFolder }),
  pickPlanFolder: () => invoke<string | null>('pick_plan_folder'),
  recent: () => invoke<RecentPlan[]>('recent_plans'),
  removeRecent: (path: string) => invoke<null>('recent_remove', { path }),
  pickPlanPath: (mode: 'open' | 'save', defaultName?: string) => invoke<string | null>('pick_plan_path', { mode, defaultName }),
  pickImportZip: () => invoke<string | null>('pick_import_zip'),
  /** Bank files (CSV, OFX/QFX, QIF), several at once; empty when cancelled. */
  pickBankFiles: () => invoke<string[]>('pick_bank_files'),
  readImportFile: (path: string) => invoke<ArrayBuffer>('read_import_file', { path }),
};

/** Files the webview builds (src-tauri/src/exports.rs): the bytes go as the raw request body. */
export const fileIpc = {
  /** Native Save dialog, then write. Resolves to the saved path, or null if cancelled. */
  saveExport: (fileName: string, bytes: Uint8Array) => invoke<string | null>('save_export', bytes, { headers: { 'x-file-name': encodeURIComponent(fileName) } }),
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
  /** Marks the first plan painted and ready (first call wins): ms since the process started. */
  markPlanReady: () => invoke<number | null>('mark_plan_ready'),
};
