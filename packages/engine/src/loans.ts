// Loan interest, amortization, payoff calculator and Loan Planner: CLAUDE.md §5.10.
// Worked examples: docs/budget-math.md §10.
//
// YNAB states it "will calculate the monthly interest charge" and that interest (and escrow or
// fees) "must be covered first", with the rest going to principal
// (https://support.ynab.com/en_us/loan-accounts-in-ynab-a-guide-HkNSkPHJi). It does not publish
// the accrual formula. ASSUMPTION: simple monthly accrual, interest = balance × rate ÷ 12 on the
// balance at the start of the month, rounded half away from zero to the cent. Verify against a
// real lender statement (roadmap S6.4) before relying on it to the cent.
import { addMonths, compareMonths, divRound, minor, monthsBetween, mul, ZERO, type Minor, type Month } from '@hafb/shared';
import { ValidationError } from './errors.ts';

/** Longest schedule we will compute: 100 years of monthly payments. */
export const MAX_LOAN_MONTHS = 1200;

export interface LoanTerms {
  /** Amount owed, positive. */
  principal: Minor;
  /** Annual interest rate in basis points (6.25% = 625). YNAB asks for the rate, not the APR. */
  aprBps: number;
  /** Total monthly payment, including escrow and fees. */
  monthlyPayment: Minor;
  /** Monthly escrow (taxes, insurance): covered before principal, never reduces it. */
  escrow?: Minor;
  /** Other monthly fees: covered before principal. */
  fees?: Minor;
}

export interface ExtraPayments {
  /** Added to every month's payment. */
  extraMonthly?: Minor;
  oneTime?: readonly { month: Month; amount: Minor }[];
}

export interface AmortizationRow {
  month: Month;
  payment: Minor;
  interest: Minor;
  escrow: Minor;
  fees: Minor;
  principal: Minor;
  /** Balance owed after this month's payment. */
  balance: Minor;
}

export interface PayoffSummary {
  payoffMonth: Month;
  months: number;
  totalInterest: Minor;
  totalPaid: Minor;
}

/** balance × aprBps ÷ 10,000 ÷ 12, half away from zero; integer math only. */
export function monthlyInterest(balance: Minor, aprBps: number): Minor {
  if (!Number.isSafeInteger(aprBps) || aprBps < 0) {
    throw new RangeError(`aprBps must be a non-negative integer: ${String(aprBps)}`);
  }
  return divRound(mul(balance, aprBps), 120_000);
}

type Schedule = { rows: AmortizationRow[] } | { stalled: Month } | { tooLong: true };

function schedule(terms: LoanTerms, startMonth: Month, extra: ExtraPayments): Schedule {
  const escrow = terms.escrow ?? ZERO;
  const fees = terms.fees ?? ZERO;
  const oneTime = new Map<Month, number>();
  for (const p of extra.oneTime ?? []) oneTime.set(p.month, (oneTime.get(p.month) ?? 0) + p.amount);
  const rows: AmortizationRow[] = [];
  let balance: number = terms.principal;
  let month = startMonth;
  while (balance > 0) {
    if (rows.length >= MAX_LOAN_MONTHS) return { tooLong: true };
    const interest = monthlyInterest(minor(balance), terms.aprBps);
    const charges = interest + escrow + fees;
    const planned = terms.monthlyPayment + (extra.extraMonthly ?? 0) + (oneTime.get(month) ?? 0);
    if (planned <= charges) return { stalled: month };
    const payment = Math.min(planned, balance + charges);
    const principal = payment - charges;
    balance -= principal;
    rows.push({
      month,
      payment: minor(payment),
      interest,
      escrow,
      fees,
      principal: minor(principal),
      balance: minor(balance),
    });
    month = addMonths(month, 1);
  }
  return { rows };
}

/**
 * Month-by-month schedule until the balance reaches zero. Each month interest accrues on the
 * opening balance, then the payment covers interest, escrow and fees before principal; the final
 * payment is only what is owed.
 */
export function amortizationSchedule(terms: LoanTerms, startMonth: Month, extra: ExtraPayments = {}): AmortizationRow[] {
  const s = schedule(terms, startMonth, extra);
  if ('stalled' in s) {
    throw new ValidationError(`In ${s.stalled} the payment does not cover interest, escrow and fees, so the loan never pays off`);
  }
  if ('tooLong' in s) throw new ValidationError(`The loan takes more than ${String(MAX_LOAN_MONTHS)} months to pay off`);
  return s.rows;
}

function summarize(rows: readonly AmortizationRow[], startMonth: Month): PayoffSummary {
  let interest = 0;
  let paid = 0;
  for (const r of rows) {
    interest += r.interest;
    paid += r.payment;
  }
  return {
    payoffMonth: rows.at(-1)?.month ?? startMonth,
    months: rows.length,
    totalInterest: minor(interest),
    totalPaid: minor(paid),
  };
}

export function payoffSummary(terms: LoanTerms, startMonth: Month, extra: ExtraPayments = {}): PayoffSummary {
  return summarize(amortizationSchedule(terms, startMonth, extra), startMonth);
}

/**
 * Smallest total monthly payment that pays the loan off in `targetMonth` or earlier (YNAB's
 * "pick a payoff date" calculator). Binary search: a bigger payment never pays off later.
 */
export function requiredPaymentForPayoff(terms: LoanTerms, startMonth: Month, targetMonth: Month): Minor {
  if (compareMonths(targetMonth, startMonth) < 0) {
    throw new ValidationError(`Payoff month ${targetMonth} is before the first payment month ${startMonth}`);
  }
  const allowed = monthsBetween(startMonth, targetMonth) + 1;
  const firstCharges = monthlyInterest(terms.principal, terms.aprBps) + (terms.escrow ?? 0) + (terms.fees ?? 0);
  const paysOffInTime = (payment: number): boolean => {
    const s = schedule({ ...terms, monthlyPayment: minor(payment) }, startMonth, {});
    return 'rows' in s && s.rows.length <= allowed;
  };
  let lo = firstCharges + 1;
  let hi = terms.principal + firstCharges; // pays everything in the first month
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (paysOffInTime(mid)) hi = mid;
    else lo = mid + 1;
  }
  return minor(hi);
}

export interface LoanPlannerComparison {
  base: PayoffSummary;
  withExtra: PayoffSummary;
  interestSaved: Minor;
  monthsSaved: number;
}

/** Loan Planner what-if: the same loan with extra payments. */
export function loanPlannerComparison(terms: LoanTerms, startMonth: Month, extra: ExtraPayments): LoanPlannerComparison {
  const base = payoffSummary(terms, startMonth);
  const withExtra = payoffSummary(terms, startMonth, extra);
  return {
    base,
    withExtra,
    interestSaved: minor(base.totalInterest - withExtra.totalInterest),
    monthsSaved: base.months - withExtra.months,
  };
}
