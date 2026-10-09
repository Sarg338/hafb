// Plan lifecycle screens (S7.2), pure: the template checklist and the quick target re-entry after
// a YNAB import (YNAB's export has no targets, CLAUDE.md §6.13).
import { addMonths, divRound, makeDate, minor, monthOf, sum, ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import { templateKey, type CategoryTemplate, type PlanData, type TargetEntry } from '@hafb/store';

/** Every "Group/Category" key of a template, in order. */
export function templateKeys(t: CategoryTemplate): string[] {
  return t.groups.flatMap((g) => g.categories.map((c) => templateKey(g.name, c.name)));
}

/** "37 categories · 3 groups" (YNAB's template header). */
export function templateSummary(t: CategoryTemplate): string {
  const n = templateKeys(t).length;
  const g = t.groups.length;
  return `${String(n)} ${n === 1 ? 'category' : 'categories'} · ${String(g)} ${g === 1 ? 'group' : 'groups'}`;
}

/** The quick target choices: the common YNAB targets, by cadence and behavior. */
export type TargetChoice = 'none' | 'monthlySetAside' | 'monthlyRefill' | 'weeklySetAside' | 'weeklyRefill' | 'yearly' | 'balance';

export const TARGET_CHOICES: readonly { id: TargetChoice; label: string }[] = [
  { id: 'none', label: 'No target' },
  { id: 'monthlySetAside', label: 'Monthly: set aside another' },
  { id: 'monthlyRefill', label: 'Monthly: refill up to' },
  { id: 'weeklySetAside', label: 'Weekly: set aside another' },
  { id: 'weeklyRefill', label: 'Weekly: refill up to' },
  { id: 'yearly', label: 'Yearly: set aside by Dec 31' },
  { id: 'balance', label: 'Have a balance of' },
];

/**
 * The target for a choice. Due dates follow YNAB's defaults: monthly on the last day, weekly on
 * Sunday, yearly by December 31 of this year; "Have a balance of" has no date.
 */
export function targetFor(categoryId: string, choice: TargetChoice, amount: Minor, today: ISODate): TargetEntry | null {
  if (choice === 'none' || amount <= 0) return null;
  const year = Number(today.slice(0, 4));
  switch (choice) {
    case 'monthlySetAside':
      return { categoryId, amount, cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside' };
    case 'monthlyRefill':
      return { categoryId, amount, cadence: { kind: 'monthly', day: 'last' }, behavior: 'refill' };
    case 'weeklySetAside':
      return { categoryId, amount, cadence: { kind: 'weekly', weekday: 0 }, behavior: 'setAside' };
    case 'weeklyRefill':
      return { categoryId, amount, cadence: { kind: 'weekly', weekday: 0 }, behavior: 'refill' };
    case 'yearly':
      return { categoryId, amount, cadence: { kind: 'yearly', due: makeDate(year, 12, 31) }, behavior: 'setAside' };
    case 'balance':
      return { categoryId, amount, cadence: { kind: 'custom' }, behavior: 'haveBalance' };
  }
}

/**
 * A starting amount for a category: the average assigned over the last three months before this
 * one (rounded half away from zero), or zero when nothing was assigned.
 */
export function suggestedAmount(plan: PlanData, categoryId: string, today: ISODate): Minor {
  const current: Month = monthOf(today);
  const months = [1, 2, 3].map((k) => addMonths(current, -k));
  const amounts = months.map((m) => plan.assignments.find((a) => a.month === m && a.categoryId === categoryId)?.assigned ?? ZERO);
  const total = sum(amounts);
  return total <= 0 ? ZERO : divRound(minor(total), 3);
}
