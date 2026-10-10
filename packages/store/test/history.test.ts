import { minor } from '@hafb/shared';
import { computeBudget } from '@hafb/engine';
import { describe, expect, it } from 'vitest';
import { normalizePlan } from '../src/changes.ts';
import { setAssigned, setMonthNote } from '../src/commands/index.ts';
import { canRedo, canUndo, emptyHistory, historyDo, historyRedo, historyUndo, redoLabel, undoLabel } from '../src/history.ts';
import { budgetSnapshot, planBudget } from '../src/snapshot.ts';
import { samplePlan } from './fixtures/samplePlan.ts';
import { makeCtx } from './helpers/harness.ts';

describe('history', () => {
  const ctx = makeCtx();
  const start = normalizePlan(samplePlan());

  it('do / undo / redo with labels; a new do clears redo', () => {
    const a = setAssigned(start, ctx, { month: '2026-10', categoryId: 'c-rent', amount: minor(100) });
    const s1 = historyDo(emptyHistory(), start, a.changes, a.label);
    if (!s1) throw new Error('no-op');
    expect(s1.log).toMatchObject({ direction: 'do', label: 'Assign: Rent' });
    expect(undoLabel(s1.history)).toBe('Assign: Rent');
    const u = historyUndo(s1.history, s1.plan);
    if (!u) throw new Error('nothing to undo');
    expect(u.plan).toEqual(start);
    expect(u.log.direction).toBe('undo');
    expect(u.log.forward).toEqual(s1.log.inverse);
    expect(canUndo(u.history)).toBe(false);
    expect(redoLabel(u.history)).toBe('Assign: Rent');
    const r = historyRedo(u.history, u.plan);
    if (!r) throw new Error('nothing to redo');
    expect(r.plan).toEqual(s1.plan);
    const u2 = historyUndo(r.history, r.plan);
    if (!u2) throw new Error('nothing to undo');
    const n = setMonthNote(u2.plan, ctx, { month: '2026-10', note: 'x' });
    const s2 = historyDo(u2.history, u2.plan, n.changes, n.label);
    expect(s2 && canRedo(s2.history)).toBe(false);
  });

  it('a command that changes nothing adds no undo step', () => {
    const same = setMonthNote(start, ctx, { month: '2026-10', note: 'October plan' });
    expect(historyDo(emptyHistory(), start, same.changes, same.label)).toBeNull();
    expect(historyUndo(emptyHistory(), start)).toBeNull();
    expect(historyRedo(emptyHistory(), start)).toBeNull();
  });

  it('keeps at most `limit` steps', () => {
    let history = emptyHistory(3);
    let plan = start;
    for (let i = 1; i <= 5; i++) {
      const c = setAssigned(plan, ctx, { month: '2026-10', categoryId: 'c-rent', amount: minor(i) });
      const s = historyDo(history, plan, c.changes, c.label);
      if (!s) throw new Error('no-op');
      ({ history, plan } = s);
    }
    expect(history.undo).toHaveLength(3);
  });
});

describe('snapshot', () => {
  it('drops deleted records and is memoized per plan', () => {
    const plan = normalizePlan(samplePlan());
    const s = budgetSnapshot(plan);
    expect(s.accounts.map((a) => a.id)).not.toContain('a-old');
    expect(s.categories.map((c) => c.id)).not.toContain('c-old');
    expect(s.categoryGroups.map((g) => g.id)).not.toContain('g-gone');
    expect(s.transactions.map((t) => t.id)).not.toContain('t-del');
    expect(budgetSnapshot(plan)).toBe(s);
    expect(planBudget(plan, { today: '2026-10-08' })).toBe(planBudget(plan, { today: '2026-10-08' }));
    expect(budgetSnapshot({ ...plan })).not.toBe(s);
  });

  it('shares one computation for any month the plain one already covers (S8.1)', () => {
    const plan = normalizePlan(samplePlan());
    const today = '2026-10-08';
    const plain = planBudget(plan, { today });
    expect(plain).toEqual(computeBudget(budgetSnapshot(plan), { today }));
    expect(plain.months).toEqual(['2026-09', '2026-10']);
    expect(planBudget(plan, { today, throughMonth: '2026-10' })).toBe(plain);
    expect(planBudget(plan, { today, throughMonth: '2026-09' })).toBe(plain);
    // Next month is cut from the same computation; later or earlier months compute on their own.
    expect(planBudget(plan, { today, throughMonth: '2026-11' })).toEqual(computeBudget(budgetSnapshot(plan), { today, throughMonth: '2026-11' }));
    const later = planBudget(plan, { today, throughMonth: '2026-12' });
    expect(later).not.toBe(plain);
    expect(later).toEqual(computeBudget(budgetSnapshot(plan), { today, throughMonth: '2026-12' }));
    expect(planBudget(plan, { today, throughMonth: '2026-08' })).toEqual(computeBudget(budgetSnapshot(plan), { today, throughMonth: '2026-08' }));
  });
});
