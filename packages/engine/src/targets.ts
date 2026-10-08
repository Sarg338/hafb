// Targets: CLAUDE.md §5.4. Worked examples: docs/budget-math.md §6.
//
// YNAB documents the behaviors but not the formulas. The model below reproduces every
// documented example (help center + screenshots); each assumption is marked ASSUMPTION and
// listed in docs/budget-math.md §6 (Assumptions) and §13.
import {
  addMonths,
  compareMonths,
  dateParts,
  dayOfWeek,
  daysInMonth,
  makeDate,
  minor,
  monthOf,
  monthParts,
  monthsBetween,
  type ISODate,
  type Minor,
  type Month,
} from '@hafb/shared';
import type { CategoryMonth, MonthState } from './budget.ts';
import { ValidationError } from './errors.ts';
import type { Id } from './model.ts';

export type TargetCadence =
  /** Every week, due on a weekday (0 = Sunday … 6 = Saturday). */
  | { kind: 'weekly'; weekday: number }
  /** Every month, due on a day of the month or the last day. */
  | { kind: 'monthly'; day: number | 'last' }
  /** Every year, due on a date (the year of `due` is the first due year). */
  | { kind: 'yearly'; due: ISODate }
  /** An amount due by a date, optionally repeating every N months; no date only for "Have a balance of". */
  | { kind: 'custom'; due?: ISODate; repeatEveryMonths?: number };

export type TargetBehavior =
  /** "Set aside another…": assign the full amount every period; money builds up. */
  | 'setAside'
  /** "Refill up to…": top up so the amount is on hand each period; leftovers count. */
  | 'refill'
  /** "Have a balance of…": reach the amount (by a date) and don't spend from it. Custom, non-repeating only. */
  | 'haveBalance';

export interface Target {
  categoryId: Id;
  amount: Minor;
  cadence: TargetCadence;
  behavior: TargetBehavior;
  /** Month the target was created; "set aside" progress counts assignments from here. */
  startMonth: Month;
  /**
   * Day the target was created. In that month, weekly due days before it don't need funding
   * (YNAB trial 2026-10: created Oct 8, the Oct 3 Saturday was not asked for).
   */
  createdOn?: ISODate;
  snoozedMonths?: readonly Month[];
}

/**
 * Target progress only. Overspending is a category state, not a target status: YNAB shows an
 * overspent category's target as met when its assignment meets it (trial 2026-10, Dining out).
 */
export type TargetStatus = 'onTrack' | 'underfunded' | 'funded' | 'snoozed' | 'inactive';

export interface TargetOptions {
  /** The plan's today. Months after it are "future months" (see refill rule below). */
  today?: ISODate;
}

export interface TargetMonth {
  categoryId: Id;
  status: TargetStatus;
  /** The goal for the current period (weekly: amount × weeks in the month). */
  needed: Minor;
  /** Progress toward `needed` (see §6 for what counts per behavior). */
  funded: Minor;
  /** needed − funded, never negative. */
  toGo: Minor;
  /** What to assign this month to stay on track, before this month's assignments. */
  neededThisMonth: Minor;
  /** neededThisMonth − assigned this month, never negative (0 when snoozed or inactive). */
  underfunded: Minor;
  /** Assigned beyond the target this month; what "Reduce Overfunding" removes. */
  overfunded: Minor;
  /** 0–100, floor(funded / needed); 100 once nothing is left to go. */
  progressPercent: number;
  /** This target's contribution to Cost to Be Me (full monthly amount, or this month's share). */
  monthlyCost: Minor;
  /** Due date of the current period, when there is one. */
  dueDate?: ISODate;
  /** Months left in the period including this one (1 for weekly/monthly). */
  monthsRemaining: number;
}

export function validateTarget(t: Target): void {
  if (t.amount <= 0) throw new ValidationError(`Target for ${t.categoryId}: amount must be positive`);
  const c = t.cadence;
  if (t.behavior === 'haveBalance' && (c.kind !== 'custom' || c.repeatEveryMonths !== undefined)) {
    throw new ValidationError(`Target for ${t.categoryId}: "Have a balance of" needs a non-repeating custom target`);
  }
  if (c.kind === 'custom' && c.due === undefined && t.behavior !== 'haveBalance') {
    throw new ValidationError(`Target for ${t.categoryId}: only "Have a balance of" may omit the date`);
  }
  if (c.kind === 'custom' && c.repeatEveryMonths !== undefined && (!Number.isInteger(c.repeatEveryMonths) || c.repeatEveryMonths < 1)) {
    throw new ValidationError(`Target for ${t.categoryId}: repeat must be a whole number of months ≥ 1`);
  }
  if (c.kind === 'weekly' && !(Number.isInteger(c.weekday) && c.weekday >= 0 && c.weekday <= 6)) {
    throw new ValidationError(`Target for ${t.categoryId}: weekday must be 0–6`);
  }
  if (c.kind === 'monthly' && c.day !== 'last' && !(Number.isInteger(c.day) && c.day >= 1 && c.day <= 31)) {
    throw new ValidationError(`Target for ${t.categoryId}: day must be 1–31 or 'last'`);
  }
}

