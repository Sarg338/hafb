// Property test: the plan always reconciles to real account balances (docs/budget-math.md §5).
//
//   RTAcore(m) + Σ available(m) = cash balances(m) + RTA inflows on cards(≤m) − credit overspending(m)
//
// where RTAcore = Ready to Assign before subtracting future-month assignments. Random plans
// are generated with a seeded PRNG so failures are reproducible.
import { addMonths, asISODate, makeDate, monthOf, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { budgetThrough, computeBudget, monthState, READY_TO_ASSIGN, transactionLines, type BudgetSnapshot, type CategoryRef } from '../src/index.ts';
import { plan } from './helpers.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CASH = ['checking', 'savings'];
const CARDS = ['visa', 'amex'];
const CATS = ['a', 'b', 'c', 'd'];
const START: Month = '2026-01';

function randomPlan(seed: number): BudgetSnapshot {
  const r = mulberry32(seed);
  const int = (n: number) => Math.floor(r() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] ?? (xs[0] as T);
  const b = plan().account('checking').account('savings', 'savings').account('brokerage', 'asset', false);
  for (const c of CARDS) b.card(c);
  b.category(...CATS);
  const date = () => {
    const m = addMonths(START, int(6));
    return makeDate(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1 + int(28));
  };
  const amount = () => 1 + int(50_000);
  const catRef = (): CategoryRef => (r() < 0.08 ? null : pick(CATS));
  for (let i = 0; i < 60; i += 1) {
    const kind = int(11);
    const d = date();
    if (kind === 0) b.income(d, amount(), pick(CASH));
    else if (kind <= 3) b.txn(d, pick(CASH), -amount(), catRef());
    else if (kind <= 5) b.txn(d, pick(CARDS), -amount(), catRef());
    else if (kind === 6) b.txn(d, pick([...CASH, ...CARDS]), amount(), catRef()); // refunds / inflows to categories
    else if (kind === 7) b.transfer(d, amount(), pick([...CASH, ...CARDS]), pick([...CASH, ...CARDS]));
    else if (kind === 8) b.txn(d, pick(CARDS), r() < 0.5 ? amount() : -amount(), READY_TO_ASSIGN);
    else if (kind === 9) b.transfer(d, amount(), pick(CASH), 'brokerage', pick(CATS));
    else
      b.split(d, pick([...CASH, ...CARDS]), [
        { amount: -amount(), categoryId: pick(CATS) },
        { amount: r() < 0.5 ? -amount() : amount(), categoryId: catRef() },
      ]);
  }
  for (let m = 0; m < 7; m += 1) {
    for (const c of [...CATS, ...CARDS.map((x) => `pay:${x}`)]) {
      if (r() < 0.6) b.assign(addMonths(START, m), c, int(60_000) - (r() < 0.1 ? 70_000 : 0));
    }
  }
  return b.build();
}

describe('reconciliation identity (property, 400 random plans)', () => {
  it('holds for every month of every plan', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      // Self-transfers make no sense; drop them so the generator stays simple.
      const raw = randomPlan(seed);
      const snapshot: BudgetSnapshot = {
        ...raw,
        transactions: raw.transactions.filter((t) => t.transferAccountId !== t.accountId),
      };
      const state = computeBudget(snapshot, { today: asISODate('2026-06-30') });
      const cardSet = new Set(CARDS);
      for (const month of state.months) {
        const ms = monthState(state, month);
        let cash = 0;
        let cardRta = 0;
        for (const tx of snapshot.transactions) {
          if (tx.deleted || monthOf(tx.date) > month) continue;
          if (CASH.includes(tx.accountId)) cash += tx.amount;
          if (cardSet.has(tx.accountId)) {
            for (const line of transactionLines(tx)) if (line.categoryId === READY_TO_ASSIGN) cardRta += line.amount;
          }
        }
        let creditOver = 0;
        for (const c of Object.values(ms.categories)) creditOver += c.overspending.credit;
        const rtaCore = ms.readyToAssign + ms.breakdown.assignedInFuture;
        expect({ seed, month, lhs: rtaCore + ms.totals.available }).toEqual({ seed, month, lhs: cash + cardRta - creditOver });
      }
    }
  });
});

// More properties on the same random plans (roadmap S8.2).
function cleanPlan(seed: number): BudgetSnapshot {
  const raw = randomPlan(seed);
  return { ...raw, transactions: raw.transactions.filter((t) => t.transferAccountId !== t.accountId) };
}

describe('budget properties (S8.2, 400 random plans)', () => {
  const today = asISODate('2026-06-30');

  it('each category carries forward per §5.1, and overspending splits into credit and cash', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const state = computeBudget(cleanPlan(seed), { today });
      const prev = new Map<string, number>();
      for (const month of state.months) {
        const ms = monthState(state, month);
        let activity = 0;
        let available = 0;
        for (const c of Object.values(ms.categories)) {
          const at = `${String(seed)} ${month} ${c.categoryId}`;
          expect(c.carriedIn, at).toBe(Math.max(prev.get(c.categoryId) ?? 0, 0));
          expect(c.available, at).toBe(c.carriedIn + c.assigned + c.activity);
          expect(c.activity, at).toBe(c.cashActivity + c.creditActivity);
          expect(c.overspending.cash + c.overspending.credit, at).toBe(Math.max(0, 0 - c.available));
          expect(c.overspending.credit, at).toBeGreaterThanOrEqual(0);
          expect(c.overspending.cash, at).toBeGreaterThanOrEqual(0);
          prev.set(c.categoryId, c.available);
          activity += c.activity;
          available += c.available;
        }
        expect(ms.totals.activity).toBe(activity);
        expect(ms.totals.available).toBe(available);
        const b = ms.breakdown;
        expect(ms.readyToAssign).toBe(b.leftOverFromLastMonth - b.cashOverspendingLastMonth + b.inflows - b.assignedThisMonth - b.assignedInFuture);
      }
    }
  });

  it('a card payment category reports the card balance at month end', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const snapshot = cleanPlan(seed);
      const state = computeBudget(snapshot, { today });
      for (const month of state.months) {
        for (const c of Object.values(monthState(state, month).categories)) {
          const card = c.creditCard;
          if (!card) continue;
          const balance = snapshot.transactions.filter((t) => !t.deleted && t.accountId === card.accountId && monthOf(t.date) <= month).reduce((s, t) => s + t.amount, 0);
          expect(card.balance, `${String(seed)} ${month} ${card.accountId}`).toBe(balance);
        }
      }
    }
  });

  it('the order of assignments never matters, and a longer computation cut short is exact', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const snapshot = cleanPlan(seed);
      const state = computeBudget(snapshot, { today });
      expect(computeBudget({ ...snapshot, assignments: [...snapshot.assignments].reverse() }, { today })).toEqual(state);
      const wide = computeBudget(snapshot, { today, throughMonth: '2026-12' });
      expect(budgetThrough(wide, state.dataThrough)).toEqual(state);
      expect(budgetThrough(wide, '2026-10')).toEqual(computeBudget(snapshot, { today, throughMonth: '2026-10' }));
    }
  });
});
