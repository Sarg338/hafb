// Reflect report math: Spending Breakdown, Spending Trends, Net Worth, Income v Expense
// (parity RF-01…RF-07). Pure aggregations over a snapshot; charts and export come in S6.
// Worked examples: docs/budget-math.md §11. YNAB sources:
// https://support.ynab.com/en_us/reflect-in-ynab-B1GJsrWkj,
// https://support.ynab.com/en_us/spending-breakdown-H1H7YxmD0,
// https://support.ynab.com/en_us/income-v-expense-Byu1BYWRq
import { compareDates, compareMonths, divRound, minor, monthOf, monthRange, type ISODate, type Minor, type Month } from '@hafb/shared';
import { defaultStartingBalanceIds } from './ageOfMoney.ts';
import { transactionLines } from './budget.ts';
import { CREDIT_CARD_INTEREST, READY_TO_ASSIGN, UNCATEGORIZED, type Account, type BudgetSnapshot, type Id, type Subtransaction, type Transaction } from './model.ts';

export interface ReportFilters {
  from: Month;
  to: Month;
  /** Defaults to every on-budget account (every account for Net Worth). */
  accountIds?: readonly Id[];
  /** Defaults to every category; `UNCATEGORIZED` selects uncategorized money. */
  categoryIds?: readonly Id[];
}

const UNCATEGORIZED_NAME = 'Uncategorized';

/** One categorized line behind a report figure: a whole transaction, or one line of a split. */
export interface ReportLine {
  transactionId: Id;
  /** Set when the line is one part of a split. */
  subtransactionId?: Id;
  accountId: Id;
  date: ISODate;
  month: Month;
  payeeId?: Id;
  memo?: string;
  /** `UNCATEGORIZED` for on-budget money with no category; `READY_TO_ASSIGN` for income lines. */
  categoryId: Id;
  amount: Minor;
}

/** Narrows drill-down lines to one figure: a category or group (or payee, for income), optionally one month. */
export interface LineSelector {
  categoryId?: Id;
  groupId?: Id;
  /** Income only: `null` = no payee. */
  payeeId?: Id | null;
  month?: Month;
}

function lineOf(tx: Transaction, sub: Subtransaction | undefined, categoryId: Id, amount: number): ReportLine {
  const memo = sub?.memo ?? tx.memo;
  return {
    transactionId: tx.id,
    ...(sub ? { subtransactionId: sub.id } : {}),
    accountId: tx.accountId,
    date: tx.date,
    month: monthOf(tx.date),
    ...(tx.payeeId === undefined ? {} : { payeeId: tx.payeeId }),
    ...(memo === undefined || memo === '' ? {} : { memo }),
    categoryId,
    amount: minor(amount),
  };
}

/** Newest first; a split keeps its lines in order. */
const newestFirst = (a: ReportLine, b: ReportLine): number => compareDates(b.date, a.date) || (a.transactionId === b.transactionId ? 0 : a.transactionId < b.transactionId ? 1 : -1);

function subtransactionFor(tx: Transaction, index: number): Subtransaction | undefined {
  return tx.subtransactions && tx.subtransactions.length > 0 ? tx.subtransactions[index] : undefined;
}

interface Catalog {
  name: Map<Id, string>;
  group: Map<Id, Id>;
  groupName: Map<Id, string>;
  categoryOrder: Id[];
  groupOrder: Id[];
}

function catalog(snapshot: BudgetSnapshot): Catalog {
  const name = new Map<Id, string>([[UNCATEGORIZED, UNCATEGORIZED_NAME]]);
  const group = new Map<Id, Id>([[UNCATEGORIZED, UNCATEGORIZED]]);
  const groupName = new Map<Id, string>([[UNCATEGORIZED, UNCATEGORIZED_NAME]]);
  for (const g of snapshot.categoryGroups) groupName.set(g.id, g.name);
  for (const c of snapshot.categories) {
    name.set(c.id, c.name);
    group.set(c.id, c.groupId);
  }
  return {
    name,
    group,
    groupName,
    categoryOrder: [...snapshot.categories.map((c) => c.id), UNCATEGORIZED],
    groupOrder: [...snapshot.categoryGroups.map((g) => g.id), UNCATEGORIZED],
  };
}

