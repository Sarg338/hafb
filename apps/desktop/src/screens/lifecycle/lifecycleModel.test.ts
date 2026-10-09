import { describe, expect, it } from 'vitest';
import { minor } from '@hafb/shared';
import { TEMPLATES } from '@hafb/store';
import { buildSamplePlan } from '../../design/sample.ts';
import { suggestedAmount, targetFor, templateKeys, templateSummary } from './lifecycleModel.ts';

describe('templates and target re-entry (S7.2)', () => {
  it('lists a template’s categories as Group/Category keys with YNAB’s summary line', () => {
    const t = TEMPLATES.find((x) => x.id === 'pet');
    if (!t) throw new Error('no pet template');
    expect(templateKeys(t)[0]).toBe('Pet/Adoption Fee');
    expect(templateSummary(t)).toBe('7 categories · 1 group');
  });

  it('turns a quick choice into a target with YNAB’s default due dates', () => {
    expect(targetFor('c1', 'monthlySetAside', minor(5000), '2026-10-09')).toEqual({ categoryId: 'c1', amount: 5000, cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside' });
    expect(targetFor('c1', 'weeklyRefill', minor(5000), '2026-10-09')?.cadence).toEqual({ kind: 'weekly', weekday: 0 });
    expect(targetFor('c1', 'yearly', minor(5000), '2026-10-09')?.cadence).toEqual({ kind: 'yearly', due: '2026-12-31' });
    expect(targetFor('c1', 'balance', minor(5000), '2026-10-09')).toMatchObject({ cadence: { kind: 'custom' }, behavior: 'haveBalance' });
    expect(targetFor('c1', 'none', minor(5000), '2026-10-09')).toBeNull();
    expect(targetFor('c1', 'monthlyRefill', minor(0), '2026-10-09')).toBeNull();
  });

  it('suggests the average assigned over the last three months', () => {
    const { plan } = buildSamplePlan();
    const groceries = plan.categories.find((c) => c.name === 'Groceries');
    if (!groceries) throw new Error('no groceries');
    const months = ['2026-09', '2026-08', '2026-07'];
    const assigned = months.map((m) => plan.assignments.find((a) => a.month === m && a.categoryId === groceries.id)?.assigned ?? 0);
    const expected = Math.round(assigned.reduce<number>((a, b) => a + b, 0) / 3);
    expect(suggestedAmount(plan, groceries.id, '2026-10-14')).toBe(expected);
    expect(suggestedAmount(plan, 'nothing', '2026-10-14')).toBe(0);
  });
});
