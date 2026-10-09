// QIF import (S6.5): records end with "^"; D date (Quicken writes 10/ 1'26 for 2026), T or U
// amount, P payee, M memo, N check number. Category (L) and split (S/E/$) lines are ignored:
// YNAB doesn't set categories or splits on file import.
import { ValidationError } from '../errors.ts';
import { parseAmount, type DateOrder } from '../ynab/csv.ts';
import { parseBankDate } from './csv.ts';
import type { BankRow } from './types.ts';

function qifDate(text: string, order: DateOrder): BankRow['date'] {
  // 10/ 1'26 → 10/1/26; 10/01/2026 stays.
  const t = text.replace(/\s+/g, '').replace("'", '/');
  return parseBankDate(t, order);
}

export function parseQif(text: string, order: DateOrder, decimals: number): BankRow[] {
  const rows: BankRow[] = [];
  let rec: Record<string, string> = {};
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const flush = () => {
    if (rec.D === undefined && rec.T === undefined) {
      rec = {};
      return;
    }
    if (rec.D === undefined || rec.T === undefined) throw new ValidationError('A QIF record is missing its date or amount');
    const amountText = rec.T;
    const decimalComma = amountText.includes(',') && !/\.\d+$/.test(amountText) && /,\d{1,2}$/.test(amountText);
    rows.push({
      date: qifDate(rec.D, order),
      amount: parseAmount(amountText, { decimalSeparator: decimalComma ? ',' : '.' }, decimals),
      payee: rec.P ?? '',
      memo: rec.M ?? '',
      ...(rec.N === undefined || rec.N === '' ? {} : { checkNumber: rec.N }),
    });
    rec = {};
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === '' || line.startsWith('!')) continue;
    if (line === '^') {
      flush();
      continue;
    }
    const code = line.charAt(0);
    const value = line.slice(1).trim();
    if (code === 'U' && rec.T !== undefined) continue;
    const key = code === 'U' ? 'T' : code;
    if (['D', 'T', 'P', 'M', 'N'].includes(key) && rec[key] === undefined) rec[key] = value;
  }
  flush();
  if (rows.length === 0) throw new ValidationError('No transactions in this file');
  return rows;
}
