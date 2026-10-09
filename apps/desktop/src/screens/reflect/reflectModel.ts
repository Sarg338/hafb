// Reflect's filters (S6.1), pure: the date range (YNAB's presets, Custom, previous/next), the
// category and account trees, their labels, and the engine filters they become. Observed in the
// YNAB trial (2026-10-09): presets This Month, Last 3/6/12 Months, Year To Date, Last Year,
// All Dates, Custom (start and end month); ranges stop at the plan's first month; the category
// list starts with "Uncategorized Transactions" and leaves out Credit Card Payments; Spending
// reports list Cash and Credit accounts, Net Worth every account; a partial pick reads
// "N Selected Categories". The filters are shared by every tab and remembered per plan file.
import { UNCATEGORIZED, type ReportFilters } from '@hafb/engine';
import { addMonths, compareMonths, makeMonth, monthOf, monthParts, monthsBetween, type ISODate, type Month } from '@hafb/shared';
import type { AccountRecord, PlanData } from '@hafb/store';

export type ReportTab = 'breakdown' | 'trends' | 'networth' | 'income' | 'age';

export const REPORT_TABS: readonly { id: ReportTab; label: string }[] = [
  { id: 'breakdown', label: 'Spending Breakdown' },
  { id: 'trends', label: 'Spending Trends' },
  { id: 'networth', label: 'Net Worth' },
  { id: 'income', label: 'Income v Expense' },
  { id: 'age', label: 'Age of Money' },
];

export function reportTab(id: string | undefined): ReportTab {
  return REPORT_TABS.find((t) => t.id === id)?.id ?? 'breakdown';
}

export type RangePreset = 'thisMonth' | 'last3' | 'last6' | 'last12' | 'ytd' | 'lastYear' | 'all' | 'custom';

export const RANGE_PRESETS: readonly { id: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { id: 'thisMonth', label: 'This Month' },
  { id: 'last3', label: 'Last 3 Months' },
  { id: 'last6', label: 'Last 6 Months' },
  { id: 'last12', label: 'Last 12 Months' },
  { id: 'ytd', label: 'Year To Date' },
  { id: 'lastYear', label: 'Last Year' },
  { id: 'all', label: 'All Dates' },
];

export interface ReflectFilters {
  preset: RangePreset;
  /** Custom range only. */
  from?: Month;
  to?: Month;
  /** Unchecked categories (`UNCATEGORIZED` for uncategorized money); new ones start checked. */
  excludedCategories: readonly string[];
  /** Unchecked accounts. */
  excludedAccounts: readonly string[];
}

export const DEFAULT_FILTERS: ReflectFilters = { preset: 'thisMonth', excludedCategories: [], excludedAccounts: [] };

export interface MonthBounds {
  first: Month;
  last: Month;
}

/** The months the plan has: from its first month (or first transaction) to this month (or a later transaction). */
export function planBounds(plan: PlanData, today: ISODate): MonthBounds {
  const now = monthOf(today);
  let first = plan.settings.firstMonth ?? now;
  let last = now;
  for (const t of plan.transactions) {
    if (t.deletedAt !== undefined) continue;
    const m = monthOf(t.date);
    if (compareMonths(m, first) < 0) first = m;
    if (compareMonths(m, last) > 0) last = m;
  }
  return { first: compareMonths(first, now) > 0 ? now : first, last };
}

export interface ResolvedRange {
  from: Month;
  to: Month;
  /** The asked-for range lies wholly outside the plan's months: show the empty state. */
  outside: boolean;
}

function wanted(f: ReflectFilters, today: ISODate, bounds: MonthBounds): { from: Month; to: Month } {
  const now = monthOf(today);
  const year = monthParts(now).year;
  switch (f.preset) {
    case 'thisMonth':
      return { from: now, to: now };
    case 'last3':
      return { from: addMonths(now, -2), to: now };
    case 'last6':
      return { from: addMonths(now, -5), to: now };
    case 'last12':
      return { from: addMonths(now, -11), to: now };
    case 'ytd':
      return { from: makeMonth(year, 1), to: now };
    case 'lastYear':
      return { from: makeMonth(year - 1, 1), to: makeMonth(year - 1, 12) };
    case 'all':
      return { from: bounds.first, to: bounds.last };
    case 'custom': {
      const a = f.from ?? now;
      const b = f.to ?? a;
      return compareMonths(a, b) <= 0 ? { from: a, to: b } : { from: b, to: a };
    }
  }
}

