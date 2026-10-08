// Age of Money: CLAUDE.md §5.7, roadmap D7. Worked examples: docs/budget-math.md §9.
//
// YNAB publishes the inputs but not the algorithm
// (https://support.ynab.com/en_us/age-of-money-H1ZS84W1s): the last 10 cash outflows, credit card
// payments included, transfers and starting balances excluded, "how long were the dollars used
// for those transactions sitting around in your accounts, on average". Their blog describes
// spending the oldest money first (https://www.ynab.com/blog/how-old-is-your-money), so this is a
// FIFO model. Everything else below marked ASSUMPTION is ours until verified against real YNAB
// values (the golden export carries none).
import { compareDates, daysBetween, lastDayOfMonth, minor, monthRange, type ISODate, type Minor, type Month } from '@hafb/shared';
import { transactionLines } from './budget.ts';
import { isCreditAccountType, READY_TO_ASSIGN, type Account, type BudgetSnapshot, type Id } from './model.ts';

/** YNAB averages the last ten cash outflows. */
export const AGE_OF_MONEY_WINDOW = 10;

export interface AgeOfMoneyOptions {
  /**
   * Transactions that are account starting balances. Defaults to each account's first
   * transaction (by date, then entry order) when it is an inflow-to-Ready-to-Assign line.
   */
  startingBalanceIds?: ReadonlySet<Id>;
}

export interface AgedOutflow {
  transactionId: Id;
  date: ISODate;
  amount: Minor;
  /** Amount-weighted average age, in days, of the dollars this outflow spent. */
  ageDays: number;
}

interface MoneyEvent {
  kind: 'inflow' | 'outflow';
  transactionId: Id;
  date: ISODate;
  amount: number;
  seq: number;
}

/** Each account's first transaction, when it is an inflow-to-Ready-to-Assign (YNAB's "Starting Balance"). */
export function defaultStartingBalanceIds(snapshot: BudgetSnapshot): Set<Id> {
  // Prefer the explicit marker (YNAB's "Starting Balance" payee). The first-transaction guess
  // is only a fallback: a starting balance can be dated after earlier income (trial 2026-10).
  const marked = new Set(snapshot.transactions.filter((t) => t.isStartingBalance === true && !t.deleted).map((t) => t.id));
  if (marked.size > 0) return marked;
  const first = new Map<Id, { id: Id; date: ISODate; rta: boolean }>();
  for (const tx of snapshot.transactions) {
    if (tx.deleted) continue;
    const seen = first.get(tx.accountId);
    if (!seen || compareDates(tx.date, seen.date) < 0) {
      const isRta = (tx.subtransactions?.length ?? 0) === 0 && tx.categoryId === READY_TO_ASSIGN;
      first.set(tx.accountId, { id: tx.id, date: tx.date, rta: isRta });
    }
  }
  const ids = new Set<Id>();
  for (const f of first.values()) if (f.rta) ids.add(f.id);
  return ids;
}

const isCashOnBudget = (a: Account | undefined): boolean => a !== undefined && a.onBudget && !isCreditAccountType(a.type);

