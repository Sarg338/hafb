// The open plan for this window: file lifecycle, commands with undo, and persistence (S2.3/S2.5).
// Framework-free; React reads it through useSyncExternalStore. No budget math here: commands come
// from @hafb/store and numbers from the engine (CLAUDE.md §10).
import {
  applyChanges,
  archivePlan,
  canRedo,
  canUndo,
  decodePlan,
  emptyHistory,
  encodePlan,
  enterDueScheduled,
  postLoanCharges,
  exportDateFromName,
  findExportFiles,
  freshStartPlan,
  historyDo,
  historyRedo,
  historyUndo,
  importTemplate,
  importYnabExport,
  newPlan,
  normalizePlan,
  planBudget,
  readZip,
  redoLabel,
  undoLabel,
  type CategoryTemplate,
  type Command,
  type CommandContext,
  type History,
  type HistoryStep,
  type ImportReport,
  type PlanData,
  type PlanSettings,
} from '@hafb/store';
import { isTauri } from '@tauri-apps/api/core';
import { makeDate, monthOf, uuidv7Generator, type ISODate, type Month } from '@hafb/shared';
import { errorMessage, planIpc, type BackupInfo, type PlanInfo, type RecentPlan } from './ipc.ts';
import { photos } from './photos.ts';

export interface LoadTimings {
  /** plan_load: SQLite read + JSON + IPC. */
  loadMs: number;
  decodeMs: number;
  computeMs: number;
  transactions: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  /** The follow-up the toast offers: after an undo, Redo; after a redo, Undo. */
  action?: 'undo' | 'redo';
}

export interface OpenPlan {
  info: PlanInfo;
  plan: PlanData;
  history: History;
  timings: LoadTimings;
  month: Month;
  importReport?: ImportReport;
  /** A plan held only in memory (browser preview): edits are never written anywhere. */
  inMemory?: boolean;
}

export interface RunOptions {
  /** Toast text offering Undo once the command is applied. */
  announce?: string;
}

export interface SessionState {
  recent: readonly RecentPlan[];
  open: OpenPlan | null;
  /** A long operation in progress ("Importing…"); the UI disables actions while set. */
  busy: string | null;
  toast: Toast | null;
}

