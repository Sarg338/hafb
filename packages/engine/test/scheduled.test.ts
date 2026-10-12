// Worked examples for CLAUDE.md §5.11 (scheduled transactions). Matches
// docs/budget-math-parts/s1.6-transactions.md §8.1. Amounts are cents.
import { asISODate, minor, type ISODate } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { computeBudget, monthState } from '../src/budget.ts';
import { ValidationError } from '../src/errors.ts';
import type { Account } from '../src/model.ts';
import {
  availableAfterUpcoming,
  dueTransactions,
  nextOccurrence,
  occurrencesBetween,
  upcomingByCategory,
  upcomingDetails,
  upcomingShortfalls,
  type Frequency,
  type ScheduledTransaction,
} from '../src/scheduled.ts';
import { plan } from './helpers.ts';

const d = asISODate;

function sched(over: Partial<ScheduledTransaction> & { frequency: Frequency; date: ISODate }): ScheduledTransaction {
  return {
    id: 'rent',
    accountId: 'checking',
    amount: minor(-100_000),
    categoryId: 'rent',
    ...over,
  };
}

describe('nextOccurrence: every frequency', () => {
  it.each<[Frequency, string, string | null]>([
    ['never', '2026-03-10', null],
    ['daily', '2026-03-31', '2026-04-01'],
    ['weekly', '2026-03-28', '2026-04-04'],
    ['everyOtherWeek', '2026-03-28', '2026-04-11'],
    ['every4Weeks', '2026-12-20', '2027-01-17'],
    ['monthly', '2026-03-10', '2026-04-10'],
    ['everyOtherMonth', '2026-11-10', '2027-01-10'],
    ['every3Months', '2026-03-10', '2026-06-10'],
    ['every4Months', '2026-03-10', '2026-07-10'],
    ['twiceAYear', '2026-03-10', '2026-09-10'],
    ['yearly', '2026-01-01', '2027-01-01'],
    ['everyOtherYear', '2026-01-01', '2028-01-01'],
  ])('%s after %s → %s', (frequency, from, expected) => {
    expect(nextOccurrence(frequency, d(from))).toBe(expected);
  });

  it('the 31st repeats on the last day of shorter months and returns to the 31st', () => {
    expect(nextOccurrence('monthly', d('2026-01-31'))).toBe('2026-02-28');
    expect(nextOccurrence('monthly', d('2026-02-28'), 31)).toBe('2026-03-31');
    expect(nextOccurrence('monthly', d('2026-03-31'), 31)).toBe('2026-04-30');
    expect(nextOccurrence('monthly', d('2024-01-31'), 31)).toBe('2024-02-29');
    expect(nextOccurrence('yearly', d('2024-02-29'), 29)).toBe('2025-02-28');
    expect(nextOccurrence('everyOtherYear', d('2026-02-28'), 29)).toBe('2028-02-29');
  });

  it('twice a month: two fixed days 15 apart, the later one clamped to month end (YNAB trial, 2026-10-12)', () => {
    const walk = (from: string, anchor: number, n: number): string[] => {
      const out: string[] = [];
      let date = d(from);
      for (let i = 0; i < n; i += 1) {
        const next = nextOccurrence('twiceAMonth', date, anchor);
        if (next === null) break;
        out.push(next);
        date = next;
      }
      return out;
    };
    // YNAB's example: the 5th and the 20th.
    expect(walk('2026-03-05', 5, 3)).toEqual(['2026-03-20', '2026-04-05', '2026-04-20']);
    // Started Oct 20 in YNAB: Nov 5, Nov 20 (not "15 days later", which would give Nov 4).
    expect(walk('2026-10-20', 20, 2)).toEqual(['2026-11-05', '2026-11-20']);
    // Started Oct 31 in YNAB: the 16th and the last day, every month.
    expect(walk('2026-10-31', 31, 8)).toEqual(['2026-11-16', '2026-11-30', '2026-12-16', '2026-12-31', '2027-01-16', '2027-01-31', '2027-02-16', '2027-02-28']);
    // The 15th pairs with the 30th, and February's 30th is its last day.
    expect(walk('2027-01-30', 15, 3)).toEqual(['2027-02-15', '2027-02-28', '2027-03-15']);
  });
});

describe('occurrencesBetween', () => {
  it('lists occurrences from the next date inside an inclusive window', () => {
    const s = sched({ frequency: 'everyOtherWeek', date: d('2026-03-06') });
    expect(occurrencesBetween(s, d('2026-03-10'), d('2026-04-30'))).toEqual(['2026-03-20', '2026-04-03', '2026-04-17']);
    expect(occurrencesBetween(s, d('2026-03-06'), d('2026-03-06'))).toEqual(['2026-03-06']);
    expect(occurrencesBetween(sched({ frequency: 'never', date: d('2026-03-06') }), d('2026-01-01'), d('2026-12-31'))).toEqual(['2026-03-06']);
    expect(occurrencesBetween(s, d('2026-05-01'), d('2026-04-01'))).toEqual([]);
  });
});

