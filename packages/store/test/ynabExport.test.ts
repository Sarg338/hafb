// The YNAB-format export (S6.6) round-trips through the YNAB importer to the cent.
import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN } from '@hafb/engine';
import { addTransaction, createAccount, createCategory, createGroup, setAssigned } from '../src/commands/index.ts';
import { ynabExport, ynabPlanRows } from '../src/export/ynabExport.ts';
import { readZip } from '../src/import/zip.ts';
import { importYnabExport } from '../src/import/ynab.ts';
import type { PlanData } from '../src/records.ts';
import { planBudget } from '../src/snapshot.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

function household(): PlanData {
  const ctx = makeCtx();
  const b = new Bench(blankPlan(ctx));
  const checking = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(2000), date: '2026-09-01' })).accountId;
  const visa = b.run(createAccount(b.plan, ctx, { name: 'Visa', type: 'creditCard', startingBalance: usd(-150), date: '2026-09-01' })).accountId;
  const house = b.run(createAccount(b.plan, ctx, { name: 'House', type: 'mortgage', startingBalance: usd(-100000), date: '2026-09-01' })).accountId;
  const g = b.run(createGroup(b.plan, ctx, { name: 'Needs' })).groupId;
  const food = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Groceries' })).categoryId;
  const fun = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Fun' })).categoryId;
  const mortgage = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Mortgage' })).categoryId;
  for (const [month, id, amount] of [
    ['2026-09', food, 400],
    ['2026-09', fun, 50],
    ['2026-09', mortgage, 900],
    ['2026-10', food, 380],
  ] as const) b.run(setAssigned(b.plan, ctx, { month, categoryId: id, amount: usd(amount) }));
  b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-09-02', amount: usd(3000), payeeName: 'Employer', categoryId: READY_TO_ASSIGN }));
  b.run(addTransaction(b.plan, ctx, { accountId: visa, date: '2026-09-05', amount: usd(-120.55), payeeName: 'Grocer', categoryId: food }));
  b.run(addTransaction(b.plan, ctx, { accountId: visa, date: '2026-09-07', amount: usd(-80), payeeName: 'Cinema', categoryId: fun })); // overspent on credit
  b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-09-15', amount: usd(-900), transferAccountId: house, categoryId: mortgage }));
  b.run(addTransaction(b.plan, ctx, { accountId: checking, date: '2026-09-20', amount: usd(-200), transferAccountId: visa }));
  b.run(
    addTransaction(b.plan, ctx, {
      accountId: checking,
      date: '2026-10-03',
      amount: usd(-75),
      payeeName: 'Superstore',
      subtransactions: [
        { amount: usd(-50), categoryId: food, memo: 'weekly' },
        { amount: usd(-25), categoryId: fun },
      ],
    }),
  );
  return b.plan;
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

describe('YNAB-format export (S6.6)', () => {
  it('writes Plan.csv with every category and month, in YNAB’s layout', () => {
    const rows = ynabPlanRows(household(), '2026-10-08');
    expect(rows[0]).toEqual(['Month', 'Category Group/Category', 'Category Group', 'Category', 'Assigned', 'Activity', 'Available']);
    const groceriesSep = rows.find((r) => r[0] === 'Sep 2026' && r[3] === 'Groceries');
    expect(groceriesSep).toEqual(['Sep 2026', 'Needs: Groceries', 'Needs', 'Groceries', { n: '$400.00' }, { n: '-$120.55' }, { n: '$279.45' }]);
    expect(rows.some((r) => r[2] === 'Credit Card Payments' && r[3] === 'Visa')).toBe(true);
  });

  it('round-trips through the YNAB importer to the cent', async () => {
    const plan = household();
    const file = ynabExport(plan, '2026-10-08', '2026-10-08 10-55');
    expect(file.name).toBe('Test as of 2026-10-08 10-55 - YNAB format.zip');
    const zip = await readZip(file.bytes);
    expect([...zip.keys()]).toEqual(['Test as of 2026-10-08 10-55 - Plan.csv', 'Test as of 2026-10-08 10-55 - Register.csv']);
    let n = 0;
    const back = importYnabExport(
      { planCsv: text(zip.get(file.planFile)), registerCsv: text(zip.get(file.registerFile)) },
      { today: '2026-10-08', now: '2026-10-08T12:00:00.000Z', newId: () => `rt-${String((n += 1))}`, planName: 'Test', accountTypes: { Visa: 'creditCard', House: 'mortgage' } },
    ).plan;
    const a = planBudget(plan, { today: '2026-10-08' });
    const b = planBudget(back, { today: '2026-10-08' });
    const byName = (p: PlanData, state: typeof a) => {
      const groups = new Map(p.categoryGroups.map((g) => [g.id, g.name]));
      const out: Record<string, [number, number, number]> = {};
      for (const m of state.months) {
        for (const c of p.categories) {
          const cm = state.byMonth[m]?.categories[c.id];
          if (cm) out[`${m} ${groups.get(c.groupId) ?? ''}: ${c.name}`] = [cm.assigned, cm.activity, cm.available];
        }
      }
      return out;
    };
    expect(byName(back, b)).toEqual(byName(plan, a));
    expect(b.byMonth['2026-10']?.readyToAssign).toBe(a.byMonth['2026-10']?.readyToAssign);
    const balances = (p: PlanData, state: typeof a) => Object.fromEntries(p.accounts.map((x) => [x.name, state.accountBalances[x.id]?.working]));
    expect(balances(back, b)).toEqual(balances(plan, a));
  });
});
