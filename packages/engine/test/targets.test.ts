// Worked examples for CLAUDE.md §5.4 (docs/budget-math.md §6). The "YNAB" examples
// reproduce numbers shown in YNAB's own help-center screenshots.
import { asISODate, minor, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import {
  costToBeMe,
  evaluateTarget,
  legacyTarget,
  ValidationError,
  validateTarget,
  weekdaysInMonth,
  type CategoryMonth,
  type Target,
} from '../src/index.ts';

const cm = (p: { assigned?: number; carriedIn?: number; available?: number }): CategoryMonth => {
  const assigned = p.assigned ?? 0;
  const carriedIn = p.carriedIn ?? 0;
  return {
    categoryId: 'c',
    assigned: minor(assigned),
    carriedIn: minor(carriedIn),
    activity: minor(0),
    available: minor(p.available ?? carriedIn + assigned),
    cashActivity: minor(0),
    creditActivity: minor(0),
    overspending: { cash: minor(0), credit: minor(0) },
  };
};
const target = (t: Partial<Target> & Pick<Target, 'cadence' | 'behavior' | 'amount'>): Target => ({
  categoryId: 'c',
  startMonth: '2026-01',
  ...t,
});
const none = () => minor(0);
const evalT = (t: Target, month: Month, c: CategoryMonth, assignedBy: (m: Month) => ReturnType<typeof minor> = none) =>
  evaluateTarget(t, month, c, assignedBy);

describe('§6.1 weekly and monthly targets', () => {
  it('counts weekdays in a month', () => {
    expect(weekdaysInMonth('2026-02', 6)).toBe(4); // Saturdays 7, 14, 21, 28
    expect(weekdaysInMonth('2026-01', 6)).toBe(5); // Saturdays 3 … 31
    expect(weekdaysInMonth('2024-02', 4)).toBe(5); // leap-year Thursdays
  });

  it('YNAB example: Refill up to $100/week, 4 Saturdays, $50 left over + $100 assigned → $250 to go, 37%', () => {
    const t = target({ amount: minor(10_000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill' });
    expect(evalT(t, '2026-02', cm({ carriedIn: 5_000, assigned: 10_000 }))).toMatchObject({
      needed: 40_000,
      funded: 15_000,
      toGo: 25_000,
      neededThisMonth: 35_000,
      underfunded: 25_000,
      progressPercent: 37,
      status: 'underfunded',
    });
  });

  it('a five-Saturday month needs five weeks', () => {
    const t = target({ amount: minor(10_000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'setAside' });
    expect(evalT(t, '2026-01', cm({})).needed).toBe(50_000);
  });

  it('monthly "Set aside another": only this month’s assignment counts, leftovers don’t', () => {
    const t = target({ amount: minor(10_000), cadence: { kind: 'monthly', day: 15 }, behavior: 'setAside' });
    expect(evalT(t, '2026-03', cm({ carriedIn: 8_000, assigned: 6_000 }))).toMatchObject({
      funded: 6_000,
      underfunded: 4_000,
      dueDate: '2026-03-15',
    });
    expect(evalT(t, '2026-03', cm({ assigned: 13_000 }))).toMatchObject({ status: 'funded', overfunded: 3_000 });
  });

  it('YNAB example: monthly Refill up to $100, $50 left over + $50 assigned → met', () => {
    const t = target({ amount: minor(10_000), cadence: { kind: 'monthly', day: 'last' }, behavior: 'refill' });
    expect(evalT(t, '2026-04', cm({ carriedIn: 5_000, assigned: 5_000 }))).toMatchObject({
      needed: 10_000,
      funded: 10_000,
      toGo: 0,
      underfunded: 0,
      status: 'funded',
      progressPercent: 100,
      dueDate: '2026-04-30',
    });
  });

  it('day 31 clamps to the month’s last day', () => {
    const t = target({ amount: minor(100), cadence: { kind: 'monthly', day: 31 }, behavior: 'setAside' });
    expect(evalT(t, '2026-02', cm({})).dueDate).toBe('2026-02-28');
  });
});

describe('§6.2 multi-month targets (yearly, custom)', () => {
  it('YNAB example: Set aside another $300 every 6 months by Feb 1 2027 → assign $50 this month', () => {
    const t = target({
      amount: minor(30_000),
      cadence: { kind: 'custom', due: asISODate('2027-02-01'), repeatEveryMonths: 6 },
      behavior: 'setAside',
      startMonth: '2026-09',
    });
    expect(evalT(t, '2026-09', cm({}))).toMatchObject({ needed: 30_000, funded: 0, toGo: 30_000, neededThisMonth: 5_000, monthsRemaining: 6 });
    // October, having assigned $50 in September: still $50/month for the remaining 5 months.
    const assignedBy = (m: Month) => minor(m === '2026-09' ? 5_000 : 0);
    expect(evalT(t, '2026-10', cm({ carriedIn: 5_000 }), assignedBy)).toMatchObject({ funded: 5_000, neededThisMonth: 5_000 });
    // After the Feb 2027 due date the next 6-month period (due Aug 2027) starts fresh.
    expect(evalT(t, '2027-03', cm({}), assignedBy)).toMatchObject({ dueDate: '2027-08-01', monthsRemaining: 6, neededThisMonth: 5_000 });
  });

  it('YNAB example: Refill up to $1,200 each year by Sep 1 2027 with $100 funded → 8%', () => {
    const t = target({ amount: minor(120_000), cadence: { kind: 'yearly', due: asISODate('2027-09-01') }, behavior: 'refill' });
    expect(evalT(t, '2026-10', cm({ carriedIn: 10_000 }))).toMatchObject({
      funded: 10_000,
      toGo: 110_000,
      progressPercent: 8,
      monthsRemaining: 12,
      neededThisMonth: 9_167, // ceil(1,100 / 12) so the goal is reached by the due date
    });
  });

  it('YNAB example: Have a balance of $10,000 by May 2027 with $1,111.12 → 11%, $8,888.88 to go', () => {
    const t = target({ amount: minor(1_000_000), cadence: { kind: 'custom', due: asISODate('2027-05-01') }, behavior: 'haveBalance' });
    expect(evalT(t, '2026-10', cm({ carriedIn: 111_112 }))).toMatchObject({ progressPercent: 11, toGo: 888_888, status: 'underfunded' });
  });

  it('Have a balance of with no date: progress only, never asks for money (YNAB trial 2026-10)', () => {
    const t = target({ amount: minor(50_000), cadence: { kind: 'custom' }, behavior: 'haveBalance' });
    expect(evalT(t, '2026-10', cm({ carriedIn: 20_000, assigned: 10_000 }))).toMatchObject({
      needed: 50_000,
      funded: 30_000,
      toGo: 20_000,
      neededThisMonth: 0,
      underfunded: 0,
      progressPercent: 60,
      monthlyCost: 0,
      status: 'onTrack',
    });
  });

  it('a non-repeating target is inactive after its due month', () => {
    const t = target({ amount: minor(30_000), cadence: { kind: 'custom', due: asISODate('2026-06-01') }, behavior: 'setAside' });
    expect(evalT(t, '2026-07', cm({ assigned: 1_000 })).status).toBe('inactive');
    expect(evalT(t, '2025-12', cm({})).status).toBe('inactive'); // before startMonth
  });
});

describe('§6.3 statuses', () => {
  const monthly = target({ amount: minor(10_000), cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside' });

  it('snoozed: no underfunded amount that month only', () => {
    const t = { ...monthly, snoozedMonths: ['2026-05' as Month] };
    expect(evalT(t, '2026-05', cm({}))).toMatchObject({ status: 'snoozed', underfunded: 0 });
    expect(evalT(t, '2026-06', cm({}))).toMatchObject({ status: 'underfunded', underfunded: 10_000 });
  });

  it('overspending is a category state, not a target status (YNAB trial: overspent Dining out shows its target met)', () => {
    expect(evalT(monthly, '2026-05', cm({ assigned: 10_000, available: -1_000 })).status).toBe('funded');
    expect(evalT(monthly, '2026-05', cm({ assigned: 5_000, available: -2_000 })).status).toBe('underfunded');
  });

  it('weekly: due days before the target was created need no funding that month (YNAB trial: Groceries)', () => {
    // Created Thu Oct 8 2026: the Oct 3 Saturday passed already; 4 Saturdays remain.
    const t = target({ amount: minor(10_000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill', startMonth: '2026-10', createdOn: asISODate('2026-10-08') });
    expect(evalT(t, '2026-10', cm({ assigned: 40_000 }))).toMatchObject({ needed: 50_000, funded: 40_000, toGo: 0, underfunded: 0, status: 'funded', progressPercent: 100, monthlyCost: 50_000 });
  });

  it('future months ignore leftover money for weekly/monthly refill targets (YNAB trial: November)', () => {
    const t = target({ amount: minor(10_000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill', startMonth: '2026-10' });
    const today = { today: asISODate('2026-10-08') };
    expect(evaluateTarget(t, '2026-11', cm({ carriedIn: 18_500 }), none, today)).toMatchObject({ needed: 40_000, funded: 0, toGo: 40_000, underfunded: 40_000, progressPercent: 0 });
    // In the current month the leftover counts.
    expect(evaluateTarget(t, '2026-10', cm({ carriedIn: 18_500, assigned: 30_000 }), none, today)).toMatchObject({ funded: 48_500, underfunded: 1_500 });
  });

  it('on track: this month’s share is in, the period goal is not yet reached', () => {
    const t = target({ amount: minor(60_000), cadence: { kind: 'yearly', due: asISODate('2026-12-01') }, behavior: 'refill', startMonth: '2026-01' });
    expect(evalT(t, '2026-07', cm({ carriedIn: 30_000, assigned: 5_000 })).status).toBe('onTrack');
  });
});

describe('§6.4 validation and Cost to Be Me', () => {
  it('rejects targets YNAB does not allow', () => {
    expect(() => { validateTarget(target({ amount: minor(1), cadence: { kind: 'custom', due: asISODate('2027-01-01'), repeatEveryMonths: 3 }, behavior: 'haveBalance' })); }).toThrow(ValidationError);
    expect(() => { validateTarget(target({ amount: minor(1), cadence: { kind: 'custom' }, behavior: 'setAside' })); }).toThrow(ValidationError);
    expect(() => { validateTarget(target({ amount: minor(0), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside' })); }).toThrow(ValidationError);
    expect(() => { validateTarget(target({ amount: minor(1), cadence: { kind: 'weekly', weekday: 7 }, behavior: 'setAside' })); }).toThrow(ValidationError);
  });

  it('Cost to Be Me: full weekly/monthly amounts, multi-month shares, no-date balances excluded (YNAB trial: $1,390.01)', () => {
    const a = evalT(target({ amount: minor(10_000), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside' }), '2026-02', cm({}));
    const b = evalT(target({ amount: minor(10_000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill' }), '2026-02', cm({ carriedIn: 5_000 }));
    const c = evalT(target({ amount: minor(500_000), cadence: { kind: 'custom' }, behavior: 'haveBalance' }), '2026-02', cm({}));
    const d = evalT(target({ amount: minor(120_000), cadence: { kind: 'custom', due: asISODate('2026-11-01') }, behavior: 'haveBalance' }), '2026-02', cm({}));
    // 100 + 400 (4 Saturdays, leftovers don't reduce it) + 0 + ⌈1,200 / 10⌉ = 620
    expect(costToBeMe({ a, b, c, d }, minor(600_000))).toEqual({ targets: 62_000, expectedIncome: 600_000, difference: 538_000 });
  });
});

describe('§6.10 legacy goal types (CLAUDE.md §5.4 mapping; T-10)', () => {
  // YNAB's pre-2024 goal types, as its API still names them (goal_type, goal_cadence,
  // goal_cadence_frequency, goal_day, goal_needs_whole_amount). Its CSV export carries none.
  const on = asISODate('2026-10-09');
  const map = (goal: Parameters<typeof legacyTarget>[0]) => legacyTarget(goal, 'c', on);
  const amount = minor(50_000);
  const due = asISODate('2027-03-31');

  it('Target Balance (TB) → Have a balance of, no date', () => {
    expect(map({ type: 'TB', amount })).toMatchObject({ cadence: { kind: 'custom' }, behavior: 'haveBalance', startMonth: '2026-10', createdOn: on });
    expect(map({ type: 'TB', amount }).cadence).toEqual({ kind: 'custom' });
  });

  it('Target Balance by Date (TBD) → custom, Have a balance of, with the date', () => {
    expect(map({ type: 'TBD', amount, targetDate: due })).toMatchObject({ cadence: { kind: 'custom', due }, behavior: 'haveBalance' });
    expect(() => map({ type: 'TBD', amount })).toThrow(ValidationError);
  });

  it('Monthly Savings Builder (MF) → monthly, Set aside another', () => {
    expect(map({ type: 'MF', amount })).toMatchObject({ cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside' });
  });

  it('Monthly Debt Payment (DEBT) → monthly, Set aside another, on its day', () => {
    expect(map({ type: 'DEBT', amount, day: 15 })).toMatchObject({ cadence: { kind: 'monthly', day: 15 }, behavior: 'setAside' });
  });

  it('Needed for Spending (NEED) → the matching cadence; whole amount = Set aside, else Refill', () => {
    expect(map({ type: 'NEED', amount, cadence: 1, frequency: 1, day: 5 })).toMatchObject({ cadence: { kind: 'monthly', day: 5 }, behavior: 'setAside' });
    expect(map({ type: 'NEED', amount, cadence: 1, frequency: 1, needsWholeAmount: false })).toMatchObject({ cadence: { kind: 'monthly', day: 'last' }, behavior: 'refill' });
    expect(map({ type: 'NEED', amount, cadence: 2, frequency: 1, day: 6 })).toMatchObject({ cadence: { kind: 'weekly', weekday: 6 } });
    expect(map({ type: 'NEED', amount, cadence: 13, frequency: 1, targetDate: due })).toMatchObject({ cadence: { kind: 'yearly', due } });
    // Every other month (1 × 2), every 3 months (cadence 4), every 2 years (14 or 13 × 2).
    expect(map({ type: 'NEED', amount, cadence: 1, frequency: 2, targetDate: due }).cadence).toEqual({ kind: 'custom', due, repeatEveryMonths: 2 });
    expect(map({ type: 'NEED', amount, cadence: 4, targetDate: due }).cadence).toEqual({ kind: 'custom', due, repeatEveryMonths: 3 });
    expect(map({ type: 'NEED', amount, cadence: 14, targetDate: due }).cadence).toEqual({ kind: 'custom', due, repeatEveryMonths: 24 });
    expect(map({ type: 'NEED', amount, cadence: 13, frequency: 2, targetDate: due }).cadence).toEqual({ kind: 'custom', due, repeatEveryMonths: 24 });
    // No cadence: a one-time amount by its date.
    expect(map({ type: 'NEED', amount, cadence: 0, targetDate: due }).cadence).toEqual({ kind: 'custom', due });
  });

  it('every mapped target is valid, and what has no YNAB equivalent is refused', () => {
    for (const g of [
      { type: 'TB', amount },
      { type: 'TBD', amount, targetDate: due },
      { type: 'MF', amount },
      { type: 'NEED', amount, cadence: 3, targetDate: due },
    ] as const) validateTarget(map(g));
    expect(() => map({ type: 'NEED', amount, cadence: 2, frequency: 2 })).toThrow(/every 2 weeks/);
    expect(() => map({ type: 'NEED', amount, cadence: 4 })).toThrow(ValidationError);
    expect(() => map({ type: 'MF', amount: minor(0) })).toThrow(ValidationError);
  });
});
