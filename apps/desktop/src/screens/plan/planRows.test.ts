import { describe, expect, it } from 'vitest';
import { applyChanges, createFocusedView, createGroup, setCategoryHidden, setGroupHidden, type CommandContext, type PlanData } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { planModel } from './planModel.ts';
import { filterFor, groupIds, HIDDEN_SECTION_ID, matchesFilter, overspentCount, planRows, type PlanCategoryRow, type PlanGroupRow } from './planRows.ts';

let n = 0;
const ctx: CommandContext = { now: '2026-10-14T15:00:00.000Z', today: SAMPLE_TODAY, newId: () => `test-${String((n += 1))}` };
const sample = buildSamplePlan();
const month = '2026-10';

function apply(plan: PlanData, build: (p: PlanData) => { changes: Parameters<typeof applyChanges>[1] }): PlanData {
  return applyChanges(plan, build(plan).changes).plan;
}

const categoryRows = (rows: ReturnType<typeof planRows>): PlanCategoryRow[] => rows.flatMap((r) => (r.data.kind === 'category' ? [r.data] : []));

describe('planRows', () => {
  it('lists every live category once, under its group, in display order', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    const rows = planRows(model, 'all');
    const cats = categoryRows(rows);
    expect(cats.map((c) => c.id).sort()).toEqual([...model.views.keys()].sort());
    // Every category row follows its own group row.
    let group: string | null = null;
    for (const r of rows) {
      if (r.kind === 'group') group = r.id;
      else expect(r.groupId).toBe(group);
    }
    expect(rows[0]?.data.kind === 'group' && rows[0].data.system).toBe('creditCardPayments');
  });

  it('carries the engine numbers through unchanged, and group totals are their sums', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    const rows = planRows(model, 'all');
    for (const c of categoryRows(rows)) {
      const cm = model.ms.categories[c.id];
      expect([c.assigned, c.activity, c.available]).toEqual([cm?.assigned, cm?.activity, cm?.available]);
    }
    for (const r of rows) {
      if (r.data.kind !== 'group') continue;
      const kids = categoryRows(rows).filter((c) => c.groupId === r.id);
      expect(r.data.available).toBe(kids.reduce((s, c) => s + c.available, 0));
    }
  });

  it('filters to a focused view and drops groups left empty', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    const rows = planRows(model, 'overspent');
    const cats = categoryRows(rows);
    expect(cats.length).toBe(overspentCount(model));
    expect(cats.every((c) => c.available < 0)).toBe(true);
    for (const r of rows) if (r.kind === 'group') expect(rows.some((x) => x.groupId === r.id)).toBe(true);
    for (const id of model.views.keys()) expect(matchesFilter('all', model, id)).toBe(true);
  });

  it('the built-in views Underfunded, Overfunded and Snoozed pick exactly their categories (P-22)', () => {
    const model = planModel(sample.plan, month, SAMPLE_TODAY);
    const ids = (filter: 'underfunded' | 'overfunded' | 'snoozed') => categoryRows(planRows(model, filter)).map((c) => c.id).sort();
    const where = (test: (id: string) => boolean) => [...model.views.keys()].filter(test).sort();
    expect(ids('underfunded')).toEqual(where((id) => model.views.get(id)?.state === 'underfunded'));
    expect(ids('underfunded').length).toBeGreaterThan(0);
    expect(ids('overfunded')).toEqual(where((id) => (model.evaluated[id]?.overfunded ?? 0) > 0));
    expect(ids('overfunded').length).toBeGreaterThan(0);
    expect(ids('snoozed')).toEqual(where((id) => model.views.get(id)?.state === 'snoozed'));
  });

  it('unhiding brings a category back to its own group (P-06)', () => {
    const groceries = sample.ids.categories.Groceries;
    if (groceries === undefined) throw new Error('sample has Groceries');
    const hidden = apply(sample.plan, (p) => setCategoryHidden(p, ctx, { categoryId: groceries, hidden: true }));
    const back = apply(hidden, (p) => setCategoryHidden(p, ctx, { categoryId: groceries, hidden: false }));
    const row = (plan: PlanData) => planRows(planModel(plan, month, SAMPLE_TODAY), 'all').find((r) => r.id === groceries);
    expect(row(hidden)?.groupId).toBe(HIDDEN_SECTION_ID);
    expect(row(back)?.groupId).toBe(sample.plan.categories.find((c) => c.id === groceries)?.groupId);
  });

  it('collects hidden categories and hidden groups into a Hidden Categories section, last', () => {
    const groceries = sample.ids.categories.Groceries;
    if (groceries === undefined) throw new Error('sample has Groceries');
    let plan = apply(sample.plan, (p) => setCategoryHidden(p, ctx, { categoryId: groceries, hidden: true }));
    const add = createGroup(plan, ctx, { name: 'Old stuff' });
    plan = applyChanges(plan, add.changes).plan;
    plan = apply(plan, (p) => setGroupHidden(p, ctx, { groupId: add.groupId, hidden: true }));
    const created = { id: add.groupId };
    const rows = planRows(planModel(plan, month, SAMPLE_TODAY), 'all');
    const sections = rows.filter((r) => r.kind === 'group');
    const last = sections.at(-1);
    expect(last?.id).toBe(HIDDEN_SECTION_ID);
    const hiddenCats = categoryRows(rows).filter((c) => c.groupId === HIDDEN_SECTION_ID);
    expect(hiddenCats.map((c) => c.id)).toContain(groceries);
    expect(sections.some((g) => g.id === created.id)).toBe(false);
    expect((last?.data as PlanGroupRow).system).toBe('hidden');
    // A focused view leaves the hidden section out.
    expect(planRows(planModel(plan, month, SAMPLE_TODAY), 'available').some((r) => r.id === HIDDEN_SECTION_ID)).toBe(false);
  });

  it('lists group ids for collapse all', () => {
    const rows = planRows(planModel(sample.plan, month, SAMPLE_TODAY), 'all');
    expect(groupIds(rows).length).toBe(rows.filter((r) => r.kind === 'group').length);
  });
});

describe('plan months', () => {
  it('clamps deep-linked months to the plan', async () => {
    const { shownMonth, planBounds } = await import('./planMonths.ts');
    expect(planBounds(sample.plan, SAMPLE_TODAY)).toEqual({ min: '2026-08', max: '2027-10' });
    expect(shownMonth(sample.plan, SAMPLE_TODAY, '2021-10')).toBe('2026-08');
    expect(shownMonth(sample.plan, SAMPLE_TODAY, '2030-01')).toBe('2027-10');
    expect(shownMonth(sample.plan, SAMPLE_TODAY, '2026-09')).toBe('2026-09');
  });

  it('a custom focused view shows just its categories and their groups', () => {
    const groceries = sample.plan.categories.find((c) => c.name === 'Groceries')?.id ?? '';
    const pets = sample.plan.categories.find((c) => c.name === 'Pets')?.id ?? '';
    const withView = applyChanges(sample.plan, createFocusedView(sample.plan, { now: '2026-10-14T00:00:00.000Z', today: SAMPLE_TODAY, newId: () => 'v1' }, { name: 'Food & pets', categoryIds: [groceries, pets] }).changes).plan;
    const rows = planRows(planModel(withView, '2026-10', SAMPLE_TODAY), 'view:v1');
    expect(rows.filter((r) => r.data.kind === 'category').map((r) => r.id)).toEqual([groceries, pets]);
    expect(filterFor({ id: 'v1' })).toBe('view:v1');
    expect(filterFor({ id: 'x', builtin: 'moneyAvailable' })).toBe('available');
  });
});