/** How many times `weekday` occurs in `month` (4 or 5), optionally only on or after `fromDay`. */
export function weekdaysInMonth(month: Month, weekday: number, fromDay = 1): number {
  const { year, month: m } = monthParts(month);
  const first = dayOfWeek(makeDate(year, m, 1));
  const firstDay = 1 + ((weekday - first + 7) % 7);
  const start = firstDay >= fromDay ? firstDay : firstDay + 7 * Math.ceil((fromDay - firstDay) / 7);
  const last = daysInMonth(year, m);
  return start > last ? 0 : Math.floor((last - start) / 7) + 1;
}

const ceilDiv = (n: number, d: number): number => (n <= 0 ? 0 : Math.ceil(n / d));

/** For multi-month targets: the due month of the period containing `month`, or null when past due. */
function periodDue(t: Target, month: Month): { dueDate: ISODate; dueMonth: Month; length: number } | null {
  const c = t.cadence;
  let firstDue: ISODate;
  let every: number | undefined;
  if (c.kind === 'yearly') {
    firstDue = c.due;
    every = 12;
  } else if (c.kind === 'custom' && c.due !== undefined) {
    firstDue = c.due;
    every = c.repeatEveryMonths;
  } else {
    return null;
  }
  const firstMonth = monthOf(firstDue);
  let dueMonth = firstMonth;
  if (compareMonths(month, firstMonth) > 0) {
    if (every === undefined) return null; // non-repeating and past due → inactive
    const periods = Math.ceil(monthsBetween(firstMonth, month) / every);
    dueMonth = addMonths(firstMonth, periods * every);
  }
  const { day } = dateParts(firstDue);
  const { year, month: m } = monthParts(dueMonth);
  const dueDate = makeDate(year, m, Math.min(day, daysInMonth(year, m)));
  // ASSUMPTION: a non-repeating target's single period starts when the target was created.
  const length = every ?? Math.max(1, monthsBetween(t.startMonth, dueMonth) + 1);
  return { dueDate, dueMonth, length };
}

/**
 * Evaluate a target for one month. `assignedByMonth` gives the category's assigned amount
 * for any month (used for "set aside" progress across a multi-month period).
 */
