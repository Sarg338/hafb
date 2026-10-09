// Scheduled transactions (CLAUDE.md §5.11; YNAB, observed 2026-10-08): a schedule is a transaction plus
// a frequency and its next date. It touches the plan only once entered: on its date it becomes a real
// transaction, unapproved (bold in the register); "Enter Now" enters it early; "Skip" moves it on;
// "Make Repeating" (Shift+T) schedules a copy of an existing transaction. A one-time ("Never")
// schedule is used up once entered or skipped. Entering goes through addTransaction, so transfers
// and splits follow the same rules as typed transactions.
import { nextOccurrence, READY_TO_ASSIGN, ValidationError, type CategoryRef, type FlagColor, type Frequency, type Id } from '@hafb/engine';
import { compareDates, dateParts, minor, type ISODate, type Minor } from '@hafb/shared';
import { applyChanges, mergeChangeSets } from '../changes.ts';
import type { PlanData, ScheduledSubtransactionRecord, ScheduledTransactionRecord } from '../records.ts';
import { Draft, liveAccount, liveCategory, type Command, type CommandContext } from './context.ts';
import { payeeByName, transferPayee } from './payees.ts';
import { addTransaction, type SplitLineInput, type TransactionInput } from './transactions.ts';

export interface ScheduledInput {
  accountId: Id;
  /** The next occurrence. */
  date: ISODate;
  frequency: Frequency;
  /** Signed: negative = outflow. */
  amount: Minor;
  payeeId?: Id;
  payeeName?: string;
  transferAccountId?: Id;
  categoryId?: CategoryRef;
  memo?: string;
  flag?: FlagColor;
  subtransactions?: readonly SplitLineInput[];
}

function liveScheduled(d: Draft, id: Id): ScheduledTransactionRecord {
  const s = d.get('scheduled', id);
  if (!s || s.deletedAt !== undefined) throw new ValidationError(`Unknown scheduled transaction ${id}`);
  return s;
}

function writeScheduled(d: Draft, ctx: CommandContext, id: Id, prior: ScheduledTransactionRecord | undefined, input: ScheduledInput, anchorDay?: number): ScheduledTransactionRecord {
  const account = liveAccount(d, input.accountId);
  if (!Number.isSafeInteger(input.amount)) throw new ValidationError('Amount must be whole minor units');
  const other = input.transferAccountId === undefined ? undefined : liveAccount(d, input.transferAccountId);
  if (other?.id === account.id) throw new ValidationError('A transfer needs two different accounts');
  const lines = input.subtransactions && input.subtransactions.length > 0 ? input.subtransactions : undefined;
  if (lines && other) throw new ValidationError('A split cannot itself be a transfer; make a split line the transfer');
  if (lines && lines.reduce((t, l) => t + l.amount, 0) !== input.amount) throw new ValidationError('Split lines must add up to the amount');
  // Categories follow §5.9 when entered; here a budget ↔ budget transfer and a tracking account's own rows have none.
  let categoryId: CategoryRef = lines ? null : (input.categoryId ?? null);
  if (other ? account.onBudget === other.onBudget : !account.onBudget) categoryId = null;
  if (categoryId !== null && categoryId !== READY_TO_ASSIGN) liveCategory(d, categoryId);
  const payeeId = other ? transferPayee(d, other.id).id : input.payeeId ?? (input.payeeName !== undefined && input.payeeName.trim() !== '' ? payeeByName(d, ctx, input.payeeName).id : undefined);
  const subtransactions: ScheduledSubtransactionRecord[] | undefined = lines?.map((l) => ({
    id: l.id ?? ctx.newId(),
    amount: minor(l.amount),
    categoryId: l.categoryId ?? null,
    ...(l.memo === undefined || l.memo === '' ? {} : { memo: l.memo }),
    ...(l.transferAccountId === undefined ? {} : { transferAccountId: l.transferAccountId }),
    ...(l.payeeId === undefined ? {} : { payeeId: l.payeeId }),
  }));
  const record: ScheduledTransactionRecord = {
    id,
    accountId: account.id,
    date: input.date,
    frequency: input.frequency,
    // A 31st schedule stays on the 31st after a short month (§5.11); a new date sets a new anchor.
    anchorDay: anchorDay ?? (prior?.date === input.date && prior.anchorDay !== undefined ? prior.anchorDay : dateParts(input.date).day),
    amount: minor(input.amount),
    categoryId,
    ...(other ? { transferAccountId: other.id } : {}),
    ...(payeeId === undefined ? {} : { payeeId }),
    ...(input.memo === undefined || input.memo.trim() === '' ? {} : { memo: input.memo.trim() }),
    ...(input.flag === undefined ? {} : { flag: input.flag }),
    ...(subtransactions ? { subtransactions } : {}),
  };
  d.put('scheduled', record);
  return record;
}

