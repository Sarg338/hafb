// YNAB export rows → engine snapshot. Pure. Used by the golden test now and by
// `pnpm import:ynab` / the in-app importer in Phase 2 (S2.4).
import { compareDates, compareMonths, minor, type ISODate, type Minor, type Month } from '@hafb/shared';
import {
  isCreditAccountType,
  READY_TO_ASSIGN,
  type Account,
  type AccountType,
  type Assignment,
  type BudgetSnapshot,
  type Category,
  type CategoryGroup,
  type CategoryRef,
  type Id,
  type Subtransaction,
  type Transaction,
} from '../model.ts';
import type { YnabPlanRow, YnabRegisterRow } from './csv.ts';

export const CREDIT_CARD_PAYMENTS_GROUP = 'Credit Card Payments';
export const HIDDEN_CATEGORIES_GROUP = 'Hidden Categories';
const TRANSFER_PREFIX = 'Transfer : ';
/** "Split (2/3) memo" → line 2 of 3. */
const SPLIT_MEMO = /^Split \((\d+)\/(\d+)\)\s?/;

export interface YnabImportOptions {
  /** The export's "today": register rows after it are upcoming scheduled transactions. */
  today: ISODate;
  /** Force an account's type by name (the export does not record account types). */
  accountTypes?: Readonly<Record<string, AccountType>>;
}

export interface InferredAccount {
  name: string;
  type: AccountType;
  onBudget: boolean;
  reason: string;
}

export interface YnabImportResult {
  snapshot: BudgetSnapshot;
  /** Register rows dated after `today`. YNAB exports upcoming scheduled transactions too. */
  scheduled: YnabRegisterRow[];
  accounts: InferredAccount[];
  /** "Group: Category" → category id. */
  categoryIds: Record<string, Id>;
  /**
   * The register rows behind each transaction (one row, or a split's lines in order), so importers
   * can recover what the snapshot doesn't carry: payee names, flags, memos.
   */
  sourceRows: Record<Id, readonly YnabRegisterRow[]>;
  warnings: string[];
}

export const accountId = (name: string): Id => `acct:${name}`;
export const categoryId = (key: string): Id => `cat:${key}`;
const groupId = (name: string): Id => `grp:${name}`;

function isRtaKey(group: string): boolean {
  // "Inflow: Ready to Assign" (older exports: "Inflow: To be Budgeted").
  return group === 'Inflow';
}

