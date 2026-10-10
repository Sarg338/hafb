// Record-level change sets with computed inverses (ADR 0002 §6). Undo is "apply the inverse".
//
// Collections are kept in key order (`normalizePlan`). UUIDv7 keys sort by creation time, so key
// order is entry order, which the engine uses to break ties (CLAUDE.md §5.3). Because order is a
// function of content, applying a change and then its inverse restores the plan exactly.
import { ValidationError } from '@hafb/engine';
import { encodeRecord, encodeSettings, keyRow, PLAN_TABLE, type Row, type RowChanges } from './codec.ts';
import { ENTITY_KINDS, keyOf, type EntityKind, type PlanCollections, type PlanData, type PlanSettings, type RecordOf } from './records.ts';

export type ChangePuts = { [K in EntityKind]?: readonly RecordOf<K>[] };
export type ChangeRemoves = Partial<Record<EntityKind, readonly string[]>>;

export interface ChangeSet {
  /** Records to write, replacing any record with the same key. */
  put?: ChangePuts;
  /** Keys (see `keyOf`) to remove. A removal is a hard delete; user deletions put `deletedAt`. */
  remove?: ChangeRemoves;
  settings?: PlanSettings;
}

export interface AppliedChanges {
  plan: PlanData;
  /** Applying this to `plan` restores the original. */
  inverse: ChangeSet;
  /** What the store must write, in one SQLite transaction. */
  rows: RowChanges;
}

/** Structural equality for JSON-like records. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra: Partial<Record<string, unknown>> = { ...a };
  const rb: Partial<Record<string, unknown>> = { ...b };
  return ka.every((k) => Object.hasOwn(rb, k) && deepEqual(ra[k], rb[k]));
}

const byKey = (x: { key: string }, y: { key: string }): number => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);

function sortedByKey<K extends EntityKind>(kind: K, records: readonly RecordOf<K>[]): RecordOf<K>[] {
  return records
    .map((record) => ({ key: keyOf(kind, record), record }))
    .sort(byKey)
    .map((x) => x.record);
}

/** Put every collection in key order. Call once after decoding a file or building a plan by hand. */
export function normalizePlan(plan: PlanData): PlanData {
  return { ...plan, ...pickCollections((kind) => sortCollection(kind, plan)) };
}

function sortCollection<K extends EntityKind>(kind: K, plan: PlanCollections): readonly RecordOf<K>[] {
  const list: readonly RecordOf<K>[] = plan[kind];
  return sortedByKey(kind, list);
}

/** Build a full PlanCollections by mapping each kind (keeps the per-kind typing without casts). */
function pickCollections(f: <K extends EntityKind>(kind: K) => readonly RecordOf<K>[]): PlanCollections {
  return {
    accounts: f('accounts'),
    categoryGroups: f('categoryGroups'),
    categories: f('categories'),
    targets: f('targets'),
    payees: f('payees'),
    payeeRenameRules: f('payeeRenameRules'),
    scheduled: f('scheduled'),
    transactions: f('transactions'),
    assignments: f('assignments'),
    monthNotes: f('monthNotes'),
    moneyMoves: f('moneyMoves'),
    focusedViews: f('focusedViews'),
    flagNames: f('flagNames'),
    reconciliations: f('reconciliations'),
    rejectedImports: f('rejectedImports'),
    importProfiles: f('importProfiles'),
  };
}

const indexCache = new WeakMap<readonly unknown[], Map<string, number>>();

/** Key → position in `list`, built once per array (collections are never mutated). */
export function recordIndex<K extends EntityKind>(kind: K, list: readonly RecordOf<K>[]): ReadonlyMap<string, number> {
  let index = indexCache.get(list);
  if (!index) {
    index = new Map();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r !== undefined) index.set(keyOf(kind, r), i);
    }
    indexCache.set(list, index);
  }
  return index;
}

/** The current record with `key`, if any. */
export function findRecord<K extends EntityKind>(plan: PlanCollections, kind: K, key: string): RecordOf<K> | undefined {
  const list: readonly RecordOf<K>[] = plan[kind];
  const i = recordIndex(kind, list).get(key);
  return i === undefined ? undefined : list[i];
}

interface KindResult<K extends EntityKind> {
  next: readonly RecordOf<K>[];
  inversePut: RecordOf<K>[];
  inverseRemove: string[];
  upserts: Map<string, Row[]>;
  deletes: Map<string, Row[]>;
}

