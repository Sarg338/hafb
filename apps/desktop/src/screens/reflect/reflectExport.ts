// Reflect exports (S6.1), in YNAB's layouts (trial exports, 2026-10-09):
// - Spending Breakdown / Spending Trends: a zip of two files, the summary ("Category Group",
//   "Category", one column per month, "Average", "Total"; spending negative) and its transactions
//   in Register.csv layout.
// - Net Worth: one file, "Account" and a column per month (month-end balances), then "Net Worth".
// - Income v Expense: one file, "All Income Sources", payees, "Total Income", each group then its
//   categories, "Total Expenses", "Net Income".
// CSV, or TSV for decimal-comma currencies; amounts from integer minor units.
import { accountBalances, incomeVsExpense, netWorth, spendingLines, spendingTrends, type ReportFilters } from '@hafb/engine';
import { neg, type ISODate, type Minor, type Month } from '@hafb/shared';
import { budgetSnapshot, delimitedFor, encodeTable, exportFileName, exportNumber, registerRows, writeZip, type Cell, type PlanData } from '@hafb/store';
import { monthLabel } from './reflectModel.ts';

export interface ExportFile {
  name: string;
  bytes: Uint8Array;
}

const utf8 = new TextEncoder();

function numbers(plan: PlanData, values: readonly Minor[]): Cell[] {
  return values.map((v) => exportNumber(v, plan.settings));
}

const monthHeaders = (months: readonly Month[]): string[] => months.map(monthLabel);

export type SpendingReport = 'Spending Breakdown' | 'Spending Trends';

/** Summary plus transactions, zipped (YNAB: "two separate files"). */
export function spendingExport(plan: PlanData, filters: ReportFilters, report: SpendingReport, today: ISODate): ExportFile {
  const snapshot = budgetSnapshot(plan);
  const { delimiter, extension } = delimitedFor(plan.settings);
  const trends = spendingTrends(snapshot, filters);
  const groupName = new Map(trends.groups.map((g) => [g.groupId, g.name]));
  const summary: Cell[][] = [['Category Group', 'Category', ...monthHeaders(trends.months), 'Average', 'Total']];
  for (const c of trends.categories) {
    summary.push([groupName.get(c.groupId) ?? '', c.name, ...numbers(plan, c.byMonth.map(neg)), exportNumber(neg(c.average), plan.settings), exportNumber(neg(c.total), plan.settings)]);
  }
  const lines = spendingLines(snapshot, filters);
  const transactions = registerRows(plan, lines.map((l) => ({ transactionId: l.transactionId, ...(l.subtransactionId === undefined ? {} : { subtransactionId: l.subtransactionId }) })));
  const base = [plan.settings.name, report, today];
  return {
    name: exportFileName(base, 'zip'),
    bytes: writeZip([
      { name: exportFileName(base, extension), bytes: utf8.encode(encodeTable(summary, delimiter)) },
      { name: exportFileName([...base, 'transactions'], extension), bytes: utf8.encode(encodeTable(transactions, delimiter)) },
    ], `${today}T12:00`),
  };
}

export function netWorthExport(plan: PlanData, filters: Pick<ReportFilters, 'from' | 'to' | 'accountIds'>, today: ISODate): ExportFile {
  const snapshot = budgetSnapshot(plan);
  const { delimiter, extension } = delimitedFor(plan.settings);
  const rows = accountBalances(snapshot, filters);
  const totals = netWorth(snapshot, filters);
  const table: Cell[][] = [['Account', ...monthHeaders(totals.map((t) => t.month))]];
  for (const r of rows) table.push([r.name, ...numbers(plan, r.byMonth)]);
  table.push(['Net Worth', ...numbers(plan, totals.map((t) => t.netWorth))]);
  return { name: exportFileName([plan.settings.name, 'Net Worth', today], extension), bytes: utf8.encode(encodeTable(table, delimiter)) };
}

export function incomeExpenseExport(plan: PlanData, filters: ReportFilters, payeeName: (id: string | undefined) => string, today: ISODate): ExportFile {
  const { delimiter, extension } = delimitedFor(plan.settings);
  const data = incomeVsExpense(budgetSnapshot(plan), filters, { payeeName });
  const line = (name: string, byMonth: readonly Minor[], average: Minor, total: Minor): Cell[] => [name, ...numbers(plan, byMonth), exportNumber(average, plan.settings), exportNumber(total, plan.settings)];
  const table: Cell[][] = [['Category', ...monthHeaders(data.months), 'Average', 'Total']];
  table.push(line('All Income Sources', data.income.totalByMonth, data.income.average, data.income.total));
  for (const r of data.income.rows) table.push(line(r.name, r.byMonth, r.average, r.total));
  table.push(line('Total Income', data.income.totalByMonth, data.income.average, data.income.total));
  for (const g of data.expense.groups) {
    table.push(line(g.name, g.byMonth, g.average, g.total));
    for (const c of g.categories) table.push(line(c.name, c.byMonth, c.average, c.total));
  }
  table.push(line('Total Expenses', data.expense.totalByMonth, data.expense.average, data.expense.total));
  table.push(line('Net Income', data.netIncome.byMonth, data.netIncome.average, data.netIncome.total));
  return { name: exportFileName([plan.settings.name, 'Income v Expense', today], extension), bytes: utf8.encode(encodeTable(table, delimiter)) };
}
