// Register search: YNAB's criteria syntax (roadmap D9). Parser → typed criteria → predicate.
// Source: https://support.ynab.com/en_us/searching-transactions-a-guide-r1gxyQryj
// Worked examples: docs/budget-math.md §8.3. Choices the article leaves open are marked
// "(assumption)" below.
import { asISODate, compareDates, minor, type ISODate, type Minor } from '@hafb/shared';
import { ValidationError } from './errors.ts';
import { READY_TO_ASSIGN, type Id, type Transaction } from './model.ts';
import { parseAmount, parseDate, type DateOrder } from './ynab/csv.ts';

export type FlagColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
const FLAG_COLORS: readonly FlagColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

export type CompareOp = '>' | '>=' | '<' | '<=' | '=';

export type SearchState =
  | 'cleared'
  | 'uncleared'
  | 'reconciled'
  | 'unreconciled'
  | 'approved'
  | 'unapproved'
  | 'matched'
  | 'unmatched'
  | 'split'
  | 'flagged'
  | 'unflagged'
  | 'uncategorized';
const STATES: readonly SearchState[] = [
  'cleared',
  'uncleared',
  'reconciled',
  'unreconciled',
  'approved',
  'unapproved',
  'matched',
  'unmatched',
  'split',
  'flagged',
  'unflagged',
  'uncategorized',
];

export type TextField = 'any' | 'payee' | 'category' | 'memo' | 'account';

export type SearchCriterion =
  /** Case-insensitive substring; `value` is stored lower-cased. Free text may also be an exact amount. */
  | { kind: 'text'; field: TextField; value: string; amount?: Minor }
  /** Compares the magnitude of the outflow, inflow, or either. */
  | { kind: 'amount'; field: 'outflow' | 'inflow' | 'amount'; op: CompareOp; value: Minor }
  | { kind: 'direction'; direction: 'outflow' | 'inflow' }
  /** Before/After are inclusive ("on or before" / "on or after"). */
  | { kind: 'date'; op: 'before' | 'after' | 'on'; date: ISODate }
  | { kind: 'flag'; color: FlagColor }
  | { kind: 'state'; state: SearchState };

/** All criteria must match ("additive, but not subtractive"). No exclusion, no wildcards. */
export interface SearchQuery {
  criteria: SearchCriterion[];
}

export interface SearchOptions {
  /** Currency minor-unit digits (default 2). */
  decimals?: number;
  /** The plan's date format for Before/After/On; ISO dates are always accepted (default MDY). */
  dateOrder?: DateOrder;
  /** Custom flag names (YNAB lets each color be renamed). */
  flagNames?: Partial<Record<FlagColor, string>>;
}

/** A register transaction plus the display-only fields search needs. */
export type SearchableTransaction = Transaction & { flag?: FlagColor | null; matched?: boolean };

export interface SearchContext extends SearchOptions {
  payeeName?: (id: Id) => string | undefined;
  categoryName?: (id: Id) => string | undefined;
  accountName?: (id: Id) => string | undefined;
}

const DEFAULT_DECIMALS = 2;

function amountOf(text: string, decimals: number, query: string): Minor {
  try {
    // Criteria compare magnitudes, so a stray minus sign is ignored.
    return minor(Math.abs(parseAmount(text, { decimalSeparator: '.' }, decimals)));
  } catch {
    throw new ValidationError(`Not an amount in search "${query}": "${text}"`);
  }
}

function dateOf(text: string, order: DateOrder, query: string): ISODate {
  try {
    return /^\d{4}-/.test(text) ? asISODate(text) : parseDate(text, order);
  } catch {
    throw new ValidationError(`Not a date in search "${query}": "${text}"`);
  }
}

function flagOf(text: string, options: SearchOptions, query: string): FlagColor {
  const v = text.toLowerCase();
  for (const color of FLAG_COLORS) {
    if (v === color || options.flagNames?.[color]?.toLowerCase() === v) return color;
  }
  throw new ValidationError(`Unknown flag in search "${query}": "${text}"`);
}

