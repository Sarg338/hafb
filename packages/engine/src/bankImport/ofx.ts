// OFX / QFX import (S6.5): OFX 1.x (SGML, where leaf tags have no closing tag) and OFX 2.x (XML),
// bank (STMTRS) and card (CCSTMTRS) statements. Each STMTTRN gives the date (DTPOSTED), signed
// amount (TRNAMT), FITID, NAME or PAYEE, MEMO and CHECKNUM. Amounts go straight to minor units.
import { makeDate } from '@hafb/shared';
import { ValidationError } from '../errors.ts';
import { parseAmount } from '../ynab/csv.ts';
import type { BankRow } from './types.ts';

export interface OfxResult {
  rows: BankRow[];
  /** ACCTID of the statement (shown in the import preview). */
  accountId?: string;
  currency?: string;
}

function decode(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&')
    .trim();
}

function ofxDate(text: string): BankRow['date'] {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(text.trim());
  if (!m) throw new ValidationError(`Not an OFX date: "${text}"`);
  return makeDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Parse every transaction in an OFX/QFX file (SGML or XML). */
export function parseOfx(text: string, decimals: number): OfxResult {
  const start = text.search(/<OFX>/i);
  const body = start >= 0 ? text.slice(start) : text;
  const tag = /<(\/?)([A-Za-z0-9.]+)>([^<]*)/g;
  const rows: BankRow[] = [];
  let accountId: string | undefined;
  let currency: string | undefined;
  let current: Record<string, string> | null = null;
  for (let m = tag.exec(body); m !== null; m = tag.exec(body)) {
    const closing = m[1] === '/';
    const name = (m[2] ?? '').toUpperCase();
    const value = decode(m[3] ?? '');
    if (name === 'STMTTRN') {
      if (!closing) {
        current = {};
      } else if (current) {
        rows.push(toRow(current, decimals));
        current = null;
      }
      continue;
    }
    if (closing) continue;
    if (current) {
      // A PAYEE aggregate holds its own NAME; the first NAME wins either way.
      if (value !== '' && current[name] === undefined) current[name] = value;
      continue;
    }
    if (name === 'ACCTID' && value !== '' && accountId === undefined) accountId = value;
    if (name === 'CURDEF' && value !== '' && currency === undefined) currency = value;
  }
  // SGML files may leave the last STMTTRN unclosed before </BANKTRANLIST>.
  if (current?.TRNAMT !== undefined) rows.push(toRow(current, decimals));
  if (rows.length === 0) throw new ValidationError('No transactions in this file');
  return { rows, ...(accountId === undefined ? {} : { accountId }), ...(currency === undefined ? {} : { currency }) };
}

function toRow(t: Record<string, string>, decimals: number): BankRow {
  const amountText = t.TRNAMT ?? '';
  const decimalComma = amountText.includes(',') && !amountText.includes('.');
  const amount = parseAmount(amountText, { decimalSeparator: decimalComma ? ',' : '.' }, decimals);
  const payee = t.NAME ?? t.PAYEE ?? t.MEMO ?? '';
  const memo = t.NAME !== undefined || t.PAYEE !== undefined ? (t.MEMO ?? '') : '';
  return {
    date: ofxDate(t.DTPOSTED ?? t.DTUSER ?? ''),
    amount,
    payee,
    memo,
    ...(t.FITID === undefined ? {} : { importId: t.FITID }),
    ...(t.CHECKNUM === undefined ? {} : { checkNumber: t.CHECKNUM }),
  };
}
