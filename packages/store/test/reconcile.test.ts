import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN, RECONCILIATION_PAYEE } from '@hafb/engine';
import { addTransaction, createAccount, createCategory, createGroup, reconcileAccount, reconcilePreview, setCleared } from '../src/commands/index.ts';
import { Bench, blankPlan, makeCtx, TODAY, usd } from './helpers/harness.ts';

describe('reconcile (§5.8)', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(1000), date: '2026-10-01' })).accountId;
    const house = b.run(createAccount(b.plan, ctx, { name: 'House', type: 'asset', startingBalance: usd(300000), date: '2026-10-01' })).accountId;
    const g = b.run(createGroup(b.plan, ctx, { name: 'Needs' })).groupId;
    const food = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Food' })).categoryId;
    const cleared = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-05', amount: usd(-40), payeeName: 'Grocer', categoryId: food, cleared: 'cleared' })).transactionId;
    const pending = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-06', amount: usd(-25), payeeName: 'Cafe', categoryId: food })).transactionId;
    return { ctx, b, checking, house, cleared, pending };
  };
  const tx = (b: Bench, id: string) => b.plan.transactions.find((t) => t.id === id);

  it('Yes: the cleared balance matches; every cleared transaction locks, uncleared ones stay', () => {
    const { ctx, b, checking, cleared, pending } = setup();
    // The starting balance was entered uncleared in a checking account; clear it like the bank did.
    const start = b.plan.transactions.find((t) => t.accountId === checking && t.isStartingBalance === true)?.id ?? '';
    b.run(setCleared(b.plan, ctx, { transactionIds: [start], cleared: 'cleared' }));
    expect(reconcilePreview(b.plan, { accountId: checking, statementBalance: usd(960), date: TODAY })).toEqual({ clearedBalance: usd(960), difference: 0 });
    const cmd = b.run(reconcileAccount(b.plan, ctx, { accountId: checking, statementBalance: usd(960) }));
    expect(cmd.adjustmentId).toBeNull();
    expect(tx(b, cleared)?.cleared).toBe('reconciled');
    expect(tx(b, start)?.cleared).toBe('reconciled');
    expect(tx(b, pending)?.cleared).toBe('uncleared');
    expect(b.plan.accounts.find((a) => a.id === checking)?.lastReconciledAt).toBe(ctx.now);
    expect(b.plan.reconciliations).toEqual([expect.objectContaining({ accountId: checking, date: TODAY, statementBalance: usd(960) })]);
  });

  it('a difference adds a Ready to Assign adjustment, locked; a tracking account’s has no category', () => {
    const { ctx, b, checking, house } = setup();
    const start = b.plan.transactions.find((t) => t.accountId === checking && t.isStartingBalance === true)?.id ?? '';
    b.run(setCleared(b.plan, ctx, { transactionIds: [start], cleared: 'cleared' }));
    expect(reconcilePreview(b.plan, { accountId: checking, statementBalance: usd(900), date: TODAY }).difference).toBe(usd(-60));
    const { adjustmentId } = b.run(reconcileAccount(b.plan, ctx, { accountId: checking, statementBalance: usd(900) }));
    const adj = tx(b, adjustmentId ?? '');
    expect(adj).toMatchObject({ amount: usd(-60), categoryId: READY_TO_ASSIGN, cleared: 'reconciled', date: TODAY });
    expect(b.plan.payees.find((p) => p.id === adj?.payeeId)?.name).toBe(RECONCILIATION_PAYEE);
    expect(b.plan.reconciliations.at(-1)?.adjustmentTransactionId).toBe(adjustmentId);
    const houseAdj = b.run(reconcileAccount(b.plan, ctx, { accountId: house, statementBalance: usd(310000) })).adjustmentId;
    expect(tx(b, houseAdj ?? '')).toMatchObject({ amount: usd(10000), categoryId: null });
  });
});
