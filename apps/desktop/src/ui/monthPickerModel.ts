// Month picker keyboard model (S4.1): pure month arithmetic for the 3×4 month grid.
import { addMonths, compareMonths, type Month } from '@hafb/shared';

export function clampMonth(m: Month, min: Month, max: Month): Month {
  if (compareMonths(m, min) < 0) return min;
  if (compareMonths(m, max) > 0) return max;
  return m;
}

/** Where a key moves the focused month (rows of three), or null when the key isn't a move. */
export function monthPickerKey(active: Month, key: string, min: Month, max: Month): Month | null {
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 };
  const n = step[key];
  if (n !== undefined) return clampMonth(addMonths(active, n), min, max);
  if (key === 'Home') return clampMonth(addMonths(active, -((Number(active.slice(5)) - 1) % 3)), min, max);
  if (key === 'End') return clampMonth(addMonths(active, 2 - ((Number(active.slice(5)) - 1) % 3)), min, max);
  return null;
}

/** The plan's navigable months: from its first month to a year past today or its last assignment. */
export function planMonthBounds(firstMonth: Month, current: Month, lastAssigned: Month | null): { min: Month; max: Month } {
  const ahead = addMonths(current, 12);
  const max = lastAssigned !== null && compareMonths(lastAssigned, ahead) > 0 ? lastAssigned : ahead;
  return { min: compareMonths(firstMonth, current) <= 0 ? firstMonth : current, max };
}
