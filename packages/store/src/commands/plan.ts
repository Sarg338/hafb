// Plan-level commands: a new plan, assigning, moving money, auto-assign / Plan Reset, month notes.
// Every assignment change also writes MoneyMove rows (CLAUDE.md §4, §5.6) in the same change set.
import { coverOverspending as engineCover, moveMoney as engineMove, READY_TO_ASSIGN, ValidationError, type AssignmentDelta, type CoverSource, type Id, type PlanChange } from '@hafb/engine';
import { compareMonths, minor, type Minor, type Month } from '@hafb/shared';
import { normalizePlan } from '../changes.ts';
import { emptyPlan, type BuiltinFocusedView, type MoneyMoveKind, type PlanData, type PlanSettings } from '../records.ts';
import { planBudget } from '../snapshot.ts';
import { Draft, liveCategory, type Command, type CommandContext } from './context.ts';

export const CREDIT_CARD_PAYMENTS_GROUP_NAME = 'Credit Card Payments';
export const HIDDEN_CATEGORIES_GROUP_NAME = 'Hidden Categories';

const BUILTIN_VIEWS: readonly [BuiltinFocusedView, string][] = [
  ['underfunded', 'Underfunded'],
  ['overfunded', 'Overfunded'],
  ['snoozed', 'Snoozed'],
  ['moneyAvailable', 'Money Available'],
  ['overspent', 'Overspent'],
];

/** A new, empty plan: the two visible system groups and the built-in Focused Views. */
export function newPlan(settings: PlanSettings, ctx: CommandContext): PlanData {
  const base = emptyPlan(settings);
  return normalizePlan({
    ...base,
    categoryGroups: [
      { id: ctx.newId(), name: CREDIT_CARD_PAYMENTS_GROUP_NAME, sortOrder: 0, systemKind: 'creditCardPayments' },
      { id: ctx.newId(), name: HIDDEN_CATEGORIES_GROUP_NAME, hidden: true, sortOrder: 1, systemKind: 'hidden' },
    ],
    focusedViews: BUILTIN_VIEWS.map(([builtin, name], i) => ({ id: ctx.newId(), name, sortOrder: i, builtin, categoryIds: [] })),
  });
}

// ---- assignment helpers ------------------------------------------------------------------------

function assignableCategory(d: Draft, id: Id): void {
  if (id === READY_TO_ASSIGN) throw new ValidationError('Ready to Assign is not a category you assign to');
  liveCategory(d, id);
}

/** Add `delta` to (month, category)'s assigned amount; a zero result removes the row. */
export function addAssigned(d: Draft, month: Month, categoryId: Id, delta: number): void {
  if (delta === 0) return;
  const key = `${month}|${categoryId}`;
  const current = d.get('assignments', key)?.assigned ?? 0;
  const next = current + delta;
  if (next === 0) d.remove('assignments', key);
  else d.put('assignments', { month, categoryId, assigned: minor(next) });
}

export function recordMove(
  d: Draft,
  ctx: CommandContext,
  groupId: Id,
  move: { month: Month; from: Id | null; to: Id | null; amount: number; kind: MoneyMoveKind },
): void {
  if (move.amount <= 0) return;
  d.put('moneyMoves', {
    id: ctx.newId(),
    createdAt: ctx.now,
    month: move.month,
    fromCategoryId: move.from,
    toCategoryId: move.to,
    amount: minor(move.amount),
    kind: move.kind,
    groupId,
  });
}

const endpoint = (id: Id): Id | null => (id === READY_TO_ASSIGN ? null : id);

/** Apply engine deltas; log each as Ready to Assign ↔ category. */
function applyDeltas(d: Draft, ctx: CommandContext, deltas: readonly AssignmentDelta[], kind: MoneyMoveKind): void {
  const groupId = ctx.newId();
  for (const delta of deltas) {
    assignableCategory(d, delta.categoryId);
    addAssigned(d, delta.month, delta.categoryId, delta.delta);
    recordMove(d, ctx, groupId, {
      month: delta.month,
      from: delta.delta > 0 ? null : delta.categoryId,
      to: delta.delta > 0 ? delta.categoryId : null,
      amount: Math.abs(delta.delta),
      kind,
    });
  }
}

