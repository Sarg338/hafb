// Worked examples for loan math (CLAUDE.md §5.10, docs/budget-math.md §10). Amounts are cents,
// rates are basis points (600 = 6.00% a year).
import { minor } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import {
  amortizationSchedule,
  loanPlannerComparison,
  monthlyInterest,
  payoffSummary,
  payoffTotals,
  requiredPaymentForPayoff,
  type LoanTerms,
} from '../src/loans.ts';

const m = minor;

/** 1,000.00 owed at 12% a year (1% a month), paying 300.00 a month. */
const small: LoanTerms = { principal: m(100_000), aprBps: 1200, monthlyPayment: m(30_000) };

describe('§10.1 monthly interest', () => {
  it('is balance × rate / 12, rounded half away from zero, in integer math', () => {
    expect(monthlyInterest(m(10_000_000), 600)).toBe(50_000); // 100,000.00 at 6% → 500.00
    expect(monthlyInterest(m(12_345), 500)).toBe(51); // 51.4375 → 51
    expect(monthlyInterest(m(100), 600)).toBe(1); // exactly 0.5 → 1
    expect(monthlyInterest(m(0), 600)).toBe(0);
    expect(() => monthlyInterest(m(100), 12.5)).toThrow(RangeError);
  });
});

describe('§10.2 amortization (interest and escrow first, then principal)', () => {
  it('pays 1,000.00 at 12% off in four months with 22.48 of interest', () => {
    const rows = amortizationSchedule(small, '2026-01');
    expect(rows).toEqual([
      { month: '2026-01', payment: 30_000, interest: 1_000, escrow: 0, fees: 0, principal: 29_000, balance: 71_000 },
      { month: '2026-02', payment: 30_000, interest: 710, escrow: 0, fees: 0, principal: 29_290, balance: 41_710 },
      { month: '2026-03', payment: 30_000, interest: 417, escrow: 0, fees: 0, principal: 29_583, balance: 12_127 },
      { month: '2026-04', payment: 12_248, interest: 121, escrow: 0, fees: 0, principal: 12_127, balance: 0 },
    ]);
    expect(payoffSummary(small, '2026-01')).toEqual({ payoffMonth: '2026-04', months: 4, totalInterest: 2_248, totalPaid: 102_248 });
  });

  it('takes escrow and fees before principal', () => {
    const rows = amortizationSchedule({ ...small, escrow: m(5_000), fees: m(500) }, '2026-01');
    expect(rows[0]).toEqual({ month: '2026-01', payment: 30_000, interest: 1_000, escrow: 5_000, fees: 500, principal: 23_500, balance: 76_500 });
  });

  it('applies extra monthly and one-time payments to principal', () => {
    const rows = amortizationSchedule(small, '2026-01', { extraMonthly: m(10_000), oneTime: [{ month: '2026-02', amount: m(5_000) }] });
    // M1: 1,000 interest, 39,000 principal → 61,000. M2: 610 interest, 44,390 principal → 16,610.
    // M3: 166 interest; 16,776 due ≤ 40,000 → paid off.
    expect(rows.map((r) => [r.payment, r.interest, r.balance])).toEqual([
      [40_000, 1_000, 61_000],
      [45_000, 610, 16_610],
      [16_776, 166, 0],
    ]);
  });

  it('refuses a payment that never reduces the balance', () => {
    expect(() => amortizationSchedule({ ...small, monthlyPayment: m(1_000) }, '2026-01')).toThrow(ValidationError);
    expect(() => amortizationSchedule({ ...small, monthlyPayment: m(900) }, '2026-01')).toThrow(ValidationError);
  });

  it('a zero balance has no schedule', () => {
    expect(amortizationSchedule({ ...small, principal: m(0) }, '2026-01')).toEqual([]);
  });
});

describe('§10.3 payoff calculator and loan planner', () => {
  it('finds the smallest monthly payment that pays off by a target month', () => {
    // Two months: P = 507.51 leaves 502.49, interest 5.02 → 507.51 due. P = 507.50 leaves 502.50,
    // interest 5.025 → 5.03 → 507.53 due, one month too many.
    const p = requiredPaymentForPayoff(small, '2026-01', '2026-02');
    expect(p).toBe(50_751);
    expect(payoffSummary({ ...small, monthlyPayment: p }, '2026-01').payoffMonth).toBe('2026-02');
    expect(payoffSummary({ ...small, monthlyPayment: m(p - 1) }, '2026-01').payoffMonth).toBe('2026-03');
    expect(requiredPaymentForPayoff(small, '2026-01', '2026-01')).toBe(101_000); // pay it all, with interest
    expect(() => requiredPaymentForPayoff(small, '2026-03', '2026-01')).toThrow(ValidationError);
  });

  it('compares a plan with an extra payment: interest and months saved', () => {
    // Extra 100.00 a month: M1 1,000 int → 61,000; M2 610 → 21,610; M3 216 → paid. 18.26 interest.
    expect(loanPlannerComparison(small, '2026-01', { extraMonthly: m(10_000) })).toEqual({
      base: { payoffMonth: '2026-04', months: 4, totalInterest: 2_248, totalPaid: 102_248 },
      withExtra: { payoffMonth: '2026-03', months: 3, totalInterest: 1_826, totalPaid: 101_826 },
      interestSaved: 422,
      monthsSaved: 1,
    });
  });
});

describe('§10.5 the Loan Payoff Simulator totals (YNAB trial, 2026-10-08)', () => {
  it('reproduces YNAB to the cent: $200,000 at 6%, $1,200 principal and interest', () => {
    // YNAB: Interest Remaining $231,096.44, Remaining to Pay $431,096.43, 30 years (360 payments).
    expect(payoffTotals(minor(20_000_000), 600, minor(120_000))).toEqual({ months: 360, remainingToPay: 43_109_643, interest: 23_109_644 });
  });

  it('a payment that never covers the interest has no totals; no interest is simple division', () => {
    expect(payoffTotals(minor(20_000_000), 600, minor(100_000))).toBeNull();
    expect(payoffTotals(minor(120_000), 0, minor(10_000))).toEqual({ months: 12, remainingToPay: 120_000, interest: 0 });
    expect(payoffTotals(minor(0), 600, minor(10_000))).toEqual({ months: 0, remainingToPay: 0, interest: 0 });
  });
});
