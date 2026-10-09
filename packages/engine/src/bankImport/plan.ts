// What happens to each row of a bank file (S6.5; CLAUDE.md §5.12, D4, D13). Pure decisions; the
// store applies them. YNAB (file import and approve/match guides):
// - Rejected or deleted imports never come back; a transaction already imported is skipped.
// - Imports with the same date and amount as an earlier import are skipped. Here that rule only
//   applies across formats (a file without bank ids against another import), so a new FITID is
//   never lost to a look-alike: ASSUMPTION, budget-math §8.6.
// - Transactions dated more than 3 days before the last reconciliation aren't imported.
// - Optionally, transactions dated before the account's start are left out.
// - An entered or scheduled transaction with exactly the same amount, dated within 10 days,
//   matches (one to one, closest date first); the bank's amount wins, the user's date, payee,
//   memo and category stay; matched transactions are approved.
import { addDays, compareDates, daysBetween, type ISODate, type Minor } from '@hafb/shared';
import type { BankRow } from './types.ts';

export const MATCH_WINDOW_DAYS = 10;
export const RECONCILED_GRACE_DAYS = 3;
const SYNTHETIC = 'file:';

/** Bank ids for rows without one: amount, date and the repeat count (two $5 coffees on one day differ). */
export function syntheticImportIds(rows: readonly BankRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.importId !== undefined && r.importId !== '') return r.importId;
    const key = `${String(r.amount)}:${r.date}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${SYNTHETIC}${key}:${String(n)}`;
  });
}

export const isSyntheticImportId = (id: string): boolean => id.startsWith(SYNTHETIC);

export interface ExistingTransaction {
  id: string;
  date: ISODate;
  amount: Minor;
  importId?: string;
  deleted?: boolean;
  /** Never a match candidate (an account's starting balance). */
  noMatch?: boolean;
}

export interface ScheduledOccurrence {
  scheduledId: string;
  date: ISODate;
  amount: Minor;
}

export interface ImportPlanInput {
  rows: readonly BankRow[];
  /** The account's transactions, deleted ones included. */
  existing: readonly ExistingTransaction[];
  /** Import ids the user rejected on this account. */
  rejected: ReadonlySet<string>;
  /** The account's next scheduled occurrences. */
  scheduled: readonly ScheduledOccurrence[];
  /** The newest reconciled transaction's date, if any. */
  reconciledThrough: ISODate | null;
  /** The account's first transaction (its start). */
  startDate: ISODate | null;
  includeBeforeStart: boolean;
}

export type SkipReason = 'duplicate' | 'deleted' | 'rejected' | 'reconciled' | 'beforeStart';

export type ImportDecision =
  | { kind: 'new' }
  | { kind: 'match'; transactionId: string }
  | { kind: 'matchScheduled'; scheduledId: string; date: ISODate }
  | { kind: 'skip'; reason: SkipReason };

const key = (date: ISODate, amount: number): string => `${date}|${String(amount)}`;

export function planImport(input: ImportPlanInput): ImportDecision[] {
  const ids = syntheticImportIds(input.rows);
  const byImportId = new Map<string, ExistingTransaction>();
  // Earlier imports per date+amount: every import counts against a row without a bank id; only
  // file-format imports count against a row that has one.
  const anyImport = new Map<string, number>();
  const syntheticImport = new Map<string, number>();
  for (const t of input.existing) {
    if (t.importId === undefined) continue;
    byImportId.set(t.importId, t);
    const k = key(t.date, t.amount);
    anyImport.set(k, (anyImport.get(k) ?? 0) + 1);
    if (isSyntheticImportId(t.importId)) syntheticImport.set(k, (syntheticImport.get(k) ?? 0) + 1);
  }
  const fileCount = new Map<string, number>();
  const usedTx = new Set<string>();
  const usedSched = new Set<string>();
  const cutoff = input.reconciledThrough === null ? null : addDays(input.reconciledThrough, -RECONCILED_GRACE_DAYS);

  return input.rows.map((row, i): ImportDecision => {
    const id = ids[i] ?? '';
    if (cutoff !== null && compareDates(row.date, cutoff) < 0) return { kind: 'skip', reason: 'reconciled' };
    if (!input.includeBeforeStart && input.startDate !== null && compareDates(row.date, input.startDate) < 0) return { kind: 'skip', reason: 'beforeStart' };
    if (input.rejected.has(id)) return { kind: 'skip', reason: 'rejected' };
    const same = byImportId.get(id);
    if (same) return { kind: 'skip', reason: same.deleted === true ? 'deleted' : 'duplicate' };
    const k = key(row.date, row.amount);
    const n = (fileCount.get(k) ?? 0) + 1;
    fileCount.set(k, n);
    const earlier = isSyntheticImportId(id) ? (anyImport.get(k) ?? 0) : (syntheticImport.get(k) ?? 0);
    if (n <= earlier) return { kind: 'skip', reason: 'duplicate' };

    let best: ExistingTransaction | undefined;
    let bestGap = Infinity;
    for (const t of input.existing) {
      if (t.deleted === true || t.noMatch === true || t.importId !== undefined || usedTx.has(t.id) || t.amount !== row.amount) continue;
      const gap = Math.abs(daysBetween(t.date, row.date));
      if (gap <= MATCH_WINDOW_DAYS && gap < bestGap) {
        best = t;
        bestGap = gap;
      }
    }
    if (best) {
      usedTx.add(best.id);
      return { kind: 'match', transactionId: best.id };
    }
    let sched: ScheduledOccurrence | undefined;
    let schedGap = Infinity;
    for (const s of input.scheduled) {
      if (usedSched.has(s.scheduledId) || s.amount !== row.amount) continue;
      const gap = Math.abs(daysBetween(s.date, row.date));
      if (gap <= MATCH_WINDOW_DAYS && gap < schedGap) {
        sched = s;
        schedGap = gap;
      }
    }
    if (sched) {
      usedSched.add(sched.scheduledId);
      return { kind: 'matchScheduled', scheduledId: sched.scheduledId, date: sched.date };
    }
    return { kind: 'new' };
  });
}
