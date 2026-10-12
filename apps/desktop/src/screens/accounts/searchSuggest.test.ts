import { describe, expect, it } from 'vitest';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { parseRegisterSearch } from './registerModel.ts';
import { IS_STATES, searchSuggestions } from './searchSuggest.ts';

const plan = buildSamplePlan().plan;
const money = (t: string): string | null => (Number.isFinite(Number(t)) ? `$${Number(t).toFixed(2)}` : null);
const rows = (text: string) => searchSuggestions(plan, text, SAMPLE_TODAY, money).map((s) => `${s.key} ${s.text}`.trim());

describe('register search suggestions (YNAB, trial 2026-10-12)', () => {
  it('nothing typed, nothing listed', () => {
    expect(searchSuggestions(plan, '', SAMPLE_TODAY, money)).toEqual([]);
    expect(searchSuggestions(plan, 'Payee: Corner Grocery, ', SAMPLE_TODAY, money)).toEqual([]);
  });

  it('a word: matching categories, then Find in any field / Payee / Category / Memo (payees are not named)', () => {
    expect(rows('gro')).toEqual([
      'Category: Groceries',
      'Find “gro” in any field',
      'Payee: Find “gro” in the Payee',
      'Category: Find “gro” in the Category',
      'Memo: Find “gro” in the Memo',
    ]);
    expect(rows('wallet')[0]).toBe('Account: Wallet');
  });

  it('a number: the Income hint, then Outflow and Inflow comparisons', () => {
    expect(rows('25')).toEqual([
      'Income: Enter month like ‘Income: October 2026’',
      'Outflow: Outflow equals $25.00',
      'Outflow: Outflow more or equal to $25.00',
      'Outflow: Outflow less or equal to $25.00',
      'Inflow: Inflow equals $25.00',
      'Inflow: Inflow more or equal to $25.00',
      'Inflow: Inflow less or equal to $25.00',
      'Find “25” in any field',
      'Payee: Find “25” in the Payee',
      'Category: Find “25” in the Category',
      'Memo: Find “25” in the Memo',
    ]);
  });

  it('"is" lists every Is: state in YNAB’s order', () => {
    expect(rows('is').filter((r) => r.startsWith('Is:'))).toEqual(IS_STATES.map((s) => `Is: ${s}`));
    expect(rows('is: unappr')).toEqual(['Is: Unapproved', 'Is: Unapproved or Needs Category']);
  });

  it('choosing one replaces the term being typed and every value parses', () => {
    const all = [...searchSuggestions(plan, 'Payee: Corner Grocery, gro', SAMPLE_TODAY, money), ...searchSuggestions(plan, '25', SAMPLE_TODAY, money), ...searchSuggestions(plan, 'is', SAMPLE_TODAY, money)];
    expect(all.find((s) => s.text === 'Groceries')?.value).toBe('Payee: Corner Grocery, Category: Groceries, ');
    for (const s of all) {
      if (s.key === 'Income:') continue; // the hint waits for a month
      expect(parseRegisterSearch(plan, s.value).error, s.value).toBeNull();
    }
    expect(parseRegisterSearch(plan, 'Income: October 2026').error).toBeNull();
  });
});
