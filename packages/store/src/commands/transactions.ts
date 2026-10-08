// Transaction commands: add/edit/delete with splits and transfers (CLAUDE.md §4, §5.9, §6.4),
// cleared, flags, approval (§5.12). Both legs of a transfer always change in one change set.
//
// Transfer rules (§5.9), per leg, decided by which side is on-budget:
//   on ↔ on:   no category on either leg.
//   on → off:  the on-budget leg carries the category (spending); the off-budget leg has none.
//   off → on:  the on-budget leg carries the category (usually Ready to Assign).
//   off ↔ off: no category.
// A split line can be a transfer too: its other leg is a whole transaction in the other account
// whose transferTransactionId is the line's id. That leg is edited through the split only.
import { READY_TO_ASSIGN, ValidationError, type CategoryRef, type ClearedState, type FlagColor, type Id } from '@hafb/engine';
import { minor, type ISODate, type Minor } from '@hafb/shared';
import type { AccountRecord, PlanData, SubtransactionRecord, TransactionRecord } from '../records.ts';
import { Draft, liveAccount, liveCategory, type Command, type CommandContext, omit } from './context.ts';
import { payeeByName, relearnDefault, transferPayee } from './payees.ts';

export interface SplitLineInput {
  /** Keep a line's id when editing; new lines get one. */
  id?: Id;
  amount: Minor;
  categoryId?: CategoryRef;
  payeeId?: Id;
  memo?: string;
  transferAccountId?: Id;
}

export interface TransactionInput {
  accountId: Id;
  date: ISODate;
  /** Signed: negative = outflow. */
  amount: Minor;
  /** An existing payee, or `payeeName` to find or create one. Ignored for transfers. */
  payeeId?: Id;
  payeeName?: string;
  /** Makes this a transfer to/from that account (the payee becomes its transfer payee). */
  transferAccountId?: Id;
  categoryId?: CategoryRef;
  memo?: string;
  cleared?: ClearedState;
  approved?: boolean;
  flag?: FlagColor;
  subtransactions?: readonly SplitLineInput[];
}

/** Fields an edit may change; `null` clears an optional field. */
export interface TransactionPatch {
  accountId?: Id;
  date?: ISODate;
  amount?: Minor;
  payeeId?: Id | null;
  payeeName?: string;
  transferAccountId?: Id | null;
  categoryId?: CategoryRef;
  memo?: string | null;
  cleared?: ClearedState;
  approved?: boolean;
  flag?: FlagColor | null;
  subtransactions?: readonly SplitLineInput[] | null;
}

/** Ready to Assign, a live category, or null; categories only on on-budget legs. */
function checkCategory(d: Draft, account: AccountRecord, categoryId: CategoryRef): CategoryRef {
  if (categoryId === null) return null;
  if (!account.onBudget) throw new ValidationError(`${account.name} is a tracking account; its transactions have no category`);
  if (categoryId !== READY_TO_ASSIGN) liveCategory(d, categoryId);
  return categoryId;
}

/** Category for (this leg, other leg) of a transfer, from the category the user chose. */
function transferCategories(d: Draft, self: AccountRecord, other: AccountRecord, chosen: CategoryRef): [CategoryRef, CategoryRef] {
  if (self.onBudget && other.onBudget) {
    if (chosen !== null) throw new ValidationError('A transfer between two budget accounts has no category');
    return [null, null];
  }
  if (self.onBudget) return [checkCategory(d, self, chosen), null];
  if (other.onBudget) return [null, checkCategory(d, other, chosen)];
  if (chosen !== null) throw new ValidationError('A transfer between two tracking accounts has no category');
  return [null, null];
}

const defaultCleared = (account: AccountRecord): ClearedState => (account.type === 'cash' ? 'cleared' : 'uncleared');

/** True when `t` is the other leg of a split line (its pair is a subtransaction, not a transaction). */
function isSplitLineLeg(d: Draft, t: TransactionRecord): boolean {
  return t.transferTransactionId !== undefined && d.get('transactions', t.transferTransactionId) === undefined;
}

