import { describe, expect, it } from 'vitest';
import { minor } from '@hafb/shared';
import { moneyText } from './money.ts';

// Hide Amounts (P-25, YNAB 2026-06): every amount is masked, keeping the currency symbol's place.
describe('Hide Amounts', () => {
  const fmt = { decimals: 2, symbol: '$', placement: 'before' as const, numberFormat: '1,234.56' as const };
  it('masks every amount the same way, so nothing leaks through length or sign', () => {
    const hidden = moneyText(fmt, true);
    expect(hidden(minor(123_456))).toBe(hidden(minor(-5)));
    expect(hidden(minor(0))).not.toMatch(/\d/);
    expect(hidden(minor(0)).startsWith('$')).toBe(true);
    expect(moneyText({ ...fmt, placement: 'after' }, true)(minor(1)).endsWith('$')).toBe(true);
    expect(moneyText(fmt, false)(minor(123_456))).toBe('$1,234.56');
  });
});
