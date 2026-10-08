import { computeBudget, monthState, READY_TO_ASSIGN } from '@hafb/engine';
import { describe, expect, it } from 'vitest';
import { canonical, decodePlan, encodePlan } from '../src/codec.ts';
import { exportDateFromName, findExportFiles, importYnabExport, type YnabImportOptions } from '../src/import/ynab.ts';
import { ENTITY_KINDS } from '../src/records.ts';
import { budgetSnapshot } from '../src/snapshot.ts';
import { applyRows, loadTables, openMemoryPlan } from './helpers/sqliteStore.ts';

const PLAN = [
  '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"',
  '"Sep 2026","Credit Card Payments: Visa","Credit Card Payments","Visa",$0.00,$0.00,$0.00',
  '"Sep 2026","Bills: Rent","Bills","Rent",$0.00,$0.00,$0.00',
  '"Sep 2026","Bills: Food","Bills","Food",$0.00,$0.00,$0.00',
  '"Sep 2026","Hidden Categories: Old","Hidden Categories","Old",$0.00,$0.00,$0.00',
  '"Oct 2026","Credit Card Payments: Visa","Credit Card Payments","Visa",$0.00,$30.00,$30.00',
  '"Oct 2026","Bills: Rent","Bills","Rent",$1000.00,-$1000.00,$0.00',
  '"Oct 2026","Bills: Food","Bills","Food",$200.00,-$70.00,$130.00',
  '"Oct 2026","Hidden Categories: Old","Hidden Categories","Old",$0.00,$0.00,$0.00',
].join('\n');

const REGISTER = [
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
  '"Checking","","09/15/2026","Market","Bills: Food","Bills","Food","",$0.00,$0.00,"Cleared"',
  '"Checking","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$3000.00,"Reconciled"',
  '"Checking","Red","10/02/2026","Landlord","Bills: Rent","Bills","Rent","October",$1000.00,$0.00,"Cleared"',
  '"Visa","","10/03/2026","Market","Bills: Food","Bills","Food","",$40.00,$0.00,"Uncleared"',
  '"Checking","Purple","10/04/2026","Market","Bills: Food","Bills","Food","Split (1/2) veg",$30.00,$0.00,"Cleared"',
  '"Checking","Purple","10/04/2026","Transfer : Savings","","","","Split (2/2) save",$50.00,$0.00,"Cleared"',
  '"Savings","","10/04/2026","Transfer : Checking","","","","",$0.00,$50.00,"Cleared"',
  '"Checking","","10/05/2026","Transfer : Visa","","","","",$10.00,$0.00,"Cleared"',
  '"Visa","","10/05/2026","Transfer : Checking","","","","",$0.00,$10.00,"Cleared"',
  '"Checking","","10/06/2026","market","Bills: Food","Bills","Food","",$0.00,$0.00,"Uncleared"',
  '"Checking","","11/01/2026","Landlord","Bills: Rent","Bills","Rent","",$1000.00,$0.00,"Uncleared"',
  '"Checking","","11/02/2026","Transfer : Savings","","","","",$100.00,$0.00,"Uncleared"',
  '"Savings","","11/02/2026","Transfer : Checking","","","","",$0.00,$100.00,"Uncleared"',
].join('\n');

function counterIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `id-${String(n).padStart(4, '0')}`;
  };
}

const options = (): YnabImportOptions => ({
  today: '2026-10-08',
  now: '2026-10-08T12:00:00.000Z',
  newId: counterIds(),
  planName: 'Imported Plan',
});

describe('findExportFiles', () => {
  it('finds Plan.csv and Register.csv by suffix, with the plan name', () => {
    expect(findExportFiles(['x/My Plan as of 2026-10-08 10-55 - Register.csv', 'x/My Plan as of 2026-10-08 10-55 - Plan.csv'])).toEqual({
      planName: 'My Plan',
      planFile: 'x/My Plan as of 2026-10-08 10-55 - Plan.csv',
      registerFile: 'x/My Plan as of 2026-10-08 10-55 - Register.csv',
    });
  });
  it('accepts the older Budget.csv name', () => {
    expect(findExportFiles(['Old as of 2020-01-01 - Budget.csv', 'Old as of 2020-01-01 - Register.csv']).planName).toBe('Old');
  });
  it('explains what is missing', () => {
    expect(() => findExportFiles(['notes.txt'])).toThrow(/Plan\.csv and a Register\.csv/);
  });
  it('reads the export date from the file name', () => {
    expect(exportDateFromName('My Plan as of 2026-10-08 10-55 - Plan.csv')).toBe('2026-10-08');
    expect(exportDateFromName('Plan.csv')).toBeUndefined();
  });
});

