// Pure keyboard model for menus (WAI-ARIA APG menu button): arrow/Home/End movement that skips
// separators and disabled items, and typeahead.

export interface MenuModelItem {
  label: string;
  disabled?: boolean;
  separator?: boolean;
}

const enabled = (item: MenuModelItem | undefined): boolean => item !== undefined && item.separator !== true && item.disabled !== true;

/** The index focus moves to for `key`; -1 when no item can take focus. */
export function nextIndex(items: readonly MenuModelItem[], current: number, key: string): number {
  const usable = items.map((item, i) => (enabled(item) ? i : -1)).filter((i) => i >= 0);
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (first === undefined || last === undefined) return -1;
  switch (key) {
    case 'Home':
      return first;
    case 'End':
      return last;
    case 'ArrowDown': {
      if (current < 0) return first;
      return usable.find((i) => i > current) ?? first;
    }
    case 'ArrowUp': {
      if (current < 0) return last;
      return [...usable].reverse().find((i) => i < current) ?? last;
    }
    default:
      return current;
  }
}

/**
 * Typeahead: the next enabled item whose label starts with `buffer`. A buffer of one repeated
 * letter ("aa") cycles through items starting with that letter.
 */
export function typeahead(items: readonly MenuModelItem[], buffer: string, current: number): number {
  const query = buffer.toLowerCase();
  if (query === '') return current;
  const repeated = query.length > 1 && query.replaceAll(query.charAt(0), '') === '';
  const needle = repeated ? (query[0] ?? '') : query;
  // A single letter or a repeat moves past the current item; a longer word may stay on it.
  const startOffset = repeated || query.length === 1 ? 1 : 0;
  const n = items.length;
  for (let step = 0; step < n; step += 1) {
    const i = (Math.max(current, 0) + startOffset + step) % n;
    const item = items[i];
    if (enabled(item) && item?.label.toLowerCase().startsWith(needle)) return i;
  }
  return current;
}
