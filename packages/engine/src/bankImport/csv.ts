// Bank CSV import (S6.5). YNAB's preview (https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo):
// columns map to Date, Payee, Memo, Outflow and Inflow, one Amount column can stand for both,
// "No header row" and "Swap Inflow and Outflow". The delimiter (comma, semicolon or tab), the
// date order and the decimal separator are detected and can be overridden. Amounts go straight
// from text to minor units; zero-amount rows are kept (YNAB no longer skips them).
import { abs, minor, neg, sub, ZERO, type Minor } from '@hafb/shared';
import { detectDateOrder, detectNumberFormat, parseAmount, parseDate, parseDelimited, type DateOrder } from '../ynab/csv.ts';
import type { BankRow, RowError } from './types.ts';

export type CsvColumn = 'date' | 'payee' | 'memo' | 'outflow' | 'inflow' | 'amount' | 'skip';

export interface CsvMapping {
  columns: readonly CsvColumn[];
  header: boolean;
  dateOrder: DateOrder;
  decimalSeparator: '.' | ',';
  swap: boolean;
}

export interface CsvFile {
  delimiter: ',' | ';' | '\t';
  rows: string[][];
}

/** Split a bank CSV, picking the delimiter that gives the most consistent column count. */
export function inspectCsv(text: string): CsvFile {
  let best: CsvFile = { delimiter: ',', rows: parseDelimited(text, ',') };
  let bestScore = -1;
  for (const delimiter of [',', ';', '\t'] as const) {
    const rows = parseDelimited(text, delimiter);
    const width = rows[0]?.length ?? 0;
    const consistent = rows.filter((r) => r.length === width).length;
    const score = width > 1 ? consistent * width : 0;
    if (score > bestScore) {
      bestScore = score;
      best = { delimiter, rows };
    }
  }
  return best;
}

const ROLE_NAMES: readonly [CsvColumn, RegExp][] = [
  ['date', /\b(date|datum|fecha|posted|posting|transaction date|trans\. date)\b/i],
  ['outflow', /\b(debit|debits|withdrawal|withdrawals|outflow|money out|paid out|spent|charge)\b/i],
  ['inflow', /\b(credit|credits|deposit|deposits|inflow|money in|paid in|received)\b/i],
  ['amount', /\b(amount|bedrag|betrag|montant|importe|value|sum)\b/i],
  ['memo', /\b(memo|note|notes|notitie|reference|ref|comment)\b/i],
  ['payee', /\b(payee|description|name|merchant|omschrijving|details|narrative|beschreibung|libell[eé]|concepto)\b/i],
];

const looksLikeDate = (s: string): boolean => /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*$/.test(s);
const looksLikeAmount = (s: string): boolean => /^\s*[-+(]?\s*[^\d\s-]{0,3}\s*-?[\d.,\s']*\d[\d.,']*\s*[^\d\s]{0,3}\s*\)?\s*$/.test(s) && /\d/.test(s);

/** YNAB-style first guess at the mapping: header names first, then what the cells look like. */
export function guessCsvMapping(csv: CsvFile): CsvMapping {
  const first = csv.rows[0] ?? [];
  const second = csv.rows[1] ?? first;
  const header = first.length > 0 && !first.some(looksLikeDate) && second.some(looksLikeDate);
  const width = Math.max(0, ...csv.rows.map((r) => r.length));
  const columns: CsvColumn[] = Array.from({ length: width }, () => 'skip');
  if (header) {
    first.forEach((name, i) => {
      if (/balance|saldo|running/i.test(name)) return;
      const role = ROLE_NAMES.find(([r, re]) => re.test(name) && !columns.includes(r))?.[0];
      if (role) columns[i] = role;
    });
  }
  const body = csv.rows.slice(header ? 1 : 0);
  const cells = (i: number) => body.map((r) => r[i] ?? '').filter((c) => c.trim() !== '');
  // Fill the gaps from the data: a date column, a text column for the payee, a number column for the amount.
  if (!columns.includes('date')) {
    const i = columns.findIndex((c, j) => c === 'skip' && cells(j).length > 0 && cells(j).every(looksLikeDate));
    if (i >= 0) columns[i] = 'date';
  }
  if (!columns.some((c) => c === 'amount' || c === 'outflow' || c === 'inflow')) {
    const i = columns.findIndex((c, j) => c === 'skip' && cells(j).length > 0 && cells(j).every(looksLikeAmount));
    if (i >= 0) columns[i] = 'amount';
  }
  if (!columns.includes('payee')) {
    const i = columns.findIndex((c, j) => c === 'skip' && cells(j).some((v) => /[A-Za-z]/.test(v)) && !cells(j).every(looksLikeAmount));
    if (i >= 0) columns[i] = 'payee';
  }
  const dateCol = columns.indexOf('date');
  const moneyCols = columns.map((c, i) => (c === 'amount' || c === 'outflow' || c === 'inflow' ? i : -1)).filter((i) => i >= 0);
  return {
    columns,
    header,
    dateOrder: dateCol >= 0 ? detectDateOrder(cells(dateCol)) : 'MDY',
    decimalSeparator: detectNumberFormat(moneyCols.flatMap(cells)).decimalSeparator,
    swap: false,
  };
}

/** A bank date in the given order; a two-digit year means 20xx (bank files rarely reach back further). */
export function parseBankDate(text: string, order: DateOrder): ReturnType<typeof parseDate> {
  const parts = text.trim().split(/[-/.]/);
  const yearAt = order === 'YMD' ? 0 : 2;
  const y = parts[yearAt];
  if (parts.length === 3 && y !== undefined && /^\d{2}$/.test(y)) parts[yearAt] = `20${y}`;
  return parseDate(parts.join('/'), order);
}

export interface CsvParseResult {
  rows: BankRow[];
  errors: RowError[];
}

/** Read the rows with a mapping. Rows without a readable date or any amount are reported, not imported. */
export function parseCsvRows(csv: CsvFile, mapping: CsvMapping, decimals: number): CsvParseResult {
  const rows: BankRow[] = [];
  const errors: RowError[] = [];
  const col = (r: readonly string[], role: CsvColumn): string | undefined => {
    const i = mapping.columns.indexOf(role);
    return i < 0 ? undefined : (r[i] ?? '').trim();
  };
  const format = { decimalSeparator: mapping.decimalSeparator };
  const money = (text: string | undefined): Minor | null => (text === undefined || text === '' ? null : parseAmount(text, format, decimals));
  csv.rows.forEach((r, index) => {
    if (mapping.header && index === 0) return;
    const line = index + 1;
    if (r.every((c) => c.trim() === '')) return;
    try {
      const dateText = col(r, 'date') ?? '';
      if (dateText === '') throw new Error('No date');
      const date = parseBankDate(dateText, mapping.dateOrder);
      const amount = money(col(r, 'amount'));
      const outflow = money(col(r, 'outflow'));
      const inflow = money(col(r, 'inflow'));
      if (amount === null && outflow === null && inflow === null) throw new Error('No amount');
      let value: Minor = amount ?? sub(inflow === null ? ZERO : abs(inflow), outflow === null ? ZERO : abs(outflow));
      if (mapping.swap) value = neg(value);
      rows.push({ date, amount: minor(value), payee: col(r, 'payee') ?? '', memo: col(r, 'memo') ?? '' });
    } catch (e) {
      errors.push({ line, message: e instanceof Error ? e.message : String(e) });
    }
  });
  return { rows, errors };
}