function softDelete(d: Draft, ctx: CommandContext, id: Id): void {
  const t = d.get('transactions', id);
  if (t && t.deletedAt === undefined) d.put('transactions', { ...t, deletedAt: ctx.now });
}

/** Create or update the other leg of a transfer. */
function writeLeg(
  d: Draft,
  ctx: CommandContext,
  args: { legId: Id | undefined; pairId: Id; self: AccountRecord; other: AccountRecord; date: ISODate; amount: Minor; categoryId: CategoryRef; memo: string | undefined },
): Id {
  const payee = transferPayee(d, args.self.id);
  const prior = args.legId === undefined ? undefined : d.get('transactions', args.legId);
  if (prior && prior.deletedAt === undefined && prior.accountId === args.other.id) {
    const rest = omit(prior, 'categoryId');
    d.put('transactions', {
      ...rest,
      date: args.date,
      amount: minor(0 - args.amount),
      payeeId: payee.id,
      categoryId: args.categoryId,
      transferAccountId: args.self.id,
      transferTransactionId: args.pairId,
    });
    return prior.id;
  }
  if (prior && prior.deletedAt === undefined) softDelete(d, ctx, prior.id);
  const id = ctx.newId();
  d.put('transactions', {
    id,
    accountId: args.other.id,
    date: args.date,
    amount: minor(0 - args.amount),
    payeeId: payee.id,
    categoryId: args.categoryId,
    ...(args.memo === undefined ? {} : { memo: args.memo }),
    cleared: defaultCleared(args.other),
    transferAccountId: args.self.id,
    transferTransactionId: args.pairId,
    createdAt: ctx.now,
  });
  return id;
}

interface Resolved {
  accountId: Id;
  date: ISODate;
  amount: Minor;
  payeeId: Id | undefined;
  payeeName: string | undefined;
  transferAccountId: Id | undefined;
  categoryId: CategoryRef;
  memo: string | undefined;
  cleared: ClearedState;
  approved: boolean;
  flag: FlagColor | undefined;
  subtransactions: readonly SplitLineInput[] | undefined;
}