// ---- commands ----------------------------------------------------------------------------------

/** Type an amount into a category's Assigned cell. */
export function setAssigned(plan: PlanData, ctx: CommandContext, args: { month: Month; categoryId: Id; amount: Minor }): Command {
  const d = new Draft(plan);
  assignableCategory(d, args.categoryId);
  const current = d.get('assignments', `${args.month}|${args.categoryId}`)?.assigned ?? 0;
  applyDeltas(d, ctx, [{ month: args.month, categoryId: args.categoryId, delta: minor(args.amount - current) }], 'assign');
  return { label: `Assign: ${liveCategory(d, args.categoryId).name}`, changes: d.build() };
}

/** Move money between two categories, or a category and Ready to Assign, within a month. */
export function moveMoney(plan: PlanData, ctx: CommandContext, args: { month: Month; from: Id; to: Id; amount: Minor }): Command {
  const d = new Draft(plan);
  const change = engineMove(args.month, args.from, args.to, args.amount);
  for (const delta of change.deltas) {
    assignableCategory(d, delta.categoryId);
    addAssigned(d, delta.month, delta.categoryId, delta.delta);
  }
  const from = endpoint(args.from);
  const to = endpoint(args.to);
  recordMove(d, ctx, ctx.newId(), { month: args.month, from, to, amount: args.amount, kind: from === null || to === null ? 'assign' : 'move' });
  const name = (id: Id | null): string => (id === null ? 'Ready to Assign' : liveCategory(d, id).name);
  return { label: `Move money: ${name(from)} → ${name(to)}`, changes: d.build() };
}

/** Cover an overspent category from other categories, Ready to Assign, or future months. */
export function coverOverspending(
  plan: PlanData,
  ctx: CommandContext,
  args: { month: Month; categoryId: Id; sources: readonly CoverSource[] },
): Command {
  const d = new Draft(plan);
  let through = args.month;
  for (const s of args.sources) if (s.month !== undefined && compareMonths(s.month, through) > 0) through = s.month;
  const state = planBudget(plan, { today: ctx.today, throughMonth: through });
  const change = engineCover(state, args.month, args.categoryId, args.sources);
  for (const delta of change.deltas) {
    assignableCategory(d, delta.categoryId);
    addAssigned(d, delta.month, delta.categoryId, delta.delta);
  }
  const groupId = ctx.newId();
  for (const s of args.sources) {
    const from = endpoint(s.from);
    recordMove(d, ctx, groupId, { month: s.month ?? args.month, from, to: args.categoryId, amount: s.amount, kind: from === null ? 'assign' : 'move' });
  }
  return { label: `Cover overspending: ${liveCategory(d, args.categoryId).name}`, changes: d.build() };
}

/** Commit an engine PlanChange (auto-assign, Plan Reset) as one undo step. */
export function applyPlanChange(
  plan: PlanData,
  ctx: CommandContext,
  args: { change: PlanChange; kind: 'autoAssign' | 'planReset'; label: string },
): Command {
  const d = new Draft(plan);
  applyDeltas(d, ctx, args.change.deltas, args.kind);
  return { label: args.label, changes: d.build() };
}

export function setMonthNote(plan: PlanData, _ctx: CommandContext, args: { month: Month; note: string }): Command {
  const d = new Draft(plan);
  if (args.note.trim() === '') {
    if (d.get('monthNotes', args.month)) d.remove('monthNotes', args.month);
  } else {
    d.put('monthNotes', { month: args.month, note: args.note });
  }
  return { label: 'Edit month note', changes: d.build() };
}