function selectedAccounts(snapshot: BudgetSnapshot, filters: ReportFilters, onBudgetOnly: boolean): Map<Id, Account> {
  const wanted = filters.accountIds === undefined ? undefined : new Set(filters.accountIds);
  const out = new Map<Id, Account>();
  for (const a of snapshot.accounts) {
    if (wanted ? wanted.has(a.id) : a.onBudget) {
      if (!onBudgetOnly || a.onBudget) out.set(a.id, a);
    }
  }
  return out;
}

const inRange = (month: Month, filters: ReportFilters): boolean =>
  compareMonths(month, filters.from) >= 0 && compareMonths(month, filters.to) <= 0;

/**
 * Categorized money in on-budget accounts: what YNAB reports as spending. Transfers between
 * on-budget accounts carry no category and never appear; Ready to Assign lines are income, not
 * spending. Categorized transfers to off-budget accounts (a mortgage payment) are spending.
 */
function categoryLines(snapshot: BudgetSnapshot, filters: ReportFilters, skip: ReadonlySet<Id> = new Set()): ReportLine[] {
  const accounts = selectedAccounts(snapshot, filters, true);
  const allAccounts = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const categories = filters.categoryIds === undefined ? undefined : new Set(filters.categoryIds);
  const out: ReportLine[] = [];
  for (const tx of snapshot.transactions) {
    if (tx.deleted || skip.has(tx.id) || !accounts.has(tx.accountId)) continue;
    if (!inRange(monthOf(tx.date), filters)) continue;
    transactionLines(tx).forEach((line, i) => {
      if (line.categoryId === READY_TO_ASSIGN) return;
      // Credit Card Interest stays out of the spending plan (budget-math §3.15), so out of the
      // category reports too. To be checked against YNAB once the feature reaches every account.
      if (line.categoryId === CREDIT_CARD_INTEREST) return;
      // A card's starting debt needs no category (budget-math §3.12): it isn't spending.
      if (line.categoryId === null && tx.isStartingBalance) return;
      const counterpart = line.transferAccountId === undefined ? undefined : allAccounts.get(line.transferAccountId);
      if (counterpart?.onBudget) return;
      const categoryId = line.categoryId ?? UNCATEGORIZED;
      if (categories && !categories.has(categoryId)) return;
      out.push(lineOf(tx, subtransactionFor(tx, i), categoryId, line.amount));
    });
  }
  return out;
}

/**
 * The transactions behind a spending figure (Spending Breakdown, Spending Trends, Income v Expense
 * expenses), newest first. They are exactly the lines the totals are built from.
 */
export function spendingLines(snapshot: BudgetSnapshot, filters: ReportFilters, select: LineSelector = {}): ReportLine[] {
  const groupOf = new Map(snapshot.categories.map((c) => [c.id, c.groupId]));
  return categoryLines(snapshot, filters)
    .filter(
      (l) =>
        (select.categoryId === undefined || l.categoryId === select.categoryId) &&
        (select.groupId === undefined || (groupOf.get(l.categoryId) ?? UNCATEGORIZED) === select.groupId) &&
        (select.month === undefined || l.month === select.month),
    )
    .sort(newestFirst);
}

