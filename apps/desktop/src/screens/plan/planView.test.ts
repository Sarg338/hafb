// The Plan screen's pills, messages and bars (planView.ts) for the states the S8.5 parity audit
// found untested or missing: rollover and extra bar sections (P-10), the upcoming calendar (S-06),
// and a payment category's alert with and without a card target (CC-06, T-12).
import { describe, expect, it } from 'vitest';
import { evaluateTarget, type CategoryMonth, type Target } from '@hafb/engine';
import { minor, type Month } from '@hafb/shared';
import { categoryView, paymentView, upcomingView } from './planView.ts';

const fmt = { decimals: 2, symbol: '$', placement: 'before' as const, numberFormat: '1,234.56' as const };
const cm = (p: { carriedIn?: number; assigned?: number; activity?: number; cash?: number; credit?: number }): CategoryMonth => {
  const carriedIn = p.carriedIn ?? 0;
  const assigned = p.assigned ?? 0;
  const activity = p.activity ?? 0;
  return {
    categoryId: 'c',
    carriedIn: minor(carriedIn),
    assigned: minor(assigned),
    activity: minor(activity),
    available: minor(carriedIn + assigned + activity),
    cashActivity: minor(activity),
    creditActivity: minor(0),
    overspending: { cash: minor(p.cash ?? 0), credit: minor(p.credit ?? 0) },
  };
};
const monthly = (amount: number, behavior: Target['behavior'] = 'setAside'): Target => ({ categoryId: 'c', amount: minor(amount), cadence: { kind: 'monthly', day: 'last' }, behavior, startMonth: '2026-01' });
const view = (t: Target, c: CategoryMonth, month: Month = '2026-11') => categoryView(c, fmt, t, evaluateTarget(t, month, c, (m) => (m === month ? c.assigned : minor(0)), { today: '2026-11-05' }));

describe('progress bar sections (P-10, YNAB progress bars guide; trial 2026-10-12)', () => {
  it('"Set aside another" with money rolled over: the rollover is its own first section, in proportion', () => {
    // YNAB, Phone & Internet in November: $25 rolled over, $60 a month, nothing assigned yet.
    const bar = view(monthly(6_000), cm({ carriedIn: 2_500 })).bar;
    expect(bar?.weights).toEqual([2_500, 6_000]);
    expect(bar?.segments).toBe(2);
    expect(bar?.fillPercent).toBeCloseTo((100 * 2_500) / 8_500);
    expect(bar?.spentPercent).toBe(0);
  });

  it('without a rollover, or for Refill, the bar is the month alone', () => {
    expect(view(monthly(6_000), cm({ assigned: 3_000 })).bar).toEqual({ segments: 1, fillPercent: 50, spentPercent: 0 });
    expect(view(monthly(6_000, 'refill'), cm({ carriedIn: 2_500 })).bar?.weights).toBeUndefined();
  });

  it('assigning more than the target adds an extra section', () => {
    const bar = view(monthly(6_000), cm({ assigned: 9_000 })).bar;
    expect(bar?.weights).toEqual([6_000, 3_000]);
    expect(bar?.fillPercent).toBe(100);
  });

  it('overspent: what the category had, fully spent, then the overspending in red ("Overspent. $235.00 of $150.00")', () => {
    const v = view(monthly(15_000, 'refill'), cm({ assigned: 15_000, activity: -23_500, cash: 8_500 }), '2026-10');
    expect(v.state).toBe('overspent');
    expect(v.barState).toBe('funded');
    expect(v.bar).toEqual({ segments: 2, fillPercent: 100, spentPercent: 100, weights: [15_000, 8_500], lastState: 'overspent' });
    // With nothing assigned it is all red.
    expect(view(monthly(15_000, 'refill'), cm({ activity: -5_000, cash: 5_000 }), '2026-10').bar).toEqual({ segments: 1, fillPercent: 100, spentPercent: 100 });
  });
});

describe('the upcoming calendar (S-06, §5.11)', () => {
  it('a bill this month that Available won’t cover turns the pill yellow with the calendar', () => {
    // YNAB trial: Utilities $0.00 with a $15 bill due on the 20th.
    const base = categoryView(cm({}), fmt);
    const v = upcomingView(base, cm({}), minor(-1_500), fmt);
    expect(v).toMatchObject({ state: 'underfunded', upcoming: true, message: '$15.00 more needed for upcoming transactions' });
    expect(upcomingView(base, cm({ assigned: 2_000 }), minor(-1_500), fmt)).toBe(base);
  });
});

describe('a payment category’s alert (CC-06, T-12)', () => {
  const card = (owed: number, available: number, unfunded = 0): CategoryMonth => ({
    ...cm({ carriedIn: available }),
    creditCard: { accountId: 'amex', fundedSpending: minor(0), payments: minor(0), balance: minor(-owed), unfundedSpending: minor(unfunded), spending: minor(0), returns: minor(0), interest: minor(0) },
  });

  it('without a target: the pay-in-full gap, current month only (YNAB trial: amex owes $50, $40 set aside)', () => {
    expect(paymentView(card(5_000, 4_000), fmt, true)).toMatchObject({ state: 'underfunded', message: '$10.00 more needed to pay off the balance' });
    expect(paymentView(card(5_000, 4_000, 1_000), fmt, true).message).toBe('Cover $10.00 in overspent categories');
    expect(paymentView(card(5_000, 4_000), fmt, false).state).toBe('funded');
  });

  it('with a target the alert follows the target instead', () => {
    const payOff: Target = { categoryId: 'c', amount: minor(0), cadence: { kind: 'custom', due: '2026-11-30' }, behavior: 'haveBalance', payOff: true, startMonth: '2026-10' };
    const c = card(5_000, 4_000);
    const tm = evaluateTarget(payOff, '2026-10', c, () => minor(4_000), { today: '2026-10-12' });
    expect(paymentView(c, fmt, true, payOff, tm)).toMatchObject({ state: 'underfunded', message: '$5.00 more needed by Nov 30, 2026' });
    const covered = card(5_000, 5_000);
    const met = evaluateTarget(payOff, '2026-10', covered, () => minor(5_000), { today: '2026-10-12' });
    expect(paymentView(covered, fmt, true, payOff, met).state).toBe('funded');
  });
});