/** Write transaction `id` (new when `prior` is undefined) and everything paired with it. */
function writeTransaction(d: Draft, ctx: CommandContext, id: Id, prior: TransactionRecord | undefined, input: Resolved): void {
  const self = liveAccount(d, input.accountId);
  if (!Number.isSafeInteger(input.amount)) throw new ValidationError('Amount must be whole minor units');
  const other = input.transferAccountId === undefined ? undefined : liveAccount(d, input.transferAccountId);
  if (other?.id === self.id) throw new ValidationError('A transfer needs two different accounts');
  const lines = input.subtransactions && input.subtransactions.length > 0 ? input.subtransactions : undefined;
  if (lines && other) throw new ValidationError('A split transaction cannot itself be a transfer; make a split line the transfer');

  // Payee
  let payeeId: Id | undefined;
  if (prior && isSplitLineLeg(d, prior)) payeeId = prior.payeeId;
  else if (other) payeeId = transferPayee(d, other.id).id;
  else if (input.payeeId !== undefined) {
    const p = d.get('payees', input.payeeId);
    if (!p || p.deletedAt !== undefined) throw new ValidationError(`Unknown payee ${input.payeeId}`);
    if (p.transferAccountId !== undefined) throw new ValidationError('Use transferAccountId for a transfer');
    payeeId = p.id;
  } else if (input.payeeName !== undefined && input.payeeName.trim() !== '') {
    payeeId = payeeByName(d, ctx, input.payeeName).id;
  }

  // Category (and the other leg's)
  let categoryId: CategoryRef = null;
  let legCategory: CategoryRef = null;
  if (lines) {
    let total = 0;
    for (const l of lines) total += l.amount;
    if (total !== input.amount) throw new ValidationError(`Split lines add up to ${String(total)}, not ${String(input.amount)}`);
  } else if (other) {
    [categoryId, legCategory] = transferCategories(d, self, other, input.categoryId);
  } else {
    categoryId = checkCategory(d, self, input.categoryId);
  }

  // Split lines and their transfer legs
  const priorLines = new Map((prior?.subtransactions ?? []).map((s) => [s.id, s]));
  const keptLegs = new Set<Id>();
  const subtransactions: SubtransactionRecord[] = [];
  for (const l of lines ?? []) {
    const lineId = l.id ?? ctx.newId();
    const before = priorLines.get(lineId);
    const lineCategory = l.categoryId ?? null;
    const base: SubtransactionRecord = {
      id: lineId,
      amount: minor(l.amount),
      categoryId: null,
      ...(l.memo === undefined || l.memo === '' ? {} : { memo: l.memo }),
    };
    if (l.transferAccountId !== undefined) {
      const lineOther = liveAccount(d, l.transferAccountId);
      if (lineOther.id === self.id) throw new ValidationError('A split line cannot transfer to its own account');
      const [mine, theirs] = transferCategories(d, self, lineOther, lineCategory);
      const legId = writeLeg(d, ctx, {
        legId: before?.transferTransactionId,
        pairId: lineId,
        self,
        other: lineOther,
        date: input.date,
        amount: l.amount,
        categoryId: theirs,
        memo: l.memo,
      });
      keptLegs.add(legId);
      subtransactions.push({
        ...base,
        categoryId: mine,
        transferAccountId: lineOther.id,
        payeeId: transferPayee(d, lineOther.id).id,
        transferTransactionId: legId,
      });
    } else {
      let linePayee: Id | undefined;
      if (l.payeeId !== undefined) {
        const p = d.get('payees', l.payeeId);
        if (!p || p.deletedAt !== undefined || p.transferAccountId !== undefined) throw new ValidationError(`Unknown payee ${l.payeeId}`);
        linePayee = p.id;
      }
      subtransactions.push({ ...base, categoryId: checkCategory(d, self, lineCategory), ...(linePayee === undefined ? {} : { payeeId: linePayee }) });
    }
  }
  for (const s of priorLines.values()) {
    if (s.transferTransactionId !== undefined && !keptLegs.has(s.transferTransactionId)) softDelete(d, ctx, s.transferTransactionId);
  }

  // The main transfer leg
  const priorLeg = prior?.transferAccountId !== undefined && prior.transferTransactionId !== undefined && !isSplitLineLeg(d, prior) ? prior.transferTransactionId : undefined;
  let transferTransactionId: Id | undefined;
  if (prior && isSplitLineLeg(d, prior)) {
    transferTransactionId = prior.transferTransactionId; // edited only through its split
  } else if (other) {
    transferTransactionId = writeLeg(d, ctx, { legId: priorLeg, pairId: id, self, other, date: input.date, amount: input.amount, categoryId: legCategory, memo: input.memo });
  } else if (priorLeg !== undefined) {
    softDelete(d, ctx, priorLeg);
  }

  const record: TransactionRecord = {
    id,
    accountId: self.id,
    date: input.date,
    amount: minor(input.amount),
    ...(payeeId === undefined ? {} : { payeeId }),
    categoryId,
    ...(input.memo === undefined || input.memo === '' ? {} : { memo: input.memo }),
    cleared: input.cleared,
    ...(input.approved ? {} : { approved: false }),
    ...(input.flag === undefined ? {} : { flag: input.flag }),
    ...(other ? { transferAccountId: other.id } : prior && isSplitLineLeg(d, prior) && prior.transferAccountId !== undefined ? { transferAccountId: prior.transferAccountId } : {}),
    ...(transferTransactionId === undefined ? {} : { transferTransactionId }),
    ...(subtransactions.length > 0 ? { subtransactions } : {}),
    ...(prior?.scheduledTransactionId === undefined ? {} : { scheduledTransactionId: prior.scheduledTransactionId }),
    ...(prior?.isStartingBalance ? { isStartingBalance: true } : {}),
    ...(prior?.importId === undefined ? {} : { importId: prior.importId }),
    ...(prior?.importedPayee === undefined ? {} : { importedPayee: prior.importedPayee }),
    ...(prior?.importedMemo === undefined ? {} : { importedMemo: prior.importedMemo }),
    createdAt: prior?.createdAt ?? ctx.now,
  };
  d.put('transactions', record);
  relearnDefault(d, prior?.payeeId);
  if (payeeId !== prior?.payeeId) relearnDefault(d, payeeId);
}

