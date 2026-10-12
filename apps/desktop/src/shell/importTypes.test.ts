import { describe, expect, it } from 'vitest';
import { importYnabExport, planBudget } from '@hafb/store';
import { changedTypes, typeChoices } from './importTypes.ts';

// A small export: a categorized checking account, a card, and an off-budget mortgage.
const PLAN = [
  '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"',
  '"Oct 2026","Bills: Rent","Bills","Rent","$1000.00","-$1000.00","$0.00"',
  '"Oct 2026","Credit Card Payments: Visa","Credit Card Payments","Visa","$0.00","$0.00","$0.00"',
].join('\n');
const REGISTER = [
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
  '"Bank","","10/02/2026","Landlord","Bills: Rent","Bills","Rent","","$1000.00","$0.00","Cleared"',
  '"Bank","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","$0.00","$3000.00","Cleared"',
  '"House","","10/01/2026","Starting Balance","","","","","$200000.00","$0.00","Cleared"',
].join('\n');
const options = () => {
  let n = 0;
  return { today: '2026-10-08' as const, now: '2026-10-08T12:00:00.000Z', newId: () => `id-${String((n += 1))}`, planName: 'Test' };
};

describe('YNAB import: choosing account types', () => {
  const { report } = importYnabExport({ planCsv: PLAN, registerCsv: REGISTER }, options());
  const byName = (name: string) => report.accounts.find((a) => a.name === name) ?? { name, type: 'checking' as const, onBudget: true, reason: '' };

  it('offers only types of the same kind, so the numbers stay YNAB’s', () => {
    expect(typeChoices(byName('Bank'))).toEqual(['checking', 'savings', 'cash']);
    expect(typeChoices(byName('Visa'))).toEqual(['creditCard', 'lineOfCredit']);
    expect(typeChoices(byName('House'))).toEqual(['mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt', 'otherDebt', 'asset', 'liability']);
  });

  it('passes on only real changes, and a changed type leaves every number as it was', () => {
    const chosen = changedTypes(report.accounts, { Bank: 'savings', Visa: 'creditCard', House: 'mortgage', Nope: 'cash' });
    expect(chosen).toEqual({ Bank: 'savings', House: 'mortgage' });
    expect(changedTypes(report.accounts, { Bank: 'mortgage' })).toEqual({});
    const plain = importYnabExport({ planCsv: PLAN, registerCsv: REGISTER }, options()).plan;
    const typed = importYnabExport({ planCsv: PLAN, registerCsv: REGISTER }, { ...options(), accountTypes: chosen }).plan;
    expect(Object.fromEntries(typed.accounts.map((a) => [a.name, a.type]))).toEqual({ Bank: 'savings', Visa: 'creditCard', House: 'mortgage' });
    const today = '2026-10-08' as const;
    const a = planBudget(plain, { today });
    const b = planBudget(typed, { today });
    expect(b.months).toEqual(a.months);
    expect(Object.values(b.accountBalances)).toEqual(Object.values(a.accountBalances));
  });
});
