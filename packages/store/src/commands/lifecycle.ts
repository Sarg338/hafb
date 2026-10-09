// Plan lifecycle (S7.2): category templates, Fresh Start and archiving.
// - Import Category Template (YNAB trial 2026-10-09): the chosen groups and categories go at the
//   bottom; nothing existing changes. An amount becomes "Have a balance of …, Eventually".
// - Fresh Start (§5.14, YNAB trial 2026-10-08/09): a new plan with the open accounts (each restarts
//   with a $0 "Starting Balance" today), category groups, categories, targets, scheduled
//   transactions, payees and expected income; the old plan keeps its history and is renamed
//   "<plan> (Archived on YYYY-MM-DD)".
import { READY_TO_ASSIGN, ValidationError } from '@hafb/engine';
import { minor, monthOf, ZERO, type ISODate } from '@hafb/shared';
import type { PayeeRecord, PlanData, TransactionRecord } from '../records.ts';
import type { CategoryTemplate } from '../templates.ts';
import type { Target } from '@hafb/engine';
import { applyChanges, mergeChangeSets } from '../changes.ts';
import { setTarget } from './categories.ts';
import { Draft, nextSortOrder, omit, requireName, type Command, type CommandContext } from './context.ts';
import { STARTING_BALANCE_PAYEE } from './payees.ts';

/** "Group/Category" names of the template's categories the user deselected. */
export interface ImportTemplateArgs {
  template: CategoryTemplate;
  exclude: readonly string[];
}

export const templateKey = (group: string, category: string): string => `${group}/${category}`;

export function importTemplate(plan: PlanData, ctx: CommandContext, args: ImportTemplateArgs): Command {
  const d = new Draft(plan);
  const skip = new Set(args.exclude);
  const scale = 10 ** plan.settings.currencyDecimals;
  let added = 0;
  for (const group of args.template.groups) {
    const picked = group.categories.filter((c) => !skip.has(templateKey(group.name, c.name)));
    if (picked.length === 0) continue;
    const groupId = ctx.newId();
    d.put('categoryGroups', { id: groupId, name: requireName(group.name, 'Group'), sortOrder: nextSortOrder(d.all('categoryGroups')) });
    picked.forEach((c, i) => {
      const categoryId = ctx.newId();
      d.put('categories', { id: categoryId, groupId, name: requireName(c.name, 'Category'), sortOrder: i });
      if (c.amount !== undefined && c.amount > 0) {
        d.put('targets', {
          categoryId,
          amount: minor(Math.round(c.amount * scale)),
          cadence: { kind: 'custom' },
          behavior: 'haveBalance',
          startMonth: monthOf(ctx.today),
          createdOn: ctx.today,
          updatedAt: ctx.now,
        });
      }
      added += 1;
    });
  }
  if (added === 0) throw new ValidationError('Pick at least one category to import');
  return { label: `Import template: ${args.template.name}`, changes: d.build() };
}

/** Stamp the plan archived and rename it as YNAB does: "<plan> (Archived on YYYY-MM-DD)". */
export function archivePlan(plan: PlanData, ctx: CommandContext, args: { today: ISODate }): Command {
  if (plan.settings.archivedAt !== undefined) throw new ValidationError('This plan is already archived');
  return { label: 'Archive plan', changes: { settings: { ...plan.settings, name: `${plan.settings.name} (Archived on ${args.today})`, archivedAt: ctx.now } } };
}

/** The new plan a Fresh Start creates (a separate file); `plan` itself is left as it is. */
export function freshStartPlan(plan: PlanData, ctx: CommandContext, args: { name: string; today: ISODate }): PlanData {
  const live = <T extends { deletedAt?: string }>(xs: readonly T[]): T[] => xs.filter((x) => x.deletedAt === undefined);
  const accounts = live(plan.accounts)
    .filter((a) => a.closed !== true)
    .map((a) => omit(a, 'lastReconciledAt'));
  const kept = new Set(accounts.map((a) => a.id));
  const payees: PayeeRecord[] = live(plan.payees).filter((p) => p.transferAccountId === undefined || kept.has(p.transferAccountId));
  let starting = payees.find((p) => p.transferAccountId === undefined && p.name === STARTING_BALANCE_PAYEE);
  if (!starting) {
    starting = { id: ctx.newId(), name: STARTING_BALANCE_PAYEE };
    payees.push(starting);
  }
  const startingId = starting.id;
  const transactions: TransactionRecord[] = accounts.map((a) => ({
    id: ctx.newId(),
    accountId: a.id,
    date: args.today,
    amount: ZERO,
    payeeId: startingId,
    categoryId: a.onBudget ? READY_TO_ASSIGN : null,
    cleared: 'cleared',
    isStartingBalance: true,
    createdAt: ctx.now,
  }));
  const settings = omit({ ...plan.settings, name: requireName(args.name, 'Plan'), firstMonth: monthOf(args.today), createdAt: ctx.now }, 'archivedAt');
  const categories = live(plan.categories);
  const categoryIds = new Set(categories.map((c) => c.id));
  return {
    settings,
    accounts,
    categoryGroups: live(plan.categoryGroups),
    categories,
    targets: plan.targets.filter((t) => categoryIds.has(t.categoryId)).map((t) => omit(t, 'snoozedMonths')),
    payees,
    payeeRenameRules: plan.payeeRenameRules,
    scheduled: live(plan.scheduled).filter((s) => kept.has(s.accountId)),
    transactions,
    assignments: [],
    monthNotes: [],
    moneyMoves: [],
    focusedViews: plan.focusedViews,
    flagNames: plan.flagNames,
    reconciliations: [],
    rejectedImports: [],
    importProfiles: plan.importProfiles.filter((p) => kept.has(p.accountId)),
  };
}



/** One target to set, from the post-import re-entry screen (S7.2; YNAB's export has no targets). */
export interface TargetEntry {
  categoryId: string;
  amount: Target['amount'];
  cadence: Target['cadence'];
  behavior: Target['behavior'];
}

/** Set several targets as one undo step. */
export function setTargets(plan: PlanData, ctx: CommandContext, args: { targets: readonly TargetEntry[] }): Command {
  if (args.targets.length === 0) throw new ValidationError('No targets to set');
  let current = plan;
  const sets = args.targets.map((t) => {
    const cmd = setTarget(current, ctx, t);
    current = applyChanges(current, cmd.changes).plan;
    return cmd.changes;
  });
  const n = args.targets.length;
  return { label: n === 1 ? 'Set 1 target' : `Set ${String(n)} targets`, changes: mergeChangeSets(...sets) };
}
