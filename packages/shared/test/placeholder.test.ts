import { describe, expect, it } from 'vitest';
import { isISODate, isMonth, minor } from '../src/index.ts';

describe('shared placeholder types', () => {
  it('brands integer minor units and rejects fractions', () => {
    expect(minor(1250)).toBe(1250);
    expect(() => minor(12.5)).toThrow(RangeError);
    expect(isISODate('2026-10-08')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
  });
});