function pushRows(map: Map<string, Row[]>, table: string, rows: readonly Row[]): void {
  if (rows.length === 0) return;
  const list = map.get(table) ?? [];
  list.push(...rows);
  map.set(table, list);
}

function applyKind<K extends EntityKind>(
  kind: K,
  current: readonly RecordOf<K>[],
  puts: readonly RecordOf<K>[],
  removes: readonly string[],
): KindResult<K> {
  const index = recordIndex(kind, current);
  const replaced = new Map<number, RecordOf<K>>();
  const removed = new Set<number>();
  const inserted: { key: string; record: RecordOf<K> }[] = [];
  const seen = new Set<string>();
  const result: KindResult<K> = { next: current, inversePut: [], inverseRemove: [], upserts: new Map(), deletes: new Map() };

  for (const record of puts) {
    const key = keyOf(kind, record);
    if (seen.has(key)) throw new ValidationError(`Change set writes ${kind} ${key} twice`);
    seen.add(key);
    const i = index.get(key);
    const prior = i === undefined ? undefined : current[i];
    if (prior !== undefined && deepEqual(prior, record)) continue;
    const encoded = encodeRecord(kind, record);
    pushRows(result.upserts, encoded.table, [encoded.row]);
    if (encoded.children) {
      pushRows(result.upserts, encoded.children.table, encoded.children.rows);
      if (prior !== undefined) {
        const keep = new Set(encoded.children.rows.map((r) => r.id));
        const before = encodeRecord(kind, prior).children?.rows ?? [];
        const table = encoded.children.table;
        pushRows(
          result.deletes,
          table,
          before.filter((r) => !keep.has(r.id)).map((r) => keyRow(table, r)),
        );
      }
    }
    if (i === undefined || prior === undefined) {
      inserted.push({ key, record });
      result.inverseRemove.push(key);
    } else {
      replaced.set(i, record);
      result.inversePut.push(prior);
    }
  }

  for (const key of removes) {
    if (seen.has(key)) throw new ValidationError(`Change set both writes and removes ${kind} ${key}`);
    seen.add(key);
    const i = index.get(key);
    const prior = i === undefined ? undefined : current[i];
    if (i === undefined || prior === undefined) throw new ValidationError(`Cannot remove ${kind} ${key}: it does not exist`);
    removed.add(i);
    result.inversePut.push(prior);
    const encoded = encodeRecord(kind, prior);
    pushRows(result.deletes, encoded.table, [keyRow(encoded.table, encoded.row)]);
  }

  if (replaced.size === 0 && removed.size === 0 && inserted.length === 0) return result;

  // Merge: existing records (minus removals, with replacements) and the new ones, in key order.
  inserted.sort(byKey);
  const next: RecordOf<K>[] = [];
  let j = 0;
  for (let i = 0; i < current.length; i++) {
    if (removed.has(i)) continue;
    const record = replaced.get(i) ?? current[i];
    if (record === undefined) continue;
    const key = keyOf(kind, record);
    for (let ins = inserted[j]; ins !== undefined && ins.key < key; ins = inserted[j]) {
      next.push(ins.record);
      j++;
    }
    next.push(record);
  }
  for (; j < inserted.length; j++) {
    const ins = inserted[j];
    if (ins) next.push(ins.record);
  }
  result.next = next;
  return result;
}

