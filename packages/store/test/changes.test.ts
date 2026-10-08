import { minor } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { applyChanges, deepEqual, findRecord, mergeChangeSets, normalizePlan, type ChangeSet } from '../src/changes.ts';
import { decodePlan, encodePlan } from '../src/codec.ts';
import type { PlanData, TransactionRecord } from '../src/records.ts';
import { samplePlan } from './fixtures/samplePlan.ts';
import { applyRows, loadTables, openMemoryPlan } from './helpers/sqliteStore.ts';

const T0 = '2026-10-08T12:00:00.000Z';
const plan0 = (): PlanData => normalizePlan(samplePlan());

function tx(id: string, extra: Partial<TransactionRecord> = {}): TransactionRecord {
  return { id, accountId: 'a-chk', date: '2026-10-09', amount: minor(-100), categoryId: 'c-food', cleared: 'uncleared', createdAt: T0, ...extra };
}

/** Apply through memory and SQLite; return both views. */
function both(start: PlanData, changes: ChangeSet) {
  const db = openMemoryPlan();
  applyRows(db, encodePlan(start));
  const applied = applyChanges(start, changes);
  applyRows(db, applied.rows);
  return { applied, disk: normalizePlan(decodePlan(loadTables(db))) };
}

describe('normalizePlan', () => {
  it('sorts each collection by key and keeps content', () => {
    const p = plan0();
    expect(p.accounts.map((a) => a.id)).toEqual(['a-cc', 'a-chk', 'a-home', 'a-old']);
    expect(p.assignments.map((a) => `${a.month}|${a.categoryId}`)).toEqual(['2026-09|c-rent', '2026-10|c-food']);
    expect(normalizePlan(p)).toEqual(p);
  });
});

describe('applyChanges', () => {
  it('inserts in key order, replaces in place, and inverts both', () => {
    const p = plan0();
    const edited = { ...tx('t-pay'), amount: minor(399999), categoryId: 'ready-to-assign' };
    const { applied, disk } = both(p, { put: { transactions: [tx('t-aaa'), edited, tx('t-zzz')] } });
    const ids = applied.plan.transactions.map((t) => t.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain('t-aaa');
    expect(findRecord(applied.plan, 'transactions', 't-pay')).toEqual(edited);
    expect(applied.inverse.remove?.transactions).toEqual(['t-aaa', 't-zzz']);
    expect(applied.inverse.put?.transactions?.map((t) => t.id)).toEqual(['t-pay']);
    expect(disk).toEqual(applied.plan);
    expect(applyChanges(applied.plan, applied.inverse).plan).toEqual(p);
  });

  it('removes (hard) and restores on inverse, including split lines', () => {
    const p = plan0();
    const { applied, disk } = both(p, { remove: { transactions: ['t-split'] } });
    expect(findRecord(applied.plan, 'transactions', 't-split')).toBeUndefined();
    expect(disk).toEqual(applied.plan);
    const back = both(applied.plan, applied.inverse);
    expect(back.applied.plan).toEqual(p);
  });

  it('a split that loses a line deletes that line row; growing adds one; inverses restore', () => {
    const p = plan0();
    const split = findRecord(p, 'transactions', 't-split');
    if (!split?.subtransactions) throw new Error('fixture');
    const [first] = split.subtransactions;
    if (!first) throw new Error('fixture');
    const shrunk: TransactionRecord = { ...split, amount: first.amount, subtransactions: [first] };
    const s1 = both(p, { put: { transactions: [shrunk] } });
    expect(s1.applied.rows.deletes).toEqual([{ table: 'subtransactions', keys: [{ id: 'st2' }] }]);
    expect(s1.disk).toEqual(s1.applied.plan);

    const grown: TransactionRecord = {
      ...split,
      amount: minor(split.amount - 100),
      subtransactions: [...split.subtransactions, { id: 'st3', amount: minor(-100), categoryId: 'c-rent' }],
    };
    const s2 = both(p, { put: { transactions: [grown] } });
    expect(s2.disk).toEqual(s2.applied.plan);
    const undo = both(s2.applied.plan, s2.applied.inverse);
    expect(undo.applied.plan).toEqual(p);
    expect(undo.disk).toEqual(p);
  });

  it('drops writes equal to the current record', () => {
    const p = plan0();
    const same = findRecord(p, 'payees', 'p-store');
    if (!same) throw new Error('fixture');
    const applied = applyChanges(p, { put: { payees: [{ ...same }] } });
    expect(applied.rows).toEqual({ upserts: [], deletes: [] });
    expect(applied.inverse).toEqual({});
    expect(applied.plan).toBe(p);
  });

  it('rejects removing a missing key and touching a key twice', () => {
    const p = plan0();
    expect(() => applyChanges(p, { remove: { payees: ['nope'] } })).toThrow(/does not exist/);
    expect(() => applyChanges(p, { put: { transactions: [tx('x'), tx('x')] } })).toThrow(/twice/);
    expect(() => applyChanges(p, { put: { transactions: [tx('t-pay')] }, remove: { transactions: ['t-pay'] } })).toThrow(/both/);
  });

  it('settings changes write the plan row and invert', () => {
    const p = plan0();
    const { applied, disk } = both(p, { settings: { ...p.settings, name: 'Renamed' } });
    expect(applied.plan.settings.name).toBe('Renamed');
    expect(disk).toEqual(applied.plan);
    expect(applyChanges(applied.plan, applied.inverse).plan).toEqual(p);
  });

  it('composite keys: assignments', () => {
    const p = plan0();
    const { applied, disk } = both(p, {
      put: { assignments: [{ month: '2026-10', categoryId: 'c-rent', assigned: minor(5) }] },
      remove: { assignments: ['2026-09|c-rent'] },
    });
    expect(disk).toEqual(applied.plan);
    expect(applyChanges(applied.plan, applied.inverse).plan).toEqual(p);
  });
});

describe('mergeChangeSets', () => {
  it('later writes win and a later removal cancels an earlier write', () => {
    const merged = mergeChangeSets(
      { put: { transactions: [tx('a'), tx('b')] } },
      { put: { transactions: [tx('a', { memo: 'x' })] }, remove: { transactions: ['b'] } },
    );
    expect(merged.put?.transactions).toEqual([tx('a', { memo: 'x' })]);
    expect(merged.remove?.transactions).toEqual(['b']);
  });
});

describe('deepEqual', () => {
  it('distinguishes a missing field from an undefined one only by presence', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
});
