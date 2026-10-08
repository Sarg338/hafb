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

  const out: VisibleRow<T>[] = [];
  groups.forEach((group, gi) => {
    const kids = children.get(group.id) ?? [];
    const expanded = !collapsed.has(group.id);
    out.push({ row: group, index: out.length, level: 1, expanded, childCount: kids.length, posInSet: gi + 1, setSize: groups.length });
    if (!expanded) return;
    kids.forEach((row, ki) => {
      out.push({ row, index: out.length, level: 2, posInSet: ki + 1, setSize: kids.length });
    });
  });
  return out;
}
