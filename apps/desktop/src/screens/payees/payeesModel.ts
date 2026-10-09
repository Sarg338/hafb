// Manage Payees (S5.5), as YNAB lays it out (trial, 2026-10-08): the payee list on the left in
// three groups (Payees, Hidden Payees, Transfer Payees), the selection's details on the right.
// Pure: plan records in, display data out.
import { READY_TO_ASSIGN, type Id, type RenameMatch } from '@hafb/engine';
import type { PayeeRecord, PayeeRenameRuleRecord, PlanData } from '@hafb/store';

export interface PayeeItem {
  id: Id;
  name: string;
  /** Transactions (and split lines) that use it. */
  uses: number;
  transfer: boolean;
  hidden: boolean;
}

export interface PayeeLists {
  payees: PayeeItem[];
  hidden: PayeeItem[];
  transfers: PayeeItem[];
}

const byName = (a: PayeeItem, b: PayeeItem): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** How many live transactions (counting split lines) use each payee. */
export function payeeUses(plan: PlanData): Map<Id, number> {
  const uses = new Map<Id, number>();
  const add = (id: Id | undefined): void => {
    if (id !== undefined) uses.set(id, (uses.get(id) ?? 0) + 1);
  };
  for (const t of plan.transactions) {
    if (t.deletedAt !== undefined) continue;
    add(t.payeeId);
    for (const s of t.subtransactions ?? []) if (s.payeeId !== t.payeeId) add(s.payeeId);
  }
  return uses;
}

/** The manager's three groups, by name; a search keeps names containing it (case-insensitive). */
export function payeeLists(plan: PlanData, search = ''): PayeeLists {
  const uses = payeeUses(plan);
  const q = search.trim().toLocaleLowerCase();
  const items = plan.payees
    .filter((p) => p.deletedAt === undefined && (q === '' || p.name.toLocaleLowerCase().includes(q)))
    .map((p): PayeeItem => ({ id: p.id, name: p.name, uses: uses.get(p.id) ?? 0, transfer: p.transferAccountId !== undefined, hidden: p.hidden === true }));
  return {
    payees: items.filter((p) => !p.transfer && !p.hidden).sort(byName),
    hidden: items.filter((p) => !p.transfer && p.hidden).sort(byName),
    transfers: items.filter((p) => p.transfer).sort(byName),
  };
}

/** YNAB's three categorization choices. */
export type CategorizeMode = 'auto' | 'fixed' | 'off';

export function categorizeMode(p: PayeeRecord): CategorizeMode {
  if (p.autoCategorize === false) return 'off';
  return p.defaultCategoryFixed === true ? 'fixed' : 'auto';
}

/** The default category's name ("Inflow: Ready to Assign" for income), or null. */
export function defaultCategoryName(plan: PlanData, p: PayeeRecord): string | null {
  const id = p.defaultCategoryId;
  if (id === undefined || id === null) return null;
  if (id === READY_TO_ASSIGN) return 'Inflow: Ready to Assign';
  const c = plan.categories.find((x) => x.id === id);
  if (!c) return null;
  const g = plan.categoryGroups.find((x) => x.id === c.groupId);
  return g ? `${g.name}: ${c.name}` : c.name;
}

/** The setPayeeDefaults arguments for a mode (switching to "fixed" keeps the current default). */
export function modeArgs(p: PayeeRecord, mode: CategorizeMode): { fixed: boolean; autoCategorize: boolean } {
  return mode === 'off' ? { fixed: p.defaultCategoryFixed === true, autoCategorize: false } : { fixed: mode === 'fixed', autoCategorize: true };
}

export function rulesFor(plan: PlanData, payeeId: Id): PayeeRenameRuleRecord[] {
  return plan.payeeRenameRules.filter((r) => r.targetPayeeId === payeeId).toSorted((a, b) => a.sortOrder - b.sortOrder);
}

export const RENAME_MATCHES: readonly { id: RenameMatch; label: string }[] = [
  { id: 'contains', label: 'Contains' },
  { id: 'startsWith', label: 'Starts with' },
  { id: 'equals', label: 'Is' },
];

/**
 * Combine and Rename (YNAB): the selection becomes one payee with the typed name. The payee that
 * already has that name (case-insensitive) is kept, else the first selected; the rest merge into it.
 */
export function combinePlan(plan: PlanData, ids: readonly Id[], name: string): { targetId: Id; sourceIds: Id[]; rename: string | null } | null {
  const picked = ids.map((id) => plan.payees.find((p) => p.id === id)).filter((p): p is PayeeRecord => p !== undefined && p.deletedAt === undefined && p.transferAccountId === undefined);
  const first = picked[0];
  if (!first || picked.length < 2 || name.trim() === '') return null;
  const clean = name.trim();
  const target = picked.find((p) => p.name.toLocaleLowerCase() === clean.toLocaleLowerCase()) ?? first;
  return { targetId: target.id, sourceIds: picked.filter((p) => p.id !== target.id).map((p) => p.id), rename: target.name === clean ? null : clean };
}
