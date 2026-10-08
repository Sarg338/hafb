import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addMonthsToDate,
  asISODate,
  clampedDate,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  firstDayOfMonth,
  fromDayNumber,
  isISODate,
  isMonth,
  lastDayOfMonth,
  makeDate,
  monthOf,
  monthRange,
  monthsBetween,
  toDayNumber,
  type ISODate,
} from '../src/dates.ts';

const d = asISODate;

describe('validation', () => {
  it('checks shape and calendar validity', () => {
    expect(isISODate('2026-10-08')).toBe(true);
    expect(isISODate('2024-02-29')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('1900-02-29')).toBe(false);
    expect(isISODate('2000-02-29')).toBe(true);
    expect(isISODate('2026-04-31')).toBe(false);
    expect(isISODate('2026-1-08')).toBe(false);
    expect(isMonth('2026-12')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
  });
});

describe('day numbers', () => {
  it('anchors on the epoch and round-trips every day 1900–2100 against a day-by-day calendar walk', () => {
    expect(toDayNumber(d('1970-01-01'))).toBe(0);
    let year = 1900;
    let month = 1;
    let day = 1;
    let n = toDayNumber(d('1900-01-01'));
    while (year <= 2100) {
      const date = makeDate(year, month, day);
      expect(toDayNumber(date)).toBe(n);
      expect(fromDayNumber(n)).toBe(date);
      n += 1;
      day += 1;
      if (day > daysInMonth(year, month)) {
        day = 1;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }
  });

  it('computes weekday, day arithmetic and differences', () => {
    expect(dayOfWeek(d('1970-01-01'))).toBe(4); // Thursday
    expect(dayOfWeek(d('2026-10-08'))).toBe(4); // Thursday
    expect(dayOfWeek(d('2000-01-01'))).toBe(6); // Saturday
    expect(dayOfWeek(d('1969-12-28'))).toBe(0); // Sunday, before epoch
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
    expect(daysBetween(d('2026-01-01'), d('2026-12-31'))).toBe(364);
  });
});

describe('months', () => {
  it('adds months across years and measures distance', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', -13)).toBe('2024-12');
    expect(monthsBetween('2025-11', '2027-02')).toBe(15);
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-02', '2026-01')).toEqual([]);
    expect(monthOf(d('2026-10-08'))).toBe('2026-10');
  });

  it('finds month edges and clamps days', () => {
    expect(firstDayOfMonth('2026-02')).toBe('2026-02-01');
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
    expect(clampedDate('2026-04', 31)).toBe('2026-04-30');
    expect(clampedDate('2026-04', 0)).toBe('2026-04-01');
  });

  it('adds months to dates keeping the anchor day (31st → last day, then back to 31st)', () => {
    const jan31: ISODate = d('2026-01-31');
    expect(addMonthsToDate(jan31, 1)).toBe('2026-02-28');
    expect(addMonthsToDate(jan31, 2)).toBe('2026-03-31');
    expect(addMonthsToDate(d('2026-02-28'), 1, 31)).toBe('2026-03-31');
    expect(addMonthsToDate(d('2024-02-29'), 12)).toBe('2025-02-28');
  });
});
