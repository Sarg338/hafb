// The register (S4.5): rows and their labels, the running balance, and the draft a row is edited
// as. Pure: plan records in, display data out; drafts out as store command arguments. Labels follow
// YNAB (observed in the YNAB trial, 2026-10-08):
// - A card payment reads "Payment: <other account>" on both legs; other transfers "Transfer : <other>".
// - A transfer between two budget accounts needs no category; a card payment's category column
//   shows the card's payment category.
// - Starting balances on cards and off-budget accounts read "Category not needed".
import { CREDIT_ACCOUNT_TYPES, READY_TO_ASSIGN, runningBalances, type CategoryRef, type ClearedState, type FlagColor, type Id } from '@hafb/engine';
import { minor, neg, ZERO, type ISODate, type Minor } from '@hafb/shared';
import type { AccountRecord, PlanData, SubtransactionRecord, TransactionInput, TransactionPatch, TransactionRecord } from '@hafb/store';

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

export interface RegisterOptions {
  /** One account, or null for All Accounts. */
  accountId: Id | null;
  /** Plain text filter (S4.6 adds YNAB's criteria search). */
  query?: string;
  onlyUnapproved?: boolean;
}

/** Newest first; within a day, the latest entered first (YNAB's register order). */
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
  const q = (options.query ?? '').trim().toLowerCase();
  const rows: RegisterRow[] = [];
  for (const t of inView) {
    if (options.onlyUnapproved === true && t.approved !== false) continue;
    const account = look.accounts.get(t.accountId);
    const other = t.transferAccountId === undefined ? undefined : look.accounts.get(t.transferAccountId);
    const splits = splitLines(t.subtransactions, account, look);
    const payee = t.transferAccountId !== undefined ? transferLabel(account, other) : t.payeeId === undefined ? '' : (look.payees.get(t.payeeId) ?? '');
    const category: CategoryLabel = splits.length > 0 ? { text: `Split (${String(splits.length)})`, tone: 'plain' } : categoryLabel(t, account, look);
    const row: RegisterRow = {
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
        category: splits.length > 0 || (t.transferAccountId !== undefined && account?.onBudget === true && other?.onBudget === true) || account?.onBudget !== true,
        amount: splits.length > 0,
        payee: false,
      },
    };
    if (q !== '' && ![row.payee, row.memo, row.category.text, row.accountName, ...splits.flatMap((s) => [s.payee, s.memo, s.category.text])].join(' ').toLowerCase().includes(q)) continue;
    rows.push(row);
  }
  const created = new Map(inView.map((t) => [t.id, t.createdAt]));
  const entered = (x: RegisterRow): string => `${created.get(x.id) ?? ''}|${x.id}`;
  return rows.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : entered(a) < entered(b) ? 1 : entered(a) > entered(b) ? -1 : 0));
}

// ---- editing ---------------------------------------------------------------------------------------

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
}

export function draftFor(t: TransactionRecord | null, defaults: { accountId: Id; date: ISODate; cleared?: ClearedState }): TxDraft {
  if (!t) {
    return { accountId: defaults.accountId, date: defaults.date, payeeId: null, payeeName: '', transferAccountId: null, categoryId: null, memo: '', outflow: ZERO, inflow: ZERO, cleared: defaults.cleared ?? 'uncleared', flag: null };
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
  };
}

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
  if (account?.onBudget !== true) return null;
  if (d.transferAccountId !== null && !transferNeedsCategory(plan, d.accountId, d.transferAccountId)) return null;
  return d.categoryId;
}

export const draftAmount = (d: TxDraft): Minor => minor(d.inflow - d.outflow);

export function toInput(plan: PlanData, d: TxDraft): TransactionInput {
  const payee = d.transferAccountId !== null ? { transferAccountId: d.transferAccountId } : d.payeeId !== null ? { payeeId: d.payeeId } : d.payeeName.trim() !== '' ? { payeeName: d.payeeName.trim() } : {};
  return {
    accountId: d.accountId,
    date: d.date,
    amount: draftAmount(d),
    ...payee,
    categoryId: effectiveCategory(plan, d),
    ...(d.memo.trim() === '' ? {} : { memo: d.memo.trim() }),
    ...(d.flag === null ? {} : { flag: d.flag }),
    cleared: d.cleared,
  };
}

/** New transactions in a cash account start cleared (YNAB, CLAUDE.md §4). */
export function defaultCleared(plan: PlanData, accountId: Id): ClearedState {
  return plan.accounts.find((a) => a.id === accountId)?.type === 'cash' ? 'cleared' : 'uncleared';
}

/** The patch that turns `t` into the draft (only what changed; saving approves, as in YNAB). */
export function toPatch(plan: PlanData, t: TransactionRecord, d: TxDraft): TransactionPatch {
  const before = draftFor(t, { accountId: t.accountId, date: t.date });
  const patch: TransactionPatch = {};
  if (d.date !== before.date) patch.date = d.date;
  if (d.accountId !== before.accountId) patch.accountId = d.accountId;
  if (draftAmount(d) !== t.amount && (t.subtransactions?.length ?? 0) === 0) patch.amount = draftAmount(d);
  if (d.transferAccountId !== before.transferAccountId) {
    patch.transferAccountId = d.transferAccountId;
    if (d.transferAccountId === null) {
      if (d.payeeId !== null) patch.payeeId = d.payeeId;
      else if (d.payeeName.trim() !== '') patch.payeeName = d.payeeName.trim();
    }
  } else if (d.transferAccountId === null && (d.payeeId !== before.payeeId || d.payeeName.trim() !== '')) {
    if (d.payeeId !== null) patch.payeeId = d.payeeId;
    else if (d.payeeName.trim() !== '') patch.payeeName = d.payeeName.trim();
    else patch.payeeId = null;
  }
  const category = effectiveCategory(plan, d);
  if ((t.subtransactions?.length ?? 0) === 0 && category !== t.categoryId) patch.categoryId = category;
  if (d.memo.trim() !== (t.memo ?? '')) patch.memo = d.memo.trim() === '' ? null : d.memo.trim();
  if (d.flag !== before.flag) patch.flag = d.flag;
  if (d.cleared !== t.cleared && t.cleared !== 'reconciled') patch.cleared = d.cleared;
  if (t.approved === false) patch.approved = true;
  return patch;
}
