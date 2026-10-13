// A small plan that exercises every record kind and every optional column at least once.
import { READY_TO_ASSIGN } from '@hafb/engine';
import { minor } from '@hafb/shared';
import type { PlanData } from '../../src/records.ts';

const T0 = '2026-10-08T12:00:00.000Z';

export function samplePlan(): PlanData {
  return {
    settings: {
      name: 'Sample Plan',
      currencyCode: 'USD',
      currencyDecimals: 2,
      displayDecimals: 0,
      currencySymbol: '$',
      symbolPlacement: 'before',
      numberFormat: '123,456.78',
      dateFormat: 'MM/DD/YYYY',
      firstMonth: '2026-09',
      expectedIncome: minor(500000),
      createdAt: T0,
    },
    accounts: [
      {
        id: 'a-chk',
        name: 'Checking',
        type: 'checking',
        onBudget: true,
        sortOrder: 0,
        starred: true,
        note: 'main',
        bankLink: { id: 'ACT-1', name: 'Regions Bank · Checking', syncedAt: T0 },
        createdAt: T0,
      },
      { id: 'a-cc', name: 'Visa', type: 'creditCard', onBudget: true, sortOrder: 1, lastReconciledAt: T0, createdAt: T0 },
      {
        id: 'a-home',
        name: 'House',
        type: 'mortgage',
        onBudget: false,
        sortOrder: 2,
        loan: { interestRateBps: 600, minimumPayment: minor(119910), escrow: minor(30000), originalPrincipal: minor(20000000), pairedCategoryId: 'c-rent' },
        createdAt: T0,
      },
      { id: 'a-old', name: 'Old', type: 'savings', onBudget: true, closed: true, sortOrder: 3, createdAt: T0, deletedAt: T0 },
    ],
    categoryGroups: [
      { id: 'g-cc', name: 'Credit Card Payments', sortOrder: 0, systemKind: 'creditCardPayments' },
      { id: 'g-bills', name: 'Bills', sortOrder: 1 },
      { id: 'g-hidden', name: 'Hidden Categories', sortOrder: 2, hidden: true, systemKind: 'hidden' },
      { id: 'g-gone', name: 'Gone', sortOrder: 3, deletedAt: T0 },
    ],
    categories: [
      { id: 'c-visa', groupId: 'g-cc', name: 'Visa', sortOrder: 0, creditCardAccountId: 'a-cc' },
      { id: 'c-rent', groupId: 'g-bills', name: 'Rent', sortOrder: 0, note: 'due 1st' },
      { id: 'c-food', groupId: 'g-bills', name: 'Groceries', sortOrder: 1 },
      { id: 'c-wk', groupId: 'g-bills', name: 'Gas', sortOrder: 2 },
      { id: 'c-yr', groupId: 'g-bills', name: 'Insurance', sortOrder: 3 },
      { id: 'c-old', groupId: 'g-hidden', name: 'Old stuff', sortOrder: 0, hidden: true, deletedAt: T0 },
    ],
    targets: [
      { categoryId: 'c-rent', amount: minor(150000), cadence: { kind: 'monthly', day: 1 }, behavior: 'refill', startMonth: '2026-09' },
      { categoryId: 'c-food', amount: minor(60000), cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside', startMonth: '2026-09', snoozedMonths: ['2026-10'], updatedAt: T0 },
      { categoryId: 'c-wk', amount: minor(5000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill', startMonth: '2026-10', createdOn: '2026-10-08' },
      { categoryId: 'c-yr', amount: minor(120000), cadence: { kind: 'yearly', due: '2027-03-15' }, behavior: 'setAside', startMonth: '2026-09' },
      { categoryId: 'c-old', amount: minor(100000), cadence: { kind: 'custom', due: '2027-06-01', repeatEveryMonths: 3 }, behavior: 'setAside', startMonth: '2026-09' },
    ],
    payees: [
      { id: 'p-store', name: 'Grocery Store', defaultCategoryId: 'c-food', defaultCategoryFixed: true, note: 'weekly' },
      { id: 'p-boss', name: 'Employer', defaultCategoryId: READY_TO_ASSIGN, autoCategorize: false },
      { id: 'p-t-chk', name: 'Transfer : Checking', transferAccountId: 'a-chk' },
      { id: 'p-t-cc', name: 'Transfer : Visa', transferAccountId: 'a-cc' },
      { id: 'p-gone', name: 'Gone', deletedAt: T0 },
    ],
    payeeRenameRules: [{ id: 'r1', match: 'startsWith', pattern: 'GROC', targetPayeeId: 'p-store', sortOrder: 0 }],
    scheduled: [
      {
        id: 's-rent',
        accountId: 'a-chk',
        date: '2026-11-01',
        frequency: 'monthly',
        anchorDay: 1,
        amount: minor(-150000),
        categoryId: 'c-rent',
        payeeId: 'p-store',
        memo: 'rent',
        flag: 'blue',
      },
      {
        id: 's-split',
        accountId: 'a-cc',
        date: '2026-10-20',
        frequency: 'everyOtherWeek',
        amount: minor(-3000),
        categoryId: null,
        subtransactions: [
          { id: 'ss1', amount: minor(-1000), categoryId: 'c-food', payeeId: 'p-store', memo: 'a' },
          { id: 'ss2', amount: minor(-2000), categoryId: 'c-wk' },
        ],
      },
    ],
    transactions: [
      { id: 't-sb', accountId: 'a-chk', date: '2026-09-01', amount: minor(250000), categoryId: READY_TO_ASSIGN, cleared: 'reconciled', isStartingBalance: true, createdAt: T0 },
      { id: 't-pay', accountId: 'a-chk', date: '2026-10-01', amount: minor(400000), payeeId: 'p-boss', categoryId: READY_TO_ASSIGN, cleared: 'cleared', flag: 'green', createdAt: T0 },
      {
        id: 't-split',
        accountId: 'a-cc',
        date: '2026-10-02',
        amount: minor(-7500),
        payeeId: 'p-store',
        categoryId: null,
        cleared: 'uncleared',
        approved: false,
        memo: 'split',
        subtransactions: [
          { id: 'st1', amount: minor(-5000), categoryId: 'c-food', memo: 'food' },
          { id: 'st2', amount: minor(-2500), categoryId: 'c-wk', payeeId: 'p-boss' },
        ],
        importId: 'FITID123',
        importedPayee: 'GROC STORE #12',
        importedMemo: 'POS',
        importedDate: '2026-10-03',
        importedAmount: minor(-7500),
        createdAt: T0,
      },
      { id: 't-x1', accountId: 'a-chk', date: '2026-10-05', amount: minor(-10000), payeeId: 'p-t-cc', categoryId: null, transferAccountId: 'a-cc', transferTransactionId: 't-x2', cleared: 'cleared', createdAt: T0 },
      { id: 't-x2', accountId: 'a-cc', date: '2026-10-05', amount: minor(10000), payeeId: 'p-t-chk', categoryId: null, transferAccountId: 'a-chk', transferTransactionId: 't-x1', cleared: 'cleared', createdAt: T0 },
      { id: 't-sched', accountId: 'a-chk', date: '2026-10-01', amount: minor(-150000), payeeId: 'p-store', categoryId: 'c-rent', scheduledTransactionId: 's-rent', cleared: 'cleared', importId: 'F-RENT', importedPayee: 'LANDLORD LLC', importedDate: '2026-10-02', importedAmount: minor(-150000), matchedAt: T0, enteredAmount: minor(-149900), createdAt: T0 },
      { id: 't-del', accountId: 'a-chk', date: '2026-10-06', amount: minor(-1), categoryId: null, cleared: 'uncleared', createdAt: T0, deletedAt: T0 },
    ],
    assignments: [
      { month: '2026-09', categoryId: 'c-rent', assigned: minor(150000) },
      { month: '2026-10', categoryId: 'c-food', assigned: minor(-2500) },
    ],
    monthNotes: [{ month: '2026-10', note: 'October plan' }],
    moneyMoves: [
      { id: 'm1', createdAt: T0, month: '2026-10', fromCategoryId: null, toCategoryId: 'c-rent', amount: minor(150000), kind: 'assign', groupId: 'g1' },
      { id: 'm2', createdAt: T0, month: '2026-10', fromCategoryId: 'c-food', toCategoryId: null, amount: minor(2500), kind: 'move', groupId: 'g2' },
    ],
    focusedViews: [
      { id: 'v1', name: 'Underfunded', sortOrder: 0, builtin: 'underfunded', categoryIds: [] },
      { id: 'v2', name: 'Bills', sortOrder: 1, categoryIds: ['c-rent', 'c-food'] },
    ],
    flagNames: [{ color: 'green', name: 'Income' }],
    reconciliations: [{ id: 'rc1', accountId: 'a-chk', date: '2026-10-07', statementBalance: minor(240000), adjustmentTransactionId: 't-sb', createdAt: T0 }],
    rejectedImports: [{ accountId: 'a-cc', importId: 'FITID999' }],
    importProfiles: [{ accountId: 'a-cc', profile: { delimiter: ',', columns: ['date', 'payee', 'amount'], swap: false, skip: 1 } }],
  };
}
