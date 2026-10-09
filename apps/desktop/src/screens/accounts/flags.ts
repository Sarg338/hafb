// YNAB's six flags, their custom names (CLAUDE.md §6.4), and Shift+F then 0–6 (0 clears).
import type { FlagColor } from '@hafb/engine';
import type { PlanData } from '@hafb/store';

export const FLAG_COLORS: readonly FlagColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

const LABEL: Record<FlagColor, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' };

/** The flag's name: the plan's custom name, else its colour. */
export function flagName(plan: PlanData, color: FlagColor): string {
  return plan.flagNames.find((f) => f.color === color)?.name ?? LABEL[color];
}

export const colorLabel = (color: FlagColor): string => LABEL[color];

/** The digit after Shift+F: 1–6 pick a colour in YNAB's order, 0 clears; anything else is no flag key. */
export function flagForDigit(key: string): FlagColor | null | undefined {
  if (key === '0') return null;
  const i = Number(key);
  return Number.isInteger(i) && i >= 1 && i <= 6 ? FLAG_COLORS[i - 1] : undefined;
}
