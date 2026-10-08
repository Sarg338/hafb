// Calendar maths for the date picker: the month grid and keyboard moves (WAI-ARIA date grid).
// Weeks start on Sunday for now; a "first day of week" setting is a Phase 7 item.
import { addDays, addMonthsToDate, dayOfWeek, firstDayOfMonth, type ISODate, type Month } from '@hafb/shared';

/** Six weeks of seven days, Sunday first, covering `month`. */
export function monthGrid(month: Month): ISODate[][] {
  const first = firstDayOfMonth(month);
  const start = addDays(first, -dayOfWeek(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/** Where a key moves the focused day, or null when the key isn't a grid move. */
export function calendarKey(date: ISODate, key: string): ISODate | null {
  switch (key) {
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'PageDown':
      return addMonthsToDate(date, 1);
    case 'PageUp':
      return addMonthsToDate(date, -1);
    case 'Home':
      return addDays(date, -dayOfWeek(date));
    case 'End':
      return addDays(date, 6 - dayOfWeek(date));
    default:
      return null;
  }
}
