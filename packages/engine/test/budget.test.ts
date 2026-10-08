// Worked examples for CLAUDE.md §5.1–§5.3 and §5.9. Each `describe` matches a section of
// docs/budget-math.md. Amounts are cents.
import { asISODate, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import {
  computeBudget,
  InvariantViolation,
  monthState,
  READY_TO_ASSIGN,
  UNCATEGORIZED,
  ValidationError,
  type BudgetSnapshot,
} from '../src/index.ts';
import { plan } from './helpers.ts';

const TODAY = asISODate('2026-03-15');
const run = (s: BudgetSnapshot, today = TODAY) => computeBudget(s, { today });
const cat = (s: BudgetSnapshot, month: Month, id: string, today = TODAY) => {
  const c = monthState(run(s, today), month).categories[id];
  if (!c) throw new Error(`no category ${id} in ${month}`);
  return c;
};

describe('§1 core identity: available = carried + assigned + activity', () => {
  const base = () =>
    plan()
      .account('checking')
      .category('groceries', 'rent')
      .income('2026-01-01', 300_000)
      .assign('2026-01', 'groceries', 40_000)
      .spend('2026-01-10', 15_000, 'groceries');

  it('example 1.1: assign and spend in one month', () => {
    const s = base().build();
    const g = cat(s, '2026-01', 'groceries');
    expect(g).toMatchObject({ assigned: 40_000, activity: -15_000, available: 25_000, carriedIn: 0 });
    expect(monthState(run(s), '2026-01').readyToAssign).toBe(260_000);
  });

  it('example 1.2: positive balances carry forward in full', () => {
    const s = base().assign('2026-02', 'groceries', 10_000).spend('2026-02-03', 5_000, 'groceries').build();
    expect(cat(s, '2026-02', 'groceries')).toMatchObject({ carriedIn: 25_000, available: 30_000 });
    expect(cat(s, '2026-03', 'groceries')).toMatchObject({ carriedIn: 30_000, assigned: 0, available: 30_000 });
  });

  it('example 1.3: cash overspending resets to 0 and comes out of next month’s Ready to Assign', () => {
    const s = base().spend('2026-01-20', 35_000, 'groceries').build();
    const jan = cat(s, '2026-01', 'groceries');
    expect(jan).toMatchObject({ available: -10_000, overspending: { cash: 10_000, credit: 0 } });
    const state = run(s);
    expect(monthState(state, '2026-01').readyToAssign).toBe(260_000); // not reduced in the same month
    expect(cat(s, '2026-02', 'groceries')).toMatchObject({ carriedIn: 0, available: 0 });
    expect(monthState(state, '2026-02').readyToAssign).toBe(250_000);
    expect(monthState(state, '2026-02').breakdown.cashOverspendingLastMonth).toBe(10_000);
  });

  it('example 1.4: inflows to a category (refunds) add to activity', () => {
    const s = base().txn('2026-01-12', 'checking', 2_500, 'groceries').build();
    expect(cat(s, '2026-01', 'groceries')).toMatchObject({ activity: -12_500, available: 27_500 });
  });

  it('example 1.5: split lines go to their own categories; the split must sum to the parent', () => {
    const s = base()
      .split('2026-01-15', 'checking', [
        { amount: -6_000, categoryId: 'groceries' },
        { amount: -4_000, categoryId: 'rent' },
      ])
      .build();
    expect(cat(s, '2026-01', 'groceries').activity).toBe(-21_000);
    expect(cat(s, '2026-01', 'rent').activity).toBe(-4_000);

    const bad = base().build();
    const tx = bad.transactions[1];
    if (!tx) throw new Error('fixture');
    const broken: BudgetSnapshot = {
      ...bad,
      transactions: [
        ...bad.transactions,
        { ...tx, id: 'broken', amount: tx.amount, subtransactions: [{ id: 's', amount: tx.amount, categoryId: 'rent' }, { id: 's2', amount: tx.amount, categoryId: 'rent' }] },
      ],
    };
    expect(() => run(broken)).toThrow(InvariantViolation);
  });

  it('example 1.6: deleted transactions are ignored; uncategorized money gets its own row', () => {
    const s = base()
      .txn('2026-01-11', 'checking', -99_999, 'groceries', { deleted: true })
      .txn('2026-01-12', 'checking', -1_000, null)
      .build();
    expect(cat(s, '2026-01', 'groceries').activity).toBe(-15_000);
    expect(cat(s, '2026-01', UNCATEGORIZED)).toMatchObject({ activity: -1_000, available: -1_000, overspending: { cash: 1_000, credit: 0 } });
  });
});

describe('§2 Ready to Assign', () => {
  it('example 2.1: inflows add, assignments subtract, carried month to month', () => {
    const s = plan()
      .account('checking')
      .category('a')
      .income('2026-01-01', 100_000)
      .assign('2026-01', 'a', 30_000)
      .income('2026-02-01', 50_000)
      .assign('2026-02', 'a', 20_000)
      .build();
    const state = run(s);
    // Seen from January, February's 200.00 is "assigned in future" and already subtracted.
    expect(monthState(state, '2026-01')).toMatchObject({ readyToAssign: 50_000, breakdown: { assignedInFuture: 20_000 } });
    expect(monthState(state, '2026-02')).toMatchObject({
      readyToAssign: 100_000,
      breakdown: { leftOverFromLastMonth: 70_000, inflows: 50_000, assignedThisMonth: 20_000, assignedInFuture: 0 },
    });
  });

  it('example 2.2: money assigned in a future month is subtracted now ("Assigned in Future")', () => {
    const s = plan()
      .account('checking')
      .category('a')
      .income('2026-01-01', 100_000)
      .assign('2026-01', 'a', 30_000)
      .assign('2026-04', 'a', 25_000)
      .build();
    const state = run(s);
    expect(monthState(state, '2026-01')).toMatchObject({ readyToAssign: 45_000, breakdown: { assignedInFuture: 25_000 } });
    expect(monthState(state, '2026-03').readyToAssign).toBe(45_000);
    expect(monthState(state, '2026-04')).toMatchObject({ readyToAssign: 45_000, breakdown: { assignedInFuture: 0, assignedThisMonth: 25_000 } });
    expect(state.months.at(-1)).toBe('2026-04');
    const extended = computeBudget(s, { today: TODAY, throughMonth: '2026-12' });
    expect(extended.months.at(-1)).toBe('2026-12');
    expect(monthState(extended, '2026-12').readyToAssign).toBe(45_000);
  });

  it('example 2.5: assigning ahead never takes this month below zero (YNAB trial, 2026-10-08)', () => {
    // October: $5,500 in, $2,430 assigned (core $3,070). November: $3,500 assigned.
    const s = plan()
      .account('checking')
      .category('a')
      .category('b')
      .income('2026-10-01', 550_000)
      .assign('2026-10', 'a', 243_000)
      .assign('2026-11', 'b', 350_000)
      .build();
    const state = computeBudget(s, { today: TODAY, throughMonth: '2026-11' });
    // YNAB: "$0.00 All Money Assigned", breakdown "Assigned in Future −$3,070.00".
    expect(monthState(state, '2026-10')).toMatchObject({ readyToAssign: 0, breakdown: { assignedInFuture: 307_000 } });
    // The shortfall shows in the month that caused it: November −$430.
    expect(monthState(state, '2026-11').readyToAssign).toBe(-43_000);
  });

  it('example 2.6: when this month is already over-assigned, future assignments add nothing to it', () => {
    // YNAB trial: October core −$930 with $3,500 assigned in November shows −$930 and no future line.
    const s = plan()
      .account('checking')
      .category('a')
      .category('b')
      .income('2026-10-01', 550_000)
      .assign('2026-10', 'a', 643_000)
      .assign('2026-11', 'b', 350_000)
      .build();
    const state = computeBudget(s, { today: TODAY, throughMonth: '2026-11' });
    expect(monthState(state, '2026-10')).toMatchObject({ readyToAssign: -93_000, breakdown: { assignedInFuture: 0 } });
    expect(monthState(state, '2026-11').readyToAssign).toBe(-443_000);
  });

  it('example 2.3: Ready to Assign can go negative', () => {
    const s = plan().account('checking').category('a').income('2026-01-01', 10_000).assign('2026-01', 'a', 15_000).build();
    expect(monthState(run(s), '2026-01').readyToAssign).toBe(-5_000);
  });

  it('example 2.4: starting balances are inflows to Ready to Assign; off-budget accounts never count', () => {
    const s = plan()
      .account('checking')
      .account('savings', 'savings')
      .account('house', 'asset', false)
      .category('a')
      .income('2026-01-01', 120_000, 'checking')
      .income('2026-01-01', 30_000, 'savings')
      .txn('2026-01-01', 'house', 40_000_000, null)
      .build();
    expect(monthState(run(s), '2026-01').readyToAssign).toBe(150_000);
  });
});

describe('§3 credit cards', () => {
  const base = () =>
    plan()
      .account('checking')
      .card('visa')
      .category('dining', 'fuel')
      .income('2026-01-01', 200_000)
      .assign('2026-01', 'dining', 10_000);

  it('example 3.1: funded card spending moves to the payment category', () => {
    const s = base().spend('2026-01-05', 6_000, 'dining', 'visa').build();
    expect(cat(s, '2026-01', 'dining')).toMatchObject({ activity: -6_000, creditActivity: -6_000, available: 4_000 });
    expect(cat(s, '2026-01', 'pay:visa')).toMatchObject({
      activity: 6_000,
      available: 6_000,
      creditCard: { accountId: 'visa', fundedSpending: 6_000, payments: 0 },
    });
  });

  it('example 3.2: credit overspending — only the covered part moves; the rest is card debt, not a Ready to Assign hit', () => {
    const s = base().spend('2026-01-05', 16_000, 'dining', 'visa').build();
    expect(cat(s, '2026-01', 'dining')).toMatchObject({ available: -6_000, overspending: { cash: 0, credit: 6_000 } });
    expect(cat(s, '2026-01', 'pay:visa').available).toBe(10_000);
    const state = run(s);
    expect(cat(s, '2026-02', 'dining')).toMatchObject({ carriedIn: 0, available: 0 });
    expect(monthState(state, '2026-02').readyToAssign).toBe(monthState(state, '2026-01').readyToAssign);
    expect(state.accountBalances.visa?.working).toBe(-16_000); // owes 160.00, only 100.00 set aside
  });

  it('example 3.3: mixed cash and credit — overspending is credit first, up to the card spending', () => {
    const s = base().spend('2026-01-03', 7_000, 'dining', 'checking').spend('2026-01-04', 5_000, 'dining', 'visa').build();
    // 100 − 70 − 50 = −20 → credit 20, cash 0; funded = 50 − 20 = 30
    expect(cat(s, '2026-01', 'dining').overspending).toEqual({ credit: 2_000, cash: 0 });
    expect(cat(s, '2026-01', 'pay:visa').activity).toBe(3_000);
  });

  it('example 3.4: when overspending exceeds card spending, the remainder is cash', () => {
    const s = base().spend('2026-01-03', 15_000, 'dining', 'checking').spend('2026-01-04', 2_000, 'dining', 'visa').build();
    // 100 − 150 − 20 = −70 → credit 20, cash 50; nothing funded
    expect(cat(s, '2026-01', 'dining').overspending).toEqual({ credit: 2_000, cash: 5_000 });
    expect(cat(s, '2026-01', 'pay:visa').activity).toBe(0);
    expect(monthState(run(s), '2026-02').breakdown.cashOverspendingLastMonth).toBe(5_000);
  });

  it('example 3.5: a refund on the card moves money back out of the payment category', () => {
    const s = base().spend('2026-01-05', 6_000, 'dining', 'visa').txn('2026-01-09', 'visa', 1_500, 'dining').build();
    expect(cat(s, '2026-01', 'dining').available).toBe(5_500);
    expect(cat(s, '2026-01', 'pay:visa').activity).toBe(4_500);
  });

  it('example 3.6: a payment from checking reduces the payment category; overpaying is cash overspending', () => {
    const s = base().spend('2026-01-05', 6_000, 'dining', 'visa').transfer('2026-01-20', 8_000, 'checking', 'visa').build();
    expect(cat(s, '2026-01', 'pay:visa')).toMatchObject({
      activity: -2_000,
      available: -2_000,
      overspending: { cash: 2_000, credit: 0 },
      creditCard: { fundedSpending: 6_000, payments: 8_000 },
    });
    expect(monthState(run(s), '2026-02').breakdown.cashOverspendingLastMonth).toBe(2_000);
  });

  it('example 3.7: a cash advance (card → checking) adds to the payment category', () => {
    const s = base().transfer('2026-01-07', 5_000, 'visa', 'checking').build();
    expect(cat(s, '2026-01', 'pay:visa')).toMatchObject({ activity: 5_000, creditCard: { payments: -5_000 } });
  });

  it('example 3.8: two cards in one overspent category — the most recent card spending is unfunded first', () => {
    const s = base()
      .card('amex')
      .spend('2026-01-03', 8_000, 'dining', 'visa')
      .spend('2026-01-25', 6_000, 'dining', 'amex')
      .build();
    // 100 − 80 − 60 = −40 credit; amex spent last → amex funded 20, visa 80
    expect(cat(s, '2026-01', 'pay:amex').activity).toBe(2_000);
    expect(cat(s, '2026-01', 'pay:visa').activity).toBe(8_000);
  });

  it('example 3.9: lines of credit behave like cards', () => {
    const s = base().card('loc', 'lineOfCredit').spend('2026-01-05', 4_000, 'dining', 'loc').build();
    expect(cat(s, '2026-01', 'pay:loc').activity).toBe(4_000);
  });

  it('example 3.10: Ready to Assign inflows on a card go to Ready to Assign, not the payment category', () => {
    const s = base().txn('2026-01-10', 'visa', 2_500, READY_TO_ASSIGN).build();
    expect(cat(s, '2026-01', 'pay:visa').activity).toBe(0);
    expect(monthState(run(s), '2026-01').breakdown.inflows).toBe(202_500);
  });
});

describe('§4 transfers', () => {
  const base = () =>
    plan()
      .account('checking')
      .account('savings', 'savings')
      .account('mortgage', 'mortgage', false)
      .account('brokerage', 'asset', false)
      .category('housing')
      .income('2026-01-01', 500_000)
      .assign('2026-01', 'housing', 200_000);

  it('example 4.1: on-budget ↔ on-budget moves no money between categories', () => {
    const s = base().transfer('2026-01-02', 100_000, 'checking', 'savings').build();
    const state = run(s);
    expect(monthState(state, '2026-01').readyToAssign).toBe(300_000);
    expect(cat(s, '2026-01', 'housing').activity).toBe(0);
    expect(state.accountBalances.savings?.working).toBe(100_000);
  });

  it('example 4.2: on-budget → off-budget is spending on the on-budget leg', () => {
    const s = base().transfer('2026-01-03', 150_000, 'checking', 'mortgage', 'housing').build();
    expect(cat(s, '2026-01', 'housing')).toMatchObject({ activity: -150_000, available: 50_000 });
  });

  it('example 4.3: off-budget → on-budget is an inflow on the on-budget leg (usually Ready to Assign)', () => {
    const s = base()
      .txn('2026-01-04', 'brokerage', -20_000, null, { transferAccountId: 'checking' })
      .txn('2026-01-04', 'checking', 20_000, READY_TO_ASSIGN, { transferAccountId: 'brokerage' })
      .build();
    expect(monthState(run(s), '2026-01').breakdown.inflows).toBe(520_000);
  });

  it('rejects a category on a transfer between two on-budget accounts', () => {
    const s = base().transfer('2026-01-02', 1_000, 'checking', 'savings', 'housing').build();
    expect(() => run(s)).toThrow(ValidationError);
  });
});

describe('validation', () => {
  it('rejects unknown ids, duplicate assignments, categories on off-budget accounts and payment-category spending', () => {
    const ok = () => plan().account('checking').card('visa').category('a');
    expect(() => run(ok().spend('2026-01-01', 1, 'nope').build())).toThrow(ValidationError);
    expect(() => run(ok().assign('2026-01', 'a', 1).assign('2026-01', 'a', 2).build())).toThrow(ValidationError);
    expect(() => run(ok().account('house', 'asset', false).spend('2026-01-01', 1, 'a', 'house').build())).toThrow(ValidationError);
    expect(() => run(ok().spend('2026-01-01', 1, 'pay:visa').build())).toThrow(ValidationError);
    const noPayment = ok().build();
    expect(() => run({ ...noPayment, categories: noPayment.categories.filter((c) => c.id !== 'pay:visa') })).toThrow(ValidationError);
  });

  it('account balances split cleared and uncleared', () => {
    const s = plan()
      .account('checking')
      .category('a')
      .income('2026-01-01', 10_000)
      .txn('2026-01-02', 'checking', -2_500, 'a', { cleared: 'uncleared' })
      .build();
    expect(run(s).accountBalances.checking).toEqual({ cleared: 10_000, uncleared: -2_500, working: 7_500 });
  });
});
