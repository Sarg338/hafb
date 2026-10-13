import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN } from '@hafb/engine';
import { makeDate, minor, type ISODate } from '@hafb/shared';
import {
  addTransaction,
  createAccount,
  linkBankAccount,
  linkedAccounts,
  mergeSimplefin,
  readSimplefin,
  rejectImports,
  simplefinRows,
  syncBankAccounts,
} from '../src/commands/index.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

/** Unix seconds at noon UTC on a date, and back (the app passes the PC's local date instead). */
const at = (date: string): number => Date.parse(`${date}T12:00:00Z`) / 1000;
const dateOf = (s: number): ISODate => {
  const d = new Date(s * 1000);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

interface Tx {
  id: string;
  date: string;
  amount: string;
  description: string;
  payee?: string;
  pending?: boolean;
  transacted?: string;
}

/** An answer shaped like SimpleFIN Bridge's (protocol v2, plus Bridge's `payee`). */
function answer(accounts: { id: string; name: string; currency?: string; txs: Tx[] }[], errlist: { code: string; msg: string }[] = []) {
  return {
    errlist,
    connections: [{ conn_id: 'CON-1', name: 'Regions', org_id: 'regions', org_name: 'Regions Bank', sfin_url: 'https://beta-bridge.simplefin.org/simplefin' }],
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      conn_id: 'CON-1',
      currency: a.currency ?? 'USD',
      balance: '0.00',
      'balance-date': at('2026-10-12'),
      transactions: a.txs.map((t) => ({
        id: t.id,
        posted: t.pending === true ? 0 : at(t.date),
        amount: t.amount,
        description: t.description,
        ...(t.payee === undefined ? {} : { payee: t.payee }),
        ...(t.transacted === undefined ? {} : { transacted_at: at(t.transacted) }),
        ...(t.pending === true ? { pending: true } : {}),
      })),
      holdings: [],
    })),
  };
}

describe('reading SimpleFIN’s answer (S8.6, ADR 0006)', () => {
  it('names accounts with their bank, keeps messages, and drops what it can’t read', () => {
    const raw = answer(
      [
        {
          id: 'ACT-1',
          name: 'Checking',
          txs: [
            { id: 'T1', date: '2026-10-05', amount: '-70.00', description: 'LOCAL GROCER STORE #1133', payee: 'Grocery store' },
            { id: 'T2', date: '2026-10-06', amount: '-5.00', description: 'COFFEE\u0007 ‮shop', pending: true },
          ],
        },
      ],
      [{ code: 'con.auth', msg: 'Regions needs you to log in again.' }],
    );
    // A transaction without an id, and a non-object, are skipped.
    raw.accounts[0]?.transactions.push({ posted: 1, amount: '1.00', description: 'no id' } as never, 'junk' as never);
    const got = readSimplefin({ ...raw, errors: ['Regions needs you to log in again.', 'You are close to the daily limit.'] });
    expect(got.messages).toEqual(['Regions needs you to log in again.', 'You are close to the daily limit.']);
    expect(got.accounts).toHaveLength(1);
    expect(got.accounts[0]).toMatchObject({ id: 'ACT-1', name: 'Regions Bank · Checking', currency: 'USD' });
    expect(got.accounts[0]?.transactions.map((t) => [t.id, t.payee, t.description, t.pending])).toEqual([
      ['T1', 'Grocery store', 'LOCAL GROCER STORE #1133', false],
      ['T2', undefined, 'COFFEE shop', true],
    ]);
  });

  it('merges the answers for two date windows: each account and transaction once', () => {
    const older = readSimplefin(answer([{ id: 'ACT-1', name: 'Checking', txs: [{ id: 'T1', date: '2026-08-01', amount: '-1.00', description: 'a' }, { id: 'T2', date: '2026-09-15', amount: '-2.00', description: 'b' }] }], [{ code: 'gen.', msg: 'Slow day.' }]));
    const newer = readSimplefin(
      answer(
        [
          { id: 'ACT-1', name: 'Checking', txs: [{ id: 'T2', date: '2026-09-15', amount: '-2.00', description: 'b' }, { id: 'T3', date: '2026-10-10', amount: '-3.00', description: 'c' }] },
          { id: 'ACT-2', name: 'Savings', txs: [] },
        ],
        [{ code: 'gen.', msg: 'Slow day.' }],
      ),
    );
    const merged = mergeSimplefin([older, newer]);
    expect(merged.accounts.map((a) => [a.id, a.transactions.map((t) => t.id)])).toEqual([
      ['ACT-1', ['T1', 'T2', 'T3']],
      ['ACT-2', []],
    ]);
    expect(merged.messages).toEqual(['Slow day.']);
  });

  it('refuses an answer that isn’t an account set', () => {
    for (const bad of [null, 'text', [], { errlist: [] }]) expect(() => readSimplefin(bad)).toThrow(/couldn’t read/);
  });

  it('turns posted transactions into bank rows: exact cents, the purchase date when known, namespaced ids', () => {
    const { accounts } = readSimplefin(
      answer([
        {
          id: 'ACT-1',
          name: 'Checking',
          txs: [
            { id: 'T1', date: '2026-10-05', amount: '-70.00', description: 'LOCAL GROCER', payee: 'Grocery store' },
            { id: 'T2', date: '2026-10-07', transacted: '2026-10-04', amount: '1960.10', description: 'PAY DAY' },
            { id: 'T3', date: '2026-10-07', amount: '-0.005', description: 'Rounding' },
            { id: 'T4', date: '2026-10-07', amount: 'twelve', description: 'Bad amount' },
            { id: 'T5', date: '2026-10-08', amount: '-9.99', description: 'Pending', pending: true },
            { id: 'T6', date: '2026-10-08', amount: '0.1', description: 'One decimal' },
          ],
        },
      ]),
    );
    const account = accounts[0];
    if (!account) throw new Error('no account');
    const { rows, unreadable } = simplefinRows(account, 2, dateOf);
    expect(unreadable).toBe(1);
    expect(rows).toEqual([
      { date: '2026-10-05', amount: minor(-7000), payee: 'Grocery store', memo: '', importId: 'sfin:T1' },
      { date: '2026-10-04', amount: minor(196010), payee: 'PAY DAY', memo: '', importId: 'sfin:T2' },
      { date: '2026-10-07', amount: minor(-1), payee: 'Rounding', memo: '', importId: 'sfin:T3' },
      { date: '2026-10-08', amount: minor(10), payee: 'One decimal', memo: '', importId: 'sfin:T6' },
    ]);
  });
});

