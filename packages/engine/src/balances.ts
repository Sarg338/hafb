// Running balance (the register's optional column, CLAUDE.md §6.4): each transaction's account
// balance after it, oldest first. Within a date, transactions count in entry order (as given).
import { compareDates, minor, type ISODate, type Minor } from '@hafb/shared';
import type { Id } from './model.ts';

export interface BalanceLine {
  id: Id;
  date: ISODate;
  amount: Minor;
}

/** `lines` in entry order (one account, live transactions only). Returns id → balance after it. */
export function runningBalances(lines: readonly BalanceLine[]): Map<Id, Minor> {
  const ordered = lines.map((l, i) => ({ l, i })).sort((a, b) => compareDates(a.l.date, b.l.date) || a.i - b.i);
  const out = new Map<Id, Minor>();
  let total = 0;
  for (const { l } of ordered) {
    total += l.amount;
    out.set(l.id, minor(total));
  }
  return out;
}
