// Category groups, categories, category notes and targets (CLAUDE.md §4, §5.4, §6.1, §6.7).
import { READY_TO_ASSIGN, validateTarget, ValidationError, type Id, type Target } from '@hafb/engine';
import { monthOf, type Month } from '@hafb/shared';
import type { CategoryGroupRecord, CategoryRecord, PlanData, TargetRecord } from '../records.ts';
import { Draft, liveCategory, nextSortOrder, requireName, type Command, type CommandContext, omit } from './context.ts';
import { addAssigned, recordMove } from './plan.ts';

function liveGroup(d: Draft, id: Id): CategoryGroupRecord {
  const g = d.get('categoryGroups', id);
  if (!g || g.deletedAt !== undefined) throw new ValidationError(`Unknown category group ${id}`);
  return g;
}

function userGroup(d: Draft, id: Id): CategoryGroupRecord {
  const g = liveGroup(d, id);
  if (g.systemKind !== undefined) throw new ValidationError(`${g.name} is a system group`);
  return g;
}

function userCategory(d: Draft, id: Id): CategoryRecord {
  const c = liveCategory(d, id);
  if (c.creditCardAccountId !== undefined) throw new ValidationError(`${c.name} is a credit card payment category; it follows its account`);
  return c;
}

// ---- groups ------------------------------------------------------------------------------------

export function createGroup(plan: PlanData, ctx: CommandContext, args: { name: string }): Command & { groupId: Id } {
  const d = new Draft(plan);
  const id = ctx.newId();
  d.put('categoryGroups', { id, name: requireName(args.name, 'Group'), sortOrder: nextSortOrder(d.all('categoryGroups')) });
  return { label: `Add group: ${args.name.trim()}`, changes: d.build(), groupId: id };
}

export function renameGroup(plan: PlanData, _ctx: CommandContext, args: { groupId: Id; name: string }): Command {
  const d = new Draft(plan);
  const g = userGroup(d, args.groupId);
  d.put('categoryGroups', { ...g, name: requireName(args.name, 'Group') });
  return { label: `Rename group: ${g.name}`, changes: d.build() };
}

export function setGroupHidden(plan: PlanData, _ctx: CommandContext, args: { groupId: Id; hidden: boolean }): Command {
  const d = new Draft(plan);
  const g = userGroup(d, args.groupId);
  const rest = omit(g, 'hidden');
  d.put('categoryGroups', args.hidden ? { ...rest, hidden: true } : rest);
  return { label: `${args.hidden ? 'Hide' : 'Show'} group: ${g.name}`, changes: d.build() };
}