export function addScheduled(plan: PlanData, ctx: CommandContext, input: ScheduledInput): Command & { scheduledId: Id } {
  const d = new Draft(plan);
  const id = ctx.newId();
  writeScheduled(d, ctx, id, undefined, input);
  return { label: 'Schedule transaction', changes: d.build(), scheduledId: id };
}

export function editScheduled(plan: PlanData, ctx: CommandContext, args: { scheduledId: Id; input: ScheduledInput }): Command {
  const d = new Draft(plan);
  const prior = liveScheduled(d, args.scheduledId);
  writeScheduled(d, ctx, prior.id, prior, args.input);
  return { label: 'Edit scheduled transaction', changes: d.build() };
}

/** A schedule as editable input (the register's editor starts from it). */
export function scheduledInput(s: ScheduledTransactionRecord): ScheduledInput {
  return {
    accountId: s.accountId,
    date: s.date,
    frequency: s.frequency,
    amount: s.amount,
    ...(s.transferAccountId !== undefined ? { transferAccountId: s.transferAccountId } : s.payeeId !== undefined ? { payeeId: s.payeeId } : {}),
    categoryId: s.categoryId,
    ...(s.memo === undefined ? {} : { memo: s.memo }),
    ...(s.flag === undefined ? {} : { flag: s.flag }),
    ...(s.subtransactions?.length
      ? {
          subtransactions: s.subtransactions.map((l) => ({
            id: l.id,
            amount: l.amount,
            categoryId: l.categoryId,
            ...(l.memo === undefined ? {} : { memo: l.memo }),
            ...(l.transferAccountId === undefined ? {} : { transferAccountId: l.transferAccountId }),
            ...(l.payeeId === undefined ? {} : { payeeId: l.payeeId }),
          })),
        }
      : {}),
  };
}

/** What the selection's Categorize / Flag / Memo set on several schedules; null clears. */
export interface ScheduledBulkPatch {
  categoryId?: CategoryRef;
  flag?: FlagColor | null;
  memo?: string | null;
}

export function editScheduledMany(plan: PlanData, ctx: CommandContext, args: { scheduledIds: readonly Id[]; patch: ScheduledBulkPatch }): Command {
  const d = new Draft(plan);
  const { patch } = args;
  for (const id of args.scheduledIds) {
    const s = liveScheduled(d, id);
    const input = scheduledInput(s);
    // A split keeps its lines' categories (as for transactions, Categorize skips splits).
    if (patch.categoryId !== undefined && input.subtransactions === undefined) input.categoryId = patch.categoryId;
    if (patch.flag !== undefined) {
      if (patch.flag === null) delete input.flag;
      else input.flag = patch.flag;
    }
    if (patch.memo !== undefined) {
      if (patch.memo === null || patch.memo.trim() === '') delete input.memo;
      else input.memo = patch.memo;
    }
    writeScheduled(d, ctx, s.id, s, input);
  }
  const n = args.scheduledIds.length;
  return { label: n === 1 ? 'Edit scheduled transaction' : `Edit ${String(n)} scheduled transactions`, changes: d.build() };
}

