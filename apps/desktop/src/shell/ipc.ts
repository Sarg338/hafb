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
  /** Locked with a password (S8.3b). */
  locked: boolean;
}

/** The open plan's password state, for Plan Settings (S8.3b). */
export interface PasswordStatus {
  locked: boolean;
  /** Its password is remembered on this PC (Windows Credential Manager). */
  remembered: boolean;
  /** How many backups it has. */
  backups: number;
}

/** What re-locking the plan's backups did (S8.3b). */
export interface RelockReport {
  relocked: number;
  unchanged: number;
  /** Backups none of the passwords given opened (an even older password, or damaged). */
  left: BackupInfo[];
}

export interface PasswordChanged {
  info: PlanInfo;
  /** Present when the backups were asked to follow. */
  backups: RelockReport | null;
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
  kind: 'AlreadyOpen' | 'NewerVersion' | 'NotAPlan' | 'Damaged' | 'NeedsPassword' | 'WrongPassword' | 'Invalid' | 'NotOpen' | 'Io' | 'Sqlite';
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
  /** `keepPassword`: a Fresh Start of a locked plan gets the same password (Rust keeps it). */
  create: (path: string, changes: RowChanges, overwrite = false, keepPassword = false) => invoke<PlanInfo>('plan_create', { path, changes, overwrite, keepPassword }),
  /** A locked plan needs `password`, unless one is remembered on this PC (S8.3b). */
  open: (path: string, password?: string, remember?: boolean) => invoke<PlanInfo>('plan_open', { path, password, remember }),
  current: () => invoke<PlanInfo | null>('plan_current'),
  close: () => invoke<null>('plan_close'),
  load: () => invoke<LoadedTables>('plan_load'),
  apply: (changes: RowChanges, log?: CommandLogEntry) => invoke<null>('plan_apply', { changes, log }),
  saveCopy: (dest: string) => invoke<null>('plan_save_copy', { dest }),
  backups: () => invoke<BackupInfo[]>('plan_backups'),
  /** `password`: for a backup made under a different password than the plan has now. */
  restore: (backupPath: string, password?: string) => invoke<PlanInfo>('plan_restore', { backupPath, password }),
  /** The backup that would replace a damaged plan at `path`, or null if none is good. */
  recoveryCandidate: (path: string, password?: string) => invoke<BackupInfo | null>('plan_recovery_candidate', { path, password }),
  recover: (path: string, password?: string) => invoke<Recovered>('plan_recover', { path, password }),
  passwordStatus: () => invoke<PasswordStatus>('plan_password_status'),
  /** Set (`current` null), change, or remove (`next` null) the open plan's password. */
  setPassword: (current: string | null, next: string | null, remember: boolean, relock: boolean) =>
    invoke<PasswordChanged>('plan_set_password', { current, new: next, remember, relock }),
  /** Re-lock the backups an earlier password opens, to match the plan. */
  relockBackups: (password: string) => invoke<RelockReport>('plan_relock_backups', { password }),
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
