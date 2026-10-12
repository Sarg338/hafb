// The YNAB import's account-type step (S8.5). YNAB's export has no account types, so the importer
// works them out (ynab/toSnapshot.ts): a card from its Credit Card Payments category, checking for
// anything categorized, and asset or liability for the rest. The user can correct them here, but
// only within the same kind of account, so the plan's numbers stay exactly YNAB's: a cash account
// stays a cash type, a card a credit type, and an off-budget account a loan or tracking type.
import type { AccountType, InferredAccount } from '@hafb/engine';

const CASH: readonly AccountType[] = ['checking', 'savings', 'cash'];
const CREDIT: readonly AccountType[] = ['creditCard', 'lineOfCredit'];
const OFF_BUDGET: readonly AccountType[] = ['mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt', 'otherDebt', 'asset', 'liability'];

/** The types an imported account may take. */
export function typeChoices(a: Pick<InferredAccount, 'type' | 'onBudget'>): readonly AccountType[] {
  if (!a.onBudget) return OFF_BUDGET;
  return CREDIT.includes(a.type) ? CREDIT : CASH;
}

/** Only the types the user changed: the rest keep the importer's reason in the report. */
export function changedTypes(accounts: readonly InferredAccount[], chosen: Readonly<Record<string, AccountType>>): Record<string, AccountType> {
  const out: Record<string, AccountType> = {};
  for (const a of accounts) {
    const t = chosen[a.name];
    if (t !== undefined && t !== a.type && typeChoices(a).includes(t)) out[a.name] = t;
  }
  return out;
}
