import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN } from '@hafb/engine';
import { minor } from '@hafb/shared';
import { applyChanges, setAssigned, type CommandContext, type PlanData } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import {
  assignTargets,
  coverSources,
  futureShortfalls,
  futureSourceId,
  laterMonths,
  moveTargets,
  parseSource,
  readyToAssignBreakdown,
  unassignSources,
} from './moneyMoves.ts';
import { planModel } from './planModel.ts';

let n = 0;
const ctx: CommandContext = { now: '2026-10-14T15:00:00.000Z', today: SAMPLE_TODAY, newId: () => `mm-${String((n += 1))}` };
const sample = buildSamplePlan();
const month = '2026-10';
const id = (name: string): string => sample.plan.categories.find((c) => c.name === name)?.id ?? '';
const optionIds = (groups: readonly { options: readonly { id: string }[] }[]): string[] => groups.flatMap((g) => g.options.map((o) => o.id));
const assign = (plan: PlanData, m: '2026-10' | '2026-11' | '2026-12', name: string, cents: number): PlanData =>
  applyChanges(plan, setAssigned(plan, ctx, { month: m, categoryId: id(name), amount: minor(cents) }).changes).plan;

describe('move targets', () => {
  it('offer Ready to Assign first, then every other visible category with its Available', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    const t = moveTargets(model, id('Groceries'));
    expect(t.groups[0]?.options[0]?.id).toBe(READY_TO_ASSIGN);
    const ids = optionIds(t.groups);
    expect(ids).not.toContain(id('Groceries'));
    expect(ids).toContain(id('Dining Out')); // overspent categories are valid destinations
    expect(t.amounts.get(id('Dining Out'))).toBe(model.ms.categories[id('Dining Out')]?.available);
    expect(optionIds(assignTargets(model).groups)).toContain(id('Groceries'));
  });
});

describe('cover sources', () => {
  it('are Ready to Assign (when positive) and categories that have money', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    const s = coverSources(model, id('Car Maintenance'), []);
    const ids = optionIds(s.groups);
    expect(ids[0]).toBe(READY_TO_ASSIGN);
    for (const x of ids.slice(1)) expect(model.ms.categories[x]?.available ?? 0).toBeGreaterThan(0);
    expect(ids).not.toContain(id('Car Maintenance'));
  });

  it('include money assigned in future months', () => {
    const plan = assign(sample.plan, '2026-12', 'Groceries', 12_345);
    const later = laterMonths(plan, month, SAMPLE_TODAY);
    expect(later.map((x) => x.month)).toEqual(['2026-11', '2026-12']);
    const s = coverSources(planModel(plan, month, SAMPLE_TODAY), id('Car Maintenance'), later);
    const fid = futureSourceId('2026-12', id('Groceries'));
    expect(optionIds(s.groups)).toContain(fid);
    expect(s.amounts.get(fid)).toBe(12_345);
    expect(parseSource(fid)).toEqual({ from: id('Groceries'), month: '2026-12' });
    expect(parseSource(READY_TO_ASSIGN)).toEqual({ from: READY_TO_ASSIGN });
  });

  it('un-assign sources are categories with money', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    for (const x of optionIds(unassignSources(model).groups)) expect(model.ms.categories[x]?.available ?? 0).toBeGreaterThan(0);
  });
});

describe('future shortfalls', () => {
  it('flag future months whose Ready to Assign is negative', () => {
    const plan = assign(sample.plan, '2026-11', 'Groceries', 999_999);
    const later = laterMonths(plan, month, SAMPLE_TODAY);
    const short = futureShortfalls(later);
    expect(short.map((x) => x.month)).toEqual(['2026-11']);
    expect(short[0]?.readyToAssign).toBeLessThan(0);
    // October itself never goes below zero for it (budget-math §2, example 2.5).
    expect(planModel(plan, month, SAMPLE_TODAY).ms.readyToAssign).toBe(0);
  });
});

describe('Ready to Assign breakdown', () => {
  it('lists only non-zero lines, signed, and the total matches', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    const b = readyToAssignBreakdown(model.ms, month);
    const sum = [...b.plus, ...b.minus].reduce((s, l) => s + l.amount, 0);
    expect(sum).toBe(b.total);
    expect(b.total).toBe(model.ms.readyToAssign);
    for (const l of b.plus) expect(l.amount).toBeGreaterThan(0);
    for (const l of b.minus) expect(l.amount).toBeLessThan(0);
    expect(b.minus.some((l) => l.label === 'Assigned in October')).toBe(true);
  });

  it('matches YNAB for the trial October: Inflow +$5,500, Assigned −$2,430, total $3,070', () => {
    const ms = {
      month,
      readyToAssign: minor(307_000),
      breakdown: { leftOverFromLastMonth: minor(0), cashOverspendingLastMonth: minor(0), inflows: minor(550_000), assignedThisMonth: minor(243_000), assignedInFuture: minor(0) },
      categories: {},
      totals: { assigned: minor(243_000), activity: minor(0), available: minor(0) },
    } as const;
    const b = readyToAssignBreakdown(ms, month);
    expect(b.plus).toEqual([{ label: 'Inflow: Ready to Assign transactions in October', amount: 550_000 }]);
    expect(b.minus).toEqual([{ label: 'Assigned in October', amount: -243_000 }]);
    expect(b.note).toMatch(/Give these dollars a job/);
  });
});
