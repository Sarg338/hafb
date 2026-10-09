// Credit cards on screen (S4.7), observed in the YNAB trial (2026-10-08). Pure: engine numbers and
// plan records in, display data out; the money moves themselves are the engine's (§5.3).
// - A payment category's Activity popover: Spending, Returns, Total Spending | Funded Spending,
//   Payments & Returns, Total Activity, then the card's transactions that month.
// - Any other category's Activity popover lists its transactions (split lines at their own amount).
// - The card register's header: "Overspending (Oct)" and "Payment" pills.
// - Record Payment pre-fills the lower of the payment category's Available and the card's cleared debt.
import { CREDIT_ACCOUNT_TYPES, READY_TO_ASSIGN, type BudgetState, type CategoryMonth, type Id } from '@hafb/engine';
import { minor, monthOf, ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import type { AccountRecord, PlanData } from '@hafb/store';

export interface PaymentActivity {
  spending: Minor;
  returns: Minor;
  totalSpending: Minor;
  /** Spending the categories covered, net of returns (YNAB trial: visa spent $80, $20 back → +$60). */
  funded: Minor;
  /** Payments to the card (negative); YNAB's label, though returns are already in Funded Spending. */
  paymentsAndReturns: Minor;
  total: Minor;
}

export function paymentActivity(cm: CategoryMonth): PaymentActivity | null {
  const card = cm.creditCard;
  if (!card) return null;
  return {
    spending: card.spending,
    returns: card.returns,
    totalSpending: minor(card.spending + card.returns),
    funded: card.fundedSpending,
    paymentsAndReturns: minor(0 - card.payments),
    total: cm.activity,
  };
}

/** The inspector's "Current Balance" for a card: Prior Balance + Spending and Outflows + Payments and Inflows. */
export function cardBalance(cm: CategoryMonth): { prior: Minor; spending: Minor; inflows: Minor; current: Minor } | null {
  const card = cm.creditCard;
  if (!card) return null;
  const inflows = card.returns + card.payments;
  return { prior: minor(card.balance - card.spending - inflows), spending: card.spending, inflows: minor(inflows), current: card.balance };
}

/** What the card owes at the end of the month (positive), and what its payment category is short. */
export function paymentGap(cm: CategoryMonth): { owed: Minor; gap: Minor } {
  const owed = cm.creditCard ? Math.max(0, 0 - cm.creditCard.balance) : 0;
  return { owed: minor(owed), gap: minor(Math.max(0, owed - Math.max(0, cm.available))) };
}

export interface ActivityLine {
  /** The transaction, or the split line, this row shows. */
  id: Id;
  transactionId: Id;
  account: string;
  date: ISODate;
  payee: string;
  category: string;
  memo: string;
  amount: Minor;
}

const isCredit = (a: AccountRecord | undefined): boolean => a !== undefined && CREDIT_ACCOUNT_TYPES.includes(a.type);

/** A category's transactions in a month, newest first. A payment category lists its card's activity. */
export function activityLines(plan: PlanData, categoryId: Id, month: Month): ActivityLine[] {
  const accounts = new Map(plan.accounts.filter((a) => a.deletedAt === undefined).map((a) => [a.id, a]));
  const payees = new Map(plan.payees.map((p) => [p.id, p.name]));
  const categories = new Map(plan.categories.map((c) => [c.id, c.name]));
  const paymentCategory = plan.categories.find((c) => c.id === categoryId);
  const cardId = paymentCategory?.creditCardAccountId;
  const nameOf = (ref: Id | null): string => (ref === null ? '' : ref === READY_TO_ASSIGN ? 'Ready to Assign' : (categories.get(ref) ?? ''));
  const transferName = (self: AccountRecord | undefined, otherId: Id): string => {
    const other = accounts.get(otherId);
    const payment = self !== undefined && other !== undefined && self.onBudget && other.onBudget && isCredit(self) !== isCredit(other);
    return `${payment ? 'Payment:' : 'Transfer :'} ${other?.name ?? 'account'}`;
  };
  const out: (ActivityLine & { order: string })[] = [];
  for (const t of plan.transactions) {
    if (t.deletedAt !== undefined || monthOf(t.date) !== month) continue;
    const account = accounts.get(t.accountId);
    if (!account?.onBudget) continue;
    const payee = t.transferAccountId !== undefined ? transferName(account, t.transferAccountId) : t.payeeId === undefined ? '' : (payees.get(t.payeeId) ?? '');
    const base = { transactionId: t.id, account: account.name, date: t.date, order: `${t.date}|${t.createdAt}|${t.id}` };
    const lines = t.subtransactions?.length
      ? t.subtransactions.map((s) => ({ id: s.id, categoryId: s.categoryId, transferAccountId: s.transferAccountId, payee: s.transferAccountId !== undefined ? transferName(account, s.transferAccountId) : s.payeeId !== undefined ? (payees.get(s.payeeId) ?? payee) : payee, memo: s.memo ?? t.memo ?? '', amount: s.amount }))
      : [{ id: t.id, categoryId: t.categoryId, transferAccountId: t.transferAccountId, payee, memo: t.memo ?? '', amount: t.amount }];
    for (const l of lines) {
      if (cardId !== undefined) {
        // The card's own activity: categorized spending and returns, and payments (transfers with
        // another budget account). Starting balances and Ready to Assign inflows are not activity.
        if (t.accountId !== cardId || t.isStartingBalance === true || l.categoryId === READY_TO_ASSIGN) continue;
        const other = l.transferAccountId === undefined ? undefined : accounts.get(l.transferAccountId);
        if (l.categoryId === null && other?.onBudget !== true) continue;
        if (other?.onBudget === true) {
          // YNAB's popover writes a payment as "Transfer : bank" in "Credit Card Payments: visa".
          out.push({ ...base, id: l.id, payee: `Transfer : ${other.name}`, category: `Credit Card Payments: ${paymentCategory?.name ?? ''}`, memo: l.memo, amount: l.amount });
          continue;
        }
      } else if (l.categoryId !== categoryId) {
        continue;
      }
      out.push({ ...base, id: l.id, payee: l.payee, category: nameOf(l.categoryId), memo: l.memo, amount: l.amount });
    }
  }
  return out.sort((a, b) => (a.order < b.order ? 1 : a.order > b.order ? -1 : 0)).map((l) => ({ id: l.id, transactionId: l.transactionId, account: l.account, date: l.date, payee: l.payee, category: l.category, memo: l.memo, amount: l.amount }));
}

/** Record Payment's amount: the lower of the payment category's Available and the card's cleared debt. */
export function recordPaymentAmount(plan: PlanData, state: BudgetState, cardId: Id): Minor {
  const payment = plan.categories.find((c) => c.creditCardAccountId === cardId && c.deletedAt === undefined);
  const available = payment ? (state.byMonth[state.currentMonth]?.categories[payment.id]?.available ?? ZERO) : ZERO;
  const clearedDebt = Math.max(0, 0 - (state.accountBalances[cardId]?.cleared ?? 0));
  return minor(Math.max(0, Math.min(available, clearedDebt)));
}

export interface CardHeader {
  month: Month;
  /** This month's spending on the card that categories did not cover (credit overspending). */
  overspending: Minor;
  /** The payment category's Available this month. */
  payment: Minor;
  /** Available is less than the card owes (YNAB's yellow Payment pill). */
  underfunded: boolean;
}

export function cardHeader(plan: PlanData, state: BudgetState, cardId: Id): CardHeader | null {
  const account = plan.accounts.find((a) => a.id === cardId);
  if (!isCredit(account) || account?.onBudget !== true) return null;
  const payment = plan.categories.find((c) => c.creditCardAccountId === cardId && c.deletedAt === undefined);
  const cm = payment ? state.byMonth[state.currentMonth]?.categories[payment.id] : undefined;
  if (!cm) return null;
  return {
    month: state.currentMonth,
    overspending: cm.creditCard?.unfundedSpending ?? ZERO,
    payment: cm.available,
    underfunded: paymentGap(cm).gap > 0,
  };
}