/** The income lines (inflows to Ready to Assign) behind an Income v Expense figure, newest first. */
export function incomeLines(snapshot: BudgetSnapshot, filters: ReportFilters, select: LineSelector = {}, startingBalanceIds?: ReadonlySet<Id>): ReportLine[] {
  const accounts = selectedAccounts(snapshot, filters, true);
  const starting = startingBalanceIds ?? defaultStartingBalanceIds(snapshot);
  const out: ReportLine[] = [];
  for (const tx of snapshot.transactions) {
    if (tx.deleted || starting.has(tx.id) || !accounts.has(tx.accountId)) continue;
    const month = monthOf(tx.date);
    if (!inRange(month, filters) || (select.month !== undefined && month !== select.month)) continue;
    if (select.payeeId !== undefined && (tx.payeeId ?? null) !== select.payeeId) continue;
    transactionLines(tx).forEach((line, i) => {
      if (line.categoryId === READY_TO_ASSIGN) out.push(lineOf(tx, subtransactionFor(tx, i), READY_TO_ASSIGN, line.amount));
    });
  }
  return out.sort(newestFirst);
}

// ---- Spending Breakdown -------------------------------------------------------------------------

export interface SpendingCategory {
  categoryId: Id;
  name: string;
  /** Outflows net of refunds over the range, as a positive amount. */
  spending: Minor;
}

export interface SpendingGroup {
  groupId: Id;
  name: string;
  spending: Minor;
  categories: SpendingCategory[];
}

export interface InflowCategory {
  categoryId: Id;
  name: string;
  /** Refunds and inflows exceeded spending by this much over the range. */
  inflow: Minor;
}

export interface SpendingBreakdown {
  /**
   * Total spending, net of categories whose inflows exceeded their spending (YNAB trial 2026-10:
   * $1,410.00 = $1,575.00 spent − a $165.00 net inflow; the inflow category isn't listed).
   */
  total: Minor;
  /** Sum of the listed spending categories; YNAB's percentages are shares of this. */
  grossSpending: Minor;
  averagePerMonth: Minor;
  /** Stack-ranked: groups and their categories by spending, largest first. */
  groups: SpendingGroup[];
  inflowCategories: InflowCategory[];
}

export function spendingBreakdown(snapshot: BudgetSnapshot, filters: ReportFilters): SpendingBreakdown {
  const cat = catalog(snapshot);
  const net = new Map<Id, number>();
  for (const l of categoryLines(snapshot, filters)) net.set(l.categoryId, (net.get(l.categoryId) ?? 0) + l.amount);
  const order = (id: Id) => cat.categoryOrder.indexOf(id);
  const groups = new Map<Id, SpendingGroup>();
  const inflowCategories: InflowCategory[] = [];
  let total = 0;
  let inflows = 0;
  for (const [categoryId, amount] of net) {
    const name = cat.name.get(categoryId) ?? categoryId;
    if (amount > 0) {
      inflowCategories.push({ categoryId, name, inflow: minor(amount) });
      inflows += amount;
      continue;
    }
    if (amount === 0) continue;
    const groupId = cat.group.get(categoryId) ?? UNCATEGORIZED;
    let g = groups.get(groupId);
    if (!g) {
      g = { groupId, name: cat.groupName.get(groupId) ?? groupId, spending: minor(0), categories: [] };
      groups.set(groupId, g);
    }
    g.categories.push({ categoryId, name, spending: minor(-amount) });
    g.spending = minor(g.spending - amount);
    total -= amount;
  }
  const ranked = [...groups.values()].sort((a, b) => b.spending - a.spending || cat.groupOrder.indexOf(a.groupId) - cat.groupOrder.indexOf(b.groupId));
  for (const g of ranked) g.categories.sort((a, b) => b.spending - a.spending || order(a.categoryId) - order(b.categoryId));
  inflowCategories.sort((a, b) => b.inflow - a.inflow || order(a.categoryId) - order(b.categoryId));
  const months = monthRange(filters.from, filters.to).length;
  const netTotal = total - inflows;
  return {
    total: minor(netTotal),
    grossSpending: minor(total),
    averagePerMonth: months > 0 ? divRound(minor(netTotal), months) : minor(0),
    groups: ranked,
    inflowCategories,
  };
}

// ---- Spending Trends ----------------------------------------------------------------------------

export interface TrendCategory {
  categoryId: Id;
  name: string;
  groupId: Id;
  /** Spending per month (outflows net of refunds; negative when refunds exceed spending). */
  byMonth: Minor[];
  total: Minor;
  average: Minor;
}

