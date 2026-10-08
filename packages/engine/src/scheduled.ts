// Scheduled transactions: CLAUDE.md §5.11. Recurrence, due-date entry and the upcoming-shortfall
// warning. Worked examples: docs/budget-math.md §8.1.
import {
  addDays,
  addMonths,
  addMonthsToDate,
  clampedDate,
  compareDates,
  dateParts,
  firstDayOfMonth,
  lastDayOfMonth,
  minor,
  monthOf,
  type ISODate,
  type Minor,
  type Month,
} from '@hafb/shared';
import type { MonthState } from './budget.ts';
import { InvariantViolation, ValidationError } from './errors.ts';
import { READY_TO_ASSIGN, type Account, type CategoryRef, type Id, type Subtransaction, type Transaction } from './model.ts';

/** YNAB's 13 repeat options (CLAUDE.md §4 ScheduledTransaction). */
export type Frequency =
  | 'never'
  | 'daily'
  | 'weekly'
  | 'everyOtherWeek'
  | 'twiceAMonth'
  | 'every4Weeks'
  | 'monthly'
  | 'everyOtherMonth'
  | 'every3Months'
  | 'every4Months'
  | 'twiceAYear'
  | 'yearly'
  | 'everyOtherYear';

export interface ScheduledTransaction {
  id: Id;
  accountId: Id;
  /** The next occurrence. */
  date: ISODate;
  frequency: Frequency;
  /**
   * Day of month the schedule was created on. Keeps a 31st schedule on the 31st after it was
   * clamped to Feb 28, and marks the first of the two twice-a-month days. Defaults to `date`'s day.
   */
  anchorDay?: number;
  amount: Minor;
  categoryId: CategoryRef;
  transferAccountId?: Id;
  payeeId?: Id;
  memo?: string;
  subtransactions?: readonly Subtransaction[];
  deleted?: boolean;
}

const DAY_STEPS: Partial<Record<Frequency, number>> = { daily: 1, weekly: 7, everyOtherWeek: 14, every4Weeks: 28 };
const MONTH_STEPS: Partial<Record<Frequency, number>> = {
  monthly: 1,
  everyOtherMonth: 2,
  every3Months: 3,
  every4Months: 4,
  twiceAYear: 6,
  yearly: 12,
  everyOtherYear: 24,
};

/** YNAB: "twice a month" repeats on the chosen day and exactly 15 days later, regardless of month end. */
const TWICE_A_MONTH_GAP = 15;

/**
 * The occurrence after `date`, or null for a one-time (`never`) schedule.
 * Month-based steps keep `anchorDay` and clamp to shorter months (31st → last day).
 */
export function nextOccurrence(frequency: Frequency, date: ISODate, anchorDay?: number): ISODate | null {
  if (frequency === 'never') return null;
  const days = DAY_STEPS[frequency];
  if (days !== undefined) return addDays(date, days);
  const anchor = anchorDay ?? dateParts(date).day;
  const months = MONTH_STEPS[frequency];
  if (months !== undefined) return addMonthsToDate(date, months, anchor);
  // twiceAMonth: candidates are (anchor, anchor + 15 days) in the previous, current and next month.
  let best: ISODate | null = null;
  for (const offset of [-1, 0, 1]) {
    const first = clampedDate(addMonths(monthOf(date), offset), anchor);
    for (const candidate of [first, addDays(first, TWICE_A_MONTH_GAP)]) {
      if (compareDates(candidate, date) > 0 && (best === null || compareDates(candidate, best) < 0)) best = candidate;
    }
  }
  if (best === null) throw new InvariantViolation(`No twice-a-month occurrence after ${date}`);
  return best;
}

/** Hard stop for runaway iteration (≈ 27 years of daily occurrences). */
const MAX_OCCURRENCES = 10_000;

/** Occurrences of a schedule, starting at its next date, that fall inside [from, to]. */
export function occurrencesBetween(scheduled: ScheduledTransaction, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let date: ISODate | null = scheduled.date;
  for (let i = 0; date !== null && compareDates(date, to) <= 0; i += 1) {
    if (i >= MAX_OCCURRENCES) throw new InvariantViolation(`Schedule ${scheduled.id} produced too many occurrences`);
    if (compareDates(date, from) >= 0) out.push(date);
    date = nextOccurrence(scheduled.frequency, date, scheduled.anchorDay);
  }
  return out;
}