/** `groupIds` in their new order. */
export function reorderGroups(plan: PlanData, _ctx: CommandContext, args: { groupIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  args.groupIds.forEach((id, i) => {
    const g = liveGroup(d, id);
    if (g.sortOrder !== i) d.put('categoryGroups', { ...g, sortOrder: i });
  });
  return { label: 'Reorder groups', changes: d.build() };
}

// ---- categories --------------------------------------------------------------------------------

export function createCategory(plan: PlanData, ctx: CommandContext, args: { groupId: Id; name: string }): Command & { categoryId: Id } {
  const d = new Draft(plan);
  const g = userGroup(d, args.groupId);
  const id = ctx.newId();
  d.put('categories', {
    id,
    groupId: g.id,
    name: requireName(args.name, 'Category'),
    sortOrder: nextSortOrder(d.all('categories').filter((c) => c.groupId === g.id)),
  });
  return { label: `Add category: ${args.name.trim()}`, changes: d.build(), categoryId: id };
}

export function renameCategory(plan: PlanData, _ctx: CommandContext, args: { categoryId: Id; name: string }): Command {
  const d = new Draft(plan);
  const c = userCategory(d, args.categoryId);
  d.put('categories', { ...c, name: requireName(args.name, 'Category') });
  return { label: `Rename category: ${c.name}`, changes: d.build() };
}

export function setCategoryHidden(plan: PlanData, _ctx: CommandContext, args: { categoryId: Id; hidden: boolean }): Command {
  const d = new Draft(plan);
  const c = liveCategory(d, args.categoryId);
  const rest = omit(c, 'hidden');
  d.put('categories', args.hidden ? { ...rest, hidden: true } : rest);
  return { label: `${args.hidden ? 'Hide' : 'Show'} category: ${c.name}`, changes: d.build() };
}

export function setCategoryNote(plan: PlanData, _ctx: CommandContext, args: { categoryId: Id; note: string }): Command {
  const d = new Draft(plan);
  const c = liveCategory(d, args.categoryId);
  const rest = omit(c, 'note');
  d.put('categories', args.note.trim() === '' ? rest : { ...rest, note: args.note });
  return { label: `Edit note: ${c.name}`, changes: d.build() };
}

/** Put `categoryIds` into `groupId` in this order (drag and drop within or across groups). */
export function arrangeCategories(plan: PlanData, _ctx: CommandContext, args: { groupId: Id; categoryIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  const g = liveGroup(d, args.groupId);
  args.categoryIds.forEach((id, i) => {
    const c = liveCategory(d, id);
    if (c.creditCardAccountId !== undefined && g.systemKind !== 'creditCardPayments') {
      throw new ValidationError('Credit card payment categories stay in the Credit Card Payments group');
    }
    if (c.creditCardAccountId === undefined && g.systemKind === 'creditCardPayments') {
      throw new ValidationError('Only credit card payment categories belong in the Credit Card Payments group');
    }
    if (c.groupId !== g.id || c.sortOrder !== i) d.put('categories', { ...c, groupId: g.id, sortOrder: i });
  });
  return { label: 'Move categories', changes: d.build() };
}

export interface CategoryUse {
  /** Live transactions (or split lines) categorized to it. */
  transactions: number;
  /** Live scheduled transactions (or their split lines) that use it. */
  scheduled: number;
  /** Months with a non-zero assigned amount. */
  months: number;
}

/** What a category is used by: YNAB asks where to reassign only when there is something to move. */
export function categoryInUse(plan: PlanData, categoryId: Id): CategoryUse {
  const uses = (x: { categoryId: Id | null; subtransactions?: readonly { categoryId: Id | null }[] }): boolean =>
    x.categoryId === categoryId || (x.subtransactions?.some((s) => s.categoryId === categoryId) ?? false);
  return {
    transactions: plan.transactions.filter((t) => t.deletedAt === undefined && uses(t)).length,
    scheduled: plan.scheduled.filter((s) => s.deletedAt === undefined && uses(s)).length,
    months: plan.assignments.filter((a) => a.categoryId === categoryId && a.assigned !== 0).length,
  };
}

const unused = (u: CategoryUse): boolean => u.transactions === 0 && u.scheduled === 0 && u.months === 0;

/**
 * Delete a category (YNAB: "reassign its transactions and money"). Every transaction, split line,
 * scheduled transaction and payee default that used it moves to `reassignTo`, and so does every
 * month's assigned amount, so the replacement's available balance is exactly the sum of both and
 * Ready to Assign does not change. The money moves are logged as `categoryDeleted`. A category with
 * no history (categoryInUse) needs no `reassignTo`.
 */
export function deleteCategory(plan: PlanData, ctx: CommandContext, args: { categoryId: Id; reassignTo?: Id }): Command {
  const d = new Draft(plan);
  const c = userCategory(d, args.categoryId);
  const to = reassignTarget(plan, d, c, args.reassignTo);
  removeCategory(d, ctx, c, to, ctx.newId());
  return { label: `Delete category: ${c.name}`, changes: d.build() };
}

/** The reassignment target, or null when the category has nothing to move. */
function reassignTarget(plan: PlanData, d: Draft, c: CategoryRecord, to: Id | undefined): Id | null {
  if (to === undefined) {
    if (!unused(categoryInUse(plan, c.id))) throw new ValidationError(`${c.name} has transactions or money: pick a category to reassign them to`);
    return null;
  }
  checkReassignTarget(d, c, to);
  return to;
}

function checkReassignTarget(d: Draft, c: CategoryRecord, to: Id): void {
  if (to === c.id) throw new ValidationError('Pick a different category to receive the money');
  if (to === READY_TO_ASSIGN) throw new ValidationError('Reassign to a category; its money returns to Ready to Assign from there');
  liveCategory(d, to);
}

function removeCategory(d: Draft, ctx: CommandContext, c: CategoryRecord, to: Id | null, groupId: Id): void {
  if (to === null) {
    // Nothing references it but defaults, views and pairings: clear those and delete.
    for (const p of d.all('payees')) {
      if (p.defaultCategoryId === c.id) d.put('payees', omit(p, 'defaultCategoryId'));
    }
    detach(d, c);
    d.put('categories', { ...c, deletedAt: ctx.now });
    return;
  }
  const swap = <T extends { categoryId: Id | null }>(x: T): T => (x.categoryId === c.id ? { ...x, categoryId: to } : x);
  for (const t of d.all('transactions')) {
    const hit = t.categoryId === c.id || (t.subtransactions?.some((s) => s.categoryId === c.id) ?? false);
    if (hit) d.put('transactions', { ...swap(t), ...(t.subtransactions ? { subtransactions: t.subtransactions.map(swap) } : {}) });
  }
  for (const s of d.all('scheduled')) {
    const hit = s.categoryId === c.id || (s.subtransactions?.some((x) => x.categoryId === c.id) ?? false);
    if (hit) d.put('scheduled', { ...swap(s), ...(s.subtransactions ? { subtransactions: s.subtransactions.map(swap) } : {}) });
  }
  for (const p of d.all('payees')) {
    if (p.defaultCategoryId === c.id) d.put('payees', { ...p, defaultCategoryId: to });
  }
  for (const a of d.all('assignments')) {
    if (a.categoryId !== c.id) continue;
    d.remove('assignments', `${a.month}|${c.id}`);
    addAssigned(d, a.month, to, a.assigned);
    const outflow = a.assigned > 0;
    recordMove(d, ctx, groupId, { month: a.month, from: outflow ? c.id : to, to: outflow ? to : c.id, amount: Math.abs(a.assigned), kind: 'categoryDeleted' });
  }
  detach(d, c);
  d.put('categories', { ...c, deletedAt: ctx.now });
}

/** Remove the category's target, its place in custom views, and a loan's pairing with it. */
function detach(d: Draft, c: CategoryRecord): void {
  if (d.get('targets', c.id)) d.remove('targets', c.id);
  for (const v of d.all('focusedViews')) {
    if (v.categoryIds.includes(c.id)) d.put('focusedViews', { ...v, categoryIds: v.categoryIds.filter((x) => x !== c.id) });
  }
  for (const a of d.all('accounts')) {
    if (a.loan?.pairedCategoryId === c.id) {
      const loan = omit(a.loan, 'pairedCategoryId');
      const rest = omit(a, 'loan');
      d.put('accounts', Object.keys(loan).length === 0 ? rest : { ...rest, loan });
    }
  }
}

/**
 * Delete a group and its categories, reassigning everything to `reassignTo` (outside the group).
 * When none of its categories has history, no `reassignTo` is needed.
 */
export function deleteGroup(plan: PlanData, ctx: CommandContext, args: { groupId: Id; reassignTo?: Id }): Command {
  const d = new Draft(plan);
  const g = userGroup(d, args.groupId);
  if (args.reassignTo !== undefined) {
    const target = liveCategory(d, args.reassignTo);
    if (target.groupId === g.id) throw new ValidationError('Reassign to a category outside the group being deleted');
  }
  const groupId = ctx.newId();
  for (const c of d.all('categories')) {
    if (c.groupId !== g.id || c.deletedAt !== undefined) continue;
    if (args.reassignTo === undefined && !unused(categoryInUse(plan, c.id))) {
      throw new ValidationError(`${g.name} has categories with transactions or money: pick a category to reassign them to`);
    }
    removeCategory(d, ctx, c, args.reassignTo === undefined ? null : reassignTarget(plan, d, c, args.reassignTo), groupId);
  }
  d.put('categoryGroups', { ...g, deletedAt: ctx.now });
  return { label: `Delete group: ${g.name}`, changes: d.build() };
}

// ---- targets -----------------------------------------------------------------------------------

/** Create or replace a category's target. Edits apply to every month (targets aren't versioned). */
export function setTarget(
  plan: PlanData,
  ctx: CommandContext,
  args: { categoryId: Id; amount: Target['amount']; cadence: Target['cadence']; behavior: Target['behavior'] },
): Command {
  const d = new Draft(plan);
  const c = liveCategory(d, args.categoryId);
  const prior = d.get('targets', c.id);
  const target: TargetRecord = {
    categoryId: c.id,
    amount: args.amount,
    cadence: args.cadence,
    behavior: args.behavior,
    startMonth: prior?.startMonth ?? monthOf(ctx.today),
    createdOn: prior?.createdOn ?? ctx.today,
    ...(prior?.snoozedMonths === undefined || prior.snoozedMonths.length === 0 ? {} : { snoozedMonths: prior.snoozedMonths }),
    updatedAt: ctx.now,
  };
  validateTarget(target);
  d.put('targets', target);
  return { label: `${prior ? 'Edit' : 'Create'} target: ${c.name}`, changes: d.build() };
}

export function clearTarget(plan: PlanData, _ctx: CommandContext, args: { categoryId: Id }): Command {
  const d = new Draft(plan);
  const c = liveCategory(d, args.categoryId);
  if (!d.get('targets', c.id)) throw new ValidationError(`${c.name} has no target`);
  d.remove('targets', c.id);
  return { label: `Delete target: ${c.name}`, changes: d.build() };
}

/** Snooze (or un-snooze) a target for one month (§5.4). */
export function snoozeTarget(plan: PlanData, ctx: CommandContext, args: { categoryId: Id; month: Month; snoozed: boolean }): Command {
  const d = new Draft(plan);
  const c = liveCategory(d, args.categoryId);
  const t = d.get('targets', c.id);
  if (!t) throw new ValidationError(`${c.name} has no target`);
  const months = new Set(t.snoozedMonths ?? []);
  if (args.snoozed) months.add(args.month);
  else months.delete(args.month);
  const rest = omit(t, 'snoozedMonths');
  const sorted = [...months].sort();
  d.put('targets', { ...rest, ...(sorted.length === 0 ? {} : { snoozedMonths: sorted }), updatedAt: ctx.now });
  return { label: `${args.snoozed ? 'Snooze' : 'Unsnooze'} target: ${c.name}`, changes: d.build() };
}
