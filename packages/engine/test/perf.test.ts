// Performance budget (CLAUDE.md §8): one full recompute < 50 ms for 5 years × 100
// categories. The plan below is that size with 20,000 transactions across cash accounts and
// three credit cards, plus an assignment for every category every month.
import { addMonths, asISODate, makeDate, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { computeBudget, READY_TO_ASSIGN } from '../src/index.ts';
import { plan } from './helpers.ts';

function largePlan() {
  const b = plan().account('checking').account('savings', 'savings');
  const cards = ['visa', 'amex', 'disc'];
  for (const c of cards) b.card(c);
  const cats = Array.from({ length: 100 }, (_, i) => `c${String(i)}`);
  b.category(...cats);
  const start: Month = '2021-10';
  let seed = 42;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let m = 0; m < 60; m += 1) {
    const month = addMonths(start, m);
    const [y, mm] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
    b.income(makeDate(y, mm, 1), 900_000);
    for (const c of cats) b.assign(month, c, 6_000 + Math.floor(next() * 4_000));
    b.transfer(makeDate(y, mm, 20), 250_000, 'checking', cards[m % 3] ?? 'visa');
  }
  for (let i = 0; i < 20_000 - 180; i += 1) { // 60 incomes + 120 transfer legs above
    const month = addMonths(start, Math.floor(next() * 60));
    const date = makeDate(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1 + Math.floor(next() * 28));
    const account = next() < 0.6 ? (cards[Math.floor(next() * 3)] ?? 'visa') : 'checking';
    const amount = next() < 0.05 ? 1 + Math.floor(next() * 5_000) : -(1 + Math.floor(next() * 15_000));
    b.txn(date, account, amount, next() < 0.01 ? READY_TO_ASSIGN : `c${String(Math.floor(next() * 100))}`);
  }
  return b.build();
}

// GitHub's shared runners are slower and noisy (73 ms seen there, 13 ms on Sarg's PC), so CI
// only catches a big regression; the 50 ms budget is checked on real machines.
const BUDGET_MS = process.env.CI ? 150 : 50;

describe('performance budget', () => {
  it(`recomputes 5 years × 100 categories with 20k transactions in < ${String(BUDGET_MS)} ms (median of 7)`, () => {
    const snapshot = largePlan();
    expect(snapshot.transactions.length).toBe(20_000);
    const options = { today: asISODate('2026-09-30') };
    for (let i = 0; i < 3; i += 1) computeBudget(snapshot, options); // warm up the JIT
    const times: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const t0 = performance.now();
      const state = computeBudget(snapshot, options);
      times.push(performance.now() - t0);
      expect(state.months.length).toBe(60);
    }
    times.sort((a, b) => a - b);
    const median = times[3] ?? Number.POSITIVE_INFINITY;
    console.info(`computeBudget median ${median.toFixed(1)} ms (min ${(times[0] ?? 0).toFixed(1)}, max ${(times[6] ?? 0).toFixed(1)})`);
    expect(median).toBeLessThan(BUDGET_MS);
  });
});
