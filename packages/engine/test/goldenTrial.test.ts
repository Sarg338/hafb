// Golden test #2: Sarg's YNAB trial plan (2026-10-08), built from docs/ynab-trial-scenario.md.
// Expectations are the numbers YNAB displayed (read from the live plan) plus its Plan.csv.
// Local-only data in test/fixtures/local/ynab-trial/ (git-ignored); skipped when absent.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asISODate, minor, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import {
  ageOfMoney,
  autoAssign,
  computeBudget,
  costToBeMe,
  evaluateTargets,
  freshStart,
  incomeVsExpense,
  monthState,
  netWorth,
  parseYnabPlan,
  parseYnabRegister,
  payoffSummary,
  payoffTotals,
  READY_TO_ASSIGN,
  spendingBreakdown,
  upcomingByCategory,
  ynabExportToSnapshot,
  type ScheduledTransaction,
  type Target,
} from '../src/index.ts';

const dir = fileURLToPath(new URL('./fixtures/local/ynab-trial/', import.meta.url));
const exportDir = join(dir, 'export');
const present = existsSync(join(dir, 'observed.json')) && existsSync(exportDir);

interface TargetObs { needed: number; funded: number; toGo: number; met?: boolean; assignMore?: number; percent?: number }
interface Observed {
  today: string;
  readyToAssign: Record<string, number>;
  rtaBreakdown: Record<string, { inflows: number; assignedThisMonth: number; total: number }>;
  summary: Record<string, { leftOver: number; assigned: number; activity: number; available: number; costToBeMe?: number }>;
  autoAssign: Record<string, { underfunded: number; assignedLastMonth: number; spentLastMonth: number; averageAssigned: number; averageSpent: number }>;
  targets: Record<string, Record<string, TargetObs>>;
  upcoming: Record<string, Record<string, number>>;
  reports: {
    spendingBreakdownOct: { total: number; categories: Record<string, number>; rentPercent: number };
    incomeVsExpenseOct: { income: number; expense: number };
    netWorthOct: { assets: number; debts: number; net: number; change: number };
    ageOfMoney: number | null;
  };
  loan: { payoff: string; payments: number; interest: number };
  followUps?: { ageOfMoneyAfterFuelFix: number; groceriesAt350: { assignMore: number; toGo: number } };
  freshStart?: {
    readyToAssign: number;
    balances: Record<string, number>;
    startingBalance: { date: string; amount: number };
    costToBeMe: number;
    underfunded: number;
    nextMonthCostToBeMe: number;
  };
}

/** "🛒 Groceries" → "Groceries" */
const plainName = (name: string) => name.replace(/^[^\p{L}\p{N}]+/u, '').trim();

