import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN, type BankRow } from '@hafb/engine';
import { minor } from '@hafb/shared';
import {
  addRenameRule,
  addScheduled,
  addTransaction,
  approveTransactions,
  createAccount,
  createCategory,
  createGroup,
  deletePayees,
  editAndLearn,
  importBankRows,
  keepImportedName,
  learnRenameRule,
  renamedByRule,
  matchTransactions,
  previewImport,
  rejectImports,
  saveImportProfile,
  setPayeeDefaults,
  unmatchTransaction,
} from '../src/commands/index.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

const row = (date: string, amount: number, payee: string, extra: Partial<BankRow> = {}): BankRow => ({ date: date as BankRow['date'], amount: minor(Math.round(amount * 100)), payee, memo: '', ...extra });

describe('bank file import (S6.5, §5.12)', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(1000), date: '2026-10-01' })).accountId;
    const visa = b.run(createAccount(b.plan, ctx, { name: 'Visa', type: 'creditCard', startingBalance: usd(0), date: '2026-10-01' })).accountId;
    const g = b.run(createGroup(b.plan, ctx, { name: 'Needs' })).groupId;
    const groceries = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Groceries' })).categoryId;
    const rent = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Rent' })).categoryId;
    return { ctx, b, checking, visa, groceries, rent };
  };
  const live = (b: Bench, accountId: string) => b.plan.transactions.filter((t) => t.accountId === accountId && t.deletedAt === undefined && t.isStartingBalance !== true);
  const payee = (b: Bench, id: string | undefined) => b.plan.payees.find((p) => p.id === id)?.name;

  it('imports unapproved and cleared: cleaned payees, rename rules, payee defaults, inflows to Ready to Assign', () => {
    const { ctx, b, checking, groceries } = setup();
    // A known payee with a default category, and a rule for Amazon's codes.
    const known = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-02', amount: usd(-10), payeeName: 'Grocery Mart', categoryId: groceries }));
    const groceryPayee = b.plan.transactions.find((t) => t.id === known.transactionId)?.payeeId ?? '';
    b.run(setPayeeDefaults(b.plan, ctx, { payeeId: groceryPayee, defaultCategoryId: groceries, fixed: true }));
    const amazon = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-02', amount: usd(-5), payeeName: 'Amazon' }));
    const amazonPayee = b.plan.transactions.find((t) => t.id === amazon.transactionId)?.payeeId ?? '';
    b.run(addRenameRule(b.plan, ctx, { payeeId: amazonPayee, match: 'startsWith', pattern: 'AMZN' }));

    const rows = [row('2026-10-05', -23.45, 'POS PURCHASE GROCERY MART #0423 NASHVILLE TN', { importId: 'F1', memo: 'card 1234' }), row('2026-10-06', -12.99, 'AMZN Mktp US*2K4LL1X40', { importId: 'F2' }), row('2026-10-07', 1000, 'ACME PAYROLL', { importId: 'F3' }), row('2026-10-08', -4.5, 'SQ *BLUE BOTTLE', { importId: 'F4' })];
    const cmd = importBankRows(b.plan, ctx, { accountId: checking, rows, includeBeforeStart: false });
    expect(cmd.report).toMatchObject({ imported: 4, matched: 0, skipped: 0 });
    b.run(cmd);
    const got = live(b, checking).filter((t) => t.importId !== undefined).map((t) => [payee(b, t.payeeId), t.categoryId, t.amount, t.approved, t.cleared, t.importedPayee, t.memo ?? '']);
    expect(got).toEqual([
      ['Grocery Mart', groceries, usd(-23.45), false, 'cleared', 'POS PURCHASE GROCERY MART #0423 NASHVILLE TN', 'card 1234'],
      ['Amazon', null, usd(-12.99), false, 'cleared', 'AMZN Mktp US*2K4LL1X40', ''],
      ['Acme Payroll', READY_TO_ASSIGN, usd(1000), false, 'cleared', 'ACME PAYROLL', ''],
      ['Blue Bottle', null, usd(-4.5), false, 'cleared', 'SQ *BLUE BOTTLE', ''],
    ]);
    // The same file again: nothing new.
    const again = importBankRows(b.plan, ctx, { accountId: checking, rows, includeBeforeStart: false });
    expect(again.report).toMatchObject({ imported: 0, matched: 0, skipped: 4, reasons: { duplicate: 4 } });
  });

  it('matches an entered transaction: the user’s date, payee, memo and category stay; approved', () => {
    const { ctx, b, checking, groceries } = setup();
    const entered = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-10', amount: usd(-45), payeeName: 'Grocer', memo: 'weekly', categoryId: groceries, approved: true })).transactionId;
    const cmd = importBankRows(b.plan, ctx, { accountId: checking, rows: [row('2026-10-12', -45, 'GROCERY MART', { importId: 'G1' })], includeBeforeStart: true });
    expect(cmd.report).toMatchObject({ imported: 0, matched: 1 });
    b.run(cmd);
    const t = b.plan.transactions.find((x) => x.id === entered);
    expect(t).toMatchObject({ date: '2026-10-10', amount: usd(-45), memo: 'weekly', categoryId: groceries, importId: 'G1', importedPayee: 'GROCERY MART', importedDate: '2026-10-12', importedAmount: usd(-45), matchedAt: ctx.now });
    expect(payee(b, t?.payeeId)).toBe('Grocer');
    expect(t?.approved).not.toBe(false);
    expect(live(b, checking)).toHaveLength(1);
  });

  it('matches a scheduled transaction: it enters on its own date and the schedule moves on', () => {
    const { ctx, b, checking, rent } = setup();
    const sid = b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-10-15', frequency: 'monthly', amount: usd(-1500), payeeName: 'Landlord', categoryId: rent })).scheduledId;
    b.run(importBankRows(b.plan, ctx, { accountId: checking, rows: [row('2026-10-14', -1500, 'LANDLORD LLC', { importId: 'R1' })], includeBeforeStart: true }));
    const entered = live(b, checking).find((t) => t.scheduledTransactionId === sid);
    expect(entered).toMatchObject({ date: '2026-10-15', categoryId: rent, importId: 'R1', importedDate: '2026-10-14' });
    expect(b.plan.scheduled.find((s) => s.id === sid)?.date).toBe('2026-11-15');
  });

  it('rejects an unapproved import (it never comes back); an approved one can’t be rejected', () => {
    const { ctx, b, checking } = setup();
    const rows = [row('2026-10-05', -9, 'JUNK', { importId: 'J1' })];
    b.run(importBankRows(b.plan, ctx, { accountId: checking, rows, includeBeforeStart: true }));
    const id = live(b, checking)[0]?.id ?? '';
    b.run(rejectImports(b.plan, ctx, { transactionIds: [id] }));
    expect(live(b, checking)).toHaveLength(0);
    expect(b.plan.rejectedImports).toEqual([{ accountId: checking, importId: 'J1' }]);
    expect(importBankRows(b.plan, ctx, { accountId: checking, rows, includeBeforeStart: true }).report).toMatchObject({ imported: 0, reasons: { rejected: 1 } });
    // Approved transactions can't be rejected.
    b.run(importBankRows(b.plan, ctx, { accountId: checking, rows: [row('2026-10-06', -8, 'OK', { importId: 'J2' })], includeBeforeStart: true }));
    const ok = live(b, checking)[0]?.id ?? '';
    b.run(approveTransactions(b.plan, ctx, { transactionIds: [ok] }));
    expect(() => rejectImports(b.plan, ctx, { transactionIds: [ok] })).toThrow(/unapproved/);
  });

  it('match by hand (the bank’s amount wins) and unmatch (both come back as they were)', () => {
    const { ctx, b, checking, groceries } = setup();
    const entered = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-20', amount: usd(-30), payeeName: 'Pharmacy', categoryId: groceries })).transactionId;
    b.run(importBankRows(b.plan, ctx, { accountId: checking, rows: [row('2026-10-21', -31.5, 'CVS PHARMACY 01234', { importId: 'M1' })], includeBeforeStart: true }));
    const imported = live(b, checking).find((t) => t.importId === 'M1')?.id ?? '';
    b.run(matchTransactions(b.plan, ctx, { importedId: imported, enteredId: entered }));
    expect(live(b, checking)).toHaveLength(1);
    expect(b.plan.transactions.find((t) => t.id === entered)).toMatchObject({ amount: usd(-31.5), enteredAmount: usd(-30), importId: 'M1', date: '2026-10-20', matchedAt: ctx.now });
    b.run(unmatchTransaction(b.plan, ctx, { transactionId: entered }));
    const back = live(b, checking);
    expect(back).toHaveLength(2);
    const mine = back.find((t) => t.id === entered);
    expect(mine?.amount).toBe(usd(-30));
    expect(mine?.importId).toBeUndefined();
    expect(mine?.matchedAt).toBeUndefined();
    expect(back.find((t) => t.id !== entered)).toMatchObject({ date: '2026-10-21', amount: usd(-31.5), importId: 'M1', approved: false, importedPayee: 'CVS PHARMACY 01234' });
    expect(() => matchTransactions(b.plan, ctx, { importedId: entered, enteredId: entered })).toThrow();
  });

  it('pairs a card payment imported on both sides into a transfer', () => {
    const { ctx, b, checking, visa } = setup();
    b.run(importBankRows(b.plan, ctx, { accountId: checking, rows: [row('2026-10-05', -200, 'PAYMENT TO VISA CARD', { importId: 'P1' })], includeBeforeStart: true }));
    const cmd = importBankRows(b.plan, ctx, { accountId: visa, rows: [row('2026-10-06', 200, 'PAYMENT THANK YOU', { importId: 'P2' })], includeBeforeStart: true });
    expect(cmd.report.paired).toBe(1);
    b.run(cmd);
    const out = live(b, checking).find((t) => t.importId === 'P1');
    const inn = live(b, visa).find((t) => t.importId === 'P2');
    expect(out).toMatchObject({ transferAccountId: visa, transferTransactionId: inn?.id, categoryId: null, approved: false });
    expect(inn).toMatchObject({ transferAccountId: checking, transferTransactionId: out?.id, categoryId: null, approved: false });
    expect(payee(b, out?.payeeId)).toBe('Transfer : Visa');
  });

  it('previews without changing anything, and leaves out rows before the start when asked', () => {
    const { ctx, b, checking } = setup();
    const rows = [row('2026-09-15', -5, 'OLD'), row('2026-10-03', -6, 'NEW')];
    const before = b.plan;
    const p = previewImport(b.plan, { accountId: checking, rows, includeBeforeStart: false });
    expect(p.map((x) => [x.payee, x.decision.kind])).toEqual([
      ['Old', 'skip'],
      ['New', 'new'],
    ]);
    expect(b.plan).toBe(before);
    expect(importBankRows(b.plan, ctx, { accountId: checking, rows, includeBeforeStart: true }).report.imported).toBe(2);
  });

  // YNAB (https://support.ynab.com/en_us/how-to-rename-payees-BkotNUSyo, 2026-09-17): editing an
  // imported payee creates an IS rule; "Don't rename as" keeps the bank's name and removes the IS
  // rules; deleting that payee in Manage Payees turns renaming back on.
  it('renaming an imported payee learns an IS rule; Don’t rename keeps the bank’s name until that payee is deleted', () => {
    const { ctx, b, checking } = setup();
    const raw = 'MCDONALDS 576 NASHVILLE';
    const importOne = (id: string, date: string) => {
      b.run(importBankRows(b.plan, ctx, { accountId: checking, rows: [row(date, -8.5, raw, { importId: id })], includeBeforeStart: false }));
      return live(b, checking).find((t) => t.importId === id);
    };
    const first = importOne('M1', '2026-10-05');
    expect(payee(b, first?.payeeId)).toBe('Mcdonalds 576 Nashville');
    // The user renames it: one undo step edits the payee and learns the rule.
    b.run(editAndLearn(b.plan, ctx, { transactionId: first?.id ?? '', patch: { payeeName: 'McDonald’s' } }));
    expect(b.plan.payeeRenameRules.map((r) => [r.match, r.pattern, payee(b, r.targetPayeeId)])).toEqual([['equals', raw, 'McDonald’s']]);
    expect(payee(b, importOne('M2', '2026-10-06')?.payeeId)).toBe('McDonald’s');
    // Renaming another one again updates the same rule instead of adding a second.
    const third = importOne('M3', '2026-10-07');
    b.run(editAndLearn(b.plan, ctx, { transactionId: third?.id ?? '', patch: { payeeName: 'McD' } }));
    expect(b.plan.payeeRenameRules.map((r) => [r.pattern, payee(b, r.targetPayeeId)])).toEqual([[raw, 'McD']]);
    // Nothing is learned for a payee the user typed (not imported), or for a payee that didn't change.
    expect(learnRenameRule(b.plan, ctx, { transactionId: third?.id ?? '' })).toBeNull();

    // Don't rename as McD: the bank's name becomes a payee, the IS rules go, and it stays put.
    expect(renamedByRule(b.plan, third?.id ?? '')).toBe(true);
    b.run(keepImportedName(b.plan, ctx, { transactionId: third?.id ?? '' }));
    expect(renamedByRule(b.plan, third?.id ?? '')).toBe(false);
    expect(b.plan.payees.some((p) => p.name.toUpperCase() === raw && p.deletedAt === undefined)).toBe(true);
    expect(payee(b, importOne('M4', '2026-10-08')?.payeeId)?.toUpperCase()).toBe(raw);
    // A contains rule added later doesn't override it, and editing a payee no longer learns a rule.
    const mcd = b.plan.payees.find((p) => p.name === 'McD')?.id ?? '';
    b.run(addRenameRule(b.plan, ctx, { payeeId: mcd, match: 'contains', pattern: 'MCDONALDS' }));
    const fifth = importOne('M5', '2026-10-09');
    expect(payee(b, fifth?.payeeId)?.toUpperCase()).toBe(raw);
    b.run(editAndLearn(b.plan, ctx, { transactionId: fifth?.id ?? '', patch: { payeeName: 'McD' } }));
    expect(b.plan.payeeRenameRules.filter((r) => r.match === 'equals').map((r) => payee(b, r.targetPayeeId)?.toUpperCase())).toEqual([raw]);

    // Deleting that payee in Manage Payees turns renaming back on.
    const kept = b.plan.payees.find((p) => p.name.toUpperCase() === raw)?.id ?? '';
    b.run(deletePayees(b.plan, ctx, { payeeIds: [kept], replacementId: mcd }));
    expect(payee(b, importOne('M6', '2026-10-10')?.payeeId)).toBe('McD');
  });

  it('remembers CSV settings per account', () => {
    const { ctx, b, checking } = setup();
    b.run(saveImportProfile(b.plan, ctx, { accountId: checking, profile: { columns: ['date', 'payee', 'amount'], header: true } }));
    expect(b.plan.importProfiles).toEqual([{ accountId: checking, profile: { columns: ['date', 'payee', 'amount'], header: true } }]);
  });
});
