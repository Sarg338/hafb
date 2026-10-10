// Worked examples for CLAUDE.md §5.1–§5.3 and §5.9. Each `describe` matches a section of
// docs/budget-math.md. Amounts are cents.
import { asISODate, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import {
  autoAssign,
  budgetThrough,
  computeBudget,
  CREDIT_CARD_INTEREST,
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

  it('dataThrough marks where the plain range ends; a state cut there or later is exact (S8.1)', () => {
    // Future assignment in April, card spending, an overspent category: carry-forward must not
    // depend on how far the computation runs.
    const s = plan()
      .account('checking')
      .card('visa')
      .category('a', 'b')
      .income('2026-01-01', 100_000)
      .assign('2026-01', 'a', 30_000)
      .spend('2026-02-10', 45_000, 'a', 'visa')
      .spend('2026-03-02', 9_000, 'b')
      .assign('2026-04', 'b', 25_000)
      .build();
    const plain = run(s);
    expect(plain.dataThrough).toBe('2026-04');
    const wide = computeBudget(s, { today: TODAY, throughMonth: '2026-09' });
    expect(wide.dataThrough).toBe('2026-04');
    expect(budgetThrough(wide, '2026-04')).toEqual(plain);
    for (const m of ['2026-05', '2026-06', '2026-09'] as const) {
      expect(budgetThrough(wide, m)).toEqual(computeBudget(s, { today: TODAY, throughMonth: m }));
    }
    expect(budgetThrough(wide, '2026-09')).toBe(wide);
    // Not exact before dataThrough, and nothing past the state's end.
    expect(budgetThrough(wide, '2026-03')).toBeNull();
    expect(budgetThrough(wide, '2026-10')).toBeNull();
    // With no data past today, the current month ends the plain range.
    expect(run(plan().account('checking').income('2026-01-01', 100).build()).dataThrough).toBe('2026-03');
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
  it("3.12: a card's starting debt stays off Ready to Assign and out of every category (YNAB trial, 2026-10-08)", () => {
    // YNAB: adding a card that owes $100 left Ready to Assign at $3,070.00, showed "Category not
    // needed" on the Starting Balance, and the payment category's underfunded alert grew by $100.
    for (const category of [READY_TO_ASSIGN, null] as const) {
      const s = plan()
        .account('checking')
        .card('visa')
        .category('a')
        .income('2026-10-01', 100_000)
        .txn('2026-10-08', 'visa', -10_000, category, { isStartingBalance: true })
        .build();
      const state = computeBudget(s, { today: TODAY });
      const ms = monthState(state, '2026-10');
      expect(ms.readyToAssign).toBe(100_000);
      expect(ms.categories['pay:visa']).toMatchObject({ available: 0, activity: 0 });
      expect(ms.categories['pay:visa']?.creditCard?.balance).toBe(-10_000);
      expect(Object.keys(ms.categories)).not.toContain(UNCATEGORIZED);
      expect(state.accountBalances.visa?.working).toBe(-10_000);
      const change = autoAssign('underfunded', { state, month: '2026-10', categoryIds: Object.keys(ms.categories), targets: [], evaluated: {}, paymentCategoryIds: new Set(['pay:visa']) });
      expect(change.deltas).toEqual([{ month: '2026-10', categoryId: 'pay:visa', delta: 10_000 }]);
    }
  });

  it('3.13: a card that starts with a credit in your favour is cash-like: its starting balance is an inflow', () => {
    const s = plan().account('checking').card('visa').income('2026-10-01', 100_000).txn('2026-10-08', 'visa', 2_500, READY_TO_ASSIGN, { isStartingBalance: true }).build();
    expect(monthState(computeBudget(s, { today: TODAY }), '2026-10').readyToAssign).toBe(102_500);
  });

  describe('3.15: Credit Card Interest (YNAB, rolling out Oct 2026; behind a flag)', () => {
    // YNAB: interest categorized as "Credit Card Interest" stays out of the spending plan and doesn't
    // overspend a category; the payment category shows it as debt to cover.
    const interestPlan = () => plan().account('checking').card('visa').category('dining').income('2026-10-01', 100_000);

    it('interest touches no category and not Ready to Assign; the payment category shows the debt', () => {
      const s = interestPlan().txn('2026-10-20', 'visa', -1_234, CREDIT_CARD_INTEREST).build();
      const state = computeBudget(s, { today: TODAY });
      const ms = monthState(state, '2026-10');
      expect(ms.readyToAssign).toBe(100_000);
      expect(ms.categories['pay:visa']).toMatchObject({ available: 0, activity: 0 });
      expect(ms.categories['pay:visa']?.creditCard).toMatchObject({ balance: -1_234, interest: -1_234, spending: 0, unfundedSpending: 0 });
      expect(ms.categories.dining).toMatchObject({ activity: 0, available: 0 });
      expect(Object.keys(ms.categories)).not.toContain(CREDIT_CARD_INTEREST);
      expect(Object.keys(ms.categories)).not.toContain(UNCATEGORIZED);
      const change = autoAssign('underfunded', { state, month: '2026-10', categoryIds: Object.keys(ms.categories), targets: [], evaluated: {}, paymentCategoryIds: new Set(['pay:visa']) });
      expect(change.deltas).toEqual([{ month: '2026-10', categoryId: 'pay:visa', delta: 1_234 }]);
    });

    it('a split line, an interest refund and next month: interest is counted per month, net', () => {
      const s = interestPlan()
        .split('2026-10-20', 'visa', [
          { amount: -3_000, categoryId: 'dining' },
          { amount: -500, categoryId: CREDIT_CARD_INTEREST },
        ])
        .txn('2026-10-25', 'visa', 200, CREDIT_CARD_INTEREST)
        .txn('2026-11-20', 'visa', -700, CREDIT_CARD_INTEREST)
        .build();
      const state = computeBudget(s, { today: TODAY });
      const oct = monthState(state, '2026-10');
      expect(oct.categories['pay:visa']?.creditCard).toMatchObject({ interest: -300, spending: -3_000, balance: -3_300 });
      expect(oct.categories.dining).toMatchObject({ activity: -3_000 });
      expect(oct.readyToAssign).toBe(100_000);
      expect(monthState(state, '2026-11').categories['pay:visa']?.creditCard).toMatchObject({ interest: -700, balance: -4_000 });
    });

    it('is only for credit accounts', () => {
      expect(() => run(interestPlan().txn('2026-10-20', 'checking', -100, CREDIT_CARD_INTEREST).build())).toThrow(ValidationError);
    });
  });

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

  it("3.14: the payment category's activity breakdown: gross spending and returns on the card (YNAB activity popover)", () => {
    // YNAB trial, 2026-10-08: amex spent $50 in a category holding $40 → Spending −$50.00, Returns
    // $0.00, Funded Spending +$40.00, Payments & Returns $0.00, Total Activity +$40.00.
    const ynab = plan().account('checking').card('amex').category('dining').income('2026-10-01', 100_000).assign('2026-10', 'dining', 4_000).spend('2026-10-05', 5_000, 'dining', 'amex').build();
    expect(monthState(computeBudget(ynab, { today: TODAY }), '2026-10').categories['pay:amex']).toMatchObject({
      activity: 4_000,
      creditCard: { spending: -5_000, returns: 0, fundedSpending: 4_000, payments: 0, unfundedSpending: 1_000 },
    });
    // A refund and a payment: transfers and Ready to Assign inflows are neither spending nor returns.
    const s = base()
      .spend('2026-01-05', 6_000, 'dining', 'visa')
      .txn('2026-01-09', 'visa', 1_500, 'dining')
      .transfer('2026-01-20', 2_000, 'checking', 'visa')
      .txn('2026-01-21', 'visa', 700, READY_TO_ASSIGN)
      .build();
    expect(cat(s, '2026-01', 'pay:visa')).toMatchObject({
      activity: 2_500,
      creditCard: { spending: -6_000, returns: 1_500, fundedSpending: 4_500, payments: 2_000 },
    });
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
