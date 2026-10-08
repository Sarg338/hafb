// Core plan math: CLAUDE.md §5.1 (identity), §5.2 (Ready to Assign), §5.3 (credit cards),
// §5.9 (transfers). Worked examples: docs/budget-math.md §1–§4.
import {
  addMonths,
  compareDates,
  compareMonths,
  minor,
  monthOf,
  monthRange,
  ZERO,
  type ISODate,
  type Minor,
  type Month,
} from '@hafb/shared';
import { InvariantViolation, ValidationError } from './errors.ts';
import {
  isCreditAccountType,
  READY_TO_ASSIGN,
  UNCATEGORIZED,
  type Account,
  type BudgetSnapshot,
  type CategoryRef,
  type Id,
  type Transaction,
} from './model.ts';

export interface ComputeOptions {
  /** The plan's "today"; the engine never reads the clock (CLAUDE.md §8). */
  today: ISODate;
  /** Compute at least through this month (future months the user can plan in). */
  throughMonth?: Month;
}

export interface Overspending {
  /** Overspending paid with cash: zeroed at month end and taken from next month's Ready to Assign. */
  cash: Minor;
  /** Overspending on credit: zeroed at month end and left as unfunded card debt. */
  credit: Minor;
}

export interface CreditCardMonth {
  accountId: Id;
  /** Card spending covered by category money this month (moved into the payment category). */
  fundedSpending: Minor;
  /** Net money paid to the card this month (payments − cash advances). Reduces the category. */
  payments: Minor;
  /** Card balance at the end of the month (negative = owed). */
  balance: Minor;
  /** Card spending this month that category money did not cover (this month's credit overspending on this card). */
  unfundedSpending: Minor;
}

export interface CategoryMonth {
  categoryId: Id;
  assigned: Minor;
  activity: Minor;
  available: Minor;
  /** Last month's available if positive; negative balances never carry (§5.1). */
  carriedIn: Minor;
  cashActivity: Minor;
  creditActivity: Minor;
  overspending: Overspending;
  creditCard?: CreditCardMonth;
}

export interface ReadyToAssignBreakdown {
  /** Ready to Assign at the end of last month, before future-month assignments. */
  leftOverFromLastMonth: Minor;
  /** Cash overspending from last month, taken out this month. */
  cashOverspendingLastMonth: Minor;
  inflows: Minor;
  assignedThisMonth: Minor;
  /** Money assigned in later months, set aside from this month: at most what this month has left. */
  assignedInFuture: Minor;
}

export interface MonthState {
  month: Month;
  /** leftOver − cashOverspendingLastMonth + inflows − assignedThisMonth − assignedInFuture (the future part never takes it below zero). */
  readyToAssign: Minor;
  breakdown: ReadyToAssignBreakdown;
  categories: Record<Id, CategoryMonth>;
  totals: { assigned: Minor; activity: Minor; available: Minor };
}

export interface AccountBalance {
  cleared: Minor;
  uncleared: Minor;
  working: Minor;
}

export interface BudgetState {
  currentMonth: Month;
  months: Month[];
  byMonth: Partial<Record<Month, MonthState>>;
  accountBalances: Record<Id, AccountBalance>;
}

/** A transaction, or one line of a split, as the budget math sees it. */
export interface Line {
  transactionId: Id;
  accountId: Id;
  date: ISODate;
  amount: Minor;
  categoryId: CategoryRef;
  transferAccountId?: Id;
}

export function transactionLines(tx: Transaction): Line[] {
  const subs = tx.subtransactions;
  if (subs && subs.length > 0) {
    let total = 0;
    for (const s of subs) total += s.amount;
    if (total !== tx.amount) {
      throw new InvariantViolation(
        `Split ${tx.id}: subtransactions sum to ${String(total)} but the transaction is ${String(tx.amount)}`,
      );
    }
    return subs.map((s) => ({
      transactionId: tx.id,
      accountId: tx.accountId,
      date: tx.date,
      amount: s.amount,
      categoryId: s.categoryId,
      ...(s.transferAccountId === undefined ? {} : { transferAccountId: s.transferAccountId }),
    }));
  }
  return [
    {
      transactionId: tx.id,
      accountId: tx.accountId,
      date: tx.date,
      amount: tx.amount,
      categoryId: tx.categoryId,
      ...(tx.transferAccountId === undefined ? {} : { transferAccountId: tx.transferAccountId }),
    },
  ];
}

