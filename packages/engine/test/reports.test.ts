// Worked examples for Reflect report math (docs/budget-math.md §11). Amounts are cents.
import { describe, expect, it } from 'vitest';
import { accountBalances, incomeLines, incomeVsExpense, netWorth, spendingBreakdown, spendingLines, spendingTrends } from '../src/reports.ts';
import { CREDIT_CARD_INTEREST } from '../src/model.ts';
import { plan } from './helpers.ts';
import { regroup, withPayees } from './helpers-s17.ts';

/**
 * Checking (starting balance 1,000.00 on Dec 31), a Visa, savings, a house (asset) and a mortgage
 * (liability), over January and February 2026.
 */
function household() {
  const built = plan()
    .account('checking')
    .account('savings', 'savings')
    .card('visa')
    .account('house', 'asset', false)
    .account('mortgage', 'liability', false)
    .category('groceries', 'rent', 'housing', 'fun')
    .income('2025-12-31', 100_000) // starting balance
    .income('2026-01-01', 300_000)
    .income('2026-01-15', 50_000)
    .income('2026-02-01', 300_000)
    .spend('2026-01-05', 20_000, 'groceries')
    .spend('2026-01-06', 10_000, 'groceries', 'visa')
    .txn('2026-01-20', 'checking', 5_000, 'groceries') // refund
    .spend('2026-01-07', 150_000, 'rent')
    .spend('2026-02-05', 30_000, 'groceries')
    .spend('2026-02-07', 150_000, 'rent')
    .spend('2026-02-10', 8_000, 'fun')
    .txn('2026-02-11', 'checking', 10_000, 'fun') // refund larger than the spending
    .transfer('2026-01-09', 50_000, 'checking', 'savings') // excluded
    .transfer('2026-01-25', 10_000, 'checking', 'visa') // card payment, excluded
    .transfer('2026-01-28', 100_000, 'checking', 'mortgage', 'housing') // categorized: spending
    .txn('2026-01-01', 'house', 40_000_000, null)
    .txn('2026-01-01', 'mortgage', -30_000_000, null)
    .build();
  const grouped = regroup(built, [
    { id: 'needs', name: 'Needs', categories: ['groceries', 'rent', 'housing'] },
    { id: 'wants', name: 'Wants', categories: ['fun'] },
  ]);
  return withPayees(grouped, [
    { date: '2026-01-01', amount: 300_000, payeeId: 'employer' },
    { date: '2026-02-01', amount: 300_000, payeeId: 'employer' },
    { date: '2026-01-15', amount: 50_000, payeeId: 'side' },
  ]);
}

describe('§11.1 Spending Breakdown', () => {
  it('ranks spending (outflows net of refunds) by group and category; net inflows go to their own section', () => {
    const r = spendingBreakdown(household(), { from: '2026-01', to: '2026-02' });
    // YNAB trial 2026-10: the headline total is net of net-inflow categories; percentages use gross.
    expect(r.total).toBe(453_000);
    expect(r.grossSpending).toBe(455_000);
    expect(r.averagePerMonth).toBe(226_500);
    expect(r.groups).toEqual([
      {
        groupId: 'needs',
        name: 'Needs',
        spending: 455_000,
        categories: [
          { categoryId: 'rent', name: 'rent', spending: 300_000 },
          { categoryId: 'housing', name: 'housing', spending: 100_000 },
          { categoryId: 'groceries', name: 'groceries', spending: 55_000 },
        ],
      },
    ]);
    expect(r.inflowCategories).toEqual([{ categoryId: 'fun', name: 'fun', inflow: 2_000 }]);
  });

  it('filters by account and category', () => {
    expect(spendingBreakdown(household(), { from: '2026-01', to: '2026-02', accountIds: ['visa'] }).total).toBe(10_000);
    expect(spendingBreakdown(household(), { from: '2026-01', to: '2026-02', categoryIds: ['groceries'] }).total).toBe(55_000);
    expect(spendingBreakdown(household(), { from: '2026-02', to: '2026-02' }).total).toBe(178_000); // 180 − fun's 2 inflow
  });
});

