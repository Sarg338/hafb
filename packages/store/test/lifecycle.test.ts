// Plan lifecycle (S7.2): category templates, Fresh Start and archiving.
// YNAB references (trial, 2026-10-09):
// - Import Category Template: "Deselect any categories you do not want to include … Adding this
//   template will not overwrite anything in your plan, it will just add these new groups and
//   categories at the bottom." An imported category with an amount gets "Have a Balance of $60.00,
//   Eventually" (a balance target with no date).
// - Make a Fresh Start: the new plan has all accounts (unlinked ones at $0 for the user to update),
//   scheduled transactions, category groups, categories and targets; the archived plan keeps the
//   history and is named "<plan> (Archived on YYYY-MM-DD)".
import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN } from '@hafb/engine';
import {
  addScheduled,
  addTransaction,
  archivePlan,
  closeAccount,
  createAccount,
  createCategory,
  createGroup,
  freshStartPlan,
  importTemplate,
  setAssigned,
  setTarget,
  setTargets,
  snoozeTarget,
} from '../src/commands/index.ts';
import { TEMPLATES, type CategoryTemplate } from '../src/templates.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

const tiny: CategoryTemplate = {
  id: 'tiny',
  name: 'Tiny',
  description: 'Two groups for tests.',
  groups: [
    { name: 'Bills', categories: [{ name: 'Water', amount: 60 }, { name: 'Trash', amount: 40 }] },
    { name: 'Fun', categories: [{ name: 'Games' }] },
  ],
};

describe('category templates (S7.2)', () => {
  it('adds the chosen groups and categories at the bottom, with balance targets for amounts', () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const existing = b.run(createGroup(b.plan, ctx, { name: 'Bills' })).groupId;
    b.run(createCategory(b.plan, ctx, { groupId: existing, name: 'Water' }));
    const before = b.plan;
    const cmd = b.run(importTemplate(b.plan, ctx, { template: tiny, exclude: ['Bills/Trash'] }));
    expect(cmd.label).toBe('Import template: Tiny');
    // Nothing existing changed.
    for (const g of before.categoryGroups) expect(b.plan.categoryGroups.find((x) => x.id === g.id)).toEqual(g);
    for (const c of before.categories) expect(b.plan.categories.find((x) => x.id === c.id)).toEqual(c);
    const added = b.plan.categoryGroups.filter((g) => !before.categoryGroups.some((x) => x.id === g.id));
    expect(added.map((g) => g.name)).toEqual(['Bills', 'Fun']);
    const maxBefore = Math.max(...before.categoryGroups.map((g) => g.sortOrder));
    expect(added.every((g) => g.sortOrder > maxBefore)).toBe(true);
    const names = (gid: string) => b.plan.categories.filter((c) => c.groupId === gid).map((c) => c.name);
    expect(names(added[0]?.id ?? '')).toEqual(['Water']);
    expect(names(added[1]?.id ?? '')).toEqual(['Games']);
    const water = b.plan.categories.find((c) => c.groupId === added[0]?.id);
    expect(b.plan.targets.find((t) => t.categoryId === water?.id)).toMatchObject({ amount: 6000, behavior: 'haveBalance', cadence: { kind: 'custom' } });
    expect(b.plan.targets.find((t) => t.categoryId === water?.id)?.cadence).toEqual({ kind: 'custom' });
    // A category without an amount gets no target.
    const games = b.plan.categories.find((c) => c.name === 'Games');
    expect(b.plan.targets.some((t) => t.categoryId === games?.id)).toBe(false);
  });

  it('a group left empty by the selection is not added; selecting nothing is an error', () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    b.run(importTemplate(b.plan, ctx, { template: tiny, exclude: ['Fun/Games'] }));
    expect(b.plan.categoryGroups.some((g) => g.name === 'Fun')).toBe(false);
    expect(() => importTemplate(b.plan, ctx, { template: tiny, exclude: ['Bills/Water', 'Bills/Trash', 'Fun/Games'] })).toThrow(/Pick at least one category/);
  });

  it('every bundled template imports into a new plan', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const t of TEMPLATES) {
      const ctx = makeCtx();
      const b = new Bench(blankPlan(ctx));
      b.run(importTemplate(b.plan, ctx, { template: t, exclude: [] }));
      expect(b.plan.categories.filter((c) => c.creditCardAccountId === undefined).length).toBeGreaterThanOrEqual(t.groups.reduce((n, g) => n + g.categories.length, 0));
    }
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
});

