// Bank file import (S6.5; CLAUDE.md §5.12, D4, D13): turn the engine's decisions into changes.
// YNAB (file import and approve/match guides, 2026):
// - Imported transactions arrive unapproved (they still count) and cleared, categorized from the
//   payee's usual category; payee names are cleaned and renaming rules apply; imported inflows
//   to cash accounts default to Ready to Assign.
// - An entered or scheduled transaction with the same amount within 10 days matches: the bank's
//   amount wins, the user's date, payee, memo and category stay, and it's approved.
// - Only unapproved imports can be rejected; rejected or deleted imports never re-import.
// - Match by hand (one imported + one entered) and Unmatch (both come back as they were).
// - Card payments imported on both sides (checking out, card in, same amount within a few days)
//   pair into a transfer.
import {
  applyRenameRules,
  cleansePayee,
  isCreditAccountType,
  planImport,
  READY_TO_ASSIGN,
  suggestCategory,
  syntheticImportIds,
  ValidationError,
  type BankRow,
  type CategoryRef,
  type Id,
  type ImportDecision,
  type ImportPlanInput,
  type SkipReason,
} from '@hafb/engine';
import { compareDates, daysBetween, neg, type ISODate } from '@hafb/shared';
import { applyChanges, mergeChangeSets } from '../changes.ts';
import type { AccountRecord, JsonValue, PayeeRecord, PlanData, TransactionRecord } from '../records.ts';
import { Draft, liveAccount, omit, type Command, type CommandContext } from './context.ts';
import { payeeByName, transferPayee } from './payees.ts';
import { enterScheduledOccurrence } from './scheduled.ts';

/** Card payments pair when both sides land within this many days. */
export const PAYMENT_PAIR_DAYS = 3;

export interface ImportArgs {
  accountId: Id;
  rows: readonly BankRow[];
  /** YNAB's option: import transactions dated before the account's start. */
  includeBeforeStart: boolean;
}

export interface BankImportReport {
  imported: number;
  matched: number;
  skipped: number;
  reasons: Partial<Record<SkipReason, number>>;
  /** Card payments paired into transfers. */
  paired: number;
}

function planInput(plan: PlanData, account: AccountRecord): Omit<ImportPlanInput, 'rows' | 'includeBeforeStart'> {
  const txs = plan.transactions.filter((t) => t.accountId === account.id);
  const live = txs.filter((t) => t.deletedAt === undefined);
  let reconciledThrough: ISODate | null = null;
  let startDate: ISODate | null = null;
  for (const t of live) {
    if (t.cleared === 'reconciled' && (reconciledThrough === null || compareDates(t.date, reconciledThrough) > 0)) reconciledThrough = t.date;
    if (startDate === null || compareDates(t.date, startDate) < 0) startDate = t.date;
  }
  return {
    existing: txs.map((t) => ({ id: t.id, date: t.date, amount: t.amount, ...(t.importId === undefined ? {} : { importId: t.importId }), ...(t.deletedAt === undefined ? {} : { deleted: true }), ...(t.isStartingBalance === true ? { noMatch: true } : {}) })),
    rejected: new Set(plan.rejectedImports.filter((r) => r.accountId === account.id).map((r) => r.importId)),
    scheduled: plan.scheduled.filter((s) => s.deletedAt === undefined && s.accountId === account.id).map((s) => ({ scheduledId: s.id, date: s.date, amount: s.amount })),
    reconciledThrough,
    startDate,
  };
}

function liveRules(plan: PlanData) {
  return plan.payeeRenameRules.toSorted((a, b) => a.sortOrder - b.sortOrder);
}

/** The payee an import gets: a renaming rule's target, else the cleaned bank name. */
function payeeTarget(plan: PlanData, raw: string): { payee?: PayeeRecord; name: string } {
  const rule = raw === '' ? null : applyRenameRules(raw, liveRules(plan));
  const target = rule ? plan.payees.find((p) => p.id === rule.targetPayeeId && p.deletedAt === undefined) : undefined;
  if (target) return { payee: target, name: target.name };
  return { name: cleansePayee(raw) };
}

function importedCategory(account: AccountRecord, payee: PayeeRecord | undefined, amount: number): CategoryRef {
  if (!account.onBudget) return null;
  const suggested = payee ? suggestCategory(payee) : null;
  if (suggested !== null) return suggested;
  // Imported inflows to cash accounts go to Ready to Assign (D13); a card's inflows stay open.
  return amount > 0 && !isCreditAccountType(account.type) ? READY_TO_ASSIGN : null;
}

export interface PreviewRow {
  row: BankRow;
  importId: string;
  /** The payee it will get (after renaming rules and cleanup). */
  payee: string;
  decision: ImportDecision;
}

/** What an import would do, row by row, without changing anything (the Import Transactions preview). */
export function previewImport(plan: PlanData, args: ImportArgs): PreviewRow[] {
  const account = plan.accounts.find((a) => a.id === args.accountId && a.deletedAt === undefined);
  if (!account) throw new ValidationError(`Unknown account ${args.accountId}`);
  const decisions = planImport({ ...planInput(plan, account), rows: args.rows, includeBeforeStart: args.includeBeforeStart });
  const ids = syntheticImportIds(args.rows);
  return args.rows.map((row, i) => ({ row, importId: ids[i] ?? '', payee: payeeTarget(plan, row.payee).name, decision: decisions[i] ?? { kind: 'new' } }));
}

