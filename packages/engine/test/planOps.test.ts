// Worked examples for CLAUDE.md §5.5, §5.6, §5.14 (docs/budget-math.md §7). Each example
// applies the returned deltas and recomputes, checking the plan the user would see.
import { asISODate, minor, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import {
  applyAssignmentDeltas,
  autoAssign,
  computeBudget,
  coverOverspending,
  evaluateTargets,
  freshStart,
  monthState,
  moveMoney,
  planReset,
  READY_TO_ASSIGN,
  ValidationError,
  type BudgetSnapshot,
  type PlanChange,
  type Target,
} from '../src/index.ts';
import { plan } from './helpers.ts';

const TODAY = asISODate('2026-03-15');
// Plan through June so future months stay visible after their assignments are cleared.
const run = (s: BudgetSnapshot) => computeBudget(s, { today: TODAY, throughMonth: '2026-06' });
const after = (s: BudgetSnapshot, c: PlanChange) => run(applyAssignmentDeltas(s, c.deltas));
const avail = (s: ReturnType<typeof run>, m: Month, id: string) => monthState(s, m).categories[id]?.available;

const base = () =>
  plan()
    .account('checking')
    .card('visa')
    .category('rent', 'food', 'fun', 'gifts')
    .income('2026-01-01', 500_000)
    .assign('2026-01', 'rent', 150_000)
    .assign('2026-01', 'food', 40_000)
    .spend('2026-01-10', 30_000, 'food')
    .spend('2026-01-11', 2_000, 'fun')
    .assign('2026-02', 'food', 50_000)
    .spend('2026-02-10', 45_000, 'food')
    .assign('2026-03', 'food', 45_000)
    .spend('2026-03-02', 70_000, 'food'); // March food: 150 carried + 450 − 700 = −100

describe('§7.1 move money', () => {
  it('moves between categories with no change to Ready to Assign', () => {
    const s = base().build();
    const c = moveMoney('2026-03', 'rent', 'food', minor(5_000));
    expect(c.total).toBe(0);
    const st = after(s, c);
    expect(avail(st, '2026-03', 'food')).toBe(-10_000 + 5_000);
    expect(monthState(st, '2026-03').readyToAssign).toBe(monthState(run(s), '2026-03').readyToAssign);
  });

  it('moving from Ready to Assign assigns; moving to it unassigns', () => {
    expect(moveMoney('2026-03', READY_TO_ASSIGN, 'gifts', minor(1_000))).toEqual({ deltas: [{ month: '2026-03', categoryId: 'gifts', delta: 1_000 }], total: 1_000 });
    expect(moveMoney('2026-03', 'gifts', READY_TO_ASSIGN, minor(1_000)).total).toBe(-1_000);
    expect(() => moveMoney('2026-03', 'a', 'a', minor(1))).toThrow(ValidationError);
    expect(() => moveMoney('2026-03', 'a', 'b', minor(0))).toThrow(ValidationError);
  });
});

describe('§7.2 cover overspending', () => {
  it('covers from another category in the same month', () => {
    const s = base().build();
    const st = run(s);
    const c = coverOverspending(st, '2026-03', 'food', [{ from: 'rent', amount: minor(10_000) }]);
    expect(avail(after(s, c), '2026-03', 'food')).toBe(0);
  });

  it('covers from money assigned in a future month (YNAB, Jun 2025)', () => {
    const s = base().assign('2026-04', 'gifts', 20_000).build();
    const st = run(s);
    const c = coverOverspending(st, '2026-03', 'food', [{ from: 'gifts', month: '2026-04', amount: minor(10_000) }]);
    const st2 = after(s, c);
    expect(avail(st2, '2026-03', 'food')).toBe(0);
    expect(monthState(st2, '2026-04').categories.gifts?.assigned).toBe(10_000);
    expect(monthState(st2, '2026-03').readyToAssign).toBe(monthState(st, '2026-03').readyToAssign);
  });

  it('refuses to over-cover, cover a funded category, or draw what a future month lacks', () => {
    const s = base().assign('2026-04', 'gifts', 5_000).build();
    const st = run(s);
    expect(() => coverOverspending(st, '2026-03', 'food', [{ from: 'rent', amount: minor(10_001) }])).toThrow(ValidationError);
    expect(() => coverOverspending(st, '2026-03', 'rent', [{ from: 'food', amount: minor(1) }])).toThrow(ValidationError);
    expect(() => coverOverspending(st, '2026-03', 'food', [{ from: 'gifts', month: '2026-04', amount: minor(6_000) }])).toThrow(ValidationError);
  });
});

describe('§7.3 auto-assign', () => {
  const ids = ['rent', 'food', 'fun'];

  it('Assigned Last Month / Spent Last Month set this month’s assigned', () => {
    const s = base().build();
    const st = run(s);
    expect(autoAssign('assignedLastMonth', { state: st, month: '2026-03', categoryIds: ids }).deltas).toEqual([
      { month: '2026-03', categoryId: 'food', delta: 5_000 }, // 450 → 500
    ]);
    expect(autoAssign('spentLastMonth', { state: st, month: '2026-03', categoryIds: ids }).deltas).toEqual([]); // Feb food spent 450 = already 450
  });

  it('Average Assigned / Average Spent use the previous months, rounded half away from zero', () => {
    const s = base().build();
    const st = run(s);
    // food assigned Jan 400, Feb 500 → 450 (already 450); fun spent Jan 20, Feb 0 → avg 10
    expect(autoAssign('averageAssigned', { state: st, month: '2026-03', categoryIds: ['food'] }).total).toBe(0);
    expect(autoAssign('averageSpent', { state: st, month: '2026-03', categoryIds: ['fun'] }).deltas).toEqual([{ month: '2026-03', categoryId: 'fun', delta: 1_000 }]);
    // 3 months 100, 0, 1 → 33.67 → 34 (half-away-from-zero on a non-tie rounds to nearest)
    const s2 = plan().account('checking').category('x').income('2026-01-01', 1_000).assign('2026-01', 'x', 100).assign('2026-03', 'x', 1).build();
    expect(autoAssign('averageAssigned', { state: run(s2), month: '2026-04', categoryIds: ['x'] }).deltas[0]?.delta).toBe(34);
  });

  it('Reset Available makes available 0; Reset Assigned clears this month', () => {
    const s = base().build();
    const st = run(s);
    const ra = autoAssign('resetAvailable', { state: st, month: '2026-03', categoryIds: ids });
    const st2 = after(s, ra);
    for (const id of ids) expect(avail(st2, '2026-03', id)).toBe(0);
    const rs = autoAssign('resetAssigned', { state: st, month: '2026-03', categoryIds: ids });
    expect(rs.deltas).toEqual([{ month: '2026-03', categoryId: 'food', delta: -45_000 }]);
  });

  it('Underfunded follows YNAB’s priority order and stops when Ready to Assign runs out', () => {
    const targets: Target[] = [
      { categoryId: 'rent', amount: minor(150_000), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside', startMonth: '2026-01' },
      { categoryId: 'fun', amount: minor(20_000), cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside', startMonth: '2026-01' },
      { categoryId: 'gifts', amount: minor(120_000), cadence: { kind: 'custom', due: asISODate('2026-12-01') }, behavior: 'refill', startMonth: '2026-01' },
    ];
    // Ready to Assign in March: 5,000 − 1,500 − 400 − 500 − 450 − 20 (Jan cash overspending on fun) = 2,130.00
    const s = base().build();
    const st = run(s);
    expect(monthState(st, '2026-03').readyToAssign).toBe(213_000);
    const ms = monthState(st, '2026-03');
    const evaluated = evaluateTargets(targets, ms, (c, m) => minor(monthState(st, m).categories[c]?.assigned ?? 0));
    const order = ['gifts', 'fun', 'food', 'rent'];
    const c = autoAssign('underfunded', { state: st, month: '2026-03', categoryIds: order, targets, evaluated });
    // food overspent 100 first; rent (dated monthly) 1,500; fun (end of month) 200;
    // gifts (future-dated, 1,200 over 10 months) 120. Total 1,920 ≤ 2,130.
    expect(c.deltas.map((d) => [d.categoryId, d.delta])).toEqual([
      ['food', 10_000],
      ['rent', 150_000],
      ['fun', 20_000],
      ['gifts', 12_000],
    ]);
    const limited = autoAssign('underfunded', {
      state: run(applyAssignmentDeltas(s, [{ month: '2026-03', categoryId: 'gifts', delta: minor(200_000) }])),
      month: '2026-03',
      categoryIds: order,
      targets,
      evaluated,
    });
    // Only 130.00 left: cover the 100 overspending, then 30 toward rent, then stop.
    expect(limited.deltas.map((d) => [d.categoryId, d.delta])).toEqual([
      ['food', 10_000],
      ['rent', 3_000],
    ]);
  });

  it('Reduce Overfunding removes only what is above target and assigned this month', () => {
    const targets: Target[] = [{ categoryId: 'food', amount: minor(30_000), cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside', startMonth: '2026-01' }];
    const st = run(base().build());
    const evaluated = evaluateTargets(targets, monthState(st, '2026-03'), () => minor(0));
    expect(autoAssign('reduceOverfunding', { state: st, month: '2026-03', categoryIds: ['food'], targets, evaluated }).deltas).toEqual([
      { month: '2026-03', categoryId: 'food', delta: -15_000 },
    ]);
  });
});

describe('§7.4 Plan Reset and Fresh Start', () => {
  it('Plan Reset returns unspent money (incl. future months) and leaves nothing overspent; CC payments untouched', () => {
    const s = base().spend('2026-03-05', 3_000, 'fun', 'visa').assign('2026-03', 'pay:visa', 1_000).assign('2026-05', 'gifts', 7_000).build();
    const st = run(s);
    const ids = ['rent', 'food', 'fun', 'gifts', 'pay:visa'];
    const c = planReset(st, '2026-03', ids, new Set(['pay:visa']));
    const st2 = after(s, c);
    for (const id of ['rent', 'food', 'fun', 'gifts']) expect(avail(st2, '2026-03', id)).toBe(0);
    expect(monthState(st2, '2026-05').categories.gifts?.assigned).toBe(0);
    // The reset never takes money from payment categories. Covering fun's 30.00 of *credit*
    // overspending funds that card spending, so it flows into the payment category (YNAB docs).
    expect(monthState(st, '2026-03').categories.fun?.overspending.credit).toBe(3_000);
    expect(avail(st2, '2026-03', 'pay:visa')).toBe((avail(st, '2026-03', 'pay:visa') ?? 0) + 3_000);
    // Everything not spent and not set aside for the card is back in Ready to Assign.
    const ms = monthState(st2, '2026-03');
    const before = monthState(st, '2026-03');
    // RTA + Σ available rises only by the cleared credit overspending (now funded card debt).
    expect(ms.readyToAssign + ms.breakdown.assignedInFuture + ms.totals.available).toBe(
      before.readyToAssign + before.breakdown.assignedInFuture + before.totals.available + 3_000,
    );
    expect(ms.breakdown.assignedInFuture).toBe(0);
  });

  it('Fresh Start keeps structure and starts each open account at its balance today', () => {
    const s = base().build();
    const st = run(s);
    const fresh = freshStart(s, st, asISODate('2026-03-15'));
    expect(fresh.assignments).toEqual([]);
    expect(fresh.categories).toEqual(s.categories);
    expect(fresh.transactions).toEqual([
      expect.objectContaining({ accountId: 'checking', amount: st.accountBalances.checking?.working, categoryId: READY_TO_ASSIGN }),
    ]);
    const freshState = computeBudget(fresh, { today: asISODate('2026-03-15') });
    expect(monthState(freshState, '2026-03').readyToAssign).toBe(st.accountBalances.checking?.working);
  });
});