/** The months a report covers: the preset's months, clipped to the plan's months (as YNAB does). */
export function resolveRange(f: ReflectFilters, today: ISODate, bounds: MonthBounds): ResolvedRange {
  const w = wanted(f, today, bounds);
  if (compareMonths(w.to, bounds.first) < 0 || compareMonths(w.from, bounds.last) > 0) {
    const edge = compareMonths(w.to, bounds.first) < 0 ? bounds.first : bounds.last;
    return { from: edge, to: edge, outside: true };
  }
  return {
    from: compareMonths(w.from, bounds.first) < 0 ? bounds.first : w.from,
    to: compareMonths(w.to, bounds.last) > 0 ? bounds.last : w.to,
    outside: false,
  };
}

/** Previous/next: the same number of months, one span earlier or later, kept inside the plan. */
export function shiftRange(f: ReflectFilters, today: ISODate, bounds: MonthBounds, direction: -1 | 1): ReflectFilters | null {
  const r = resolveRange(f, today, bounds);
  const span = monthsBetween(r.from, r.to) + 1;
  let from = addMonths(r.from, direction * span);
  let to = addMonths(r.to, direction * span);
  if (direction < 0 && compareMonths(r.from, bounds.first) <= 0) return null;
  if (direction > 0 && compareMonths(r.to, bounds.last) >= 0) return null;
  if (compareMonths(from, bounds.first) < 0) {
    from = bounds.first;
    to = addMonths(from, span - 1);
  }
  if (compareMonths(to, bounds.last) > 0) {
    to = bounds.last;
    from = addMonths(to, -(span - 1));
    if (compareMonths(from, bounds.first) < 0) from = bounds.first;
  }
  return { ...f, preset: 'custom', from, to };
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Oct 2026": YNAB's month label in Reflect (chips, column headers, exports). */
export function monthLabel(m: Month): string {
  const { year, month } = monthParts(m);
  return `${SHORT[month - 1] ?? ''} ${String(year)}`;
}

/** "October 2026": table rows (Spending Trends, Net Worth). */
export function monthLong(m: Month): string {
  const { year, month } = monthParts(m);
  return `${LONG[month - 1] ?? ''} ${String(year)}`;
}

/** "10/26": chart axis ticks. */
export function monthTick(m: Month): string {
  const { year, month } = monthParts(m);
  return `${String(month)}/${String(year % 100).padStart(2, '0')}`;
}

export function rangeLabel(from: Month, to: Month): string {
  return from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;
}

// ---- trees -------------------------------------------------------------------------------------

export interface TreeNode {
  id: string;
  name: string;
  /** Present on a group: its leaves. */
  children?: readonly TreeNode[];
  /** A hidden category (YNAB marks them with an eye). */
  hidden?: boolean;
}

export const UNCATEGORIZED_LABEL = 'Uncategorized Transactions';

/** Categories as YNAB's filter lists them: Uncategorized first, then groups in plan order (no Credit Card Payments). */
export function categoryTree(plan: PlanData): TreeNode[] {
  const groups = plan.categoryGroups.filter((g) => g.deletedAt === undefined && g.systemKind !== 'creditCardPayments').toSorted((a, b) => a.sortOrder - b.sortOrder);
  const out: TreeNode[] = [{ id: UNCATEGORIZED, name: UNCATEGORIZED_LABEL }];
  for (const g of groups) {
    const children = plan.categories
      .filter((c) => c.groupId === g.id && c.deletedAt === undefined && c.creditCardAccountId === undefined)
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .map((c): TreeNode => ({ id: c.id, name: c.name, ...(c.hidden === true || g.systemKind === 'hidden' ? { hidden: true } : {}) }));
    if (children.length > 0) out.push({ id: `group:${g.id}`, name: g.name, children });
  }
  return out;
}

export type AccountScope = 'budget' | 'all';

const ACCOUNT_SECTIONS: readonly { name: string; test: (a: AccountRecord) => boolean; scope: AccountScope }[] = [
  { name: 'Cash Accounts', test: (a) => a.onBudget && !['creditCard', 'lineOfCredit'].includes(a.type), scope: 'budget' },
  { name: 'Credit Accounts', test: (a) => a.onBudget && ['creditCard', 'lineOfCredit'].includes(a.type), scope: 'budget' },
  { name: 'Loan Accounts', test: (a) => !a.onBudget && !['asset', 'liability'].includes(a.type), scope: 'all' },
  { name: 'Tracking Accounts', test: (a) => !a.onBudget && ['asset', 'liability'].includes(a.type), scope: 'all' },
];

/** Accounts by section in sidebar order; closed accounts too (their history is still in the reports). */
export function accountTree(plan: PlanData, scope: AccountScope): TreeNode[] {
  const live = plan.accounts.filter((a) => a.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const out: TreeNode[] = [];
  for (const s of ACCOUNT_SECTIONS) {
    if (scope === 'budget' && s.scope === 'all') continue;
    const children = live.filter(s.test).map((a): TreeNode => ({ id: a.id, name: a.closed === true ? `${a.name} (closed)` : a.name }));
    if (children.length > 0) out.push({ id: `section:${s.name}`, name: s.name, children });
  }
  return out;
}

export function leafIds(tree: readonly TreeNode[]): string[] {
  return tree.flatMap((n) => (n.children ? n.children.map((c) => c.id) : [n.id]));
}

export interface SelectionLabel {
  text: string;
  /** Shown as a badge before the text when only some are picked. */
  count?: number;
}

export function selectionLabel(noun: 'Categories' | 'Accounts', selected: number, total: number): SelectionLabel {
  if (selected >= total) return { text: `All ${noun}` };
  if (selected === 0) return { text: `No ${noun}` };
  return { text: `Selected ${noun}`, count: selected };
}

/** Leaves of `tree` still checked under `excluded`. */
export function checkedLeaves(tree: readonly TreeNode[], excluded: readonly string[]): string[] {
  const out = new Set(excluded);
  return leafIds(tree).filter((id) => !out.has(id));
}

/** Tree search: groups whose name matches keep every child; otherwise only matching children. */
export function filterTree(tree: readonly TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === '') return [...tree];
  const hit = (n: TreeNode) => n.name.toLocaleLowerCase().includes(q);
  const out: TreeNode[] = [];
  for (const n of tree) {
    if (!n.children) {
      if (hit(n)) out.push(n);
    } else if (hit(n)) {
      out.push(n);
    } else {
      const children = n.children.filter(hit);
      if (children.length > 0) out.push({ ...n, children });
    }
  }
  return out;
}

/** What the engine gets: the range, plus explicit id lists only when something is unchecked. */
export function engineFilters(f: ReflectFilters, plan: PlanData, range: { from: Month; to: Month }, scope: AccountScope): ReportFilters {
  const out: ReportFilters = { from: range.from, to: range.to };
  const accounts = accountTree(plan, scope);
  const accountIds = checkedLeaves(accounts, f.excludedAccounts);
  if (accountIds.length < leafIds(accounts).length) out.accountIds = accountIds;
  if (scope === 'budget') {
    const categories = categoryTree(plan);
    const categoryIds = checkedLeaves(categories, f.excludedCategories);
    if (categoryIds.length < leafIds(categories).length) out.categoryIds = categoryIds;
  }
  return out;
}

/** Bound a custom month into the plan's months (for the Custom pickers). */
export function monthsOf(bounds: MonthBounds): Month[] {
  const out: Month[] = [];
  for (let m = bounds.first; compareMonths(m, bounds.last) <= 0; m = addMonths(m, 1)) out.push(m);
  return out;
}
