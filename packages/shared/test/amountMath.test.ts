import { describe, expect, it } from 'vitest';
import { evaluateAmount, hasArithmetic } from '../src/amountMath.ts';

const usd = { decimals: 2 };
const value = (text: string, opts: Parameters<typeof evaluateAmount>[1] = usd): number => {
  const r = evaluateAmount(text, opts);
  if (!r.ok) throw new Error(`${text}: ${r.error}`);
  return r.value;
};
const error = (text: string, opts: Parameters<typeof evaluateAmount>[1] = usd): string => {
  const r = evaluateAmount(text, opts);
  if (r.ok) throw new Error(`${text} unexpectedly gave ${String(r.value)}`);
  return r.error;
};

describe('evaluateAmount', () => {
  it.each([
    ['12.50', 1250],
    ['12.5', 1250],
    ['.5', 50],
    ['12', 1200],
    ['0', 0],
    ['12.50+3', 1550],
    ['100-0.01', 9999],
    ['100/3', 3333],
    ['200/3', 6667],
    ['-5', -500],
    ['--5', 500],
    ['(10+5)*2', 3000],
    ['2*(3+4)', 1400],
    ['10 × 3', 3000],
    ['90 ÷ 4', 2250],
    ['2/3*3', 200],
    ['1/3+1/3+1/3', 100],
    ['  42.10  ', 4210],
    ['$1,234.56', 123456],
    ['1,234,567.89', 123456789],
    ['-$40', -4000],
    ['5-10', -500],
  ])('%s → %i', (text, expected) => {
    expect(value(text)).toBe(expected);
  });

  it('uses the plan decimal and group separators', () => {
    expect(value('1.234,56', { decimals: 2, decimalSeparator: ',', groupSeparator: '.' })).toBe(123456);
    expect(value('12,5+0,25', { decimals: 2, decimalSeparator: ',', groupSeparator: '.' })).toBe(1275);
    expect(value('1 234,56 €', { decimals: 2, decimalSeparator: ',', groupSeparator: ' ' })).toBe(123456);
  });

  it('respects zero- and three-decimal currencies', () => {
    expect(value('1234', { decimals: 0 })).toBe(1234);
    expect(value('10/4', { decimals: 0 })).toBe(3);
    expect(value('1.2345', { decimals: 3 })).toBe(1235);
  });

  it('rounds half away from zero once, at the end', () => {
    expect(value('0.005')).toBe(1);
    expect(value('-0.005')).toBe(-1);
    expect(value('0.004')).toBe(0);
    expect(value('0.0049+0.0001')).toBe(1);
    expect(value('1/8')).toBe(13);
    expect(value('-1/8')).toBe(-13);
  });

  it.each(['', '   ', '1e5', '12..5', '1+', '*3', '(1+2', '1+2)', '1/0', '5/(2-2)', 'abc', '1,2,3.4.5', '12 34'])('rejects %j', (text) => {
    expect(error(text)).toBeTruthy();
  });

  it('rejects results beyond safe integers', () => {
    expect(error('99999999999999*99999999')).toMatch(/too large/i);
  });

  it('explains division by zero', () => {
    expect(error('1/0')).toMatch(/zero/i);
  });
});

describe('hasArithmetic', () => {
  it.each([
    ['12.50+3', true],
    ['100/3', true],
    ['(5)', true],
    ['5-2', true],
    ['-5', false],
    ['12.50', false],
    ['$1,234', false],
  ])('%s → %s', (text, expected) => {
    expect(hasArithmetic(text)).toBe(expected);
  });
});