export function addTransaction(plan: PlanData, ctx: CommandContext, input: TransactionInput): Command & { transactionId: Id } {
  const d = new Draft(plan);
  const account = liveAccount(d, input.accountId);
  const id = ctx.newId();
  writeTransaction(d, ctx, id, undefined, {
    accountId: input.accountId,
    date: input.date,
    amount: input.amount,
    payeeId: input.payeeId,
    payeeName: input.payeeName,
    transferAccountId: input.transferAccountId,
    categoryId: input.categoryId ?? null,
    memo: input.memo,
    cleared: input.cleared ?? defaultCleared(account),
    approved: input.approved ?? true,
    flag: input.flag,
    subtransactions: input.subtransactions,
  });
  return { label: input.transferAccountId === undefined ? 'Add transaction' : 'Add transfer', changes: d.build(), transactionId: id };
}

function liveTransaction(d: Draft, id: Id): TransactionRecord {
  const t = d.get('transactions', id);
  if (!t || t.deletedAt !== undefined) throw new ValidationError(`Unknown transaction ${id}`);
  return t;
}

const pick = <T>(patch: T | null | undefined, current: T | undefined): T | undefined => (patch === undefined ? current : patch ?? undefined);

export function editTransaction(plan: PlanData, ctx: CommandContext, args: { transactionId: Id; patch: TransactionPatch }): Command {
  const d = new Draft(plan);
  const t = liveTransaction(d, args.transactionId);
  const p = args.patch;
  if (isSplitLineLeg(d, t)) {
    const moving =
      (p.amount !== undefined && p.amount !== t.amount) ||
      (p.date !== undefined && p.date !== t.date) ||
      (p.accountId !== undefined && p.accountId !== t.accountId) ||
      p.transferAccountId !== undefined ||
      p.payeeId !== undefined ||
      p.payeeName !== undefined ||
      p.subtransactions !== undefined;
    if (moving) throw new ValidationError('This transfer comes from a split; edit its amount, date, payee or account in the split');
  }
  const changingPayee = p.payeeId !== undefined || p.payeeName !== undefined;
  const subtransactions =
    p.subtransactions === undefined
      ? t.subtransactions?.map((s) => ({
          id: s.id,
          amount: s.amount,
          categoryId: s.categoryId,
          ...(s.payeeId === undefined || s.transferAccountId !== undefined ? {} : { payeeId: s.payeeId }),
          ...(s.memo === undefined ? {} : { memo: s.memo }),
          ...(s.transferAccountId === undefined ? {} : { transferAccountId: s.transferAccountId }),
        }))
      : p.subtransactions ?? undefined;
  const transferAccountId = p.transferAccountId === undefined ? (isSplitLineLeg(d, t) ? undefined : t.transferAccountId) : p.transferAccountId ?? undefined;
  // A transfer's category lives on the on-budget leg; read it from there when not given.
  let categoryId: CategoryRef = p.categoryId === undefined ? t.categoryId : p.categoryId;
  if (p.categoryId === undefined && t.transferAccountId !== undefined && !t.subtransactions?.length && t.transferTransactionId !== undefined && !isSplitLineLeg(d, t)) {
    const leg = d.get('transactions', t.transferTransactionId);
    if (leg && leg.categoryId !== null) categoryId = leg.categoryId;
  }
  if (subtransactions && subtransactions.length > 0 && p.categoryId === undefined) categoryId = null;
  writeTransaction(d, ctx, t.id, t, {
    accountId: p.accountId ?? t.accountId,
    date: p.date ?? t.date,
    amount: p.amount ?? t.amount,
    payeeId: changingPayee ? pick(p.payeeId, undefined) : transferAccountId === undefined && t.transferAccountId === undefined ? t.payeeId : undefined,
    payeeName: p.payeeName,
    transferAccountId: isSplitLineLeg(d, t) ? undefined : transferAccountId,
    categoryId: isSplitLineLeg(d, t) ? t.categoryId : categoryId,
    memo: pick(p.memo, t.memo),
    cleared: p.cleared ?? t.cleared,
    approved: p.approved ?? t.approved !== false,
    flag: pick(p.flag, t.flag),
    subtransactions,
  });
  return { label: 'Edit transaction', changes: d.build() };
}

