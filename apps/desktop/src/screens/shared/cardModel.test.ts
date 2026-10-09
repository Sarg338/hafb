import { describe, expect, it } from 'vitest';
import { planBudget } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { activityLines, cardBalance, cardHeader, paymentActivity, paymentGap, recordPaymentAmount } from './cardModel.ts';

const sample = buildSamplePlan().plan;
const state = planBudget(sample, { today: SAMPLE_TODAY });
const month = state.currentMonth;
const ms = state.byMonth[month];
const visa = sample.accounts.find((a) => a.name === 'Visa Rewards');
const pay = sample.categories.find((c) => c.creditCardAccountId === visa?.id);
const cat = (name: string): string => sample.categories.find((c) => c.name === name)?.id ?? '';

describe('credit card display data (S4.7)', () => {
  it("the payment category's activity breakdown adds up to its Activity", () => {
    const cm = ms?.categories[pay?.id ?? ''];
    if (!cm) throw new Error('sample has a payment category');
    const a = paymentActivity(cm);
    expect(a).not.toBeNull();
    expect((a?.funded ?? 0) + (a?.paymentsAndReturns ?? 0)).toBe(cm.activity);
    expect(a?.totalSpending).toBe((cm.creditCard?.spending ?? 0) + (cm.creditCard?.returns ?? 0));
    expect(paymentActivity({ categoryId: cm.categoryId, assigned: cm.assigned, activity: cm.activity, available: cm.available, carriedIn: cm.carriedIn, cashActivity: cm.cashActivity, creditActivity: cm.creditActivity, overspending: cm.overspending })).toBeNull();
  });

  it("a category's activity lines are its transactions (split lines at their own amount) and add up to its Activity", () => {
    for (const name of ['Groceries', 'Dining Out', 'Clothing']) {
      const lines = activityLines(sample, cat(name), month);
      expect(lines.reduce((s, l) => s + l.amount, 0), name).toBe(ms?.categories[cat(name)]?.activity);
      for (let i = 1; i < lines.length; i++) expect((lines[i - 1]?.date ?? '') >= (lines[i]?.date ?? '')).toBe(true);
    }
    expect(activityLines(sample, cat('Clothing'), month).some((l) => l.id !== l.transactionId)).toBe(true);
  });

  it("a payment category lists its card's spending, returns and payments, not its starting balance", () => {
    const lines = activityLines(sample, pay?.id ?? '', month);
    const cc = ms?.categories[pay?.id ?? '']?.creditCard;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe((cc?.spending ?? 0) + (cc?.returns ?? 0) + (cc?.payments ?? 0));
    expect(lines.every((l) => l.account === 'Visa Rewards' && l.payee !== 'Starting Balance')).toBe(true);
  });

  it('Record Payment pre-fills the lower of Available and the cleared debt; the header pills', () => {
    const cm = ms?.categories[pay?.id ?? ''];
    const cleared = state.accountBalances[visa?.id ?? '']?.cleared ?? 0;
    expect(recordPaymentAmount(sample, state, visa?.id ?? '')).toBe(Math.max(0, Math.min(cm?.available ?? 0, 0 - cleared)));
    const head = cardHeader(sample, state, visa?.id ?? '');
    expect(head).toMatchObject({ month, payment: cm?.available, overspending: cm?.creditCard?.unfundedSpending });
    expect(head?.underfunded).toBe(cm ? paymentGap(cm).gap > 0 : false);
    expect(cardHeader(sample, state, sample.accounts.find((a) => a.name === 'Everyday Checking')?.id ?? '')).toBeNull();
  });

  it("the card's Current Balance breakdown ends at its balance and starts at last month's", () => {
    const cm = ms?.categories[pay?.id ?? ''];
    const prev = state.byMonth[state.months[state.months.indexOf(month) - 1] ?? month]?.categories[pay?.id ?? ''];
    const b = cm ? cardBalance(cm) : null;
    expect(b?.current).toBe(cm?.creditCard?.balance);
    expect(b?.prior).toBe(prev?.creditCard?.balance);
    expect((b?.prior ?? 0) + (b?.spending ?? 0) + (b?.inflows ?? 0)).toBe(b?.current);
  });

  it("YNAB's own popover numbers (trial, 2026-10-08): visa spent $80, got $20 back, was paid $50", () => {
    const base = { categoryId: 'p', assigned: 0, carriedIn: 0, cashActivity: 0, creditActivity: 0, overspending: { cash: 0, credit: 0 } };
    const visaMonth = { ...base, activity: 1_000, available: 1_000, creditCard: { accountId: 'c', balance: -1_000, fundedSpending: 6_000, payments: 5_000, unfundedSpending: 0, spending: -8_000, returns: 2_000 } };
    // YNAB: Spending −$80.00, Returns +$20.00, Total Spending −$60.00 | Funded Spending +$60.00,
    // Payments & Returns −$50.00, Total Activity +$10.00.
    expect(paymentActivity(visaMonth as never)).toEqual({ spending: -8_000, returns: 2_000, totalSpending: -6_000, funded: 6_000, paymentsAndReturns: -5_000, total: 1_000 });
  });

  it('Credit Card Interest (§3.15): in the summary on its own, and in the balance lines', () => {
    const base = { categoryId: 'p', assigned: 0, activity: 0, available: 0, carriedIn: 0, cashActivity: 0, creditActivity: 0, overspending: { cash: 0, credit: 0 } };
    const card = { accountId: 'c', fundedSpending: 0, payments: 0, unfundedSpending: 0, spending: -3_000, returns: 0, interest: -1_234, balance: -14_234 };
    const cm = { ...base, creditCard: card } as never;
    expect(paymentActivity(cm)).toMatchObject({ interest: -1_234, totalSpending: -3_000, total: 0 });
    expect(cardBalance(cm)).toEqual({ prior: -10_000, spending: -4_234, inflows: 0, current: -14_234 });
    expect(cardBalance({ ...base, creditCard: { ...card, interest: 500, balance: -12_500 } } as never)).toEqual({ prior: -10_000, spending: -3_000, inflows: 500, current: -12_500 });
  });

  it('the pay-in-full gap: what the card owes beyond the money set aside', () => {
    const base = { categoryId: 'p', assigned: 0, activity: 0, carriedIn: 0, cashActivity: 0, creditActivity: 0, overspending: { cash: 0, credit: 0 } };
    const card = { accountId: 'c', fundedSpending: 0, payments: 0, unfundedSpending: 0, spending: 0, returns: 0 };
    // YNAB trial: amex owes $50 with $40 set aside → $10 short; visa owes $10 with $10 → even.
    expect(paymentGap({ ...base, available: 4_000, creditCard: { ...card, balance: -5_000 } } as never)).toEqual({ owed: 5_000, gap: 1_000 });
    expect(paymentGap({ ...base, available: 1_000, creditCard: { ...card, balance: -1_000 } } as never)).toEqual({ owed: 1_000, gap: 0 });
    expect(paymentGap({ ...base, available: 500, creditCard: { ...card, balance: 2_000 } } as never)).toEqual({ owed: 0, gap: 0 });
  });
});