function isEmptyChangeSet(c: ChangeSet): boolean {
  if (c.settings !== undefined) return false;
  for (const kind of ENTITY_KINDS) {
    if ((c.put?.[kind]?.length ?? 0) > 0 || (c.remove?.[kind]?.length ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Apply `changes` to `plan`. Returns the new plan, the inverse change set and the row changes.
 * Writes equal to the current record are dropped (from rows and the inverse). Removing a missing
 * key, or touching one key twice, is a ValidationError and nothing is applied.
 */
export function applyChanges(plan: PlanData, changes: ChangeSet): AppliedChanges {
  const upserts = new Map<string, Row[]>();
  const deletes = new Map<string, Row[]>();
  const inversePut: Record<string, unknown[]> = {};
  const inverseRemove: Record<string, string[]> = {};
  let settings = plan.settings;
  let inverseSettings: PlanSettings | undefined;
  if (changes.settings !== undefined && !deepEqual(changes.settings, plan.settings)) {
    inverseSettings = plan.settings;
    settings = changes.settings;
    pushRows(upserts, PLAN_TABLE, [encodeSettings(settings)]);
  }

  const results = new Map<EntityKind, unknown>();
  const run = <K extends EntityKind>(kind: K): readonly RecordOf<K>[] => {
    const puts: readonly RecordOf<K>[] = changes.put?.[kind] ?? [];
    const removes = changes.remove?.[kind] ?? [];
    const current: readonly RecordOf<K>[] = plan[kind];
    if (puts.length === 0 && removes.length === 0) return current;
    const r = applyKind(kind, current, puts, removes);
    for (const [t, rows] of r.upserts) pushRows(upserts, t, rows);
    for (const [t, rows] of r.deletes) pushRows(deletes, t, rows);
    if (r.inversePut.length > 0) inversePut[kind] = r.inversePut;
    if (r.inverseRemove.length > 0) inverseRemove[kind] = r.inverseRemove;
    if (r.next !== current) results.set(kind, true);
    return r.next;
  };
  const collections = pickCollections(run);

  const inverse: ChangeSet = {};
  const put = buildPuts(inversePut);
  const remove = buildRemoves(inverseRemove);
  if (put) inverse.put = put;
  if (remove) inverse.remove = remove;
  if (inverseSettings !== undefined) inverse.settings = inverseSettings;

  return {
    plan: results.size === 0 && inverseSettings === undefined ? plan : { settings, ...collections },
    inverse,
    rows: {
      upserts: [...upserts].map(([table, rows]) => ({ table, rows })),
      deletes: [...deletes].map(([table, keys]) => ({ table, keys })),
    },
  };
}

// The inverse maps were filled per kind with that kind's records; rebuild them with their types.
function buildPuts(map: Record<string, unknown[]>): ChangePuts | undefined {
  const out: Record<string, unknown[]> = {};
  let any = false;
  for (const kind of ENTITY_KINDS) {
    const list = map[kind];
    if (list && list.length > 0) {
      out[kind] = list;
      any = true;
    }
  }
  return any ? asPuts(out) : undefined;
}

function buildRemoves(map: Record<string, string[]>): ChangeRemoves | undefined {
  const out: ChangeRemoves = {};
  let any = false;
  for (const kind of ENTITY_KINDS) {
    const list = map[kind];
    if (list && list.length > 0) {
      out[kind] = list;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Records in `map[kind]` came from `plan[kind]` in applyKind, so the per-kind typing holds. */
function asPuts(map: Record<string, unknown[]>): ChangePuts {
  return map;
}

/** True when `changes` would change nothing in `plan`. */
export function isNoop(plan: PlanData, changes: ChangeSet): boolean {
  if (isEmptyChangeSet(changes)) return true;
  const { rows } = applyChanges(plan, changes);
  return rows.upserts.length === 0 && rows.deletes.length === 0;
}

/** Merge change sets in order (later writes of the same key win). For composing commands. */
export function mergeChangeSets(...sets: readonly ChangeSet[]): ChangeSet {
  const puts = new Map<EntityKind, Map<string, unknown>>();
  const removes = new Map<EntityKind, Set<string>>();
  let settings: PlanSettings | undefined;
  for (const set of sets) {
    if (set.settings !== undefined) settings = set.settings;
    for (const kind of ENTITY_KINDS) {
      const p = puts.get(kind) ?? new Map<string, unknown>();
      const r = removes.get(kind) ?? new Set<string>();
      for (const record of putsOf(set, kind)) {
        const key = keyOf(kind, record);
        r.delete(key);
        p.set(key, record);
      }
      for (const key of set.remove?.[kind] ?? []) {
        p.delete(key);
        r.add(key);
      }
      puts.set(kind, p);
      removes.set(kind, r);
    }
  }
  const out: Record<string, unknown[]> = {};
  const rem: Record<string, string[]> = {};
  for (const kind of ENTITY_KINDS) {
    const p = puts.get(kind);
    if (p && p.size > 0) out[kind] = [...p.values()];
    const r = removes.get(kind);
    if (r && r.size > 0) rem[kind] = [...r];
  }
  const result: ChangeSet = {};
  const put = buildPuts(out);
  const remove = buildRemoves(rem);
  if (put) result.put = put;
  if (remove) result.remove = remove;
  if (settings !== undefined) result.settings = settings;
  return result;
}

function putsOf<K extends EntityKind>(set: ChangeSet, kind: K): readonly RecordOf<K>[] {
  const puts: ChangePuts = set.put ?? {};
  const list: readonly RecordOf<K>[] | undefined = puts[kind];
  return list ?? [];
}
