// Accounts (S4.4): the account types as YNAB groups them, how a typed balance becomes a signed
// starting balance, interest rates, and sidebar reordering. Pure.
import { CASH_ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES, LOAN_ACCOUNT_TYPES, TRACKING_ACCOUNT_TYPES, type AccountType, type Id } from '@hafb/engine';
import { minor, neg, parseDecimal, type Minor } from '@hafb/shared';
import type { AccountRecord, PlanData } from '@hafb/store';

export type AccountSection = 'cash' | 'credit' | 'loans' | 'tracking';

export interface TypeInfo {
  type: AccountType;
  label: string;
  section: AccountSection;
}

/** YNAB's "Select Account Type" list, in its order (observed in the YNAB trial, 2026-10-08). */
export const ACCOUNT_TYPES: readonly TypeInfo[] = [
  { type: 'checking', label: 'Checking', section: 'cash' },
  { type: 'savings', label: 'Savings', section: 'cash' },
  { type: 'cash', label: 'Cash', section: 'cash' },
  { type: 'creditCard', label: 'Credit Card', section: 'credit' },
  { type: 'lineOfCredit', label: 'Line of Credit', section: 'credit' },
  { type: 'mortgage', label: 'Mortgage', section: 'loans' },
  { type: 'autoLoan', label: 'Auto Loan', section: 'loans' },
  { type: 'studentLoan', label: 'Student Loan', section: 'loans' },
  { type: 'personalLoan', label: 'Personal Loan', section: 'loans' },
  { type: 'medicalDebt', label: 'Medical Debt', section: 'loans' },
  { type: 'otherDebt', label: 'Other Debt', section: 'loans' },
  { type: 'asset', label: 'Asset (e.g. Investment)', section: 'tracking' },
  { type: 'liability', label: 'Liability', section: 'tracking' },
];

export const SECTION_INFO: Record<AccountSection, { title: string; blurb: string }> = {
  cash: { title: 'Cash Accounts', blurb: 'Money you already have and can spend right away.' },
  credit: { title: 'Credit Accounts', blurb: 'Borrowed money you spend now and pay back later, often with interest.' },
  loans: { title: 'Mortgages and Loans', blurb: "Balances you're paying off and don't spend from." },
  tracking: { title: 'Tracking Accounts', blurb: "Money you don't plan to spend soon, like investments. They don't affect your plan." },
};

export function typeInfo(type: AccountType): TypeInfo {
  return ACCOUNT_TYPES.find((t) => t.type === type) ?? { type, label: type, section: 'cash' };
}

export function sectionOf(type: AccountType): AccountSection {
  if (CASH_ACCOUNT_TYPES.includes(type)) return 'cash';
  if (CREDIT_ACCOUNT_TYPES.includes(type)) return 'credit';
  if (LOAN_ACCOUNT_TYPES.includes(type)) return 'loans';
  if (TRACKING_ACCOUNT_TYPES.includes(type)) return 'tracking';
  return 'cash';
}

/** Cards, loans and liabilities are owed: the form asks for the amount owed, stored as negative. */
export function isDebtType(type: AccountType): boolean {
  return CREDIT_ACCOUNT_TYPES.includes(type) || LOAN_ACCOUNT_TYPES.includes(type) || type === 'liability';
}

export const isLoanType = (type: AccountType): boolean => LOAN_ACCOUNT_TYPES.includes(type);

/** The account's balance from what the person typed (an amount owed is positive in the form). */
export function signedBalance(type: AccountType, entered: Minor): Minor {
  return isDebtType(type) ? neg(entered) : entered;
}

/** What the form shows for a stored balance (owed amounts as positive). */
export function enteredBalance(type: AccountType, balance: Minor): Minor {
  return isDebtType(type) ? neg(balance) : balance;
}

/** "6.25" → 625 basis points (exact; no floats). Null for anything that isn't a percentage. */
export function parseRate(text: string): number | null {
  const t = text.trim().replace(/%$/, '').trim();
  if (t === '') return null;
  try {
    const bps = parseDecimal(t, 2);
    return bps < 0 ? null : bps;
  } catch {
    return null;
  }
}

/** 625 → "6.25". */
export function formatRate(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(Math.abs(bps % 100)).padStart(2, '0');
  return `${String(whole)}.${frac}`;
}

/** Accounts in sidebar order (open first is the caller's business). */
export function orderedAccounts(plan: PlanData): AccountRecord[] {
  return plan.accounts.filter((a) => a.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
}

/** The full new order after moving an account before/after another (sidebar drag). */
export function moveAccount(plan: PlanData, accountId: Id, targetId: Id, position: 'before' | 'after'): Id[] | null {
  if (accountId === targetId) return null;
  const order = orderedAccounts(plan).map((a) => a.id);
  if (!order.includes(accountId) || !order.includes(targetId)) return null;
  const rest = order.filter((id) => id !== accountId);
  const at = rest.indexOf(targetId);
  rest.splice(position === 'before' ? at : at + 1, 0, accountId);
  return rest.join() === order.join() ? null : rest;
}

/** Move up/down within the account's sidebar section (keyboard and menu). */
export function stepAccount(plan: PlanData, accountId: Id, dir: -1 | 1): Id[] | null {
  const all = orderedAccounts(plan);
  const me = all.find((a) => a.id === accountId);
  if (!me) return null;
  const peers = all.filter((a) => sectionOf(a.type) === sectionOf(me.type) && (a.closed === true) === (me.closed === true));
  const i = peers.findIndex((a) => a.id === accountId);
  const neighbour = peers[i + dir];
  return neighbour ? moveAccount(plan, accountId, neighbour.id, dir < 0 ? 'before' : 'after') : null;
}

export const ZERO_BALANCE = minor(0);