const KEYWORDS = new Map<string, SearchCriterion>([
  ...STATES.map((state): [string, SearchCriterion] => [state, { kind: 'state', state }]),
  ['outflow', { kind: 'direction', direction: 'outflow' }],
  ['inflow', { kind: 'direction', direction: 'inflow' }],
]);

const FREE_AMOUNT = /^\$?\d[\d,]*(\.\d+)?$/;

function parseTerm(term: string, options: SearchOptions, query: string): SearchCriterion {
  const decimals = options.decimals ?? DEFAULT_DECIMALS;
  const colon = term.indexOf(':');
  if (colon < 0) {
    const keyword = KEYWORDS.get(term.toLowerCase());
    if (keyword) return keyword;
    const criterion: SearchCriterion = { kind: 'text', field: 'any', value: term.toLowerCase() };
    if (FREE_AMOUNT.test(term)) {
      try {
        criterion.amount = parseAmount(term, { decimalSeparator: '.' }, decimals);
      } catch {
        // More decimals than the currency has: plain text only.
      }
    }
    return criterion;
  }
  const key = term.slice(0, colon).trim().toLowerCase().replace(/\s+/g, ' ');
  const value = term.slice(colon + 1).trim();
  if (value === '') throw new ValidationError(`Search criterion "${term}" has no value`);
  switch (key) {
    case 'payee':
    case 'memo':
    case 'account':
      return { kind: 'text', field: key, value: value.toLowerCase() };
    case 'category': {
      const v = value.toLowerCase();
      if (v === 'split' || v === 'uncategorized') return { kind: 'state', state: v };
      return { kind: 'text', field: 'category', value: v };
    }
    case 'outflow':
    case 'inflow':
    case 'amount': {
      const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(value);
      const op: CompareOp = m?.[1] === '>=' || m?.[1] === '<=' || m?.[1] === '>' || m?.[1] === '<' ? m[1] : '=';
      return { kind: 'amount', field: key, op, value: amountOf(m?.[2] ?? '', decimals, query) };
    }
    case 'before':
    case 'after':
    case 'on':
      return { kind: 'date', op: key, date: dateOf(value, options.dateOrder ?? 'MDY', query) };
    case 'flag':
    case 'flag is':
      return { kind: 'flag', color: flagOf(value, options, query) };
    case 'is': {
      const state = STATES.find((s) => s === value.toLowerCase());
      if (!state) throw new ValidationError(`Unknown state in search "${query}": "is: ${value}"`);
      return { kind: 'state', state };
    }
    default:
      throw new ValidationError(`Unknown search criterion "${term.slice(0, colon)}:" in "${query}"`);
  }
}

/**
 * Parse YNAB register search text: comma-separated criteria, each `Key: value` or a bare keyword
 * or free text. Keys and values are case-insensitive; inner spacing must match exactly.
 * Throws ValidationError for unknown keys, empty values, bad amounts, dates or flags.
 */
export function parseSearch(text: string, options: SearchOptions = {}): SearchQuery {
  const criteria = text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => parseTerm(t, options, text));
  return { criteria };
}

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    default:
      return a === b;
  }
}

function isSplit(tx: Transaction): boolean {
  return tx.subtransactions !== undefined && tx.subtransactions.length > 0;
}

/** Payee as displayed: the payee name, or "Transfer : <account>" for transfers. */
function payeeTexts(tx: Transaction, ctx: SearchContext): string[] {
  const out: string[] = [];
  if (tx.payeeId !== undefined) {
    const name = ctx.payeeName?.(tx.payeeId);
    if (name !== undefined) out.push(name);
  }
  if (tx.transferAccountId !== undefined) out.push(`Transfer : ${ctx.accountName?.(tx.transferAccountId) ?? ''}`);
  return out;
}

