import { describe, expect, it } from 'vitest';
import { createCategory, createFocusedView, createGroup, deleteCategory, deleteFocusedView, editFocusedView, focusedViews, MAX_CUSTOM_VIEWS, reorderFocusedViews } from '../src/commands/index.ts';
import { Bench, blankPlan, makeCtx } from './helpers/harness.ts';

describe('Focused Views (YNAB: built-ins plus up to 12 custom)', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const g = b.run(createGroup(b.plan, ctx, { name: 'Bills' })).groupId;
    const rent = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Rent' })).categoryId;
    const power = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Power' })).categoryId;
    return { ctx, b, rent, power };
  };

  it('a new plan lists the built-in views in YNAB’s order', () => {
    const { b } = setup();
    expect(focusedViews(b.plan).map((v) => v.name)).toEqual(['Underfunded', 'Overfunded', 'Money Available', 'Snoozed', 'Overspent']);
    expect(focusedViews({ ...b.plan, focusedViews: [] }).map((v) => v.builtin)).toEqual(['underfunded', 'overfunded', 'moneyAvailable', 'snoozed', 'overspent']);
  });

  it('create, rename, change categories, reorder, delete; built-ins only reorder', () => {
    const { ctx, b, rent, power } = setup();
    const { viewId } = b.run(createFocusedView(b.plan, ctx, { name: ' Bills ', categoryIds: [rent, rent] }));
    expect(focusedViews(b.plan).at(-1)).toMatchObject({ id: viewId, name: 'Bills', categoryIds: [rent] });
    b.run(editFocusedView(b.plan, ctx, { viewId, name: 'Monthly bills', categoryIds: [rent, power] }));
    expect(focusedViews(b.plan).find((v) => v.id === viewId)).toMatchObject({ name: 'Monthly bills', categoryIds: [rent, power] });
    const ids = focusedViews(b.plan).map((v) => v.id);
    b.run(reorderFocusedViews(b.plan, ctx, { order: [viewId, ...ids.filter((id) => id !== viewId)] }));
    expect(focusedViews(b.plan)[0]?.id).toBe(viewId);
    const builtin = focusedViews(b.plan).find((v) => v.builtin === 'snoozed')?.id ?? '';
    expect(() => deleteFocusedView(b.plan, ctx, { viewId: builtin })).toThrow(/built-in/);
    expect(() => createFocusedView(b.plan, ctx, { name: '  ', categoryIds: [] })).toThrow();
    // Deleting a category takes it out of views.
    b.run(deleteCategory(b.plan, ctx, { categoryId: power }));
    expect(focusedViews(b.plan).find((v) => v.id === viewId)?.categoryIds).toEqual([rent]);
    b.run(deleteFocusedView(b.plan, ctx, { viewId }));
    expect(focusedViews(b.plan).some((v) => v.id === viewId)).toBe(false);
  });

  it(`stops at ${String(MAX_CUSTOM_VIEWS)} custom views`, () => {
    const { ctx, b } = setup();
    for (let i = 0; i < MAX_CUSTOM_VIEWS; i++) b.run(createFocusedView(b.plan, ctx, { name: `View ${String(i)}`, categoryIds: [] }));
    expect(() => createFocusedView(b.plan, ctx, { name: 'One more', categoryIds: [] })).toThrow(/up to 12/);
  });
});