export interface TrendGroup {
  groupId: Id;
  name: string;
  byMonth: Minor[];
  total: Minor;
  average: Minor;
}

export interface SpendingTrends {
  months: Month[];
  /** Categories with activity in the range, in plan order. */
  categories: TrendCategory[];
  /** The same spending rolled up by category group (YNAB's stacked bars), in plan order. */
  groups: TrendGroup[];
  totalsByMonth: Minor[];
  total: Minor;
  averagePerMonth: Minor;
}

export function spendingTrends(snapshot: BudgetSnapshot, filters: ReportFilters): SpendingTrends {
  const cat = catalog(snapshot);
  const months = monthRange(filters.from, filters.to);
  const col = new Map(months.map((m, i) => [m, i]));
  const rows = new Map<Id, number[]>();
  for (const l of categoryLines(snapshot, filters)) {
    let row = rows.get(l.categoryId);
    if (!row) {
      row = months.map(() => 0);
      rows.set(l.categoryId, row);
    }
    const i = col.get(l.month) ?? 0;
    row[i] = (row[i] ?? 0) - l.amount;
  }
  const n = months.length;
  const totals = months.map(() => 0);
  const categories: TrendCategory[] = [];
  for (const categoryId of cat.categoryOrder) {
    const row = rows.get(categoryId);
    if (!row) continue;
    let total = 0;
    row.forEach((v, i) => {
      total += v;
      totals[i] = (totals[i] ?? 0) + v;
    });
    categories.push({
      categoryId,
      name: cat.name.get(categoryId) ?? categoryId,
      groupId: cat.group.get(categoryId) ?? UNCATEGORIZED,
      byMonth: row.map((v) => minor(v)),
      total: minor(total),
      average: divRound(minor(total), n),
    });
  }
  const total = totals.reduce((s, v) => s + v, 0);
  const groups: TrendGroup[] = [];
  for (const groupId of cat.groupOrder) {
    const members = categories.filter((c) => c.groupId === groupId);
    if (members.length === 0) continue;
    const byMonth = months.map((_, i) => members.reduce((s, c) => s + (c.byMonth[i] ?? 0), 0));
    const sum = byMonth.reduce((s, v) => s + v, 0);
    groups.push({ groupId, name: cat.groupName.get(groupId) ?? groupId, byMonth: byMonth.map((v) => minor(v)), total: minor(sum), average: divRound(minor(sum), n) });
  }
  return {
    months,
    categories,
    groups,
    totalsByMonth: totals.map((v) => minor(v)),
    total: minor(total),
    averagePerMonth: n > 0 ? divRound(minor(total), n) : minor(0),
  };
}

// ---- Net Worth ----------------------------------------------------------------------------------

export interface NetWorthRow {
  month: Month;
  /** Sum of positive account balances at month end. */
  assets: Minor;
  /** Sum of negative account balances at month end (≤ 0). */
  debts: Minor;
  netWorth: Minor;
  /** Change from the previous month end (the month before `from` for the first row). */
  change: Minor;
}

export interface AccountBalanceRow {
  accountId: Id;
  name: string;
  /** Balance at each month end (YNAB's Net Worth export lists one row per account). */
  byMonth: Minor[];
}

type NetWorthFilters = Pick<ReportFilters, 'from' | 'to' | 'accountIds'>;

/** Every account's month-end balance over the range, in account order (all accounts unless filtered). */
export function accountBalances(snapshot: BudgetSnapshot, filters: NetWorthFilters): AccountBalanceRow[] {
  return balancesWithStart(snapshot, filters).rows;
}

