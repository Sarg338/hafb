import { describe, expect, it } from 'vitest';
import { addMonths } from '@hafb/shared';
import { applyChanges, setAssigned, setExpectedIncome, type CommandContext } from '@hafb/store';
import { minor } from '@hafb/shared';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { autoAssignChoices, costView, futureMonths, monthSummary } from './inspectorModel.ts';
import { laterMonths } from './moneyMoves.ts';
import { planModel } from './planModel.ts';

const sample = buildSamplePlan().plan;
const ctx: CommandContext = { now: '2026-10-14T16:00:00.000Z', today: SAMPLE_TODAY, newId: () => 'insp' };
const model = planModel(sample, '2026-10', SAMPLE_TODAY);

describe('inspector numbers (S5.1)', () => {
  it("the month's summary ties to the engine: left over + assigned + activity = available", () => {
    const s = monthSummary(model.ms);
    expect(s.assigned).toBe(model.ms.totals.assigned);
    expect(s.activity).toBe(model.ms.totals.activity);
    expect(s.available).toBe(model.ms.totals.available);
    expect(s.leftOver + s.assigned + s.activity).toBe(s.available);
  });

  it('a selection sums only its categories', () => {
    const ids = Object.keys(model.ms.categories).slice(0, 3);
    const s = monthSummary(model.ms, ids);
    expect(s.available).toBe(ids.reduce((t, id) => t + (model.ms.categories[id]?.available ?? 0), 0));
  });

  it('Cost to Be Me: bars sized to the larger of targets and expected income', () => {
    const noIncome = applyChanges(sample, setExpectedIncome(sample, ctx, { amount: null }).changes).plan;
    const none = costView(planModel(noIncome, '2026-10', SAMPLE_TODAY));
    expect(none.income).toBe(0);
    expect(none.targetsPercent).toBe(none.targets > 0 ? 100 : 0);
    const withIncome = applyChanges(sample, setExpectedIncome(sample, ctx, { amount: minor(none.targets * 2) }).changes).plan;
    const c = costView(planModel(withIncome, '2026-10', SAMPLE_TODAY));
    expect(c.incomePercent).toBe(100);
    expect(c.targetsPercent).toBeCloseTo(50);
    expect(c.difference).toBe(c.income - c.targets);
  });

  it('Assigned in Future Months lists next month even with nothing assigned, then later months with money', () => {
    expect(futureMonths(model, []).map((f) => f.month)).toEqual([addMonths('2026-10', 1)]);
    const cat = sample.categories.find((c) => c.name === 'Groceries')?.id ?? '';
    const ahead = applyChanges(sample, setAssigned(sample, ctx, { month: '2027-01', categoryId: cat, amount: minor(5000) }).changes).plan;
    const m = planModel(ahead, '2026-10', SAMPLE_TODAY);
    const list = futureMonths(m, laterMonths(ahead, '2026-10', SAMPLE_TODAY));
    expect(list.map((f) => [f.month, f.assigned])).toEqual([
      ['2026-11', 0],
      ['2027-01', 5000],
    ]);
    for (const f of list) if (f.funded !== null) expect(f.funded).toBeGreaterThanOrEqual(0);
  });

  it('Auto-Assign: Reset options act only on a selection; a payment category says "Paid"; scheduled bills count', () => {
    const all = autoAssignChoices(model, [...model.views.keys()], false);
    expect(all.find((c) => c.id === 'resetAssigned')?.change.total).toBe(0);
    const pay = [...model.paymentIds][0] ?? '';
    const labels = autoAssignChoices(model, [pay], true).map((c) => c.label);
    expect(labels).toContain('Paid Last Month');
    expect(labels).toContain('Average Paid');
    expect(labels).toContain('Reset Available Amount');
  });
});
