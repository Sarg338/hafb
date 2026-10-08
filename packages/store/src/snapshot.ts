// What the engine computes on (ADR 0002 §5): live records only, memoized per PlanData identity.
// Every change produces a new PlanData, so these caches invalidate themselves.
import { computeBudget, type BudgetSnapshot, type BudgetState } from '@hafb/engine';
import type { ISODate, Month } from '@hafb/shared';
import type { PayeeRecord, PlanData, ScheduledTransactionRecord } from './records.ts';

const snapshots = new WeakMap<PlanData, BudgetSnapshot>();

export function budgetSnapshot(plan: PlanData): BudgetSnapshot {
  let snapshot = snapshots.get(plan);
  if (!snapshot) {
    const accounts = plan.accounts.filter((a) => a.deletedAt === undefined);
    const accountIds = new Set(accounts.map((a) => a.id));
    snapshot = {
      settings: {
        currencyDecimals: plan.settings.currencyDecimals,
        ...(plan.settings.firstMonth === undefined ? {} : { firstMonth: plan.settings.firstMonth }),
      },
      accounts,
      categoryGroups: plan.categoryGroups.filter((g) => g.deletedAt === undefined),
      categories: plan.categories.filter((c) => c.deletedAt === undefined),
      transactions: plan.transactions.filter((t) => t.deletedAt === undefined && accountIds.has(t.accountId)),
      assignments: plan.assignments,
    };
    snapshots.set(plan, snapshot);
  }
  return snapshot;
}

const states = new WeakMap<PlanData, Map<string, BudgetState>>();

/** computeBudget on the plan's snapshot, cached per plan and options. */
export function planBudget(plan: PlanData, options: { today: ISODate; throughMonth?: Month }): BudgetState {
  let byOptions = states.get(plan);
  if (!byOptions) {
    byOptions = new Map();
    states.set(plan, byOptions);
  }
  const key = `${options.today}|${options.throughMonth ?? ''}`;
  let state = byOptions.get(key);
  if (!state) {
    state = computeBudget(budgetSnapshot(plan), options);
    byOptions.set(key, state);
  }
  return state;
}

export function livePayees(plan: PlanData): PayeeRecord[] {
  return plan.payees.filter((p) => p.deletedAt === undefined);
}

export function liveScheduled(plan: PlanData): ScheduledTransactionRecord[] {
  return plan.scheduled.filter((s) => s.deletedAt === undefined);
}
