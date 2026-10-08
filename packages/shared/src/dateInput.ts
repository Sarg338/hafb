// Date fields: formatting in the plan's date format, forgiving parsing of what people type, and
// single-key date shortcuts. Pure; dates are ISODate strings (never `new Date()`).
//
// PARITY: the key set below is the Quicken-style set many finance apps use. YNAB's exact date-field
// keys must be verified against YNAB before Phase 4 ships the register (docs/ynab-parity.md).
import { addDays, addMonthsToDate, daysInMonth, isISODate, makeDate, dateParts, type ISODate } from './dates.ts';

type Part = 'Y' | 'M' | 'D';

/** Field order of a format like 'MM/DD/YYYY' → ['M', 'D', 'Y']. */
function order(format: string): Part[] {
  const out: Part[] = [];
  for (const m of format.toUpperCase().matchAll(/Y+|M+|D+/g)) {
    const p = m[0].charAt(0);
    if (p === 'Y' || p === 'M' || p === 'D') out.push(p);
  }
  return out.length === 3 ? out : ['M', 'D', 'Y'];
}

/** Format an ISO date in the plan's format: 'MM/DD/YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD', … */
export function formatDate(date: ISODate, format: string): string {
  const { year, month, day } = dateParts(date);
  return format
    .replace(/YYYY/, String(year).padStart(4, '0'))
    .replace(/MM/, String(month).padStart(2, '0'))
    .replace(/DD/, String(day).padStart(2, '0'));
}

function validDate(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const date = makeDate(year, month, day);
  return isISODate(date) ? date : null;
}

/**
 * Parse what someone typed, in the plan's field order. Accepts a full date, a two-digit year
 * (→ 20xx), month and day without a year (this year), or a day alone (this month).
 */
export function parseDateInput(text: string, format: string, today: ISODate): ISODate | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}([/\-.\s]+\d{1,4}){0,2}$/.test(trimmed)) return null;
  const nums = trimmed.split(/[/\-.\s]+/).map(Number);
  const t = dateParts(today);
  if (nums.length === 1) return validDate(t.year, t.month, nums[0] ?? 0);
  const fields = order(format);
  const values: Partial<Record<Part, number>> = {};
  const raw: Partial<Record<Part, string>> = {};
  const parts = trimmed.split(/[/\-.\s]+/);
  const used = nums.length === 2 ? fields.filter((f) => f !== 'Y') : fields;
  used.forEach((f, i) => {
    const n = nums[i];
    const p = parts[i];
    if (n !== undefined && p !== undefined) {
      values[f] = n;
      raw[f] = p;
    }
  });
  let year = t.year;
  if (values.Y !== undefined) {
    const len = raw.Y?.length ?? 0;
    if (len === 2) year = 2000 + values.Y;
    else if (len === 4) year = values.Y;
    else return null;
  }
  return validDate(year, values.M ?? 0, values.D ?? 0);
}

export interface DateKey {
  key: string;
  description: string;
}

/** The single keys a date field understands (shown in the shortcut overlay). */
export const DATE_KEYS: readonly DateKey[] = [
  { key: '+', description: 'Next day' },
  { key: '=', description: 'Next day' },
  { key: '-', description: 'Previous day' },
  { key: 'PageDown', description: 'Next month' },
  { key: 'PageUp', description: 'Previous month' },
  { key: 't', description: 'Today' },
  { key: 'm', description: 'First day of the month' },
  { key: 'h', description: 'Last day of the month' },
  { key: 'y', description: 'First day of the year' },
  { key: 'r', description: 'Last day of the year' },
];

/** The date a key moves to, or null when the key isn't a date shortcut. */
export function dateKey(date: ISODate, key: string, today: ISODate): ISODate | null {
  const { year, month } = dateParts(date);
  switch (key.length === 1 ? key.toLowerCase() : key) {
    case '+':
    case '=':
      return addDays(date, 1);
    case '-':
      return addDays(date, -1);
    case 'PageDown':
      return addMonthsToDate(date, 1);
    case 'PageUp':
      return addMonthsToDate(date, -1);
    case 't':
      return today;
    case 'm':
      return makeDate(year, month, 1);
    case 'h':
      return makeDate(year, month, daysInMonth(year, month));
    case 'y':
      return makeDate(year, 1, 1);
    case 'r':
      return makeDate(year, 12, 31);
    default:
      return null;
  }
}
