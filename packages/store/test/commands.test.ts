import { CREDIT_CARD_INTEREST, READY_TO_ASSIGN, autoAssign, monthState } from '@hafb/engine';
import { minor, type Month } from '@hafb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChanges, findRecord } from '../src/changes.ts';
import { decodePlan, encodePlan } from '../src/codec.ts';
import { applyRows, loadTables, openMemoryPlan } from './helpers/sqliteStore.ts';
import {
  accountBalance,
  adjustBalance,
  MANUAL_BALANCE_ADJUSTMENT_PAYEE,
  addTransaction,
  applyPlanChange,
  approveTransactions,
  arrangeCategories,
  clearTarget,
  closeAccount,
  combinePayees,
  coverOverspending,
  createAccount,
  createCategory,
  createGroup,
  categoryInUse,
  deleteCategory,
  deleteGroup,
  deletePayee,
  deletePayees,
  setPayeesHidden,
  addRenameRule,
  editRenameRule,
  deleteRenameRule,
  deleteTransactions,
  Draft,
  duplicateTransactions,
  editAccount,
  editTransaction,
  editTransactions,
  moveMoney,
  renameCategory,
  reopenAccount,
  setAssigned,
  setCategoryHidden,
  setCategoryNote,
  setCleared,
  setFlag,
  setFlagName,
  setExpectedIncome,
  setMonthNote,
  setTarget,
  snoozeTarget,
} from '../src/commands/index.ts';
import type { PlanData, TransactionRecord } from '../src/records.ts';
import { budgetSnapshot, planBudget } from '../src/snapshot.ts';
import { Bench, TODAY, blankPlan, makeCtx, usd } from './helpers/harness.ts';

const OCT: Month = '2026-10';

function rta(plan: PlanData, month = OCT): number {
  return monthState(planBudget(plan, { today: TODAY }), month).readyToAssign;
}
function available(plan: PlanData, categoryId: string, month = OCT): number {
  return monthState(planBudget(plan, { today: TODAY }), month).categories[categoryId]?.available ?? Number.NaN;
}
const live = (plan: PlanData): TransactionRecord[] => plan.transactions.filter((t) => t.deletedAt === undefined);
function tx(plan: PlanData, id: string): TransactionRecord {
  const t = findRecord(plan, 'transactions', id);
  if (!t) throw new Error(`no transaction ${id}`);
  return t;
}

