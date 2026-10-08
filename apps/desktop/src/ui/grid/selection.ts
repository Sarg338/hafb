// Row selection, Explorer-style: click selects one, Ctrl toggles, Shift selects a range from the
// anchor in visible order (group header rows are not in `order`). Pure.

export interface SelectionState {
  selected: ReadonlySet<string>;
  /** Where Shift ranges start: the last row clicked or toggled. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

export function selectOnly(_state: SelectionState, id: string): SelectionState {
  return { selected: new Set([id]), anchor: id };
}

export function toggle(state: SelectionState, id: string): SelectionState {
  const next = new Set(state.selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { selected: next, anchor: id };
}

/** Select from the anchor to `id`. `additive` (Ctrl+Shift) keeps the existing selection. */
export function extend(state: SelectionState, order: readonly string[], id: string, additive = false): SelectionState {
  const to = order.indexOf(id);
  const from = state.anchor === null ? -1 : order.indexOf(state.anchor);
  if (to < 0) return state;
  if (from < 0) return { selected: new Set([id]), anchor: id };
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const next = new Set(additive ? state.selected : []);
  for (let i = lo; i <= hi; i += 1) {
    const rowId = order[i];
    if (rowId !== undefined) next.add(rowId);
  }
  return { selected: next, anchor: state.anchor };
}

export function selectAll(order: readonly string[]): SelectionState {
  return { selected: new Set(order), anchor: order[0] ?? null };
}

export function clear(): SelectionState {
  return EMPTY_SELECTION;
}

export function applyClick(state: SelectionState, order: readonly string[], id: string, mods: { shift: boolean; ctrl: boolean }): SelectionState {
  if (mods.shift) return extend(state, order, id, mods.ctrl);
  if (mods.ctrl) return toggle(state, id);
  return selectOnly(state, id);
}

export type HeaderCheckState = 'none' | 'some' | 'all';

export function headerState(selected: ReadonlySet<string>, order: readonly string[]): HeaderCheckState {
  let count = 0;
  for (const id of order) if (selected.has(id)) count += 1;
  if (count === 0) return 'none';
  return count === order.length ? 'all' : 'some';
}

/** The header checkbox: all selected → none; otherwise → all. */
export function toggleAll(state: SelectionState, order: readonly string[]): SelectionState {
  return headerState(state.selected, order) === 'all' ? clear() : selectAll(order);
}