describe('dueTransactions (§5.11: due items become unapproved transactions; no prompt)', () => {
  const accounts: Account[] = [
    { id: 'checking', name: 'Checking', type: 'checking', onBudget: true },
    { id: 'wallet', name: 'Wallet', type: 'cash', onBudget: true },
  ];

  it('creates one unapproved, uncleared transaction per due occurrence with deterministic ids', () => {
    const s = sched({ frequency: 'monthly', date: d('2026-01-31'), anchorDay: 31 });
    const result = dueTransactions([s], d('2026-03-31'), accounts);
    expect(result.transactions.map((t) => [t.id, t.date, t.approved, t.cleared])).toEqual([
      ['rent:2026-01-31', '2026-01-31', false, 'uncleared'],
      ['rent:2026-02-28', '2026-02-28', false, 'uncleared'],
      ['rent:2026-03-31', '2026-03-31', false, 'uncleared'],
    ]);
    expect(result.updates).toEqual([{ scheduledId: 'rent', nextDate: '2026-04-30' }]);
  });

  it('nothing is due before its date; "never" schedules are consumed (next date null)', () => {
    const later = sched({ id: 'later', frequency: 'monthly', date: d('2026-04-01') });
    const once = sched({ id: 'once', frequency: 'never', date: d('2026-03-01') });
    const result = dueTransactions([later, once], d('2026-03-15'), accounts);
    expect(result.transactions.map((t) => t.id)).toEqual(['once:2026-03-01']);
    expect(result.updates).toEqual([{ scheduledId: 'once', nextDate: null }]);
  });

  it('copies splits and transfers; cash-account items are created cleared (YNAB guide)', () => {
    const split = sched({
      id: 'split',
      accountId: 'wallet',
      frequency: 'weekly',
      date: d('2026-03-02'),
      amount: minor(-3_000),
      categoryId: null,
      subtransactions: [
        { id: 'a', amount: minor(-2_000), categoryId: 'groceries' },
        { id: 'b', amount: minor(-1_000), categoryId: null, transferAccountId: 'checking' },
      ],
    });
    const [tx] = dueTransactions([split], d('2026-03-02'), accounts).transactions;
    expect(tx).toMatchObject({ id: 'split:2026-03-02', cleared: 'cleared', approved: false, amount: -3_000 });
    expect(tx?.subtransactions).toEqual([
      { id: 'a:2026-03-02', amount: -2_000, categoryId: 'groceries' },
      { id: 'b:2026-03-02', amount: -1_000, categoryId: null, transferAccountId: 'checking' },
    ]);
  });

  it('skips deleted schedules and rejects unknown accounts', () => {
    expect(dueTransactions([sched({ frequency: 'daily', date: d('2026-03-01'), deleted: true })], d('2026-03-05'), accounts).transactions).toEqual([]);
    expect(() => dueTransactions([sched({ frequency: 'daily', date: d('2026-03-01'), accountId: 'nope' })], d('2026-03-01'), accounts)).toThrow(ValidationError);
  });
});

describe('upcoming within the month (§5.11 shortfall warning)', () => {
  const schedules: ScheduledTransaction[] = [
    sched({ id: 'phone', frequency: 'monthly', date: d('2026-03-25'), amount: minor(-6_000), categoryId: 'bills' }),
    sched({ id: 'gym', frequency: 'everyOtherWeek', date: d('2026-03-12'), amount: minor(-2_000), categoryId: 'fun' }),
    sched({ id: 'past', frequency: 'monthly', date: d('2026-03-01'), amount: minor(-9_999), categoryId: 'bills' }), // already due, not upcoming
    sched({ id: 'refund', frequency: 'never', date: d('2026-03-20'), amount: minor(1_000), categoryId: 'fun' }),
  ];

  it('sums occurrences after today through month end, per category, signed', () => {
    // gym: Mar 12 (past), Mar 26 → −20; refund +10 on Mar 20; phone −60 on Mar 25.
    expect(upcomingByCategory(schedules, '2026-03', d('2026-03-15'))).toEqual({ bills: -6_000, fun: -1_000 });
    // YNAB doesn't project scheduled transactions into future months (trial 2026-11).
    expect(upcomingByCategory(schedules, '2026-04', d('2026-03-15'))).toEqual({});
  });

  it('counts the upcoming transactions too (YNAB inspector: "1 Upcoming Transaction")', () => {
    expect(upcomingDetails(schedules, '2026-03', d('2026-03-15'))).toEqual({ bills: { amount: -6_000, count: 1 }, fun: { amount: -1_000, count: 2 } });
    expect(upcomingDetails(schedules, '2026-04', d('2026-03-15'))).toEqual({});
  });

  it('available after upcoming, and the categories that would go negative', () => {
    const s = plan()
      .account('checking')
      .category('bills', 'fun')
      .income('2026-03-01', 100_000)
      .assign('2026-03', 'bills', 5_000)
      .assign('2026-03', 'fun', 3_000)
      .build();
    const month = monthState(computeBudget(s, { today: d('2026-03-15') }), '2026-03');
    const upcoming = upcomingByCategory(schedules, '2026-03', d('2026-03-15'));
    expect(availableAfterUpcoming(month, upcoming)).toEqual({ bills: -1_000, fun: 2_000 });
    expect(upcomingShortfalls(month, upcoming)).toEqual(['bills']);
  });
});
