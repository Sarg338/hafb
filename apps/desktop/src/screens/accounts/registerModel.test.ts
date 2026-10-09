import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN } from '@hafb/engine';
import { minor } from '@hafb/shared';
import { addTransaction, applyChanges, editTransaction, planBudget, type CommandContext, type PlanData } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { draftFor, registerRows, toInput, toPatch, transferLabel, transferNeedsCategory } from './registerModel.ts';

let n = 0;
const ctx: CommandContext = { now: '2026-10-14T16:00:00.000Z', today: SAMPLE_TODAY, newId: () => `reg-${String((n += 1))}` };
const sample = buildSamplePlan().plan;
const acct = (name: string): string => sample.accounts.find((a) => a.name === name)?.id ?? '';
const cat = (name: string): string => sample.categories.find((c) => c.name === name)?.id ?? '';

describe('registerRows', () => {
  it('lists every live transaction newest first (All Accounts has no running balance)', () => {
    const rows = registerRows(sample, { accountId: null });
    expect(rows).toHaveLength(sample.transactions.filter((t) => t.deletedAt === undefined).length);
    for (let i = 1; i < rows.length; i++) expect((rows[i - 1]?.date ?? '') >= (rows[i]?.date ?? '')).toBe(true);
    expect(rows.every((r) => r.balance === undefined)).toBe(true);
  });

  it("a single account's running balance ends at its working balance", () => {
    const id = acct('Everyday Checking');
    const rows = registerRows(sample, { accountId: id });
    expect(rows[0]?.balance).toBe(planBudget(sample, { today: SAMPLE_TODAY }).accountBalances[id]?.working);
    const oldest = rows.at(-1);
    expect(oldest?.balance).toBe(oldest?.amount);
  });

  it('labels transfers, payments and starting balances like YNAB', () => {
    const checking = registerRows(sample, { accountId: acct('Everyday Checking') });
    const toLoan = checking.find((r) => r.payee === 'Transfer : Car Loan');
    expect(toLoan?.category).toEqual({ text: 'Car Payment', tone: 'plain' });
    expect(toLoan?.transfer).toBe(true);
    const loan = registerRows(sample, { accountId: acct('Car Loan') }).find((r) => r.payee === 'Transfer : Everyday Checking');
    expect(loan?.category.text).toBe('Category not needed');
    const visaStart = registerRows(sample, { accountId: acct('Visa Rewards') }).find((r) => r.payee === 'Starting Balance');
    expect(visaStart?.category).toEqual({ text: 'Category not needed', tone: 'muted' });
    expect(checking.find((r) => r.payee === 'Starting Balance')?.category.text).toBe('Inflow: Ready to Assign');
    expect(transferLabel(sample.accounts.find((a) => a.name === 'Everyday Checking'), sample.accounts.find((a) => a.name === 'Visa Rewards'))).toBe('Payment: Visa Rewards');
    expect(transferLabel(sample.accounts.find((a) => a.name === 'Visa Rewards'), sample.accounts.find((a) => a.name === 'Everyday Checking'))).toBe('Payment: Everyday Checking');
  });

  it('shows split lines and locks the amount and category of a split', () => {
    const split = registerRows(sample, { accountId: null }).find((r) => r.splits.length === 3);
    expect(split?.category.text).toBe('Split (3)');
    expect(split?.splits.reduce((s, l) => s + l.amount, 0)).toBe(split?.amount);
    expect(split?.locks).toMatchObject({ amount: true, category: true });
  });

  it('filters by text and to unapproved transactions', () => {
    expect(registerRows(sample, { accountId: null, query: 'taco' }).every((r) => r.payee === 'Taco Stand')).toBe(true);
    expect(registerRows(sample, { accountId: null, onlyUnapproved: true }).every((r) => !r.approved)).toBe(true);
    expect(registerRows(sample, { accountId: null, query: 'school socks' })).toHaveLength(1); // a split line's memo
  });
});

describe('drafts', () => {
  const apply = (p: PlanData, c: { changes: Parameters<typeof applyChanges>[1] }): PlanData => applyChanges(p, c.changes).plan;

  it('a new outflow becomes an addTransaction input', () => {
    const d = { ...draftFor(null, { accountId: acct('Everyday Checking'), date: SAMPLE_TODAY }), payeeName: 'Corner Bakery', categoryId: cat('Groceries'), outflow: minor(1234) };
    const input = toInput(sample, d);
    expect(input).toMatchObject({ amount: -1234, payeeName: 'Corner Bakery', categoryId: cat('Groceries') });
    const p = apply(sample, addTransaction(sample, ctx, input));
    expect(registerRows(p, { accountId: acct('Everyday Checking'), query: 'corner bakery' })[0]?.amount).toBe(-1234);
  });

  it('a transfer between two budget accounts drops the category; budget → tracking keeps it', () => {
    expect(transferNeedsCategory(sample, acct('Everyday Checking'), acct('Rainy Day Savings'))).toBe(false);
    expect(transferNeedsCategory(sample, acct('Everyday Checking'), acct('Car Loan'))).toBe(true);
    const d = { ...draftFor(null, { accountId: acct('Everyday Checking'), date: SAMPLE_TODAY }), transferAccountId: acct('Rainy Day Savings'), categoryId: cat('Groceries'), outflow: minor(5000) };
    expect(toInput(sample, d)).toMatchObject({ transferAccountId: acct('Rainy Day Savings'), categoryId: null, amount: -5000 });
  });

  it('an edit patches only what changed, and saving approves', () => {
    const t = sample.transactions.find((x) => x.approved === false);
    if (!t) throw new Error('sample has an unapproved transaction');
    const d = { ...draftFor(t, { accountId: t.accountId, date: t.date }), memo: 'Birthday gift' };
    const patch = toPatch(sample, t, d);
    expect(patch).toEqual({ memo: 'Birthday gift', approved: true });
    const p = apply(sample, editTransaction(sample, ctx, { transactionId: t.id, patch }));
    expect(p.transactions.find((x) => x.id === t.id)).toMatchObject({ memo: 'Birthday gift' });
    expect(toPatch(sample, t, draftFor(t, { accountId: t.accountId, date: t.date }))).toEqual({ approved: true });
  });

  it('a Ready to Assign inflow keeps its category', () => {
    const t = sample.transactions.find((x) => x.categoryId === READY_TO_ASSIGN && x.isStartingBalance !== true);
    if (!t) throw new Error('sample has income');
    const d = draftFor(t, { accountId: t.accountId, date: t.date });
    expect(toPatch(sample, t, { ...d, inflow: minor(d.inflow + 100) })).toEqual({ amount: t.amount + 100 });
  });
});