function categoryTexts(tx: Transaction, ctx: SearchContext): string[] {
  const refs = isSplit(tx) ? (tx.subtransactions ?? []).map((s) => s.categoryId) : [tx.categoryId];
  const out: string[] = [];
  for (const ref of refs) {
    if (ref === null) continue;
    const name = ctx.categoryName?.(ref) ?? (ref === READY_TO_ASSIGN ? 'Ready to Assign' : undefined);
    if (name !== undefined) out.push(name);
  }
  return out;
}

function memoTexts(tx: Transaction): string[] {
  const out = tx.memo === undefined ? [] : [tx.memo];
  for (const s of tx.subtransactions ?? []) if (s.memo !== undefined) out.push(s.memo);
  return out;
}

function accountTexts(tx: Transaction, ctx: SearchContext): string[] {
  const name = ctx.accountName?.(tx.accountId);
  return name === undefined ? [] : [name];
}

const containsText = (haystacks: readonly string[], needle: string) => haystacks.some((h) => h.toLowerCase().includes(needle));

function matchesState(tx: SearchableTransaction, state: SearchState): boolean {
  const approved = tx.approved !== false;
  const flagged = tx.flag !== undefined && tx.flag !== null;
  switch (state) {
    case 'cleared': // (assumption) exactly "cleared": reconciled has its own filter
      return tx.cleared === 'cleared';
    case 'uncleared':
      return tx.cleared === 'uncleared';
    case 'reconciled':
      return tx.cleared === 'reconciled';
    case 'unreconciled':
      return tx.cleared !== 'reconciled';
    case 'approved':
      return approved;
    case 'unapproved':
      return !approved;
    case 'matched':
      return tx.matched === true;
    case 'unmatched':
      return tx.matched !== true;
    case 'split':
      return isSplit(tx);
    case 'flagged':
      return flagged;
    case 'unflagged':
      return !flagged;
    case 'uncategorized':
      return !isSplit(tx) && tx.categoryId === null && tx.transferAccountId === undefined;
  }
}

function matchesCriterion(tx: SearchableTransaction, c: SearchCriterion, ctx: SearchContext): boolean {
  switch (c.kind) {
    case 'text': {
      if (c.field === 'payee') return containsText(payeeTexts(tx, ctx), c.value);
      if (c.field === 'category') return containsText(categoryTexts(tx, ctx), c.value);
      if (c.field === 'memo') return containsText(memoTexts(tx), c.value);
      if (c.field === 'account') return containsText(accountTexts(tx, ctx), c.value);
      const texts = [...payeeTexts(tx, ctx), ...categoryTexts(tx, ctx), ...memoTexts(tx), ...accountTexts(tx, ctx)];
      if (containsText(texts, c.value)) return true;
      if (c.amount === undefined) return false;
      const amounts = [tx.amount, ...(tx.subtransactions ?? []).map((s) => s.amount)];
      return amounts.some((a) => Math.abs(a) === c.amount);
    }
    case 'amount':
      if (c.field === 'outflow') return tx.amount < 0 && compare(0 - tx.amount, c.op, c.value);
      if (c.field === 'inflow') return tx.amount > 0 && compare(tx.amount, c.op, c.value);
      return compare(Math.abs(tx.amount), c.op, c.value);
    case 'direction':
      return c.direction === 'outflow' ? tx.amount < 0 : tx.amount > 0;
    case 'date': {
      const cmp = compareDates(tx.date, c.date);
      return c.op === 'before' ? cmp <= 0 : c.op === 'after' ? cmp >= 0 : cmp === 0;
    }
    case 'flag':
      return tx.flag === c.color;
    case 'state':
      return matchesState(tx, c.state);
  }
}

export function matchesSearch(query: SearchQuery, tx: SearchableTransaction, ctx: SearchContext = {}): boolean {
  if (tx.deleted) return false;
  return query.criteria.every((c) => matchesCriterion(tx, c, ctx));
}

/** The transactions matching `query`, in their original order. */
export function filterTransactions<T extends SearchableTransaction>(transactions: readonly T[], query: SearchQuery, ctx: SearchContext = {}): T[] {
  return transactions.filter((tx) => matchesSearch(query, tx, ctx));
}