describe('§11.2 Spending Trends', () => {
  it('totals spending per category per month with averages', () => {
    const r = spendingTrends(household(), { from: '2026-01', to: '2026-02' });
    expect(r.months).toEqual(['2026-01', '2026-02']);
    expect(r.categories.map((c) => [c.categoryId, c.byMonth, c.total, c.average])).toEqual([
      ['groceries', [25_000, 30_000], 55_000, 27_500],
      ['rent', [150_000, 150_000], 300_000, 150_000],
      ['housing', [100_000, 0], 100_000, 50_000],
      ['fun', [0, -2_000], -2_000, -1_000],
    ]);
    expect(r.totalsByMonth).toEqual([275_000, 178_000]);
    expect(r.total).toBe(453_000);
    expect(r.averagePerMonth).toBe(226_500);
  });
});

describe('§11.3 Net Worth', () => {
  it('sums positive balances as assets and negative balances as debts across all accounts, per month end', () => {
    expect(netWorth(household(), { from: '2025-12', to: '2026-02' })).toEqual([
      { month: '2025-12', assets: 100_000, debts: 0, netWorth: 100_000, change: 0 }, // first month: no change (YNAB trial)
      { month: '2026-01', assets: 40_175_000, debts: -29_900_000, netWorth: 10_275_000, change: 10_175_000 },
      { month: '2026-02', assets: 40_297_000, debts: -29_900_000, netWorth: 10_397_000, change: 122_000 },
    ]);
  });
});

describe('§11.4 Income v Expense', () => {
  const payeeName = (id: string | undefined) => (id === 'employer' ? 'Employer' : id === 'side' ? 'Side gig' : 'Other');

  it('shows Ready to Assign income by payee and categorized expenses by group, with averages and totals', () => {
    const r = incomeVsExpense(household(), { from: '2026-01', to: '2026-02' }, { payeeName });
    expect(r.income.rows).toEqual([
      { payeeId: 'employer', name: 'Employer', byMonth: [300_000, 300_000], average: 300_000, total: 600_000 },
      { payeeId: 'side', name: 'Side gig', byMonth: [50_000, 0], average: 25_000, total: 50_000 },
    ]);
    expect(r.income).toMatchObject({ totalByMonth: [350_000, 300_000], total: 650_000, average: 325_000 });
    expect(r.expense.groups.map((g) => [g.groupId, g.byMonth, g.total, g.categories.map((c) => [c.categoryId, c.byMonth])])).toEqual([
      ['needs', [-275_000, -180_000], -455_000, [['groceries', [-25_000, -30_000]], ['rent', [-150_000, -150_000]], ['housing', [-100_000, 0]]]],
      ['wants', [0, 2_000], 2_000, [['fun', [0, 2_000]]]],
    ]);
    expect(r.expense).toMatchObject({ totalByMonth: [-275_000, -178_000], total: -453_000, average: -226_500 });
    expect(r.netIncome).toEqual({ byMonth: [75_000, 122_000], total: 197_000, average: 98_500 });
  });

  it('leaves out starting balances and off-budget accounts', () => {
    const r = incomeVsExpense(household(), { from: '2025-12', to: '2025-12', accountIds: ['checking', 'house'] }, { payeeName });
    expect(r.income.total).toBe(0);
    expect(r.expense.total).toBe(0);
  });
});

