import { describe, expect, it } from 'vitest';
import { minor } from '@hafb/shared';
import { runningBalances } from '../src/balances.ts';

describe('runningBalances', () => {
  it('adds up oldest first, with same-day transactions in entry order', () => {
    const b = runningBalances([
      { id: 'c', date: '2026-10-03', amount: minor(-2_500) },
      { id: 'a', date: '2026-10-01', amount: minor(100_000) },
      { id: 'b', date: '2026-10-03', amount: minor(-1_000) },
      { id: 'd', date: '2026-10-02', amount: minor(0) },
    ]);
    expect([...b.entries()]).toEqual([
      ['a', 100_000],
      ['d', 100_000],
      ['c', 97_500],
      ['b', 96_500],
    ]);
  });

  it('is empty for no transactions', () => {
    expect(runningBalances([]).size).toBe(0);
  });
});