describe('linking accounts', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(1000), date: '2026-10-01' })).accountId;
    const savings = b.run(createAccount(b.plan, ctx, { name: 'Savings', type: 'savings', startingBalance: usd(0), date: '2026-10-01' })).accountId;
    return { ctx, b, checking, savings };
  };

  it('links one SimpleFIN account to one account, and unlinks', () => {
    const { ctx, b, checking, savings } = setup();
    b.run(linkBankAccount(b.plan, ctx, { accountId: checking, link: { id: 'ACT-1', name: 'Regions Bank · Checking' } }));
    expect(linkedAccounts(b.plan).map((a) => [a.name, a.bankLink])).toEqual([['Checking', { id: 'ACT-1', name: 'Regions Bank · Checking' }]]);
    expect(() => linkBankAccount(b.plan, ctx, { accountId: savings, link: { id: 'ACT-1', name: 'x' } })).toThrow('already linked to Checking');
    b.run(linkBankAccount(b.plan, ctx, { accountId: checking, link: null }));
    expect(linkedAccounts(b.plan)).toEqual([]);
    // Now free for another account.
    b.run(linkBankAccount(b.plan, ctx, { accountId: savings, link: { id: 'ACT-1', name: 'Regions Bank · Checking' } }));
    expect(linkedAccounts(b.plan).map((a) => a.name)).toEqual(['Savings']);
  });
});

