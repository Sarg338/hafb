// Worked examples for Age of Money (CLAUDE.md §5.7, docs/budget-math.md §9). Amounts are cents.
// YNAB does not publish its algorithm; these encode the documented facts plus the stated
// assumptions in src/ageOfMoney.ts.
import { asISODate } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { ageOfMoney, ageOfMoneyOutflows, ageOfMoneySeries } from '../src/ageOfMoney.ts';
import { plan } from './helpers.ts';

const d = asISODate;

/** 1,000.00 on Jan 1, 1,000.00 on Jan 15, then ten 150.00 outflows on Jan 21…30. */
function tenOutflows() {
  const b = plan().account('checking').category('a').income('2026-01-01', 100_000).income('2026-01-15', 100_000);
  for (let day = 21; day <= 30; day += 1) b.spend(`2026-01-${String(day)}`, 15_000, 'a');
  return b.build();
}

describe('§9.1 FIFO ages and the 10-outflow average', () => {
  it('ages each outflow by the oldest dollars it spends (amount-weighted)', () => {
    const ages = ageOfMoneyOutflows(tenOutflows()).map((o) => o.ageDays);
    // Jan 21…26 spend the Jan 1 money (20…25 days). Jan 27 spends 100.00 of Jan 1 (26 days)
    // and 50.00 of Jan 15 (12 days): (100×26 + 50×12)/150 = 21.33. Jan 28…30: Jan 15 money.
    expect(ages.slice(0, 6)).toEqual([20, 21, 22, 23, 24, 25]);
    expect(ages[6]).toBeCloseTo(21.3333, 3);
    expect(ages.slice(7)).toEqual([13, 14, 15]);
  });

  it('is the simple mean of the last 10 outflow ages, rounded half up to whole days', () => {
    // (20+21+22+23+24+25+21.33+13+14+15)/10 = 19.83 → 20
    expect(ageOfMoney(tenOutflows(), d('2026-01-30'))).toBe(20);
  });

  it('is null until there are 10 qualifying outflows', () => {
    expect(ageOfMoney(tenOutflows(), d('2026-01-29'))).toBeNull();
  });

  it('uses only the most recent 10 outflows', () => {
    const s = plan().account('checking').category('a').income('2026-01-01', 1_000_000);
    for (let day = 2; day <= 12; day += 1) s.spend(`2026-01-${String(day).padStart(2, '0')}`, 100, 'a');
    // 11 outflows aged 1…11 days; the last ten are 2…11 → mean 6.5 → 7
    expect(ageOfMoney(s.build(), d('2026-01-12'))).toBe(7);
  });
});

describe('§9.2 what counts', () => {
  it('counts credit card payments, not card purchases; transfers neither spend nor add money', () => {
    const s = plan()
      .account('checking')
      .account('savings', 'savings')
      .card('visa')
      .category('a')
      .income('2026-01-01', 50_000)
      .spend('2026-01-03', 20_000, 'a', 'visa') // card purchase: not an outflow
      .transfer('2026-01-04', 10_000, 'checking', 'savings') // on-budget transfer: ignored
      .transfer('2026-01-10', 20_000, 'checking', 'visa') // card payment: outflow, 9 days old
      .income('2026-02-01', 10_000)
      .spend('2026-02-01', 5_000, 'a') // still spends Jan 1 money first (FIFO): 31 days
      .build();
    expect(ageOfMoneyOutflows(s).map((o) => [o.date, o.amount, o.ageDays])).toEqual([
      ['2026-01-10', 20_000, 9],
      ['2026-02-01', 5_000, 31],
    ]);
  });

  it('spends same-day income at age 0 once older money is gone, and ages unfunded spending 0', () => {
    const s = plan()
      .account('checking')
      .category('a')
      .spend('2026-01-05', 10_000, 'a') // nothing received yet → age 0
      .income('2026-01-10', 4_000)
      .spend('2026-01-10', 4_000, 'a') // same-day inflow is available → age 0
      .build();
    expect(ageOfMoneyOutflows(s).map((o) => o.ageDays)).toEqual([0, 0]);
  });

  it('excludes starting balances as outflows and ignores off-budget accounts', () => {
    const s = plan()
      .account('checking')
      .account('house', 'asset', false)
      .category('a')
      .income('2025-12-31', -5_000) // first transaction in the account: a negative starting balance
      .income('2026-01-01', 30_000)
      .txn('2026-01-02', 'house', -1_000_000, null)
      .spend('2026-01-06', 1_000, 'a')
      .build();
    expect(ageOfMoneyOutflows(s).map((o) => [o.date, o.ageDays])).toEqual([['2026-01-06', 5]]);
  });

  it('an explicit starting-balance set overrides the first-transaction default', () => {
    const s = plan().account('checking').category('a').income('2026-01-01', 30_000).spend('2026-01-02', 100, 'a').build();
    expect(ageOfMoneyOutflows(s).length).toBe(1);
    // Marking the outflow as a starting balance excludes it.
    const spendId = s.transactions[1]?.id ?? '';
    expect(ageOfMoneyOutflows(s, { startingBalanceIds: new Set([spendId]) })).toEqual([]);
  });
});

describe('§9.3 monthly series for Reflect', () => {
  it('gives one point per month end, null before 10 outflows', () => {
    const series = ageOfMoneySeries(tenOutflows(), '2025-12', '2026-02');
    expect(series).toEqual([
      { month: '2025-12', date: '2025-12-31', ageOfMoney: null },
      { month: '2026-01', date: '2026-01-31', ageOfMoney: 20 },
      { month: '2026-02', date: '2026-02-28', ageOfMoney: 20 },
    ]);
  });
});