export interface DueResult {
  /** New register transactions: unapproved; uncleared, except in Cash accounts (YNAB guide). */
  transactions: Transaction[];
  /** New next date per schedule that produced anything; null = the one-time schedule is used up. */
  updates: { scheduledId: Id; nextDate: ISODate | null }[];
}

function instantiate(s: ScheduledTransaction, date: ISODate, cleared: Transaction['cleared']): Transaction {
  const tx: Transaction = {
    id: `${s.id}:${date}`,
    accountId: s.accountId,
    date,
    amount: s.amount,
    categoryId: s.categoryId,
    cleared,
    approved: false,
  };
  if (s.transferAccountId !== undefined) tx.transferAccountId = s.transferAccountId;
  if (s.payeeId !== undefined) tx.payeeId = s.payeeId;
  if (s.memo !== undefined) tx.memo = s.memo;
  if (s.subtransactions && s.subtransactions.length > 0) {
    tx.subtransactions = s.subtransactions.map((sub) => ({ ...sub, id: `${sub.id}:${date}` }));
  }
  return tx;
}

/**
 * Every occurrence dated on or before `today` becomes a real transaction (§5.11: shown bold and
 * unapproved, no prompt). Transaction ids are `<scheduleId>:<date>`, so re-running is idempotent
 * for callers that de-duplicate by id.
 */
export function dueTransactions(scheduled: readonly ScheduledTransaction[], today: ISODate, accounts: readonly Account[]): DueResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const transactions: Transaction[] = [];
  const updates: DueResult['updates'] = [];
  for (const s of scheduled) {
    if (s.deleted || compareDates(s.date, today) > 0) continue;
    const account = byId.get(s.accountId);
    if (!account) throw new ValidationError(`Scheduled transaction ${s.id} has unknown account ${s.accountId}`);
    const cleared = account.type === 'cash' ? 'cleared' : 'uncleared';
    let date: ISODate | null = s.date;
    for (let i = 0; date !== null && compareDates(date, today) <= 0; i += 1) {
      if (i >= MAX_OCCURRENCES) throw new InvariantViolation(`Schedule ${s.id} produced too many occurrences`);
      transactions.push(instantiate(s, date, cleared));
      date = nextOccurrence(s.frequency, date, s.anchorDay);
    }
    updates.push({ scheduledId: s.id, nextDate: date });
  }
  return { transactions, updates };
}

/**
 * Net scheduled amounts per category still to come in `month`: occurrences after `today`
 * (or from the 1st, for a future month) through month end. Outflows are negative.
 * Split lines count toward their own categories; Ready to Assign and uncategorized lines are skipped.
 */
export function upcomingByCategory(scheduled: readonly ScheduledTransaction[], month: Month, today: ISODate): Record<Id, Minor> {
  const start = monthOf(today) === month ? addDays(today, 1) : firstDayOfMonth(month);
  const end = lastDayOfMonth(month);
  const totals = new Map<Id, number>();
  const add = (categoryId: CategoryRef, amount: number, times: number) => {
    if (categoryId === null || categoryId === READY_TO_ASSIGN || times === 0) return;
    totals.set(categoryId, (totals.get(categoryId) ?? 0) + amount * times);
  };
  for (const s of scheduled) {
    if (s.deleted || compareDates(start, end) > 0) continue;
    const times = occurrencesBetween(s, start, end).length;
    if (s.subtransactions && s.subtransactions.length > 0) {
      for (const sub of s.subtransactions) add(sub.categoryId, sub.amount, times);
    } else {
      add(s.categoryId, s.amount, times);
    }
  }
  const out: Record<Id, Minor> = {};
  for (const [id, total] of totals) out[id] = minor(total);
  return out;
}

/** Each category's available amount once its upcoming scheduled amounts land. */
export function availableAfterUpcoming(month: MonthState, upcoming: Readonly<Record<Id, Minor>>): Record<Id, Minor> {
  const out: Record<Id, Minor> = {};
  for (const [id, amount] of Object.entries(upcoming)) {
    out[id] = minor((month.categories[id]?.available ?? 0) + amount);
  }
  return out;
}

/** Categories whose upcoming scheduled outflows won't be covered (YNAB's calendar icon). */
export function upcomingShortfalls(month: MonthState, upcoming: Readonly<Record<Id, Minor>>): Id[] {
  return Object.entries(availableAfterUpcoming(month, upcoming))
    .filter(([, after]) => after < 0)
    .map(([id]) => id);
}
