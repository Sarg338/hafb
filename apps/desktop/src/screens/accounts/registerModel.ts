// The register (S4.5): rows and their labels, the running balance, and the draft a row is edited
// as. Pure: plan records in, display data out; drafts out as store command arguments. Labels follow
// YNAB (observed in the YNAB trial, 2026-10-08):
// - A card payment reads "Payment: <other account>" on both legs; other transfers "Transfer : <other>".
// - A transfer between two budget accounts needs no category; a card payment's category column
//   shows the card's payment category.
// - Starting balances on cards and off-budget accounts read "Category not needed".
import {
  CREDIT_ACCOUNT_TYPES,
  CREDIT_CARD_INTEREST,
  matchesSearch,
  parseSearch,
  READY_TO_ASSIGN,
  runningBalances,
  ValidationError,
  type CategoryRef,
  type ClearedState,
  type DateOrder,
  type FlagColor,
  type Frequency,
  type Id,
  type SearchableTransaction,
  type SearchContext,
  type SearchQuery,
} from '@hafb/engine';
import { addMonths, minor, monthOf, neg, ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import type { AccountRecord, PlanData, ScheduledInput, ScheduledTransactionRecord, SplitLineInput, SubtransactionRecord, TransactionInput, TransactionPatch, TransactionRecord } from '@hafb/store';

export interface CategoryLabel {
  text: string;
  tone: 'plain' | 'muted' | 'warn';
}

export interface SplitLine {
  id: Id;
  payee: string;
  category: CategoryLabel;
  memo: string;
  amount: Minor;
}

export interface RegisterRow {
  id: Id;
  accountId: Id;
  accountName: string;
  date: ISODate;
  payee: string;
  /** Transfers and card payments draw the transfer icon. */
  transfer: boolean;
  category: CategoryLabel;
  memo: string;
  amount: Minor;
  cleared: ClearedState;
  flag?: FlagColor;
  approved: boolean;
  splits: SplitLine[];
  /** Balance of the account after this transaction (single-account registers only). */
  balance?: Minor;
  /** Fields the inline editor locks for this row. */
  locks: { category: boolean; amount: boolean; payee: boolean };
}

const isCredit = (a: AccountRecord | undefined): boolean => a !== undefined && CREDIT_ACCOUNT_TYPES.includes(a.type);

export interface Lookups {
  accounts: Map<Id, AccountRecord>;
  payees: Map<Id, string>;
  categories: Map<Id, { name: string; payment: boolean }>;
  /** Card account id → its payment category's name. */
  paymentByCard: Map<Id, string>;
}

export function lookups(plan: PlanData): Lookups {
  return {
    accounts: new Map(plan.accounts.map((a) => [a.id, a])),
    payees: new Map(plan.payees.map((p) => [p.id, p.name])),
    categories: new Map(plan.categories.map((c) => [c.id, { name: c.name, payment: c.creditCardAccountId !== undefined }])),
    paymentByCard: new Map(plan.categories.filter((c) => c.creditCardAccountId !== undefined && c.deletedAt === undefined).map((c) => [c.creditCardAccountId ?? '', c.name])),
  };
}

/** "Payment: X" for a card payment (either leg), else "Transfer : X". */
export function transferLabel(self: AccountRecord | undefined, other: AccountRecord | undefined): string {
  const name = other?.name ?? 'account';
  const payment = (isCredit(self) || isCredit(other)) && self?.onBudget === true && other?.onBudget === true && isCredit(self) !== isCredit(other);
  return payment ? `Payment: ${name}` : `Transfer : ${name}`;
}

function categoryLabel(t: Pick<TransactionRecord, 'categoryId' | 'transferAccountId' | 'isStartingBalance' | 'amount'>, account: AccountRecord | undefined, look: Lookups): CategoryLabel {
  if (t.categoryId === READY_TO_ASSIGN) {
    if (t.isStartingBalance === true && isCredit(account)) return { text: 'Category not needed', tone: 'muted' };
    return { text: 'Inflow: Ready to Assign', tone: 'plain' };
  }
  if (t.categoryId === CREDIT_CARD_INTEREST) return { text: 'Credit Card Interest', tone: 'plain' };
  if (t.categoryId !== null) return { text: look.categories.get(t.categoryId)?.name ?? 'Unknown category', tone: 'plain' };
  if (t.transferAccountId !== undefined) {
    const other = look.accounts.get(t.transferAccountId);
    if (account?.onBudget === true && other?.onBudget === true) {
      const card = isCredit(account) ? account : isCredit(other) ? other : undefined;
      if (card) {
        const payment = look.paymentByCard.get(card.id);
        return payment === undefined ? { text: 'Category not needed', tone: 'muted' } : { text: `Credit Card Payments: ${payment}`, tone: 'plain' };
      }
      return { text: 'Category not needed', tone: 'muted' };
    }
    return account?.onBudget === true ? { text: 'Needs a category', tone: 'warn' } : { text: 'Category not needed', tone: 'muted' };
  }
  if (account?.onBudget !== true || t.isStartingBalance === true) return { text: 'Category not needed', tone: 'muted' };
  return { text: 'Needs a category', tone: 'warn' };
}

function splitLines(subs: readonly SubtransactionRecord[] | undefined, account: AccountRecord | undefined, look: Lookups): SplitLine[] {
  return (subs ?? []).map((s) => ({
    id: s.id,
    payee: s.transferAccountId !== undefined ? transferLabel(account, look.accounts.get(s.transferAccountId)) : s.payeeId !== undefined ? (look.payees.get(s.payeeId) ?? '') : '',
    category: categoryLabel({ categoryId: s.categoryId, ...(s.transferAccountId === undefined ? {} : { transferAccountId: s.transferAccountId }), amount: s.amount }, account, look),
    memo: s.memo ?? '',
    amount: s.amount,
  }));
}

// ---- search, view options, sort (S4.6) ---------------------------------------------------------------

/** The plan's date format as a field order ('MM/DD/YYYY' → 'MDY'), for Before/After/On. */
export function dateOrderOf(format: string): DateOrder {
  const letters = [...format.toUpperCase().matchAll(/Y+|M+|D+/g)].map((m) => m[0].charAt(0)).join('');
  return letters === 'DMY' || letters === 'YMD' ? letters : 'MDY';
}

export interface ParsedSearch {
  query: SearchQuery | null;
  /** Why the text is not a valid search (an unknown key, a bad amount or date…). */
  error: string | null;
}

/** YNAB's criteria search (`Category: Dining Out, Outflow: >=30`, `is:` keywords…; roadmap D9). */
export function parseRegisterSearch(plan: PlanData, text: string): ParsedSearch {
  if (text.trim() === '') return { query: null, error: null };
  const flagNames: Partial<Record<FlagColor, string>> = {};
  for (const f of plan.flagNames) flagNames[f.color] = f.name;
  try {
    return { query: parseSearch(text, { decimals: plan.settings.currencyDecimals, dateOrder: dateOrderOf(plan.settings.dateFormat), flagNames }), error: null };
  } catch (e) {
    if (e instanceof ValidationError) return { query: null, error: e.message };
    throw e;
  }
}

/** YNAB's View Options presets. */
export type DatePreset = 'thisMonth' | 'lastMonth' | 'latest3' | 'thisYear' | 'lastYear' | 'all';
export const DATE_PRESETS: readonly { id: DatePreset; label: string }[] = [
  { id: 'thisMonth', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'latest3', label: 'Latest 3 Months' },
  { id: 'thisYear', label: 'This Year' },
  { id: 'lastYear', label: 'Last Year' },
  { id: 'all', label: 'All Dates' },
];

export interface MonthRange {
  from: Month;
  to: Month;
}

/** The months a preset shows (null = all dates). */
export function presetRange(preset: DatePreset, today: ISODate): MonthRange | null {
  const m = monthOf(today);
  const january = addMonths(m, 1 - Number(m.slice(5, 7)));
  switch (preset) {
    case 'thisMonth':
      return { from: m, to: m };
    case 'lastMonth':
      return { from: addMonths(m, -1), to: addMonths(m, -1) };
    case 'latest3':
      return { from: addMonths(m, -2), to: m };
    case 'thisYear':
      return { from: january, to: addMonths(january, 11) };
    case 'lastYear':
      return { from: addMonths(january, -12), to: addMonths(january, -1) };
    case 'all':
      return null;
  }
}

export type SortColumn = 'account' | 'date' | 'payee' | 'category' | 'memo' | 'outflow' | 'inflow';
export interface RegisterSort {
  column: SortColumn;
  dir: 'asc' | 'desc';
}
export const DEFAULT_SORT: RegisterSort = { column: 'date', dir: 'desc' };

/** A header click: the sorted column flips; another column starts descending (YNAB trial). */
export function nextSort(current: RegisterSort, column: SortColumn): RegisterSort {
  return current.column === column ? { column, dir: current.dir === 'desc' ? 'asc' : 'desc' } : { column, dir: 'desc' };
}

export interface RegisterOptions {
  /** One account, or null for All Accounts. */
  accountId: Id | null;
  /** A parsed criteria search (`parseRegisterSearch`). */
  search?: SearchQuery | null;
  onlyUnapproved?: boolean;
  /** Only rows that need a category (the banner's View). */
  onlyUncategorized?: boolean;
  /** View Options date range (null or absent = all dates). */
  range?: MonthRange | null;
  /** View Options: Show Reconciled Transactions (default on). */
  showReconciled?: boolean;
  sort?: RegisterSort;
}

function searchContext(plan: PlanData, look: Lookups): SearchContext {
  return {
    payeeName: (id) => look.payees.get(id),
    categoryName: (id) => look.categories.get(id)?.name,
    accountName: (id) => look.accounts.get(id)?.name,
    decimals: plan.settings.currencyDecimals,
  };
}

const textKey = (r: RegisterRow, c: SortColumn): string => (c === 'account' ? r.accountName : c === 'payee' ? r.payee : c === 'category' ? r.category.text : r.memo).toLowerCase();

/** Newest first by default; within a day, the latest entered first (YNAB's register order). */
export function registerRows(plan: PlanData, options: RegisterOptions): RegisterRow[] {
  const look = lookups(plan);
  const liveAccounts = new Set(plan.accounts.filter((a) => a.deletedAt === undefined).map((a) => a.id));
  const inView = plan.transactions.filter((t) => t.deletedAt === undefined && liveAccounts.has(t.accountId) && (options.accountId === null || t.accountId === options.accountId));
  const balances =
    options.accountId === null
      ? null
      : runningBalances(
          inView
            .toSorted((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((t) => ({ id: t.id, date: t.date, amount: t.amount })),
        );
  const search = options.search && options.search.criteria.length > 0 ? options.search : null;
  const ctx = searchContext(plan, look);
  const range = options.range ?? null;
  const rows: RegisterRow[] = [];
  for (const t of inView) {
    if (options.onlyUnapproved === true && t.approved !== false) continue;
    if (options.showReconciled === false && t.cleared === 'reconciled') continue;
    if (range && (monthOf(t.date) < range.from || monthOf(t.date) > range.to)) continue;
    if (search && !matchesSearch(search, t, ctx)) continue;
    const account = look.accounts.get(t.accountId);
    const other = t.transferAccountId === undefined ? undefined : look.accounts.get(t.transferAccountId);
    let splits = splitLines(t.subtransactions, account, look);
    if (search && splits.length > 0) {
      // A search shows only the split lines it matched (YNAB); a whole-row match shows them all.
      const subs = t.subtransactions ?? [];
      const keep = new Set(
        subs
          .filter((sub) => {
            const payeeId = sub.payeeId ?? t.payeeId;
            const line: SearchableTransaction = {
              id: sub.id,
              accountId: t.accountId,
              date: t.date,
              amount: sub.amount,
              categoryId: sub.categoryId,
              cleared: t.cleared,
              ...(t.approved === undefined ? {} : { approved: t.approved }),
              ...(t.flag === undefined ? {} : { flag: t.flag }),
              ...(payeeId === undefined ? {} : { payeeId }),
              ...(sub.memo === undefined ? {} : { memo: sub.memo }),
              ...(sub.transferAccountId === undefined ? {} : { transferAccountId: sub.transferAccountId }),
            };
            return matchesSearch(search, line, ctx);
          })
          .map((sub) => sub.id),
      );
      if (keep.size > 0) splits = splits.filter((l) => keep.has(l.id));
    }
    const payee = t.transferAccountId !== undefined ? transferLabel(account, other) : t.payeeId === undefined ? '' : (look.payees.get(t.payeeId) ?? '');
    const category: CategoryLabel = (t.subtransactions?.length ?? 0) > 0 ? { text: `Split (${String(t.subtransactions?.length ?? 0)})`, tone: 'plain' } : categoryLabel(t, account, look);
    if (options.onlyUncategorized === true && category.tone !== 'warn') continue;
    rows.push({
      id: t.id,
      accountId: t.accountId,
      accountName: account?.name ?? '',
      date: t.date,
      payee,
      transfer: t.transferAccountId !== undefined,
      category,
      memo: t.memo ?? '',
      amount: t.amount,
      cleared: t.cleared,
      ...(t.flag === undefined ? {} : { flag: t.flag }),
      approved: t.approved !== false,
      splits,
      ...(balances ? { balance: balances.get(t.id) ?? ZERO } : {}),
      locks: {
        category: (t.subtransactions?.length ?? 0) > 0 || (t.transferAccountId !== undefined && account?.onBudget === true && other?.onBudget === true) || account?.onBudget !== true,
        amount: (t.subtransactions?.length ?? 0) > 0,
        payee: false,
      },
    });
  }
  // One key per row, built once: the comparator runs n log n times (20k rows: ~300k calls).
  const keys = new Map(inView.map((t) => [t.id, `${t.date}|${t.createdAt}|${t.id}`]));
  const key = (x: RegisterRow): string => keys.get(x.id) ?? '';
  const byDate = (a: RegisterRow, b: RegisterRow): number => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  };
  const sort = options.sort ?? DEFAULT_SORT;
  const sign = sort.dir === 'desc' ? 1 : -1;
  const compare = (a: RegisterRow, b: RegisterRow): number => {
    if (sort.column === 'date') return sign * byDate(a, b);
    const c =
      sort.column === 'outflow'
        ? Math.max(0, 0 - b.amount) - Math.max(0, 0 - a.amount)
        : sort.column === 'inflow'
          ? Math.max(0, b.amount) - Math.max(0, a.amount)
          : textKey(b, sort.column).localeCompare(textKey(a, sort.column));
    return c !== 0 ? sign * c : byDate(a, b);
  };
  return rows.sort(compare);
}

/** The banners' counts for a register, over all its rows (not the filtered view). */
export function registerCounts(plan: PlanData, accountId: Id | null): { unapproved: number; uncategorized: number } {
  const look = lookups(plan);
  let unapproved = 0;
  let uncategorized = 0;
  for (const t of plan.transactions) {
    if (t.deletedAt !== undefined || (accountId !== null && t.accountId !== accountId)) continue;
    const account = look.accounts.get(t.accountId);
    if (!account || account.deletedAt !== undefined) continue;
    if (t.approved === false) unapproved += 1;
    if ((t.subtransactions?.length ?? 0) === 0 && categoryLabel(t, account, look).tone === 'warn') uncategorized += 1;
  }
  return { unapproved, uncategorized };
}

/** Sum of the selected rows (YNAB's "Selected Total (n)"). */
export function selectedTotal(rows: readonly RegisterRow[], selected: ReadonlySet<Id>): Minor {
  let total = 0;
  for (const r of rows) if (selected.has(r.id)) total += r.amount;
  return minor(total);
}

// ---- editing ---------------------------------------------------------------------------------------

/** One split line being edited. Lines take a saved payee or a transfer, not a new payee name. */
export interface SplitLineDraft {
  /** Stable React key; an existing line's id. */
  key: string;
  id?: Id;
  payeeId: Id | null;
  transferAccountId: Id | null;
  categoryId: CategoryRef;
  memo: string;
  outflow: Minor;
  inflow: Minor;
}

/** A row being edited (or the new-transaction row). Amounts are entered positive, as YNAB does. */
export interface TxDraft {
  accountId: Id;
  date: ISODate;
  /** A saved payee, or null with `payeeName` for a new one. Transfers use `transferAccountId`. */
  payeeId: Id | null;
  payeeName: string;
  transferAccountId: Id | null;
  categoryId: CategoryRef;
  memo: string;
  outflow: Minor;
  inflow: Minor;
  cleared: ClearedState;
  flag: FlagColor | null;
  /** Split lines, or null when the transaction is not split. */
  splits: SplitLineDraft[] | null;
  /** The repeat choice: new rows and scheduled rows only. */
  frequency?: Frequency;
}

const lineDraft = (s: Pick<SubtransactionRecord, 'id' | 'amount' | 'categoryId' | 'memo' | 'payeeId' | 'transferAccountId'>): SplitLineDraft => ({
  key: s.id,
  id: s.id,
  payeeId: s.transferAccountId === undefined ? (s.payeeId ?? null) : null,
  transferAccountId: s.transferAccountId ?? null,
  categoryId: s.categoryId,
  memo: s.memo ?? '',
  outflow: s.amount < 0 ? neg(s.amount) : ZERO,
  inflow: s.amount > 0 ? s.amount : ZERO,
});

export function draftFor(t: TransactionRecord | null, defaults: { accountId: Id; date: ISODate; cleared?: ClearedState }): TxDraft {
  if (!t) {
    return { accountId: defaults.accountId, date: defaults.date, payeeId: null, payeeName: '', transferAccountId: null, categoryId: null, memo: '', outflow: ZERO, inflow: ZERO, cleared: defaults.cleared ?? 'uncleared', flag: null, splits: null };
  }
  return {
    accountId: t.accountId,
    date: t.date,
    payeeId: t.transferAccountId === undefined ? (t.payeeId ?? null) : null,
    payeeName: '',
    transferAccountId: t.transferAccountId ?? null,
    categoryId: t.categoryId,
    memo: t.memo ?? '',
    outflow: t.amount < 0 ? neg(t.amount) : ZERO,
    inflow: t.amount > 0 ? t.amount : ZERO,
    cleared: t.cleared,
    flag: t.flag ?? null,
    splits: t.subtransactions?.length ? t.subtransactions.map(lineDraft) : null,
  };
}

// ---- splits (YNAB: two empty lines, "Add another split", "Amount remaining to assign") -------------

const emptyLine = (key: string): SplitLineDraft => ({ key, payeeId: null, transferAccountId: null, categoryId: null, memo: '', outflow: ZERO, inflow: ZERO });

function nextKey(lines: readonly SplitLineDraft[]): string {
  let n = lines.length + 1;
  while (lines.some((l) => l.key === `line-${String(n)}`)) n += 1;
  return `line-${String(n)}`;
}

/** Start splitting: a split can't itself be a transfer, so the row loses its transfer and category. */
export function startSplit(d: TxDraft): TxDraft {
  if (d.splits !== null) return d;
  return { ...d, transferAccountId: null, categoryId: null, splits: [emptyLine('line-1'), emptyLine('line-2')] };
}

export function addSplitLine(d: TxDraft): TxDraft {
  const lines = d.splits ?? [];
  return { ...d, splits: [...lines, emptyLine(nextKey(lines))] };
}

/** Remove a line; removing the last one ends the split. */
export function removeSplitLine(d: TxDraft, key: string): TxDraft {
  const lines = (d.splits ?? []).filter((l) => l.key !== key);
  return { ...d, splits: lines.length === 0 ? null : lines };
}

export function patchSplitLine(d: TxDraft, key: string, patch: Partial<Omit<SplitLineDraft, 'key' | 'id'>>): TxDraft {
  return { ...d, splits: (d.splits ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)) };
}

const lineAmount = (l: SplitLineDraft): Minor => minor(l.inflow - l.outflow);

/** What the lines still have to cover: the row's amount minus the lines (YNAB "Amount remaining to assign"). */
export function splitRemaining(d: TxDraft): Minor {
  let sum = 0;
  for (const l of d.splits ?? []) sum += lineAmount(l);
  return minor(draftAmount(d) - sum);
}

function lineInput(plan: PlanData, accountId: Id, l: SplitLineDraft): SplitLineInput {
  const account = plan.accounts.find((a) => a.id === accountId);
  const takesCategory = account?.onBudget === true && (l.transferAccountId === null || transferNeedsCategory(plan, accountId, l.transferAccountId));
  return {
    ...(l.id === undefined ? {} : { id: l.id }),
    amount: lineAmount(l),
    categoryId: takesCategory ? l.categoryId : null,
    ...(l.transferAccountId !== null ? { transferAccountId: l.transferAccountId } : l.payeeId !== null ? { payeeId: l.payeeId } : {}),
    ...(l.memo.trim() === '' ? {} : { memo: l.memo.trim() }),
  };
}

const sameLines = (a: readonly SplitLineInput[], b: readonly SplitLineInput[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Whether a transfer between these two accounts takes a category (§5.9): only budget ↔ tracking. */
export function transferNeedsCategory(plan: PlanData, accountId: Id, otherId: Id | null): boolean {
  if (otherId === null) return true;
  const a = plan.accounts.find((x) => x.id === accountId);
  const b = plan.accounts.find((x) => x.id === otherId);
  return (a?.onBudget === true) !== (b?.onBudget === true);
}

/** The category the draft may carry: none where the transfer or the account takes none. */
function effectiveCategory(plan: PlanData, d: TxDraft): CategoryRef {
  const account = plan.accounts.find((a) => a.id === d.accountId);
  if (account?.onBudget !== true || d.splits !== null) return null;
  if (d.transferAccountId !== null && !transferNeedsCategory(plan, d.accountId, d.transferAccountId)) return null;
  return d.categoryId;
}

export const draftAmount = (d: TxDraft): Minor => minor(d.inflow - d.outflow);

export function toInput(plan: PlanData, d: TxDraft): TransactionInput {
  const payee = d.transferAccountId !== null && d.splits === null ? { transferAccountId: d.transferAccountId } : d.payeeId !== null ? { payeeId: d.payeeId } : d.payeeName.trim() !== '' ? { payeeName: d.payeeName.trim() } : {};
  return {
    accountId: d.accountId,
    date: d.date,
    amount: draftAmount(d),
    ...payee,
    categoryId: effectiveCategory(plan, d),
    ...(d.memo.trim() === '' ? {} : { memo: d.memo.trim() }),
    ...(d.flag === null ? {} : { flag: d.flag }),
    cleared: d.cleared,
    ...(d.splits === null ? {} : { subtransactions: d.splits.map((l) => lineInput(plan, d.accountId, l)) }),
  };
}

// ---- scheduled transactions (S5.4; YNAB, observed 2026-10-08) ------------------------------------
// The register's collapsible "Scheduled Transactions" section lists each schedule's next occurrence,
// earliest first. A schedule is edited in the same row editor; its repeat is chosen under the date
// picker's calendar ("Repeat: Never"). A new transaction dated after today becomes a schedule.

/** YNAB's repeat options, in its order. */
export const FREQUENCIES: readonly { id: Frequency; label: string }[] = [
  { id: 'never', label: 'Never' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'everyOtherWeek', label: 'Every other week' },
  { id: 'twiceAMonth', label: 'Twice a month' },
  { id: 'every4Weeks', label: 'Every 4 weeks' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'everyOtherMonth', label: 'Every other month' },
  { id: 'every3Months', label: 'Every 3 months' },
  { id: 'every4Months', label: 'Every 4 months' },
  { id: 'twiceAYear', label: 'Twice a year' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'everyOtherYear', label: 'Every other year' },
];
export const frequencyLabel = (f: Frequency): string => FREQUENCIES.find((x) => x.id === f)?.label ?? f;

/** Scheduled rows are keyed apart from transactions. */
export const SCHEDULED_PREFIX = 'sched:';
export const scheduledRowId = (id: Id): string => `${SCHEDULED_PREFIX}${id}`;
export const scheduledIdOf = (rowId: string): Id | null => (rowId.startsWith(SCHEDULED_PREFIX) ? rowId.slice(SCHEDULED_PREFIX.length) : null);

export interface ScheduledRow extends RegisterRow {
  scheduledId: Id;
  frequency: Frequency;
}

/** The register's scheduled rows: each schedule's next occurrence, earliest first. */
export function scheduledRows(plan: PlanData, accountId: Id | null): ScheduledRow[] {
  const look = lookups(plan);
  const out: ScheduledRow[] = [];
  for (const s of plan.scheduled) {
    if (s.deletedAt !== undefined || (accountId !== null && s.accountId !== accountId)) continue;
    const account = look.accounts.get(s.accountId);
    if (!account || account.deletedAt !== undefined) continue;
    const other = s.transferAccountId === undefined ? undefined : look.accounts.get(s.transferAccountId);
    const lines = splitLines(s.subtransactions, account, look);
    out.push({
      id: scheduledRowId(s.id),
      scheduledId: s.id,
      frequency: s.frequency,
      accountId: s.accountId,
      accountName: account.name,
      date: s.date,
      payee: s.transferAccountId !== undefined ? transferLabel(account, other) : s.payeeId === undefined ? '' : (look.payees.get(s.payeeId) ?? ''),
      transfer: s.transferAccountId !== undefined,
      category: lines.length > 0 ? { text: `Split (${String(lines.length)})`, tone: 'plain' } : categoryLabel(s, account, look),
      memo: s.memo ?? '',
      amount: s.amount,
      cleared: 'uncleared',
      ...(s.flag === undefined ? {} : { flag: s.flag }),
      approved: true,
      splits: lines,
      locks: { category: lines.length > 0 || !account.onBudget, amount: lines.length > 0, payee: false },
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function draftForScheduled(s: ScheduledTransactionRecord): TxDraft {
  return {
    accountId: s.accountId,
    date: s.date,
    payeeId: s.transferAccountId === undefined ? (s.payeeId ?? null) : null,
    payeeName: '',
    transferAccountId: s.transferAccountId ?? null,
    categoryId: s.categoryId,
    memo: s.memo ?? '',
    outflow: s.amount < 0 ? neg(s.amount) : ZERO,
    inflow: s.amount > 0 ? s.amount : ZERO,
    cleared: 'uncleared',
    flag: s.flag ?? null,
    splits: s.subtransactions?.length ? s.subtransactions.map(lineDraft) : null,
    frequency: s.frequency,
  };
}

/** The draft as a schedule (the cleared state belongs to the entered transaction, not the schedule). */
export function toScheduledInput(plan: PlanData, d: TxDraft): ScheduledInput {
  const input: Omit<TransactionInput, 'cleared'> & { cleared?: unknown } = toInput(plan, d);
  delete input.cleared;
  return { ...input, frequency: d.frequency ?? 'never' };
}

/**
 * What saving a new row does (YNAB): a date after today schedules it; today or earlier with a
 * repeat enters it and schedules the next one; otherwise it is an ordinary transaction.
 */
export function newRowKind(d: TxDraft, today: ISODate): 'transaction' | 'scheduled' | 'transactionAndRepeat' {
  if (d.date > today) return 'scheduled';
  return d.frequency !== undefined && d.frequency !== 'never' ? 'transactionAndRepeat' : 'transaction';
}

/** New transactions in a cash account start cleared (YNAB, CLAUDE.md §4). */
export function defaultCleared(plan: PlanData, accountId: Id): ClearedState {
  return plan.accounts.find((a) => a.id === accountId)?.type === 'cash' ? 'cleared' : 'uncleared';
}

/** The patch that turns `t` into the draft (only what changed; saving approves, as in YNAB). */
export function toPatch(plan: PlanData, t: TransactionRecord, d: TxDraft): TransactionPatch {
  const before = draftFor(t, { accountId: t.accountId, date: t.date });
  const patch: TransactionPatch = {};
  const wasSplit = (t.subtransactions?.length ?? 0) > 0;
  if (d.date !== before.date) patch.date = d.date;
  if (d.accountId !== before.accountId) patch.accountId = d.accountId;
  if (draftAmount(d) !== t.amount) patch.amount = draftAmount(d);
  const transferAccountId = d.splits === null ? d.transferAccountId : null;
  if (transferAccountId !== before.transferAccountId) {
    patch.transferAccountId = transferAccountId;
    if (transferAccountId === null) {
      if (d.payeeId !== null) patch.payeeId = d.payeeId;
      else if (d.payeeName.trim() !== '') patch.payeeName = d.payeeName.trim();
    }
  } else if (transferAccountId === null && (d.payeeId !== before.payeeId || d.payeeName.trim() !== '')) {
    if (d.payeeId !== null) patch.payeeId = d.payeeId;
    else if (d.payeeName.trim() !== '') patch.payeeName = d.payeeName.trim();
    else patch.payeeId = null;
  }
  if (d.splits !== null) {
    const lines = d.splits.map((l) => lineInput(plan, d.accountId, l));
    const old = (before.splits ?? []).map((l) => lineInput(plan, t.accountId, l));
    if (!wasSplit || !sameLines(lines, old) || patch.accountId !== undefined) patch.subtransactions = lines;
  } else {
    if (wasSplit) patch.subtransactions = null;
    const category = effectiveCategory(plan, d);
    if (wasSplit || category !== t.categoryId) patch.categoryId = category;
  }
  if (d.memo.trim() !== (t.memo ?? '')) patch.memo = d.memo.trim() === '' ? null : d.memo.trim();
  if (d.flag !== before.flag) patch.flag = d.flag;
  if (d.cleared !== t.cleared && t.cleared !== 'reconciled') patch.cleared = d.cleared;
  if (t.approved === false) patch.approved = true;
  return patch;
}