/** The machine's local calendar date. The only place the UI reads the clock for "today". */
export function todayLocal(): ISODate {
  const d = new Date();
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Local "YYYY-MM-DD HH-MM", as YNAB writes it in export file names ("… as of 2026-10-08 10-55"). */
export function localStamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${todayLocal()} ${two(d.getHours())}-${two(d.getMinutes())}`;
}

const newId = uuidv7Generator(
  () => Date.now(),
  (n) => crypto.getRandomValues(new Uint8Array(n)),
);

function context(): CommandContext {
  return { now: new Date().toISOString(), today: todayLocal(), newId };
}

/** A new plan's settings from the New Plan dialog (S7.1); the session adds the dates. */
export type NewPlanSettings = Omit<PlanSettings, 'createdAt' | 'firstMonth'>;


class PlanSession {
  private state: SessionState = { recent: [], open: null, busy: null, toast: null };
  private readonly listeners = new Set<() => void>();
  private readonly sessionId = newId();
  /** Writes go to disk one at a time, in order. */
  private writes: Promise<void> = Promise.resolve();
  private toastId = 0;
  /** The day due schedules were last entered (§5.11); a new day enters the next ones. */
  private dueCheckedOn: ISODate | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SessionState => this.state;

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private setOpen(patch: Partial<OpenPlan>): void {
    if (!this.state.open) return;
    this.set({ open: { ...this.state.open, ...patch } });
  }

  notify(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']): void {
    this.toastId += 1;
    this.set({ toast: { id: this.toastId, text, tone, ...(action ? { action } : {}) } });
  }

  dismissToast(id: number): void {
    if (this.state.toast?.id === id) this.set({ toast: null });
  }

  /** Run a long operation; errors become an error toast instead of disappearing. */
  private async task(label: string, work: () => Promise<void>): Promise<void> {
    if (this.state.busy) return;
    if (!isTauri()) {
      this.notify('Plan files open in the HAFB app. This browser preview only shows sample data.');
      return;
    }
    this.set({ busy: label });
    try {
      await work();
    } catch (e) {
      this.notify(errorMessage(e), 'error');
    } finally {
      this.set({ busy: null });
    }
  }

  // ---- files -------------------------------------------------------------------------------------

  async refreshRecent(): Promise<void> {
    if (!isTauri()) return;
    try {
      this.set({ recent: await planIpc.recent() });
    } catch (e) {
      this.notify(errorMessage(e), 'error');
    }
  }

  /** Read the open file into memory and compute the current month. */
  private async loadOpened(info: PlanInfo, importReport?: ImportReport): Promise<void> {
    const t0 = performance.now();
    const tables = await planIpc.load();
    const t1 = performance.now();
    const plan = normalizePlan(decodePlan(tables));
    const t2 = performance.now();
    const today = todayLocal();
    planBudget(plan, { today });
    const t3 = performance.now();
    this.writes = Promise.resolve();
    this.set({
      open: {
        info,
        plan,
        history: emptyHistory(),
        month: monthOf(today),
        timings: { loadMs: t1 - t0, decodeMs: t2 - t1, computeMs: t3 - t2, transactions: plan.transactions.length },
        ...(importReport ? { importReport } : {}),
      },
    });
    photos.clear();
    photos.refresh().catch(() => undefined);
    if (info.migratedFrom !== null) this.notify(`Updated the file from version ${String(info.migratedFrom)}. A copy of the old file was kept.`);
    this.enterDue();
  }

  openPath(path: string): Promise<void> {
    return this.task('Opening…', async () => {
      await this.loadOpened(await planIpc.open(path));
    });
  }

  openDialog(): Promise<void> {
    return this.task('Opening…', async () => {
      const path = await planIpc.pickPlanPath('open');
      if (path !== null) await this.loadOpened(await planIpc.open(path));
    });
  }

  /** A new plan file (S7.1/S7.2), optionally starting with a template's categories. */
  createNew(settings: NewPlanSettings, template?: CategoryTemplate | null): Promise<void> {
    return this.task('Creating…', async () => {
      const path = await planIpc.pickPlanPath('save', `${settings.name}.hafb`);
      if (path === null) return;
      const ctx = context();
      const fresh = newPlan({ ...settings, firstMonth: monthOf(ctx.today), createdAt: ctx.now }, ctx);
      const plan = template ? applyChanges(fresh, importTemplate(fresh, ctx, { template, exclude: [] }).changes).plan : fresh;
      await this.loadOpened(await planIpc.create(path, encodePlan(plan), true));
    });
  }

  /**
   * Make a Fresh Start (§5.14, S7.2): this plan is renamed "(Archived on …)" and kept; a new file
   * with the same structure opens, every account at $0 today.
   */
  freshStart(name: string): Promise<void> {
    const open = this.state.open;
    if (!open || open.inMemory === true) return Promise.resolve();
    return this.task('Starting fresh…', async () => {
      await this.writes;
      const path = await planIpc.pickPlanPath('save', `${name}.hafb`);
      if (path === null) return;
      const today = todayLocal();
      const fresh = freshStartPlan(open.plan, context(), { name, today });
      this.run((pl, ctx) => archivePlan(pl, ctx, { today }));
      await this.writes;
      const archived = this.state.open?.plan.settings.name ?? open.plan.settings.name;
      await this.loadOpened(await planIpc.create(path, encodePlan(fresh), true));
      this.notify(`Your fresh start “${name}” is open. “${archived}” is kept with all its history.`);
    });
  }

  importExport(): Promise<void> {
    return this.task('Importing…', async () => {
      const zipPath = await planIpc.pickImportZip();
      if (zipPath === null) return;
      const entries = await readZip(new Uint8Array(await planIpc.readImportFile(zipPath)));
      const files = findExportFiles(entries.keys());
      const text = (name: string): string => new TextDecoder('utf-8').decode(entries.get(name));
      const ctx = context();
      const planName = files.planName || 'Imported plan';
      const { plan, report } = importYnabExport(
        { planCsv: text(files.planFile), registerCsv: text(files.registerFile) },
        { today: exportDateFromName(files.planFile) ?? ctx.today, now: ctx.now, newId, planName },
      );
      const path = await planIpc.pickPlanPath('save', `${planName}.hafb`);
      if (path === null) return;
      await this.loadOpened(await planIpc.create(path, encodePlan(plan), true), report);
    });
  }

  /**
   * Open a plan that lives only in memory (the browser preview of the shell, where no plan files
   * exist). Commands and undo work; nothing is persisted.
   */
  openInMemory(plan: PlanData, label: string): void {
    const today = todayLocal();
    this.set({
      open: {
        info: { path: label, name: plan.settings.name, schemaVersion: 1, migratedFrom: null, backupPath: null, preMigrationBackupPath: null },
        plan,
        history: emptyHistory(),
        month: monthOf(today),
        timings: { loadMs: 0, decodeMs: 0, computeMs: 0, transactions: plan.transactions.length },
        inMemory: true,
      },
    });
    this.enterDue();
  }

  close(): Promise<void> {
    if (this.state.open?.inMemory === true) {
      this.set({ open: null });
      return Promise.resolve();
    }
    return this.task('Closing…', async () => {
      await this.writes;
      await planIpc.close();
      photos.clear();
      this.set({ open: null });
      await this.refreshRecent();
    });
  }

  saveCopy(): Promise<void> {
    const open = this.state.open;
    if (!open) return Promise.resolve();
    return this.task('Saving a copy…', async () => {
      await this.writes;
      const dest = await planIpc.pickPlanPath('save', `${open.info.name} copy.hafb`);
      if (dest === null) return;
      await planIpc.saveCopy(dest);
      this.notify(`Saved a copy to ${dest}.`);
    });
  }

  listBackups(): Promise<BackupInfo[]> {
    return planIpc.backups();
  }

  restore(backup: BackupInfo): Promise<void> {
    return this.task('Restoring…', async () => {
      await this.writes;
      const info = await planIpc.restore(backup.path);
      await this.loadOpened(info);
      this.notify(`Restored the backup from ${backup.fileName}. The plan as it was before is in the backups list.`);
    });
  }

  async removeRecent(path: string): Promise<void> {
    await planIpc.removeRecent(path);
    await this.refreshRecent();
  }

  // ---- commands and undo -------------------------------------------------------------------------

  /**
   * Scheduled transactions whose date has come become real ones, unapproved, with no prompt
   * (§5.11). Runs when a plan opens and when the date changes while it is open; one undo step.
   */
  enterDue(): void {
    const open = this.state.open;
    if (!open) return;
    const ctx = context();
    this.dueCheckedOn = ctx.today;
    let command: Command | null;
    try {
      command = enterDueScheduled(open.plan, ctx);
    } catch (e) {
      this.notify(`Couldn’t enter scheduled transactions: ${errorMessage(e)}`, 'error');
      return;
    }
    if (command) this.commit(historyDo(open.history, open.plan, command.changes, command.label));
    // Loans: each month's interest, escrow and fees, posted on the 1st (S6.4).
    const now = this.state.open;
    if (!now) return;
    let charges: Command | null;
    try {
      charges = postLoanCharges(now.plan, ctx);
    } catch (e) {
      this.notify(`Couldn’t post loan interest: ${errorMessage(e)}`, 'error');
      return;
    }
    if (charges) this.commit(historyDo(now.history, now.plan, charges.changes, charges.label));
  }

  /** Enter due schedules if the calendar day has changed since the last check. */
  checkDay(): void {
    if (this.state.open && this.dueCheckedOn !== todayLocal()) this.enterDue();
  }

  setMonth(month: Month): void {
    this.setOpen({ month });
  }

  /**
   * Apply a command now (optimistic) and persist it with its undo-log row. `announce` shows a toast
   * with Undo (deletes, hides, moves: changes the user might not see happen).
   */
  run(build: (plan: PlanData, ctx: CommandContext) => Command, options: RunOptions = {}): void {
    const open = this.state.open;
    if (!open) return;
    let command: Command;
    try {
      command = build(open.plan, context());
    } catch (e) {
      this.notify(errorMessage(e), 'error');
      return;
    }
    const step = historyDo(open.history, open.plan, command.changes, command.label);
    this.commit(step, step && options.announce !== undefined ? options.announce : undefined, step && options.announce !== undefined ? 'undo' : undefined);
  }

  undo(): void {
    const open = this.state.open;
    if (!open || !canUndo(open.history)) return;
    const label = undoLabel(open.history) ?? '';
    this.commit(historyUndo(open.history, open.plan), `Undid: ${label}`, 'redo');
  }

  redo(): void {
    const open = this.state.open;
    if (!open || !canRedo(open.history)) return;
    const label = redoLabel(open.history) ?? '';
    this.commit(historyRedo(open.history, open.plan), `Redid: ${label}`, 'undo');
  }

  private commit(step: HistoryStep | null, message?: string, action?: Toast['action']): void {
    if (!step) return;
    this.setOpen({ plan: step.plan, history: step.history });
    if (message !== undefined) this.notify(message, 'info', action);
    if (this.state.open?.inMemory === true) return;
    const log = { sessionId: this.sessionId, createdAt: new Date().toISOString(), ...step.log };
    this.writes = this.writes.then(async () => {
      try {
        await planIpc.apply(step.rows, log);
      } catch (e) {
        // The file is the truth: reload it, drop the undo stack, and say what happened.
        this.notify(`Couldn’t save that change: ${errorMessage(e)}. Reloaded the plan from the file.`, 'error');
        const info = this.state.open?.info;
        if (info) await this.loadOpened(info);
      }
    });
  }
}

export const session = new PlanSession();
