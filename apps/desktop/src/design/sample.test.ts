import { describe, expect, it } from 'vitest';
import { buildSamplePlan } from './sample.ts';
import { planModel } from '../screens/plan/planModel.ts';

// The mockups are only useful if the sample shows every state the design must handle.
describe('sample household', () => {
  const { plan, today } = buildSamplePlan();
  const model = planModel(plan, '2026-10', today);
  const byName = (name: string) => {
    const c = plan.categories.find((x) => x.name === name);
    if (!c) throw new Error(name);
    const view = model.views.get(c.id);
    const cm = model.ms.categories[c.id];
    if (!view || !cm) throw new Error(name);
    return { view, cm };
  };

  it('has money to assign', () => {
    expect(model.ms.readyToAssign).toBe(23801);
  });

  it('covers every Available state', () => {
    expect(byName('Electric').view.state).toBe('underfunded');
    expect(byName('Dining Out').view).toMatchObject({ state: 'overspent', credit: true });
    expect(byName('Car Maintenance').view).toMatchObject({ state: 'overspent', credit: false });
    expect(byName('New Laptop').view.state).toBe('snoozed');
    expect(byName('Groceries').view.state).toBe('funded');
    expect(byName('Mortgage').view).toMatchObject({ state: 'zero', barState: 'funded', message: 'Fully spent' });
  });

  it('has a weekly target drawn as weekly segments', () => {
    expect(byName('Gas & Transit').view.bar?.segments).toBeGreaterThanOrEqual(4);
  });

  it('includes a split, a flagged and an unapproved transaction', () => {
    expect(plan.transactions.some((t) => (t.subtransactions?.length ?? 0) === 3)).toBe(true);
    expect(plan.transactions.some((t) => t.flag === 'orange')).toBe(true);
    expect(plan.transactions.some((t) => t.approved === false)).toBe(true);
  });
});
