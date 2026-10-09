// Delimited-text exports in YNAB's own format (observed in the trial's exports, 2026-10-09):
// UTF-8 with a BOM, CRLF line ends and no line end after the last row, every text field quoted,
// numbers bare. Currencies that use a decimal comma export tab-separated text instead
// (https://support.ynab.com/en_us/how-to-export-reflection-data-Bykou09). Money is written from
// integer minor units; it never passes through a float.
import { abs, formatDate, inputSeparators, numberFormatSeparators, type ISODate, type Minor } from '@hafb/shared';
import type { PlanSettings } from '../records.ts';

/** A cell: text is quoted; a `{ n }` number is written bare. */
export type Cell = string | { n: string };

export type Delimiter = ',' | '\t';

export interface DelimitedFile {
  delimiter: Delimiter;
  /** 'csv' or 'tsv', for the file name. */
  extension: 'csv' | 'tsv';
}

/** CSV, or TSV when the plan's number format uses a decimal comma (which a CSV can't hold bare). */
export function delimitedFor(settings: Pick<PlanSettings, 'numberFormat'>): DelimitedFile {
  return numberFormatSeparators(settings.numberFormat).decimal === ',' ? { delimiter: '\t', extension: 'tsv' } : { delimiter: ',', extension: 'csv' };
}

function quote(text: string, delimiter: Delimiter): string {
  // A tab inside a TSV field would split it; Excel reads quoted fields in both formats.
  const clean = delimiter === '\t' ? text.replace(/\t/g, ' ') : text;
  return `"${clean.replace(/"/g, '""')}"`;
}

/** The file's text, BOM first (Excel needs it to read UTF-8). */
export function encodeTable(rows: readonly (readonly Cell[])[], delimiter: Delimiter): string {
  const lines = rows.map((row) => row.map((c) => (typeof c === 'string' ? quote(c, delimiter) : c.n)).join(delimiter));
  return `\uFEFF${lines.join('\r\n')}`;
}

/** A bare number in the plan's decimal separator, no grouping: "-1200.00" or "-1200,00". */
export function exportNumber(amount: Minor, settings: Pick<PlanSettings, 'currencyDecimals' | 'numberFormat'>): { n: string } {
  const { decimal } = inputSeparators(settings.numberFormat);
  const decimals = settings.currencyDecimals;
  const digits = String(Math.abs(amount)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const text = decimals > 0 ? `${whole}${decimal}${digits.slice(digits.length - decimals)}` : whole;
  return { n: amount < 0 ? `-${text}` : text };
}

/** Money with the plan's symbol and no grouping, as YNAB writes Outflow/Inflow: "$1200.00", "-$5.00". */
export function exportMoney(amount: Minor, settings: Pick<PlanSettings, 'currencyDecimals' | 'numberFormat' | 'currencySymbol' | 'symbolPlacement'>): Cell {
  const number = exportNumber(abs(amount), settings).n;
  const symbol = settings.currencySymbol;
  const spaced = /\p{L}$/u.test(symbol);
  let text = number;
  if (settings.symbolPlacement === 'before' && symbol !== '') text = symbol + (spaced ? ' ' : '') + number;
  if (settings.symbolPlacement === 'after' && symbol !== '') text = `${number}${symbol}`;
  return { n: amount < 0 ? `-${text}` : text };
}

export function exportDate(date: ISODate, settings: Pick<PlanSettings, 'dateFormat'>): string {
  return formatDate(date, settings.dateFormat);
}

/** "Plan name - Spending Breakdown - 2026-10-09": no characters Windows refuses in file names. */
export function exportFileName(parts: readonly string[], extension: string): string {
  const base = parts
    .map((p) => p.replace(/[\\/:*?"<>|]/g, '-').trim())
    .filter((p) => p !== '')
    .join(' - ');
  return `${base === '' ? 'export' : base}.${extension}`;
}
