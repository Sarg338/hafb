// The Plan inspector's numbers (S5.1), observed in the YNAB trial (2026-10-08). Pure: engine output in,
// display data out; every amount comes from computeBudget, evaluateTargets or autoAssign.
// - "[Month]'s Summary": Left Over from Last Month, Assigned in [Month], Activity, Available, for the
//   whole month or the selected categories.
// - Cost to Be Me: this month's targets against expected income, as two bars sized to the larger.
// - Assigned in Future Months: next month always, then any later month with money assigned; each with
//   a pie of how funded its targets are.
import { autoAssign, costToBeMe, evaluateTargets, type AutoAssignOption, type Id, type MonthState, type PlanChange } from '@hafb/engine';
import { addMonths, minor, ZERO, type Minor, type Month } from '@hafb/shared';
import type { PlanModel } from './planModel.ts';

export interface MonthSummary {
  leftOver: Minor;
  assigned: Minor;
  activity: Minor;
  available: Minor;
}

/** The month's totals, or the selected categories'. */
export function monthSummary(ms: MonthState, ids?: readonly Id[]): MonthSummary {
  const cats = ids === undefined ? Object.values(ms.categories) : ids.map((id) => ms.categories[id]).filter((c) => c !== undefined);
  let leftOver = 0;
  let assigned = 0;
  let activity = 0;
  let available = 0;
  for (const c of cats) {
    leftOver += c.carriedIn;
    assigned += c.assigned;
    activity += c.activity;
    available += c.available;
  }
  return { leftOver: minor(leftOver), assigned: minor(assigned), activity: minor(activity), available: minor(available) };
}

export interface CostView {
  targets: Minor;
  income: Minor;
  /** Bar widths, 0–100, against the larger of the two. */
  targetsPercent: number;
  incomePercent: number;
  difference: Minor;
}

export function costView(model: PlanModel): CostView {
  const income = model.plan.settings.expectedIncome ?? ZERO;
  const cost = costToBeMe(model.evaluated, income);
  const top = Math.max(cost.targets, income, 1);
  return { targets: cost.targets, income, targetsPercent: (cost.targets / top) * 100, incomePercent: (income / top) * 100, difference: cost.difference };
}

export interface FutureMonth {
  month: Month;
  assigned: Minor;
  /** 0–1: how much of that month's target need its assignments cover; null with no targets due. */
  funded: number | null;
}

/** Next month always (YNAB lists it even at $0.00), then later months with money assigned. */
export function futureMonths(model: PlanModel, later: readonly { month: Month; ms: MonthState }[]): FutureMonth[] {
  const next = addMonths(model.month, 1);
  const targets = [...model.targets.values()];
  const out: FutureMonth[] = [];
  const seen = new Set<Month>();
  for (const { month, ms } of later) {
    if (month !== next && ms.totals.assigned === 0) continue;
    const evaluated = evaluateTargets(targets, ms, model.assignedFor, { today: model.today });
    let needed = 0;
    let funded = 0;
    for (const tm of Object.values(evaluated)) {
      if (tm.status === 'inactive') continue;
      needed += tm.needed;
      funded += Math.min(tm.funded, tm.needed);
    }
    out.push({ month, assigned: ms.totals.assigned, funded: needed > 0 ? funded / needed : null });
    seen.add(month);
  }
  if (!seen.has(next)) out.unshift({ month: next, assigned: ZERO, funded: null });
  return out;
}

export const AUTO_ASSIGN_OPTIONS: readonly { id: AutoAssignOption; label: string; group: number }[] = [
  { id: 'underfunded', label: 'Underfunded', group: 0 },
  { id: 'assignedLastMonth', label: 'Assigned Last Month', group: 1 },
  { id: 'spentLastMonth', label: 'Spent Last Month', group: 1 },
  { id: 'averageAssigned', label: 'Average Assigned', group: 1 },
  { id: 'averageSpent', label: 'Average Spent', group: 1 },
  { id: 'reduceOverfunding', label: 'Reduce Overfunding', group: 2 },
  { id: 'resetAvailable', label: 'Reset Available Amounts', group: 2 },
  { id: 'resetAssigned', label: 'Reset Assigned Amounts', group: 2 },
];

/** YNAB words a payment category's options as "Paid" (trial: Paid Last Month, Average Paid). */
function labelFor(label: string, payment: boolean, single: boolean): string {
  let out = label;
  if (payment) out = out.replace('Spent', 'Paid');
  if (single) out = out.replace(' Amounts', ' Amount');
  return out;
}

export interface AutoAssignChoice {
  id: AutoAssignOption;
  label: string;
  group: number;
  change: PlanChange;
}

/**
 * Auto-Assign's options with their live amounts. The Reset options act only on selected categories
 * (YNAB trial): with nothing selected they show $0.00.
 */
export function autoAssignChoices(model: PlanModel, ids: readonly Id[], selection: boolean): AutoAssignChoice[] {
  const input = {
    state: model.state,
    month: model.month,
    categoryIds: [...ids],
    targets: [...model.targets.values()],
    evaluated: model.evaluated,
    scheduledOutflows: model.scheduledOutflows,
    paymentCategoryIds: model.paymentIds,
  };
  const empty: PlanChange = { deltas: [], total: ZERO };
  const single = ids.length === 1 && selection;
  const payment = single && model.paymentIds.has(ids[0] ?? '');
  return AUTO_ASSIGN_OPTIONS.map((o) => ({
    id: o.id,
    label: labelFor(o.label, payment, single),
    group: o.group,
    change: !selection && (o.id === 'resetAvailable' || o.id === 'resetAssigned') ? empty : autoAssign(o.id, input),
  }));
}