function balancesWithStart(snapshot: BudgetSnapshot, filters: NetWorthFilters): { rows: AccountBalanceRow[]; opening: number; firstMonth: Month | undefined } {
  const wanted = filters.accountIds === undefined ? undefined : new Set(filters.accountIds);
  const months = monthRange(filters.from, filters.to);
  const col = new Map(months.map((m, i) => [m, i]));
  const before = new Map<Id, number>();
  const deltas = new Map<Id, number[]>();
  let firstMonth: Month | undefined;
  for (const tx of snapshot.transactions) {
    if (tx.deleted || (wanted && !wanted.has(tx.accountId))) continue;
    const month = monthOf(tx.date);
    if (firstMonth === undefined || compareMonths(month, firstMonth) < 0) firstMonth = month;
    if (compareMonths(month, filters.from) < 0) {
      before.set(tx.accountId, (before.get(tx.accountId) ?? 0) + tx.amount);
      continue;
    }
    const i = col.get(month);
    if (i === undefined) continue;
    let d = deltas.get(tx.accountId);
    if (!d) {
      d = months.map(() => 0);
      deltas.set(tx.accountId, d);
    }
    d[i] = (d[i] ?? 0) + tx.amount;
  }
  let opening = 0;
  const rows = snapshot.accounts
    .filter((a) => !wanted || wanted.has(a.id))
    .map((a) => {
      let b = before.get(a.id) ?? 0;
      opening += b;
      const d = deltas.get(a.id);
      return {
        accountId: a.id,
        name: a.name,
        byMonth: months.map((_, i) => {
          b += d?.[i] ?? 0;
          return minor(b);
        }),
      };
    });
  return { rows, opening, firstMonth };
}

/** Month-end balances of every account (on- and off-budget unless filtered). */
export function netWorth(snapshot: BudgetSnapshot, filters: NetWorthFilters): NetWorthRow[] {
  const { rows, opening, firstMonth } = balancesWithStart(snapshot, filters);
  let previous = opening;
  return monthRange(filters.from, filters.to).map((month, i) => {
    let assets = 0;
    let debts = 0;
    for (const r of rows) {
      const b = r.byMonth[i] ?? 0;
      if (b > 0) assets += b;
      else debts += b;
    }
    const net = assets + debts;
    // The plan's first month has no change (YNAB trial 2026-10: "$0.00 (0.0%)").
    const change = firstMonth !== undefined && compareMonths(month, firstMonth) <= 0 ? 0 : net - previous;
    const row: NetWorthRow = { month, assets: minor(assets), debts: minor(debts), netWorth: minor(net), change: minor(change) };
    previous = net;
    return row;
  });
}

// ---- Income v Expense ---------------------------------------------------------------------------

export interface IncomeRow {
  payeeId: Id | null;
  name: string;
  byMonth: Minor[];
  average: Minor;
  total: Minor;
}

export interface ExpenseCategoryRow {
  categoryId: Id;
  name: string;
  /** Net categorized activity per month: negative = spending. */
  byMonth: Minor[];
  average: Minor;
  total: Minor;
}

export interface ExpenseGroupRow extends ExpenseCategoryRow {
  groupId: Id;
  categories: ExpenseCategoryRow[];
}

export interface IncomeVsExpense {
  months: Month[];
  income: { rows: IncomeRow[]; totalByMonth: Minor[]; average: Minor; total: Minor };
  expense: { groups: Omit<ExpenseGroupRow, 'categoryId'>[]; totalByMonth: Minor[]; average: Minor; total: Minor };
  netIncome: { byMonth: Minor[]; average: Minor; total: Minor };
}

export interface IncomeVsExpenseOptions {
  /** Display name for an income payee (undefined = no payee). */
  payeeName?: (payeeId: Id | undefined) => string;
  /** Defaults to each account's first inflow-to-Ready-to-Assign transaction. */
  startingBalanceIds?: ReadonlySet<Id>;
}

function totals(values: readonly number[], n: number): { byMonth: Minor[]; total: Minor; average: Minor } {
  const total = values.reduce((s, v) => s + v, 0);
  return { byMonth: values.map((v) => minor(v)), total: minor(total), average: n > 0 ? divRound(minor(total), n) : minor(0) };
}

/**
 * Income = inflows to Ready to Assign, by payee; expenses = categorized activity by group and
 * category. Cash and credit accounts only: YNAB leaves out tracking-account activity and
 * starting balances, so net income will not match the change in net worth.
 */
