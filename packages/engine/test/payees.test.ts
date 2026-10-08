// Worked examples for CLAUDE.md §5.13 (payee defaults) and §8 payee rename rules. Matches
// docs/budget-math-parts/s1.6-transactions.md §8.4.
import { asISODate, minor } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import { READY_TO_ASSIGN, type Transaction } from '../src/model.ts';
import {
  applyRenameRules,
  nextDefaultCategory,
  proposeRenameRule,
  renameRuleMatches,
  suggestCategory,
  type Payee,
  type PayeeRenameRule,
} from '../src/payees.ts';

let n = 0;
const tx = (date: string, categoryId: string | null, extra: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t${String(n)}`,
    accountId: 'checking',
    payeeId: 'kroger',
    date: asISODate(date),
    amount: minor(-1_000),
    categoryId,
    cleared: 'cleared',
    ...extra,
  };
};
const kroger: Payee = { id: 'kroger', name: 'Kroger', defaultCategoryId: 'groceries' };

describe('default category: 2 of the 3 most recent (§5.13)', () => {
  it('example 6.4.1: one different transaction does not change the default', () => {
    const history = [tx('2026-03-01', 'groceries'), tx('2026-03-05', 'groceries'), tx('2026-03-09', 'household')];
    expect(nextDefaultCategory(kroger, history)).toBe('groceries');
  });

  it('example 6.4.2: two of the last three agreeing on a new category switch it', () => {
    const history = [tx('2026-03-01', 'groceries'), tx('2026-03-05', 'household'), tx('2026-03-09', 'household')];
    expect(nextDefaultCategory(kroger, history)).toBe('household');
  });

  it('example 6.4.3: only the three most recent count; three-way splits keep the current default', () => {
    const old = [tx('2026-01-01', 'household'), tx('2026-01-02', 'household')];
    expect(nextDefaultCategory(kroger, [...old, tx('2026-03-01', 'gifts'), tx('2026-03-02', 'fun'), tx('2026-03-03', 'groceries')])).toBe('groceries');
    expect(nextDefaultCategory(kroger, [...old, tx('2026-03-01', 'gifts'), tx('2026-03-02', 'fun'), tx('2026-03-03', 'dining')])).toBe('groceries');
  });

  it('example 6.4.4: ignores other payees, deleted, uncategorized, split and transfer transactions', () => {
    const history = [
      tx('2026-03-01', 'groceries'),
      tx('2026-03-02', 'fun', { payeeId: 'other' }),
      tx('2026-03-03', 'fun', { deleted: true }),
      tx('2026-03-04', null),
      tx('2026-03-05', 'fun', { transferAccountId: 'savings' }),
      tx('2026-03-06', null, { subtransactions: [{ id: 's', amount: minor(-1_000), categoryId: 'fun' }] }),
      tx('2026-03-07', 'fun'),
    ];
    expect(nextDefaultCategory(kroger, history)).toBe('groceries');
  });

  it('example 6.4.5: a new payee takes its first category; Ready to Assign counts as a category', () => {
    const fresh: Payee = { id: 'kroger', name: 'Kroger' };
    expect(nextDefaultCategory(fresh, [tx('2026-03-01', READY_TO_ASSIGN)])).toBe(READY_TO_ASSIGN);
    expect(nextDefaultCategory(fresh, [])).toBeNull();
  });

  it('example 6.4.6: a pinned default never moves; auto-categorize off means no suggestion', () => {
    const history = [tx('2026-03-01', 'fun'), tx('2026-03-02', 'fun'), tx('2026-03-03', 'fun')];
    expect(nextDefaultCategory({ ...kroger, defaultCategoryFixed: true }, history)).toBe('groceries');
    expect(suggestCategory({ ...kroger, autoCategorize: false })).toBeNull();
    expect(suggestCategory(kroger)).toBe('groceries');
  });

  it('orders by date, then by input order for same-day transactions', () => {
    const history = [tx('2026-03-09', 'household'), tx('2026-03-01', 'groceries'), tx('2026-03-09', 'household')];
    expect(nextDefaultCategory(kroger, history)).toBe('household');
  });
});

describe('rename rules', () => {
  const rules: PayeeRenameRule[] = [
    { id: 'r1', match: 'startsWith', pattern: 'AMZN', targetPayeeId: 'amazon' },
    { id: 'r2', match: 'contains', pattern: 'kroger', targetPayeeId: 'kroger' },
    { id: 'r3', match: 'equals', pattern: 'SQ *COFFEE', targetPayeeId: 'cafe' },
    { id: 'r4', match: 'contains', pattern: 'amzn', targetPayeeId: 'never-reached' },
  ];

  it.each([
    ['AMZN Mktp US*2K4L', 'amazon'],
    ['amzn digital', 'amazon'],
    ['THE KROGER CO #123', 'kroger'],
    ['sq *coffee', 'cafe'],
    ['SQ *COFFEE SHOP', null],
    ['Shell', null],
  ])('%s → %s (case-insensitive, first matching rule wins)', (name, target) => {
    expect(applyRenameRules(name, rules)?.targetPayeeId ?? null).toBe(target);
  });

  it('does not trim or collapse spaces inside names', () => {
    expect(renameRuleMatches({ id: 'x', match: 'equals', pattern: 'Grocery Store', targetPayeeId: 'g' }, 'Grocery  Store')).toBe(false);
  });

  it('rejects empty patterns', () => {
    expect(() => applyRenameRules('x', [{ id: 'bad', match: 'contains', pattern: '', targetPayeeId: 'p' }])).toThrow(ValidationError);
  });
});

describe('proposeRenameRule (the "Rename all future AMZN* to Amazon?" prompt)', () => {
  it.each([
    ['AMZN Mktp US*2K4L', 'Amazon', { match: 'startsWith', pattern: 'AMZN Mktp US' }],
    // No store/reference code to strip: a prefix like "SQ" would catch every Square merchant.
    ['SQ *BLUE BOTTLE', 'Blue Bottle', { match: 'equals', pattern: 'SQ *BLUE BOTTLE' }],
    ['KROGER #1234', 'Kroger', { match: 'startsWith', pattern: 'KROGER' }],
    ['Netflix.com', 'Netflix', { match: 'equals', pattern: 'Netflix.com' }],
    ['ACH 99887', 'Payroll', { match: 'equals', pattern: 'ACH 99887' }],
  ])('%s renamed to %s → %o', (original, renamed, expected) => {
    expect(proposeRenameRule(original, renamed)).toEqual({ ...expected, renameTo: renamed });
  });

  it('proposes nothing when the name did not change', () => {
    expect(proposeRenameRule('Kroger', 'kroger')).toBeNull();
  });
});
