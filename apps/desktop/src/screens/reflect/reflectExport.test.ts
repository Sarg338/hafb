import { describe, expect, it } from 'vitest';
import { netWorth, spendingBreakdown } from '@hafb/engine';
import { budgetSnapshot, readZip } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { incomeExpenseExport, netWorthExport, spendingExport } from './reflectExport.ts';

const plan = buildSamplePlan().plan;
const filters = { from: '2026-09' as const, to: '2026-10' as const };
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const rows = (t: string) => t.replace(/^\uFEFF/, '').split('\r\n');
/** Sum a numeric column (minor units) from bare "-12.34" cells. */
const cents = (cell: string | undefined) => Math.round(Number(cell ?? '0') * 100);

describe('Reflect exports (YNAB layouts, trial 2026-10-09)', () => {
  it('Spending: a zip of the summary and its transactions; the summary adds up to the report', async () => {
    const file = spendingExport(plan, filters, 'Spending Breakdown', SAMPLE_TODAY);
    expect(file.name).toBe(`${plan.settings.name} - Spending Breakdown - ${SAMPLE_TODAY}.zip`);
    const files = await readZip(file.bytes);
    const [summaryName, txName] = [...files.keys()];
    expect(summaryName).toBe(`${plan.settings.name} - Spending Breakdown - ${SAMPLE_TODAY}.csv`);
    expect(txName).toBe(`${plan.settings.name} - Spending Breakdown - ${SAMPLE_TODAY} - transactions.csv`);
    const summary = rows(text(files.get(summaryName ?? '') ?? new Uint8Array()));
    expect(summary[0]).toBe('"Category Group","Category","Sep 2026","Oct 2026","Average","Total"');
    const total = summary.slice(1).reduce((s, r) => s + cents(r.split(',').at(-1)), 0);
    expect(-total).toBe(spendingBreakdown(budgetSnapshot(plan), filters).total);
    const tx = rows(text(files.get(txName ?? '') ?? new Uint8Array()));
    expect(tx[0]).toBe('"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"');
    expect(tx.length).toBeGreaterThan(1);
  });

  it('Net Worth: one row per account, then Net Worth, matching the report', () => {
    const file = netWorthExport(plan, filters, SAMPLE_TODAY);
    expect(file.name.endsWith('.csv')).toBe(true);
    const lines = rows(text(file.bytes));
    expect(lines[0]).toBe('"Account","Sep 2026","Oct 2026"');
    const last = lines.at(-1) ?? '';
    expect(last.startsWith('"Net Worth",')).toBe(true);
    expect(cents(last.split(',').at(-1))).toBe(netWorth(budgetSnapshot(plan), filters).at(-1)?.netWorth);
    const accountSum = lines.slice(1, -1).reduce((s, r) => s + cents(r.split(',').at(-1)), 0);
    expect(accountSum).toBe(cents(last.split(',').at(-1)));
  });

  it('Income v Expense: YNAB’s row order', () => {
    const lines = rows(text(incomeExpenseExport(plan, filters, () => 'Payee', SAMPLE_TODAY).bytes));
    expect(lines[0]).toBe('"Category","Sep 2026","Oct 2026","Average","Total"');
    expect(lines[1]?.startsWith('"All Income Sources",')).toBe(true);
    const labels = lines.map((l) => l.split(',')[0]);
    expect(labels).toContain('"Total Income"');
    expect(labels.at(-2)).toBe('"Total Expenses"');
    expect(labels.at(-1)).toBe('"Net Income"');
  });

  it('uses TSV for a decimal-comma plan', () => {
    const euro = { ...plan, settings: { ...plan.settings, numberFormat: '123.456,78' } };
    const file = netWorthExport(euro, filters, SAMPLE_TODAY);
    expect(file.name.endsWith('.tsv')).toBe(true);
    expect(rows(text(file.bytes))[0]).toBe('"Account"\t"Sep 2026"\t"Oct 2026"');
  });
});