describe('commands', () => {
  let ctx: ReturnType<typeof makeCtx>;
  let b: Bench;
  let checking: string;
  let savings: string;
  let visa: string;
  let house: string;
  let groceries: string;
  let rent: string;
  let bills: string;

  beforeEach(() => {
    ctx = makeCtx();
    b = new Bench(blankPlan(ctx));
    checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(1000) })).accountId;
    savings = b.run(createAccount(b.plan, ctx, { name: 'Savings', type: 'savings', startingBalance: usd(500) })).accountId;
    visa = b.run(createAccount(b.plan, ctx, { name: 'Visa', type: 'creditCard', startingBalance: usd(-200) })).accountId;
    house = b.run(createAccount(b.plan, ctx, { name: 'House', type: 'mortgage', startingBalance: usd(-100000), loan: { interestRateBps: 600 } })).accountId;
    bills = b.run(createGroup(b.plan, ctx, { name: 'Bills' })).groupId;
    groceries = b.run(createCategory(b.plan, ctx, { groupId: bills, name: 'Groceries' })).categoryId;
    rent = b.run(createCategory(b.plan, ctx, { groupId: bills, name: 'Rent' })).categoryId;
  });

  describe('accounts', () => {
    it('creates transfer payees, starting balances and a card payment category', () => {
      const p = b.plan;
      expect(p.payees.filter((x) => x.transferAccountId !== undefined).map((x) => x.name)).toEqual([
        'Transfer : Checking',
        'Transfer : Savings',
        'Transfer : Visa',
        'Transfer : House',
      ]);
      const starts = live(p).filter((t) => t.isStartingBalance);
      expect(starts.map((t) => [t.amount, t.categoryId, t.cleared])).toEqual([
        [usd(1000), READY_TO_ASSIGN, 'cleared'],
        [usd(500), READY_TO_ASSIGN, 'cleared'],
        [usd(-200), null, 'cleared'],
        [usd(-100000), null, 'cleared'],
      ]);
      const payment = p.categories.find((c) => c.creditCardAccountId === visa);
      expect(payment?.name).toBe('Visa');
      expect(p.categoryGroups.find((g) => g.id === payment?.groupId)?.systemKind).toBe('creditCardPayments');
      // §5.2: cash starting balances are Ready to Assign; a card's starting debt is not ("Category
      // not needed"; the payment category shows it as underfunded; YNAB trial 2026-10-08).
      expect(rta(p)).toBe(usd(1500));
      expect(p.accounts.find((a) => a.id === house)).toMatchObject({ onBudget: false, loan: { interestRateBps: 600 } });
    });

    it('a $0 starting balance still gets its transaction (§5.14)', () => {
      const id = b.run(createAccount(b.plan, ctx, { name: 'Wallet', type: 'cash', startingBalance: usd(0) })).accountId;
      expect(live(b.plan).filter((t) => t.accountId === id).map((t) => t.amount)).toEqual([0]);
    });

    it('rename also renames the transfer payee and the payment category', () => {
      b.run(editAccount(b.plan, ctx, { accountId: visa, name: 'Visa Gold', starred: true, note: 'n' }));
      expect(b.plan.payees.find((x) => x.transferAccountId === visa)?.name).toBe('Transfer : Visa Gold');
      expect(b.plan.categories.find((c) => c.creditCardAccountId === visa)?.name).toBe('Visa Gold');
      expect(findRecord(b.plan, 'accounts', visa)).toMatchObject({ starred: true, note: 'n' });
      b.run(editAccount(b.plan, ctx, { accountId: visa, starred: false, note: null }));
      const a = findRecord(b.plan, 'accounts', visa);
      expect(a?.starred).toBeUndefined();
      expect(a?.note).toBeUndefined();
    });

    it('editing the working balance adds a Manual Balance Adjustment (YNAB trial, 2026-10-08)', () => {
      const before = rta(b.plan);
      b.run(adjustBalance(b.plan, ctx, { accountId: checking, workingBalance: usd(1001) }));
      const adj = live(b.plan).find((t) => t.accountId === checking && t.payeeId === b.plan.payees.find((p) => p.name === MANUAL_BALANCE_ADJUSTMENT_PAYEE)?.id);
      expect(adj).toMatchObject({ amount: usd(1), categoryId: READY_TO_ASSIGN, cleared: 'cleared', date: TODAY });
      expect(rta(b.plan)).toBe(before + usd(1));
      expect(accountBalance(new Draft(b.plan), checking)).toBe(usd(1001));
      // Off-budget accounts get no category; the same balance is a no-op.
      b.run(adjustBalance(b.plan, ctx, { accountId: house, workingBalance: usd(-99000) }));
      expect(live(b.plan).filter((t) => t.accountId === house).at(-1)).toMatchObject({ amount: usd(1000), categoryId: null });
      expect(adjustBalance(b.plan, ctx, { accountId: house, workingBalance: usd(-99000) }).changes).toEqual({});
    });

    it('closing with a balance zeroes it first with an adjustment, like YNAB', () => {
      b.run(closeAccount(b.plan, ctx, { accountId: savings, zeroOut: true }));
      expect(findRecord(b.plan, 'accounts', savings)?.closed).toBe(true);
      expect(accountBalance(new Draft(b.plan), savings)).toBe(0);
      expect(live(b.plan).filter((t) => t.accountId === savings).at(-1)).toMatchObject({ amount: usd(-500), categoryId: READY_TO_ASSIGN });
    });

    it('closing needs a zero balance unless asked to zero it; reopen undoes it', () => {
      expect(() => closeAccount(b.plan, ctx, { accountId: savings })).toThrow(/zero balance/);
      b.run(addTransaction(b.plan, ctx, { accountId: savings, date: TODAY, amount: usd(-500), transferAccountId: checking }));
      expect(accountBalance(new Draft(b.plan), savings)).toBe(0);
      b.run(closeAccount(b.plan, ctx, { accountId: savings }));
      expect(findRecord(b.plan, 'accounts', savings)?.closed).toBe(true);
      b.run(reopenAccount(b.plan, ctx, { accountId: savings }));
      expect(findRecord(b.plan, 'accounts', savings)?.closed).toBeUndefined();
    });
  });

  describe('assigning', () => {
    it('setAssigned changes Ready to Assign and logs money moves', () => {
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(300) }));
      expect(rta(b.plan)).toBe(usd(1200));
      expect(available(b.plan, groceries)).toBe(usd(300));
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(100) }));
      expect(rta(b.plan)).toBe(usd(1400));
      expect(b.plan.moneyMoves.map((m) => [m.fromCategoryId, m.toCategoryId, m.amount, m.kind])).toEqual([
        [null, groceries, usd(300), 'assign'],
        [groceries, null, usd(200), 'assign'],
      ]);
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(0) }));
      expect(b.plan.assignments).toEqual([]);
      expect(() => setAssigned(b.plan, ctx, { month: OCT, categoryId: READY_TO_ASSIGN, amount: usd(1) })).toThrow();
    });

    it('moveMoney is net zero and logs one move', () => {
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(300) }));
      b.run(moveMoney(b.plan, ctx, { month: OCT, from: groceries, to: rent, amount: usd(120) }));
      expect(available(b.plan, groceries)).toBe(usd(180));
      expect(available(b.plan, rent)).toBe(usd(120));
      expect(rta(b.plan)).toBe(usd(1200));
      expect(b.plan.moneyMoves.at(-1)).toMatchObject({ fromCategoryId: groceries, toCategoryId: rent, amount: usd(120), kind: 'move' });
    });

    it('cover overspending from another category and from a future month', () => {
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: rent, amount: usd(50) }));
      b.run(setAssigned(b.plan, ctx, { month: '2026-11', categoryId: rent, amount: usd(40) }));
      b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-80), categoryId: groceries }));
      expect(available(b.plan, groceries)).toBe(usd(-80));
      b.run(
        coverOverspending(b.plan, ctx, {
          month: OCT,
          categoryId: groceries,
          sources: [
            { from: rent, amount: usd(50) },
            { from: rent, month: '2026-11', amount: usd(30) },
          ],
        }),
      );
      expect(available(b.plan, groceries)).toBe(usd(0));
      expect(findRecord(b.plan, 'assignments', `2026-11|${rent}`)?.assigned).toBe(usd(10));
    });

    it('auto-assign commits an engine PlanChange as one change set', () => {
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(300) }));
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: rent, amount: usd(100) }));
      const state = planBudget(b.plan, { today: TODAY });
      const change = autoAssign('resetAssigned', { state, month: OCT, categoryIds: [groceries, rent] });
      const cmd = b.run(applyPlanChange(b.plan, ctx, { change, kind: 'autoAssign', label: 'Reset Assigned Amounts' }));
      expect(cmd.changes.remove?.assignments).toHaveLength(2);
      expect(rta(b.plan)).toBe(usd(1500));
      expect(b.plan.moneyMoves.filter((m) => m.kind === 'autoAssign')).toHaveLength(2);
      const groupIds = new Set(b.plan.moneyMoves.filter((m) => m.kind === 'autoAssign').map((m) => m.groupId));
      expect(groupIds.size).toBe(1);
    });

    it('month notes: set, then empty removes', () => {
      b.run(setMonthNote(b.plan, ctx, { month: OCT, note: 'hello' }));
      expect(b.plan.monthNotes).toEqual([{ month: OCT, note: 'hello' }]);
      b.run(setMonthNote(b.plan, ctx, { month: OCT, note: '  ' }));
      expect(b.plan.monthNotes).toEqual([]);
    });
  });

  describe('expected income (Cost to Be Me)', () => {
    it('sets, changes and clears; undo restores the old value', () => {
      const set = setExpectedIncome(b.plan, ctx, { amount: usd(2000) });
      expect(set.label).toBe('Set expected income');
      const before = b.plan;
      b.run(set);
      expect(b.plan.settings.expectedIncome).toBe(usd(2000));
      expect(applyChanges(b.plan, applyChanges(before, set.changes).inverse).plan.settings.expectedIncome).toBeUndefined();
      b.run(setExpectedIncome(b.plan, ctx, { amount: minor(0) }));
      expect(b.plan.settings.expectedIncome).toBeUndefined();
      expect(() => setExpectedIncome(b.plan, ctx, { amount: usd(-1) })).toThrow(/positive/);
    });
  });

  describe('transactions and transfers (§5.9)', () => {
    it('Credit Card Interest: a card transaction or split line, stored and reloaded; never on a cash account (§3.15)', () => {
      const { transactionId } = b.run(addTransaction(b.plan, ctx, { accountId: visa, date: TODAY, amount: usd(-12.34), categoryId: CREDIT_CARD_INTEREST, payeeName: 'Interest' }));
      expect(tx(b.plan, transactionId).categoryId).toBe(CREDIT_CARD_INTEREST);
      b.run(
        addTransaction(b.plan, ctx, {
          accountId: visa,
          date: TODAY,
          amount: usd(-30),
          payeeName: 'Bank',
          subtransactions: [
            { amount: usd(-25), categoryId: groceries },
            { amount: usd(-5), categoryId: CREDIT_CARD_INTEREST },
          ],
        }),
      );
      // Off the plan: Ready to Assign and Groceries see only the groceries line.
      expect(rta(b.plan)).toBe(usd(1500));
      expect(monthState(planBudget(b.plan, { today: TODAY }), OCT).categories[groceries]?.activity).toBe(usd(-25));
      expect(b.plan.categories.map((c) => c.id)).not.toContain(CREDIT_CARD_INTEREST);
      expect(() => addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), categoryId: CREDIT_CARD_INTEREST })).toThrow(/only for credit/);
    });

    it('cash-type accounts default to cleared, others to uncleared', () => {
      const wallet = b.run(createAccount(b.plan, ctx, { name: 'Wallet', type: 'cash', startingBalance: usd(20) })).accountId;
      const a = b.run(addTransaction(b.plan, ctx, { accountId: wallet, date: TODAY, amount: usd(-5), categoryId: groceries, payeeName: 'Cafe' }));
      const c = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-5), categoryId: groceries, payeeName: 'cafe ' }));
      expect(tx(b.plan, a.transactionId).cleared).toBe('cleared');
      expect(tx(b.plan, c.transactionId).cleared).toBe('uncleared');
      // Payee names match case-insensitively: one payee, not two.
      expect(b.plan.payees.filter((p) => p.name.toLowerCase() === 'cafe')).toHaveLength(1);
    });

    it('budget ↔ budget: both legs, no category, linked, opposite amounts', () => {
      const { transactionId } = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-100), transferAccountId: savings }));
      const t = tx(b.plan, transactionId);
      expect(t.transferTransactionId).toBeDefined();
      const leg = tx(b.plan, t.transferTransactionId ?? '');
      expect(leg).toMatchObject({ accountId: savings, amount: usd(100), categoryId: null, transferAccountId: checking, transferTransactionId: t.id });
      expect(t.categoryId).toBeNull();
      expect(b.plan.payees.find((p) => p.id === t.payeeId)?.name).toBe('Transfer : Savings');
      expect(b.plan.payees.find((p) => p.id === leg.payeeId)?.name).toBe('Transfer : Checking');
      expect(rta(b.plan)).toBe(usd(1500));
      expect(() => addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), transferAccountId: savings, categoryId: groceries })).toThrow(/no category/);
    });

    it('editing amount or date on either leg updates the other; delete removes both', () => {
      const { transactionId } = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-100), transferAccountId: savings }));
      const legId = tx(b.plan, transactionId).transferTransactionId ?? '';
      b.run(editTransaction(b.plan, ctx, { transactionId: legId, patch: { amount: usd(150), date: '2026-10-09' } }));
      expect(tx(b.plan, transactionId)).toMatchObject({ amount: usd(-150), date: '2026-10-09' });
      b.run(editTransaction(b.plan, ctx, { transactionId, patch: { memo: 'm', flag: 'red' } }));
      expect(tx(b.plan, legId).memo).toBeUndefined();
      b.run(deleteTransactions(b.plan, ctx, { transactionIds: [legId] }));
      expect(tx(b.plan, transactionId).deletedAt).toBeDefined();
      expect(tx(b.plan, legId).deletedAt).toBeDefined();
    });

    it('budget → tracking: the budget leg carries the category', () => {
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: rent, amount: usd(800) }));
      const { transactionId } = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-800), transferAccountId: house, categoryId: rent }));
      const t = tx(b.plan, transactionId);
      expect(t.categoryId).toBe(rent);
      expect(tx(b.plan, t.transferTransactionId ?? '').categoryId).toBeNull();
      expect(available(b.plan, rent)).toBe(usd(0));
      // Entered from the tracking side, the category still lands on the budget leg.
      const back = b.run(addTransaction(b.plan, ctx, { accountId: house, date: TODAY, amount: usd(-50), transferAccountId: checking, categoryId: READY_TO_ASSIGN }));
      const fromHouse = tx(b.plan, back.transactionId);
      expect(fromHouse.categoryId).toBeNull();
      expect(tx(b.plan, fromHouse.transferTransactionId ?? '')).toMatchObject({ accountId: checking, amount: usd(50), categoryId: READY_TO_ASSIGN });
      // Editing the tracking leg keeps the budget leg's category.
      b.run(editTransaction(b.plan, ctx, { transactionId: back.transactionId, patch: { amount: usd(-60) } }));
      expect(tx(b.plan, fromHouse.transferTransactionId ?? '')).toMatchObject({ amount: usd(60), categoryId: READY_TO_ASSIGN });
    });

    it('turning a transfer into a normal transaction deletes the other leg; re-pointing replaces it', () => {
      const { transactionId } = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-100), transferAccountId: savings }));
      const firstLeg = tx(b.plan, transactionId).transferTransactionId ?? '';
      b.run(editTransaction(b.plan, ctx, { transactionId, patch: { transferAccountId: visa } }));
      expect(tx(b.plan, firstLeg).deletedAt).toBeDefined();
      const secondLeg = tx(b.plan, transactionId).transferTransactionId ?? '';
      expect(tx(b.plan, secondLeg)).toMatchObject({ accountId: visa, amount: usd(100) });
      b.run(editTransaction(b.plan, ctx, { transactionId, patch: { transferAccountId: null, payeeName: 'Store', categoryId: groceries } }));
      const t = tx(b.plan, transactionId);
      expect(t.transferAccountId).toBeUndefined();
      expect(t.transferTransactionId).toBeUndefined();
      expect(t.categoryId).toBe(groceries);
      expect(tx(b.plan, secondLeg).deletedAt).toBeDefined();
    });

    it('splits: lines must add up; a transfer line has its own leg, edited through the split', () => {
      expect(() =>
        addTransaction(b.plan, ctx, {
          accountId: checking,
          date: TODAY,
          amount: usd(-100),
          subtransactions: [{ amount: usd(-60), categoryId: groceries }],
        }),
      ).toThrow(/add up/);
      const { transactionId } = b.run(
        addTransaction(b.plan, ctx, {
          accountId: checking,
          date: TODAY,
          amount: usd(-100),
          payeeName: 'Market',
          subtransactions: [
            { amount: usd(-60), categoryId: groceries, memo: 'food' },
            { amount: usd(-40), transferAccountId: savings },
          ],
        }),
      );
      const t = tx(b.plan, transactionId);
      expect(t.categoryId).toBeNull();
      const line = t.subtransactions?.[1];
      const legId = line?.transferTransactionId ?? '';
      expect(tx(b.plan, legId)).toMatchObject({ accountId: savings, amount: usd(40), transferAccountId: checking, transferTransactionId: line?.id });
      expect(() => editTransaction(b.plan, ctx, { transactionId: legId, patch: { amount: usd(1) } })).toThrow(/split/);
      expect(() => deleteTransactions(b.plan, ctx, { transactionIds: [legId] })).toThrow(/split/);
      // Memo on the leg is fine.
      b.run(editTransaction(b.plan, ctx, { transactionId: legId, patch: { memo: 'ok' } }));
      expect(tx(b.plan, legId)).toMatchObject({ memo: 'ok', amount: usd(40) });
      // Changing the line amount moves the leg.
      const lines = t.subtransactions ?? [];
      b.run(
        editTransaction(b.plan, ctx, {
          transactionId,
          patch: {
            amount: usd(-110),
            subtransactions: lines.map((s, i) => ({
              id: s.id,
              amount: i === 0 ? usd(-60) : usd(-50),
              categoryId: s.categoryId,
              ...(s.transferAccountId === undefined ? {} : { transferAccountId: s.transferAccountId }),
            })),
          },
        }),
      );
      expect(tx(b.plan, legId).amount).toBe(usd(50));
      // Dropping the transfer line deletes its leg.
      b.run(editTransaction(b.plan, ctx, { transactionId, patch: { amount: usd(-60), subtransactions: [{ id: lines[0]?.id ?? '', amount: usd(-60), categoryId: groceries }] } }));
      expect(tx(b.plan, legId).deletedAt).toBeDefined();
      expect(available(b.plan, groceries)).toBe(usd(-60));
    });

    it('cleared, flags and approval (approving one leg approves the other)', () => {
      const { transactionId } = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), transferAccountId: savings, approved: false }));
      const legId = tx(b.plan, transactionId).transferTransactionId ?? '';
      b.run(editTransaction(b.plan, ctx, { transactionId: legId, patch: { approved: false } }));
      expect(tx(b.plan, legId).approved).toBe(false);
      b.run(approveTransactions(b.plan, ctx, { transactionIds: [legId] }));
      expect(tx(b.plan, transactionId).approved).toBeUndefined();
      expect(tx(b.plan, legId).approved).toBeUndefined();
      b.run(setCleared(b.plan, ctx, { transactionIds: [transactionId], cleared: 'cleared' }));
      b.run(setFlag(b.plan, ctx, { transactionIds: [transactionId], flag: 'purple' }));
      expect(tx(b.plan, transactionId)).toMatchObject({ cleared: 'cleared', flag: 'purple' });
      b.run(setFlag(b.plan, ctx, { transactionIds: [transactionId], flag: null }));
      expect(tx(b.plan, transactionId).flag).toBeUndefined();
    });

    it('flag names: set, rename, clear (YNAB lets you name the six flags)', () => {
      b.run(setFlagName(b.plan, ctx, { color: 'red', name: 'Reimbursable' }));
      expect(b.plan.flagNames).toEqual([{ color: 'red', name: 'Reimbursable' }]);
      b.run(setFlagName(b.plan, ctx, { color: 'red', name: '  Work  ' }));
      expect(b.plan.flagNames).toEqual([{ color: 'red', name: 'Work' }]);
      b.run(setFlagName(b.plan, ctx, { color: 'red', name: '' }));
      expect(b.plan.flagNames).toEqual([]);
    });

    it('bulk edit is one command; a field skips the rows it does not apply to (YNAB multi-select)', () => {
      const shop = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-5), categoryId: groceries, payeeName: 'Shop' })).transactionId;
      const xfer = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-10), transferAccountId: savings })).transactionId;
      const split = b.run(
        addTransaction(b.plan, ctx, {
          accountId: checking,
          date: TODAY,
          amount: usd(-30),
          payeeName: 'Market',
          subtransactions: [
            { amount: usd(-20), categoryId: groceries },
            { amount: usd(-10), categoryId: rent },
          ],
        }),
      ).transactionId;
      const loan = b.run(addTransaction(b.plan, ctx, { accountId: house, date: TODAY, amount: usd(-1), payeeName: 'Interest' })).transactionId;
      const all = [shop, xfer, split, loan];

      // Categorize: only rows that take a category (not splits, budget ↔ budget transfers or tracking).
      const cat = editTransactions(b.plan, ctx, { transactionIds: all, patch: { categoryId: rent } });
      expect(cat.label).toBe('Categorize 1 transaction');
      b.run(cat);
      expect(tx(b.plan, shop).categoryId).toBe(rent);
      expect(tx(b.plan, xfer).categoryId).toBeNull();
      expect(tx(b.plan, split).subtransactions?.map((s) => s.categoryId)).toEqual([groceries, rent]);
      expect(tx(b.plan, loan).categoryId).toBeNull();

      // Memo and flag apply to every row; a transfer's other leg keeps its own memo.
      b.run(editTransactions(b.plan, ctx, { transactionIds: all, patch: { memo: 'Trip', flag: 'blue' } }));
      expect(all.map((id) => [tx(b.plan, id).memo, tx(b.plan, id).flag])).toEqual(all.map(() => ['Trip', 'blue']));
      b.run(editTransactions(b.plan, ctx, { transactionIds: all, patch: { memo: null, flag: null } }));
      expect(all.every((id) => tx(b.plan, id).memo === undefined && tx(b.plan, id).flag === undefined)).toBe(true);

      // Move to account: the transfer re-points its leg; a move to a tracking account drops the category.
      b.run(editTransactions(b.plan, ctx, { transactionIds: [shop, xfer], patch: { accountId: visa } }));
      expect(tx(b.plan, shop)).toMatchObject({ accountId: visa, categoryId: rent });
      expect(tx(b.plan, tx(b.plan, xfer).transferTransactionId ?? '')).toMatchObject({ accountId: savings, transferAccountId: visa, amount: usd(10) });
      // Moving a transfer onto its own other side is skipped.
      const onto = editTransactions(b.plan, ctx, { transactionIds: [xfer], patch: { accountId: savings } });
      expect(onto.changes).toEqual({});
      b.run(editTransactions(b.plan, ctx, { transactionIds: [shop], patch: { accountId: house } }));
      expect(tx(b.plan, shop)).toMatchObject({ accountId: house, categoryId: null });
    });

    it('bulk categorize of 1,000 rows on a 20,000-row plan stays under 200 ms (roadmap S4.6)', () => {
      const base = b.plan;
      const payeeId = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), categoryId: groceries, payeeName: 'Bulk' })).transactionId;
      const payee = tx(b.plan, payeeId).payeeId;
      const rows: TransactionRecord[] = Array.from({ length: 20_000 }, (_, i) => ({
        id: `bulk-${String(i).padStart(5, '0')}`,
        accountId: checking,
        date: TODAY,
        amount: minor(-100),
        ...(payee === undefined ? {} : { payeeId: payee }),
        categoryId: groceries,
        cleared: 'uncleared',
        createdAt: ctx.now,
      }));
      const big: PlanData = { ...b.plan, transactions: [...base.transactions, ...rows] };
      const ids = rows.slice(0, 1000).map((r) => r.id);
      const start = performance.now();
      const cmd = editTransactions(big, ctx, { transactionIds: ids, patch: { categoryId: rent } });
      const after = applyChanges(big, cmd.changes).plan;
      const ms = performance.now() - start;
      expect(after.transactions.filter((t) => t.categoryId === rent)).toHaveLength(1000);
      expect(ms).toBeLessThan(200);
    });

    it('duplicate copies rows, split lines and transfer legs; not a starting balance (YNAB trial)', () => {
      const xfer = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-10-02', amount: usd(-10), transferAccountId: savings, memo: 'move', flag: 'red' })).transactionId;
      const split = b.run(
        addTransaction(b.plan, ctx, {
          accountId: checking,
          date: '2026-10-03',
          amount: usd(-30),
          payeeName: 'Market',
          subtransactions: [
            { amount: usd(-20), categoryId: groceries },
            { amount: usd(-10), transferAccountId: savings },
          ],
        }),
      ).transactionId;
      b.run(setCleared(b.plan, ctx, { transactionIds: [split], cleared: 'reconciled' }));
      const start = live(b.plan).find((t) => t.accountId === checking && t.isStartingBalance === true)?.id ?? '';
      const before = accountBalance(new Draft(b.plan), savings);
      const dup = duplicateTransactions(b.plan, ctx, { transactionIds: [xfer, split, start] });
      expect(dup.label).toBe('Duplicate 3 transactions');
      b.run(dup);
      const [x2, s2, b2] = dup.transactionIds.map((id) => tx(b.plan, id));
      expect(x2).toMatchObject({ accountId: checking, date: '2026-10-02', amount: usd(-10), transferAccountId: savings, memo: 'move', flag: 'red', cleared: 'uncleared' });
      expect(x2?.transferTransactionId).not.toBe(tx(b.plan, xfer).transferTransactionId);
      expect(tx(b.plan, x2?.transferTransactionId ?? '')).toMatchObject({ accountId: savings, amount: usd(10) });
      // A reconciled row's copy is only cleared; split lines get new ids and new transfer legs.
      expect(s2?.cleared).toBe('cleared');
      expect(s2?.subtransactions?.map((s) => s.amount)).toEqual([usd(-20), usd(-10)]);
      expect(s2?.subtransactions?.some((s) => tx(b.plan, split).subtransactions?.some((o) => o.id === s.id))).toBe(false);
      expect(accountBalance(new Draft(b.plan), savings)).toBe(before + usd(20));
      // A starting balance copies as a plain inflow with no payee.
      expect(b2).toMatchObject({ amount: usd(1000), categoryId: READY_TO_ASSIGN, cleared: 'cleared' });
      expect(b2?.isStartingBalance).toBeUndefined();
      expect(b2?.payeeId).toBeUndefined();
    });

    it('undo labels say what changed (the toast reads "Undid: ...")', () => {
      const add = addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-5), categoryId: groceries, payeeName: 'Corner Bakery' });
      expect(add.label).toBe('Add transaction: Corner Bakery');
      b.run(add);
      expect(editTransaction(b.plan, ctx, { transactionId: add.transactionId, patch: { memo: 'm' } }).label).toBe('Edit transaction: Corner Bakery');
      expect(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-5), transferAccountId: savings }).label).toBe('Add transfer: Savings');
      expect(setCleared(b.plan, ctx, { transactionIds: [add.transactionId], cleared: 'cleared' }).label).toBe('Mark cleared');
      const two = [add.transactionId, live(b.plan).find((t) => t.isStartingBalance === true)?.id ?? ''];
      expect(setFlag(b.plan, ctx, { transactionIds: two, flag: 'red' }).label).toBe('Flag red (2 transactions)');
      expect(approveTransactions(b.plan, ctx, { transactionIds: two }).label).toBe('Approve (2 transactions)');
    });

    it('tracking accounts take no category', () => {
      expect(() => addTransaction(b.plan, ctx, { accountId: house, date: TODAY, amount: usd(-1), categoryId: groceries })).toThrow(/tracking/);
    });

    it('a payee learns its default when 2 of its last 3 agree (§5.13)', () => {
      const add = (category: string, date: string): void => {
        b.run(addTransaction(b.plan, ctx, { accountId: checking, date: date as typeof TODAY, amount: usd(-1), categoryId: category, payeeName: 'Shop' }));
      };
      add(groceries, '2026-10-01');
      const shop = (): string | null | undefined => b.plan.payees.find((p) => p.name === 'Shop')?.defaultCategoryId;
      expect(shop()).toBe(groceries);
      add(rent, '2026-10-02');
      expect(shop()).toBe(groceries);
      add(rent, '2026-10-03');
      expect(shop()).toBe(rent);
    });
  });

  describe('categories', () => {
    it('create, rename, hide, note, arrange; system groups refuse edits', () => {
      b.run(renameCategory(b.plan, ctx, { categoryId: rent, name: 'Rent/Mortgage' }));
      b.run(setCategoryHidden(b.plan, ctx, { categoryId: rent, hidden: true }));
      b.run(setCategoryNote(b.plan, ctx, { categoryId: rent, note: 'due 1st' }));
      expect(findRecord(b.plan, 'categories', rent)).toMatchObject({ name: 'Rent/Mortgage', hidden: true, note: 'due 1st' });
      b.run(arrangeCategories(b.plan, ctx, { groupId: bills, categoryIds: [rent, groceries] }));
      expect(findRecord(b.plan, 'categories', rent)?.sortOrder).toBe(0);
      const payment = b.plan.categories.find((c) => c.creditCardAccountId === visa);
      expect(() => renameCategory(b.plan, ctx, { categoryId: payment?.id ?? '', name: 'x' })).toThrow(/payment/);
      expect(() => arrangeCategories(b.plan, ctx, { groupId: bills, categoryIds: [payment?.id ?? ''] })).toThrow();
    });

    it('delete reassigns transactions and every month of money; Ready to Assign is unchanged', () => {
      b.run(setAssigned(b.plan, ctx, { month: '2026-09', categoryId: groceries, amount: usd(50) }));
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(300) }));
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: rent, amount: usd(100) }));
      b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-30), categoryId: groceries, payeeName: 'Shop' }));
      b.run(setTarget(b.plan, ctx, { categoryId: groceries, amount: usd(300), cadence: { kind: 'monthly', day: 'last' }, behavior: 'refill' }));
      const before = { rta: rta(b.plan), sum: available(b.plan, groceries) + available(b.plan, rent) };
      b.run(deleteCategory(b.plan, ctx, { categoryId: groceries, reassignTo: rent }));
      expect(rta(b.plan)).toBe(before.rta);
      expect(available(b.plan, rent)).toBe(before.sum);
      expect(findRecord(b.plan, 'categories', groceries)?.deletedAt).toBeDefined();
      expect(live(b.plan).some((t) => t.categoryId === groceries)).toBe(false);
      expect(b.plan.targets).toEqual([]);
      expect(b.plan.payees.find((p) => p.name === 'Shop')?.defaultCategoryId).toBe(rent);
      expect(b.plan.moneyMoves.filter((m) => m.kind === 'categoryDeleted').map((m) => [m.month, m.amount])).toEqual([
        ['2026-09', usd(50)],
        [OCT, usd(300)],
      ]);
      expect(budgetSnapshot(b.plan).categories.map((c) => c.id)).not.toContain(groceries);
    });

    it('an unused category is deleted without a reassignment (YNAB only asks when there is history)', () => {
      const spare = b.run(createCategory(b.plan, ctx, { groupId: bills, name: 'Spare' })).categoryId;
      expect(categoryInUse(b.plan, spare)).toEqual({ transactions: 0, scheduled: 0, months: 0 });
      b.run(deleteCategory(b.plan, ctx, { categoryId: spare }));
      expect(findRecord(b.plan, 'categories', spare)?.deletedAt).toBeDefined();
      expect(b.plan.moneyMoves.filter((m) => m.kind === 'categoryDeleted')).toEqual([]);
    });

    it('a category with history needs somewhere for it to go', () => {
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(10) }));
      b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-3), categoryId: groceries }));
      expect(categoryInUse(b.plan, groceries)).toEqual({ transactions: 1, scheduled: 0, months: 1 });
      expect(() => deleteCategory(b.plan, ctx, { categoryId: groceries })).toThrow(/reassign/i);
      // A deleted transaction no longer counts as history.
      const t = live(b.plan).find((x) => x.categoryId === groceries);
      b.run(deleteTransactions(b.plan, ctx, { transactionIds: [t?.id ?? ''] }));
      expect(categoryInUse(b.plan, groceries).transactions).toBe(0);
    });

    it('a group whose categories are all unused is deleted without a reassignment', () => {
      const other = b.run(createGroup(b.plan, ctx, { name: 'Someday' })).groupId;
      b.run(createCategory(b.plan, ctx, { groupId: other, name: 'Boat' }));
      b.run(deleteGroup(b.plan, ctx, { groupId: other }));
      expect(findRecord(b.plan, 'categoryGroups', other)?.deletedAt).toBeDefined();
      expect(() => deleteGroup(b.plan, ctx, { groupId: bills })).not.toThrow();
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: rent, amount: usd(1) }));
      expect(() => deleteGroup(b.plan, ctx, { groupId: bills })).toThrow(/reassign/i);
    });

    it('delete a group with its categories', () => {
      const other = b.run(createGroup(b.plan, ctx, { name: 'Fun' })).groupId;
      const fun = b.run(createCategory(b.plan, ctx, { groupId: other, name: 'Fun money' })).categoryId;
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: groceries, amount: usd(5) }));
      b.run(setAssigned(b.plan, ctx, { month: OCT, categoryId: rent, amount: usd(-5) }));
      b.run(deleteGroup(b.plan, ctx, { groupId: bills, reassignTo: fun }));
      expect(findRecord(b.plan, 'categoryGroups', bills)?.deletedAt).toBeDefined();
      // +5 and −5 merged into Fun money cancel out: no assignment row.
      expect(b.plan.assignments).toEqual([]);
      expect(() => deleteGroup(b.plan, ctx, { groupId: other, reassignTo: fun })).toThrow(/outside/);
    });

    it('targets: set, snooze, clear', () => {
      b.run(setTarget(b.plan, ctx, { categoryId: groceries, amount: usd(400), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside' }));
      expect(findRecord(b.plan, 'targets', groceries)).toMatchObject({ startMonth: OCT, createdOn: TODAY });
      b.run(snoozeTarget(b.plan, ctx, { categoryId: groceries, month: OCT, snoozed: true }));
      expect(findRecord(b.plan, 'targets', groceries)?.snoozedMonths).toEqual([OCT]);
      b.run(snoozeTarget(b.plan, ctx, { categoryId: groceries, month: OCT, snoozed: false }));
      expect(findRecord(b.plan, 'targets', groceries)?.snoozedMonths).toBeUndefined();
      expect(() => setTarget(b.plan, ctx, { categoryId: rent, amount: usd(1), cadence: { kind: 'monthly', day: 1 }, behavior: 'haveBalance' })).toThrow();
      b.run(clearTarget(b.plan, ctx, { categoryId: groceries }));
      expect(b.plan.targets).toEqual([]);
    });

    it('a card’s payment category takes Pay Off Balance by Date or Pay Specific Amount Monthly only (T-12)', () => {
      const payment = b.plan.categories.find((c) => c.creditCardAccountId === visa)?.id ?? '';
      const due = { kind: 'custom' as const, due: '2026-12-31' as const };
      b.run(setTarget(b.plan, ctx, { categoryId: payment, amount: usd(999), cadence: due, behavior: 'haveBalance', payOff: true }));
      expect(findRecord(b.plan, 'targets', payment)).toMatchObject({ amount: 0, payOff: true, cadence: due });
      b.run(setTarget(b.plan, ctx, { categoryId: payment, amount: usd(50), cadence: { kind: 'monthly', day: 'last' }, behavior: 'setAside' }));
      expect(findRecord(b.plan, 'targets', payment)?.payOff).toBeUndefined();
      expect(() => setTarget(b.plan, ctx, { categoryId: payment, amount: usd(50), cadence: { kind: 'monthly', day: 'last' }, behavior: 'refill' })).toThrow(/Pay Off Balance by Date/);
      expect(() => setTarget(b.plan, ctx, { categoryId: groceries, amount: usd(50), cadence: due, behavior: 'haveBalance', payOff: true })).toThrow(/credit card payment category/);
      // A pay-off target survives the file.
      b.run(setTarget(b.plan, ctx, { categoryId: payment, amount: usd(0), cadence: due, behavior: 'haveBalance', payOff: true }));
      const db = openMemoryPlan();
      applyRows(db, encodePlan(b.plan));
      expect(decodePlan(loadTables(db)).targets.find((t) => t.categoryId === payment)).toMatchObject({ payOff: true, amount: 0 });
    });
  });

  describe('payees', () => {
    it('combine moves every use and deletes the sources; delete is soft', () => {
      const a = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), payeeName: 'AMZN Mktp', categoryId: groceries }));
      b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), payeeName: 'Amazon', categoryId: groceries }));
      const src = tx(b.plan, a.transactionId).payeeId ?? '';
      const target = b.plan.payees.find((p) => p.name === 'Amazon')?.id ?? '';
      b.run(combinePayees(b.plan, ctx, { sourceIds: [src], targetId: target }));
      expect(tx(b.plan, a.transactionId).payeeId).toBe(target);
      expect(findRecord(b.plan, 'payees', src)?.deletedAt).toBeDefined();
      b.run(deletePayee(b.plan, ctx, { payeeId: target }));
      expect(findRecord(b.plan, 'payees', target)?.deletedAt).toBeDefined();
      const transfer = b.plan.payees.find((p) => p.transferAccountId === checking)?.id ?? '';
      expect(() => deletePayee(b.plan, ctx, { payeeId: transfer })).toThrow(/Transfer/);
    });

    it('delete without a replacement leaves its transactions with no payee; with one, they move', () => {
      const a = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), payeeName: 'Kiosk', categoryId: groceries }));
      const c = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), payeeName: 'Booth', categoryId: groceries }));
      const keep = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), payeeName: 'Market', categoryId: groceries }));
      const kiosk = tx(b.plan, a.transactionId).payeeId ?? '';
      const booth = tx(b.plan, c.transactionId).payeeId ?? '';
      const market = tx(b.plan, keep.transactionId).payeeId ?? '';
      b.run(addRenameRule(b.plan, ctx, { payeeId: kiosk, match: 'contains', pattern: 'KIOSK' }));
      b.run(deletePayees(b.plan, ctx, { payeeIds: [kiosk] }));
      expect(tx(b.plan, a.transactionId).payeeId).toBeUndefined();
      expect(b.plan.payeeRenameRules).toEqual([]);
      b.run(deletePayees(b.plan, ctx, { payeeIds: [booth], replacementId: market }));
      expect(tx(b.plan, c.transactionId).payeeId).toBe(market);
      expect(findRecord(b.plan, 'payees', booth)?.deletedAt).toBeDefined();
    });

    it('hide and show payees; transfer payees cannot hide', () => {
      const a = b.run(addTransaction(b.plan, ctx, { accountId: checking, date: TODAY, amount: usd(-1), payeeName: 'Fair', categoryId: groceries }));
      const fair = tx(b.plan, a.transactionId).payeeId ?? '';
      b.run(setPayeesHidden(b.plan, ctx, { payeeIds: [fair], hidden: true }));
      expect(findRecord(b.plan, 'payees', fair)?.hidden).toBe(true);
      b.run(setPayeesHidden(b.plan, ctx, { payeeIds: [fair], hidden: false }));
      expect(findRecord(b.plan, 'payees', fair)?.hidden).toBeUndefined();
      const transfer = b.plan.payees.find((p) => p.transferAccountId === checking)?.id ?? '';
      expect(() => setPayeesHidden(b.plan, ctx, { payeeIds: [transfer], hidden: true })).toThrow(/Transfer/);
    });

    it('renaming rules: add (also for a transfer payee), edit, delete; empty patterns are refused', () => {
      const transfer = b.plan.payees.find((p) => p.transferAccountId === checking)?.id ?? '';
      const { ruleId } = b.run(addRenameRule(b.plan, ctx, { payeeId: transfer, match: 'startsWith', pattern: ' XFER ' }));
      expect(findRecord(b.plan, 'payeeRenameRules', ruleId)).toMatchObject({ match: 'startsWith', pattern: 'XFER', targetPayeeId: transfer });
      b.run(editRenameRule(b.plan, ctx, { ruleId, match: 'equals', pattern: 'ONLINE XFER' }));
      expect(findRecord(b.plan, 'payeeRenameRules', ruleId)).toMatchObject({ match: 'equals', pattern: 'ONLINE XFER' });
      expect(() => addRenameRule(b.plan, ctx, { payeeId: transfer, match: 'contains', pattern: '  ' })).toThrow();
      b.run(deleteRenameRule(b.plan, ctx, { ruleId }));
      expect(b.plan.payeeRenameRules).toEqual([]);
    });
  });

  it('starting balance of a card is credit debt the payment category does not cover', () => {
    const payment = b.plan.categories.find((c) => c.creditCardAccountId === visa)?.id ?? '';
    expect(available(b.plan, payment)).toBe(minor(0));
  });
});
