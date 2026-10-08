import { describe, expect, it } from 'vitest';
import { minor } from '@hafb/shared';
import { buildSamplePlan } from '../../design/sample.ts';
import { ACCOUNT_TYPES, enteredBalance, formatRate, isDebtType, moveAccount, orderedAccounts, parseRate, sectionOf, signedBalance, stepAccount } from './accountsModel.ts';

const sample = buildSamplePlan().plan;
const id = (name: string): string => sample.accounts.find((a) => a.name === name)?.id ?? '';
const names = (ids: string[] | null): string[] => (ids ?? []).map((x) => sample.accounts.find((a) => a.id === x)?.name ?? '');

describe('account types', () => {
  it('cover every engine type, grouped like YNAB', () => {
    expect(ACCOUNT_TYPES.map((t) => t.type)).toHaveLength(13);
    for (const t of ACCOUNT_TYPES) expect(sectionOf(t.type)).toBe(t.section);
  });

  it('ask for the amount owed on cards, loans and liabilities, and store it negative', () => {
    expect(isDebtType('creditCard')).toBe(true);
    expect(isDebtType('mortgage')).toBe(true);
    expect(isDebtType('liability')).toBe(true);
    expect(isDebtType('checking')).toBe(false);
    expect(isDebtType('asset')).toBe(false);
    expect(signedBalance('creditCard', minor(50_000))).toBe(-50_000);
    expect(signedBalance('savings', minor(50_000))).toBe(50_000);
    expect(enteredBalance('mortgage', minor(-20_000_000))).toBe(20_000_000);
  });
});

describe('interest rates', () => {
  it('parse to basis points exactly and print back', () => {
    expect(parseRate('6')).toBe(600);
    expect(parseRate('6.25%')).toBe(625);
    expect(parseRate(' 0.5 ')).toBe(50);
    expect(parseRate('')).toBeNull();
    expect(parseRate('abc')).toBeNull();
    expect(parseRate('-1')).toBeNull();
    expect(parseRate('6.125')).toBeNull();
    expect(formatRate(625)).toBe('6.25');
    expect(formatRate(600)).toBe('6.00');
    expect(formatRate(5)).toBe('0.05');
  });
});

describe('reordering', () => {
  it('moves an account before or after another', () => {
    const before = names(orderedAccounts(sample).map((a) => a.id));
    const moved = names(moveAccount(sample, id('Wallet'), id('Everyday Checking'), 'before'));
    expect(moved.indexOf('Wallet')).toBe(moved.indexOf('Everyday Checking') - 1);
    expect(moved).toHaveLength(before.length);
    expect(moveAccount(sample, id('Wallet'), id('Wallet'), 'after')).toBeNull();
  });

  it('steps within the sidebar section only', () => {
    const up = names(stepAccount(sample, id('Rainy Day Savings'), -1));
    expect(up.indexOf('Rainy Day Savings')).toBeLessThan(up.indexOf('Everyday Checking'));
    // Everyday Checking is first in Cash: nothing above it in its section.
    expect(stepAccount(sample, id('Everyday Checking'), -1)).toBeNull();
  });
});
