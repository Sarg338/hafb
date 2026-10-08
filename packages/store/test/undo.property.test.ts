// Property (roadmap S2.3): any command sequence followed by full undo restores the starting plan,
// and at every step — do, undo, redo — the SQLite file decodes to exactly the in-memory plan.
import { READY_TO_ASSIGN, ValidationError, type FlagColor } from '@hafb/engine';
import { minor, type ISODate, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { normalizePlan } from '../src/changes.ts';
import { decodePlan, encodePlan } from '../src/codec.ts';
import {
  addTransaction,
  approveTransactions,
  combinePayees,
  createAccount,
  createCategory,
  createGroup,
  deleteCategory,
  deleteTransactions,
  editAccount,
  editTransaction,
  moveMoney,
  renameCategory,
  setAssigned,
  setCleared,
  setFlag,
  setMonthNote,
  setTarget,
  snoozeTarget,
  type Command,
} from '../src/commands/index.ts';
import { emptyHistory, historyDo, historyRedo, historyUndo, type History } from '../src/history.ts';
import type { PlanData } from '../src/records.ts';
import { samplePlan } from './fixtures/samplePlan.ts';
import { makeCtx } from './helpers/harness.ts';
import { applyRows, loadTables, openMemoryPlan } from './helpers/sqliteStore.ts';

/** mulberry32: a tiny deterministic PRNG for reproducible seeds. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS: Month[] = ['2026-09', '2026-10', '2026-11'];
const DATES: ISODate[] = ['2026-09-15', '2026-10-01', '2026-10-08', '2026-10-20'];
const FLAGS: (FlagColor | null)[] = ['red', 'blue', null];

function randomCommand(plan: PlanData, rnd: () => number, ctx: ReturnType<typeof makeCtx>): Command | null {
  const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)];
  const amount = (): number => Math.round((rnd() - 0.5) * 2000) * 10;
  const accounts = plan.accounts.filter((a) => a.deletedAt === undefined && !a.closed);
  const budgetAccounts = accounts.filter((a) => a.onBudget);
  const categories = plan.categories.filter((c) => c.deletedAt === undefined);
  const userCategories = categories.filter((c) => c.creditCardAccountId === undefined);
  const groups = plan.categoryGroups.filter((g) => g.deletedAt === undefined && g.systemKind === undefined);
  const txs = plan.transactions.filter((t) => t.deletedAt === undefined);
  const payees = plan.payees.filter((p) => p.deletedAt === undefined && p.transferAccountId === undefined);
  const a = pick(accounts);
  const ba = pick(budgetAccounts);
  const c = pick(userCategories);
  const t = pick(txs);
  switch (Math.floor(rnd() * 18)) {
    case 0:
      return c ? setAssigned(plan, ctx, { month: pick(MONTHS) ?? '2026-10', categoryId: c.id, amount: minor(amount()) }) : null;
    case 1: {
      const d = pick(userCategories);
      return c && d ? moveMoney(plan, ctx, { month: pick(MONTHS) ?? '2026-10', from: c.id, to: rnd() < 0.2 ? READY_TO_ASSIGN : d.id, amount: minor(Math.abs(amount()) + 1) }) : null;
    }
    case 2:
    case 3:
      return ba
        ? addTransaction(plan, ctx, {
            accountId: ba.id,
            date: pick(DATES) ?? '2026-10-08',
            amount: minor(amount()),
            categoryId: rnd() < 0.2 ? READY_TO_ASSIGN : (c?.id ?? null),
            payeeName: pick(['Store', 'Cafe', 'Landlord']) ?? 'Store',
            ...(rnd() < 0.3 ? { flag: 'green' as const } : {}),
          })
        : null;
    case 4: {
      const other = pick(accounts.filter((x) => x.id !== a?.id));
      return a && other
        ? addTransaction(plan, ctx, {
            accountId: a.id,
            date: pick(DATES) ?? '2026-10-08',
            amount: minor(amount()),
            transferAccountId: other.id,
            categoryId: a.onBudget !== other.onBudget ? (c?.id ?? null) : null,
          })
        : null;
    }
    case 5: {
      const other = pick(budgetAccounts.filter((x) => x.id !== ba?.id));
      const first = amount();
      const second = amount();
      return ba && c && other
        ? addTransaction(plan, ctx, {
            accountId: ba.id,
            date: pick(DATES) ?? '2026-10-08',
            amount: minor(first + second),
            subtransactions: [
              { amount: minor(first), categoryId: c.id, memo: 'line' },
              rnd() < 0.5 ? { amount: minor(second), transferAccountId: other.id } : { amount: minor(second), categoryId: READY_TO_ASSIGN },
            ],
          })
        : null;
    }
    case 6:
      return t ? editTransaction(plan, ctx, { transactionId: t.id, patch: { amount: minor(amount()), date: pick(DATES) ?? t.date, memo: rnd() < 0.5 ? 'edited' : null } }) : null;
    case 7:
      return t ? editTransaction(plan, ctx, { transactionId: t.id, patch: { transferAccountId: rnd() < 0.5 ? null : (pick(accounts)?.id ?? null) } }) : null;
    case 8:
      return t ? deleteTransactions(plan, ctx, { transactionIds: [t.id] }) : null;
    case 9:
      return t ? setCleared(plan, ctx, { transactionIds: [t.id], cleared: pick(['cleared', 'uncleared', 'reconciled'] as const) ?? 'cleared' }) : null;
    case 10:
      return t ? setFlag(plan, ctx, { transactionIds: [t.id], flag: pick(FLAGS) ?? null }) : null;
    case 11:
      return t ? approveTransactions(plan, ctx, { transactionIds: [t.id] }) : null;
    case 12:
      return createAccount(plan, ctx, {
        name: `Acct ${String(Math.floor(rnd() * 100))}`,
        type: pick(['checking', 'creditCard', 'asset', 'cash'] as const) ?? 'checking',
        startingBalance: minor(amount()),
      });
    case 13: {
      const g = pick(groups);
      if (rnd() < 0.3 || !g) return createGroup(plan, ctx, { name: 'G' });
      return createCategory(plan, ctx, { groupId: g.id, name: `Cat ${String(Math.floor(rnd() * 100))}` });
    }
    case 14: {
      const d = pick(userCategories.filter((x) => x.id !== c?.id));
      return c && d ? deleteCategory(plan, ctx, { categoryId: c.id, reassignTo: d.id }) : null;
    }
    case 15:
      if (c && rnd() < 0.5) return renameCategory(plan, ctx, { categoryId: c.id, name: 'Renamed' });
      return a ? editAccount(plan, ctx, { accountId: a.id, name: `${a.name}!`, starred: rnd() < 0.5 }) : null;
    case 16: {
      if (!c) return null;
      if (rnd() < 0.5 || !plan.targets.some((x) => x.categoryId === c.id)) {
        return setTarget(plan, ctx, { categoryId: c.id, amount: minor(Math.abs(amount()) + 100), cadence: { kind: 'monthly', day: 'last' }, behavior: 'refill' });
      }
      return snoozeTarget(plan, ctx, { categoryId: c.id, month: pick(MONTHS) ?? '2026-10', snoozed: rnd() < 0.7 });
    }
    default: {
      if (rnd() < 0.5) return setMonthNote(plan, ctx, { month: pick(MONTHS) ?? '2026-10', note: rnd() < 0.7 ? 'note' : '' });
      const p = pick(payees);
      const q = pick(payees.filter((x) => x.id !== p?.id));
      return p && q ? combinePayees(plan, ctx, { sourceIds: [p.id], targetId: q.id }) : null;
    }
  }
}

describe('undo restores the plan exactly; disk always equals memory', () => {
  const SEEDS = 200;
  const STEPS = 25;
  /** Seeds that compare the decoded file after every single step (the rest compare at phase ends). */
  const EVERY_STEP = 60;
  let applied = 0;
  let rejected = 0;

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))('seed %i', (seed) => {
    {
      const everyStep = seed <= EVERY_STEP;
      const rnd = prng(seed);
      const ctx = makeCtx(`s${String(seed).padStart(3, '0')}`);
      const start = normalizePlan(samplePlan());
      const db = openMemoryPlan();
      applyRows(db, encodePlan(start));
      const disk = (): PlanData => normalizePlan(decodePlan(loadTables(db)));

      let plan = start;
      let history: History = emptyHistory();
      const states: PlanData[] = [start];
      for (let step = 0; step < STEPS; step++) {
        ctx.tick();
        let cmd: Command | null;
        try {
          cmd = randomCommand(plan, rnd, ctx);
        } catch (e) {
          if (!(e instanceof ValidationError)) throw e;
          rejected++;
          continue;
        }
        if (!cmd) continue;
        const s = historyDo(history, plan, cmd.changes, cmd.label);
        if (!s) continue;
        applyRows(db, s.rows);
        ({ plan, history } = s);
        states.push(plan);
        applied++;
        if (everyStep) expect(disk(), `seed ${String(seed)} step ${String(step)} ${cmd.label}`).toEqual(plan);
      }
      expect(disk()).toEqual(plan);
      const end = plan;

      // Undo everything, checking each intermediate state on disk and in memory.
      for (let i = states.length - 2; i >= 0; i--) {
        const s = historyUndo(history, plan);
        if (!s) throw new Error('undo stack ran out early');
        applyRows(db, s.rows);
        ({ plan, history } = s);
        expect(plan, `seed ${String(seed)} undo to ${String(i)}`).toEqual(states[i]);
        if (everyStep) expect(disk()).toEqual(plan);
      }
      expect(disk()).toEqual(start);
      expect(historyUndo(history, plan)).toBeNull();
      expect(plan).toEqual(start);

      // Redo everything back to the end.
      for (;;) {
        const s = historyRedo(history, plan);
        if (!s) break;
        applyRows(db, s.rows);
        ({ plan, history } = s);
        if (everyStep) expect(disk()).toEqual(plan);
      }
      expect(plan).toEqual(end);
      expect(disk()).toEqual(end);
    }
  });

  it('the generator exercises commands rather than mostly failing validation', () => {
    expect(applied).toBeGreaterThan(SEEDS * STEPS * 0.6);
    expect(rejected).toBeLessThan(applied / 4);
  });
});
