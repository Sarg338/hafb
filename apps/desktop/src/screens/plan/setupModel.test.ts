import { describe, expect, it } from 'vitest';
import { minor } from '@hafb/shared';
import { applyChanges, createAccount, createCategory, createGroup, setAssigned, setTarget, type CommandContext } from '@hafb/store';
import { buildBlankPlan, buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { setupChecklist } from './setupModel.ts';

const done = (plan: Parameters<typeof setupChecklist>[0]) => setupChecklist(plan).filter((s) => s.done).map((s) => s.id);

describe('Get started checklist (S7.5)', () => {
  it('a new plan has everything to do; a used plan has nothing', () => {
    expect(done(buildBlankPlan())).toEqual([]);
    expect(done(buildSamplePlan().plan)).toEqual(['accounts', 'categories', 'assign', 'target', 'transaction']);
  });

  it('ticks off each step from the plan itself, so it resumes after a restart', () => {
    let n = 0;
    const ctx: CommandContext = { now: '2026-10-14T15:00:00.000Z', today: SAMPLE_TODAY, newId: () => `t-${String(++n)}` };
    let plan = buildBlankPlan();
    const run = (c: { changes: Parameters<typeof applyChanges>[1] }) => {
      plan = applyChanges(plan, c.changes).plan;
    };
    // An account's starting balance is not "a transaction" yet; a credit card's payment category is not a category of yours.
    run(createAccount(plan, ctx, { name: 'Visa', type: 'creditCard', startingBalance: minor(0) }));
    expect(done(plan)).toEqual(['accounts']);
    const g = createGroup(plan, ctx, { name: 'Bills' });
    run(g);
    const c = createCategory(plan, ctx, { groupId: g.groupId, name: 'Rent' });
    run(c);
    run(setAssigned(plan, ctx, { month: '2026-10', categoryId: c.categoryId, amount: minor(50000) }));
    run(setTarget(plan, ctx, { categoryId: c.categoryId, amount: minor(50000), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside' }));
    expect(done(plan)).toEqual(['accounts', 'categories', 'assign', 'target']);
  });
});
