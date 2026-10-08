// Test-only snapshot builder. Amounts are integer cents.
import { asISODate, minor, type Month } from '@hafb/shared';
import {
  READY_TO_ASSIGN,
  type Account,
  type AccountType,
  type Assignment,
  type BudgetSnapshot,
  type Category,
  type CategoryRef,
  type ClearedState,
  type Id,
  type Subtransaction,
  type Transaction,
} from '../src/index.ts';

export class PlanBuilder {
  private readonly accounts: Account[] = [];
  private readonly categories: Category[] = [];
  private readonly transactions: Transaction[] = [];
  private readonly assignments: Assignment[] = [];
  private seq = 0;

  constructor(private readonly firstMonth?: Month) {}

  private nextId(prefix: string): Id {
    this.seq += 1;
    return `${prefix}${String(this.seq)}`;
  }

  account(id: Id, type: AccountType = 'checking', onBudget = true): this {
    this.accounts.push({ id, name: id, type, onBudget });
    return this;
  }

  /** Adds an on-budget credit card and its payment category `pay:<id>`. */
  card(id: Id, type: AccountType = 'creditCard'): this {
    this.account(id, type, true);
    this.categories.push({ id: `pay:${id}`, groupId: 'ccp', name: id, creditCardAccountId: id });
    return this;
  }

  category(...ids: Id[]): this {
    for (const id of ids) this.categories.push({ id, groupId: 'g', name: id });
    return this;
  }

  txn(
    date: string,
    accountId: Id,
    amount: number,
    categoryId: CategoryRef,
    extra: { transferAccountId?: Id; cleared?: ClearedState; subtransactions?: Subtransaction[]; deleted?: boolean } = {},
  ): this {
    this.transactions.push({
      id: this.nextId('t'),
      accountId,
      date: asISODate(date),
      amount: minor(amount),
      categoryId,
      cleared: extra.cleared ?? 'cleared',
      ...(extra.transferAccountId === undefined ? {} : { transferAccountId: extra.transferAccountId }),
      ...(extra.subtransactions === undefined ? {} : { subtransactions: extra.subtransactions }),
      ...(extra.deleted === undefined ? {} : { deleted: extra.deleted }),
    });
    return this;
  }

  income(date: string, amount: number, accountId: Id = 'checking'): this {
    return this.txn(date, accountId, amount, READY_TO_ASSIGN);
  }

  spend(date: string, amount: number, categoryId: Id, accountId: Id = 'checking'): this {
    return this.txn(date, accountId, -amount, categoryId);
  }

  /** Two transfer legs: `amount` leaves `from` and arrives in `to`. */
  transfer(date: string, amount: number, from: Id, to: Id, fromCategory: CategoryRef = null): this {
    this.txn(date, from, -amount, fromCategory, { transferAccountId: to });
    return this.txn(date, to, amount, null, { transferAccountId: from });
  }

  split(date: string, accountId: Id, parts: { amount: number; categoryId: CategoryRef; transferAccountId?: Id }[]): this {
    const subs: Subtransaction[] = parts.map((p) => ({
      id: this.nextId('s'),
      amount: minor(p.amount),
      categoryId: p.categoryId,
      ...(p.transferAccountId === undefined ? {} : { transferAccountId: p.transferAccountId }),
    }));
    const total = parts.reduce((s, p) => s + p.amount, 0);
    return this.txn(date, accountId, total, null, { subtransactions: subs });
  }

  assign(month: Month, categoryId: Id, amount: number): this {
    this.assignments.push({ month, categoryId, assigned: minor(amount) });
    return this;
  }

  build(): BudgetSnapshot {
    return {
      settings: { currencyDecimals: 2, ...(this.firstMonth === undefined ? {} : { firstMonth: this.firstMonth }) },
      accounts: this.accounts,
      categoryGroups: [
        { id: 'g', name: 'Everyday' },
        { id: 'ccp', name: 'Credit Card Payments' },
      ],
      categories: this.categories,
      transactions: this.transactions,
      assignments: this.assignments,
    };
  }
}

export function plan(firstMonth?: Month): PlanBuilder {
  return new PlanBuilder(firstMonth);
}