describe('importYnabExport (synthetic export)', () => {
  const { plan, report } = importYnabExport({ planCsv: PLAN, registerCsv: REGISTER }, options());
  const acct = (name: string) => plan.accounts.find((a) => a.name === name);
  const payee = (name: string) => plan.payees.find((p) => p.name === name);
  const tx = (date: string, account: string) => plan.transactions.find((t) => t.date === date && t.accountId === acct(account)?.id);

  it('produces canonical records only', () => {
    for (const kind of ENTITY_KINDS) for (const r of plan[kind]) expect(canonical(kind, r), kind).toEqual(r);
  });

  it('survives a round trip through the real schema unchanged', () => {
    const db = openMemoryPlan();
    applyRows(db, encodePlan(plan));
    expect(decodePlan(loadTables(db))).toEqual(plan);
  });

  it('settings come from the options and the detected formats', () => {
    expect(plan.settings).toEqual({
      name: 'Imported Plan',
      currencyCode: 'USD',
      currencyDecimals: 2,
      currencySymbol: '$',
      symbolPlacement: 'before',
      numberFormat: '123,456.78',
      dateFormat: 'MM/DD/YYYY',
      firstMonth: '2026-09',
      createdAt: '2026-10-08T12:00:00.000Z',
    });
  });

  it('accounts and system groups', () => {
    expect(plan.accounts.map((a) => [a.name, a.type, a.onBudget, a.sortOrder])).toEqual([
      ['Checking', 'checking', true, 0],
      ['Visa', 'creditCard', true, 1],
      ['Savings', 'asset', false, 2],
    ]);
    expect(plan.categoryGroups.map((g) => [g.name, g.systemKind, g.hidden, g.sortOrder])).toEqual([
      ['Credit Card Payments', 'creditCardPayments', undefined, 0],
      ['Bills', undefined, undefined, 1],
      ['Hidden Categories', 'hidden', true, 2],
    ]);
    const visa = plan.categories.find((c) => c.name === 'Visa');
    expect(visa?.creditCardAccountId).toBe(acct('Visa')?.id);
    expect(plan.categories.filter((c) => c.groupId === plan.categoryGroups[1]?.id).map((c) => [c.name, c.sortOrder])).toEqual([
      ['Rent', 0],
      ['Food', 1],
    ]);
  });

  it('payees: one per exact name, a transfer payee per account, Starting Balance kept', () => {
    expect(payee('Transfer : Checking')?.transferAccountId).toBe(acct('Checking')?.id);
    expect(payee('Transfer : Savings')?.transferAccountId).toBe(acct('Savings')?.id);
    expect(payee('Starting Balance')).toBeDefined();
    expect(payee('Market')?.id).not.toBe(payee('market')?.id);
    expect(plan.payees.filter((p) => p.name === 'Market')).toHaveLength(1);
  });

  it('transactions keep payee, memo, flag, cleared and the starting-balance marker', () => {
    const start = tx('2026-10-01', 'Checking');
    expect(start).toMatchObject({ categoryId: READY_TO_ASSIGN, cleared: 'reconciled', isStartingBalance: true, payeeId: payee('Starting Balance')?.id });
    expect(tx('2026-10-02', 'Checking')).toMatchObject({ memo: 'October', flag: 'red', cleared: 'cleared', payeeId: payee('Landlord')?.id });
    expect(tx('2026-10-03', 'Visa')).toMatchObject({ cleared: 'uncleared', payeeId: payee('Market')?.id });
    expect(tx('2026-10-06', 'Checking')?.amount).toBe(0);
  });

  it('pairs transfer legs both ways, including a split line', () => {
    const split = tx('2026-10-04', 'Checking');
    const saving = tx('2026-10-04', 'Savings');
    const line = split?.subtransactions?.[1];
    expect(split?.flag).toBe('purple');
    expect(split?.payeeId).toBe(payee('Market')?.id);
    expect(split?.subtransactions?.map((s) => [s.amount, s.memo])).toEqual([
      [-3000, 'veg'],
      [-5000, 'save'],
    ]);
    expect(line).toMatchObject({ transferAccountId: acct('Savings')?.id, payeeId: payee('Transfer : Savings')?.id });
    expect(line?.transferTransactionId).toBe(saving?.id);
    expect(saving?.transferTransactionId).toBe(line?.id);
    expect(saving?.payeeId).toBe(payee('Transfer : Checking')?.id);

    const out = tx('2026-10-05', 'Checking');
    const back = tx('2026-10-05', 'Visa');
    expect(out?.transferTransactionId).toBe(back?.id);
    expect(back?.transferTransactionId).toBe(out?.id);
    expect(report.counts.transferPairs).toBe(2);
  });

  it('upcoming rows become one-off scheduled transactions; a transfer is kept once', () => {
    expect(plan.scheduled.map((s) => [s.date, s.frequency, s.amount, s.accountId, s.transferAccountId])).toEqual([
      ['2026-11-01', 'never', -100000, acct('Checking')?.id, undefined],
      ['2026-11-02', 'never', -10000, acct('Checking')?.id, acct('Savings')?.id],
    ]);
    expect(plan.scheduled[0]?.categoryId).toBe(plan.categories.find((c) => c.name === 'Rent')?.id);
    expect(report.scheduledWithoutRepeat).toBe(2);
  });

  it('assignments and the budget match the plan file', () => {
    const state = computeBudget(budgetSnapshot(plan), { today: '2026-10-08' });
    const oct = monthState(state, '2026-10');
    const byName = (name: string) => oct.categories[plan.categories.find((c) => c.name === name)?.id ?? ''];
    expect([byName('Rent')?.assigned, byName('Rent')?.available]).toEqual([100000, 0]);
    expect([byName('Food')?.activity, byName('Food')?.available]).toEqual([-7000, 13000]);
    expect([byName('Visa')?.activity, byName('Visa')?.available]).toEqual([3000, 3000]);
  });

  it('reports what the export cannot carry', () => {
    expect(report.counts).toMatchObject({ accounts: 3, categoryGroups: 3, categories: 4, transactions: 9, splits: 1, scheduled: 2, months: 2 });
    expect(report.targetsToReenter.map((t) => `${t.group}: ${t.name}`)).toEqual(['Bills: Rent', 'Bills: Food']);
    expect(report.accounts.find((a) => a.name === 'Savings')?.reason).toMatch(/off-budget/);
    expect(report.loanAccountsWithoutDetails).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('marks loan accounts set by options as needing details', () => {
    const r = importYnabExport({ planCsv: PLAN, registerCsv: REGISTER }, { ...options(), accountTypes: { Savings: 'mortgage' } });
    expect(r.report.loanAccountsWithoutDetails).toEqual(['Savings']);
  });

  it('ids come only from newId, deterministically', () => {
    const again = importYnabExport({ planCsv: PLAN, registerCsv: REGISTER }, options());
    expect(again.plan).toEqual(plan);
    expect(plan.transactions.every((t) => t.id.startsWith('id-'))).toBe(true);
  });

  it('detects comma decimals, symbol after and day-first dates', () => {
    const eu = REGISTER.replace(/\$(\d+)\.(\d\d)/g, '"$1,$2 €"').replace(/"(\d\d)\/(\d\d)\/(\d{4})"/g, '"$2.$1.$3"');
    const euPlan = PLAN.replace(/(-?)\$(\d+)\.(\d\d)/g, '"$1$2,$3 €"');
    const r = importYnabExport({ planCsv: euPlan, registerCsv: eu }, { ...options(), currencyCode: 'EUR' });
    expect(r.plan.settings).toMatchObject({ currencyCode: 'EUR', currencySymbol: '€', symbolPlacement: 'after', numberFormat: '123.456,78', dateFormat: 'DD.MM.YYYY' });
    expect(r.plan.transactions.map((t) => [t.date, t.amount])).toEqual(plan.transactions.map((t) => [t.date, t.amount]));
  });
});
