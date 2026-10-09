import { describe, expect, it } from 'vitest';
import { minor } from '@hafb/shared';
import type { AccountRecord } from '@hafb/store';
import { buildSamplePlan } from '../../design/sample.ts';
import { currentTrack, durationText, loanProgress, loanTerms, missingLoanDetails, paymentForPayoff, payoffMonths, simulate, trackSentence } from './loanModel.ts';

const T0 = '2026-10-08T12:00:00.000Z';
// The YNAB trial's mortgage: $200,000 at 6%, $1,500 minimum including $300 escrow.
const house: AccountRecord = {
  id: 'house',
  name: 'house',
  type: 'mortgage',
  onBudget: false,
  sortOrder: 0,
  createdAt: T0,
  loan: { interestRateBps: 600, minimumPayment: minor(150_000), escrow: minor(30_000) },
};
const today = '2026-10-08';

describe('loan accounts (S6.4)', () => {
  it('needs a rate and a minimum payment, else the gear shows what’s missing', () => {
    expect(missingLoanDetails(house)).toEqual([]);
    expect(missingLoanDetails({ ...house, loan: {} })).toEqual(['Interest Rate', 'Minimum Payment']);
    expect(missingLoanDetails({ ...house, type: 'checking' })).toEqual([]);
    expect(loanTerms({ ...house, loan: { interestRateBps: 600 } }, minor(-100))).toBeNull();
    expect(loanTerms(house, minor(0))).toBeNull(); // paid off
  });

  it('the current track matches YNAB’s loan page: Oct 2056, 30 years (payments from next month)', () => {
    const terms = loanTerms(house, minor(-20_000_000));
    if (!terms) throw new Error('no terms');
    const track = currentTrack(terms, today);
    expect(track.ok && track.value.summary.payoffMonth).toBe('2056-10');
    expect(track.ok && track.value.summary.months).toBe(360);
    expect(trackSentence('$1,500.00', track)).toBe('The minimum payment of $1,500.00 will pay off this loan in 30 years.');
    // YNAB shows $231,096.44 interest; the engine's documented model is $0.50 higher (budget-math §13 Q7).
    expect(track.ok && track.value.summary.totalInterest).toBe(23_109_694);
    expect(track.ok && track.value.remainingToPay).toBe(20_000_000 + 23_109_694);
  });

  it('the simulator: paying more saves interest and time; a one-time extra comes off the principal now', () => {
    const terms = loanTerms(house, minor(-20_000_000));
    if (!terms) throw new Error('no terms');
    const more = simulate(terms, today, minor(200_000), minor(0));
    expect(more.ok).toBe(true);
    if (!more.ok) return;
    expect(more.value.plan.summary.months).toBeLessThan(360);
    expect(more.value.interestSaved).toBe(more.value.base.summary.totalInterest - more.value.plan.summary.totalInterest);
    expect(more.value.monthsSaved).toBe(360 - more.value.plan.summary.months);
    const lump = simulate(terms, today, minor(150_000), minor(20_000_000));
    expect(lump.ok && lump.value.plan.summary.months).toBe(0);
    const short = simulate(terms, today, minor(100_000), minor(0)); // below interest + escrow
    expect(short.ok).toBe(false);
  });

  it('picking a payoff month gives the payment that gets there, never below the minimum', () => {
    const terms = loanTerms(house, minor(-20_000_000));
    if (!terms) throw new Error('no terms');
    expect(paymentForPayoff(terms, today, '2056-10')).toBe(150_000);
    const tenYears = paymentForPayoff(terms, today, '2036-10');
    expect(tenYears).toBeGreaterThan(150_000);
    const check = simulate(terms, today, tenYears, minor(0));
    expect(check.ok && check.value.plan.summary.payoffMonth <= '2036-10').toBe(true);
    const months = payoffMonths(terms, today);
    expect(months[0]).toBe('2026-11');
    expect(months.at(-1)).toBe('2056-10');
  });

  it('progress: balance, share of the original and month-end history', () => {
    const plan = buildSamplePlan().plan;
    const loan = plan.accounts.find((a) => a.type === 'mortgage');
    if (!loan) throw new Error('no mortgage in the sample');
    const p = loanProgress(plan, loan, '2026-10-14');
    expect(p.balance).toBeLessThan(0);
    expect(p.history.at(-1)?.balance).toBe(p.balance);
    if (p.remainingShare !== null) expect(p.remainingShare).toBeGreaterThan(0);
  });

  it('durations read like YNAB', () => {
    expect(durationText(360)).toBe('30 years');
    expect(durationText(27)).toBe('2 years, 3 months');
    expect(durationText(1)).toBe('1 month');
  });
});