describe('Fresh Start (§5.14, S7.2)', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const chk = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(1000), date: '2026-09-01' })).accountId;
    const visa = b.run(createAccount(b.plan, ctx, { name: 'Visa', type: 'creditCard', startingBalance: usd(-200), date: '2026-09-01' })).accountId;
    const old = b.run(createAccount(b.plan, ctx, { name: 'Old savings', type: 'savings', startingBalance: usd(0), date: '2026-09-01' })).accountId;
    b.run(closeAccount(b.plan, ctx, { accountId: old, zeroOut: false }));
    const g = b.run(createGroup(b.plan, ctx, { name: 'Needs' })).groupId;
    const food = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Groceries' })).categoryId;
    b.run(setTarget(b.plan, ctx, { categoryId: food, amount: usd(400), cadence: { kind: 'monthly', day: 'last' }, behavior: 'refill' }));
    b.run(snoozeTarget(b.plan, ctx, { categoryId: food, month: '2026-10', snoozed: true }));
    b.run(setAssigned(b.plan, ctx, { month: '2026-10', categoryId: food, amount: usd(300) }));
    b.run(addTransaction(b.plan, ctx, { accountId: chk, date: '2026-10-02', amount: usd(-50), payeeName: 'Store', categoryId: food }));
    b.run(addScheduled(b.plan, ctx, { accountId: chk, date: '2026-11-01', frequency: 'monthly', amount: usd(-90), payeeName: 'Power Co', categoryId: food }));
    return { ctx, b, chk, visa, food };
  };

  it('keeps structure, targets, scheduled and payees; every open account restarts at $0 today', () => {
    const { ctx, b, chk, visa, food } = setup();
    const fresh = freshStartPlan(b.plan, ctx, { name: 'Fresh', today: '2026-10-09' });
    expect(fresh.settings).toMatchObject({ name: 'Fresh', firstMonth: '2026-10', currencyCode: 'USD' });
    expect(fresh.settings.archivedAt).toBeUndefined();
    expect(fresh.accounts.map((a) => a.name)).toEqual(['Checking', 'Visa']);
    expect(fresh.transactions.map((t) => [t.accountId, t.date, t.amount, t.isStartingBalance, t.categoryId])).toEqual([
      [chk, '2026-10-09', 0, true, READY_TO_ASSIGN],
      [visa, '2026-10-09', 0, true, READY_TO_ASSIGN],
    ]);
    expect(fresh.transactions.every((t) => fresh.payees.find((p) => p.id === t.payeeId)?.name === 'Starting Balance')).toBe(true);
    expect(fresh.categories.map((c) => c.name)).toEqual(b.plan.categories.filter((c) => c.deletedAt === undefined).map((c) => c.name));
    expect(fresh.targets.find((t) => t.categoryId === food)).toMatchObject({ amount: usd(400), behavior: 'refill' });
    expect(fresh.targets.find((t) => t.categoryId === food)?.snoozedMonths).toBeUndefined();
    expect(fresh.scheduled.map((s) => s.amount)).toEqual([usd(-90)]);
    expect(fresh.assignments).toEqual([]);
    expect(fresh.moneyMoves).toEqual([]);
    expect(fresh.payees.some((p) => p.name === 'Power Co')).toBe(true);
    // It is a whole, valid plan: it loads into a fresh store unchanged.
    const nb = new Bench(fresh);
    expect(nb.plan).toEqual(fresh);
  });

  it('archiving renames the old plan and stamps it, in one undoable change', () => {
    const { ctx, b } = setup();
    const cmd = b.run(archivePlan(b.plan, ctx, { today: '2026-10-09' }));
    expect(cmd.label).toBe('Archive plan');
    expect(b.plan.settings.name).toBe('Test (Archived on 2026-10-09)');
    expect(b.plan.settings.archivedAt).toBe(ctx.now);
    expect(() => archivePlan(b.plan, ctx, { today: '2026-10-10' })).toThrow(/already archived/);
  });
});

describe('re-entering targets after a YNAB import (S7.2)', () => {
  it('sets several targets as one step, and refuses an invalid one', () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const g = b.run(createGroup(b.plan, ctx, { name: 'Needs' })).groupId;
    const rent = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Rent' })).categoryId;
    const food = b.run(createCategory(b.plan, ctx, { groupId: g, name: 'Food' })).categoryId;
    const cmd = b.run(
      setTargets(b.plan, ctx, {
        targets: [
          { categoryId: rent, amount: usd(1500), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside' },
          { categoryId: food, amount: usd(150), cadence: { kind: 'weekly', weekday: 6 }, behavior: 'refill' },
        ],
      }),
    );
    expect(cmd.label).toBe('Set 2 targets');
    expect(b.plan.targets.map((t) => [t.categoryId, t.amount, t.behavior])).toEqual([
      [rent, usd(1500), 'setAside'],
      [food, usd(150), 'refill'],
    ]);
    expect(() => setTargets(b.plan, ctx, { targets: [{ categoryId: rent, amount: usd(-5), cadence: { kind: 'monthly', day: 1 }, behavior: 'setAside' }] })).toThrow();
  });
});
