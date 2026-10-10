// What the engine computes on (ADR 0002 §5): live records only, memoized per PlanData identity.
// Every change produces a new PlanData, so these caches invalidate themselves.
import { budgetThrough, computeBudget, type BudgetSnapshot, type BudgetState } from '@hafb/engine';
import { addMonths, compareMonths, monthOf, type ISODate, type Month } from '@hafb/shared';
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

/**
 * computeBudget on the plan's snapshot, cached per plan and options (S8.1). One computation runs
 * through next month; the plain state, this month's and next month's are exact cuts of it
 * (`budgetThrough`), so the sidebar, the plan and the inspector's next month cost one computation
 * per edit. Other ranges compute on their own.
 */
export function planBudget(plan: PlanData, options: { today: ISODate; throughMonth?: Month }): BudgetState {
  let byOptions = states.get(plan);
  if (!byOptions) {
    byOptions = new Map();
    states.set(plan, byOptions);
  }
  const { today, throughMonth } = options;
  const exact = (key: string, through: Month | undefined): BudgetState => {
    let state = byOptions.get(key);
    if (!state) {
      state = computeBudget(budgetSnapshot(plan), through === undefined ? { today } : { today, throughMonth: through });
      byOptions.set(key, state);
    }
    return state;
  };
  const ahead = addMonths(monthOf(today), 1);
  const wide = exact(`${today}|${ahead}`, ahead);
  // Next month must not have moved the start (a plan whose first month is later than that).
  const start = wide.months[0];
  if (start === undefined || compareMonths(start, ahead) >= 0) return exact(`${today}|${throughMonth ?? ''}`, throughMonth);
  if (throughMonth !== undefined && compareMonths(throughMonth, start) < 0) return exact(`${today}|${throughMonth}`, throughMonth);
  const cut = throughMonth === undefined || compareMonths(throughMonth, wide.dataThrough) <= 0 ? wide.dataThrough : throughMonth;
  const key = `${today}|${cut}`;
  let state = byOptions.get(key);
  if (!state) {
    state = budgetThrough(wide, cut) ?? computeBudget(budgetSnapshot(plan), { today, throughMonth: cut });
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
