// Loan accounts (CLAUDE.md §5.10, S6.4): the monthly interest, escrow and fee charges, pairing a
// category, and Record Payment. YNAB (https://support.ynab.com/en_us/loan-accounts-in-ynab-a-guide-HkNSkPHJi):
// YNAB calculates the monthly interest charge and applies it automatically; past and current
// charges can be edited; escrow is handled the same way; a paired category is used only for its
// loan's payments and enables Record Payment; closing a loan unpairs its category.
//
// ASSUMPTIONS (budget-math §10.4): each month's charges are posted on the 1st, interest on the
// balance at the end of the previous month (the engine's amortization rule); the first charges
// come the month after the loan's first transaction (or from `chargesFrom`, set on loans imported
// from YNAB, migration 0007); a charge the user deleted is never posted
// again. YNAB's first posting in the trial (after 2026-11-01) will confirm the date and amount.
import { monthlyInterest, READY_TO_ASSIGN, ValidationError, type Id } from '@hafb/engine';
import { addMonths, compareDates, compareMonths, firstDayOfMonth, minor, monthOf, neg, type ISODate, type Minor, type Month } from '@hafb/shared';
import type { AccountRecord, PlanData, TransactionRecord } from '../records.ts';
import { Draft, liveAccount, liveCategory, omit, type Command, type CommandContext } from './context.ts';
import { payeeByName } from './payees.ts';
import { addTransaction } from './transactions.ts';

export const LOAN_TYPES = ['mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt', 'otherDebt'] as const;

export function isLoanAccount(a: Pick<AccountRecord, 'type'>): boolean {
  return LOAN_TYPES.some((t) => t === a.type);
}

/** Charge kinds, their payee name and the import id that marks a month as posted. */
const CHARGES = [
  { kind: 'interest', payee: 'Interest' },
  { kind: 'escrow', payee: 'Escrow' },
  { kind: 'fees', payee: 'Fees' },
] as const;

export const loanChargeId = (kind: (typeof CHARGES)[number]['kind'], month: Month): string => `loan-${kind}:${month}`;

/** A loan's transactions so far (deleted ones too: they mark months already handled). */
function loanTransactions(d: Draft, accountId: Id): TransactionRecord[] {
  return d.all('transactions').filter((t) => t.accountId === accountId);
}

function balanceBefore(txs: readonly TransactionRecord[], date: ISODate): number {
  let b = 0;
  for (const t of txs) if (t.deletedAt === undefined && compareDates(t.date, date) < 0) b += t.amount;
  return b;
}

/**
 * Post every loan's interest, escrow and fees for each month from the one after its first
 * transaction through this month, on the 1st. Returns null when nothing is due (run on open and
 * when the day changes, like due scheduled transactions).
 */
export function postLoanCharges(plan: PlanData, ctx: CommandContext): Command | null {
  const d = new Draft(plan);
  const thisMonth = monthOf(ctx.today);
  let posted = 0;
  for (const a of d.all('accounts')) {
    if (a.deletedAt !== undefined || a.closed === true || !isLoanAccount(a) || !a.loan) continue;
    const loan = a.loan;
    const amounts: Record<(typeof CHARGES)[number]['kind'], (balance: number) => number> = {
      interest: (balance) => (balance < 0 && loan.interestRateBps !== undefined ? monthlyInterest(minor(-balance), loan.interestRateBps) : 0),
      escrow: (balance) => (balance < 0 ? (loan.escrow ?? 0) : 0),
      fees: (balance) => (balance < 0 ? (loan.fees ?? 0) : 0),
    };
    const txs = loanTransactions(d, a.id);
    const live = txs.filter((t) => t.deletedAt === undefined);
    if (live.length === 0) continue;
    const first = live.reduce((m, t) => (compareMonths(monthOf(t.date), m) < 0 ? monthOf(t.date) : m), monthOf(live[0]?.date ?? ctx.today));
    // A loan imported from YNAB starts after the export: its history already holds YNAB's charges.
    const start = loan.chargesFrom !== undefined && compareMonths(loan.chargesFrom, addMonths(first, 1)) > 0 ? loan.chargesFrom : addMonths(first, 1);
    for (let m = start; compareMonths(m, thisMonth) <= 0; m = addMonths(m, 1)) {
      const on = firstDayOfMonth(m);
      const balance = balanceBefore(txs, on);
      for (const c of CHARGES) {
        const importId = loanChargeId(c.kind, m);
        if (txs.some((t) => t.importId === importId)) continue;
        const amount = amounts[c.kind](balance);
        if (amount <= 0) continue;
        const payee = payeeByName(d, ctx, c.payee);
        const t: TransactionRecord = {
          id: ctx.newId(),
          accountId: a.id,
          date: on,
          amount: neg(minor(amount)),
          payeeId: payee.id,
          categoryId: null,
          cleared: 'cleared',
          importId,
          createdAt: ctx.now,
        };
        d.put('transactions', t);
        txs.push(t); // later months' balances include this month's charges
        posted += 1;
      }
    }
  }
  if (posted === 0) return null;
  return { label: 'Post loan interest and charges', changes: d.build() };
}