describe('syncing (S8.6): the bank file pipeline, one undo step, nothing twice', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(1000), date: '2026-10-01' })).accountId;
    const visa = b.run(createAccount(b.plan, ctx, { name: 'Visa', type: 'creditCard', startingBalance: usd(0), date: '2026-10-01' })).accountId;
    const cash = b.run(createAccount(b.plan, ctx, { name: 'Wallet', type: 'cash', startingBalance: usd(50), date: '2026-10-01' })).accountId;
    b.run(linkBankAccount(b.plan, ctx, { accountId: checking, link: { id: 'CHK', name: 'Regions Bank · Checking' } }));
    b.run(linkBankAccount(b.plan, ctx, { accountId: visa, link: { id: 'CARD', name: 'Regions Bank · Visa' } }));
    return { ctx, b, checking, visa, cash };
  };
  const imported = (b: Bench, accountId: string) => b.plan.transactions.filter((t) => t.accountId === accountId && t.deletedAt === undefined && t.importId !== undefined);

  const first = answer([
    {
      id: 'CHK',
      name: 'Checking',
      txs: [
        { id: 'C1', date: '2026-10-03', amount: '-42.10', description: 'KROGER #123', payee: 'Kroger' },
        { id: 'C2', date: '2026-10-06', amount: '1960.00', description: 'ACME PAYROLL' },
        { id: 'C3', date: '2026-10-07', amount: '-250.00', description: 'REGIONS CARD PAYMENT' },
        { id: 'C4', date: '2026-10-08', amount: '-9.99', description: 'Pending thing', pending: true },
      ],
    },
    {
      id: 'CARD',
      name: 'Visa',
      txs: [
        { id: 'V1', date: '2026-10-04', amount: '-15.25', description: 'NETFLIX.COM' },
        { id: 'V2', date: '2026-10-08', amount: '250.00', description: 'PAYMENT THANK YOU' },
      ],
    },
    { id: 'OTHER', name: 'Not linked', txs: [{ id: 'O1', date: '2026-10-05', amount: '-1.00', description: 'x' }] },
  ]);

  it('imports posted transactions unapproved into each linked account, pairs card payments, and records the time', () => {
    const { ctx, b, checking, visa, cash } = setup();
    const { command, report } = syncBankAccounts(b.plan, ctx, { answer: readSimplefin(first), dateOf });
    expect(command?.label).toBe('Sync 5 transactions from the bank');
    expect(report).toEqual({
      accounts: [
        { accountId: checking, imported: 3, matched: 0, paired: 0 },
        { accountId: visa, imported: 2, matched: 0, paired: 1 },
      ],
      messages: [],
    });
    if (!command) throw new Error('no command');
    b.run(command);
    const chk = imported(b, checking);
    expect(chk.map((t) => [t.importId, t.amount, t.approved, t.cleared])).toEqual([
      ['sfin:C1', usd(-42.1), false, 'cleared'],
      ['sfin:C2', usd(1960), false, 'cleared'],
      ['sfin:C3', usd(-250), false, 'cleared'],
    ]);
    // Cash inflows go to Ready to Assign; the card payment became a transfer on both sides.
    expect(chk[1]?.categoryId).toBe(READY_TO_ASSIGN);
    expect(chk[2]?.transferAccountId).toBe(visa);
    expect(imported(b, visa).find((t) => t.importId === 'sfin:V2')?.transferAccountId).toBe(checking);
    expect(imported(b, cash)).toEqual([]);
    expect(linkedAccounts(b.plan).map((a) => a.bankLink?.syncedAt)).toEqual([ctx.now, ctx.now]);
  });

  it('a second sync over the same days brings nothing twice and isn’t an undo step', () => {
    const { ctx, b } = setup();
    const once = syncBankAccounts(b.plan, ctx, { answer: readSimplefin(first), dateOf }).command;
    if (!once) throw new Error('no command');
    b.run(once);
    const again = syncBankAccounts(b.plan, ctx, { answer: readSimplefin(first), dateOf });
    expect(again.command).toBeNull();
    expect(again.report.accounts.map((r) => r.imported + r.matched)).toEqual([0, 0]);
  });

  it('matches what the user entered, and never brings back a rejected import', () => {
    const { ctx, b, checking } = setup();
    const entered = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-02', amount: usd(-42.1), payeeName: 'Groceries run' })).transactionId;
    const once = syncBankAccounts(b.plan, ctx, { answer: readSimplefin(first), dateOf }).command;
    if (!once) throw new Error('no command');
    b.run(once);
    const match = b.plan.transactions.find((t) => t.id === entered);
    expect(match).toMatchObject({ importId: 'sfin:C1', date: '2026-10-02', importedPayee: 'Kroger' });
    const payroll = imported(b, checking).find((t) => t.importId === 'sfin:C2');
    if (!payroll) throw new Error('no payroll');
    b.run(rejectImports(b.plan, ctx, { transactionIds: [payroll.id] }));
    expect(syncBankAccounts(b.plan, ctx, { answer: readSimplefin(first), dateOf }).command).toBeNull();
  });

  it('says which linked accounts it couldn’t sync, and passes SimpleFIN’s messages on', () => {
    const { ctx, b, visa } = setup();
    const raw = answer([{ id: 'CHK', name: 'Checking', currency: 'CAD', txs: [{ id: 'C1', date: '2026-10-03', amount: '-1.00', description: 'x' }] }], [{ code: 'con.auth', msg: 'Regions needs you to log in again.' }]);
    const { command, report } = syncBankAccounts(b.plan, ctx, { answer: readSimplefin(raw), dateOf });
    expect(command).toBeNull();
    expect(report.messages).toEqual([
      'Regions needs you to log in again.',
      'Checking wasn’t synced: SimpleFIN sends it in CAD, and this plan uses USD.',
      'SimpleFIN didn’t send Visa (Regions Bank · Visa). Check the connection on SimpleFIN’s site, or link the account again in Edit Account.',
    ]);
    expect(imported(b, visa)).toEqual([]);
  });

  it('skips closed and unlinked accounts', () => {
    const { ctx, b, checking } = setup();
    b.run(linkBankAccount(b.plan, ctx, { accountId: checking, link: null }));
    const { command } = syncBankAccounts(b.plan, ctx, { answer: readSimplefin(first), dateOf });
    if (!command) throw new Error('no command');
    b.run(command);
    expect(imported(b, checking)).toEqual([]);
  });
});
