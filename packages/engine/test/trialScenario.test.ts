// The YNAB trial scenario (docs/ynab-trial-scenario.md), encoded so HAFB's predictions are
// fixed *before* Sarg enters the same steps in YNAB. The snapshot file freezes every predicted
// number; when YNAB's numbers come back they are compared with these, not fitted to them.
// HAFB_PRINT_PREDICTIONS=1 prints the predictions as markdown for the doc.
import { asISODate, minor, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import {
  ageOfMoney,
  autoAssign,
  computeBudget,
  evaluateTargets,
  freshStart,
  incomeVsExpense,
  monthlyInterest,
  monthState,
  netWorth,
  payoffSummary,
  READY_TO_ASSIGN,
  spendingBreakdown,
  type BudgetSnapshot,
  type Target,
} from '../src/index.ts';
import { plan } from './helpers.ts';

const TODAY = asISODate('2026-10-08');
const CATS = ['groceries', 'dining', 'fuel', 'rent', 'phone', 'streaming', 'subs', 'gifts', 'vacation', 'carfund', 'emergency', 'house'];

export function trialSnapshot(): BudgetSnapshot {
  const b = plan('2026-10')
    .account('checking')
    .card('visa')
    .card('amex')
    .account('mortgage', 'mortgage', false)
    .category(...CATS);
  // Sarg's existing "bank" account was created with $1,000; the cards start at $0 and the
  // mortgage at $200,000 owed. YNAB records each as a "Starting Balance" transaction dated the
  // day the account was added (2026-10-08), even when it is $0.
  b.txn('2026-10-08', 'checking', 100_000, READY_TO_ASSIGN)
    .txn('2026-10-08', 'visa', 0, READY_TO_ASSIGN)
    .txn('2026-10-08', 'amex', 0, READY_TO_ASSIGN)
    .txn('2026-10-08', 'mortgage', -20_000_000, null);
  // Step 4: income.
  b.income('2026-10-01', 50_000).income('2026-10-02', 100_000).income('2026-10-04', 300_000);
  // Step 5: spending.
  b.spend('2026-10-03', 12_000, 'groceries')
    .spend('2026-10-03', 8_000, 'dining', 'visa')
    .spend('2026-10-05', 5_000, 'dining', 'amex')
    .spend('2026-10-05', 20_000, 'fuel')
    .split('2026-10-06', 'checking', [
      { amount: -6_000, categoryId: 'groceries' },
      { amount: -3_000, categoryId: 'phone' },
    ])
    .transfer('2026-10-06', 5_000, 'checking', 'visa')
    .spend('2026-10-07', 120_000, 'rent')
    .txn('2026-10-07', 'visa', 2_000, 'dining')
    .spend('2026-10-08', 1_500, 'streaming')
    .spend('2026-10-08', 2_500, 'groceries')
    .spend('2026-10-08', 1_000, 'groceries')
    .spend('2026-10-08', 500, 'phone')
    .spend('2026-10-08', 3_500, 'fuel');
  // Step 3: October assignments.
  const oct: [string, number][] = [
    ['groceries', 40_000], ['dining', 10_000], ['fuel', 15_000], ['rent', 120_000], ['phone', 6_000], ['streaming', 2_000],
    ['gifts', 5_000], ['vacation', 10_000], ['carfund', 5_000], ['emergency', 10_000], ['house', 20_000],
  ];
  for (const [c, a] of oct) b.assign('2026-10', c, a);
  return b.build();
}

export const trialTargets: Target[] = [
  { categoryId: 'groceries', amount: minor(10_000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill', startMonth: '2026-10' },
  { categoryId: 'dining', amount: minor(10_000), cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside', startMonth: '2026-10' },
  { categoryId: 'fuel', amount: minor(15_000), cadence: { kind: 'monthly', day: 15 }, behavior: 'refill', startMonth: '2026-10' },
  { categoryId: 'phone', amount: minor(6_000), cadence: { kind: 'monthly', day: 22 }, behavior: 'setAside', startMonth: '2026-10' },
  { categoryId: 'streaming', amount: minor(2_000), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside', startMonth: '2026-10', snoozedMonths: ['2026-10'] },
  { categoryId: 'gifts', amount: minor(60_000), cadence: { kind: 'yearly', due: asISODate('2026-12-10') }, behavior: 'refill', startMonth: '2026-10' },
  { categoryId: 'vacation', amount: minor(120_000), cadence: { kind: 'custom', due: asISODate('2027-06-01') }, behavior: 'setAside', startMonth: '2026-10' },
  { categoryId: 'carfund', amount: minor(30_000), cadence: { kind: 'custom', due: asISODate('2027-02-01'), repeatEveryMonths: 6 }, behavior: 'setAside', startMonth: '2026-10' },
  { categoryId: 'emergency', amount: minor(100_000), cadence: { kind: 'custom', due: asISODate('2027-03-01') }, behavior: 'haveBalance', startMonth: '2026-10' },
  { categoryId: 'house', amount: minor(500_000), cadence: { kind: 'custom' }, behavior: 'haveBalance', startMonth: '2026-10' },
];

const dollars = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

function predictions() {
  const snapshot = trialSnapshot();
  const state = computeBudget(snapshot, { today: TODAY, throughMonth: '2026-12' });
  const out: Record<string, string | number | null> = {};
  for (const m of ['2026-10', '2026-11'] as Month[]) {
    const ms = monthState(state, m);
    out[`${m} Ready to Assign`] = dollars(ms.readyToAssign);
    for (const [k, v] of Object.entries(ms.breakdown) as [string, number][]) out[`${m} RTA breakdown: ${k}`] = dollars(v);
    for (const id of [...CATS, 'pay:visa', 'pay:amex']) {
      const c = ms.categories[id];
      if (c) out[`${m} ${id}: assigned / activity / available`] = `${dollars(c.assigned)} / ${dollars(c.activity)} / ${dollars(c.available)}`;
    }
    const evaluated = evaluateTargets(trialTargets, ms, (c, mm) => monthState(state, mm).categories[c]?.assigned ?? minor(0));
    for (const t of trialTargets) {
      const e = evaluated[t.categoryId];
      if (e) out[`${m} target ${t.categoryId}`] = `needed ${dollars(e.needed)}, funded ${dollars(e.funded)}, to go ${dollars(e.toGo)}, assign this month ${dollars(e.neededThisMonth)}, underfunded ${dollars(e.underfunded)}, ${String(e.progressPercent)}%, ${e.status}`;
    }
    const underfunded = autoAssign('underfunded', { state, month: m, categoryIds: CATS, targets: trialTargets, evaluated, scheduledOutflows: { subs: minor(1_500) } });
    out[`${m} Auto-Assign Underfunded total`] = dollars(underfunded.total);
  }
  out['2026-12 Auto-Assign Average Assigned for phone (Oct $60, Nov $0)'] = dollars(
    autoAssign('averageAssigned', { state, month: '2026-12', categoryIds: ['phone'] }).deltas[0]?.delta ?? 0,
  );
  // The first four transactions are the starting balances (see trialSnapshot).
  const sb = new Set(snapshot.transactions.slice(0, 4).map((t) => t.id));
  out['Age of Money on 2026-10-08 (days)'] = ageOfMoney(snapshot, TODAY, { startingBalanceIds: sb });
  const sbd = spendingBreakdown(snapshot, { from: '2026-10', to: '2026-10' });
  out['Reflect Spending Breakdown Oct total'] = dollars(sbd.total);
  const ive = incomeVsExpense(snapshot, { from: '2026-10', to: '2026-10' }, { startingBalanceIds: sb });
  out['Reflect Income v Expense Oct: income / expenses / net'] = `${dollars(ive.income.total)} / ${dollars(ive.expense.total)} / ${dollars(ive.netIncome.total)}`;
  const nw = netWorth(snapshot, { from: '2026-10', to: '2026-10' })[0];
  if (nw) out['Reflect Net Worth Oct: assets / debts / net'] = `${dollars(nw.assets)} / ${dollars(nw.debts)} / ${dollars(nw.netWorth)}`;
  const loan = payoffSummary({ principal: minor(20_000_000), aprBps: 600, monthlyPayment: minor(150_000), escrow: minor(30_000) }, '2026-11');
  out['Mortgage payoff ($200,000 @ 6.00%, $1,500/mo incl. $300 escrow, from Nov 2026)'] = `${loan.payoffMonth}, ${String(loan.months)} payments, total interest ${dollars(loan.totalInterest)}`;
  out['Mortgage first month interest'] = dollars(monthlyInterest(minor(20_000_000), 600));
  const fresh = computeBudget(freshStart(snapshot, state, TODAY), { today: TODAY });
  out['After Fresh Start: Ready to Assign'] = dollars(monthState(fresh, '2026-10').readyToAssign);
  for (const a of ['checking', 'visa', 'amex']) out[`After Fresh Start: ${a} balance`] = dollars(fresh.accountBalances[a]?.working ?? 0);
  return out;
}

describe('YNAB trial scenario predictions (frozen before comparing with YNAB)', () => {
  it('matches the frozen predictions', () => {
    const p = predictions();
    if (process.env.HAFB_PRINT_PREDICTIONS) {
      console.info(['| # | Value | HAFB predicts |', '|---|---|---|', ...Object.entries(p).map(([k, v], i) => `| P${String(i + 1)} | ${k} | ${String(v)} |`)].join('\n'));
    }
    expect(p).toMatchSnapshot();
  });
});