interface CardSpend {
  net: number;
  lastDate: ISODate;
  /** Outflow lines in order of arrival, for last-in-first-out unfunding. */
  outflows: { date: ISODate; amount: number; seq: number }[];
}

interface MonthBucket {
  inflows: number;
  cash: Map<Id, number>;
  credit: Map<Id, Map<Id, CardSpend>>;
  payments: Map<Id, number>;
}

function emptyBucket(): MonthBucket {
  return { inflows: 0, cash: new Map(), credit: new Map(), payments: new Map() };
}

function addTo(map: Map<Id, number>, key: Id, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

interface Index {
  accounts: Map<Id, Account>;
  /** Category ids in snapshot order, payment categories included. */
  categoryIds: Id[];
  paymentCategoryByCard: Map<Id, Id>;
  cardByPaymentCategory: Map<Id, Id>;
  accountOrder: Map<Id, number>;
}

function buildIndex(snapshot: BudgetSnapshot): Index {
  const accounts = new Map<Id, Account>();
  const accountOrder = new Map<Id, number>();
  snapshot.accounts.forEach((a, i) => {
    if (accounts.has(a.id)) throw new ValidationError(`Duplicate account id ${a.id}`);
    accounts.set(a.id, a);
    accountOrder.set(a.id, i);
  });
  const groups = new Set(snapshot.categoryGroups.map((g) => g.id));
  const categoryIds: Id[] = [];
  const paymentCategoryByCard = new Map<Id, Id>();
  const cardByPaymentCategory = new Map<Id, Id>();
  const seen = new Set<Id>();
  for (const c of snapshot.categories) {
    if (seen.has(c.id) || c.id === READY_TO_ASSIGN || c.id === UNCATEGORIZED) {
      throw new ValidationError(`Duplicate or reserved category id ${c.id}`);
    }
    if (!groups.has(c.groupId)) throw new ValidationError(`Category ${c.id} has unknown group ${c.groupId}`);
    seen.add(c.id);
    categoryIds.push(c.id);
    if (c.creditCardAccountId !== undefined) {
      const card = accounts.get(c.creditCardAccountId);
      if (!card || !isCreditAccountType(card.type) || !card.onBudget) {
        throw new ValidationError(`Payment category ${c.id} must point at an on-budget credit account`);
      }
      if (paymentCategoryByCard.has(card.id)) {
        throw new ValidationError(`Credit account ${card.id} has more than one payment category`);
      }
      paymentCategoryByCard.set(card.id, c.id);
      cardByPaymentCategory.set(c.id, card.id);
    }
  }
  for (const a of snapshot.accounts) {
    if (a.onBudget && isCreditAccountType(a.type) && !paymentCategoryByCard.has(a.id)) {
      throw new ValidationError(`On-budget credit account ${a.id} has no payment category`);
    }
  }
  return { accounts, categoryIds, paymentCategoryByCard, cardByPaymentCategory, accountOrder };
}

/**
 * Compute every month of the plan. Pure: same snapshot and `today` → same result.
 * The result is plain JSON-serializable data (CLAUDE.md §9).
 */
export function computeBudget(snapshot: BudgetSnapshot, options: ComputeOptions): BudgetState {
  const index = buildIndex(snapshot);
  const { accounts, cardByPaymentCategory } = index;
  const categorySet = new Set(index.categoryIds);

  // ---- assignments -------------------------------------------------------------------------
  const assigned = new Map<Month, Map<Id, number>>();
  const assignedTotalByMonth = new Map<Month, number>();
  for (const a of snapshot.assignments) {
    if (!categorySet.has(a.categoryId)) {
      throw new ValidationError(`Assignment to unknown category ${a.categoryId} in ${a.month}`);
    }
    let byCat = assigned.get(a.month);
    if (!byCat) {
      byCat = new Map();
      assigned.set(a.month, byCat);
    }
    if (byCat.has(a.categoryId)) {
      throw new ValidationError(`Duplicate assignment for ${a.categoryId} in ${a.month}`);
    }
    byCat.set(a.categoryId, a.assigned);
    assignedTotalByMonth.set(a.month, (assignedTotalByMonth.get(a.month) ?? 0) + a.assigned);
  }

  // ---- transactions → monthly buckets ------------------------------------------------------
  const buckets = new Map<Month, MonthBucket>();
  const bucketFor = (month: Month): MonthBucket => {
    let b = buckets.get(month);
    if (!b) {
      b = emptyBucket();
      buckets.set(month, b);
    }
    return b;
  };
  const balances = new Map<Id, { cleared: number; working: number }>();
  const cardMonthNet = new Map<Month, Map<Id, number>>();
  let hasUncategorized = false;
  let lineSeq = 0;

  for (const tx of snapshot.transactions) {
    if (tx.deleted) continue;
    const account = accounts.get(tx.accountId);
    if (!account) throw new ValidationError(`Transaction ${tx.id} has unknown account ${tx.accountId}`);
    const bal = balances.get(account.id) ?? { cleared: 0, working: 0 };
    bal.working += tx.amount;
    if (tx.cleared !== 'uncleared') bal.cleared += tx.amount;
    balances.set(account.id, bal);
    if (account.onBudget && isCreditAccountType(account.type)) {
      const m = monthOf(tx.date);
      let byCard = cardMonthNet.get(m);
      if (!byCard) {
        byCard = new Map();
        cardMonthNet.set(m, byCard);
      }
      byCard.set(account.id, (byCard.get(account.id) ?? 0) + tx.amount);
    }

    for (const line of transactionLines(tx)) {
      lineSeq += 1;
      const counterpart = line.transferAccountId === undefined ? undefined : accounts.get(line.transferAccountId);
      if (line.transferAccountId !== undefined && !counterpart) {
        throw new ValidationError(`Transaction ${tx.id} transfers to unknown account ${line.transferAccountId}`);
      }
      if (!account.onBudget) {
        if (line.categoryId !== null) {
          throw new ValidationError(`Transaction ${tx.id} is categorized in off-budget account ${account.id}`);
        }
        continue;
      }
      const bucket = bucketFor(monthOf(line.date));
      const isCard = isCreditAccountType(account.type);

      // Transfer between two on-budget accounts: no category; a card leg is a payment (§5.3, §5.9).
      if (counterpart?.onBudget) {
        if (line.categoryId !== null) {
          throw new ValidationError(`Transaction ${tx.id}: transfers between on-budget accounts cannot have a category`);
        }
        if (isCard) addTo(bucket.payments, account.id, line.amount);
        continue;
      }
      if (line.categoryId === READY_TO_ASSIGN) {
        bucket.inflows += line.amount;
        continue;
      }
      let categoryId: Id;
      if (line.categoryId === null) {
        categoryId = UNCATEGORIZED;
        hasUncategorized = true;
      } else {
        if (!categorySet.has(line.categoryId)) {
          throw new ValidationError(`Transaction ${tx.id} has unknown category ${line.categoryId}`);
        }
        if (cardByPaymentCategory.has(line.categoryId)) {
          throw new ValidationError(`Transaction ${tx.id} is categorized to a credit card payment category`);
        }
        categoryId = line.categoryId;
      }
      if (isCard) {
        let perCard = bucket.credit.get(categoryId);
        if (!perCard) {
          perCard = new Map();
          bucket.credit.set(categoryId, perCard);
        }
        let spend = perCard.get(account.id);
        if (!spend) {
          spend = { net: 0, lastDate: line.date, outflows: [] };
          perCard.set(account.id, spend);
        }
        spend.net += line.amount;
        if (compareDates(line.date, spend.lastDate) > 0) spend.lastDate = line.date;
        if (line.amount < 0) spend.outflows.push({ date: line.date, amount: 0 - line.amount, seq: lineSeq });
      } else {
        addTo(bucket.cash, categoryId, line.amount);
      }
    }
  }

  // ---- month range -----------------------------------------------------------------------------
  const currentMonth = monthOf(options.today);
  let first: Month = snapshot.settings.firstMonth ?? currentMonth;
  let last: Month = currentMonth;
  const extra = options.throughMonth === undefined ? [] : [options.throughMonth];
  for (const m of [...buckets.keys(), ...assigned.keys(), ...extra]) {
    if (compareMonths(m, first) < 0) first = m;
    if (compareMonths(m, last) > 0) last = m;
  }
  const months = monthRange(first, last);

  const regularIds = index.categoryIds.filter((id) => !cardByPaymentCategory.has(id));
  if (hasUncategorized) regularIds.push(UNCATEGORIZED);
  const paymentIds = index.categoryIds.filter((id) => cardByPaymentCategory.has(id));

  // ---- roll months forward -------------------------------------------------------------------
  const byMonth: Partial<Record<Month, MonthState>> = {};
  const prevAvailable = new Map<Id, number>();
  let totalAssigned = 0;
  for (const v of assignedTotalByMonth.values()) totalAssigned += v;
  let cumulativeAssigned = 0;
  let rtaCorePrev = 0;
  let cashOverspendingPrev = 0;
  const cardBalance = new Map<Id, number>();

  for (const month of months) {
    const bucket = buckets.get(month) ?? emptyBucket();
    const assignedHere = assigned.get(month);
    const categories: Record<Id, CategoryMonth> = {};
    const funded = new Map<Id, number>(); // card account → funded spending this month
    const unfundedByCard = new Map<Id, number>();
    for (const [cardId, net] of cardMonthNet.get(month) ?? []) cardBalance.set(cardId, (cardBalance.get(cardId) ?? 0) + net);
    let cashOverspending = 0;

    for (const id of regularIds) {
      const carriedIn = Math.max(prevAvailable.get(id) ?? 0, 0);
      const asg = assignedHere?.get(id) ?? 0;
      const cash = bucket.cash.get(id) ?? 0;
      const perCard = bucket.credit.get(id);
      let credit = 0;
      let creditSpending = 0;
      const cards = new Map<Id, { net: number; funded: number }>();
      const outflows: { accountId: Id; date: ISODate; amount: number; seq: number }[] = [];
      if (perCard) {
        for (const [accountId, s] of perCard) {
          credit += s.net;
          if (s.net < 0) creditSpending += -s.net;
          cards.set(accountId, { net: s.net, funded: -s.net });
          for (const o of s.outflows) outflows.push({ accountId, ...o });
        }
      }
      const activity = cash + credit;
      const available = carriedIn + asg + activity;
      let creditOver = 0;
      let cashOver = 0;
      if (available < 0) {
        creditOver = Math.min(-available, creditSpending);
        cashOver = -available - creditOver;
        // Unfunded card spending is the most recent card spending: walk card outflows newest
        // first (inferred from YNAB data; docs/budget-math.md §3.3).
        let unfunded = creditOver;
        outflows.sort((a, b) => compareDates(b.date, a.date) || b.seq - a.seq);
        for (const o of outflows) {
          if (unfunded === 0) break;
          const card = cards.get(o.accountId);
          if (!card || card.funded <= 0) continue;
          const take = Math.min(unfunded, o.amount, card.funded);
          card.funded -= take;
          unfunded -= take;
        }
      }
      for (const [accountId, c] of cards) {
        funded.set(accountId, (funded.get(accountId) ?? 0) + c.funded);
        if (c.net < 0) unfundedByCard.set(accountId, (unfundedByCard.get(accountId) ?? 0) + (0 - c.net - c.funded));
      }
      cashOverspending += cashOver;
      prevAvailable.set(id, available);
      categories[id] = {
        categoryId: id,
        assigned: minor(asg),
        activity: minor(activity),
        available: minor(available),
        carriedIn: minor(carriedIn),
        cashActivity: minor(cash),
        creditActivity: minor(credit),
        overspending: { cash: minor(cashOver), credit: minor(creditOver) },
      };
    }

    for (const id of paymentIds) {
      const cardId = cardByPaymentCategory.get(id);
      if (cardId === undefined) throw new InvariantViolation(`Payment category ${id} lost its card`);
      const carriedIn = Math.max(prevAvailable.get(id) ?? 0, 0);
      const asg = assignedHere?.get(id) ?? 0;
      const fundedSpending = funded.get(cardId) ?? 0;
      const payments = bucket.payments.get(cardId) ?? 0;
      const activity = fundedSpending - payments;
      const available = carriedIn + asg + activity;
      const cashOver = available < 0 ? -available : 0;
      cashOverspending += cashOver;
      prevAvailable.set(id, available);
      categories[id] = {
        categoryId: id,
        assigned: minor(asg),
        activity: minor(activity),
        available: minor(available),
        carriedIn: minor(carriedIn),
        cashActivity: minor(activity),
        creditActivity: ZERO,
        overspending: { cash: minor(cashOver), credit: ZERO },
        creditCard: {
          accountId: cardId,
          fundedSpending: minor(fundedSpending),
          payments: minor(payments),
          balance: minor(cardBalance.get(cardId) ?? 0),
          unfundedSpending: minor(unfundedByCard.get(cardId) ?? 0),
        },
      };
    }

    // ---- Ready to Assign (§5.2) ----
    const assignedThisMonth = assignedTotalByMonth.get(month) ?? 0;
    cumulativeAssigned += assignedThisMonth;
    const rtaCore = rtaCorePrev + bucket.inflows - assignedThisMonth - cashOverspendingPrev;
    // Money assigned in later months is set aside from this month's Ready to Assign, but only down to
    // zero: YNAB shows the shortfall in the future month itself (verified in the YNAB trial, budget-math §2).
    const assignedInFuture = Math.min(totalAssigned - cumulativeAssigned, Math.max(0, rtaCore));

    let totalActivity = 0;
    let totalAvailable = 0;
    for (const c of Object.values(categories)) {
      totalActivity += c.activity;
      totalAvailable += c.available;
    }
    byMonth[month] = {
      month,
      readyToAssign: minor(rtaCore - assignedInFuture),
      breakdown: {
        leftOverFromLastMonth: minor(rtaCorePrev),
        cashOverspendingLastMonth: minor(cashOverspendingPrev),
        inflows: minor(bucket.inflows),
        assignedThisMonth: minor(assignedThisMonth),
        assignedInFuture: minor(assignedInFuture),
      },
      categories,
      totals: { assigned: minor(assignedThisMonth), activity: minor(totalActivity), available: minor(totalAvailable) },
    };
    rtaCorePrev = rtaCore;
    cashOverspendingPrev = cashOverspending;
  }

  const accountBalances: Record<Id, AccountBalance> = {};
  for (const a of snapshot.accounts) {
    const b = balances.get(a.id) ?? { cleared: 0, working: 0 };
    accountBalances[a.id] = {
      cleared: minor(b.cleared),
      uncleared: minor(b.working - b.cleared),
      working: minor(b.working),
    };
  }

  return { currentMonth, months, byMonth, accountBalances };
}

/** Month state lookup that throws instead of returning undefined. */
export function monthState(state: BudgetState, month: Month): MonthState {
  const m = state.byMonth[month];
  if (!m) throw new ValidationError(`Month ${month} is outside the plan (${state.months[0] ?? '?'}…)`);
  return m;
}

/** The month after `month`, for callers that walk forward. */
export function nextMonth(month: Month): Month {
  return addMonths(month, 1);
}
