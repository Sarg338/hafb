import { describe, expect, it } from 'vitest';
import { DATE_KEYS, dateKey, formatDate, parseDateInput } from '../src/dateInput.ts';

const today = '2026-10-14' as const;

describe('formatDate', () => {
  it.each([
    ['MM/DD/YYYY', '10/05/2026'],
    ['DD/MM/YYYY', '05/10/2026'],
    ['YYYY-MM-DD', '2026-10-05'],
    ['DD.MM.YYYY', '05.10.2026'],
    ['YYYY/MM/DD', '2026/10/05'],
  ])('%s', (format, text) => {
    expect(formatDate('2026-10-05', format)).toBe(text);
  });
});

describe('parseDateInput', () => {
  it.each([
    ['MM/DD/YYYY', '10/05/2026', '2026-10-05'],
    ['MM/DD/YYYY', '10/5/26', '2026-10-05'],
    ['MM/DD/YYYY', '10-5-2026', '2026-10-05'],
    ['MM/DD/YYYY', '10 5', '2026-10-05'],
    ['MM/DD/YYYY', '2/29/2028', '2028-02-29'],
    ['DD/MM/YYYY', '05/10/2026', '2026-10-05'],
    ['DD/MM/YYYY', '5.10', '2026-10-05'],
    ['DD.MM.YYYY', '05.10.2026', '2026-10-05'],
    ['YYYY-MM-DD', '2026-10-05', '2026-10-05'],
    ['YYYY-MM-DD', '10-05', '2026-10-05'],
    ['YYYY/MM/DD', '2026/1/2', '2026-01-02'],
  ])('%s: %j', (format, text, expected) => {
    expect(parseDateInput(text, format, today)).toBe(expected);
  });

  it('a lone number is a day in today’s month', () => {
    expect(parseDateInput('3', 'MM/DD/YYYY', today)).toBe('2026-10-03');
    expect(parseDateInput('31', 'DD/MM/YYYY', today)).toBe('2026-10-31');
  });

  it.each(['', 'abc', '13/45/2026', '2/30/2026', '32', '0', '1/2/3/4', '10/5/123'])('rejects %j', (text) => {
    expect(parseDateInput(text, 'MM/DD/YYYY', today)).toBeNull();
  });

  it('accepts surrounding spaces', () => {
    expect(parseDateInput('  10/5  ', 'MM/DD/YYYY', today)).toBe('2026-10-05');
  });
});

describe('dateKey', () => {
  const d = '2026-01-31' as const;
  it.each([
    ['+', '2026-02-01'],
    ['=', '2026-02-01'],
    ['-', '2026-01-30'],
    ['PageDown', '2026-02-28'],
    ['PageUp', '2025-12-31'],
    ['t', today],
    ['T', today],
    ['m', '2026-01-01'],
    ['h', '2026-01-31'],
    ['y', '2026-01-01'],
    ['r', '2026-12-31'],
    ['M', '2026-01-01'],
    ['R', '2026-12-31'],
  ])('%s', (key, expected) => {
    expect(dateKey(d, key, today)).toBe(expected);
  });

  it('ignores other keys', () => {
    expect(dateKey(d, 'x', today)).toBeNull();
    expect(dateKey(d, 'ArrowDown', today)).toBeNull();
    expect(dateKey(d, '5', today)).toBeNull();
  });

  it('documents every key it handles', () => {
    for (const k of DATE_KEYS) expect(dateKey(d, k.key, today), k.key).not.toBeNull();
  });
});
