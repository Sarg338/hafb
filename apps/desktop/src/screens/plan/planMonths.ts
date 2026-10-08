// Which months the Plan screen can show: the plan's first month through a year ahead (or its last
// assignment, if later). Deep links and saved routes outside that range land on the nearest end.
import { monthOf, type ISODate, type Month } from '@hafb/shared';
import type { PlanData } from '@hafb/store';
import { clampMonth, planMonthBounds } from '../../ui/monthPickerModel.ts';

export function planBounds(plan: PlanData, today: ISODate): { min: Month; max: Month } {
  const current = monthOf(today);
  let last: Month | null = null;
  for (const a of plan.assignments) if (a.assigned !== 0 && (last === null || a.month > last)) last = a.month;
  return planMonthBounds(plan.settings.firstMonth ?? current, current, last);
}

export function shownMonth(plan: PlanData, today: ISODate, wanted: Month): Month {
  const { min, max } = planBounds(plan, today);
  return clampMonth(wanted, min, max);
}
