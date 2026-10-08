// Test harness: run commands against memory and a real SQLite file side by side.
import { minor, type Minor } from '@hafb/shared';
import { expect } from 'vitest';
import { applyChanges, normalizePlan } from '../../src/changes.ts';
import { decodePlan, encodePlan } from '../../src/codec.ts';
import type { Command, CommandContext } from '../../src/commands/context.ts';
import { newPlan } from '../../src/commands/plan.ts';
import type { PlanData } from '../../src/records.ts';
import { applyRows, loadTables, openMemoryPlan } from './sqliteStore.ts';

export const TODAY = '2026-10-08';

export function makeCtx(prefix = 'id'): CommandContext & { tick: () => void } {
  let n = 0;
  let ms = 0;
  const ctx = {
    now: '2026-10-08T12:00:00.000Z',
    today: TODAY,
    newId: () => `${prefix}-${String(++n).padStart(6, '0')}`,
    tick: () => {
      ms += 1;
      ctx.now = `2026-10-08T12:00:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}Z`;
    },
  } satisfies CommandContext & { tick: () => void };
  return ctx;
}

export const usd = (dollars: number): Minor => minor(Math.round(dollars * 100));

export function blankPlan(ctx: CommandContext): PlanData {
  return newPlan(
    {
      name: 'Test',
      currencyCode: 'USD',
      currencyDecimals: 2,
      currencySymbol: '$',
      symbolPlacement: 'before',
      numberFormat: '123,456.78',
      dateFormat: 'MM/DD/YYYY',
      createdAt: ctx.now,
    },
    ctx,
  );
}

/** A plan held in memory and on disk; `run` applies a command to both and checks they agree. */
export class Bench {
  private readonly db = openMemoryPlan();
  constructor(public plan: PlanData) {
    applyRows(this.db, encodePlan(plan));
    this.check();
  }

  run<C extends Command>(command: C): C {
    const applied = applyChanges(this.plan, command.changes);
    applyRows(this.db, applied.rows);
    this.plan = applied.plan;
    this.check();
    return command;
  }

  disk(): PlanData {
    return normalizePlan(decodePlan(loadTables(this.db)));
  }

  check(): void {
    expect(this.disk()).toEqual(this.plan);
  }
}
