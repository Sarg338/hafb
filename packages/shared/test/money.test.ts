import { describe, expect, it } from 'vitest';
import {
  abs,
  add,
  divRound,
  maxOf,
  minOf,
  minor,
  mul,
  neg,
  parseDecimal,
  positivePart,
  splitEvenly,
  sub,
  sum,
  ZERO,
} from '../src/money.ts';

const m = minor;

describe('minor', () => {
  it('accepts safe integers and rejects fractions, NaN and unsafe values', () => {
    expect(m(1250)).toBe(1250);
    expect(m(-7)).toBe(-7);
    expect(() => m(12.5)).toThrow(RangeError);
    expect(() => m(Number.NaN)).toThrow(RangeError);
    expect(() => m(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts, negates and sums exactly', () => {
    expect(add(m(10), m(-3))).toBe(7);
    expect(sub(m(10), m(13))).toBe(-3);
    expect(neg(m(5))).toBe(-5);
    expect(Object.is(neg(ZERO), 0)).toBe(true);
    expect(abs(m(-9))).toBe(9);
    expect(sum([m(1), m(2), m(-4)])).toBe(-1);
    expect(sum([])).toBe(0);
    expect(minOf(m(3), m(-1))).toBe(-1);
    expect(maxOf(m(3), m(-1))).toBe(3);
    expect(positivePart(m(-5))).toBe(0);
    expect(positivePart(m(5))).toBe(5);
  });

  it('multiplies only by integers and throws on overflow', () => {
    expect(mul(m(250), 12)).toBe(3000);
    expect(() => mul(m(250), 1.5)).toThrow(RangeError);
    expect(() => add(m(Number.MAX_SAFE_INTEGER), m(1))).toThrow(RangeError);
  });
});

describe('divRound (half away from zero)', () => {
  it.each([
    [10, 4, 3], // 2.5 → 3
    [-10, 4, -3], // −2.5 → −3
    [9, 4, 2], // 2.25 → 2
    [11, 4, 3], // 2.75 → 3
    [-11, 4, -3],
    [1, 3, 0], // 0.33 → 0
    [2, 3, 1], // 0.67 → 1
    [0, 7, 0],
    [123456, 12, 10288], // 10288.0
    [100, 12, 8], // 8.33 → 8
    [102, 12, 9], // 8.5 → 9
  ])('%i / %i = %i', (n, d, expected) => {
    expect(divRound(m(n), d)).toBe(expected);
  });

  it('rejects non-positive or fractional divisors', () => {
    expect(() => divRound(m(1), 0)).toThrow(RangeError);
    expect(() => divRound(m(1), -2)).toThrow(RangeError);
    expect(() => divRound(m(1), 1.5)).toThrow(RangeError);
  });
});

describe('splitEvenly', () => {
  it('splits into pieces that differ by at most one and sum exactly', () => {
    expect(splitEvenly(m(100), 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(m(-100), 3)).toEqual([-34, -33, -33]);
    expect(splitEvenly(m(5), 5)).toEqual([1, 1, 1, 1, 1]);
    for (const total of [0, 1, 99, 1001, -77]) {
      for (const parts of [1, 2, 7, 12]) {
        expect(sum(splitEvenly(m(total), parts))).toBe(total);
      }
    }
  });
});

describe('parseDecimal', () => {
  it.each([
    ['12.34', 2, 1234],
    ['-0.07', 2, -7],
    ['12', 2, 1200],
    ['12.5', 2, 1250],
    ['0.10', 2, 10],
    ['+3.00', 2, 300],
    ['1234', 0, 1234],
    ['1.234', 3, 1234],
    ['-0', 2, 0],
    ['  42.10 ', 2, 4210],
  ])('"%s" with %i decimals → %i', (text, decimals, expected) => {
    expect(parseDecimal(text, decimals)).toBe(expected);
  });

  it('never goes through floats (0.1 + 0.2 style values stay exact)', () => {
    expect(parseDecimal('0.29', 2)).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(parseDecimal('1.15', 2)).toBe(115); // 1.15 * 100 = 114.99999999999999
  });

  it('rejects malformed input and excess precision', () => {
    expect(() => parseDecimal('1,234.00', 2)).toThrow(RangeError);
    expect(() => parseDecimal('12.345', 2)).toThrow(RangeError);
    expect(() => parseDecimal('abc', 2)).toThrow(RangeError);
    expect(() => parseDecimal('', 2)).toThrow(RangeError);
  });
});