/** Soft-delete transactions and their transfer legs (both sides, §5.9). */
export function deleteTransactions(plan: PlanData, ctx: CommandContext, args: { transactionIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  for (const id of args.transactionIds) {
    const t = liveTransaction(d, id);
    if (isSplitLineLeg(d, t) && !args.transactionIds.some((x) => d.get('transactions', x)?.subtransactions?.some((s) => s.id === t.transferTransactionId))) {
      throw new ValidationError('This transfer comes from a split; delete the line in the split');
    }
    softDelete(d, ctx, t.id);
    if (t.transferTransactionId !== undefined && !isSplitLineLeg(d, t)) softDelete(d, ctx, t.transferTransactionId);
    for (const s of t.subtransactions ?? []) if (s.transferTransactionId !== undefined) softDelete(d, ctx, s.transferTransactionId);
    relearnDefault(d, t.payeeId);
  }
  return { label: args.transactionIds.length === 1 ? 'Delete transaction' : `Delete ${String(args.transactionIds.length)} transactions`, changes: d.build() };
}

export function setCleared(plan: PlanData, _ctx: CommandContext, args: { transactionIds: readonly Id[]; cleared: ClearedState }): Command {
  const d = new Draft(plan);
  for (const id of args.transactionIds) {
    const t = liveTransaction(d, id);
    if (t.cleared !== args.cleared) d.put('transactions', { ...t, cleared: args.cleared });
  }
  return { label: args.cleared === 'uncleared' ? 'Mark uncleared' : args.cleared === 'cleared' ? 'Mark cleared' : 'Mark reconciled', changes: d.build() };
}

export function setFlag(plan: PlanData, _ctx: CommandContext, args: { transactionIds: readonly Id[]; flag: FlagColor | null }): Command {
  const d = new Draft(plan);
  for (const id of args.transactionIds) {
    const t = liveTransaction(d, id);
    const rest = omit(t, 'flag');
    d.put('transactions', args.flag === null ? rest : { ...rest, flag: args.flag });
  }
  return { label: args.flag === null ? 'Clear flag' : 'Set flag', changes: d.build() };
}

/** Name a flag colour (YNAB's custom flag names); an empty name goes back to the colour. */
export function setFlagName(plan: PlanData, _ctx: CommandContext, args: { color: FlagColor; name: string }): Command {
  const d = new Draft(plan);
  const name = args.name.trim();
  if (name === '') {
    if (d.get('flagNames', args.color)) d.remove('flagNames', args.color);
  } else {
    d.put('flagNames', { color: args.color, name });
  }
  return { label: name === '' ? 'Clear flag name' : `Name flag: ${name}`, changes: d.build() };
}

/** Approve transactions; approving one leg of a transfer approves the other (§5.12). */
export function approveTransactions(plan: PlanData, _ctx: CommandContext, args: { transactionIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  const approve = (t: TransactionRecord): void => {
    if (t.approved !== false) return;
    const rest = omit(t, 'approved');
    d.put('transactions', rest);
  };
  for (const id of args.transactionIds) {
    const t = liveTransaction(d, id);
    approve(t);
    if (t.transferTransactionId !== undefined) {
      const leg = d.get('transactions', t.transferTransactionId);
      if (leg && leg.deletedAt === undefined) approve(leg);
      else {
        // The pair is a split line: approve its parent.
        const parent = d.all('transactions').find((x) => x.subtransactions?.some((s) => s.id === t.transferTransactionId));
        if (parent && parent.deletedAt === undefined) approve(parent);
      }
    }
    for (const s of t.subtransactions ?? []) {
      const leg = s.transferTransactionId === undefined ? undefined : d.get('transactions', s.transferTransactionId);
      if (leg && leg.deletedAt === undefined) approve(leg);
    }
  }
  return { label: 'Approve', changes: d.build() };
}