/** Pair a loan with a category (or unpair with null). A category pairs with one loan at a time. */
export function pairLoanCategory(plan: PlanData, _ctx: CommandContext, args: { accountId: Id; categoryId: Id | null }): Command {
  const d = new Draft(plan);
  const a = liveAccount(d, args.accountId);
  if (!isLoanAccount(a)) throw new ValidationError(`${a.name} isn't a loan account`);
  if (args.categoryId === null) {
    if (a.loan?.pairedCategoryId !== undefined) d.put('accounts', { ...a, loan: omit(a.loan, 'pairedCategoryId') });
    return { label: `Unpair ${a.name}`, changes: d.build() };
  }
  const c = liveCategory(d, args.categoryId);
  if (c.creditCardAccountId !== undefined) throw new ValidationError('A credit card payment category can’t be paired with a loan');
  for (const other of d.all('accounts')) {
    if (other.id !== a.id && other.loan?.pairedCategoryId === c.id) d.put('accounts', { ...other, loan: omit(other.loan, 'pairedCategoryId') });
  }
  d.put('accounts', { ...a, loan: { ...(a.loan ?? {}), pairedCategoryId: c.id } });
  return { label: `Pair ${a.name} with ${c.name}`, changes: d.build() };
}

export interface LoanPaymentArgs {
  loanAccountId: Id;
  /** A cash or credit account the money comes from. */
  fromAccountId: Id;
  /** Positive. */
  amount: Minor;
  date: ISODate;
  memo?: string;
  /** For an unpaired loan; a paired loan always uses its category. */
  categoryId?: Id;
}

/** Record Payment: a transfer from an on-budget account to the loan, categorized to the paired category. */
export function recordLoanPayment(plan: PlanData, ctx: CommandContext, args: LoanPaymentArgs): Command & { transactionId: Id } {
  const d = new Draft(plan);
  const loan = liveAccount(d, args.loanAccountId);
  const from = liveAccount(d, args.fromAccountId);
  if (!isLoanAccount(loan)) throw new ValidationError(`${loan.name} isn't a loan account`);
  if (!from.onBudget) throw new ValidationError('Pay from a cash or credit account');
  if (args.amount <= 0) throw new ValidationError('Enter a payment of more than zero');
  const categoryId = loan.loan?.pairedCategoryId ?? args.categoryId;
  if (categoryId === undefined || categoryId === READY_TO_ASSIGN) throw new ValidationError('Choose the category this payment comes from');
  const cmd = addTransaction(plan, ctx, {
    accountId: from.id,
    date: args.date,
    amount: neg(args.amount),
    transferAccountId: loan.id,
    categoryId,
    ...(args.memo === undefined || args.memo === '' ? {} : { memo: args.memo }),
  });
  return { ...cmd, label: `Record payment: ${loan.name}` };
}
