// Reconcile (CLAUDE.md §5.8; YNAB, observed 2026-10-08): "Is your current balance $X?" Yes locks
// every cleared transaction; No asks for the bank's balance, and finishing with a difference adds
// a "Reconciliation Balance Adjustment" (Ready to Assign on budget accounts, no category on
// tracking accounts) before locking. One undo step, logged as a Reconciliation.
import { planReconciliation, RECONCILIATION_PAYEE, READY_TO_ASSIGN, ValidationError, type Id } from '@hafb/engine';
import type { ISODate, Minor } from '@hafb/shared';
import { applyChanges, mergeChangeSets } from '../changes.ts';
import type { PlanData } from '../records.ts';
import { Draft, liveAccount, type Command, type CommandContext } from './context.ts';
import { addTransaction } from './transactions.ts';

/** The account's cleared balance and the difference to a statement balance (the banner's numbers). */
export function reconcilePreview(plan: PlanData, args: { accountId: Id; statementBalance: Minor; date: ISODate }): { clearedBalance: Minor; difference: Minor } {
  const account = plan.accounts.find((a) => a.id === args.accountId && a.deletedAt === undefined);
  if (!account) throw new ValidationError(`Unknown account ${args.accountId}`);
  const live = plan.transactions.filter((t) => t.deletedAt === undefined && t.accountId === account.id);
  const p = planReconciliation(live, account, args.statementBalance, args.date);
  return { clearedBalance: p.clearedBalance, difference: p.difference };
}

export function reconcileAccount(plan: PlanData, ctx: CommandContext, args: { accountId: Id; statementBalance: Minor; date?: ISODate }): Command & { adjustmentId: Id | null } {
  const date = args.date ?? ctx.today;
  const account = liveAccount(new Draft(plan), args.accountId);
  if (account.closed === true) throw new ValidationError('Reopen the account to reconcile it');
  const live = plan.transactions.filter((t) => t.deletedAt === undefined && t.accountId === account.id);
  const p = planReconciliation(live, account, args.statementBalance, date);
  let current = plan;
  const sets = [];
  let adjustmentId: Id | null = null;
  if (p.adjustment) {
    const add = addTransaction(current, ctx, {
      accountId: account.id,
      date,
      amount: p.difference,
      payeeName: RECONCILIATION_PAYEE,
      categoryId: account.onBudget ? READY_TO_ASSIGN : null,
      cleared: 'reconciled',
      approved: true,
    });
    adjustmentId = add.transactionId;
    current = applyChanges(current, add.changes).plan;
    sets.push(add.changes);
  }
  const d = new Draft(current);
  const lock = new Set(p.transactionIdsToReconcile);
  for (const t of live) if (lock.has(t.id)) d.put('transactions', { ...t, cleared: 'reconciled' });
  d.put('reconciliations', {
    id: ctx.newId(),
    accountId: account.id,
    date,
    statementBalance: args.statementBalance,
    ...(adjustmentId === null ? {} : { adjustmentTransactionId: adjustmentId }),
    createdAt: ctx.now,
  });
  d.put('accounts', { ...account, lastReconciledAt: ctx.now });
  sets.push(d.build());
  return { label: `Reconcile ${account.name}`, changes: mergeChangeSets(...sets), adjustmentId };
}