/** The bank's facts, copied onto a transaction that matched it. */
function matchedFields(t: TransactionRecord, imp: { importId: string; payee: string; memo: string; date: ISODate; amount: TransactionRecord['amount'] }, now: string): TransactionRecord {
  const base = omit(t, 'approved');
  return {
    ...base,
    amount: imp.amount,
    importId: imp.importId,
    ...(imp.payee === '' ? {} : { importedPayee: imp.payee }),
    ...(imp.memo === '' ? {} : { importedMemo: imp.memo }),
    importedDate: imp.date,
    importedAmount: imp.amount,
    enteredAmount: t.amount,
    matchedAt: now,
  };
}

function newImport(d: Draft, ctx: CommandContext, plan: PlanData, account: AccountRecord, row: BankRow, importId: string): TransactionRecord {
  const target = payeeTarget(plan, row.payee);
  const payee = target.payee ?? (target.name === '' ? undefined : payeeByName(d, ctx, target.name));
  return {
    id: ctx.newId(),
    accountId: account.id,
    date: row.date,
    amount: row.amount,
    ...(payee ? { payeeId: payee.id } : {}),
    categoryId: importedCategory(account, payee, row.amount),
    ...(row.memo === '' ? {} : { memo: row.memo }),
    cleared: 'cleared',
    approved: false,
    importId,
    ...(row.payee === '' ? {} : { importedPayee: row.payee }),
    ...(row.memo === '' ? {} : { importedMemo: row.memo }),
    importedDate: row.date,
    importedAmount: row.amount,
    createdAt: ctx.now,
  };
}

/** Pair unapproved imported card payments: cash out and card in, same amount, within a few days. */
function pairCardPayments(d: Draft, accounts: Map<Id, AccountRecord>, newIds: ReadonlySet<Id>): number {
  const pairable = (t: TransactionRecord): boolean =>
    t.deletedAt === undefined && t.approved === false && t.importId !== undefined && t.transferAccountId === undefined && (t.subtransactions ?? []).length === 0 && (t.categoryId === null || t.categoryId === READY_TO_ASSIGN);
  const all = d.all('transactions').filter(pairable);
  const used = new Set<Id>();
  let paired = 0;
  for (const n of all.filter((t) => newIds.has(t.id))) {
    if (used.has(n.id)) continue;
    const na = accounts.get(n.accountId);
    if (!na?.onBudget) continue;
    const nCard = isCreditAccountType(na.type);
    const other = all.find((o) => {
      if (o.id === n.id || used.has(o.id) || o.accountId === n.accountId || o.amount !== neg(n.amount)) return false;
      const oa = accounts.get(o.accountId);
      if (!oa?.onBudget || isCreditAccountType(oa.type) === nCard) return false;
      const card = nCard ? n : o;
      return card.amount > 0 && Math.abs(daysBetween(o.date, n.date)) <= PAYMENT_PAIR_DAYS;
    });
    if (!other) continue;
    used.add(n.id);
    used.add(other.id);
    for (const [leg, to] of [
      [n, other],
      [other, n],
    ] as const) {
      d.put('transactions', { ...leg, categoryId: null, transferAccountId: to.accountId, transferTransactionId: to.id, payeeId: transferPayee(d, to.accountId).id });
    }
    paired += 1;
  }
  return paired;
}

/** Import bank rows into an account: new ones unapproved, matches approved, the rest skipped. One undo step. */
export function importBankRows(plan: PlanData, ctx: CommandContext, args: ImportArgs): Command & { report: BankImportReport; transactionIds: Id[] } {
  const account = liveAccount(new Draft(plan), args.accountId);
  const decisions = planImport({ ...planInput(plan, account), rows: args.rows, includeBeforeStart: args.includeBeforeStart });
  const ids = syntheticImportIds(args.rows);
  const report: BankImportReport = { imported: 0, matched: 0, skipped: 0, reasons: {}, paired: 0 };
  // Scheduled matches enter first (each is its own command); the rest edits one draft on top.
  let current = plan;
  const sets: Command['changes'][] = [];
  const scheduledEntries = new Map<number, Id>();
  decisions.forEach((dec, i) => {
    if (dec.kind !== 'matchScheduled') return;
    const cmd = enterScheduledOccurrence(current, ctx, { scheduledId: dec.scheduledId, date: dec.date });
    current = applyChanges(current, cmd.changes).plan;
    sets.push(cmd.changes);
    scheduledEntries.set(i, cmd.transactionId);
  });
  const d = new Draft(current);
  const created: Id[] = [];
  decisions.forEach((dec, i) => {
    const row = args.rows[i];
    const importId = ids[i];
    if (!row || importId === undefined) return;
    if (dec.kind === 'skip') {
      report.skipped += 1;
      report.reasons[dec.reason] = (report.reasons[dec.reason] ?? 0) + 1;
      return;
    }
    if (dec.kind === 'new') {
      const t = newImport(d, ctx, current, account, row, importId);
      d.put('transactions', t);
      created.push(t.id);
      report.imported += 1;
      return;
    }
    const targetId = dec.kind === 'match' ? dec.transactionId : scheduledEntries.get(i);
    const t = targetId === undefined ? undefined : d.get('transactions', targetId);
    if (!t) return;
    d.put('transactions', matchedFields(t, { importId, payee: row.payee, memo: row.memo, date: row.date, amount: row.amount }, ctx.now));
    report.matched += 1;
  });
  report.paired = pairCardPayments(d, new Map(d.all('accounts').map((a) => [a.id, a])), new Set(created));
  sets.push(d.build());
  const n = report.imported + report.matched;
  return {
    label: n === 0 ? 'Import transactions' : `Import ${String(n)} transaction${n === 1 ? '' : 's'} into ${account.name}`,
    changes: mergeChangeSets(...sets),
    report,
    transactionIds: created,
  };
}

