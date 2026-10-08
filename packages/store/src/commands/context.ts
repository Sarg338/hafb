// Shared plumbing for command builders: the context, the result shape, and a Draft that collects
// record writes over the current plan so a command can read its own earlier writes.
import { ValidationError, type Id } from '@hafb/engine';
import type { ISODate } from '@hafb/shared';
import { findRecord, type ChangePuts, type ChangeRemoves, type ChangeSet } from '../changes.ts';
import { ENTITY_KINDS, keyOf, type AccountRecord, type CategoryRecord, type EntityKind, type PlanData, type RecordOf, type Timestamp } from '../records.ts';

export interface CommandContext {
  /** Wall-clock timestamp for createdAt/updatedAt/deletedAt and money moves. */
  now: Timestamp;
  /** The plan's today (default dates, target start month). */
  today: ISODate;
  /** A fresh UUIDv7 per call, in creation order (see uuidv7Generator). */
  newId: () => Id;
}

/** A command's output: one undo step. The label names the action for the undo toast. */
export interface Command {
  label: string;
  changes: ChangeSet;
}

type PutMaps = { [K in EntityKind]: Map<string, RecordOf<K>> };

function emptyPutMaps(): PutMaps {
  return {
    accounts: new Map(),
    categoryGroups: new Map(),
    categories: new Map(),
    targets: new Map(),
    payees: new Map(),
    payeeRenameRules: new Map(),
    scheduled: new Map(),
    transactions: new Map(),
    assignments: new Map(),
    monthNotes: new Map(),
    moneyMoves: new Map(),
    focusedViews: new Map(),
    flagNames: new Map(),
    reconciliations: new Map(),
    rejectedImports: new Map(),
    importProfiles: new Map(),
  };
}

export class Draft {
  private readonly puts: PutMaps = emptyPutMaps();
  private readonly removes = new Map<EntityKind, Set<string>>();

  constructor(readonly plan: PlanData) {}

  get<K extends EntityKind>(kind: K, key: string): RecordOf<K> | undefined {
    const map: PutMaps[K] = this.puts[kind];
    const put = map.get(key);
    if (put !== undefined) return put;
    if (this.removes.get(kind)?.has(key)) return undefined;
    return findRecord(this.plan, kind, key);
  }

  put<K extends EntityKind>(kind: K, record: RecordOf<K>): void {
    const key = keyOf(kind, record);
    this.removes.get(kind)?.delete(key);
    const map: PutMaps[K] = this.puts[kind];
    map.set(key, record);
  }

  /** Hard-remove a record (or cancel a record this draft created). */
  remove(kind: EntityKind, key: string): void {
    const map = this.puts[kind];
    const existed = findRecord(this.plan, kind, key) !== undefined;
    map.delete(key);
    if (existed) {
      const set = this.removes.get(kind) ?? new Set<string>();
      set.add(key);
      this.removes.set(kind, set);
    }
  }

  /** Every record of a kind as the draft sees it (plan order, then new records). */
  all<K extends EntityKind>(kind: K): RecordOf<K>[] {
    const map: PutMaps[K] = this.puts[kind];
    const removed = this.removes.get(kind);
    const out: RecordOf<K>[] = [];
    const seen = new Set<string>();
    const list: readonly RecordOf<K>[] = this.plan[kind];
    for (const r of list) {
      const key = keyOf(kind, r);
      seen.add(key);
      if (removed?.has(key)) continue;
      out.push(map.get(key) ?? r);
    }
    for (const [key, r] of map) if (!seen.has(key)) out.push(r);
    return out;
  }

  build(): ChangeSet {
    const put: ChangePuts = {};
    const remove: ChangeRemoves = {};
    const any = { put: false, remove: false };
    const fill = <K extends EntityKind>(kind: K, map: PutMaps[K]): void => {
      if (map.size > 0) {
        const list: RecordOf<K>[] = [...map.values()];
        const target: { [P in K]?: readonly RecordOf<P>[] } = put;
        target[kind] = list;
        any.put = true;
      }
      const removed = this.removes.get(kind);
      if (removed && removed.size > 0) {
        remove[kind] = [...removed];
        any.remove = true;
      }
    };
    for (const kind of ENTITY_KINDS) fill(kind, this.puts[kind]);
    return { ...(any.put ? { put } : {}), ...(any.remove ? { remove } : {}) };
  }
}

// ---- lookups -----------------------------------------------------------------------------------

export function liveAccount(d: Draft, id: Id): AccountRecord {
  const a = d.get('accounts', id);
  if (!a || a.deletedAt !== undefined) throw new ValidationError(`Unknown account ${id}`);
  return a;
}

export function liveCategory(d: Draft, id: Id): CategoryRecord {
  const c = d.get('categories', id);
  if (!c || c.deletedAt !== undefined) throw new ValidationError(`Unknown category ${id}`);
  return c;
}

export function nextSortOrder(records: readonly { sortOrder: number; deletedAt?: string }[]): number {
  let max = -1;
  for (const r of records) if (r.deletedAt === undefined && r.sortOrder > max) max = r.sortOrder;
  return max + 1;
}

export function requireName(name: string, what: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new ValidationError(`${what} name can't be empty`);
  return trimmed;
}

/** A copy of `record` without `fields` (canonical form omits unset fields). */
export function omit<T extends object, F extends keyof T>(record: T, ...fields: readonly F[]): Omit<T, F> {
  const copy = { ...record };
  for (const f of fields) Reflect.deleteProperty(copy, f);
  return copy;
}
