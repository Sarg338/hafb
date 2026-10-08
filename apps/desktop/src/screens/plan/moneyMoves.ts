// Moving money on the Plan (S4.3): what the move / cover / un-assign pickers offer, the Ready to
// Assign breakdown lines, and future-month shortfalls. Pure; every amount comes from the engine.
// Observed in YNAB (trial, 2026-10-08):
// - Move: "Move [full Available] To [any category, Ready to Assign first]".
// - Cover overspending from: Ready to Assign and categories that have money.
// - Fix This (negative Ready to Assign): "Un-assign money from" a category that has money.
// - The breakdown lists only non-zero lines, then the total.
import { READY_TO_ASSIGN, type Id, type MonthState } from '@hafb/engine';
import { addMonths, compareMonths, isMonth, minor, monthParts, ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import { planBudget, type PlanData } from '@hafb/store';
import type { ComboGroup } from '../../ui/comboModel.ts';
import type { PlanModel } from './planModel.ts';
import { arrangeGroups } from './planRows.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longMonth = (m: Month): string => MONTHS[monthParts(m).month - 1] ?? m;
const shortMonth = (m: Month): string => `${longMonth(m).slice(0, 3)} ${String(monthParts(m).year)}`;

export interface PickerOptions {
  groups: ComboGroup[];
  /** Amount shown beside each option (Available, or what a future month has assigned). */
  amounts: Map<string, Minor>;
}

/** Visible categories grouped like the plan, filtered by `keep`. Hidden categories are left out. */
function categoryGroups(model: PlanModel, keep: (id: Id, available: Minor) => boolean, amounts: Map<string, Minor>): ComboGroup[] {
  const out: ComboGroup[] = [];
  for (const { group, categories } of arrangeGroups(model).visible) {
    const options = categories
      .filter((c) => {
        const available = model.ms.categories[c.id]?.available ?? ZERO;
        return keep(c.id, available);
      })
      .map((c) => {
        amounts.set(c.id, model.ms.categories[c.id]?.available ?? ZERO);
        return { id: c.id, label: c.name, keywords: [group.name] };
      });
    if (options.length > 0) out.push({ id: group.id, label: group.name, options });
  }
  return out;
}

/** Move money To: Ready to Assign, then every other visible category with its Available. */
export function moveTargets(model: PlanModel, fromId: Id): PickerOptions {
  const amounts = new Map<string, Minor>([[READY_TO_ASSIGN, model.ms.readyToAssign]]);
  const groups: ComboGroup[] = [{ id: 'inflow', label: 'Inflow', options: [{ id: READY_TO_ASSIGN, label: 'Ready to Assign' }] }];
  groups.push(...categoryGroups(model, (id) => id !== fromId, amounts));
  return { groups, amounts };
}

/** Manual assign To: every visible category (Ready to Assign is where the money comes from). */
export function assignTargets(model: PlanModel): PickerOptions {
  const amounts = new Map<string, Minor>();
  return { groups: categoryGroups(model, () => true, amounts), amounts };
}

/** Un-assign money from (negative Ready to Assign): categories that have money. */
export function unassignSources(model: PlanModel): PickerOptions {
  const amounts = new Map<string, Minor>();
  return { groups: categoryGroups(model, (_id, available) => available > 0, amounts), amounts };
}

/** An option id for money assigned in a future month: `future|<month>|<categoryId>`. */
export const futureSourceId = (month: Month, categoryId: Id): string => `future|${month}|${categoryId}`;

export function parseSource(id: string): { from: Id; month?: Month } {
  const [kind, month, categoryId] = id.split('|');
  if (kind === 'future' && month !== undefined && isMonth(month) && categoryId !== undefined) return { from: categoryId, month };
  return { from: id };
}

/**
 * Cover overspending from: Ready to Assign (when positive), categories with money this month, and
 * money assigned in future months (YNAB, Jun 2025).
 */
export function coverSources(model: PlanModel, overspentId: Id, futureMonths: readonly { month: Month; ms: MonthState }[]): PickerOptions {
  const amounts = new Map<string, Minor>();
  const groups: ComboGroup[] = [];
  if (model.ms.readyToAssign > 0) {
    amounts.set(READY_TO_ASSIGN, model.ms.readyToAssign);
    groups.push({ id: 'inflow', label: 'Inflow', options: [{ id: READY_TO_ASSIGN, label: 'Ready to Assign' }] });
  }
  groups.push(...categoryGroups(model, (id, available) => id !== overspentId && available > 0, amounts));
  const names = new Map(model.plan.categories.map((c) => [c.id, c.name]));
  for (const { month, ms } of futureMonths) {
    const options = Object.values(ms.categories)
      .filter((c) => c.assigned > 0 && names.has(c.categoryId))
      .map((c) => {
        const id = futureSourceId(month, c.categoryId);
        amounts.set(id, c.assigned);
        return { id, label: `${names.get(c.categoryId) ?? ''} (${shortMonth(month)})`, keywords: [shortMonth(month)] };
      });
    if (options.length > 0) groups.push({ id: `future-${month}`, label: `Assigned in ${shortMonth(month)}`, options });
  }
  return { groups, amounts };
}

/** Months after `month` that have money assigned, with their computed state (for cover sources and alerts). */
export function laterMonths(plan: PlanData, month: Month, today: ISODate): { month: Month; ms: MonthState }[] {
  let last: Month | null = null;
  for (const a of plan.assignments) if (a.assigned !== 0 && compareMonths(a.month, month) > 0 && (last === null || a.month > last)) last = a.month;
  if (last === null) return [];
  const state = planBudget(plan, { today, throughMonth: last });
  const out: { month: Month; ms: MonthState }[] = [];
  for (let m = addMonths(month, 1); compareMonths(m, last) <= 0; m = addMonths(m, 1)) {
    const ms = state.byMonth[m];
    if (ms) out.push({ month: m, ms });
  }
  return out;
}

/** Future months whose Ready to Assign is negative (YNAB's warning on "Assigned in Future Months"). */
export function futureShortfalls(later: readonly { month: Month; ms: MonthState }[]): { month: Month; readyToAssign: Minor }[] {
  return later.filter((x) => x.ms.readyToAssign < 0).map((x) => ({ month: x.month, readyToAssign: x.ms.readyToAssign }));
}

export interface BreakdownLine {
  label: string;
  /** Signed: what the line adds to Ready to Assign. */
  amount: Minor;
}

export interface Breakdown {
  plus: BreakdownLine[];
  minus: BreakdownLine[];
  total: Minor;
  note: string;
}

/** The "Ready to Assign Breakdown" popover: non-zero lines only, as YNAB lists them. */
export function readyToAssignBreakdown(ms: MonthState, month: Month): Breakdown {
  const b = ms.breakdown;
  const name = longMonth(month);
  const prev = longMonth(addMonths(month, -1));
  const plus: BreakdownLine[] = [];
  const minus: BreakdownLine[] = [];
  const add = (label: string, amount: number): void => {
    if (amount > 0) plus.push({ label, amount: minor(amount) });
    else if (amount < 0) minus.push({ label, amount: minor(amount) });
  };
  add('Left Over from Last Month', b.leftOverFromLastMonth);
  add(`Inflow: Ready to Assign transactions in ${name}`, b.inflows);
  add(`Cash overspending in ${prev}`, 0 - b.cashOverspendingLastMonth);
  add(`Assigned in ${name}`, 0 - b.assignedThisMonth);
  add('Assigned in Future', 0 - b.assignedInFuture);
  const total = ms.readyToAssign;
  const note = total > 0 ? 'Give these dollars a job by assigning them to one or more categories!' : total === 0 ? 'Nice work! Every dollar has a job.' : 'You have assigned more than you have.';
  return { plus, minus, total, note };
}
