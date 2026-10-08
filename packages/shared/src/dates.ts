/**
 * Dates are plain strings in the plan's local calendar: `YYYY-MM-DD` and `YYYY-MM`.
 * No time zones and never `new Date(...)`: all math is done on integer day numbers
 * (days since 1970-01-01 in the proleptic Gregorian calendar).
 */
export type ISODate = `${number}-${number}-${number}`;
export type Month = `${number}-${number}`;

const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Shape and calendar check (rejects 2026-02-30). */
export function isISODate(value: string): value is ISODate {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  return Number(m[3]) <= daysInMonth(Number(m[1]), Number(m[2]));
}

export function isMonth(value: string): value is Month {
  return MONTH.test(value);
}

export function asISODate(value: string): ISODate {
  if (!isISODate(value)) throw new RangeError(`Not a valid YYYY-MM-DD date: "${value}"`);
  return value;
}

export function asMonth(value: string): Month {
  if (!isMonth(value)) throw new RangeError(`Not a valid YYYY-MM month: "${value}"`);
  return value;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function dateParts(date: ISODate): DateParts {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

export function makeDate(year: number, month: number, day: number): ISODate {
  return asISODate(`${pad4(year)}-${pad2(month)}-${pad2(day)}`);
}

export function makeMonth(year: number, month: number): Month {
  return asMonth(`${pad4(year)}-${pad2(month)}`);
}

export function monthOf(date: ISODate): Month {
  return asMonth(date.slice(0, 7));
}

export function monthParts(month: Month): { year: number; month: number } {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

/** Months are zero-padded, so string comparison is chronological. */
export function compareMonths(a: Month, b: Month): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addMonths(month: Month, n: number): Month {
  const { year, month: m } = monthParts(month);
  const index = year * 12 + (m - 1) + n;
  return makeMonth(Math.floor(index / 12), (index % 12) + 1);
}

/** Number of months from `a` to `b` (b − a). */
export function monthsBetween(a: Month, b: Month): number {
  const pa = monthParts(a);
  const pb = monthParts(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

/** Inclusive list of months from `from` to `to`. Empty when `to` < `from`. */
export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; compareMonths(m, to) <= 0; m = addMonths(m, 1)) {
    out.push(m);
  }
  return out;
}

export function firstDayOfMonth(month: Month): ISODate {
  const { year, month: m } = monthParts(month);
  return makeDate(year, m, 1);
}

export function lastDayOfMonth(month: Month): ISODate {
  const { year, month: m } = monthParts(month);
  return makeDate(year, m, daysInMonth(year, m));
}

/** Day `day` of `month`, clamped to the month's last day (31 → 30/28/29). */
export function clampedDate(month: Month, day: number): ISODate {
  const { year, month: m } = monthParts(month);
  return makeDate(year, m, Math.min(Math.max(day, 1), daysInMonth(year, m)));
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function toDayNumber(date: ISODate): number {
  const { year, month, day } = dateParts(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of toDayNumber (civil_from_days). */
export function fromDayNumber(dayNumber: number): ISODate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return makeDate(year, month, day);
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromDayNumber(toDayNumber(date) + n);
}

/** b − a in days. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: ISODate): number {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

/**
 * Add calendar months to a date, keeping the anchor day where possible and clamping to the
 * target month's last day (Jan 31 + 1 month → Feb 28/29).
 */
export function addMonthsToDate(date: ISODate, n: number, anchorDay?: number): ISODate {
  const { day } = dateParts(date);
  return clampedDate(addMonths(monthOf(date), n), anchorDay ?? day);
}