/** Reject unapproved imports: they're removed and never import again (YNAB). */
export function rejectImports(plan: PlanData, ctx: CommandContext, args: { transactionIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  const reject = (t: TransactionRecord): void => {
    if (t.deletedAt !== undefined) return;
    d.put('transactions', { ...t, deletedAt: ctx.now });
    if (t.importId !== undefined && !d.all('rejectedImports').some((r) => r.accountId === t.accountId && r.importId === t.importId)) {
      d.put('rejectedImports', { accountId: t.accountId, importId: t.importId });
    }
  };
  for (const id of args.transactionIds) {
    const t = d.get('transactions', id);
    if (!t || t.deletedAt !== undefined) throw new ValidationError(`Unknown transaction ${id}`);
    if (t.importId === undefined || t.approved !== false) throw new ValidationError('Only unapproved imported transactions can be rejected');
    reject(t);
    // A paired card payment goes with its other side.
    const leg = t.transferTransactionId === undefined ? undefined : d.get('transactions', t.transferTransactionId);
    if (leg) reject(leg);
  }
  return { label: args.transactionIds.length === 1 ? 'Reject transaction' : `Reject ${String(args.transactionIds.length)} transactions`, changes: d.build() };
}

/** Match by hand: an imported transaction and one the user entered in the same account. */
export function matchTransactions(plan: PlanData, ctx: CommandContext, args: { importedId: Id; enteredId: Id }): Command {
  const d = new Draft(plan);
  const imp = d.get('transactions', args.importedId);
  const entered = d.get('transactions', args.enteredId);
  if (!imp || imp.deletedAt !== undefined || imp.importId === undefined || imp.matchedAt !== undefined || imp.id === args.enteredId) throw new ValidationError('Pick one imported transaction and one you entered');
  if (!entered || entered.deletedAt !== undefined || entered.importId !== undefined) throw new ValidationError('Pick one imported transaction and one you entered');
  if (entered.accountId !== imp.accountId) throw new ValidationError('Both transactions must be in the same account');
  if (entered.amount !== imp.amount && ((entered.subtransactions ?? []).length > 0 || entered.transferTransactionId !== undefined)) {
    throw new ValidationError('A split or a transfer can only match an import of the same amount');
  }
  d.put('transactions', matchedFields(entered, { importId: imp.importId, payee: imp.importedPayee ?? '', memo: imp.importedMemo ?? '', date: imp.importedDate ?? imp.date, amount: imp.importedAmount ?? imp.amount }, ctx.now));
  d.remove('transactions', imp.id);
  return { label: 'Match transactions', changes: d.build() };
}

/** Undo a match: the entered transaction goes back to what the user typed; the import returns unapproved. */
export function unmatchTransaction(plan: PlanData, ctx: CommandContext, args: { transactionId: Id }): Command {
  const d = new Draft(plan);
  const t = d.get('transactions', args.transactionId);
  if (!t || t.deletedAt !== undefined || t.matchedAt === undefined || t.importId === undefined) throw new ValidationError('That transaction isn’t matched');
  const account = liveAccount(d, t.accountId);
  const restored = omit(t, 'importId', 'importedPayee', 'importedMemo', 'importedDate', 'importedAmount', 'matchedAt', 'enteredAmount');
  d.put('transactions', { ...restored, amount: t.enteredAmount ?? t.amount });
  const row: BankRow = { date: t.importedDate ?? t.date, amount: t.importedAmount ?? t.amount, payee: t.importedPayee ?? '', memo: t.importedMemo ?? '' };
  d.put('transactions', newImport(d, ctx, plan, account, row, t.importId));
  return { label: 'Unmatch transactions', changes: d.build() };
}

/** Remember an account's CSV column mapping ("Remember setting for this account"). */
export function saveImportProfile(plan: PlanData, _ctx: CommandContext, args: { accountId: Id; profile: JsonValue }): Command {
  const d = new Draft(plan);
  liveAccount(d, args.accountId);
  d.put('importProfiles', { accountId: args.accountId, profile: args.profile });
  return { label: 'Save import settings', changes: d.build() };
}
