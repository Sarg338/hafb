// Register search suggestions (R-14): what YNAB's search box lists while you type (web app,
// trial, 2026-10-12). For a word: matching categories and accounts, the Is: states when the word
// starts "is", then "Find … in any field / the Payee / the Category / the Memo". For a number: the
// Income: hint, then Outflow and Inflow equal / more or equal / less or equal, then the Find rows.
// Payees are not suggested by name (YNAB doesn't either). Choosing one replaces the term being
// typed and adds a comma, ready for the next criterion.
import type { PlanData } from '@hafb/store';
import { monthOf, monthParts, type ISODate } from '@hafb/shared';

export interface SearchSuggestion {
  id: string;
  /** The criterion it adds, as YNAB labels the row ("Category:", "Outflow:", "Is:"); '' for any field. */
  key: string;
  text: string;
  /** The whole search text after choosing it. */
  value: string;
}

/** YNAB's Is: rows, in its order. */
export const IS_STATES = ['Uncleared', 'Cleared', 'Reconciled', 'Unreconciled', 'Cleared or Reconciled', 'Matched', 'Approved', 'Unapproved', 'Needs Category', 'Unapproved or Needs Category'] as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AMOUNT = /^\$?\d[\d,]*(\.\d+)?$/;
const MAX_NAMES = 8;

export function searchSuggestions(plan: PlanData, text: string, today: ISODate, money: (amountText: string) => string | null): SearchSuggestion[] {
  const cut = text.lastIndexOf(',');
  const before = cut < 0 ? '' : `${text.slice(0, cut + 1).trimEnd()} `;
  const term = text.slice(cut + 1).trim();
  if (term === '') return [];
  const lower = term.toLowerCase();
  const pick = (insert: string): string => `${before}${insert}, `;
  const out: SearchSuggestion[] = [];
  const add = (key: string, shown: string, value: string): void => {
    out.push({ id: `${String(out.length)}:${value}`, key, text: shown, value });
  };

  const colon = term.indexOf(':');
  if (colon >= 0) {
    // Typing a criterion's value: offer the names that fit it.
    const key = term.slice(0, colon).trim().toLowerCase();
    const v = term.slice(colon + 1).trim().toLowerCase();
    if (key === 'category') for (const name of categoryNames(plan, v)) add('Category:', name, pick(`Category: ${name}`));
    if (key === 'account') for (const name of accountNames(plan, v)) add('Account:', name, pick(`Account: ${name}`));
    if (key === 'is') for (const s of IS_STATES) if (s.toLowerCase().includes(v)) add('Is:', s, pick(`Is: ${s}`));
    return out;
  }

  const shownAmount = AMOUNT.test(term) ? money(term.replace(/^\$/, '').replace(/,/g, '')) : null;
  if (shownAmount !== null) {
    const month = monthParts(monthOf(today));
    add('Income:', `Enter month like ‘Income: ${MONTHS[month.month - 1] ?? ''} ${String(month.year)}’`, `${before}Income: `);
    const n = term.replace(/^\$/, '').replace(/,/g, '');
    for (const dir of ['Outflow', 'Inflow'] as const) {
      add(`${dir}:`, `${dir} equals ${shownAmount}`, pick(`${dir}: ${n}`));
      add(`${dir}:`, `${dir} more or equal to ${shownAmount}`, pick(`${dir}: >=${n}`));
      add(`${dir}:`, `${dir} less or equal to ${shownAmount}`, pick(`${dir}: <=${n}`));
    }
  } else {
    for (const name of categoryNames(plan, lower)) add('Category:', name, pick(`Category: ${name}`));
    for (const name of accountNames(plan, lower)) add('Account:', name, pick(`Account: ${name}`));
    if (lower.startsWith('is')) {
      const rest = lower.slice(2).replace(/^:/, '').trim();
      for (const s of IS_STATES) if (s.toLowerCase().includes(rest)) add('Is:', s, pick(`Is: ${s}`));
    }
  }
  add('', `Find “${term}” in any field`, pick(term));
  add('Payee:', `Find “${term}” in the Payee`, pick(`Payee: ${term}`));
  add('Category:', `Find “${term}” in the Category`, pick(`Category: ${term}`));
  add('Memo:', `Find “${term}” in the Memo`, pick(`Memo: ${term}`));
  return out;
}

function categoryNames(plan: PlanData, needle: string): string[] {
  const names = plan.categories.filter((c) => c.deletedAt === undefined && c.name.toLowerCase().includes(needle)).map((c) => c.name);
  return [...new Set(names)].slice(0, MAX_NAMES);
}

function accountNames(plan: PlanData, needle: string): string[] {
  return plan.accounts.filter((a) => a.deletedAt === undefined && a.name.toLowerCase().includes(needle)).map((a) => a.name).slice(0, MAX_NAMES);
}
