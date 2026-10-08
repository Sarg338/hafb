// Parsing YNAB's "Export Plan" files (Plan.csv + Register.csv). Pure string → data; no I/O.
// Format notes: docs/ynab-references.md "YNAB export format".
import { makeDate, makeMonth, minor, neg, parseDecimal, type ISODate, type Minor, type Month } from '@hafb/shared';
import { ValidationError } from '../errors.ts';

/** RFC 4180 CSV/TSV parser: quoted fields, doubled quotes, CRLF/LF, optional BOM. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export type DateOrder = 'DMY' | 'MDY' | 'YMD';

export interface NumberFormat {
  /** '.' for 1,234.56; ',' for 1.234,56. */
  decimalSeparator: '.' | ',';
}

/**
 * Parse a YNAB-formatted amount ("370.52$", "$1,234.56", "1.234,56 €", "(12.00)", "-5.00")
 * straight to minor units: currency symbols and grouping separators are removed as text.
 */
export function parseAmount(text: string, format: NumberFormat, decimals: number): Minor {
  let t = text.trim();
  let negative = false;
  if (t.startsWith('(') && t.endsWith(')')) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.includes('-')) {
    negative = !negative;
    t = t.replace('-', '');
  }
  const group = format.decimalSeparator === '.' ? ',' : '.';
  t = t.split(group).join('');
  t = t.replace(/[^\d.,]/g, '');
  if (format.decimalSeparator === ',') t = t.replace(',', '.');
  if (t === '') throw new ValidationError(`Not an amount: "${text}"`);
  const value = parseDecimal(t, decimals);
  return negative ? neg(value) : value;
}

/** Parse a date written in the plan's date format (any of - / . separators). */
export function parseDate(text: string, order: DateOrder): ISODate {
  const parts = text.trim().split(/[-/.]/);
  if (parts.length !== 3) throw new ValidationError(`Not a date: "${text}"`);
  const [a = '', b = '', c = ''] = parts;
  const [y, m, d] = order === 'YMD' ? [a, b, c] : order === 'DMY' ? [c, b, a] : [c, a, b];
  try {
    return makeDate(Number(y), Number(m), Number(d));
  } catch {
    throw new ValidationError(`Not a valid ${order} date: "${text}"`);
  }
}

/** Infer DMY vs MDY vs YMD from a set of date strings. Ambiguous sets default to MDY (YNAB's US default). */
export function detectDateOrder(samples: readonly string[]): DateOrder {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const s of samples) {
    const parts = s.trim().split(/[-/.]/);
    if ((parts[0] ?? '').length === 4) return 'YMD';
    if (Number(parts[0]) > 12) firstOver12 = true;
    if (Number(parts[1]) > 12) secondOver12 = true;
  }
  if (firstOver12 && !secondOver12) return 'DMY';
  return 'MDY';
}

