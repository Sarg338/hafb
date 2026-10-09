// Transactions in YNAB's Register.csv layout (docs/ynab-references.md): Reflect's Spending exports
// put the lines behind a report in this layout, and the YNAB-format plan export (S6.6) writes the
// whole register this way so YNAB, or this app, can import it back.
import { compareDates, neg, ZERO, type Minor } from '@hafb/shared';
import { READY_TO_ASSIGN, type Id } from '@hafb/engine';
import type { PlanData, SubtransactionRecord, TransactionRecord } from '../records.ts';
import { exportDate, exportMoney, type Cell } from './csv.ts';

export const REGISTER_HEADER: readonly Cell[] = ['Account', 'Flag', 'Date', 'Payee', 'Category Group/Category', 'Category Group', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared'];

/** One line to write: a whole transaction, or one line of a split. */
export interface RegisterLineRef {
  transactionId: Id;
  subtransactionId?: Id;
}

const CLEARED = { uncleared: 'Uncleared', cleared: 'Cleared', reconciled: 'Reconciled' } as const;

const capitalized = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface Names {
  account: Map<Id, string>;
  payee: Map<Id, string>;
  category: Map<Id, { group: string; name: string }>;
}

function names(plan: PlanData): Names {
  const groups = new Map(plan.categoryGroups.map((g) => [g.id, g.name]));
  return {
    account: new Map(plan.accounts.map((a) => [a.id, a.name])),
    payee: new Map(plan.payees.map((p) => [p.id, p.name])),
    category: new Map(plan.categories.map((c) => [c.id, { group: groups.get(c.groupId) ?? '', name: c.name }])),
  };
}

function row(plan: PlanData, n: Names, tx: TransactionRecord, sub: SubtransactionRecord | undefined, index: number, count: number): Cell[] {
  const s = plan.settings;
  const transferTo = sub ? sub.transferAccountId : tx.transferAccountId;
  const payeeId = sub?.payeeId ?? tx.payeeId;
  const payee = transferTo !== undefined ? `Transfer : ${n.account.get(transferTo) ?? ''}` : payeeId === undefined ? '' : (n.payee.get(payeeId) ?? '');
  const categoryId = sub ? sub.categoryId : tx.categoryId;
  let group = '';
  let category = '';
  if (categoryId === READY_TO_ASSIGN) {
    group = 'Inflow';
    category = 'Ready to Assign';
  } else if (categoryId !== null) {
    const c = n.category.get(categoryId);
    group = c?.group ?? '';
    category = c?.name ?? '';
  }
  const memo = sub ? `Split (${String(index + 1)}/${String(count)}) ${sub.memo ?? ''}` : (tx.memo ?? '');
  const amount: Minor = sub ? sub.amount : tx.amount;
  return [
    n.account.get(tx.accountId) ?? '',
    tx.flag === undefined ? '' : capitalized(tx.flag),
    exportDate(tx.date, s),
    payee,
    category === '' ? '' : `${group}: ${category}`,
    group,
    category,
    memo,
    exportMoney(amount < 0 ? neg(amount) : ZERO, s),
    exportMoney(amount > 0 ? amount : ZERO, s),
    CLEARED[tx.cleared],
  ];
}

/**
 * Header plus one row per line. With `refs`, those lines in that order; without, every live
 * transaction newest first, a split as one row per line ("Split (k/n) memo").
 */
export function registerRows(plan: PlanData, refs?: readonly RegisterLineRef[]): Cell[][] {
  const n = names(plan);
  const byId = new Map(plan.transactions.map((t) => [t.id, t]));
  const out: Cell[][] = [[...REGISTER_HEADER]];
  const emit = (tx: TransactionRecord, subId: Id | undefined) => {
    const subs = tx.subtransactions ?? [];
    if (subs.length === 0) {
      out.push(row(plan, n, tx, undefined, 0, 0));
      return;
    }
    subs.forEach((sub, i) => {
      if (subId === undefined || sub.id === subId) out.push(row(plan, n, tx, sub, i, subs.length));
    });
  };
  if (refs) {
    for (const ref of refs) {
      const tx = byId.get(ref.transactionId);
      if (tx) emit(tx, ref.subtransactionId);
    }
    return out;
  }
  const accounts = new Set(plan.accounts.filter((a) => a.deletedAt === undefined).map((a) => a.id));
  const live = plan.transactions.filter((t) => t.deletedAt === undefined && accounts.has(t.accountId));
  // Newest first; same-day rows keep their entry order (a transfer's outflow leg first).
  const ordered = live.map((t, i) => ({ t, i })).sort((a, b) => compareDates(b.t.date, a.t.date) || a.i - b.i);
  for (const { t } of ordered) emit(t, undefined);
  return out;
}