export function incomeVsExpense(snapshot: BudgetSnapshot, filters: ReportFilters, options: IncomeVsExpenseOptions = {}): IncomeVsExpense {
  const cat = catalog(snapshot);
  const months = monthRange(filters.from, filters.to);
  const n = months.length;
  const col = new Map(months.map((m, i) => [m, i]));
  const starting = options.startingBalanceIds ?? defaultStartingBalanceIds(snapshot);
  const payeeName = options.payeeName ?? ((id: Id | undefined) => id ?? 'No payee');

  // Income: Ready to Assign lines in on-budget accounts.
  const accounts = selectedAccounts(snapshot, filters, true);
  const income = new Map<string, { payeeId: Id | null; values: number[]; firstSeen: number }>();
  let seen = 0;
  for (const tx of snapshot.transactions) {
    if (tx.deleted || starting.has(tx.id) || !accounts.has(tx.accountId)) continue;
    const i = col.get(monthOf(tx.date));
    if (i === undefined) continue;
    for (const line of transactionLines(tx)) {
      if (line.categoryId !== READY_TO_ASSIGN) continue;
      const key = tx.payeeId ?? '';
      let row = income.get(key);
      if (!row) {
        seen += 1;
        row = { payeeId: tx.payeeId ?? null, values: months.map(() => 0), firstSeen: seen };
        income.set(key, row);
      }
      row.values[i] = (row.values[i] ?? 0) + line.amount;
    }
  }
  const incomeRows: IncomeRow[] = [...income.values()]
    .map((r) => ({ ...r, sum: r.values.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.sum - a.sum || a.firstSeen - b.firstSeen)
    .map((r) => ({ payeeId: r.payeeId, name: payeeName(r.payeeId ?? undefined), ...totals(r.values, n) }));
  const incomeByMonth = months.map((_, i) => [...income.values()].reduce((s, r) => s + (r.values[i] ?? 0), 0));

  // Expenses: categorized activity, plan order.
  const byCategory = new Map<Id, number[]>();
  for (const l of categoryLines(snapshot, filters, starting)) {
    let row = byCategory.get(l.categoryId);
    if (!row) {
      row = months.map(() => 0);
      byCategory.set(l.categoryId, row);
    }
    const i = col.get(l.month) ?? 0;
    row[i] = (row[i] ?? 0) + l.amount;
  }
  const groups: Omit<ExpenseGroupRow, 'categoryId'>[] = [];
  const expenseByMonth = months.map(() => 0);
  for (const groupId of cat.groupOrder) {
    const rows: ExpenseCategoryRow[] = [];
    const groupValues = months.map(() => 0);
    for (const categoryId of cat.categoryOrder) {
      const values = byCategory.get(categoryId);
      if (!values || (cat.group.get(categoryId) ?? UNCATEGORIZED) !== groupId) continue;
      values.forEach((v, i) => {
        groupValues[i] = (groupValues[i] ?? 0) + v;
        expenseByMonth[i] = (expenseByMonth[i] ?? 0) + v;
      });
      rows.push({ categoryId, name: cat.name.get(categoryId) ?? categoryId, ...totals(values, n) });
    }
    if (rows.length > 0) groups.push({ groupId, name: cat.groupName.get(groupId) ?? groupId, ...totals(groupValues, n), categories: rows });
  }

  const incomeTotals = totals(incomeByMonth, n);
  const expenseTotals = totals(expenseByMonth, n);
  return {
    months,
    income: { rows: incomeRows, totalByMonth: incomeTotals.byMonth, average: incomeTotals.average, total: incomeTotals.total },
    expense: { groups, totalByMonth: expenseTotals.byMonth, average: expenseTotals.average, total: expenseTotals.total },
    netIncome: totals(months.map((_, i) => (incomeByMonth[i] ?? 0) + (expenseByMonth[i] ?? 0)), n),
  };
}
