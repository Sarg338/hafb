// Test-only snapshot tweaks for the S1.7 report tests (groups and payees the PlanBuilder lacks).
import type { BudgetSnapshot, CategoryGroup, Id } from '../src/model.ts';

/** Move categories into named groups (unlisted categories keep their group). */
export function regroup(snapshot: BudgetSnapshot, groups: { id: Id; name: string; categories: Id[] }[]): BudgetSnapshot {
  const groupOf = new Map<Id, Id>();
  for (const g of groups) for (const c of g.categories) groupOf.set(c, g.id);
  const extra: CategoryGroup[] = groups.map((g) => ({ id: g.id, name: g.name }));
  return {
    ...snapshot,
    categoryGroups: [...snapshot.categoryGroups, ...extra],
    categories: snapshot.categories.map((c) => ({ ...c, groupId: groupOf.get(c.id) ?? c.groupId })),
  };
}

/** Give the first transaction matching each (date, amount) a payee id. */
export function withPayees(snapshot: BudgetSnapshot, rules: { date: string; amount: number; payeeId: Id }[]): BudgetSnapshot {
  const used = new Set<number>();
  const transactions = snapshot.transactions.map((t) => ({ ...t }));
  for (const rule of rules) {
    const i = transactions.findIndex((t, idx) => !used.has(idx) && t.date === rule.date && t.amount === rule.amount);
    const tx = transactions[i];
    if (!tx) throw new Error(`no transaction ${rule.date} ${String(rule.amount)}`);
    used.add(i);
    tx.payeeId = rule.payeeId;
  }
  return { ...snapshot, transactions };
}
