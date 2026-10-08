import { describe, expect, it } from 'vitest';
import { formatMoney, numberFormatSeparators, type MoneyFormat } from '../src/format.ts';
import { minor } from '../src/money.ts';

const usd: MoneyFormat = { decimals: 2, symbol: '$', placement: 'before', numberFormat: '123,456.78' };

describe('formatMoney', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [123456, '$1,234.56'],
    [-123456, '-$1,234.56'],
    [100000000000, '$1,000,000,000.00'],
    [-7, '-$0.07'],
  ])('USD %i → %s', (value, text) => {
    expect(formatMoney(minor(value), usd)).toBe(text);
  });

  it('follows the plan number format and symbol placement', () => {
    const eur: MoneyFormat = { decimals: 2, symbol: '€', placement: 'after', numberFormat: '123.456,78' };
    expect(formatMoney(minor(123456789), eur)).toBe('1.234.567,89 €');
    expect(formatMoney(minor(-50), eur)).toBe('-0,50 €');
    const chf: MoneyFormat = { decimals: 2, symbol: 'CHF', placement: 'before', numberFormat: "123'456.78" };
    expect(formatMoney(minor(123456789), chf)).toBe("CHF 1'234'567.89");
    const space: MoneyFormat = { decimals: 2, symbol: 'kr', placement: 'none', numberFormat: '123 456,78' };
    expect(formatMoney(minor(123456789), space)).toBe('1 234 567,89');
  });

  it('handles zero-decimal and three-decimal currencies', () => {
    expect(formatMoney(minor(1234567), { decimals: 0, symbol: '¥', placement: 'before', numberFormat: '123,456' })).toBe('¥1,234,567');
    expect(formatMoney(minor(1234567), { decimals: 3, symbol: 'KD', placement: 'before', numberFormat: '123,456.789' })).toBe('KD 1,234.567');
  });

  it('can omit the symbol (grid cells)', () => {
    expect(formatMoney(minor(-123456), { ...usd, placement: 'none' })).toBe('-1,234.56');
  });

  it('reads separators from the sample', () => {
    expect(numberFormatSeparators('123,456.78')).toEqual({ group: ',', decimal: '.' });
    expect(numberFormatSeparators('123.456,78')).toEqual({ group: '.', decimal: ',' });
    expect(numberFormatSeparators('123 456,78')).toEqual({ group: ' ', decimal: ',' });
    expect(numberFormatSeparators('123456.78')).toEqual({ group: '', decimal: '.' });
  });
});
