// Recent Moves and a category's Moves (S5.7), from the MoneyMove log, as YNAB shows them (trial,
// 2026-10-08):
// - Recent Moves: the last 34 days, newest first, grouped by day ("Today"); All / Moved / Assigned.
//   "Assigned $50.00 to Groceries OCT 2026", "Removed $50.00 from Groceries OCT 2026", and for a
//   move between categories "Moved $50.00 from Dining Out OCT 2026 to Groceries OCT 2026".
//   Empty: "No Money Moves" / "You haven't moved any money in the last 34 days."
// - A category's Moves: Date / Move / Amount, newest first, signed for that category.
// Pure: the caller passes how a timestamp becomes a local date.
import { READY_TO_ASSIGN, type Id } from '@hafb/engine';
import { addDays, addMonths, compareDates, minor, neg, type ISODate, type Minor, type Month } from '@hafb/shared';
import type { MoneyMoveRecord, PlanData } from '@hafb/store';

export const RECENT_DAYS = 34;
/** A category's Moves cover the viewed month and the two before it. */
export const HISTORY_MONTHS = 3;

export type MovesFilter = 'all' | 'moved' | 'assigned';

export interface MoveEnd {
  /** null = Ready to Assign. */
  categoryId: Id | null;
  name: string;
  month: Month;
}

export interface RecentMove {
  id: Id;
  verb: 'Assigned' | 'Removed' | 'Moved';
  amount: Minor;
  from: MoveEnd | null;
  to: MoveEnd | null;
}

export interface MoveDay {
  date: ISODate;
  moves: RecentMove[];
}

const isMove = (m: MoneyMoveRecord): boolean => m.fromCategoryId !== null && m.toCategoryId !== null;

function nameOf(plan: PlanData, id: Id | null): string {
  if (id === null || id === READY_TO_ASSIGN) return 'Ready to Assign';
  return plan.categories.find((c) => c.id === id)?.name ?? 'Deleted category';
}

function describe(plan: PlanData, m: MoneyMoveRecord): RecentMove {
  const end = (id: Id | null): MoveEnd => ({ categoryId: id, name: nameOf(plan, id), month: m.month });
  if (isMove(m)) return { id: m.id, verb: 'Moved', amount: m.amount, from: end(m.fromCategoryId), to: end(m.toCategoryId) };
  if (m.fromCategoryId === null) return { id: m.id, verb: 'Assigned', amount: m.amount, from: null, to: end(m.toCategoryId) };
  return { id: m.id, verb: 'Removed', amount: m.amount, from: end(m.fromCategoryId), to: null };
}

const newestFirst = (a: MoneyMoveRecord, b: MoneyMoveRecord): number => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The Recent Moves list: the last 34 days (today included), newest first, by day. */
export function recentMoves(plan: PlanData, today: ISODate, filter: MovesFilter, localDate: (timestamp: string) => ISODate): MoveDay[] {
  const since = addDays(today, 1 - RECENT_DAYS);
  const days: MoveDay[] = [];
  for (const m of plan.moneyMoves.toSorted(newestFirst)) {
    if (filter === 'moved' && !isMove(m)) continue;
    if (filter === 'assigned' && isMove(m)) continue;
    const date = localDate(m.createdAt);
    if (compareDates(date, since) < 0 || compareDates(date, today) > 0) continue;
    const last = days.at(-1);
    if (last?.date === date) last.moves.push(describe(plan, m));
    else days.push({ date, moves: [describe(plan, m)] });
  }
  return days;
}

export interface CategoryMove {
  id: Id;
  date: ISODate;
  /** "Assigned", "Removed", "Moved from Dining Out", "Moved to Groceries". */
  move: string;
  /** Signed for this category: money in is positive. */
  amount: Minor;
}

/** A category's Moves: changes to its assigned amount for `month` and the two months before. */
export function categoryMoves(plan: PlanData, categoryId: Id, month: Month, localDate: (timestamp: string) => ISODate): CategoryMove[] {
  const first = addMonths(month, 1 - HISTORY_MONTHS);
  const out: CategoryMove[] = [];
  for (const m of plan.moneyMoves.toSorted(newestFirst)) {
    if (m.month < first || m.month > month) continue;
    const into = m.toCategoryId === categoryId;
    const outOf = m.fromCategoryId === categoryId;
    if (!into && !outOf) continue;
    const other = into ? m.fromCategoryId : m.toCategoryId;
    const move = other === null ? (into ? 'Assigned' : 'Removed') : into ? `Moved from ${nameOf(plan, other)}` : `Moved to ${nameOf(plan, other)}`;
    out.push({ id: m.id, date: localDate(m.createdAt), move, amount: into ? m.amount : minor(neg(m.amount)) });
  }
  return out;
}

/** "OCT 2026" (YNAB's month tag on each move). */
export function monthTag(month: Month): string {
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${names[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;
}
