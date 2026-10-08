// Plan editing (S4.2): where a moved category or group lands. Pure: the plan in, the arguments for
// the store's arrangeCategories / reorderGroups out (or null when the move isn't allowed). Rules:
// - The Credit Card Payments group stays first; its categories follow their cards and never move
//   to another group, and no other category moves into it.
// - Hidden categories and hidden groups live in the Hidden Categories section and aren't dragged.
import type { Id } from '@hafb/engine';
import type { CategoryGroupRecord, CategoryRecord, PlanData } from '@hafb/store';

const live = <T extends { deletedAt?: string }>(xs: readonly T[]): T[] => xs.filter((x) => x.deletedAt === undefined);

/** Groups in display order (the hidden system group excluded). */
export function orderedGroups(plan: PlanData): CategoryGroupRecord[] {
  return live(plan.categoryGroups)
    .filter((g) => g.systemKind !== 'hidden')
    .toSorted((a, b) => Number(b.systemKind === 'creditCardPayments') - Number(a.systemKind === 'creditCardPayments') || a.sortOrder - b.sortOrder);
}

/** A group's visible (not hidden) categories in order. */
export function groupCategories(plan: PlanData, groupId: Id): CategoryRecord[] {
  return live(plan.categories)
    .filter((c) => c.groupId === groupId && c.hidden !== true)
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
}

const movableGroup = (g: CategoryGroupRecord | undefined): g is CategoryGroupRecord => g !== undefined && g.systemKind === undefined && g.hidden !== true;

export interface ArrangeArgs {
  groupId: Id;
  categoryIds: Id[];
}

/** Where a dragged category lands, relative to a row: before/after a category, or into a group (first). */
export type CategoryDrop = { kind: 'category'; id: Id; position: 'before' | 'after' } | { kind: 'group'; id: Id };

export function dropCategory(plan: PlanData, categoryId: Id, drop: CategoryDrop): ArrangeArgs | null {
  const moving = live(plan.categories).find((c) => c.id === categoryId);
  if (!moving || moving.hidden === true) return null;
  const groups = new Map(live(plan.categoryGroups).map((g) => [g.id, g]));
  const payment = moving.creditCardAccountId !== undefined;
  let groupId: Id;
  let index: number;
  if (drop.kind === 'group') {
    groupId = drop.id;
    index = 0;
  } else {
    const target = live(plan.categories).find((c) => c.id === drop.id);
    if (!target || target.hidden === true) return null;
    groupId = target.groupId;
    const order = groupCategories(plan, groupId).filter((c) => c.id !== categoryId);
    const at = order.findIndex((c) => c.id === target.id);
    if (at < 0) return null;
    index = drop.position === 'before' ? at : at + 1;
  }
  const group = groups.get(groupId);
  if (!group || group.hidden === true || group.systemKind === 'hidden') return null;
  if (payment !== (group.systemKind === 'creditCardPayments')) return null;
  const order = groupCategories(plan, groupId).filter((c) => c.id !== categoryId);
  order.splice(index, 0, moving);
  const ids = order.map((c) => c.id);
  const before = groupCategories(plan, groupId).map((c) => c.id);
  if (moving.groupId === groupId && ids.join() === before.join()) return null;
  return { groupId, categoryIds: ids };
}

/** Keyboard "Move up/down": one place within the group, or to the next group's end/start at the edges. */
export function stepCategory(plan: PlanData, categoryId: Id, dir: -1 | 1): ArrangeArgs | null {
  const moving = live(plan.categories).find((c) => c.id === categoryId);
  if (!moving || moving.hidden === true) return null;
  const siblings = groupCategories(plan, moving.groupId);
  const at = siblings.findIndex((c) => c.id === categoryId);
  const neighbour = siblings[at + dir];
  if (neighbour) return dropCategory(plan, categoryId, { kind: 'category', id: neighbour.id, position: dir < 0 ? 'before' : 'after' });
  if (moving.creditCardAccountId !== undefined) return null;
  // Off the edge: into the adjacent movable group (end when moving up, start when moving down).
  const groups = orderedGroups(plan);
  const gi = groups.findIndex((g) => g.id === moving.groupId);
  for (let i = gi + dir; i >= 0 && i < groups.length; i += dir) {
    const g = groups[i];
    if (!movableGroup(g)) continue;
    const cats = groupCategories(plan, g.id);
    const last = cats.at(-1);
    if (dir < 0 && last) return dropCategory(plan, categoryId, { kind: 'category', id: last.id, position: 'after' });
    return dropCategory(plan, categoryId, { kind: 'group', id: g.id });
  }
  return null;
}

/** A group's new place among the movable groups; the full order for reorderGroups (system groups first). */
export function dropGroup(plan: PlanData, groupId: Id, targetGroupId: Id, position: 'before' | 'after'): Id[] | null {
  const groups = orderedGroups(plan);
  const moving = groups.find((g) => g.id === groupId);
  const target = groups.find((g) => g.id === targetGroupId);
  if (!movableGroup(moving) || !movableGroup(target) || moving.id === target.id) return null;
  const fixed = groups.filter((g) => g.systemKind !== undefined);
  const movable = groups.filter((g) => movableGroup(g) && g.id !== groupId);
  const at = movable.findIndex((g) => g.id === targetGroupId);
  movable.splice(position === 'before' ? at : at + 1, 0, moving);
  const next = [...fixed, ...movable].map((g) => g.id);
  const hidden = groups.filter((g) => g.hidden === true && g.systemKind === undefined).map((g) => g.id);
  const before = groups.map((g) => g.id);
  const result = [...next, ...hidden];
  return result.join() === before.join() ? null : result;
}

export function stepGroup(plan: PlanData, groupId: Id, dir: -1 | 1): Id[] | null {
  const movable = orderedGroups(plan).filter(movableGroup);
  const at = movable.findIndex((g) => g.id === groupId);
  const neighbour = movable[at + dir];
  if (at < 0 || !neighbour) return null;
  return dropGroup(plan, groupId, neighbour.id, dir < 0 ? 'before' : 'after');
}
