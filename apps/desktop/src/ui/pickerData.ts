// Adapters from a plan to picker groups. Screens call these; the pickers themselves stay
// presentational (plain options in, an id out). Amounts come from the engine via planBudget.
import { CREDIT_CARD_INTEREST, READY_TO_ASSIGN, type Id } from '@hafb/engine';
import { ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import { planBudget, type PlanData } from '@hafb/store';
import type { ComboGroup, ComboOption } from './comboModel.ts';

export const TRANSFER_GROUP_ID = 'transfers';
export const SPLIT_ID = '__split__';
const TRANSFER_PREFIX = 'Transfer : ';

/** "Payments & Transfers" (one transfer payee per open account), then saved payees A–Z. */
/** Hidden payees (Manage Payees) aren't offered, except `keep` (the row's current payee). */
export function payeeGroups(plan: PlanData, options: { excludeAccountId?: Id; keep?: Id | null } = {}): ComboGroup[] {
  const open = new Map(plan.accounts.filter((a) => a.deletedAt === undefined && a.closed !== true).map((a) => [a.id, a]));
  const live = plan.payees.filter((p) => p.deletedAt === undefined);
  const transfers: ComboOption[] = live
    .filter((p) => p.transferAccountId !== undefined && open.has(p.transferAccountId) && p.transferAccountId !== options.excludeAccountId)
    .map((p) => {
      const account = open.get(p.transferAccountId ?? '');
      return { id: p.id, label: p.name, keywords: account ? [account.name] : [] };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const saved: ComboOption[] = live
    .filter((p) => p.transferAccountId === undefined && !p.name.startsWith(TRANSFER_PREFIX) && (p.hidden !== true || p.id === options.keep))
    .map((p) => ({ id: p.id, label: p.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [
    { id: TRANSFER_GROUP_ID, label: 'Payments & Transfers', options: transfers },
    { id: 'saved', label: 'Saved Payees', options: saved },
  ];
}

export interface CategoryPickerData {
  groups: ComboGroup[];
  /** Available this month per category id (and Ready to Assign's amount under READY_TO_ASSIGN). */
  available: ReadonlyMap<string, Minor>;
}

/**
 * Inflow (Ready to Assign) first, then the plan's visible groups and categories in order. Credit
 * card payment categories aren't offered: money reaches them by spending on the card.
 */
export function categoryPickerData(plan: PlanData, month: Month, today: ISODate, options: { allowSplit?: boolean; creditCardInterest?: boolean } = {}): CategoryPickerData {
  const state = planBudget(plan, { today, throughMonth: month });
  const ms = state.byMonth[month];
  const available = new Map<string, Minor>();
  available.set(READY_TO_ASSIGN, ms?.readyToAssign ?? ZERO);
  const groups: ComboGroup[] = [{ id: 'inflow', label: 'Inflow', options: [{ id: READY_TO_ASSIGN, label: 'Ready to Assign' }] }];
  // YNAB's Credit Card Interest (S7.6, behind a preference): only offered on a card's transactions.
  if (options.creditCardInterest === true) groups.push({ id: 'interest', label: 'Credit Card Interest', options: [{ id: CREDIT_CARD_INTEREST, label: 'Credit Card Interest', keywords: ['interest'] }] });
  const visibleGroups = plan.categoryGroups
    .filter((g) => g.deletedAt === undefined && g.hidden !== true && g.systemKind === undefined)
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
  for (const g of visibleGroups) {
    const cats = plan.categories
      .filter((c) => c.groupId === g.id && c.deletedAt === undefined && c.hidden !== true && c.creditCardAccountId === undefined)
      .toSorted((a, b) => a.sortOrder - b.sortOrder);
    if (cats.length === 0) continue;
    for (const c of cats) available.set(c.id, ms?.categories[c.id]?.available ?? ZERO);
    groups.push({ id: g.id, label: g.name, options: cats.map((c) => ({ id: c.id, label: c.name, keywords: [g.name] })) });
  }
  if (options.allowSplit === true) groups.push({ id: 'split', label: 'Split', options: [{ id: SPLIT_ID, label: 'Split (multiple categories)' }] });
  return { groups, available };
}