export function deleteScheduled(plan: PlanData, ctx: CommandContext, args: { scheduledIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  for (const id of args.scheduledIds) d.put('scheduled', { ...liveScheduled(d, id), deletedAt: ctx.now });
  return { label: args.scheduledIds.length === 1 ? 'Delete scheduled transaction' : `Delete ${String(args.scheduledIds.length)} scheduled transactions`, changes: d.build() };
}

/** The schedule as a transaction on `date`. */
function entryFor(s: ScheduledTransactionRecord, date: ISODate, approved: boolean): TransactionInput {
  return {
    accountId: s.accountId,
    date,
    amount: s.amount,
    ...(s.transferAccountId !== undefined ? { transferAccountId: s.transferAccountId } : s.payeeId !== undefined ? { payeeId: s.payeeId } : {}),
    categoryId: s.categoryId,
    ...(s.memo === undefined ? {} : { memo: s.memo }),
    ...(s.flag === undefined ? {} : { flag: s.flag }),
    approved,
    scheduledTransactionId: s.id,
    ...(s.subtransactions?.length
      ? {
          subtransactions: s.subtransactions.map((l) => ({
            amount: l.amount,
            categoryId: l.categoryId,
            ...(l.memo === undefined ? {} : { memo: l.memo }),
            ...(l.transferAccountId === undefined ? {} : { transferAccountId: l.transferAccountId }),
            ...(l.payeeId === undefined ? {} : { payeeId: l.payeeId }),
          })),
        }
      : {}),
  };
}

/** Move a schedule past `date`: its next occurrence, or used up when it doesn't repeat. */
function advance(d: Draft, ctx: CommandContext, s: ScheduledTransactionRecord, date: ISODate): void {
  const next = nextOccurrence(s.frequency, date, s.anchorDay);
  d.put('scheduled', next === null ? { ...s, deletedAt: ctx.now } : { ...s, date: next });
}

/** Run commands one after another on the evolving plan; one change set (one undo step). */
function chain(plan: PlanData, steps: readonly ((p: PlanData) => Command)[]): { plan: PlanData; changes: Command['changes'] } {
  let current = plan;
  const sets: Command['changes'][] = [];
  for (const step of steps) {
    const cmd = step(current);
    current = applyChanges(current, cmd.changes).plan;
    sets.push(cmd.changes);
  }
  return { plan: current, changes: mergeChangeSets(...sets) };
}

/**
 * Enter Now (YNAB, E): enter the next occurrence immediately and move the schedule on. ASSUMPTION
 * (YNAB's help is silent): an early entry is dated today, the "early pay" case its guide describes;
 * one already due keeps its date.
 */
export function enterScheduledNow(plan: PlanData, ctx: CommandContext, args: { scheduledIds: readonly Id[] }): Command & { transactionIds: Id[] } {
  const ids: Id[] = [];
  const steps = args.scheduledIds.flatMap((sid) => [
    (p: PlanData): Command => {
      const s = liveScheduled(new Draft(p), sid);
      const date = compareDates(s.date, ctx.today) > 0 ? ctx.today : s.date;
      const cmd = addTransaction(p, ctx, entryFor(s, date, true));
      ids.push(cmd.transactionId);
      return cmd;
    },
    (p: PlanData): Command => {
      const d = new Draft(p);
      const s = liveScheduled(d, sid);
      advance(d, ctx, s, s.date);
      return { label: '', changes: d.build() };
    },
  ]);
  const { changes } = chain(plan, steps);
  return { label: args.scheduledIds.length === 1 ? 'Enter scheduled transaction' : `Enter ${String(args.scheduledIds.length)} scheduled transactions`, changes, transactionIds: ids };
}

/**
 * Enter one scheduled occurrence on its own date and move the schedule past it (an import that
 * matched it, S6.5). The entry is approved: a matched transaction needs no approval (YNAB).
 */
export function enterScheduledOccurrence(plan: PlanData, ctx: CommandContext, args: { scheduledId: Id; date: ISODate }): Command & { transactionId: Id } {
  let id = '';
  const { changes } = chain(plan, [
    (p) => {
      const cmd = addTransaction(p, ctx, entryFor(liveScheduled(new Draft(p), args.scheduledId), args.date, true));
      id = cmd.transactionId;
      return cmd;
    },
    (p) => {
      const d = new Draft(p);
      advance(d, ctx, liveScheduled(d, args.scheduledId), args.date);
      return { label: '', changes: d.build() };
    },
  ]);
  return { label: 'Enter scheduled transaction', changes, transactionId: id };
}

/** Skip the next occurrence (a one-time schedule is removed). */
export function skipScheduled(plan: PlanData, ctx: CommandContext, args: { scheduledIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  for (const id of args.scheduledIds) {
    const s = liveScheduled(d, id);
    advance(d, ctx, s, s.date);
  }
  return { label: args.scheduledIds.length === 1 ? 'Skip scheduled transaction' : `Skip ${String(args.scheduledIds.length)} scheduled transactions`, changes: d.build() };
}

/**
 * Every occurrence dated on or before today becomes a real transaction, unapproved (§5.11: bold in
 * the register, no prompt), and its schedule moves on. Null when nothing is due.
 */
export function enterDueScheduled(plan: PlanData, ctx: CommandContext): (Command & { transactionIds: Id[] }) | null {
  const ids: Id[] = [];
  const steps: ((p: PlanData) => Command)[] = [];
  for (const s0 of plan.scheduled) {
    if (s0.deletedAt !== undefined || compareDates(s0.date, ctx.today) > 0) continue;
    let date: ISODate | null = s0.date;
    for (let i = 0; date !== null && compareDates(date, ctx.today) <= 0 && i < 1000; i++) {
      const on: ISODate = date;
      steps.push((p) => {
        const cmd = addTransaction(p, ctx, entryFor(liveScheduled(new Draft(p), s0.id), on, false));
        ids.push(cmd.transactionId);
        return cmd;
      });
      steps.push((p) => {
        const d = new Draft(p);
        advance(d, ctx, liveScheduled(d, s0.id), on);
        return { label: '', changes: d.build() };
      });
      date = nextOccurrence(s0.frequency, on, s0.anchorDay ?? dateParts(s0.date).day);
    }
  }
  if (steps.length === 0) return null;
  const { changes } = chain(plan, steps);
  return { label: ids.length === 1 ? 'Enter a scheduled transaction' : `Enter ${String(ids.length)} scheduled transactions`, changes, transactionIds: ids };
}

/** Make Repeating (Shift+T): schedule a copy of a transaction, next due one period after it. */
export function makeRepeating(plan: PlanData, ctx: CommandContext, args: { transactionId: Id; frequency: Frequency }): Command & { scheduledId: Id } {
  const d = new Draft(plan);
  const t = d.get('transactions', args.transactionId);
  if (!t || t.deletedAt !== undefined) throw new ValidationError(`Unknown transaction ${args.transactionId}`);
  const next = nextOccurrence(args.frequency, t.date, dateParts(t.date).day);
  if (next === null) throw new ValidationError('Choose how often it repeats');
  const legCategory = t.transferTransactionId === undefined ? null : (d.get('transactions', t.transferTransactionId)?.categoryId ?? null);
  const id = ctx.newId();
  writeScheduled(d, ctx, id, undefined, {
    accountId: t.accountId,
    date: next,
    frequency: args.frequency,
    amount: t.amount,
    ...(t.transferAccountId !== undefined ? { transferAccountId: t.transferAccountId } : t.payeeId !== undefined ? { payeeId: t.payeeId } : {}),
    categoryId: t.categoryId ?? legCategory,
    ...(t.memo === undefined ? {} : { memo: t.memo }),
    ...(t.flag === undefined ? {} : { flag: t.flag }),
    ...(t.subtransactions?.length
      ? {
          subtransactions: t.subtransactions.map((l) => ({
            amount: l.amount,
            categoryId: l.categoryId,
            ...(l.memo === undefined ? {} : { memo: l.memo }),
            ...(l.transferAccountId === undefined ? {} : { transferAccountId: l.transferAccountId }),
            ...(l.payeeId === undefined || l.transferAccountId !== undefined ? {} : { payeeId: l.payeeId }),
          })),
        }
      : {}),
    // The schedule keeps the original day (a 31st stays the 31st).
  }, dateParts(t.date).day);
  return { label: 'Make repeating', changes: d.build(), scheduledId: id };
}
