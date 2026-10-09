import { describe, expect, it } from 'vitest';
import { monthState } from '@hafb/engine';
import { minor } from '@hafb/shared';
import { applyChanges, applyPlanChange, planBudget, setAssigned, type CommandContext } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { planModel } from './planModel.ts';
import { planResetPreview } from './PlanReset.tsx';

const sample = buildSamplePlan().plan;
const ctx: CommandContext = { now: '2026-10-14T16:00:00.000Z', today: SAMPLE_TODAY, newId: () => 'reset' };

describe('Plan Reset (§5.6)', () => {
  it('returns every unspent dollar, future months included; card payments keep theirs; nothing stays overspent', () => {
    const groceries = sample.categories.find((c) => c.name === 'Groceries')?.id ?? '';
    const plan = applyChanges(sample, setAssigned(sample, ctx, { month: '2026-12', categoryId: groceries, amount: minor(7_000) }).changes).plan;
    const model = planModel(plan, '2026-10', SAMPLE_TODAY);
    const p = planResetPreview(model);
    expect(p.fromFuture).toBe(7_000);
    expect(p.returned).toBeGreaterThan(0);
    const after = applyChanges(plan, applyPlanChange(plan, ctx, { change: p.change, kind: 'planReset', label: 'Plan Reset' }).changes).plan;
    const ms = monthState(planBudget(after, { today: SAMPLE_TODAY, throughMonth: '2026-12' }), '2026-10');
    for (const [id, cm] of Object.entries(ms.categories)) {
      // Covering credit overspending funds that card spending, so a payment category can only gain.
      if (model.paymentIds.has(id)) expect(cm.available).toBeGreaterThanOrEqual(model.ms.categories[id]?.available ?? 0);
      else expect(cm.available).toBe(0);
    }
    expect(ms.readyToAssign - model.ms.readyToAssign).toBe(p.returned - p.covered + 7_000);
  });
});