describe('§11.5 Report drill-down (S6.1)', () => {
  const brief = (lines: ReturnType<typeof spendingLines>) => lines.map((l) => [l.transactionId, l.date, l.accountId, l.categoryId, l.amount]);

  it('lists the lines behind a category, newest first, with refunds', () => {
    expect(brief(spendingLines(household(), { from: '2026-01', to: '2026-01' }, { categoryId: 'groceries' }))).toEqual([
      ['t7', '2026-01-20', 'checking', 'groceries', 5_000],
      ['t6', '2026-01-06', 'visa', 'groceries', -10_000],
      ['t5', '2026-01-05', 'checking', 'groceries', -20_000],
    ]);
  });

  it('lists a group in one month, and every line when nothing is picked; the same lines the totals use', () => {
    expect(brief(spendingLines(household(), { from: '2026-01', to: '2026-02' }, { groupId: 'needs', month: '2026-02' }))).toEqual([
      ['t10', '2026-02-07', 'checking', 'rent', -150_000],
      ['t9', '2026-02-05', 'checking', 'groceries', -30_000],
    ]);
    const all = spendingLines(household(), { from: '2026-01', to: '2026-02' });
    expect(all.reduce((s, l) => s + l.amount, 0)).toBe(0 - spendingTrends(household(), { from: '2026-01', to: '2026-02' }).total);
    // Transfers between on-budget accounts and card payments never appear; a categorized transfer to a loan does.
    expect(all.map((l) => l.transactionId)).toContain('t17');
    expect(all.map((l) => l.transactionId)).not.toContain('t13');
    expect(all.map((l) => l.transactionId)).not.toContain('t15');
  });

  it('carries split lines with their own id and memo', () => {
    const base = plan().account('checking').category('food', 'fun').split('2026-03-02', 'checking', [
      { amount: -3_000, categoryId: 'food' },
      { amount: -1_000, categoryId: 'fun' },
    ]).build();
    const tx = base.transactions[0];
    if (!tx?.subtransactions) throw new Error('split missing');
    const snapshot = {
      ...base,
      transactions: [{ ...tx, payeeId: 'shop', memo: 'weekly', subtransactions: tx.subtransactions.map((s, i) => (i === 1 ? { ...s, memo: 'treat' } : s)) }],
    };
    const lines = spendingLines(snapshot, { from: '2026-03', to: '2026-03' });
    expect(lines.map((l) => [l.categoryId, l.amount, l.memo, l.payeeId, l.subtransactionId !== undefined])).toEqual([
      ['food', -3_000, 'weekly', 'shop', true],
      ['fun', -1_000, 'treat', 'shop', true],
    ]);
  });

  it('lists income lines by payee; starting balances never count', () => {
    expect(brief(incomeLines(household(), { from: '2026-01', to: '2026-02' }, { payeeId: 'employer' }))).toEqual([
      ['t4', '2026-02-01', 'checking', 'ready-to-assign', 300_000],
      ['t2', '2026-01-01', 'checking', 'ready-to-assign', 300_000],
    ]);
    expect(incomeLines(household(), { from: '2025-12', to: '2025-12' })).toEqual([]);
    expect(incomeLines(household(), { from: '2026-01', to: '2026-02' }, { month: '2026-01' }).map((l) => l.transactionId)).toEqual(['t3', 't2']);
  });
});

describe('§11.6 Report rollups (S6.1)', () => {
  it('rolls Spending Trends up by group per month', () => {
    const r = spendingTrends(household(), { from: '2026-01', to: '2026-02' });
    expect(r.groups.map((g) => [g.groupId, g.name, g.byMonth, g.total, g.average])).toEqual([
      ['needs', 'Needs', [275_000, 180_000], 455_000, 227_500],
      ['wants', 'Wants', [0, -2_000], -2_000, -1_000],
    ]);
  });

  it('gives each account its month-end balance (they add up to Net Worth)', () => {
    const rows = accountBalances(household(), { from: '2026-01', to: '2026-02' });
    expect(rows.map((r) => [r.accountId, r.byMonth])).toEqual([
      ['checking', [125_000, 247_000]],
      ['savings', [50_000, 50_000]],
      ['visa', [0, 0]],
      ['house', [40_000_000, 40_000_000]],
      ['mortgage', [-29_900_000, -29_900_000]],
    ]);
    const nw = netWorth(household(), { from: '2026-01', to: '2026-02' });
    expect(nw.map((r) => r.netWorth)).toEqual([0, 1].map((i) => rows.reduce((s, r) => s + (r.byMonth[i] ?? 0), 0)));
    expect(accountBalances(household(), { from: '2026-02', to: '2026-02', accountIds: ['visa'] })).toEqual([{ accountId: 'visa', name: 'visa', byMonth: [0] }]);
  });

  it("leaves a card's starting debt (category not needed) out of spending", () => {
    const snapshot = plan().account('checking').card('visa').category('food')
      .txn('2026-03-01', 'visa', -50_000, null, { isStartingBalance: true })
      .spend('2026-03-02', 2_000, 'food', 'visa')
      .build();
    expect(spendingBreakdown(snapshot, { from: '2026-03', to: '2026-03' }).total).toBe(2_000);
    expect(spendingLines(snapshot, { from: '2026-03', to: '2026-03' }).map((l) => l.categoryId)).toEqual(['food']);
  });

  it('leaves Credit Card Interest out of spending: it stays out of the spending plan (§3.15)', () => {
    const snapshot = plan().account('checking').card('visa').category('food')
      .txn('2026-03-20', 'visa', -1_500, CREDIT_CARD_INTEREST)
      .spend('2026-03-02', 2_000, 'food', 'visa')
      .build();
    expect(spendingBreakdown(snapshot, { from: '2026-03', to: '2026-03' }).total).toBe(2_000);
    expect(spendingLines(snapshot, { from: '2026-03', to: '2026-03' }).map((l) => l.categoryId)).toEqual(['food']);
  });
});
