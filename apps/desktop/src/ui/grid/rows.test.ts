import { describe, expect, it } from 'vitest';
import { flattenRows } from './rows.ts';
import type { GridRow } from './types.ts';

const g = (id: string): GridRow<string> => ({ kind: 'group', id, data: id });
const i = (id: string, groupId?: string): GridRow<string> => ({ kind: 'item', id, data: id, ...(groupId ? { groupId } : {}) });

const grouped = [g('A'), i('a1', 'A'), i('a2', 'A'), g('B'), i('b1', 'B'), g('C')];

describe('flattenRows', () => {
  it('ungrouped rows are level 1 with no tree data', () => {
    const v = flattenRows([i('x'), i('y')], new Set());
    expect(v.map((r) => [r.row.id, r.level, r.expanded])).toEqual([
      ['x', 1, undefined],
      ['y', 1, undefined],
    ]);
  });

  it('groups are level 1, items level 2, with set positions', () => {
    const v = flattenRows(grouped, new Set());
    expect(v.map((r) => r.row.id)).toEqual(['A', 'a1', 'a2', 'B', 'b1', 'C']);
    expect(v.find((r) => r.row.id === 'A')).toMatchObject({ level: 1, expanded: true, posInSet: 1, setSize: 3, childCount: 2 });
    expect(v.find((r) => r.row.id === 'a2')).toMatchObject({ level: 2, posInSet: 2, setSize: 2 });
    expect(v.find((r) => r.row.id === 'C')).toMatchObject({ childCount: 0 });
  });

  it('collapsed groups hide their items but keep their own row', () => {
    const v = flattenRows(grouped, new Set(['A']));
    expect(v.map((r) => r.row.id)).toEqual(['A', 'B', 'b1', 'C']);
    expect(v[0]).toMatchObject({ expanded: false, childCount: 2 });
  });

  it('visible indexes are sequential (aria-rowindex source)', () => {
    expect(flattenRows(grouped, new Set(['B'])).map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps ungrouped rows in order beside groups (a section header followed by plain rows)', () => {
    const rows = [
      { kind: 'group' as const, id: 's', data: 0 },
      { kind: 'item' as const, id: 's1', groupId: 's', data: 0 },
      { kind: 'item' as const, id: 'a', data: 0 },
      { kind: 'item' as const, id: 'b', data: 0 },
    ];
    expect(flattenRows(rows, new Set()).map((v) => [v.row.id, v.level])).toEqual([
      ['s', 1],
      ['s1', 2],
      ['a', 1],
      ['b', 1],
    ]);
    expect(flattenRows(rows, new Set(['s'])).map((v) => v.row.id)).toEqual(['s', 'a', 'b']);
  });
});
