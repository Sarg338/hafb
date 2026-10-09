// Loan accounts in the register (S6.4), pure. YNAB's loan page (trial, 2026-10-08): Remaining
// Balance, Interest Rate, Minimum Payment, Escrow, Payoff Date; "Your Loan's Progress" (balance
// remaining with its share of the original, the current track, "The minimum payment of $X will
// pay off this loan in N years"); the Loan Payoff Simulator (monthly payment ↔ payoff date, a
// one-time extra this month; interest remaining, time remaining, remaining to pay = principal +
// interest, "Escrow amounts are not included"); a gear when details are missing.
import { accountBalances, amortizationSchedule, payoffSummary, requiredPaymentForPayoff, type AmortizationRow, type LoanTerms, type PayoffSummary } from '@hafb/engine';
import { addMonths, compareMonths, minor, monthOf, monthsBetween, neg, sub, ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import { budgetSnapshot, isLoanAccount, type AccountRecord, type PlanData } from '@hafb/store';

/** What's owed on a loan balance (debt is negative): never below zero. */
export const owed = (balance: Minor): Minor => (balance < 0 ? neg(balance) : ZERO);

/** Details YNAB asks for before it can project a loan ("Monthly Minimum, Interest Rate…"). */
export function missingLoanDetails(a: AccountRecord): string[] {
  if (!isLoanAccount(a)) return [];
  const out: string[] = [];
  if (a.loan?.interestRateBps === undefined) out.push('Interest Rate');
  if (a.loan?.minimumPayment === undefined) out.push('Minimum Payment');
  return out;
}

/** The loan as the engine models it from today's balance; null without a rate, a payment or a debt. */
export function loanTerms(a: AccountRecord, balance: Minor): LoanTerms | null {
  const l = a.loan;
  if (!isLoanAccount(a) || l?.interestRateBps === undefined || l.minimumPayment === undefined || balance >= 0) return null;
  return {
    principal: neg(balance),
    aprBps: l.interestRateBps,
    monthlyPayment: l.minimumPayment,
    ...(l.escrow === undefined ? {} : { escrow: l.escrow }),
    ...(l.fees === undefined ? {} : { fees: l.fees }),
  };
}

/** "30 years", "2 years, 3 months", "8 months", "1 month". */
export function durationText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const part = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? '' : 's'}`;
  if (y === 0) return part(m, 'month');
  return m === 0 ? part(y, 'year') : `${part(y, 'year')}, ${part(m, 'month')}`;
}

export interface Projection {
  /** Payments start next month (YNAB: 360 payments from Oct 2026 end in Oct 2056). */
  start: Month;
  rows: AmortizationRow[];
  summary: PayoffSummary;
  /** Principal + interest, escrow and fees left out (as YNAB's "Remaining to Pay"). */
  remainingToPay: Minor;
}

export type ProjectionResult = { ok: true; value: Projection } | { ok: false; reason: string };

function project(terms: LoanTerms, start: Month, extra: { extraMonthly?: Minor } = {}): ProjectionResult {
  try {
    const rows = amortizationSchedule(terms, start, extra);
    const summary = payoffSummary(terms, start, extra);
    return { ok: true, value: { start, rows, summary, remainingToPay: minor(terms.principal + summary.totalInterest) } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** The current track: minimum payments from next month. */
export function currentTrack(terms: LoanTerms, today: ISODate): ProjectionResult {
  return project(terms, addMonths(monthOf(today), 1));
}

export interface Simulation {
  base: Projection;
  plan: Projection;
  interestSaved: Minor;
  monthsSaved: number;
}

/**
 * The Payoff Simulator: a monthly payment (at least the minimum) and a one-time extra paid this
 * month, which comes straight off the principal before the first projected payment.
 */
export function simulate(terms: LoanTerms, today: ISODate, monthlyPayment: Minor, oneTimeExtra: Minor): { ok: true; value: Simulation } | { ok: false; reason: string } {
  const start = addMonths(monthOf(today), 1);
  const base = project(terms, start);
  if (!base.ok) return base;
  const principal = sub(terms.principal, oneTimeExtra);
  if (principal <= 0) {
    const empty: Projection = { start, rows: [], summary: { payoffMonth: monthOf(today), months: 0, totalInterest: minor(0), totalPaid: minor(0) }, remainingToPay: minor(0) };
    return { ok: true, value: { base: base.value, plan: empty, interestSaved: base.value.summary.totalInterest, monthsSaved: base.value.summary.months } };
  }
  const plan = project({ ...terms, principal, monthlyPayment }, start);
  if (!plan.ok) return plan;
  return {
    ok: true,
    value: {
      base: base.value,
      plan: plan.value,
      interestSaved: minor(base.value.summary.totalInterest - plan.value.summary.totalInterest),
      monthsSaved: base.value.summary.months - plan.value.summary.months,
    },
  };
}

/** Pick a payoff month: the smallest total monthly payment that gets there (never below the minimum). */
export function paymentForPayoff(terms: LoanTerms, today: ISODate, payoff: Month): Minor {
  const start = addMonths(monthOf(today), 1);
  const target = compareMonths(payoff, start) < 0 ? start : payoff;
  const need = requiredPaymentForPayoff(terms, start, target);
  return need < terms.monthlyPayment ? terms.monthlyPayment : need;
}

/** Payoff months to offer: next month through the current track's payoff. */
export function payoffMonths(terms: LoanTerms, today: ISODate): Month[] {
  const track = currentTrack(terms, today);
  const start = addMonths(monthOf(today), 1);
  const end = track.ok ? track.value.summary.payoffMonth : addMonths(start, 12 * 40);
  const out: Month[] = [];
  for (let m = start; compareMonths(m, end) <= 0; m = addMonths(m, 1)) out.push(m);
  return out;
}

export interface LoanProgress {
  balance: Minor;
  /** What's still owed, as a share of the original principal (null without one). */
  remainingShare: number | null;
  /** Month-end balances from the loan's first month through this month. */
  history: { month: Month; balance: Minor }[];
}

export function loanProgress(plan: PlanData, account: AccountRecord, today: ISODate): LoanProgress {
  const snapshot = budgetSnapshot(plan);
  const live = plan.transactions.filter((t) => t.accountId === account.id && t.deletedAt === undefined);
  const now = monthOf(today);
  const first = live.reduce((m, t) => (compareMonths(monthOf(t.date), m) < 0 ? monthOf(t.date) : m), now);
  const rows = accountBalances(snapshot, { from: first, to: now, accountIds: [account.id] })[0]?.byMonth ?? [];
  const history = rows.map((balance, i) => ({ month: addMonths(first, i), balance }));
  const balance = minor(live.filter((t) => compareMonths(monthOf(t.date), now) <= 0).reduce((s, t) => s + t.amount, 0));
  const original = account.loan?.originalPrincipal;
  const opening = history[0]?.balance;
  const base = original !== undefined && original > 0 ? original : opening !== undefined && opening < 0 ? neg(opening) : undefined;
  return { balance, remainingShare: base === undefined ? null : owed(balance) / base, history };
}

/** "The minimum payment of $1,500.00 will pay off this loan in 30 years." */
export function trackSentence(minimum: string, track: ProjectionResult): string {
  return track.ok ? `The minimum payment of ${minimum} will pay off this loan in ${durationText(track.value.summary.months)}.` : `The minimum payment of ${minimum} doesn’t cover the interest, so this loan never pays off.`;
}

/** Months between two months, for the "N payments remaining" line. */
export const paymentsBetween = (start: Month, end: Month): number => monthsBetween(start, end) + 1;
