// Pure model for the grouped, searchable combobox (payee and category pickers): filtering with
// ranking and match ranges, flattening for keyboard navigation, and the "create new" option.

export interface ComboOption {
  id: string;
  label: string;
  /** Group label, filled in by `flatten` for the active-option announcement. */
  group?: string;
  /** Right-side text, e.g. a category's Available amount. */
  meta?: string;
  /** Extra search terms that don't show. */
  keywords?: readonly string[];
  disabled?: boolean;
}

export interface ComboGroup {
  id: string;
  label: string;
  options: readonly ComboOption[];
}

export interface MatchedOption extends ComboOption {
  /** [start, end) of the match in `label` (null when only a keyword matched or no query). */
  match: [number, number] | null;
}

export interface MatchedGroup {
  id: string;
  label: string;
  options: MatchedOption[];
}

/** Lower-case and strip diacritics. Keeps string length for single-code-point letters. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** 0 = starts with, 1 = a word starts with, 2 = contains, null = no match. */
function rank(haystack: string, needle: string): { rank: number; at: number } | null {
  const at = haystack.indexOf(needle);
  if (at < 0) return null;
  if (at === 0) return { rank: 0, at };
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').exec(haystack);
  if (word) return { rank: 1, at: word.index + (word[1]?.length ?? 0) };
  return { rank: 2, at };
}

/**
 * Options matching `query`, best first within each group; group order kept, empty groups dropped.
 * Label matches outrank keyword-only matches of the same kind.
 */
export function filterGroups(groups: readonly ComboGroup[], query: string): MatchedGroup[] {
  const q = normalize(query.trim());
  const out: MatchedGroup[] = [];
  for (const g of groups) {
    const scored: { option: MatchedOption; score: number; order: number }[] = [];
    g.options.forEach((option, order) => {
      if (q === '') {
        scored.push({ option: { ...option, match: null }, score: 0, order });
        return;
      }
      const label = normalize(option.label);
      const hit = rank(label, q);
      if (hit) {
        // normalize() keeps positions for precomposed letters, so ranges map onto the label.
        scored.push({ option: { ...option, match: [hit.at, hit.at + q.length] }, score: hit.rank, order });
        return;
      }
      const kw = (option.keywords ?? []).map((k) => rank(normalize(k), q)).filter((r) => r !== null);
      const best = kw.reduce<number | null>((m, r) => (m === null || r.rank < m ? r.rank : m), null);
      if (best !== null) scored.push({ option: { ...option, match: null }, score: best + 0.5, order });
    });
    if (scored.length === 0) continue;
    scored.sort((a, b) => a.score - b.score || a.order - b.order);
    out.push({ id: g.id, label: g.label, options: scored.map((s) => s.option) });
  }
  return out;
}

/** All options in display order, tagged with their group label. */
export function flatten(groups: readonly MatchedGroup[]): MatchedOption[] {
  return groups.flatMap((g) => g.options.map((o) => ({ ...o, group: g.label })));
}

export type MoveKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';

/** The next active option id for a navigation key. Skips disabled options; never wraps. */
export function move(list: readonly ComboOption[], activeId: string | null, key: MoveKey, page = 10): string | null {
  const enabled = list.map((o, i) => (o.disabled === true ? -1 : i)).filter((i) => i >= 0);
  const first = enabled[0];
  const last = enabled[enabled.length - 1];
  if (first === undefined || last === undefined) return null;
  const idOf = (i: number): string | null => list[i]?.id ?? null;
  const current = list.findIndex((o) => o.id === activeId);
  if (current < 0) return idOf(key === 'ArrowUp' || key === 'End' ? last : first);
  const pos = enabled.indexOf(current);
  // A disabled active option (shouldn't happen) behaves like the nearest enabled one before it.
  const at = pos >= 0 ? pos : Math.max(0, enabled.findIndex((i) => i > current) - 1);
  const step: Record<MoveKey, number> = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity, PageDown: page, PageUp: -page };
  const target = Math.max(0, Math.min(enabled.length - 1, at + step[key]));
  return idOf(enabled[target] ?? first);
}

export const CREATE_ID = '__create__';

export interface CreateOption extends ComboOption {
  createLabel: string;
}

/** A "Create payee “X”" option when `query` names nothing that exists. */
export function createOption(query: string, existing: readonly ComboOption[], noun: string): CreateOption | null {
  const label = query.trim();
  if (label === '') return null;
  const n = normalize(label);
  if (existing.some((o) => normalize(o.label) === n)) return null;
  return { id: CREATE_ID, label: `Create ${noun} “${label}”`, createLabel: label };
}
