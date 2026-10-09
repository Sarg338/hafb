import { describe, expect, it } from 'vitest';
import { UNCATEGORIZED } from '@hafb/engine';
import type { Month } from '@hafb/shared';
import { buildSamplePlan } from '../../design/sample.ts';
import {
  accountTree,
  categoryTree,
  checkedLeaves,
  DEFAULT_FILTERS,
  engineFilters,
  filterTree,
  leafIds,
  monthLabel,
  monthTick,
  planBounds,
  rangeLabel,
  reportTab,
  resolveRange,
  selectionLabel,
  shiftRange,
  type ReflectFilters,
} from './reflectModel.ts';

const plan = buildSamplePlan().plan;
const bounds = { first: '2025-11' as Month, last: '2026-10' as Month };
const today = '2026-10-14';
const range = (f: Partial<ReflectFilters>) => resolveRange({ ...DEFAULT_FILTERS, ...f }, today, bounds);

describe('Reflect date range (YNAB presets, trial 2026-10-09)', () => {
  it('resolves every preset, clipped to the plan’s months', () => {
    expect(range({ preset: 'thisMonth' })).toEqual({ from: '2026-10', to: '2026-10', outside: false });
    expect(range({ preset: 'last3' })).toEqual({ from: '2026-08', to: '2026-10', outside: false });
    expect(range({ preset: 'last6' })).toMatchObject({ from: '2026-05', to: '2026-10' });
    expect(range({ preset: 'last12' })).toMatchObject({ from: '2025-11', to: '2026-10' }); // 2025-11 is the first month
    expect(range({ preset: 'ytd' })).toMatchObject({ from: '2026-01', to: '2026-10' });
    expect(range({ preset: 'lastYear' })).toMatchObject({ from: '2025-11', to: '2025-12', outside: false });
    expect(range({ preset: 'all' })).toMatchObject({ from: '2025-11', to: '2026-10' });
    expect(range({ preset: 'custom', from: '2026-06', to: '2026-03' })).toMatchObject({ from: '2026-03', to: '2026-06' });
  });

  it('a range wholly before the plan is empty, at the plan’s first month', () => {
    expect(resolveRange({ ...DEFAULT_FILTERS, preset: 'lastYear' }, today, { first: '2026-03', last: '2026-10' })).toEqual({ from: '2026-03', to: '2026-03', outside: true });
  });

  it('previous / next shift by the range’s own length and stop at the plan’s edges', () => {
    const f: ReflectFilters = { ...DEFAULT_FILTERS, preset: 'last3' };
    const prev = shiftRange(f, today, bounds, -1);
    expect(prev).toMatchObject({ preset: 'custom', from: '2026-05', to: '2026-07' });
    expect(shiftRange(f, today, bounds, 1)).toBeNull(); // already at this month
    const early = shiftRange({ ...DEFAULT_FILTERS, preset: 'custom', from: '2025-12', to: '2026-02' }, today, bounds, -1);
    expect(early).toMatchObject({ from: '2025-11', to: '2026-01' }); // clamped, same length
    expect(shiftRange({ ...DEFAULT_FILTERS, preset: 'custom', from: '2025-11', to: '2025-11' }, today, bounds, -1)).toBeNull();
    expect(shiftRange({ ...DEFAULT_FILTERS, preset: 'thisMonth' }, today, bounds, -1)).toMatchObject({ from: '2026-09', to: '2026-09' });
  });

  it('labels months the way YNAB does', () => {
    expect(monthLabel('2026-10')).toBe('Oct 2026');
    expect(rangeLabel('2026-10', '2026-10')).toBe('Oct 2026');
    expect(rangeLabel('2026-08', '2026-10')).toBe('Aug 2026 – Oct 2026');
    expect(monthTick('2026-01')).toBe('1/26');
  });

  it('bounds run from the plan’s first month to this month', () => {
    const b = planBounds(plan, today);
    expect(b.last).toBe('2026-10');
    expect(b.first <= '2026-10').toBe(true);
  });

  it('tab ids fall back to Spending Breakdown', () => {
    expect(reportTab('networth')).toBe('networth');
    expect(reportTab('nope')).toBe('breakdown');
    expect(reportTab(undefined)).toBe('breakdown');
  });
});

describe('Reflect category and account filters', () => {
  it('lists Uncategorized first, then groups in plan order without Credit Card Payments', () => {
    const tree = categoryTree(plan);
    expect(tree[0]).toEqual({ id: UNCATEGORIZED, name: 'Uncategorized Transactions' });
    const names = tree.map((n) => n.name);
    expect(names).not.toContain('Credit Card Payments');
    const ccIds = new Set(plan.categories.filter((c) => c.creditCardAccountId !== undefined).map((c) => c.id));
    expect(leafIds(tree).some((id) => ccIds.has(id))).toBe(false);
  });

  it('spending accounts are Cash and Credit; Net Worth adds Loans and Tracking', () => {
    const budget = accountTree(plan, 'budget').map((n) => n.name);
    expect(budget.every((n) => n === 'Cash Accounts' || n === 'Credit Accounts')).toBe(true);
    const all = accountTree(plan, 'all');
    expect(leafIds(all).length).toBe(plan.accounts.filter((a) => a.deletedAt === undefined).length);
  });

  it('labels a partial pick with a count', () => {
    expect(selectionLabel('Categories', 16, 16)).toEqual({ text: 'All Categories' });
    expect(selectionLabel('Categories', 15, 16)).toEqual({ text: 'Selected Categories', count: 15 });
    expect(selectionLabel('Accounts', 0, 3)).toEqual({ text: 'No Accounts' });
  });

  it('search keeps a matching group whole, otherwise only matching categories', () => {
    const tree = categoryTree(plan);
    const group = tree.find((n) => n.children !== undefined);
    if (!group?.children) throw new Error('no group');
    expect(filterTree(tree, group.name).find((n) => n.id === group.id)?.children).toEqual(group.children);
    const child = group.children[0];
    if (!child) throw new Error('empty group');
    const hit = filterTree(tree, child.name).find((n) => n.id === group.id);
    expect(hit?.children?.map((c) => c.id)).toContain(child.id);
    expect(filterTree(tree, '')).toEqual(tree);
  });

  it('engine filters name ids only when something is unchecked', () => {
    const r = { from: '2026-10' as Month, to: '2026-10' as Month };
    expect(engineFilters(DEFAULT_FILTERS, plan, r, 'budget')).toEqual(r);
    const someCategory = leafIds(categoryTree(plan))[1] ?? '';
    const f = engineFilters({ ...DEFAULT_FILTERS, excludedCategories: [someCategory] }, plan, r, 'budget');
    expect(f.categoryIds).toEqual(checkedLeaves(categoryTree(plan), [someCategory]));
    expect(f.categoryIds).not.toContain(someCategory);
    const anAccount = leafIds(accountTree(plan, 'all'))[0] ?? '';
    const nw = engineFilters({ ...DEFAULT_FILTERS, excludedCategories: [someCategory], excludedAccounts: [anAccount] }, plan, r, 'all');
    expect(nw.categoryIds).toBeUndefined();
    expect(nw.accountIds).not.toContain(anAccount);
  });
});
