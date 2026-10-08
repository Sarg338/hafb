// Payee defaults (CLAUDE.md §5.13) and rename rules (§4 PayeeRenameRule).
// Worked examples: docs/budget-math.md §8.4.
import { compareDates } from '@hafb/shared';
import { ValidationError } from './errors.ts';
import type { CategoryRef, Id, Transaction } from './model.ts';

export interface Payee {
  id: Id;
  name: string;
  /** Category offered when this payee is entered. */
  defaultCategoryId?: CategoryRef;
  /** Pinned by the user: history never changes it. */
  defaultCategoryFixed?: boolean;
  /** False = never suggest a category for this payee. Defaults to true. */
  autoCategorize?: boolean;
  transferAccountId?: Id;
  deleted?: boolean;
}

export type RenameMatch = 'contains' | 'startsWith' | 'equals';

export interface PayeeRenameRule {
  id: Id;
  match: RenameMatch;
  /** Compared case-insensitively; spaces are significant. */
  pattern: string;
  targetPayeeId: Id;
}

/** How many recent transactions the default-category vote looks at, and how many must agree. */
const VOTE_WINDOW = 3;
const VOTES_NEEDED = 2;

/**
 * The payee's default category after `history` (§5.13). It changes only when 2 of the payee's 3
 * most recent categorized transactions agree. A payee with no default takes its most recent
 * category. A pinned default never changes.
 *
 * Counted: live, non-split, non-transfer transactions of this payee with a category (Ready to
 * Assign counts). Same-day ties keep input order (later in `history` = more recent).
 */
export function nextDefaultCategory(payee: Payee, history: readonly Transaction[]): CategoryRef {
  const current = payee.defaultCategoryId ?? null;
  if (payee.defaultCategoryFixed) return current;
  const recent = history
    .map((t, i) => ({ t, i }))
    .filter(
      ({ t }) =>
        t.payeeId === payee.id &&
        !t.deleted &&
        t.categoryId !== null &&
        t.transferAccountId === undefined &&
        (t.subtransactions === undefined || t.subtransactions.length === 0),
    )
    .sort((a, b) => compareDates(b.t.date, a.t.date) || b.i - a.i)
    .slice(0, VOTE_WINDOW)
    .map(({ t }) => t.categoryId);
  if (recent.length === 0) return current;
  if (current === null) return recent[0] ?? null;
  const votes = new Map<CategoryRef, number>();
  for (const c of recent) votes.set(c, (votes.get(c) ?? 0) + 1);
  for (const c of recent) if ((votes.get(c) ?? 0) >= VOTES_NEEDED) return c;
  return current;
}

/** The category to pre-fill when entering a transaction for `payee`, if any. */
export function suggestCategory(payee: Payee): CategoryRef {
  if (payee.autoCategorize === false) return null;
  return payee.defaultCategoryId ?? null;
}

export function renameRuleMatches(rule: PayeeRenameRule, name: string): boolean {
  if (rule.pattern === '') throw new ValidationError(`Rename rule ${rule.id} has an empty pattern`);
  const n = name.toLowerCase();
  const p = rule.pattern.toLowerCase();
  if (rule.match === 'equals') return n === p;
  if (rule.match === 'startsWith') return n.startsWith(p);
  return n.includes(p);
}

/** The first rule (in list order) that matches an imported payee name, or null. */
export function applyRenameRules(name: string, rules: readonly PayeeRenameRule[]): PayeeRenameRule | null {
  for (const rule of rules) if (renameRuleMatches(rule, name)) return rule;
  return null;
}

export interface RenameProposal {
  match: RenameMatch;
  pattern: string;
  renameTo: string;
}

/** Minimum letters a "starts with" prefix needs, so short codes like "ACH" or "SQ" aren't proposed. */
const MIN_PREFIX_LETTERS = 4;

/**
 * After the user renames an imported payee, propose a rule for future imports (CLAUDE.md §6, Payees:
 * "Rename all future 'AMZN*' to 'Amazon'?"). Heuristic, not YNAB's documented logic: if the name
 * carries a store/reference code (first digit or '#'), propose "starts with" the text before it;
 * otherwise propose an exact match. Returns null when only the case changed.
 */
export function proposeRenameRule(original: string, renamedTo: string): RenameProposal | null {
  if (original.toLowerCase() === renamedTo.toLowerCase()) return null;
  const cut = original.search(/[\d#]/);
  if (cut > 0) {
    const prefix = original.slice(0, cut).replace(/[^A-Za-z0-9]+$/, '');
    const letters = prefix.replace(/[^A-Za-z]/g, '').length;
    if (letters >= MIN_PREFIX_LETTERS) return { match: 'startsWith', pattern: prefix, renameTo: renamedTo };
  }
  return { match: 'equals', pattern: original, renameTo: renamedTo };
}
