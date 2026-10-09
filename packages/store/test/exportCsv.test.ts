import { minor } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { delimitedFor, encodeTable, exportFileName, exportMoney, exportNumber } from '../src/export/csv.ts';
import { registerRows } from '../src/export/register.ts';
import { samplePlan } from './fixtures/samplePlan.ts';

const usd = samplePlan().settings;
const euro = { ...usd, currencySymbol: '€', symbolPlacement: 'after' as const, numberFormat: '123.456,78' };

describe('delimited exports (YNAB format, observed 2026-10-09)', () => {
  it('writes a BOM, CRLF between rows and none after the last; text quoted, numbers bare', () => {
    expect(encodeTable([['Category', 'Oct 2026'], ['Say "hi"', { n: '-12.50' }]], ',')).toBe('\uFEFF"Category","Oct 2026"\r\n"Say ""hi""",-12.50');
  });

  it('uses TSV for decimal-comma currencies, and keeps tabs out of fields', () => {
    expect(delimitedFor(usd)).toEqual({ delimiter: ',', extension: 'csv' });
    expect(delimitedFor(euro)).toEqual({ delimiter: '\t', extension: 'tsv' });
    expect(encodeTable([['a\tb', { n: '1,50' }]], '\t')).toBe('\uFEFF"a b"\t1,50');
  });

  it('formats numbers and money without grouping, from integer minor units', () => {
    expect(exportNumber(minor(-120000), usd)).toEqual({ n: '-1200.00' });
    expect(exportNumber(minor(5), usd)).toEqual({ n: '0.05' });
    expect(exportNumber(minor(-120000), euro)).toEqual({ n: '-1200,00' });
    expect(exportMoney(minor(120000), usd)).toEqual({ n: '$1200.00' });
    expect(exportMoney(minor(-500), usd)).toEqual({ n: '-$5.00' });
    expect(exportMoney(minor(37052), euro)).toEqual({ n: '370,52€' });
    expect(exportNumber(minor(-1234), { currencyDecimals: 0, numberFormat: '123,456' })).toEqual({ n: '-1234' });
  });

  it('builds file names Windows accepts', () => {
    expect(exportFileName(['My: Plan', 'Net Worth', '2026-10-09'], 'csv')).toBe('My- Plan - Net Worth - 2026-10-09.csv');
    expect(exportFileName(['', ''], 'zip')).toBe('export.zip');
  });
});

describe('register rows (Register.csv layout)', () => {
  const text = (rows: ReturnType<typeof registerRows>) => rows.map((r) => r.map((c) => (typeof c === 'string' ? c : c.n)).join('|'));

  it('writes every live transaction newest first, splits as Split (k/n) rows, transfers with their payee', () => {
    expect(text(registerRows(samplePlan()))).toEqual([
      'Account|Flag|Date|Payee|Category Group/Category|Category Group|Category|Memo|Outflow|Inflow|Cleared',
      'Checking||10/05/2026|Transfer : Visa|||||$100.00|$0.00|Cleared',
      'Visa||10/05/2026|Transfer : Checking|||||$0.00|$100.00|Cleared',
      'Visa||10/02/2026|Grocery Store|Bills: Groceries|Bills|Groceries|Split (1/2) food|$50.00|$0.00|Uncleared',
      'Visa||10/02/2026|Employer|Bills: Gas|Bills|Gas|Split (2/2) |$25.00|$0.00|Uncleared',
      'Checking|Green|10/01/2026|Employer|Inflow: Ready to Assign|Inflow|Ready to Assign||$0.00|$4000.00|Cleared',
      'Checking||10/01/2026|Grocery Store|Bills: Rent|Bills|Rent||$1500.00|$0.00|Cleared',
      'Checking||09/01/2026||Inflow: Ready to Assign|Inflow|Ready to Assign||$0.00|$2500.00|Reconciled',
    ]);
  });

  it('writes just the lines asked for, in that order (a report drill-down)', () => {
    const rows = text(registerRows(samplePlan(), [{ transactionId: 't-split', subtransactionId: 'st2' }, { transactionId: 't-pay' }]));
    expect(rows.slice(1)).toEqual([
      'Visa||10/02/2026|Employer|Bills: Gas|Bills|Gas|Split (2/2) |$25.00|$0.00|Uncleared',
      'Checking|Green|10/01/2026|Employer|Inflow: Ready to Assign|Inflow|Ready to Assign||$0.00|$4000.00|Cleared',
    ]);
  });
});
