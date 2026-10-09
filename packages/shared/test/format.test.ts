import { describe, expect, it } from 'vitest';
import { formatMoney, inputSeparators, NUMBER_FORMATS, numberFormatSample, numberFormatSeparators, type MoneyFormat } from '../src/format.ts';
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
    // YNAB writes a symbol after the amount with no space ("123.456,78kr", Plan Settings 2026-10-09).
    expect(formatMoney(minor(123456789), eur)).toBe('1.234.567,89€');
    expect(formatMoney(minor(-50), eur)).toBe('-0,50€');
    expect(formatMoney(minor(12345678), { decimals: 2, symbol: 'kr', placement: 'after', numberFormat: '123.456,78' })).toBe('123.456,78kr');
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
    expect(numberFormatSeparators('1,23,456.78')).toEqual({ group: ',', decimal: '.' });
    expect(numberFormatSeparators('123 456-78')).toEqual({ group: ' ', decimal: '-' });
    expect(numberFormatSeparators('123,456/78')).toEqual({ group: ',', decimal: '/' });
  });

  it("formats every one of YNAB's eight number formats (Plan Settings, 2026-10-09)", () => {
    const at = (numberFormat: string) => formatMoney(minor(-123456789), { decimals: 2, symbol: '', placement: 'none', numberFormat });
    expect(NUMBER_FORMATS.map(at)).toEqual(['-1,234,567.89', '-1.234.567,89', '-1 234 567.89', "-1'234'567.89", '-1 234 567-89', '-1 234 567,89', '-1,234,567/89', '-12,34,567.89']);
    // Indian grouping: the last three digits, then pairs.
    expect(formatMoney(minor(1234567890123), { decimals: 2, symbol: '₹', placement: 'before', numberFormat: '1,23,456.78' })).toBe('₹12,34,56,78,901.23');
    expect(formatMoney(minor(99999), { decimals: 2, symbol: '', placement: 'none', numberFormat: '1,23,456.78' })).toBe('999.99');
  });

  it('shows a switched currency with its own decimals and keeps the stored precision (YNAB: $370.01 shows as ¥370)', () => {
    const yen = { decimals: 2, displayDecimals: 0, symbol: '¥', placement: 'before', numberFormat: '123,456' } as const;
    expect(formatMoney(minor(37001), yen)).toBe('¥370');
    expect(formatMoney(minor(307000), yen)).toBe('¥3,070');
    expect(formatMoney(minor(-12350), yen)).toBe('-¥124'); // half away from zero
    expect(formatMoney(minor(49), yen)).toBe('¥0');
    // A plan started in yen and switched to dollars: whole units gain zeros.
    expect(formatMoney(minor(3070), { decimals: 0, displayDecimals: 2, symbol: '$', placement: 'before', numberFormat: '123,456.78' })).toBe('$3,070.00');
  });

  it('a format sample follows the currency decimals', () => {
    expect(numberFormatSample('123.456,78', 0)).toBe('123.456');
    expect(numberFormatSample('123,456.78', 3)).toBe('123,456.789');
    expect(numberFormatSample('1,23,456.78', 2)).toBe('1,23,456.78');
    expect(numberFormatSample('123 456-78', 0)).toBe('123 456');
    expect(formatMoney(minor(1234567), { decimals: 0, symbol: '', placement: 'none', numberFormat: numberFormatSample('1,23,456.78', 0) })).toBe('12,34,567');
  });

  it("typing uses a safe decimal mark when the format's own is an arithmetic sign", () => {
    expect(inputSeparators('123 456-78')).toEqual({ decimal: '.', group: ' ' });
    expect(inputSeparators('123,456/78')).toEqual({ decimal: '.', group: ',' });
    expect(inputSeparators('123.456,78')).toEqual({ decimal: ',', group: '.' });
    expect(inputSeparators('123456.78')).toEqual({ decimal: '.', group: ',' });
  });
});
