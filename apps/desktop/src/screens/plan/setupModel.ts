// The "Get started" checklist (S7.5), pure. Each step is read from the plan itself, so the list
// resumes wherever the user left off, across restarts, with nothing extra stored in the file.
import type { PlanData } from '@hafb/store';

export type SetupStepId = 'accounts' | 'categories' | 'assign' | 'target' | 'transaction';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  detail: string;
  done: boolean;
}

export function setupChecklist(plan: PlanData): SetupStep[] {
  const live = (x: { deletedAt?: string }): boolean => x.deletedAt === undefined;
  const systemGroups = new Set(plan.categoryGroups.filter((g) => g.systemKind !== undefined).map((g) => g.id));
  return [
    { id: 'accounts', title: 'Add your accounts', detail: 'Checking, savings, cards: start with the balances you have today.', done: plan.accounts.some(live) },
    {
      id: 'categories',
      title: 'Set up your categories',
      detail: 'The jobs your money does: bills, groceries, goals. A template is a quick start.',
      done: plan.categories.some((c) => live(c) && c.creditCardAccountId === undefined && !systemGroups.has(c.groupId)),
    },
    { id: 'assign', title: 'Assign your money', detail: 'Give every dollar in Ready to Assign a job.', done: plan.assignments.some((a) => a.assigned !== 0) },
    { id: 'target', title: 'Add a target', detail: 'Tell a category what it needs, and the plan keeps track for you.', done: plan.targets.length > 0 },
    {
      id: 'transaction',
      title: 'Record or import a transaction',
      detail: 'Enter spending as it happens, or import a file from your bank.',
      done: plan.transactions.some((t) => live(t) && t.isStartingBalance !== true),
    },
  ];
}
