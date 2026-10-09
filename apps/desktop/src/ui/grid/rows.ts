// Visible rows: group rows with their items, minus collapsed groups' items. Pure.
import type { GridRow } from './types.ts';

export interface VisibleRow<T> {
  row: GridRow<T>;
  /** 0-based position among visible rows. */
  index: number;
  /** Tree level for treegrid semantics: groups 1, their items 2; ungrouped rows 1. */
  level: 1 | 2;
  /** Group rows only. */
  expanded?: boolean;
  childCount?: number;
  /** Position within siblings (aria-posinset / aria-setsize). */
  posInSet?: number;
  setSize?: number;
}

export function flattenRows<T>(rows: readonly GridRow<T>[], collapsed: ReadonlySet<string>): VisibleRow<T>[] {
  const hasGroups = rows.some((r) => r.kind === 'group');
  if (!hasGroups) return rows.map((row, index) => ({ row, index, level: 1 }));

  const children = new Map<string, GridRow<T>[]>();
  const groups: GridRow<T>[] = [];
  for (const row of rows) {
    if (row.kind === 'group') {
      groups.push(row);
      children.set(row.id, []);
    } else if (row.groupId !== undefined) {
      children.get(row.groupId)?.push(row);
    }
  }

  // Rows keep their input order; a group's items follow it (when expanded). Items with no group
  // (the register's transactions under its Scheduled section) are top-level rows.
  const out: VisibleRow<T>[] = [];
  const ungrouped = rows.filter((r) => r.kind === 'item' && r.groupId === undefined).length;
  const setSize = groups.length + ungrouped;
  let pos = 0;
  for (const row of rows) {
    if (row.kind === 'group') {
      pos += 1;
      const kids = children.get(row.id) ?? [];
      const expanded = !collapsed.has(row.id);
      out.push({ row, index: out.length, level: 1, expanded, childCount: kids.length, posInSet: pos, setSize });
      if (!expanded) continue;
      kids.forEach((kid, ki) => {
        out.push({ row: kid, index: out.length, level: 2, posInSet: ki + 1, setSize: kids.length });
      });
    } else if (row.groupId === undefined) {
      pos += 1;
      out.push({ row, index: out.length, level: 1, posInSet: pos, setSize });
    }
  }
  return out;
}
