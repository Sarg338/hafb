// Worked examples for CLAUDE.md §5.8 (reconciliation). Matches
// docs/budget-math-parts/s1.6-transactions.md §8.2. Amounts are cents.
import { asISODate, minor } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import { READY_TO_ASSIGN, type Account, type Transaction } from '../src/model.ts';
import { canEditWithoutWarning, clearedBalance, planReconciliation, RECONCILIATION_PAYEE } from '../src/reconcile.ts';

const checking: Account = { id: 'checking', name: 'Checking', type: 'checking', onBudget: true };
const house: Account = { id: 'house', name: 'House', type: 'asset', onBudget: false };

let n = 0;
const tx = (accountId: string, date: string, amount: number, cleared: Transaction['cleared'], extra: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return { id: `t${String(n)}`, accountId, date: asISODate(date), amount: minor(amount), categoryId: null, cleared, ...extra };
};

const register: Transaction[] = [
  tx('checking', '2026-03-01', 100_000, 'reconciled'),
  tx('checking', '2026-03-05', -20_000, 'cleared'),
  tx('checking', '2026-03-08', -5_000, 'uncleared'),
  tx('checking', '2026-03-09', -1_000, 'cleared', { deleted: true }),
  tx('checking', '2026-03-20', -3_000, 'cleared'), // after the statement date
  tx('house', '2026-03-01', 30_000_000, 'cleared'),
];

describe('cleared balance', () => {
  it('sums cleared and reconciled, live transactions of one account (optionally up to a date)', () => {
    expect(clearedBalance(register, 'checking')).toBe(77_000);
    expect(clearedBalance(register, 'checking', asISODate('2026-03-15'))).toBe(80_000);
  });
});

describe('planReconciliation', () => {
  it('example 6.2.1: statement matches → reconcile every cleared transaction up to the date, no adjustment', () => {
    const plan = planReconciliation(register, checking, minor(80_000), asISODate('2026-03-15'));
    expect(plan).toEqual({ clearedBalance: 80_000, difference: 0, transactionIdsToReconcile: ['t2'] });
  });

  it('example 6.2.2: statement differs → an adjustment to Ready to Assign makes up the difference and is reconciled too', () => {
    const plan = planReconciliation(register, checking, minor(79_250), asISODate('2026-03-15'));
    expect(plan.difference).toBe(-750);
    expect(plan.adjustment).toEqual({
      payeeName: RECONCILIATION_PAYEE,
      transaction: {
        id: 'reconcile:checking:2026-03-15',
        accountId: 'checking',
        date: '2026-03-15',
        amount: -750,
        categoryId: READY_TO_ASSIGN,
        cleared: 'reconciled',
        approved: true,
      },
    });
    expect(plan.transactionIdsToReconcile).toEqual(['t2', 'reconcile:checking:2026-03-15']);
  });

  it('example 6.2.3: off-budget accounts get an uncategorized adjustment', () => {
    const plan = planReconciliation(register, house, minor(29_000_000), asISODate('2026-03-31'));
    expect(plan.adjustment?.transaction).toMatchObject({ amount: -1_000_000, categoryId: null });
  });

  it('only looks at the reconciled account', () => {
    expect(planReconciliation(register, house, minor(30_000_000), asISODate('2026-03-31')).transactionIdsToReconcile).toEqual(['t6']);
  });

  it('rejects a statement balance that is not whole minor units', () => {
    expect(() => planReconciliation(register, checking, 1.5 as never, asISODate('2026-03-15'))).toThrow(ValidationError);
  });
});

describe('reconciled transactions', () => {
  it('warn before editing (§5.8)', () => {
    expect(canEditWithoutWarning(tx('checking', '2026-03-01', 1, 'reconciled'))).toBe(false);
    expect(canEditWithoutWarning(tx('checking', '2026-03-01', 1, 'cleared'))).toBe(true);
    expect(canEditWithoutWarning(tx('checking', '2026-03-01', 1, 'uncleared'))).toBe(true);
  });
});