describe.skipIf(!present)('golden: Sarg’s YNAB trial plan (local only)', () => {
  const obs = JSON.parse(readFileSync(join(dir, 'observed.json'), 'utf8')) as Observed;
  const files = present ? readdirSync(exportDir) : [];
  const read = (suffix: string) => readFileSync(join(exportDir, files.find((f) => f.endsWith(suffix)) ?? ''), 'utf8');
  const plan = present ? parseYnabPlan(read('Plan.csv')) : [];
  const register = present ? parseYnabRegister(read('Register.csv')) : [];
  const today = asISODate(obs.today);
  const imported = ynabExportToSnapshot(plan, register, { today, accountTypes: { house: 'mortgage' } });
  const snapshot = imported.snapshot;
  const state = computeBudget(snapshot, { today, throughMonth: '2026-11' });
  const idByName = new Map<string, string>();
  for (const c of snapshot.categories) idByName.set(plainName(c.name), c.id);
  const id = (name: string) => {
    const v = idByName.get(name);
    if (!v) throw new Error(`no category ${name}`);
    return v;
  };
  const paymentIds = new Set(snapshot.categories.filter((c) => c.creditCardAccountId !== undefined).map((c) => c.id));
  const allIds = snapshot.categories.map((c) => c.id);

  // Targets exactly as Sarg created them on 2026-10-08.
  const created = { startMonth: '2026-10' as Month, createdOn: asISODate('2026-10-08') };
  const targets: Target[] = [
    { categoryId: id('Groceries'), amount: minor(10_000), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill', ...created },
    { categoryId: id('Transportation'), amount: minor(15_000), cadence: { kind: 'monthly', day: 15 }, behavior: 'refill', ...created },
    { categoryId: id('Phone & Internet'), amount: minor(6_000), cadence: { kind: 'monthly', day: 22 }, behavior: 'setAside', ...created },
    { categoryId: id('Dining out'), amount: minor(10_000), cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside', ...created },
    { categoryId: id('Entertainment'), amount: minor(2_000), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside', ...created },
    { categoryId: id('Gifts'), amount: minor(60_000), cadence: { kind: 'yearly', due: asISODate('2026-12-10') }, behavior: 'refill', ...created },
    { categoryId: id('Car Fund'), amount: minor(30_000), cadence: { kind: 'custom', due: asISODate('2027-02-01'), repeatEveryMonths: 6 }, behavior: 'setAside', ...created },
    { categoryId: id('Emergency fund'), amount: minor(100_000), cadence: { kind: 'custom', due: asISODate('2027-03-01') }, behavior: 'haveBalance', ...created },
    { categoryId: id('Vacation'), amount: minor(120_000), cadence: { kind: 'custom', due: asISODate('2027-06-01') }, behavior: 'haveBalance', ...created },
    { categoryId: id('House Down Payment'), amount: minor(500_000), cadence: { kind: 'custom' }, behavior: 'haveBalance', ...created },
  ];
  const scheduled: ScheduledTransaction[] = imported.scheduled.map((r, i) => ({
    id: `sched:${String(i)}`,
    accountId: `acct:${r.account}`,
    date: r.date,
    frequency: 'monthly',
    amount: r.amount,
    categoryId: r.key === '' ? null : r.group === 'Inflow' ? READY_TO_ASSIGN : (imported.categoryIds[r.key] ?? null),
  }));
  const evaluated = (m: Month) =>
    evaluateTargets(targets, monthState(state, m), (c, mm) => monthState(state, mm).categories[c]?.assigned ?? minor(0), { today });
  const scheduledOutflows = (m: Month) => {
    const out: Record<string, ReturnType<typeof minor>> = {};
    for (const [c, v] of Object.entries(upcomingByCategory(scheduled, m, today))) out[c] = minor(0 - v);
    return out;
  };

  it('Plan.csv: Activity and Available for every category match YNAB to the cent', () => {
    for (const row of plan) {
      const c = monthState(state, row.month).categories[imported.categoryIds[row.key] ?? ''];
      expect({ key: row.key, activity: c?.activity, available: c?.available }).toEqual({ key: row.key, activity: row.activity, available: row.available });
    }
  });

  it('Ready to Assign, its breakdown and the month summary', () => {
    for (const [m, v] of Object.entries(obs.readyToAssign)) expect([m, monthState(state, m as Month).readyToAssign]).toEqual([m, v]);
    const oct = monthState(state, '2026-10');
    const b = obs.rtaBreakdown['2026-10'];
    expect([oct.breakdown.inflows, oct.breakdown.assignedThisMonth]).toEqual([b?.inflows, b?.assignedThisMonth]);
    for (const [m, s] of Object.entries(obs.summary)) {
      const ms = monthState(state, m as Month);
      const leftOver = Object.values(ms.categories).reduce((t, c) => t + c.carriedIn, 0);
      expect({ m, leftOver, assigned: ms.totals.assigned, activity: ms.totals.activity, available: ms.totals.available }).toEqual({
        m,
        leftOver: s.leftOver,
        assigned: s.assigned,
        activity: s.activity,
        available: s.available,
      });
    }
  });

  it('targets: every Inspector card YNAB showed (Oct and Nov)', () => {
    for (const [m, cards] of Object.entries(obs.targets)) {
      const ev = evaluated(m as Month);
      for (const [name, o] of Object.entries(cards)) {
        const t = ev[id(name)];
        const got: Record<string, unknown> = { m, name, needed: t?.needed, funded: t?.funded, toGo: t?.toGo };
        const want: Record<string, unknown> = { m, name, needed: o.needed, funded: o.funded, toGo: o.toGo };
        if (o.assignMore !== undefined) {
          got.assignMore = t?.underfunded;
          want.assignMore = o.assignMore;
        }
        if (o.percent !== undefined) {
          got.percent = t?.progressPercent;
          want.percent = o.percent;
        }
        if (o.met) {
          got.met = t?.status === 'funded';
          want.met = true;
        }
        expect(got).toEqual(want);
      }
    }
    expect(costToBeMe(evaluated('2026-10'), minor(0)).targets).toBe(obs.summary['2026-10']?.costToBeMe);
  });

  it('upcoming scheduled transactions per category', () => {
    for (const [m, o] of Object.entries(obs.upcoming)) {
      const named: Record<string, number> = {};
      for (const [c, v] of Object.entries(upcomingByCategory(scheduled, m as Month, today))) {
        named[plainName(snapshot.categories.find((x) => x.id === c)?.name ?? c)] = v;
      }
      expect([m, named]).toEqual([m, o]);
    }
  });

  it('Auto-Assign amounts (nothing selected)', () => {
    for (const [m, o] of Object.entries(obs.autoAssign)) {
      const month = m as Month;
      const input = { state, month, categoryIds: allIds, targets, evaluated: evaluated(month), scheduledOutflows: scheduledOutflows(month), paymentCategoryIds: paymentIds };
      const got = {
        m,
        underfunded: autoAssign('underfunded', input).total,
        assignedLastMonth: autoAssign('assignedLastMonth', input).total,
        spentLastMonth: autoAssign('spentLastMonth', input).total,
        averageAssigned: autoAssign('averageAssigned', input).total,
        averageSpent: autoAssign('averageSpent', input).total,
      };
      expect(got).toEqual({ m, ...o });
    }
  });

  it('Reflect: Spending Breakdown, Income v Expense, Net Worth, Age of Money', () => {
    const sb = spendingBreakdown(snapshot, { from: '2026-10', to: '2026-10' });
    const o = obs.reports.spendingBreakdownOct;
    expect(sb.total).toBe(o.total);
    const cats: Record<string, number> = {};
    for (const g of sb.groups) for (const c of g.categories) cats[plainName(c.name)] = c.spending;
    expect(cats).toEqual(o.categories);
    const rent = sb.groups.flatMap((g) => g.categories).find((c) => plainName(c.name) === 'Rent/Mortgage');
    expect(rent && Math.round((100 * rent.spending) / sb.grossSpending)).toBe(o.rentPercent);
    const ive = incomeVsExpense(snapshot, { from: '2026-10', to: '2026-10' });
    expect([ive.income.total, ive.expense.total]).toEqual([obs.reports.incomeVsExpenseOct.income, obs.reports.incomeVsExpenseOct.expense]);
    const nw = netWorth(snapshot, { from: '2026-10', to: '2026-10' })[0];
    const n = obs.reports.netWorthOct;
    expect(nw && [nw.assets, nw.debts, nw.netWorth, nw.change]).toEqual([n.assets, n.debts, n.net, n.change]);
    expect(ageOfMoney(snapshot, today)).toBe(obs.reports.ageOfMoney);
  });

  it('follow-ups: Age of Money once there are 10 outflows; the weekly creation-date rule', () => {
    const f = obs.followUps;
    if (!f) return;
    // Sarg corrected the Oct 5 fuel purchase to a $200 outflow → 10 outflows → YNAB: 4 days.
    const fixed = register.map((r) => (r.payee === 'Gas Station' && r.date === '2026-10-05' ? { ...r, amount: minor(-20_000) } : r));
    const s2 = ynabExportToSnapshot(plan, fixed, { today, accountTypes: { house: 'mortgage' } }).snapshot;
    expect(ageOfMoney(s2, today)).toBe(f.ageOfMoneyAfterFuelFix);
    // Groceries temporarily assigned $350 in October → YNAB: "Assign $50.00 more", $50 to go.
    const s3 = { ...snapshot, assignments: snapshot.assignments.map((a) => (a.categoryId === id('Groceries') && a.month === '2026-10' ? { ...a, assigned: minor(35_000) } : a)) };
    const st3 = computeBudget(s3, { today, throughMonth: '2026-11' });
    const g = evaluateTargets(targets, monthState(st3, '2026-10'), (c, mm) => monthState(st3, mm).categories[c]?.assigned ?? minor(0), { today })[id('Groceries')];
    expect([g?.underfunded, g?.toGo]).toEqual([f.groceriesAt350.assignMore, f.groceriesAt350.toGo]);
  });

  it('Fresh Start: $0 starting balances; carried-over targets give YNAB’s numbers', () => {
    const f = obs.freshStart;
    if (!f) return;
    const fresh = freshStart(snapshot, state, today);
    const fs = computeBudget(fresh, { today, throughMonth: '2026-11' });
    expect(monthState(fs, '2026-10').readyToAssign).toBe(f.readyToAssign);
    for (const [name, bal] of Object.entries(f.balances)) expect([name, fs.accountBalances[`acct:${name}`]?.working]).toEqual([name, bal]);
    expect(fresh.transactions.every((t) => t.amount === 0 && t.date === f.startingBalance.date && t.isStartingBalance === true)).toBe(true);
    const ev = (m: Month) => evaluateTargets(targets, monthState(fs, m), (c, mm) => monthState(fs, mm).categories[c]?.assigned ?? minor(0), { today });
    expect(costToBeMe(ev('2026-10'), minor(0)).targets).toBe(f.costToBeMe);
    expect(costToBeMe(ev('2026-11'), minor(0)).targets).toBe(f.nextMonthCostToBeMe);
    const input = { state: fs, month: '2026-10' as Month, categoryIds: fresh.categories.map((c) => c.id), targets, evaluated: ev('2026-10'), scheduledOutflows: scheduledOutflows('2026-10'), paymentCategoryIds: paymentIds };
    expect(autoAssign('underfunded', input).total).toBe(f.underfunded);
  });

  it('mortgage payoff: date, payment count and the simulator total interest exact', () => {
    const p = payoffSummary({ principal: minor(20_000_000), aprBps: 600, monthlyPayment: minor(150_000), escrow: minor(30_000) }, '2026-11');
    expect([p.payoffMonth, p.months]).toEqual([obs.loan.payoff, obs.loan.payments]);
    // The month-by-month schedule accrues $0.50 more; YNAB's simulator uses the closed-form
    // annuity (budget-math §10.5), which matches to the cent.
    expect(p.totalInterest - obs.loan.interest).toBe(50);
    expect(payoffTotals(minor(20_000_000), 600, minor(120_000))?.interest).toBe(obs.loan.interest);
  });
});
