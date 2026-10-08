// The Auto-Assign choices with their live amounts (CLAUDE.md §5.5), for the Ready to Assign
// banner's Assign menu and the inspector. Amounts come from the engine's autoAssign.
import { autoAssign, limitToReadyToAssign, type AutoAssignOption, type Id, type PlanChange } from '@hafb/engine';
import type { PlanModel } from './planModel.ts';

export const ASSIGN_OPTIONS: readonly { id: AutoAssignOption; label: string; group: number; selectionOnly?: boolean }[] = [
  { id: 'underfunded', label: 'Underfunded', group: 0 },
  { id: 'assignedLastMonth', label: 'Assigned Last Month', group: 1 },
  { id: 'spentLastMonth', label: 'Spent Last Month', group: 1 },
  { id: 'averageAssigned', label: 'Average Assigned', group: 1 },
  { id: 'averageSpent', label: 'Average Spent', group: 1 },
  { id: 'reduceOverfunding', label: 'Reduce Overfunding', group: 2 },
  { id: 'resetAvailable', label: 'Reset Available Amounts', group: 2, selectionOnly: true },
  { id: 'resetAssigned', label: 'Reset Assigned Amounts', group: 2, selectionOnly: true },
];

export interface AssignChoice {
  id: AutoAssignOption;
  label: string;
  group: number;
  /** What the option would assign, shown before committing. */
  change: PlanChange;
  /** What committing applies: Underfunded stops when Ready to Assign runs out (§5.5). */
  commit: PlanChange;
}

export function assignChoices(model: PlanModel, categoryIds: readonly Id[], scope: 'all' | 'selection'): AssignChoice[] {
  const input = {
    state: model.state,
    month: model.month,
    categoryIds,
    targets: [...model.targets.values()],
    evaluated: model.evaluated,
    paymentCategoryIds: model.paymentIds,
  };
  return ASSIGN_OPTIONS.filter((o) => scope === 'selection' || o.selectionOnly !== true).map((o) => {
    const change = autoAssign(o.id, input);
    const commit = o.id === 'underfunded' ? limitToReadyToAssign(change, model.ms.readyToAssign) : change;
    return { id: o.id, label: o.label, group: o.group, change, commit };
  });
}
