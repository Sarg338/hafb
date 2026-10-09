import { describe, expect, it } from 'vitest';
import { minor, type ISODate } from '@hafb/shared';
import { applyChanges, moveMoney, setAssigned, type Command, type CommandContext, type PlanData } from '@hafb/store';
import { buildSamplePlan } from '../../design/sample.ts';
import { categoryMoves, monthTag, recentMoves } from './movesModel.ts';

const base = buildSamplePlan().plan;
const cat = (name: string): string => base.categories.find((c) => c.name === name)?.id ?? '';
const utcDate = (ts: string): ISODate => ts.slice(0, 10) as ISODate;
let n = 0;
const at = (now: string): CommandContext => ({ now, today: now.slice(0, 10) as ISODate, newId: () => `mv-${String((n += 1))}` });
const run = (plan: PlanData, cmd: Command): PlanData => applyChanges(plan, cmd.changes).plan;

// A plan whose only moves are the ones these tests make.
const fresh = (): PlanData => ({ ...base, moneyMoves: [] });

describe('Recent Moves (S5.7)', () => {
  it('lists the last 34 days newest first by day, with Assigned / Removed / Moved wording', () => {
    let p = fresh();
    p = run(p, setAssigned(p, at('2026-09-01T12:00:00.000Z'), { month: '2026-09', categoryId: cat('Groceries'), amount: minor(1) })); // 37 days before: out of range
    p = run(p, setAssigned(p, at('2026-10-06T12:00:00.000Z'), { month: '2026-10', categoryId: cat('Gifts'), amount: minor(20_000) }));
    p = run(p, setAssigned(p, at('2026-10-08T09:00:00.000Z'), { month: '2026-10', categoryId: cat('Gifts'), amount: minor(15_000) }));
    p = run(p, moveMoney(p, at('2026-10-08T10:00:00.000Z'), { month: '2026-10', from: cat('Dining Out'), to: cat('Groceries'), amount: minor(5_000) }));
    const days = recentMoves(p, '2026-10-08', 'all', utcDate);
    expect(days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-06']);
    const today = days[0]?.moves ?? [];
    expect(today[0]).toMatchObject({ verb: 'Moved', amount: 5_000, from: { name: 'Dining Out', month: '2026-10' }, to: { name: 'Groceries' } });
    expect(today[1]).toMatchObject({ verb: 'Removed', amount: 5_000, from: { name: 'Gifts' }, to: null });
    expect(days[1]?.moves[0]).toMatchObject({ verb: 'Assigned', to: { name: 'Gifts' } });
    expect(recentMoves(p, '2026-10-08', 'moved', utcDate).flatMap((d) => d.moves.map((m) => m.verb))).toEqual(['Moved']);
    expect(recentMoves(p, '2026-10-08', 'assigned', utcDate).flatMap((d) => d.moves.map((m) => m.verb))).toEqual(['Removed', 'Assigned']);
    expect(recentMoves(fresh(), '2026-10-08', 'all', utcDate)).toEqual([]);
  });

  it("a category's Moves: three months, signed for that category", () => {
    let p = fresh();
    p = run(p, setAssigned(p, at('2026-07-01T12:00:00.000Z'), { month: '2026-07', categoryId: cat('Groceries'), amount: minor(100) })); // 4 months back: out
    p = run(p, setAssigned(p, at('2026-08-02T12:00:00.000Z'), { month: '2026-08', categoryId: cat('Groceries'), amount: minor(40_000) }));
    p = run(p, moveMoney(p, at('2026-10-08T10:00:00.000Z'), { month: '2026-10', from: cat('Groceries'), to: cat('Dining Out'), amount: minor(2_500) }));
    const rows = categoryMoves(p, cat('Groceries'), '2026-10', utcDate);
    expect(rows.map((r) => [r.date, r.move, r.amount])).toEqual([
      ['2026-10-08', 'Moved to Dining Out', -2_500],
      ['2026-08-02', 'Removed', -32_000], // the sample had $720 assigned
    ]);
    expect(categoryMoves(p, cat('Dining Out'), '2026-10', utcDate)[0]).toMatchObject({ move: 'Moved from Groceries', amount: 2_500 });
    expect(monthTag('2026-10')).toBe('OCT 2026');
  });
});
