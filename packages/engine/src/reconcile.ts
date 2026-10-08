// Reconciliation: CLAUDE.md §5.8. Worked examples: docs/budget-math.md §8.2.
import { compareDates, minor, type ISODate, type Minor } from '@hafb/shared';
import { ValidationError } from './errors.ts';
import { READY_TO_ASSIGN, type Account, type Id, type Transaction } from './model.ts';

export const RECONCILIATION_PAYEE = 'Reconciliation Balance Adjustment';

/** Sum of an account's live cleared and reconciled transactions, optionally up to `asOf`. */
export function clearedBalance(transactions: readonly Transaction[], accountId: Id, asOf?: ISODate): Minor {
  let total = 0;
  for (const t of transactions) {
    if (t.deleted || t.accountId !== accountId || t.cleared === 'uncleared') continue;
    if (asOf !== undefined && compareDates(t.date, asOf) > 0) continue;
    total += t.amount;
  }
  return minor(total);
}

export interface ReconciliationPlan {
  clearedBalance: Minor;
  /** statement − cleared balance. Zero means the account already agrees with the bank. */
  difference: Minor;
  /** Cleared (not yet reconciled) transactions to lock, plus the adjustment if any. */
  transactionIdsToReconcile: Id[];
  /** Present when `difference` ≠ 0. Its id is deterministic: `reconcile:<account>:<date>`. */
  adjustment?: { payeeName: string; transaction: Transaction };
}

/**
 * Compare the account's cleared balance (as of `date`) with the bank statement. A difference is
 * made up by an adjustment: Ready to Assign for on-budget accounts, uncategorized otherwise.
 */
export function planReconciliation(
  transactions: readonly Transaction[],
  account: Account,
  statementBalance: Minor,
  date: ISODate,
): ReconciliationPlan {
  if (!Number.isSafeInteger(statementBalance)) {
    throw new ValidationError(`Statement balance must be whole minor units: ${String(statementBalance)}`);
  }
  const cleared = clearedBalance(transactions, account.id, date);
  const difference = minor(statementBalance - cleared);
  const ids = transactions
    .filter((t) => !t.deleted && t.accountId === account.id && t.cleared === 'cleared' && compareDates(t.date, date) <= 0)
    .map((t) => t.id);
  if (difference === 0) return { clearedBalance: cleared, difference, transactionIdsToReconcile: ids };
  const adjustment: Transaction = {
    id: `reconcile:${account.id}:${date}`,
    accountId: account.id,
    date,
    amount: difference,
    categoryId: account.onBudget ? READY_TO_ASSIGN : null,
    cleared: 'reconciled',
    approved: true,
  };
  return {
    clearedBalance: cleared,
    difference,
    transactionIdsToReconcile: [...ids, adjustment.id],
    adjustment: { payeeName: RECONCILIATION_PAYEE, transaction: adjustment },
  };
}

/** Reconciled transactions warn before editing; editing unlocks only that one (§5.8). */
export function canEditWithoutWarning(transaction: Transaction): boolean {
  return transaction.cleared !== 'reconciled';
}
