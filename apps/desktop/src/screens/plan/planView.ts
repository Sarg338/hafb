// Presentation mapping for the Plan screen: engine numbers in, display state out. No budget math
// here (CLAUDE.md §10): every amount comes from computeBudget / evaluateTargets; this only decides
// which pill colour, message and bar shape YNAB would show for them.
import type { CategoryMonth, Target, TargetMonth } from '@hafb/engine';
import { dateParts, formatMoney, minor, neg, type Minor, type MoneyFormat } from '@hafb/shared';

import type { MoneyState } from '../../ui/moneyState.ts';

export type { MoneyState };

export interface BarView {
  /** One segment per week for weekly targets, otherwise one. */
  segments: number;
  /** 0–100: how much of the target the category holds (assigned + carried, capped). */
  fillPercent: number;
  /** 0–100: the part of the fill already spent (drawn lighter). */
  spentPercent: number;
}

export interface CategoryView {
  state: MoneyState;
  /** The bar's colour: a fully spent, funded target still draws as funded (light = spent). */
  barState: MoneyState;
  /** Overspending happened on a credit card (the pill shows a card icon). */
  credit: boolean;
  /** Upcoming scheduled outflows this month won't be covered (the pill shows a calendar icon). */
  upcoming?: boolean;
  message: string;
  messageTone: 'plain' | 'warn' | 'bad';
  bar?: BarView;
}

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${String(n)}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dueText(target: Target, tm: TargetMonth): string {
  switch (target.cadence.kind) {
    case 'weekly':
      return `each ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][target.cadence.weekday] ?? 'week'}`;
    case 'monthly':
      return target.cadence.day === 'last' ? 'by the end of the month' : `by the ${ordinal(target.cadence.day)}`;
    default: {
      if (tm.dueDate === undefined) return '';
      const p = dateParts(tm.dueDate);
      return `by ${MONTHS[p.month - 1] ?? ''} ${String(p.day)}, ${String(p.year)}`;
    }
  }
}

export function categoryView(cm: CategoryMonth, fmt: MoneyFormat, target?: Target, tm?: TargetMonth): CategoryView {
  const money = (m: Minor): string => formatMoney(m, fmt);
  const credit = cm.overspending.credit > 0;

  if (cm.available < 0) {
    const bar: BarView | undefined = tm ? { segments: 1, fillPercent: 100, spentPercent: 100 } : undefined;
    // YNAB: overspending entirely on credit is yellow (it becomes card debt, not a Ready to Assign
    // shortfall); any cash overspending makes it red.
    const creditOnly = credit && cm.overspending.cash === 0;
    return {
      state: creditOnly ? 'creditOverspent' : 'overspent',
      barState: creditOnly ? 'creditOverspent' : 'overspent',
      credit,
      message: credit ? `Overspent ${money(neg(cm.available))} on credit` : `Overspent ${money(neg(cm.available))}`,
      messageTone: creditOnly ? 'warn' : 'bad',
      ...(bar ? { bar } : {}),
    };
  }
  if (!target || !tm || tm.status === 'inactive') {
    const state = cm.available > 0 ? 'funded' : 'zero';
    return { state, barState: state, credit: false, message: '', messageTone: 'plain' };
  }

  const segments = target.cadence.kind === 'weekly' && target.amount > 0 ? Math.max(1, Math.round(tm.needed / target.amount)) : 1;
  const spent = Math.max(0, 0 - cm.activity);
  const held = tm.funded;
  const fillPercent = tm.needed > 0 ? Math.min(100, (held / tm.needed) * 100) : 100;
  const spentPercent = tm.needed > 0 ? Math.min(fillPercent, (spent / tm.needed) * 100) : 0;
  const bar: BarView = { segments, fillPercent, spentPercent };

  if (tm.status === 'snoozed') return { state: 'snoozed', barState: 'snoozed', credit: false, message: 'Snoozed this month', messageTone: 'plain', bar };
  if (tm.underfunded > 0) {
    const due = dueText(target, tm);
    return {
      state: 'underfunded',
      barState: 'underfunded',
      credit: false,
      message: `${money(tm.underfunded)} more needed${due ? ` ${due}` : ''}`,
      messageTone: 'warn',
      bar,
    };
  }
  const funded = tm.status === 'funded' || tm.toGo === 0;
  return {
    state: cm.available > 0 ? 'funded' : 'zero',
    barState: 'funded',
    credit: false,
    message: funded ? (spent > 0 && cm.available === 0 ? 'Fully spent' : 'Funded') : 'On track',
    messageTone: 'plain',
    bar,
  };
}

/**
 * A credit card payment category (YNAB trial, 2026-10-08): in the current month, holding less than the
 * card owes is underfunded (yellow; amex owed $50 with $40 set aside); otherwise it reads like any
 * category. A payment category below zero (overpaid) is cash overspending.
 */
export function paymentView(cm: CategoryMonth, fmt: MoneyFormat, currentMonth: boolean): CategoryView {
  if (cm.available < 0) return categoryView(cm, fmt);
  const owed = cm.creditCard ? Math.max(0, 0 - cm.creditCard.balance) : 0;
  const gap = owed - cm.available;
  if (currentMonth && gap > 0) {
    const unfunded = cm.creditCard?.unfundedSpending ?? 0;
    return {
      state: 'underfunded',
      barState: 'underfunded',
      credit: false,
      message: unfunded > 0 ? `Cover ${formatMoney(minor(unfunded), fmt)} in overspent categories` : `${formatMoney(minor(gap), fmt)} more needed to pay off the balance`,
      messageTone: 'warn',
    };
  }
  return categoryView(cm, fmt);
}

/**
 * Upcoming scheduled transactions this month (§5.11, YNAB trial): when Available won't cover them, the
 * pill turns yellow with a calendar icon (Utilities: $0.00 with a $15 bill due on the 20th). An
 * overspent category stays overspent; its message notes the bill.
 */
export function upcomingView(view: CategoryView, cm: CategoryMonth, upcoming: Minor, fmt: MoneyFormat): CategoryView {
  const after = cm.available + upcoming;
  if (after >= 0) return view;
  const short = formatMoney(minor(0 - after), fmt);
  if (cm.available < 0) return { ...view, upcoming: true };
  return { ...view, state: 'underfunded', barState: view.bar ? 'underfunded' : view.barState, upcoming: true, message: `${short} more needed for upcoming transactions`, messageTone: 'warn' };
}

/** "Refill up to $140.00 each month by the 20th": the inspector's one-line target summary. */
export function targetSentence(target: Target, tm: TargetMonth | undefined, fmt: MoneyFormat): string {
  const amount = formatMoney(target.amount, fmt);
  const due = tm ? dueText(target, tm) : '';
  const lead =
    target.behavior === 'refill' ? `Refill up to ${amount}` : target.behavior === 'setAside' ? `Set aside ${amount}` : `Have a balance of ${amount}`;
  const every =
    target.cadence.kind === 'weekly' ? '' : target.cadence.kind === 'monthly' ? ' each month' : target.cadence.kind === 'yearly' ? ' each year' : '';
  return `${lead}${every}${due ? ` ${due}` : ''}`;
}
