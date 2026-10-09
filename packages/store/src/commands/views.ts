// Focused Views (CLAUDE.md §4, §6.1; YNAB, observed 2026-10-08): the built-in chips (Underfunded,
// Overfunded, Money Available, Snoozed, Overspent) store only their order; up to 12 custom views
// hold a name and a set of categories. "Manage Views" reorders them; "New View" creates one.
import { ValidationError, type Id } from '@hafb/engine';
import type { BuiltinFocusedView, FocusedViewRecord, PlanData } from '../records.ts';
import { Draft, liveCategory, requireName, type Command, type CommandContext } from './context.ts';

export const MAX_CUSTOM_VIEWS = 12;

const BUILTIN: readonly [BuiltinFocusedView, string][] = [
  ['underfunded', 'Underfunded'],
  ['overfunded', 'Overfunded'],
  ['moneyAvailable', 'Money Available'],
  ['snoozed', 'Snoozed'],
  ['overspent', 'Overspent'],
];

/** The plan's views in order; plans without built-in rows (older files, imports) get them in YNAB's order. */
export function focusedViews(plan: PlanData): FocusedViewRecord[] {
  const views = [...plan.focusedViews];
  let next = views.reduce((m, v) => Math.max(m, v.sortOrder + 1), 0);
  for (const [builtin, name] of BUILTIN) {
    if (!views.some((v) => v.builtin === builtin)) views.push({ id: `builtin:${builtin}`, name, sortOrder: next++, builtin, categoryIds: [] });
  }
  return views.sort((a, b) => a.sortOrder - b.sortOrder);
}

function liveCategories(d: Draft, ids: readonly Id[]): Id[] {
  const out: Id[] = [];
  for (const id of ids) if (!out.includes(id)) out.push(liveCategory(d, id).id);
  return out;
}

export function createFocusedView(plan: PlanData, ctx: CommandContext, args: { name: string; categoryIds: readonly Id[] }): Command & { viewId: Id } {
  const d = new Draft(plan);
  const custom = d.all('focusedViews').filter((v) => v.builtin === undefined);
  if (custom.length >= MAX_CUSTOM_VIEWS) throw new ValidationError(`You can have up to ${String(MAX_CUSTOM_VIEWS)} custom views`);
  const name = requireName(args.name, 'View');
  const id = ctx.newId();
  const sortOrder = focusedViews(plan).reduce((m, v) => Math.max(m, v.sortOrder + 1), 0);
  d.put('focusedViews', { id, name, sortOrder, categoryIds: liveCategories(d, args.categoryIds) });
  return { label: `New view: ${name}`, changes: d.build(), viewId: id };
}

function customView(d: Draft, viewId: Id): FocusedViewRecord {
  const v = d.get('focusedViews', viewId);
  if (!v) throw new ValidationError(`Unknown view ${viewId}`);
  if (v.builtin !== undefined) throw new ValidationError(`${v.name} is a built-in view; it can only be reordered`);
  return v;
}

export function editFocusedView(plan: PlanData, _ctx: CommandContext, args: { viewId: Id; name?: string; categoryIds?: readonly Id[] }): Command {
  const d = new Draft(plan);
  const v = customView(d, args.viewId);
  const name = args.name === undefined ? v.name : requireName(args.name, 'View');
  d.put('focusedViews', { ...v, name, ...(args.categoryIds === undefined ? {} : { categoryIds: liveCategories(d, args.categoryIds) }) });
  return { label: `Edit view: ${name}`, changes: d.build() };
}

export function deleteFocusedView(plan: PlanData, _ctx: CommandContext, args: { viewId: Id }): Command {
  const d = new Draft(plan);
  const v = customView(d, args.viewId);
  d.remove('focusedViews', v.id);
  return { label: `Delete view: ${v.name}`, changes: d.build() };
}

/** Put the views in this order (Manage Views' drag handles). Built-ins missing from the file are written. */
export function reorderFocusedViews(plan: PlanData, _ctx: CommandContext, args: { order: readonly Id[] }): Command {
  const d = new Draft(plan);
  const all = focusedViews(plan);
  const byId = new Map(all.map((v) => [v.id, v]));
  const ordered = [...args.order.map((id) => byId.get(id)).filter((v) => v !== undefined), ...all.filter((v) => !args.order.includes(v.id))];
  ordered.forEach((v, i) => {
    if (v.sortOrder !== i || d.get('focusedViews', v.id) === undefined) d.put('focusedViews', { ...v, sortOrder: i });
  });
  return { label: 'Reorder views', changes: d.build() };
}
