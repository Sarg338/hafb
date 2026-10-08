// Plan operations: CLAUDE.md §5.5 (auto-assign), §5.6 (move money, cover overspending,
// Plan Reset), §5.14 (Fresh Start). Every operation is pure and returns assignment deltas;
// the caller wraps them in one undoable command. Worked examples: docs/budget-math.md §7.
import { addMonths, compareMonths, divRound, minor, neg, ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import { monthState, type BudgetState, type CategoryMonth } from './budget.ts';
import { ValidationError } from './errors.ts';
import { READY_TO_ASSIGN, type Assignment, type BudgetSnapshot, type Id, type Transaction } from './model.ts';
import type { Target, TargetMonth } from './targets.ts';

export interface AssignmentDelta {
  month: Month;
  categoryId: Id;
  /** Added to `assigned` (negative takes money back to Ready to Assign). */
  delta: Minor;
}

export interface PlanChange {
  deltas: AssignmentDelta[];
  /** Σ deltas: how much Ready to Assign this change consumes (negative = returns money). */
  total: Minor;
}

function change(deltas: AssignmentDelta[]): PlanChange {
  const kept = deltas.filter((d) => d.delta !== 0);
  let total = 0;
  for (const d of kept) total += d.delta;
  return { deltas: kept, total: minor(total) };
}

/** Apply deltas to a snapshot's assignments (merging per month+category). Pure. */
export function applyAssignmentDeltas(snapshot: BudgetSnapshot, deltas: readonly AssignmentDelta[]): BudgetSnapshot {
  const key = (m: Month, c: Id) => `${m}|${c}`;
  const merged = new Map<string, Assignment>();
  for (const a of snapshot.assignments) merged.set(key(a.month, a.categoryId), a);
  for (const d of deltas) {
    const k = key(d.month, d.categoryId);
    const current = merged.get(k)?.assigned ?? 0;
    merged.set(k, { month: d.month, categoryId: d.categoryId, assigned: minor(current + d.delta) });
  }
  return { ...snapshot, assignments: [...merged.values()].filter((a) => a.assigned !== 0) };
}

/** A category id or READY_TO_ASSIGN. */
type Endpoint = Id;

/**
 * Move money between two categories, or between a category and Ready to Assign, within a
 * month. Net zero across categories; moving from/to Ready to Assign assigns/unassigns.
 */
export function moveMoney(month: Month, from: Endpoint, to: Endpoint, amount: Minor): PlanChange {
  if (amount <= 0) throw new ValidationError('Move amount must be positive');
  if (from === to) throw new ValidationError('Cannot move money to the same place');
  const deltas: AssignmentDelta[] = [];
  if (from !== READY_TO_ASSIGN) deltas.push({ month, categoryId: from, delta: neg(amount) });
  if (to !== READY_TO_ASSIGN) deltas.push({ month, categoryId: to, delta: amount });
  return change(deltas);
}

export interface CoverSource {
  /** A category (in `month`, or in a future month that has money assigned) or Ready to Assign. */
  from: Endpoint;
  /** Defaults to the overspent month. A later month draws from money assigned there. */
  month?: Month;
  amount: Minor;
}

/**
 * Cover an overspent category. Sources in the same month are plain moves; a source in a
 * future month gives up that month's assignment (YNAB, Jun 2025: cover from future months).
 */
export function coverOverspending(state: BudgetState, month: Month, categoryId: Id, sources: readonly CoverSource[]): PlanChange {
  const cm = monthState(state, month).categories[categoryId];
  if (!cm) throw new ValidationError(`Unknown category ${categoryId}`);
  if (cm.available >= 0) throw new ValidationError(`${categoryId} is not overspent in ${month}`);
  const deltas: AssignmentDelta[] = [];
  let covered = 0;
  for (const s of sources) {
    if (s.amount <= 0) throw new ValidationError('Cover amounts must be positive');
    const from = s.month ?? month;
    if (compareMonths(from, month) < 0) throw new ValidationError('Cannot cover from a past month');
    if (s.from !== READY_TO_ASSIGN) {
      if (compareMonths(from, month) > 0) {
        const future = monthState(state, from).categories[s.from];
        if (!future || future.assigned < s.amount) {
          throw new ValidationError(`${s.from} has less than ${String(s.amount)} assigned in ${from}`);
        }
      }
      deltas.push({ month: from, categoryId: s.from, delta: neg(s.amount) });
    } else if (compareMonths(from, month) > 0) {
      throw new ValidationError('Ready to Assign is not a future-month source');
    }
    deltas.push({ month, categoryId, delta: s.amount });
    covered += s.amount;
  }
  if (covered > 0 - cm.available) throw new ValidationError('Cover amount exceeds the overspending');
  return change(deltas);
}

export type AutoAssignOption =
  | 'underfunded'
  | 'assignedLastMonth'
  | 'spentLastMonth'
  | 'averageAssigned'
  | 'averageSpent'
  | 'reduceOverfunding'
  | 'resetAvailable'
  | 'resetAssigned';

export interface AutoAssignInput {
  state: BudgetState;
  month: Month;
  /** Selection, else the current Focused View, else all visible categories (caller decides). */
  categoryIds: readonly Id[];
  targets?: readonly Target[];
  /** Evaluated targets for `month` (from evaluateTargets). Needed for underfunded / reduceOverfunding. */
  evaluated?: Readonly<Record<Id, TargetMonth>>;
  /** Total scheduled outflows this month per category (positive), for categories without targets. */
  scheduledOutflows?: Readonly<Record<Id, Minor>>;
  /** Category ids of credit card payment categories (funded last). */
  paymentCategoryIds?: ReadonlySet<Id>;
}

/**
 * Spending in a month = −activity, keeping the sign: a category with net inflow "spent" a
 * negative amount (YNAB trial 2026-11: Spent Last Month $1,410.00 = 1,575 spent − 165 inflow).
 */
function spending(cm: CategoryMonth | undefined): number {
  return cm ? 0 - cm.activity : 0;
}

/** The up-to-12 complete months before `month` that exist in the plan. */
function previousMonths(state: BudgetState, month: Month, count: number): Month[] {
  const out: Month[] = [];
  for (let m = addMonths(month, -1); out.length < count; m = addMonths(m, -1)) {
    if (!state.byMonth[m]) break;
    out.push(m);
  }
  return out;
}

/**
 * Auto-Assign (§5.5). Returns the deltas and their total for preview; nothing is applied.
 * "Underfunded" lists the full need in YNAB's documented priority order (commit it through
 * limitToReadyToAssign, which stops when Ready to Assign reaches 0): overspent categories, then dated weekly/monthly targets and scheduled
 * transactions by due date, then end-of-month targets, then future-dated targets by due
 * date, then credit card payment categories; ties in category order.
 */
export function autoAssign(option: AutoAssignOption, input: AutoAssignInput): PlanChange {
  const { state, month, categoryIds } = input;
  const ms = monthState(state, month);
  const deltas: AssignmentDelta[] = [];
  const cat = (id: Id): CategoryMonth => {
    const c = ms.categories[id];
    if (!c) throw new ValidationError(`Unknown category ${id}`);
    return c;
  };
  const setAssigned = (id: Id, value: number) => {
    deltas.push({ month, categoryId: id, delta: minor(value - cat(id).assigned) });
  };

  switch (option) {
    case 'assignedLastMonth': {
      // No earlier month in the plan → the option does nothing (YNAB trial: $0.00 in month one).
      const last = state.byMonth[addMonths(month, -1)];
      if (last) for (const id of categoryIds) setAssigned(id, last.categories[id]?.assigned ?? 0);
      break;
    }
    case 'spentLastMonth': {
      // Credit card payment categories are left out of the spending options (trial 2026-11).
      const last = state.byMonth[addMonths(month, -1)];
      if (last) for (const id of categoryIds) if (!input.paymentCategoryIds?.has(id)) setAssigned(id, spending(last.categories[id]));
      break;
    }
    case 'averageAssigned':
    case 'averageSpent': {
      // ASSUMPTION: average over the up-to-12 previous months the plan has (YNAB: "last 12 months").
      const months = previousMonths(state, month, 12);
      for (const id of categoryIds) {
        if (option === 'averageSpent' && input.paymentCategoryIds?.has(id)) continue;
        if (months.length === 0) continue; // no history: nothing to average (YNAB trial)
        let sum = 0;
        for (const m of months) {
          const c = state.byMonth[m]?.categories[id];
          sum += option === 'averageAssigned' ? (c?.assigned ?? 0) : spending(c);
        }
        setAssigned(id, divRound(minor(sum), months.length));
      }
      break;
    }
    case 'resetAvailable':
      for (const id of categoryIds) deltas.push({ month, categoryId: id, delta: neg(cat(id).available) });
      break;
    case 'resetAssigned':
      for (const id of categoryIds) setAssigned(id, 0);
      break;
    case 'reduceOverfunding':
      for (const id of categoryIds) {
        const t = input.evaluated?.[id];
        if (t && t.overfunded > 0) deltas.push({ month, categoryId: id, delta: minor(-Math.min(t.overfunded, Math.max(cat(id).assigned, 0))) });
      }
      break;
    case 'underfunded':
      return underfunded(input);
  }
  return change(deltas);
}

function underfunded(input: AutoAssignInput): PlanChange {
  const { state, month, categoryIds } = input;
  const ms = monthState(state, month);
  const order = new Map(categoryIds.map((id, i) => [id, i]));
  const targetFor = new Map((input.targets ?? []).map((t) => [t.categoryId, t]));
  interface Need {
    id: Id;
    amount: number;
    tier: number;
    due: ISODate | '';
  }
  const needs: Need[] = [];
  for (const id of categoryIds) {
    const cm = ms.categories[id];
    if (!cm) throw new ValidationError(`Unknown category ${id}`);
    const t = input.evaluated?.[id];
    const target = targetFor.get(id);
    const overspent = cm.available < 0 ? 0 - cm.available : 0;
    let amount = overspent;
    let tier = overspent > 0 ? 0 : 9;
    let due: ISODate | '' = '';
    if (t && t.status !== 'snoozed' && t.status !== 'inactive' && target) {
      // A "Have a balance of" target with no date is skipped by Underfunded (YNAB docs).
      const noDateBalance = target.cadence.kind === 'custom' && target.cadence.due === undefined;
      if (!noDateBalance) {
        amount += t.underfunded;
        due = t.dueDate ?? '';
        if (tier !== 0) {
          if (input.paymentCategoryIds?.has(id)) tier = 4;
          else if (target.cadence.kind === 'weekly' || (target.cadence.kind === 'monthly' && target.cadence.day !== 'last')) tier = 1;
          else if (target.cadence.kind === 'monthly') tier = 2;
          else tier = 3;
        }
      }
    } else if (!t && cm.creditCard) {
      // A payment category is underfunded by the card debt it doesn't cover, minus this month's
      // credit overspending (already counted on the overspent categories). YNAB trial: Amex owes
      // $50 with $40 set aside → $0 in October (the $10 is Dining out's), $10 in November.
      const debt = 0 - cm.creditCard.balance;
      const short = Math.max(0, debt - cm.available - cm.creditCard.unfundedSpending);
      if (short > 0) {
        amount += short;
        if (tier !== 0) tier = 4;
      }
    } else if (!t) {
      const scheduled = input.scheduledOutflows?.[id] ?? 0;
      // Scheduled outflows are funded like a refill to their total (trial 2026-10: Utilities $15).
      const short = Math.max(0, scheduled - Math.max(cm.carriedIn + cm.assigned, 0));
      if (short > 0) {
        amount += short;
        if (tier !== 0) tier = 1;
      }
    }
    if (amount > 0) needs.push({ id, amount, tier, due });
  }
  needs.sort((a, b) => a.tier - b.tier || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  // The preview is the full need, in priority order (YNAB trial: $1,305.01 shown with Ready to
  // Assign at $0). Committing applies limitToReadyToAssign, which stops where the money runs out.
  return change(needs.map((n) => ({ month, categoryId: n.id, delta: minor(n.amount) })));
}

/**
 * Apply a positive change (Underfunded) only as far as Ready to Assign goes, in the change's
 * order (which is YNAB's priority order). "If Ready to Assign reaches $0.00 at any point in this
 * order, the funding will automatically stop" (YNAB, Underfunded guide). Negative deltas pass.
 */
export function limitToReadyToAssign(planChange: PlanChange, readyToAssign: Minor): PlanChange {
  let remaining: number = readyToAssign;
  const deltas: AssignmentDelta[] = [];
  for (const d of planChange.deltas) {
    if (d.delta <= 0) {
      deltas.push(d);
      continue;
    }
    if (remaining <= 0) break;
    const give = Math.min(d.delta, remaining);
    deltas.push({ ...d, delta: minor(give) });
    remaining -= give;
  }
  return change(deltas);
}

/**
 * Plan Reset (YNAB, Sep 2026): return every unspent dollar to Ready to Assign, including
 * money assigned in future months. Credit card payment categories keep their money, and no
 * category is left overspent. One undoable change.
 */
export function planReset(state: BudgetState, month: Month, categoryIds: readonly Id[], paymentCategoryIds: ReadonlySet<Id>): PlanChange {
  const deltas: AssignmentDelta[] = [];
  for (const id of categoryIds) {
    if (paymentCategoryIds.has(id)) continue;
    const cm = monthState(state, month).categories[id];
    if (!cm) throw new ValidationError(`Unknown category ${id}`);
    // Positive → back to Ready to Assign; negative (overspent) → covered so it ends at 0.
    if (cm.available !== 0) deltas.push({ month, categoryId: id, delta: neg(cm.available) });
    for (const m of state.months) {
      if (compareMonths(m, month) <= 0) continue;
      const future = state.byMonth[m]?.categories[id];
      if (future && future.assigned !== 0) deltas.push({ month: m, categoryId: id, delta: neg(future.assigned) });
    }
  }
  return change(deltas);
}

/**
 * Fresh Start (§5.14), verified on YNAB (trial 2026-10-08): a new plan that keeps the category
 * groups, categories (and, outside the snapshot, targets and scheduled transactions) and every
 * open account. Accounts that aren't bank-linked — every HAFB account — restart at **$0**: one
 * $0 "Starting Balance" transaction dated today (on-budget → Ready to Assign), for the user to
 * update with today's balance. No history, no assignments. The old plan is archived unchanged.
 */
export function freshStart(snapshot: BudgetSnapshot, state: BudgetState, today: ISODate): BudgetSnapshot {
  const transactions: Transaction[] = snapshot.accounts
    .filter((a) => !a.closed)
    .map((a) => ({
      id: `fresh-start:${a.id}`,
      accountId: a.id,
      date: today,
      amount: ZERO,
      categoryId: a.onBudget ? READY_TO_ASSIGN : null,
      cleared: 'cleared',
      memo: 'Starting Balance',
      isStartingBalance: true,
    }));
  return {
    settings: { ...snapshot.settings, firstMonth: state.currentMonth },
    accounts: snapshot.accounts.filter((a) => !a.closed),
    categoryGroups: snapshot.categoryGroups,
    categories: snapshot.categories,
    transactions,
    assignments: [],
  };
}
