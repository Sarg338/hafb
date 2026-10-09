import { describe, expect, it } from 'vitest';
import { applyChanges, setPayeeDefaults, setPayeesHidden, type CommandContext, type PlanData } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { categorizeMode, combinePlan, defaultCategoryName, modeArgs, payeeLists, payeeUses } from './payeesModel.ts';

const sample = buildSamplePlan().plan;
const ctx: CommandContext = { now: '2026-10-14T16:00:00.000Z', today: SAMPLE_TODAY, newId: () => 'p-new' };
const payee = (plan: PlanData, name: string) => {
  const p = plan.payees.find((x) => x.name === name);
  if (!p) throw new Error(`no payee ${name}`);
  return p;
};

describe('Manage Payees model (S5.5)', () => {
  it('groups payees, hidden payees and transfer payees by name, with use counts', () => {
    const lists = payeeLists(sample);
    expect(lists.payees.map((p) => p.name)).toEqual([...lists.payees.map((p) => p.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    expect(lists.transfers.every((p) => p.name.startsWith('Transfer : '))).toBe(true);
    expect(lists.hidden).toEqual([]);
    const fresh = payee(sample, 'Fresh Market');
    expect(lists.payees.find((p) => p.id === fresh.id)?.uses).toBe(payeeUses(sample).get(fresh.id));
    expect(payeeLists(sample, 'fresh').payees.map((p) => p.name)).toEqual(['Fresh Market']);
    const hidden = applyChanges(sample, setPayeesHidden(sample, ctx, { payeeIds: [fresh.id], hidden: true }).changes).plan;
    expect(payeeLists(hidden).hidden.map((p) => p.name)).toEqual(['Fresh Market']);
    expect(payeeLists(hidden).payees.some((p) => p.id === fresh.id)).toBe(false);
  });

  it('categorization modes and the default category name', () => {
    const fresh = payee(sample, 'Fresh Market');
    expect(categorizeMode(fresh)).toBe('auto');
    expect(defaultCategoryName(sample, fresh)).toMatch(/Groceries$/);
    expect(defaultCategoryName(sample, payee(sample, 'Acme Logistics'))).toBe('Inflow: Ready to Assign');
    const fixed = applyChanges(sample, setPayeeDefaults(sample, ctx, { payeeId: fresh.id, ...modeArgs(fresh, 'fixed') }).changes).plan;
    expect(categorizeMode(payee(fixed, 'Fresh Market'))).toBe('fixed');
    const off = applyChanges(fixed, setPayeeDefaults(fixed, ctx, { payeeId: fresh.id, ...modeArgs(payee(fixed, 'Fresh Market'), 'off') }).changes).plan;
    expect(categorizeMode(payee(off, 'Fresh Market'))).toBe('off');
    const back = applyChanges(off, setPayeeDefaults(off, ctx, { payeeId: fresh.id, ...modeArgs(payee(off, 'Fresh Market'), 'auto') }).changes).plan;
    expect(categorizeMode(payee(back, 'Fresh Market'))).toBe('auto');
  });

  it('Combine and Rename keeps the payee already named that, else the first selected', () => {
    const a = payee(sample, 'Taco Stand').id;
    const b = payee(sample, 'Pho 99').id;
    expect(combinePlan(sample, [a, b], 'Pho 99')).toEqual({ targetId: b, sourceIds: [a], rename: null });
    expect(combinePlan(sample, [a, b], 'Takeout')).toEqual({ targetId: a, sourceIds: [b], rename: 'Takeout' });
    expect(combinePlan(sample, [a], 'Takeout')).toBeNull();
    expect(combinePlan(sample, [a, b], '  ')).toBeNull();
  });
});
