// Account commands (CLAUDE.md §4 Account, §5.3, §6.3).
import { CASH_ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES, isCreditAccountType, READY_TO_ASSIGN, ValidationError, type AccountType, type Id } from '@hafb/engine';
import { minor, type ISODate, type Minor } from '@hafb/shared';
import type { AccountRecord, CategoryGroupRecord, LoanDetails, PlanData } from '../records.ts';
import { Draft, liveAccount, nextSortOrder, requireName, type Command, type CommandContext, omit } from './context.ts';
import { CREDIT_CARD_PAYMENTS_GROUP_NAME } from './plan.ts';
import { payeeByName, STARTING_BALANCE_PAYEE, transferPayee, transferPayeeName } from './payees.ts';

/** Cash and Credit accounts are on-budget; Loans and Tracking are not (§4). */
export function isOnBudgetType(type: AccountType): boolean {
  return CASH_ACCOUNT_TYPES.includes(type) || CREDIT_ACCOUNT_TYPES.includes(type);
}

/** The Credit Card Payments group, created on demand (imported plans may not have one). */
export function creditCardPaymentsGroup(d: Draft, ctx: CommandContext): CategoryGroupRecord {
  const groups = d.all('categoryGroups');
  const found = groups.find((g) => g.systemKind === 'creditCardPayments' && g.deletedAt === undefined);
  if (found) return found;
  let min = 0;
  for (const g of groups) if (g.deletedAt === undefined && g.sortOrder < min) min = g.sortOrder;
  const group: CategoryGroupRecord = { id: ctx.newId(), name: CREDIT_CARD_PAYMENTS_GROUP_NAME, sortOrder: min - 1, systemKind: 'creditCardPayments' };
  d.put('categoryGroups', group);
  return group;
}

export interface CreateAccountArgs {
  name: string;
  type: AccountType;
  /** Today's balance; negative for a card or loan you owe on. */
  startingBalance: Minor;
  /** Date of the starting balance; defaults to today. */
  date?: ISODate;
  note?: string;
  loan?: LoanDetails;
}

/**
 * Add an account: its transfer payee, a payment category for credit accounts (§5.3), and a
 * "Starting Balance" transaction, even when it is $0 (§5.14): Ready to Assign for cash accounts
 * and a card's credit; none for a card's debt (it shows as underfunded) and off-budget accounts.
 */
export function createAccount(plan: PlanData, ctx: CommandContext, args: CreateAccountArgs): Command & { accountId: Id } {
  const d = new Draft(plan);
  const name = requireName(args.name, 'Account');
  const onBudget = isOnBudgetType(args.type);
  const id = ctx.newId();
  const account: AccountRecord = {
    id,
    name,
    type: args.type,
    onBudget,
    ...(args.note === undefined || args.note === '' ? {} : { note: args.note }),
    sortOrder: nextSortOrder(d.all('accounts')),
    ...(args.loan === undefined || Object.keys(args.loan).length === 0 ? {} : { loan: args.loan }),
    createdAt: ctx.now,
  };
  d.put('accounts', account);
  d.put('payees', { id: ctx.newId(), name: transferPayeeName(name), transferAccountId: id });

  if (onBudget && isCreditAccountType(args.type)) {
    const group = creditCardPaymentsGroup(d, ctx);
    d.put('categories', {
      id: ctx.newId(),
      groupId: group.id,
      name,
      sortOrder: nextSortOrder(d.all('categories').filter((c) => c.groupId === group.id)),
      creditCardAccountId: id,
    });
  }

  const payee = payeeByName(d, ctx, STARTING_BALANCE_PAYEE);
  d.put('transactions', {
    id: ctx.newId(),
    accountId: id,
    date: args.date ?? ctx.today,
    amount: minor(args.startingBalance),
    payeeId: payee.id,
    // A card's debt is "Category not needed": it stays off Ready to Assign (YNAB trial, 2026-10-08).
    categoryId: onBudget && !(isCreditAccountType(args.type) && args.startingBalance < 0) ? READY_TO_ASSIGN : null,
    cleared: 'cleared',
    isStartingBalance: true,
    createdAt: ctx.now,
  });
  return { label: `Add account: ${name}`, changes: d.build(), accountId: id };
}

export interface EditAccountArgs {
  accountId: Id;
  name?: string;
  /** null clears the note. */
  note?: string | null;
  starred?: boolean;
  /** null clears the loan details. */
  loan?: LoanDetails | null;
}