export function evaluateTarget(
  target: Target,
  month: Month,
  cm: CategoryMonth,
  assignedByMonth: (m: Month) => Minor,
  options: TargetOptions = {},
): TargetMonth {
  validateTarget(target);
  const A = target.amount;
  const assigned = cm.assigned;
  const B0 = cm.carriedIn;
  const futureMonth = options.today !== undefined && compareMonths(month, monthOf(options.today)) > 0;
  const base = { categoryId: target.categoryId };
  const inactive = (): TargetMonth => ({
    ...base,
    status: 'inactive',
    needed: minor(0),
    funded: minor(0),
    toGo: minor(0),
    neededThisMonth: minor(0),
    underfunded: minor(0),
    overfunded: minor(0),
    progressPercent: 100,
    monthlyCost: minor(0),
    monthsRemaining: 0,
  });
  if (compareMonths(month, target.startMonth) < 0) return inactive();

  let needed: number;
  let funded: number;
  let neededThisMonth: number;
  /** What must be funded this month for "to go" (weekly: due days after creation only). */
  let effectiveNeeded: number;
  let monthlyCost: number;
  let monthsRemaining = 1;
  let dueDate: ISODate | undefined;
  const c = target.cadence;

  if (c.kind === 'weekly' || c.kind === 'monthly') {
    needed = c.kind === 'weekly' ? A * weekdaysInMonth(month, c.weekday) : A;
    effectiveNeeded = needed;
    if (c.kind === 'weekly' && target.createdOn !== undefined && monthOf(target.createdOn) === month) {
      effectiveNeeded = A * weekdaysInMonth(month, c.weekday, dateParts(target.createdOn).day);
    }
    // "Set aside": only this month's assignment counts. "Refill": leftovers count too, except
    // when viewing a future month, where YNAB ignores funding from the prior period (trial
    // 2026-11: Groceries $185 left over, Funded $0.00; also YNAB API docs, goal_under_funded).
    const leftOver = target.behavior === 'setAside' || futureMonth ? 0 : B0;
    funded = leftOver + assigned;
    neededThisMonth = Math.max(0, effectiveNeeded - leftOver);
    monthlyCost = needed;
    if (c.kind === 'monthly') {
      const { year, month: m } = monthParts(month);
      dueDate = makeDate(year, m, c.day === 'last' ? daysInMonth(year, m) : Math.min(c.day, daysInMonth(year, m)));
    }
  } else if (c.kind === 'custom' && c.due === undefined) {
    // "Have a balance of", no date: progress only. YNAB never asks for money this month and
    // leaves it out of Cost to Be Me (trial 2026-10: House Down Payment, no "Assign" prompt).
    needed = A;
    effectiveNeeded = A;
    funded = B0 + assigned;
    neededThisMonth = 0;
    monthlyCost = 0;
  } else {
    const period = periodDue(target, month);
    if (!period) return inactive();
    dueDate = period.dueDate;
    monthsRemaining = monthsBetween(month, period.dueMonth) + 1;
    needed = A;
    effectiveNeeded = A;
    if (target.behavior === 'setAside') {
      const periodStart = addMonths(period.dueMonth, -(period.length - 1));
      let before = 0;
      for (let m = compareMonths(periodStart, target.startMonth) < 0 ? target.startMonth : periodStart; compareMonths(m, month) < 0; m = addMonths(m, 1)) {
        before += assignedByMonth(m);
      }
      funded = before + assigned;
      neededThisMonth = ceilDiv(A - before, monthsRemaining);
    } else {
      funded = B0 + assigned;
      neededThisMonth = ceilDiv(A - B0, monthsRemaining);
    }
    monthlyCost = neededThisMonth;
  }

  const toGo = Math.max(0, effectiveNeeded - funded);
  const underfunded = Math.max(0, neededThisMonth - assigned);
  const overfunded = Math.max(0, assigned - neededThisMonth);
  const progressPercent =
    toGo === 0 ? 100 : needed > 0 ? Math.floor((100 * Math.min(Math.max(funded, 0), needed)) / needed) : 100;
  const snoozed = target.snoozedMonths?.includes(month) ?? false;
  let status: TargetStatus;
  if (snoozed) status = 'snoozed';
  else if (underfunded > 0) status = 'underfunded';
  else if (toGo === 0) status = 'funded';
  else status = 'onTrack';

  return {
    ...base,
    status,
    needed: minor(needed),
    funded: minor(funded),
    toGo: minor(toGo),
    neededThisMonth: minor(neededThisMonth),
    underfunded: minor(snoozed ? 0 : underfunded),
    overfunded: minor(overfunded),
    progressPercent,
    monthlyCost: minor(monthlyCost),
    ...(dueDate === undefined ? {} : { dueDate }),
    monthsRemaining,
  };
}

/** Evaluate every target for a month of computed state. */
export function evaluateTargets(
  targets: readonly Target[],
  monthState: MonthState,
  assignedFor: (categoryId: Id, month: Month) => Minor,
  options: TargetOptions = {},
): Record<Id, TargetMonth> {
  const out: Record<Id, TargetMonth> = {};
  for (const t of targets) {
    const cm = monthState.categories[t.categoryId];
    if (!cm) throw new ValidationError(`Target for unknown category ${t.categoryId}`);
    if (out[t.categoryId]) throw new ValidationError(`More than one target for ${t.categoryId}`);
    out[t.categoryId] = evaluateTarget(t, monthState.month, cm, (m) => assignedFor(t.categoryId, m), options);
  }
  return out;
}

/** Cost to Be Me: what this month's targets ask for, against expected income (§5.4). */
export function costToBeMe(evaluated: Record<Id, TargetMonth>, expectedIncome: Minor): {
  targets: Minor;
  expectedIncome: Minor;
  difference: Minor;
} {
  let total = 0;
  // Weekly/monthly targets count their full monthly amount; multi-month targets this month's
  // share; "Have a balance of" with no date nothing (trial 2026-10: $1,390.01 exactly).
  for (const t of Object.values(evaluated)) if (t.status !== 'inactive') total += t.monthlyCost;
  return { targets: minor(total), expectedIncome, difference: minor(expectedIncome - total) };
}
