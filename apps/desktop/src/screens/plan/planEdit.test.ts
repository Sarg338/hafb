import { describe, expect, it } from 'vitest';
import { applyChanges, arrangeCategories, reorderGroups, setCategoryHidden, type CommandContext, type PlanData } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { dropCategory, dropGroup, groupCategories, orderedGroups, stepCategory, stepGroup } from './planEdit.ts';

let n = 0;
const ctx: CommandContext = { now: '2026-10-14T15:00:00.000Z', today: SAMPLE_TODAY, newId: () => `edit-${String((n += 1))}` };
const sample = buildSamplePlan();
const id = (name: string): string => {
  const c = sample.plan.categories.find((x) => x.name === name);
  if (!c) throw new Error(name);
  return c.id;
};
const groupId = (name: string): string => {
  const g = sample.plan.categoryGroups.find((x) => x.name === name);
  if (!g) throw new Error(name);
  return g.id;
};
const names = (plan: PlanData, group: string): string[] => groupCategories(plan, groupId(group)).map((c) => c.name);
const arrange = (plan: PlanData, args: { groupId: string; categoryIds: string[] } | null): PlanData => {
  if (!args) throw new Error('move refused');
  return applyChanges(plan, arrangeCategories(plan, ctx, args).changes).plan;
};

describe('dropCategory', () => {
  it('moves within a group, before or after a category', () => {
    const p = arrange(sample.plan, dropCategory(sample.plan, id('Electric'), { kind: 'category', id: id('Mortgage'), position: 'before' }));
    expect(names(p, 'Bills').slice(0, 2)).toEqual(['Electric', 'Mortgage']);
    const q = arrange(p, dropCategory(p, id('Electric'), { kind: 'category', id: id('Streaming'), position: 'after' }));
    expect(names(q, 'Bills').at(-1)).toBe('Electric');
  });

  it('moves across groups and into a group (first place)', () => {
    const p = arrange(sample.plan, dropCategory(sample.plan, id('Groceries'), { kind: 'group', id: groupId('Bills') }));
    expect(names(p, 'Bills')[0]).toBe('Groceries');
    expect(names(p, 'Everyday')).not.toContain('Groceries');
  });

  it('refuses moves that break the Credit Card Payments rules, and no-ops', () => {
    expect(dropCategory(sample.plan, id('Visa Rewards'), { kind: 'group', id: groupId('Bills') })).toBeNull();
    expect(dropCategory(sample.plan, id('Groceries'), { kind: 'category', id: id('Visa Rewards'), position: 'after' })).toBeNull();
    const first = groupCategories(sample.plan, groupId('Bills'))[0];
    expect(dropCategory(sample.plan, first?.id ?? '', { kind: 'group', id: groupId('Bills') })).toBeNull();
  });

  it('leaves hidden categories alone', () => {
    const hidden = applyChanges(sample.plan, setCategoryHidden(sample.plan, ctx, { categoryId: id('Pets'), hidden: true }).changes).plan;
    expect(dropCategory(hidden, id('Pets'), { kind: 'group', id: groupId('Bills') })).toBeNull();
    expect(groupCategories(hidden, groupId('Everyday')).map((c) => c.name)).not.toContain('Pets');
  });
});

describe('stepCategory', () => {
  it('moves one place, and over the edge into the neighbouring group', () => {
    const bills = names(sample.plan, 'Bills');
    const second = bills[1] ?? '';
    const p = arrange(sample.plan, stepCategory(sample.plan, id(second), -1));
    expect(names(p, 'Bills')[0]).toBe(second);
    const top = names(p, 'Bills')[0] ?? '';
    // The top of Bills going up: the group above is Credit Card Payments, which can't take it.
    expect(stepCategory(p, id(top), -1)).toBeNull();
    const lastBill = names(p, 'Bills').at(-1) ?? '';
    const q = arrange(p, stepCategory(p, id(lastBill), 1));
    expect(names(q, 'Everyday')[0]).toBe(lastBill);
  });
});

describe('groups', () => {
  it('keeps Credit Card Payments first and reorders the rest', () => {
    const order = (plan: PlanData): string[] => orderedGroups(plan).map((g) => g.name);
    expect(order(sample.plan)[0]).toBe('Credit Card Payments');
    const ids = dropGroup(sample.plan, groupId('Everyday'), groupId('Bills'), 'before');
    expect(ids).not.toBeNull();
    const p = applyChanges(sample.plan, reorderGroups(sample.plan, ctx, { groupIds: ids ?? [] }).changes).plan;
    expect(order(p).slice(0, 3)).toEqual(['Credit Card Payments', 'Everyday', 'Bills']);
    expect(dropGroup(p, groupId('Credit Card Payments'), groupId('Bills'), 'after')).toBeNull();
    expect(stepGroup(p, groupId('Everyday'), -1)).toBeNull();
    const down = stepGroup(p, groupId('Everyday'), 1);
    const q = applyChanges(p, reorderGroups(p, ctx, { groupIds: down ?? [] }).changes).plan;
    expect(order(q).slice(0, 3)).toEqual(['Credit Card Payments', 'Bills', 'Everyday']);
  });
});