export function ynabExportToSnapshot(
  planRows: readonly YnabPlanRow[],
  registerRows: readonly YnabRegisterRow[],
  options: YnabImportOptions,
): YnabImportResult {
  const warnings: string[] = [];
  const current = registerRows.filter((r) => compareDates(r.date, options.today) <= 0);
  const scheduled = registerRows.filter((r) => compareDates(r.date, options.today) > 0);

  // ---- categories and groups (plan order) --------------------------------------------------
  const groups: CategoryGroup[] = [];
  const categories: Category[] = [];
  const categoryIds: Record<string, Id> = {};
  const seenGroups = new Set<string>();
  const cardNames = new Set<string>();
  const addCategory = (key: string, group: string, name: string): void => {
    if (categoryIds[key] !== undefined) return;
    if (!seenGroups.has(group)) {
      seenGroups.add(group);
      groups.push({ id: groupId(group), name: group, ...(group === HIDDEN_CATEGORIES_GROUP ? { hidden: true } : {}) });
    }
    categoryIds[key] = categoryId(key);
    const category: Category = { id: categoryId(key), groupId: groupId(group), name };
    if (group === HIDDEN_CATEGORIES_GROUP) category.hidden = true;
    if (group === CREDIT_CARD_PAYMENTS_GROUP) {
      category.creditCardAccountId = accountId(name);
      cardNames.add(name);
    }
    categories.push(category);
  };
  for (const r of planRows) addCategory(r.key, r.group, r.category);
  for (const r of current) {
    if (r.key !== '' && !isRtaKey(r.group) && categoryIds[r.key] === undefined) {
      warnings.push(`Category "${r.key}" appears in the register but not in the plan; added.`);
      addCategory(r.key, r.group, r.category);
    }
  }

  // ---- accounts ---------------------------------------------------------------------------------
  const names: string[] = [];
  const categorized = new Set<string>();
  const balance = new Map<string, number>();
  for (const r of registerRows) {
    if (!names.includes(r.account)) names.push(r.account);
    if (r.key !== '') categorized.add(r.account);
    balance.set(r.account, (balance.get(r.account) ?? 0) + r.amount);
  }
  for (const card of cardNames) if (!names.includes(card)) names.push(card);
  const inferred: InferredAccount[] = names.map((name) => {
    const forced = options.accountTypes?.[name];
    if (forced !== undefined) {
      const onBudget = forced === 'checking' || forced === 'savings' || forced === 'cash' || isCreditAccountType(forced);
      return { name, type: forced, onBudget, reason: 'set by import options' };
    }
    if (cardNames.has(name)) return { name, type: 'creditCard', onBudget: true, reason: 'has a Credit Card Payments category' };
    if (categorized.has(name)) return { name, type: 'checking', onBudget: true, reason: 'has categorized transactions' };
    const type: AccountType = (balance.get(name) ?? 0) < 0 ? 'liability' : 'asset';
    return { name, type, onBudget: false, reason: 'no categorized transactions (off-budget)' };
  });
  const accounts: Account[] = inferred.map((a) => ({ id: accountId(a.name), name: a.name, type: a.type, onBudget: a.onBudget }));
  const accountNames = new Set(names);
  // A forced non-credit type drops the payment link.
  for (const c of categories) {
    if (c.creditCardAccountId === undefined) continue;
    const acct = accounts.find((a) => a.id === c.creditCardAccountId);
    if (!acct || !isCreditAccountType(acct.type)) {
      delete c.creditCardAccountId;
      warnings.push(`"${c.name}" is in Credit Card Payments but its account is not a credit account; kept as a normal category.`);
    }
  }

  // ---- transactions -----------------------------------------------------------------------------
  const toLine = (r: YnabRegisterRow) => {
    const counterpart = r.payee.startsWith(TRANSFER_PREFIX) ? r.payee.slice(TRANSFER_PREFIX.length) : undefined;
    let ref: CategoryRef = null;
    if (r.key !== '') ref = isRtaKey(r.group) ? READY_TO_ASSIGN : categoryIds[r.key] ?? null;
    const transfer = counterpart !== undefined && accountNames.has(counterpart) ? accountId(counterpart) : undefined;
    return { counterpart, ref, transfer };
  };
  // YNAB exports each split line as its own row with a "Split (k/n) " memo prefix (verified in
  // Sarg's trial export, 2026-10-08). Recombine them into one transaction with subtransactions:
  // a split is one transaction for Age of Money and the register.
  const transactions: Transaction[] = [];
  const sourceRows: Record<Id, readonly YnabRegisterRow[]> = {};
  for (let i = 0; i < current.length; i += 1) {
    const r = current[i];
    if (!r) continue;
    const split = SPLIT_MEMO.exec(r.memo);
    const n = split ? Number(split[2]) : 0;
    const parts = split?.[1] === '1' ? current.slice(i, i + n) : [];
    const isSplit =
      n > 1 &&
      parts.length === n &&
      parts.every((p, k) => p.account === r.account && p.date === r.date && SPLIT_MEMO.exec(p.memo)?.[1] === String(k + 1) && SPLIT_MEMO.exec(p.memo)?.[2] === String(n));
    if (isSplit) {
      let total = 0;
      const subtransactions: Subtransaction[] = parts.map((p, k) => {
        total += p.amount;
        const l = toLine(p);
        const memo = p.memo.replace(SPLIT_MEMO, '').trim();
        return {
          id: `txn:${String(i)}:${String(k + 1)}`,
          amount: p.amount,
          categoryId: l.ref,
          ...(l.transfer === undefined ? {} : { transferAccountId: l.transfer }),
          ...(memo === '' ? {} : { memo }),
        };
      });
      sourceRows[`txn:${String(i)}`] = parts;
      transactions.push({
        id: `txn:${String(i)}`,
        accountId: accountId(r.account),
        date: r.date,
        amount: minor(total),
        categoryId: null,
        cleared: r.cleared,
        subtransactions,
      });
      i += n - 1;
      continue;
    }
    const l = toLine(r);
    const tx: Transaction = {
      id: `txn:${String(i)}`,
      accountId: accountId(r.account),
      date: r.date,
      amount: r.amount,
      categoryId: l.ref,
      cleared: r.cleared,
      ...(r.memo === '' ? {} : { memo: r.memo }),
      ...(r.payee === 'Starting Balance' && l.counterpart === undefined ? { isStartingBalance: true } : {}),
    };
    if (l.transfer !== undefined) tx.transferAccountId = l.transfer;
    sourceRows[tx.id] = [r];
    transactions.push(tx);
  }

  // ---- assignments ------------------------------------------------------------------------------
  const assignments: Assignment[] = [];
  let firstMonth: Month | undefined;
  for (const r of planRows) {
    if (firstMonth === undefined || compareMonths(r.month, firstMonth) < 0) firstMonth = r.month;
    if (r.assigned !== 0) {
      const id = categoryIds[r.key];
      if (id !== undefined) assignments.push({ month: r.month, categoryId: id, assigned: r.assigned });
    }
  }

  return {
    snapshot: {
      settings: { currencyDecimals: 2, ...(firstMonth === undefined ? {} : { firstMonth }) },
      accounts,
      categoryGroups: groups,
      categories,
      transactions,
      assignments,
    },
    scheduled: [...scheduled],
    accounts: inferred,
    categoryIds,
    sourceRows,
    warnings,
  };
}

/** Sum helper for callers comparing totals. */
export function total(rows: readonly { amount: Minor }[]): Minor {
  let t = 0;
  for (const r of rows) t += r.amount;
  return minor(t);
}
