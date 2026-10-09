import { describe, expect, it } from 'vitest';
import {
  addScheduled,
  addTransaction,
  createAccount,
  createCategory,
  createGroup,
  deleteScheduled,
  editScheduled,
  editScheduledMany,
  enterDueScheduled,
  enterScheduledNow,
  makeRepeating,
  scheduledInput,
  skipScheduled,
} from '../src/commands/index.ts';
import { applyChanges } from '../src/changes.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

describe('scheduled transactions (§5.11)', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(1000) })).accountId;
    const wallet = b.run(createAccount(b.plan, ctx, { name: 'Wallet', type: 'cash', startingBalance: usd(50) })).accountId;
    const g = b.run(createGroup(b.plan, ctx, { name: 'Bills' })).groupId;
    const rent = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Rent' })).categoryId;
    const power = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Power' })).categoryId;
    return { ctx, b, checking, wallet, rent, power };
  };
  const live = (b: Bench) => b.plan.scheduled.filter((s) => s.deletedAt === undefined);
  const fromSchedule = (b: Bench, id: string) => b.plan.transactions.filter((t) => t.scheduledTransactionId === id && t.deletedAt === undefined);

  it('add and edit keep the anchor day; a new date sets a new one', () => {
    const { ctx, b, checking, rent } = setup();
    const { scheduledId } = b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-10-31', frequency: 'monthly', amount: usd(-1200), payeeName: 'Landlord', categoryId: rent, memo: ' rent ' }));
    expect(live(b)[0]).toMatchObject({ id: scheduledId, date: '2026-10-31', anchorDay: 31, categoryId: rent, memo: 'rent' });
    expect(b.plan.payees.some((p) => p.name === 'Landlord')).toBe(true);
    b.run(editScheduled(b.plan, ctx, { scheduledId, input: { accountId: checking, date: '2026-10-31', frequency: 'monthly', amount: usd(-1250), payeeName: 'Landlord', categoryId: rent } }));
    expect(live(b)[0]).toMatchObject({ amount: usd(-1250), anchorDay: 31 });
    expect(live(b)[0]?.memo).toBeUndefined();
    b.run(editScheduled(b.plan, ctx, { scheduledId, input: { accountId: checking, date: '2026-11-15', frequency: 'monthly', amount: usd(-1250), categoryId: rent } }));
    expect(live(b)[0]).toMatchObject({ date: '2026-11-15', anchorDay: 15 });
    // Nothing is entered until its date.
    expect(fromSchedule(b, scheduledId)).toHaveLength(0);
  });

  it('a transfer between budget accounts has no category; splits must add up', () => {
    const { ctx, b, checking, wallet, rent, power } = setup();
    b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-11-01', frequency: 'weekly', amount: usd(-40), transferAccountId: wallet, categoryId: rent }));
    expect(live(b)[0]).toMatchObject({ transferAccountId: wallet, categoryId: null });
    expect(() => addScheduled(b.plan, ctx, { accountId: checking, date: '2026-11-01', frequency: 'monthly', amount: usd(-100), subtransactions: [{ amount: usd(-60), categoryId: rent }, { amount: usd(-30), categoryId: power }] })).toThrow(/add up/);
    expect(() => addScheduled(b.plan, ctx, { accountId: checking, date: '2026-11-01', frequency: 'monthly', amount: usd(-1), transferAccountId: checking })).toThrow(/two different/);
  });

  it('due occurrences become unapproved transactions and the schedule moves on (31st clamps, then returns)', () => {
    const { ctx, b, checking, wallet, rent } = setup();
    const { scheduledId } = b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-08-31', frequency: 'monthly', amount: usd(-1200), payeeName: 'Landlord', categoryId: rent }));
    const cash = b.run(addScheduled(b.plan, ctx, { accountId: wallet, date: '2026-10-08', frequency: 'never', amount: usd(-5), payeeName: 'Cafe', categoryId: rent })).scheduledId;
    const due = enterDueScheduled(b.plan, ctx);
    expect(due?.transactionIds).toHaveLength(3);
    if (due) b.run(due);
    expect(fromSchedule(b, scheduledId).map((t) => t.date).sort()).toEqual(['2026-08-31', '2026-09-30']);
    expect(fromSchedule(b, scheduledId).every((t) => !t.approved && t.cleared === 'uncleared' && t.categoryId === rent)).toBe(true);
    expect(live(b).find((s) => s.id === scheduledId)?.date).toBe('2026-10-31');
    // A one-time schedule is used up; cash accounts enter cleared.
    expect(live(b).some((s) => s.id === cash)).toBe(false);
    expect(fromSchedule(b, cash)[0]).toMatchObject({ cleared: 'cleared', approved: false, date: '2026-10-08' });
    // Re-running finds nothing.
    expect(enterDueScheduled(b.plan, ctx)).toBeNull();
  });

  it('a scheduled transfer enters both legs', () => {
    const { ctx, b, checking, wallet } = setup();
    const { scheduledId } = b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-10-01', frequency: 'monthly', amount: usd(-40), transferAccountId: wallet }));
    const due = enterDueScheduled(b.plan, ctx);
    if (due) b.run(due);
    const [leg] = fromSchedule(b, scheduledId);
    expect(leg).toMatchObject({ amount: usd(-40), transferAccountId: wallet });
    const other = b.plan.transactions.find((t) => t.id === leg?.transferTransactionId);
    expect(other).toMatchObject({ accountId: wallet, amount: usd(40) });
  });

  it('Enter Now enters early (dated today, approved) and moves on; Skip moves on; one-time ones are used up', () => {
    const { ctx, b, checking, power } = setup();
    const { scheduledId } = b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-10-20', frequency: 'everyOtherWeek', amount: usd(-80), payeeName: 'Power Co', categoryId: power }));
    const now = b.run(enterScheduledNow(b.plan, ctx, { scheduledIds: [scheduledId] }));
    expect(now.transactionIds).toHaveLength(1);
    expect(fromSchedule(b, scheduledId)[0]).toMatchObject({ date: '2026-10-08', categoryId: power });
    expect(fromSchedule(b, scheduledId)[0]?.approved).not.toBe(false);
    expect(live(b)[0]?.date).toBe('2026-11-03');
    b.run(skipScheduled(b.plan, ctx, { scheduledIds: [scheduledId] }));
    expect(live(b)[0]?.date).toBe('2026-11-17');
    expect(fromSchedule(b, scheduledId)).toHaveLength(1);
    b.run(editScheduled(b.plan, ctx, { scheduledId, input: { accountId: checking, date: '2026-11-17', frequency: 'never', amount: usd(-80), categoryId: power } }));
    b.run(skipScheduled(b.plan, ctx, { scheduledIds: [scheduledId] }));
    expect(live(b)).toHaveLength(0);
  });

  it('Categorize, Flag and Memo on several schedules; editing from scheduledInput changes nothing', () => {
    const { ctx, b, checking, rent, power } = setup();
    const a = b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-11-01', frequency: 'monthly', amount: usd(-10), payeeName: 'A', categoryId: rent, memo: 'old' })).scheduledId;
    const s = b.run(addScheduled(b.plan, ctx, { accountId: checking, date: '2026-11-02', frequency: 'monthly', amount: usd(-30), payeeName: 'B', subtransactions: [{ amount: usd(-10), categoryId: rent }, { amount: usd(-20), categoryId: power }] })).scheduledId;
    const before = b.plan;
    const record = live(b).find((x) => x.id === s);
    if (!record) throw new Error('missing schedule');
    const same = editScheduled(b.plan, ctx, { scheduledId: s, input: scheduledInput(record) });
    expect(applyChanges(before, same.changes).plan).toEqual(before);
    b.run(editScheduledMany(b.plan, ctx, { scheduledIds: [a, s], patch: { categoryId: power, flag: 'red', memo: 'bills' } }));
    expect(live(b).find((x) => x.id === a)).toMatchObject({ categoryId: power, flag: 'red', memo: 'bills' });
    expect(live(b).find((x) => x.id === s)).toMatchObject({ categoryId: null, flag: 'red', memo: 'bills' });
    expect(live(b).find((x) => x.id === s)?.subtransactions?.map((l) => l.categoryId)).toEqual([rent, power]);
    b.run(editScheduledMany(b.plan, ctx, { scheduledIds: [a], patch: { flag: null, memo: null } }));
    expect(live(b).find((x) => x.id === a)?.flag).toBeUndefined();
    expect(live(b).find((x) => x.id === a)?.memo).toBeUndefined();
  });

  it('Make Repeating schedules a copy one period later, keeping the day; delete removes it', () => {
    const { ctx, b, checking, rent, power } = setup();
    const { transactionId } = b.run(
      addTransaction(b.plan, ctx, { accountId: checking, date: '2026-01-31', amount: usd(-100), payeeName: 'Store', memo: 'split', subtransactions: [{ amount: usd(-60), categoryId: rent }, { amount: usd(-40), categoryId: power }] }),
    );
    const { scheduledId } = b.run(makeRepeating(b.plan, ctx, { transactionId, frequency: 'monthly' }));
    const s = live(b)[0];
    expect(s).toMatchObject({ id: scheduledId, date: '2026-02-28', anchorDay: 31, amount: usd(-100), memo: 'split', categoryId: null });
    expect(s?.subtransactions?.map((l) => [l.amount, l.categoryId])).toEqual([
      [usd(-60), rent],
      [usd(-40), power],
    ]);
    expect(() => makeRepeating(b.plan, ctx, { transactionId, frequency: 'never' })).toThrow();
    b.run(deleteScheduled(b.plan, ctx, { scheduledIds: [scheduledId] }));
    expect(live(b)).toHaveLength(0);
  });
});
