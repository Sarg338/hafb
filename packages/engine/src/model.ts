// Engine input model: the subset of CLAUDE.md §4 the budget math needs. Plain, serializable data.
import type { ISODate, Minor, Month } from '@hafb/shared';

export type Id = string;

/** Category reference for "Inflow: Ready to Assign". */
export const READY_TO_ASSIGN = 'ready-to-assign' as const;
/**
 * Category reference for YNAB's "Credit Card Interest" (rolling out Oct 2026; behind a flag in the
 * app). Only on credit accounts: the interest stays out of the plan, like a card's starting debt, and
 * the payment category shows it as debt to cover (budget-math §3.15).
 */
export const CREDIT_CARD_INTEREST = 'credit-card-interest' as const;
/** Pseudo-category the engine uses for on-budget money with no category (YNAB's "Uncategorized"). */
export const UNCATEGORIZED = 'uncategorized' as const;

/** A category id, `READY_TO_ASSIGN`, or null for uncategorized. */
export type CategoryRef = Id | null;

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'creditCard'
  | 'lineOfCredit'
  | 'mortgage'
  | 'autoLoan'
  | 'studentLoan'
  | 'personalLoan'
  | 'medicalDebt'
  | 'otherDebt'
  | 'asset'
  | 'liability';

export const CASH_ACCOUNT_TYPES: readonly AccountType[] = ['checking', 'savings', 'cash'];
export const CREDIT_ACCOUNT_TYPES: readonly AccountType[] = ['creditCard', 'lineOfCredit'];
export const LOAN_ACCOUNT_TYPES: readonly AccountType[] = [
  'mortgage',
  'autoLoan',
  'studentLoan',
  'personalLoan',
  'medicalDebt',
  'otherDebt',
];
export const TRACKING_ACCOUNT_TYPES: readonly AccountType[] = ['asset', 'liability'];

export interface Account {
  id: Id;
  name: string;
  type: AccountType;
  /** Cash and Credit accounts are on-budget; Loans and Tracking are not (CLAUDE.md §4). */
  onBudget: boolean;
  closed?: boolean;
}

export interface CategoryGroup {
  id: Id;
  name: string;
  hidden?: boolean;
}

export interface Category {
  id: Id;
  groupId: Id;
  name: string;
  hidden?: boolean;
  /** Set only on credit card payment categories (one per on-budget credit account). */
  creditCardAccountId?: Id;
}

export type ClearedState = 'uncleared' | 'cleared' | 'reconciled';

export interface Subtransaction {
  id: Id;
  amount: Minor;
  categoryId: CategoryRef;
  transferAccountId?: Id;
  memo?: string;
}

export interface Transaction {
  id: Id;
  accountId: Id;
  date: ISODate;
  /** Signed minor units; negative = outflow. For a split, the sum of its subtransactions. */
  amount: Minor;
  categoryId: CategoryRef;
  /** Set on both legs of a transfer: the account on the other side. */
  transferAccountId?: Id;
  cleared: ClearedState;
  approved?: boolean;
  payeeId?: Id;
  memo?: string;
  subtransactions?: readonly Subtransaction[];
  /** The account's opening balance (YNAB payee "Starting Balance"); excluded from income and Age of Money. */
  isStartingBalance?: boolean;
  deleted?: boolean;
}

/** The only user-entered plan number (CLAUDE.md §4 MonthCategory). */
export interface Assignment {
  month: Month;
  categoryId: Id;
  assigned: Minor;
}

export interface BudgetSettings {
  currencyDecimals: number;
  /** First month of the plan; defaults to the earliest month with data. */
  firstMonth?: Month;
}

export interface BudgetSnapshot {
  settings: BudgetSettings;
  accounts: readonly Account[];
  categoryGroups: readonly CategoryGroup[];
  categories: readonly Category[];
  transactions: readonly Transaction[];
  assignments: readonly Assignment[];
}

export function isCreditAccountType(type: AccountType): boolean {
  return CREDIT_ACCOUNT_TYPES.includes(type);
}
