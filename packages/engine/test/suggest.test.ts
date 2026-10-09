// Suggested target amounts from history (CLAUDE.md §5.4 "Edit Plan can suggest target amounts from
// historical spending"; YNAB Feb 2025: "suggested amounts … based on your past spending").
import { describe, expect, it } from 'vitest';
import { computeBudget, suggestTargetAmount } from '../src/index.ts';
import { plan } from './helpers.ts';

describe('suggestTargetAmount', () => {
  const build = () =>
    plan()
      .account('checking')
      .category('fuel', 'gifts', 'quiet')
      .income('2026-01-01', 500_000)
      .spend('2026-07-03', 4_000, 'fuel', 'checking')
      .spend('2026-08-03', 5_000, 'fuel', 'checking')
      .spend('2026-09-03', 6_001, 'fuel', 'checking')
      .spend('2026-09-20', 3_000, 'gifts', 'checking')
      .txn('2026-09-25', 'checking', 1_000, 'gifts') // a refund lowers what was spent
      .spend('2026-10-02', 99_999, 'fuel', 'checking') // the current month doesn't count
      .build();
  const state = computeBudget(build(), { today: '2026-10-08' });

  it('averages the last three complete months of spending, rounded half up', () => {
    // (40.00 + 50.00 + 60.01) / 3 = 50.0033… → 50.00
    expect(suggestTargetAmount(state, 'fuel', '2026-10')).toBe(5_000);
    // Gifts spent 20.00 net in September only: (0 + 0 + 20.00) / 3 = 6.666… → 6.67
    expect(suggestTargetAmount(state, 'gifts', '2026-10')).toBe(667);
  });

  it('no spending, or no earlier months, suggests nothing', () => {
    expect(suggestTargetAmount(state, 'quiet', '2026-10')).toBeNull();
    expect(suggestTargetAmount(state, 'fuel', '2026-01')).toBeNull();
  });
});
