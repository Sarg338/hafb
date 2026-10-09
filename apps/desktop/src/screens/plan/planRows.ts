// The Plan grid's rows (S4.1): groups and categories in YNAB's order, the focused-view filter, and
// the Hidden Categories section. Pure: a PlanModel in, GridRows out. Group totals are sums of the
// engine's per-category numbers (presentation, not budget math).
import type { Id } from '@hafb/engine';
import { minor, type Minor } from '@hafb/shared';
import type { CategoryRecord } from '@hafb/store';
import type { GridRow } from '../../ui/grid/types.ts';
import type { PlanModel } from './planModel.ts';
import type { CategoryView } from './planView.ts';

/** A built-in focused view, or a custom one (`view:<id>`; YNAB allows 12). */
export type ViewFilter = 'all' | 'underfunded' | 'overfunded' | 'available' | 'snoozed' | 'overspent' | `view:${string}`;

/** The filter a stored view stands for. */
export function filterFor(view: { id: Id; builtin?: string }): ViewFilter {
  switch (view.builtin) {
    case 'underfunded':
    case 'overfunded':
    case 'snoozed':
    case 'overspent':
      return view.builtin;
    case 'moneyAvailable':
      return 'available';
    default:
      return `view:${view.id}`;
  }
}

/** The synthetic group that collects hidden categories and hidden groups, always last. */
export const HIDDEN_SECTION_ID = '__hidden__';

export interface PlanGroupRow {
  kind: 'group';
  name: string;
  assigned: Minor;
  activity: Minor;
  available: Minor;
  /** The Credit Card Payments group, the Hidden Categories section, or a user group. */
  system: 'creditCardPayments' | 'hidden' | null;
}

export interface PlanCategoryRow {
  kind: 'category';
  id: Id;
  groupId: Id;
  name: string;
  assigned: Minor;
  activity: Minor;
  available: Minor;
  view: CategoryView;
  /** A credit card payment category (it follows its account; no target rules of its own). */
  payment: boolean;
  hidden: boolean;
  hasNote: boolean;
}

export type PlanRow = PlanGroupRow | PlanCategoryRow;

export function matchesFilter(filter: ViewFilter, model: PlanModel, id: Id): boolean {
  const view = model.views.get(id);
  const cm = model.ms.categories[id];
  if (!view || !cm) return false;
  switch (filter) {
    case 'all':
      return true;
    case 'underfunded':
      return view.state === 'underfunded';
    case 'overfunded':
      return (model.evaluated[id]?.overfunded ?? 0) > 0;
    case 'available':
      return cm.available > 0;
    case 'snoozed':
      return view.state === 'snoozed';
    case 'overspent':
      return cm.available < 0;
    default: {
      const viewId = filter.slice('view:'.length);
      return model.plan.focusedViews.find((v) => v.id === viewId)?.categoryIds.includes(id) === true;
    }
  }
}

/** Categories overspent this month (the conditional Overspent view chip). */
export function overspentCount(model: PlanModel): number {
  let n = 0;
  for (const id of model.views.keys()) if ((model.ms.categories[id]?.available ?? 0) < 0) n += 1;
  return n;
}

/** Visible categories of a model, in display order, with hidden ones separated out. */
export function arrangeGroups(model: PlanModel): { visible: { group: PlanModel['groups'][number]['group']; categories: CategoryRecord[] }[]; hidden: CategoryRecord[] } {
  const visible: { group: PlanModel['groups'][number]['group']; categories: CategoryRecord[] }[] = [];
  const hidden: CategoryRecord[] = [];
  for (const { group, categories } of model.groups) {
    if (group.systemKind === 'hidden' || (group.hidden === true && group.systemKind === undefined)) {
      hidden.push(...categories);
      continue;
    }
    const shown: CategoryRecord[] = [];
    for (const c of categories) {
      if (c.hidden === true && c.creditCardAccountId === undefined) hidden.push(c);
      else shown.push(c);
    }
    visible.push({ group, categories: shown });
  }
  return { visible, hidden };
}

export function planRows(model: PlanModel, filter: ViewFilter): GridRow<PlanRow>[] {
  const out: GridRow<PlanRow>[] = [];
  const category = (c: CategoryRecord, groupId: Id): GridRow<PlanRow> | null => {
    const cm = model.ms.categories[c.id];
    const view = model.views.get(c.id);
    if (!cm || !view) return null;
    return {
      kind: 'item',
      id: c.id,
      groupId,
      data: {
        kind: 'category',
        id: c.id,
        groupId,
        name: c.name,
        assigned: cm.assigned,
        activity: cm.activity,
        available: cm.available,
        view,
        payment: c.creditCardAccountId !== undefined,
        hidden: c.hidden === true,
        hasNote: (c.note ?? '') !== '',
      },
    };
  };
  const push = (groupId: Id, name: string, system: PlanGroupRow['system'], categories: readonly CategoryRecord[]): void => {
    const shown = categories.filter((c) => matchesFilter(filter, model, c.id));
    if (filter !== 'all' && shown.length === 0) return;
    const sum = (pick: (id: Id) => number): Minor => minor(categories.reduce((s, c) => s + pick(c.id), 0));
    out.push({
      kind: 'group',
      id: groupId,
      data: {
        kind: 'group',
        name,
        system,
        assigned: sum((id) => model.ms.categories[id]?.assigned ?? 0),
        activity: sum((id) => model.ms.categories[id]?.activity ?? 0),
        available: sum((id) => model.ms.categories[id]?.available ?? 0),
      },
    });
    for (const c of shown) {
      const row = category(c, groupId);
      if (row) out.push(row);
    }
  };
  const { visible, hidden } = arrangeGroups(model);
  for (const { group, categories } of visible) push(group.id, group.name, group.systemKind === 'creditCardPayments' ? 'creditCardPayments' : null, categories);
  // Hidden categories are a section of their own; a filtered view leaves them out (YNAB).
  if (hidden.length > 0 && filter === 'all') push(HIDDEN_SECTION_ID, 'Hidden Categories', 'hidden', hidden);
  return out;
}

/** Ids of every group row (collapse all / expand all). */
export function groupIds(rows: readonly GridRow<PlanRow>[]): string[] {
  return rows.filter((r) => r.kind === 'group').map((r) => r.id);
}
