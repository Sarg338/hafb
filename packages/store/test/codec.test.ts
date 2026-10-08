import { describe, expect, it } from 'vitest';
import { canonical, decodePlan, encodePlan, encodeRecord, keyRow, type LoadedTables } from '../src/codec.ts';
import { ENTITY_KINDS } from '../src/records.ts';
import { samplePlan } from './fixtures/samplePlan.ts';
import { applyRows, loadTables, openMemoryPlan } from './helpers/sqliteStore.ts';

describe('codec against the real schema (0001_init.sql)', () => {
  it('round-trips every record kind through SQLite unchanged', () => {
    const plan = samplePlan();
    const db = openMemoryPlan();
    applyRows(db, encodePlan(plan));
    expect(decodePlan(loadTables(db))).toEqual(plan);
  });

  it('the sample plan covers every entity kind', () => {
    const plan = samplePlan();
    for (const kind of ENTITY_KINDS) expect(plan[kind].length, kind).toBeGreaterThan(0);
  });

  it('hides the system Inflow group and Ready to Assign row from records', () => {
    const db = openMemoryPlan();
    applyRows(db, encodePlan(samplePlan()));
    const tables = loadTables(db);
    expect(tables.categories?.rows.some((r) => r.includes('ready-to-assign'))).toBe(true);
    const plan = decodePlan(tables);
    expect(plan.categories.map((c) => c.id)).not.toContain('ready-to-assign');
    expect(plan.categoryGroups.map((g) => g.id)).not.toContain('inflow');
  });

  it('every encoded row is accepted by the schema (columns and CHECKs agree)', () => {
    const db = openMemoryPlan();
    expect(() => {
      applyRows(db, encodePlan(samplePlan()));
    }).not.toThrow();
  });

  it('the schema refuses a split whose lines do not add up', () => {
    const plan = samplePlan();
    const db = openMemoryPlan();
    applyRows(db, encodePlan(plan));
    const split = plan.transactions.find((t) => t.id === 't-split');
    if (!split) throw new Error('fixture');
    const e = encodeRecord('transactions', { ...split, amount: split.amount + 1 } as typeof split);
    expect(() => {
      applyRows(db, { upserts: [{ table: e.table, rows: [e.row] }], deletes: [] });
    }).toThrow(/split invariant/);
  });

  it('the schema refuses fractional money', () => {
    const db = openMemoryPlan();
    applyRows(db, encodePlan(samplePlan()));
    expect(() => {
      applyRows(db, { upserts: [{ table: 'month_categories', rows: [{ month: '2026-11', category_id: 'c-rent', assigned: 1.5 }] }], deletes: [] });
    }).toThrow();
  });

  it('deleting a transaction by key removes its split lines (cascade)', () => {
    const db = openMemoryPlan();
    applyRows(db, encodePlan(samplePlan()));
    applyRows(db, { upserts: [], deletes: [{ table: 'transactions', keys: [keyRow('transactions', { id: 't-split' })] }] });
    const plan = decodePlan(loadTables(db));
    expect(plan.transactions.find((t) => t.id === 't-split')).toBeUndefined();
    expect(loadTables(db).subtransactions?.rows).toEqual([]);
  });
});

describe('decoding rejects damaged files', () => {
  const base = (): Record<string, { columns: string[]; rows: (string | number | null)[][] }> => {
    const db = openMemoryPlan();
    applyRows(db, encodePlan(samplePlan()));
    const t = loadTables(db);
    return JSON.parse(JSON.stringify(t)) as Record<string, { columns: string[]; rows: (string | number | null)[][] }>;
  };
  const poke = (tables: ReturnType<typeof base>, table: string, column: string, value: string | number | null): LoadedTables => {
    const data = tables[table];
    if (!data) throw new Error(table);
    const i = data.columns.indexOf(column);
    const row = data.rows[0];
    if (!row) throw new Error('no rows');
    row[i] = value;
    return tables;
  };

  it.each([
    ['accounts', 'type', 'bank'],
    ['transactions', 'amount', 1.5],
    ['transactions', 'date', '10/01/2026'],
    ['transactions', 'cleared', 'maybe'],
    ['accounts', 'on_budget', 2],
    ['targets', 'snoozed_months', '["October"]'],
    ['month_categories', 'assigned', '100'],
  ])('%s.%s = %j', (table, column, value) => {
    expect(() => decodePlan(poke(base(), table, column, value))).toThrow(/damaged/);
  });

  it('a missing table is an error, not an empty plan', () => {
    const tables = base();
    delete tables.transactions;
    expect(() => decodePlan(tables)).toThrow(/missing/);
  });
});

describe('canonical form', () => {
  it('drops defaults so equal plans compare equal', () => {
    expect(
      canonical('transactions', {
        id: 't',
        accountId: 'a',
        date: '2026-10-01',
        amount: -100 as never,
        categoryId: null,
        cleared: 'cleared',
        approved: true,
        isStartingBalance: false,
        createdAt: 'x',
      }),
    ).toEqual({ id: 't', accountId: 'a', date: '2026-10-01', amount: -100, categoryId: null, cleared: 'cleared', createdAt: 'x' });
    expect(canonical('payees', { id: 'p', name: 'P', autoCategorize: true, defaultCategoryFixed: false })).toEqual({ id: 'p', name: 'P' });
    expect(canonical('accounts', { id: 'a', name: 'A', type: 'cash', onBudget: true, closed: false, loan: {}, sortOrder: 0, createdAt: 'x' })).toEqual({
      id: 'a',
      name: 'A',
      type: 'cash',
      onBudget: true,
      sortOrder: 0,
      createdAt: 'x',
    });
  });

  it('every sample record is already canonical', () => {
    const plan = samplePlan();
    for (const kind of ENTITY_KINDS) {
      for (const record of plan[kind]) expect(canonical(kind, record), kind).toEqual(record);
    }
  });
});
