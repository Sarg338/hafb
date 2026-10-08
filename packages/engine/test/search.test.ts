// Register search (roadmap D9; https://support.ynab.com/en_us/searching-transactions-a-guide-r1gxyQryj).
// Matches docs/budget-math-parts/s1.6-transactions.md §8.3. Amounts are cents.
import { asISODate, minor } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import { READY_TO_ASSIGN } from '../src/model.ts';
import { filterTransactions, matchesSearch, parseSearch, type SearchContext, type SearchableTransaction } from '../src/search.ts';

const names: Record<string, string> = {
  kroger: 'Kroger',
  shell: 'Shell',
  employer: 'Employer Payroll',
  groceries: 'Groceries',
  dining: 'Dining Out',
  fuel: 'Fuel',
  checking: 'Checking',
  savings: 'Savings',
  visa: 'Visa',
};
const ctx: SearchContext = {
  payeeName: (id) => names[id],
  categoryName: (id) => names[id],
  accountName: (id) => names[id],
  flagNames: { red: 'Reimbursable' },
};

const t = (id: string, over: Partial<SearchableTransaction>): SearchableTransaction => ({
  id,
  accountId: 'checking',
  date: asISODate('2026-03-10'),
  amount: minor(-1_000),
  categoryId: 'groceries',
  cleared: 'cleared',
  ...over,
});

const register: SearchableTransaction[] = [
  t('groc', { payeeId: 'kroger', amount: minor(-4_250), memo: 'weekly shop', date: asISODate('2026-03-02') }),
  t('dine', { payeeId: 'kroger', categoryId: 'dining', amount: minor(-3_000), cleared: 'uncleared', flag: 'red' }),
  t('gas', { payeeId: 'shell', categoryId: 'fuel', accountId: 'visa', amount: minor(-5_500), cleared: 'reconciled', date: asISODate('2026-02-27') }),
  t('pay', { payeeId: 'employer', categoryId: READY_TO_ASSIGN, amount: minor(250_000), approved: false, date: asISODate('2026-03-15') }),
  t('xfer', { categoryId: null, transferAccountId: 'savings', amount: minor(-20_000), matched: true }),
  t('split', {
    payeeId: 'kroger',
    categoryId: null,
    amount: minor(-6_000),
    flag: 'blue',
    subtransactions: [
      { id: 's1', amount: minor(-4_000), categoryId: 'groceries', memo: 'food' },
      { id: 's2', amount: minor(-2_000), categoryId: 'dining', memo: 'deli lunch' },
    ],
  }),
  t('none', { categoryId: null, amount: minor(-999) }),
];

const ids = (query: string) => filterTransactions(register, parseSearch(query, ctx), ctx).map((x) => x.id);

describe('search: documented criteria', () => {
  it.each<[string, string[]]>([
    // YNAB's documented examples
    ['Payee: Transfer', ['xfer']],
    ['Category: Dining Out', ['dine', 'split']],
    ['Category: Dining Out, Outflow: >=30', ['dine', 'split']],
    ['Category: Split', ['split']],
    ['is: uncleared', ['dine']],
    ['Flag is: Red', ['dine']],
    ['Flag is: Reimbursable', ['dine']], // custom flag name
    // fields
    ['Payee: kroger', ['groc', 'dine', 'split']],
    ['payee:KROGER', ['groc', 'dine', 'split']],
    ['Memo: lunch', ['split']],
    ['Memo: weekly shop', ['groc']],
    ['Account: Visa', ['gas']],
    ['Category: Ready to Assign', ['pay']],
    ['Category: Uncategorized', ['none']],
    // amounts (magnitudes, exact minor units)
    ['Outflow: 42.50', ['groc']],
    ['Outflow: =$42.50', ['groc']],
    ['Outflow: >50', ['gas', 'xfer', 'split']],
    ['Outflow: <10', ['none']],
    ['Outflow: <=9.99', ['none']],
    ['Inflow: >=2500', ['pay']], // no thousands separators: commas separate criteria
    ['Amount: 2500', ['pay']],
    ['Outflow', ['groc', 'dine', 'gas', 'xfer', 'split', 'none']],
    ['Inflow', ['pay']],
    // dates (After/Before inclusive)
    ['After: 2026-03-10', ['dine', 'pay', 'xfer', 'split', 'none']],
    ['Before: 2026-03-02', ['groc', 'gas']],
    ['On: 2026-02-27', ['gas']],
    ['After: 2026-03-01, Before: 2026-03-02', ['groc']],
    // states
    ['Cleared', ['groc', 'pay', 'xfer', 'split', 'none']],
    ['Reconciled', ['gas']],
    ['Unreconciled', ['groc', 'dine', 'pay', 'xfer', 'split', 'none']],
    ['Unapproved', ['pay']],
    ['Approved', ['groc', 'dine', 'gas', 'xfer', 'split', 'none']],
    ['Matched', ['xfer']],
    ['Split', ['split']],
    ['is: split', ['split']],
    ['is: flagged', ['dine', 'split']],
    ['is: unflagged', ['groc', 'gas', 'pay', 'xfer', 'none']],
    // free text: payee, category, memo, account, or an exact amount
    ['kroger', ['groc', 'dine', 'split']],
    ['deli', ['split']],
    ['savings', ['xfer']],
    ['42.50', ['groc']],
    ['20', ['split']],
    ['', ['groc', 'dine', 'gas', 'pay', 'xfer', 'split', 'none']],
    // combinations are AND ("additive")
    ['kroger, Uncleared', ['dine']],
    ['Payee: Kroger, Category: Groceries, Outflow: >40', ['groc', 'split']],
  ])('%s', (query, expected) => {
    expect(ids(query)).toEqual(expected);
  });

  it('spacing must match exactly (YNAB: "Grocery  Store" ≠ "Grocery Store")', () => {
    expect(ids('Memo: weekly  shop')).toEqual([]);
  });

  it('honours the plan date format for Before/After/On', () => {
    const q = parseSearch('On: 27/02/2026', { dateOrder: 'DMY' });
    expect(filterTransactions(register, q, ctx).map((x) => x.id)).toEqual(['gas']);
  });
});

describe('search: parse tree and errors', () => {
  it('returns a typed criteria list', () => {
    expect(parseSearch('Category: Dining Out, Outflow: >=30, is: uncleared, coffee').criteria).toEqual([
      { kind: 'text', field: 'category', value: 'dining out' },
      { kind: 'amount', field: 'outflow', op: '>=', value: 3_000 },
      { kind: 'state', state: 'uncleared' },
      { kind: 'text', field: 'any', value: 'coffee' },
    ]);
  });

  it.each([
    'Except: Transfer', // YNAB: no exclusion
    'Payee:',
    'Outflow: >=abc',
    'Outflow: 1.234',
    'On: 2026-02-30',
    'is: purple',
    'Flag is: magenta',
  ])('rejects %s', (query) => {
    expect(() => parseSearch(query)).toThrow(ValidationError);
  });

  it('matchesSearch works on a single transaction', () => {
    const [groc] = register;
    if (!groc) throw new Error('fixture');
    expect(matchesSearch(parseSearch('Payee: Kroger'), groc, ctx)).toBe(true);
    expect(matchesSearch(parseSearch('Payee: Shell'), groc, ctx)).toBe(false);
  });

  it('ignores deleted transactions', () => {
    const deleted = t('gone', { payeeId: 'kroger', deleted: true });
    expect(filterTransactions([deleted], parseSearch('kroger'), ctx)).toEqual([]);
  });
});