/** Rename (also renames the transfer payee and the payment category), note, star, loan details. */
export function editAccount(plan: PlanData, _ctx: CommandContext, args: EditAccountArgs): Command {
  const d = new Draft(plan);
  const a = liveAccount(d, args.accountId);
  const base = omit(a, 'note', 'starred', 'loan');
  const name = args.name === undefined ? a.name : requireName(args.name, 'Account');
  const note = args.note === undefined ? a.note : args.note ?? undefined;
  const starred = args.starred ?? a.starred ?? false;
  const loan = args.loan === undefined ? a.loan : args.loan ?? undefined;
  d.put('accounts', {
    ...base,
    name,
    ...(note === undefined || note === '' ? {} : { note }),
    ...(starred ? { starred: true } : {}),
    ...(loan === undefined || Object.keys(loan).length === 0 ? {} : { loan }),
  });
  if (name !== a.name) {
    const payee = transferPayee(d, a.id);
    d.put('payees', { ...payee, name: transferPayeeName(name) });
    for (const c of d.all('categories')) {
      if (c.creditCardAccountId === a.id && c.deletedAt === undefined) d.put('categories', { ...c, name });
    }
  }
  return { label: `Edit account: ${a.name}`, changes: d.build() };
}

/** Working balance: every live transaction in the account. */
export function accountBalance(d: Draft, accountId: Id): Minor {
  let total = 0;
  for (const t of d.all('transactions')) if (t.accountId === accountId && t.deletedAt === undefined) total += t.amount;
  return minor(total);
}

/** The payee YNAB uses when you type a new working balance (verified in the YNAB trial, 2026-10-08). */
export const MANUAL_BALANCE_ADJUSTMENT_PAYEE = 'Manual Balance Adjustment';

/** Add a cleared, today-dated adjustment so the account's working balance becomes `target`. */
function addAdjustment(d: Draft, ctx: CommandContext, a: AccountRecord, target: Minor): void {
  const delta = target - accountBalance(d, a.id);
  if (delta === 0) return;
  const payee = payeeByName(d, ctx, MANUAL_BALANCE_ADJUSTMENT_PAYEE);
  d.put('transactions', {
    id: ctx.newId(),
    accountId: a.id,
    date: ctx.today,
    amount: minor(delta),
    payeeId: payee.id,
    categoryId: a.onBudget ? READY_TO_ASSIGN : null,
    cleared: 'cleared',
    createdAt: ctx.now,
  });
}

/**
 * Edit Account → Working Balance (YNAB): a "Manual Balance Adjustment" transaction, cleared and dated
 * today, categorized to Ready to Assign on budget accounts (uncategorized on loans and tracking).
 */
export function adjustBalance(plan: PlanData, ctx: CommandContext, args: { accountId: Id; workingBalance: Minor }): Command {
  const d = new Draft(plan);
  const a = liveAccount(d, args.accountId);
  addAdjustment(d, ctx, a, args.workingBalance);
  return { label: `Adjust balance: ${a.name}`, changes: d.build() };
}

/**
 * Close an account. With a balance, YNAB warns that it will be zeroed out with an adjustment
 * transaction: pass `zeroOut` once the user has agreed; without it a balance is refused.
 */
export function closeAccount(plan: PlanData, ctx: CommandContext, args: { accountId: Id; zeroOut?: boolean }): Command {
  const d = new Draft(plan);
  const a = liveAccount(d, args.accountId);
  if (a.closed) throw new ValidationError(`${a.name} is already closed`);
  if (accountBalance(d, a.id) !== 0) {
    if (args.zeroOut !== true) throw new ValidationError(`${a.name} must have a zero balance before it can be closed`);
    addAdjustment(d, ctx, a, minor(0));
  }
  // A closed loan's paired category becomes unpaired (YNAB, Loan Accounts guide).
  const loan = a.loan?.pairedCategoryId === undefined ? {} : { loan: omit(a.loan, 'pairedCategoryId') };
  d.put('accounts', { ...a, closed: true, ...loan });
  return { label: `Close account: ${a.name}`, changes: d.build() };
}

export function reopenAccount(plan: PlanData, _ctx: CommandContext, args: { accountId: Id }): Command {
  const d = new Draft(plan);
  const a = liveAccount(d, args.accountId);
  if (!a.closed) throw new ValidationError(`${a.name} is not closed`);
  const rest = omit(a, 'closed');
  d.put('accounts', rest);
  return { label: `Reopen account: ${a.name}`, changes: d.build() };
}

/** Set the sidebar order: `accountIds` is the full new order (sort order = position). */
export function reorderAccounts(plan: PlanData, _ctx: CommandContext, args: { accountIds: readonly Id[] }): Command {
  const d = new Draft(plan);
  args.accountIds.forEach((id, i) => {
    const a = liveAccount(d, id);
    if (a.sortOrder !== i) d.put('accounts', { ...a, sortOrder: i });
  });
  return { label: 'Reorder accounts', changes: d.build() };
}
