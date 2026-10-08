/**
 * Dates are plain strings in the budget's local calendar. No time zones, and
 * never `new Date(...)` on these values. Helpers arrive in Phase 1.
 */
export type ISODate = `${number}-${number}-${number}`;
export type Month = `${number}-${number}`;

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Shape check only (YYYY-MM-DD); calendar validity (e.g. Feb 30) is a Phase 1 helper. */
export function isISODate(value: string): value is ISODate {
  return ISO_DATE.test(value);
}

/** Shape check only (YYYY-MM). */
export function isMonth(value: string): value is Month {
  return MONTH.test(value);
}
