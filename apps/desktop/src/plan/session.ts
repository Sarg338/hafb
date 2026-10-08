// The open plan for this window: file lifecycle, commands with undo, and persistence (S2.3/S2.5).
// Framework-free; React reads it through useSyncExternalStore. No budget math here: commands come
// from @hafb/store and numbers from the engine (CLAUDE.md §10).
import {
  canRedo,
  canUndo,
  decodePlan,
  emptyHistory,
  encodePlan,
  exportDateFromName,
  findExportFiles,
  historyDo,
  historyRedo,
  historyUndo,
  importYnabExport,
  newPlan,
  normalizePlan,
  planBudget,
  readZip,
  redoLabel,
  undoLabel,
  type Command,
  type CommandContext,
  type History,
  type HistoryStep,
  type ImportReport,
  type PlanData,
  type PlanSettings,
} from '@hafb/store';
import { makeDate, monthOf, uuidv7Generator, type ISODate, type Month } from '@hafb/shared';
import { errorMessage, planIpc, type BackupInfo, type PlanInfo, type RecentPlan } from './ipc.ts';

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
}

export interface OpenPlan {
  info: PlanInfo;
  plan: PlanData;
  history: History;
  timings: LoadTimings;
  month: Month;
  importReport?: ImportReport;
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

const newId = uuidv7Generator(
  () => Date.now(),
  (n) => crypto.getRandomValues(new Uint8Array(n)),
);

function context(): CommandContext {
  return { now: new Date().toISOString(), today: todayLocal(), newId };
}

// Settings screen arrives in Phase 7; new plans start in US dollars.
const DEFAULT_SETTINGS: Omit<PlanSettings, 'name' | 'createdAt' | 'firstMonth'> = {
  currencyCode: 'USD',
  currencyDecimals: 2,
  currencySymbol: '$',
  symbolPlacement: 'before',
  numberFormat: '123,456.78',
  dateFormat: 'MM/DD/YYYY',
};

class PlanSession {
  private state: SessionState = { recent: [], open: null, busy: null, toast: null };
  private readonly listeners = new Set<() => void>();
  private readonly sessionId = newId();
  /** Writes go to disk one at a time, in order. */
  private writes: Promise<void> = Promise.resolve();
  private toastId = 0;

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

  notify(text: string, tone: Toast['tone'] = 'info'): void {
    this.toastId += 1;
    this.set({ toast: { id: this.toastId, text, tone } });
  }

  dismissToast(id: number): void {
    if (this.state.toast?.id === id) this.set({ toast: null });
  }

  /** Run a long operation; errors become an error toast instead of disappearing. */
  private async task(label: string, work: () => Promise<void>): Promise<void> {
    if (this.state.busy) return;
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
    if (info.migratedFrom !== null) this.notify(`Updated the file from version ${String(info.migratedFrom)}. A copy of the old file was kept.`);
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

  createNew(name: string): Promise<void> {
    return this.task('Creating…', async () => {
      const path = await planIpc.pickPlanPath('save', `${name}.hafb`);
      if (path === null) return;
      const ctx = context();
      const plan = newPlan({ ...DEFAULT_SETTINGS, name, firstMonth: monthOf(ctx.today), createdAt: ctx.now }, ctx);
      await this.loadOpened(await planIpc.create(path, encodePlan(plan), true));
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

  close(): Promise<void> {
    return this.task('Closing…', async () => {
      await this.writes;
      await planIpc.close();
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
      this.notify(`Saved a copy to ${dest}`);
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

  setMonth(month: Month): void {
    this.setOpen({ month });
  }

  /** Apply a command now (optimistic) and persist it with its undo-log row. */
  run(build: (plan: PlanData, ctx: CommandContext) => Command): void {
    const open = this.state.open;
    if (!open) return;
    let command: Command;
    try {
      command = build(open.plan, context());
    } catch (e) {
      this.notify(errorMessage(e), 'error');
      return;
    }
    this.commit(historyDo(open.history, open.plan, command.changes, command.label));
  }

  undo(): void {
    const open = this.state.open;
    if (!open || !canUndo(open.history)) return;
    const label = undoLabel(open.history) ?? '';
    this.commit(historyUndo(open.history, open.plan), `Undid: ${label}`);
  }

  redo(): void {
    const open = this.state.open;
    if (!open || !canRedo(open.history)) return;
    const label = redoLabel(open.history) ?? '';
    this.commit(historyRedo(open.history, open.plan), `Redid: ${label}`);
  }

  private commit(step: HistoryStep | null, message?: string): void {
    if (!step) return;
    this.setOpen({ plan: step.plan, history: step.history });
    if (message !== undefined) this.notify(message);
    const log = { sessionId: this.sessionId, createdAt: new Date().toISOString(), ...step.log };
    this.writes = this.writes.then(async () => {
      try {
        await planIpc.apply(step.rows, log);
      } catch (e) {
        // The file is the truth: reload it, drop the undo stack, and say what happened.
        this.notify(`Couldn't save that change: ${errorMessage(e)}. Reloaded the plan from the file.`, 'error');
        const info = this.state.open?.info;
        if (info) await this.loadOpened(info);
      }
    });
  }
}

export const session = new PlanSession();
