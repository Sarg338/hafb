// Copy review (S7.5): errors people can see speak in the plan's own money format, never minor units.
import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN } from '@hafb/engine';
import { addTransaction, createAccount } from '../src/commands/index.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

describe('user-facing messages', () => {
  it('a split that does not add up names both amounts in dollars', () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const acct = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(100), date: '2026-10-01' })).accountId;
    expect(() =>
      addTransaction(b.plan, ctx, {
        accountId: acct,
        date: '2026-10-02',
        amount: usd(-15),
        payeeName: 'Shop',
        subtransactions: [
          { amount: usd(-10), categoryId: READY_TO_ASSIGN },
          { amount: usd(-2.34), categoryId: READY_TO_ASSIGN },
        ],
      }),
    ).toThrow('Split lines add up to $12.34, not $15.00');
  });
});
