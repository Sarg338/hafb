import { describe, expect, it } from 'vitest';
import { addTransaction, closeAccount, createAccount, editAccount, createCategory, createGroup, deleteTransactions, pairLoanCategory, postLoanCharges, recordLoanPayment } from '../src/commands/index.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

describe('loans (§5.10, S6.4)', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(5000), date: '2026-10-01' })).accountId;
    const house = b.run(
      createAccount(b.plan, ctx, {
        name: 'House',
        type: 'mortgage',
        startingBalance: usd(-200000),
        date: '2026-10-08',
        loan: { interestRateBps: 600, minimumPayment: usd(1500), escrow: usd(300) },
      }),
    ).accountId;
    const g = b.run(createGroup(b.plan, ctx, { name: 'Debt' })).groupId;
    const payment = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Mortgage' })).categoryId;
    const other = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Car' })).categoryId;
    return { ctx, b, checking, house, payment, other };
  };
  const charges = (b: Bench, accountId: string) =>
    b.plan.transactions
      .filter((t) => t.accountId === accountId && t.deletedAt === undefined && t.importId?.startsWith('loan-') === true)
      .map((t) => [t.date, b.plan.payees.find((p) => p.id === t.payeeId)?.name, t.amount, t.categoryId]);

  it('posts each month’s interest (on the month-start balance) and escrow on the 1st, once', () => {
    const { ctx, b, house } = setup();
    expect(postLoanCharges(b.plan, ctx)).toBeNull(); // the loan started this month
    const later = { ...ctx, today: '2026-12-05' as const };
    const cmd = postLoanCharges(b.plan, later);
    expect(cmd?.label).toBe('Post loan interest and charges');
    if (cmd) b.run(cmd);
    expect(charges(b, house)).toEqual([
      ['2026-11-01', 'Interest', usd(-1000), null],
      ['2026-11-01', 'Escrow', usd(-300), null],
      ['2026-12-01', 'Interest', usd(-1006.5), null], // on −$201,300.00
      ['2026-12-01', 'Escrow', usd(-300), null],
    ]);
    expect(postLoanCharges(b.plan, later)).toBeNull(); // idempotent
  });

  it('a loan imported from YNAB (chargesFrom) is charged only from that month, not back through its history', () => {
    const { ctx, b, house } = setup();
    const a = b.plan.accounts.find((x) => x.id === house);
    b.run(editAccount(b.plan, ctx, { accountId: house, loan: { ...a?.loan, chargesFrom: '2027-01' } }));
    const cmd = postLoanCharges(b.plan, { ...ctx, today: '2027-02-03' });
    if (cmd) b.run(cmd);
    expect(charges(b, house).map(([date, name]) => `${String(date)} ${String(name)}`)).toEqual(['2027-01-01 Interest', '2027-01-01 Escrow', '2027-02-01 Interest', '2027-02-01 Escrow']);
  });

  it('a back-dated loan is charged from the month after it was added, with no catch-up (YNAB trial, 2026-10-12)', () => {
    const ctx = makeCtx(); // today 2026-10-08
    const b = new Bench(blankPlan(ctx));
    const car = b.run(
      createAccount(b.plan, ctx, { name: 'Car', type: 'autoLoan', startingBalance: usd(-12000), date: '2026-07-08', loan: { interestRateBps: 600 } }),
    ).accountId;
    expect(b.plan.accounts.find((a) => a.id === car)?.loan?.chargesFrom).toBe('2026-11');
    expect(postLoanCharges(b.plan, ctx)).toBeNull(); // no Aug, Sep or Oct charges
    const cmd = postLoanCharges(b.plan, { ...ctx, today: '2026-11-02' });
    if (cmd) b.run(cmd);
    expect(charges(b, car)).toEqual([['2026-11-01', 'Interest', usd(-60), null]]);
    // A loan with no details yet still remembers when it was added.
    const bare = b.run(createAccount(b.plan, ctx, { name: 'Bare', type: 'otherDebt', startingBalance: usd(-500) })).accountId;
    expect(b.plan.accounts.find((a) => a.id === bare)?.loan).toEqual({ chargesFrom: '2026-11' });
  });

  it('a deleted charge is never posted again; payments lower the next month’s interest', () => {
    const { ctx, b, checking, house, payment } = setup();
    b.run(pairLoanCategory(b.plan, ctx, { accountId: house, categoryId: payment }));
    const nov = { ...ctx, today: '2026-11-20' as const };
    b.run(postLoanCharges(b.plan, nov) ?? { label: '', changes: {} });
    const interest = b.plan.transactions.find((t) => t.importId === 'loan-interest:2026-11');
    expect(interest?.amount).toBe(usd(-1000));
    b.run(deleteTransactions(b.plan, ctx, { transactionIds: [interest?.id ?? ''] }));
    b.run(recordLoanPayment(b.plan, ctx, { loanAccountId: house, fromAccountId: checking, amount: usd(1500), date: '2026-11-15' }));
    expect(postLoanCharges(b.plan, nov)).toBeNull();
    const dec = postLoanCharges(b.plan, { ...ctx, today: '2026-12-01' });
    if (dec) b.run(dec);
    // −200,000 − 300 escrow + 1,500 payment = −198,800 → 994.00 (the deleted 1,000 stays deleted).
    expect(charges(b, house).slice(-2)).toEqual([
      ['2026-12-01', 'Interest', usd(-994), null],
      ['2026-12-01', 'Escrow', usd(-300), null],
    ]);
  });

  it('Record Payment is a transfer from cash, categorized to the paired category', () => {
    const { ctx, b, checking, house, payment } = setup();
    expect(() => recordLoanPayment(b.plan, ctx, { loanAccountId: house, fromAccountId: checking, amount: usd(1500), date: '2026-10-08' })).toThrow(/category/);
    b.run(pairLoanCategory(b.plan, ctx, { accountId: house, categoryId: payment }));
    const cmd = b.run(recordLoanPayment(b.plan, ctx, { loanAccountId: house, fromAccountId: checking, amount: usd(1500), date: '2026-10-08', memo: 'Oct' }));
    const out = b.plan.transactions.find((t) => t.id === cmd.transactionId);
    expect(out).toMatchObject({ accountId: checking, amount: usd(-1500), transferAccountId: house, categoryId: payment, memo: 'Oct' });
    expect(() => recordLoanPayment(b.plan, ctx, { loanAccountId: house, fromAccountId: checking, amount: usd(0), date: '2026-10-08' })).toThrow(/more than/);
  });

  it('one loan per category; closing a loan unpairs it', () => {
    const { ctx, b, house, payment, other } = setup();
    const car = b.run(createAccount(b.plan, ctx, { name: 'Car Loan', type: 'autoLoan', startingBalance: usd(-10000), loan: { interestRateBps: 500, minimumPayment: usd(300) } })).accountId;
    const loanOf = (id: string) => b.plan.accounts.find((a) => a.id === id)?.loan?.pairedCategoryId;
    b.run(pairLoanCategory(b.plan, ctx, { accountId: house, categoryId: payment }));
    b.run(pairLoanCategory(b.plan, ctx, { accountId: car, categoryId: payment }));
    expect(loanOf(house)).toBeUndefined(); // the category moved to the car loan
    expect(loanOf(car)).toBe(payment);
    b.run(pairLoanCategory(b.plan, ctx, { accountId: car, categoryId: other }));
    b.run(pairLoanCategory(b.plan, ctx, { accountId: car, categoryId: null }));
    expect(loanOf(car)).toBeUndefined();
    expect(() => pairLoanCategory(b.plan, ctx, { accountId: house, categoryId: 'nope' })).toThrow();
    b.run(pairLoanCategory(b.plan, ctx, { accountId: car, categoryId: other }));
    b.run(addTransaction(b.plan, ctx, { accountId: car, date: '2026-10-08', amount: usd(10000), payeeName: 'Payoff' }));
    b.run(closeAccount(b.plan, ctx, { accountId: car }));
    expect(loanOf(car)).toBeUndefined();
  });

  it('only loans can be paired', () => {
    const { ctx, b, checking, payment } = setup();
    expect(() => pairLoanCategory(b.plan, ctx, { accountId: checking, categoryId: payment })).toThrow(/loan/);
  });
});