/** Infer the decimal separator from amount samples ("1.234,56" → ','). */
export function detectNumberFormat(samples: readonly string[]): NumberFormat {
  for (const s of samples) {
    const m = /[.,](\d+)\D*$/.exec(s.trim());
    if (m) return { decimalSeparator: m[0].startsWith(',') && (m[1] ?? '').length !== 3 ? ',' : '.' };
  }
  return { decimalSeparator: '.' };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Dec 2021" / "December 2021" → "2021-12". */
export function parsePlanMonth(text: string): Month {
  const m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(text.trim());
  const index = m ? MONTHS.indexOf((m[1] ?? '').toLowerCase()) : -1;
  if (!m || index < 0) throw new ValidationError(`Not a plan month: "${text}"`);
  return makeMonth(Number(m[2]), index + 1);
}

export interface YnabPlanRow {
  month: Month;
  /** "Group: Category", YNAB's unique key for a category. */
  key: string;
  group: string;
  category: string;
  assigned: Minor;
  activity: Minor;
  available: Minor;
}

export type YnabCleared = 'cleared' | 'uncleared' | 'reconciled';

export interface YnabRegisterRow {
  account: string;
  flag: string;
  date: ISODate;
  payee: string;
  /** "Group: Category", or "" when uncategorized. */
  key: string;
  group: string;
  category: string;
  memo: string;
  /** Inflow − Outflow, signed minor units. */
  amount: Minor;
  cleared: YnabCleared;
}

export interface ParseOptions {
  decimals?: number;
  dateOrder?: DateOrder;
  numberFormat?: NumberFormat;
}

function table(text: string): { header: string[]; rows: string[][] } {
  const newline = text.indexOf('\n');
  const firstLine = newline < 0 ? text : text.slice(0, newline);
  const delimiter = firstLine.includes('\t') && !firstLine.includes('","') ? '\t' : ',';
  const all = parseDelimited(text, delimiter);
  const header = all[0];
  if (!header) throw new ValidationError('Empty export file');
  return { header: header.map((h) => h.trim()), rows: all.slice(1) };
}

function columns(header: string[], wanted: readonly string[], file: string): number[] {
  return wanted.map((w) => {
    const i = header.indexOf(w);
    if (i < 0) throw new ValidationError(`${file} is missing column "${w}" (has: ${header.join(', ')})`);
    return i;
  });
}

const PLAN_COLUMNS = ['Month', 'Category Group/Category', 'Category Group', 'Category', 'Assigned', 'Activity', 'Available'];
const REGISTER_COLUMNS = ['Account', 'Flag', 'Date', 'Payee', 'Category Group/Category', 'Category Group', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared'];

export function parseYnabPlan(text: string, options: ParseOptions = {}): YnabPlanRow[] {
  const { header, rows } = table(text);
  // Older exports call the Assigned column "Budgeted".
  const h = header.map((x) => (x === 'Budgeted' ? 'Assigned' : x));
  const [iMonth, iKey, iGroup, iCat, iAsg, iAct, iAvail] = columns(h, PLAN_COLUMNS, 'Plan.csv');
  const decimals = options.decimals ?? 2;
  const format = options.numberFormat ?? detectNumberFormat(rows.slice(0, 50).map((r) => r[iAvail ?? 0] ?? ''));
  return rows.map((r) => {
    const get = (i: number | undefined) => r[i ?? -1] ?? '';
    return {
      month: parsePlanMonth(get(iMonth)),
      key: get(iKey),
      group: get(iGroup),
      category: get(iCat),
      assigned: parseAmount(get(iAsg), format, decimals),
      activity: parseAmount(get(iAct), format, decimals),
      available: parseAmount(get(iAvail), format, decimals),
    };
  });
}

export function parseYnabRegister(text: string, options: ParseOptions = {}): YnabRegisterRow[] {
  const { header, rows } = table(text);
  const [iAcct, iFlag, iDate, iPayee, iKey, iGroup, iCat, iMemo, iOut, iIn, iCleared] = columns(header, REGISTER_COLUMNS, 'Register.csv');
  const decimals = options.decimals ?? 2;
  const get = (r: string[], i: number | undefined) => r[i ?? -1] ?? '';
  const order = options.dateOrder ?? detectDateOrder(rows.map((r) => get(r, iDate)));
  const format = options.numberFormat ?? detectNumberFormat(rows.slice(0, 50).map((r) => get(r, iOut)));
  return rows.map((r) => {
    const cleared = get(r, iCleared).toLowerCase();
    return {
      account: get(r, iAcct),
      flag: get(r, iFlag),
      date: parseDate(get(r, iDate), order),
      payee: get(r, iPayee),
      key: get(r, iKey),
      group: get(r, iGroup),
      category: get(r, iCat),
      memo: get(r, iMemo),
      amount: parseAmountPair(get(r, iIn), get(r, iOut), format, decimals),
      cleared: cleared === 'reconciled' ? 'reconciled' : cleared === 'uncleared' ? 'uncleared' : 'cleared',
    };
  });
}

function parseAmountPair(inflow: string, outflow: string, format: NumberFormat, decimals: number): Minor {
  const i = parseAmount(inflow || '0', format, decimals);
  const o = parseAmount(outflow || '0', format, decimals);
  return minor(i - o);
}