/** Cash inflows to Ready to Assign and qualifying cash outflows, in processing order. */
function moneyEvents(snapshot: BudgetSnapshot, options: AgeOfMoneyOptions): MoneyEvent[] {
  const accounts = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const starting = options.startingBalanceIds ?? defaultStartingBalanceIds(snapshot);
  const events: MoneyEvent[] = [];
  let seq = 0;
  for (const tx of snapshot.transactions) {
    if (tx.deleted || !isCashOnBudget(accounts.get(tx.accountId))) continue;
    seq += 1;
    if (starting.has(tx.id)) {
      // ASSUMPTION: a positive starting balance is money the household already had, so it
      // enters the queue; a starting balance is never an outflow (YNAB excludes them).
      if (tx.amount > 0) events.push({ kind: 'inflow', transactionId: tx.id, date: tx.date, amount: tx.amount, seq });
      continue;
    }
    let inflow = 0;
    let outflow = 0;
    for (const line of transactionLines(tx)) {
      const counterpart = line.transferAccountId === undefined ? undefined : accounts.get(line.transferAccountId);
      if (counterpart?.onBudget) {
        // Transfers between on-budget accounts are excluded, except money sent to a credit
        // card: YNAB counts credit card payments as outflows.
        if (isCreditAccountType(counterpart.type) && line.amount < 0) outflow -= line.amount;
        continue;
      }
      if (line.categoryId === READY_TO_ASSIGN && line.amount > 0) {
        inflow += line.amount;
      } else if (line.amount < 0) {
        outflow -= line.amount;
      }
      // ASSUMPTION: refunds into a spending category are not new money and are ignored.
    }
    if (inflow > 0) events.push({ kind: 'inflow', transactionId: tx.id, date: tx.date, amount: inflow, seq });
    if (outflow > 0) events.push({ kind: 'outflow', transactionId: tx.id, date: tx.date, amount: outflow, seq });
  }
  // ASSUMPTION: money received on a day can be spent that day (inflows sort first on a date).
  return events.sort(
    (a, b) => compareDates(a.date, b.date) || (a.kind === b.kind ? 0 : a.kind === 'inflow' ? -1 : 1) || a.seq - b.seq,
  );
}

/** Every qualifying outflow with the age of the dollars it spent, oldest first (FIFO). */
export function ageOfMoneyOutflows(snapshot: BudgetSnapshot, options: AgeOfMoneyOptions = {}): AgedOutflow[] {
  const buckets: { date: ISODate; remaining: number }[] = [];
  let head = 0;
  const out: AgedOutflow[] = [];
  for (const e of moneyEvents(snapshot, options)) {
    if (e.kind === 'inflow') {
      buckets.push({ date: e.date, remaining: e.amount });
      continue;
    }
    let need = e.amount;
    let weightedDays = 0;
    while (need > 0 && head < buckets.length) {
      const bucket = buckets[head];
      if (!bucket) break;
      const take = Math.min(need, bucket.remaining);
      weightedDays += take * daysBetween(bucket.date, e.date);
      bucket.remaining -= take;
      need -= take;
      if (bucket.remaining === 0) head += 1;
    }
    // ASSUMPTION: spending money that was never received (an overdraft) is aged 0 days.
    out.push({ transactionId: e.transactionId, date: e.date, amount: minor(e.amount), ageDays: weightedDays / e.amount });
  }
  return out;
}

function averageOfLast(outflows: readonly AgedOutflow[], asOf: ISODate): number | null {
  const upTo = outflows.filter((o) => compareDates(o.date, asOf) <= 0);
  if (upTo.length < AGE_OF_MONEY_WINDOW) return null;
  const last = upTo.slice(-AGE_OF_MONEY_WINDOW);
  // ASSUMPTION: a simple mean of the ten ages ("on average"), shown as whole days, half up.
  let total = 0;
  for (const o of last) total += o.ageDays;
  return Math.round(total / AGE_OF_MONEY_WINDOW);
}

/** Age of Money in days as of `asOf`, or null before there are ten qualifying outflows. */
export function ageOfMoney(snapshot: BudgetSnapshot, asOf: ISODate, options: AgeOfMoneyOptions = {}): number | null {
  return averageOfLast(ageOfMoneyOutflows(snapshot, options), asOf);
}

export interface AgeOfMoneyPoint {
  month: Month;
  /** Last day of the month: the point's as-of date. */
  date: ISODate;
  ageOfMoney: number | null;
}

/** One point per month end for the Reflect chart (6 months, 1 year, 2 years). */
export function ageOfMoneySeries(snapshot: BudgetSnapshot, from: Month, to: Month, options: AgeOfMoneyOptions = {}): AgeOfMoneyPoint[] {
  const outflows = ageOfMoneyOutflows(snapshot, options);
  return monthRange(from, to).map((month) => {
    const date = lastDayOfMonth(month);
    return { month, date, ageOfMoney: averageOfLast(outflows, date) };
  });
}
