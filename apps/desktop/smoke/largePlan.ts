// The performance budget's plan (CLAUDE.md §8, S8.1): five years, 100 categories and 20,000
// transactions, ending on `today`. Built with the real store commands so it looks like a plan
// someone used: paychecks, card spending and payments, transfers, splits, memos, flags, targets,
// loans, reconciled history, scheduled bills, and an assignment for every category every month.
// Deterministic for a given `today`.
import { addMonths, makeDate, minor, monthOf, monthParts, uuidv7Generator, type ISODate, type Minor, type Month } from '@hafb/shared';
import type { Id, Target } from '@hafb/engine';
import {
  addScheduled,
  addTransaction,
  applyChanges,
  createAccount,
  createCategory,
  createGroup,
  editAccount,
  newPlan,
  setAssigned,
  setCleared,
  setTarget,
  type ChangeSet,
  type Command,
  type CommandContext,
  type PlanData,
  type TransactionInput,
  type TransactionRecord,
} from '@hafb/store';

export const LARGE_PLAN_TRANSACTIONS = 20_000;
const MONTHS = 60;

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUPS: [string, string[]][] = [
  ['Bills', ['Rent or Mortgage', 'Electric', 'Water', 'Gas Utility', 'Internet', 'Phone', 'Trash', 'Streaming', 'Software', 'Gym']],
  ['Everyday', ['Groceries', 'Dining Out', 'Coffee', 'Fuel', 'Transit', 'Household', 'Toiletries', 'Laundry', 'Parking', 'Snacks']],
  ['Kids', ['Childcare', 'School Lunch', 'School Supplies', 'Allowance', 'Activities', 'Kids Clothing', 'Toys', 'Babysitting', 'Field Trips', 'Tutoring']],
  ['Home', ['Home Repairs', 'Furniture', 'Garden', 'Cleaning', 'Appliances', 'Decor', 'Tools', 'Pest Control', 'HOA', 'Home Insurance']],
  ['Health', ['Medical', 'Dental', 'Vision', 'Pharmacy', 'Therapy', 'Health Insurance', 'Vitamins', 'Fitness Gear', 'Copays', 'HSA Top-up']],
  ['Transport', ['Car Payment', 'Car Insurance', 'Car Maintenance', 'Registration', 'Tolls', 'Rideshare', 'Car Wash', 'Tires', 'Roadside', 'Bike']],
  ['True Expenses', ['Gifts', 'Holidays', 'Clothing', 'Subscriptions', 'Annual Fees', 'Taxes', 'Charity', 'Birthdays', 'Weddings', 'Postage']],
  ['Pets', ['Pet Food', 'Vet', 'Grooming', 'Pet Insurance', 'Boarding', 'Pet Supplies', 'Training', 'Pet Meds', 'Pet Toys', 'Licenses']],
  ['Fun', ['Entertainment', 'Hobbies', 'Books', 'Games', 'Music', 'Concerts', 'Sports', 'Crafts', 'Photography', 'Outings']],
  ['Goals', ['Emergency Fund', 'Vacation', 'New Car', 'Laptop', 'Home Projects', 'Education', 'Retirement Extra', 'Moving', 'Wedding Fund', 'Rainy Day']],
];

const PAYEES = [
  'Fresh Market', 'Corner Grocery', 'Big Box Store', 'QuickFuel', 'City Transit', 'Blue Door Café', 'Taco Stand', 'Pho 99', 'Luigi’s Trattoria', 'Bean There',
  'HomeGoods Depot', 'Hardware Hub', 'Garden Center', 'Pet Pantry', 'Valley Clinic', 'Smile Dental', 'Corner Pharmacy', 'Cinema 8', 'Book Nook', 'Game Vault',
  'Online Market', 'Style Outlet', 'AutoCare Plus', 'Tire Town', 'City Power', 'Metro Water', 'FiberNet', 'Northwind Mobile', 'StreamBox', 'Cloud Apps',
];

export interface LargePlan {
  plan: PlanData;
  /** The number of live transactions (the budget counts starting balances too). */
  transactions: number;
}

/** A 20,000-transaction plan whose last month is `today`'s. */
export function buildLargePlan(today: ISODate, count = LARGE_PLAN_TRANSACTIONS): LargePlan {
  const rand = seeded(8_1_2026);
  let clock = Date.UTC(2026, 0, 1);
  const newId = uuidv7Generator(
    () => (clock += 1),
    (n) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256)),
  );
  const now = new Date(clock).toISOString();
  const ctx: CommandContext = { now, today, newId };
  const last = monthOf(today);
  const first = addMonths(last, -(MONTHS - 1));
  const day = (m: Month, d: number): ISODate => {
    const { year, month } = monthParts(m);
    const date = makeDate(year, month, d);
    return date > today ? today : date;
  };
  const cents = (lo: number, hi: number): Minor => minor(Math.round((lo + rand() * (hi - lo)) * 100));
  const pick = <T>(list: readonly T[]): T => {
    const v = list[Math.floor(rand() * list.length)];
    if (v === undefined) throw new Error('empty list');
    return v;
  };

  let plan = newPlan(
    {
      name: 'Large Household',
      currencyCode: 'USD',
      currencyDecimals: 2,
      currencySymbol: '$',
      symbolPlacement: 'before',
      numberFormat: '123,456.78',
      dateFormat: 'MM/DD/YYYY',
      firstMonth: first,
      expectedIncome: minor(1_200_000),
      createdAt: now,
    },
    ctx,
  );
  const run = <C extends Command>(build: (p: PlanData) => C): C => {
    const cmd = build(plan);
    plan = applyChanges(plan, cmd.changes).plan;
    return cmd;
  };

  // ---- accounts ---------------------------------------------------------------------------------
  const start = day(first, 1);
  // Added when the plan began, so the loans have been charged every month since.
  const account = (name: string, type: Parameters<typeof createAccount>[2]['type'], balance: number): Id =>
    run((p) => createAccount(p, { ...ctx, today: start }, { name, type, startingBalance: minor(balance * 100), date: start })).accountId;
  const checking = account('Everyday Checking', 'checking', 6_000);
  const savings = account('Savings', 'savings', 15_000);
  const wallet = account('Wallet', 'cash', 200);
  const cards = [account('Visa Rewards', 'creditCard', -1_200), account('Store Card', 'creditCard', -300), account('Travel Card', 'creditCard', 0)];
  const mortgage = account('Home Mortgage', 'mortgage', -310_000);
  const carLoan = account('Car Loan', 'autoLoan', -24_000);
  account('Retirement 401(k)', 'asset', 42_000);
  run((p) => editAccount(p, ctx, { accountId: checking, starred: true }));
  run((p) => editAccount(p, ctx, { accountId: mortgage, loan: { interestRateBps: 525, minimumPayment: minor(210_000), escrow: minor(45_000) } }));

  // ---- categories and targets -------------------------------------------------------------------
  const categories: Id[] = [];
  for (const [groupName, names] of GROUPS) {
    const groupId = run((p) => createGroup(p, ctx, { name: groupName })).groupId;
    for (const name of names) categories.push(run((p) => createCategory(p, ctx, { groupId, name })).categoryId);
  }
  const cat = (i: number): Id => {
    const v = categories[i];
    if (v === undefined) throw new Error(`category ${String(i)}`);
    return v;
  };
  // Typical monthly spend per category (dollars); the Goals group only saves.
  const budget = categories.map((_, i) => (i >= 90 ? 0 : i < 10 ? 60 + Math.floor(rand() * 140) : 15 + Math.floor(rand() * 120)));
  for (let i = 0; i < 100; i++) {
    const amount = minor(((budget[i] ?? 0) || 200) * 100);
    const cadences: [Target['cadence'], Target['behavior']][] = [
      [{ kind: 'monthly', day: 'last' }, 'refill'],
      [{ kind: 'monthly', day: 1 + (i % 28) }, 'setAside'],
      [{ kind: 'weekly', weekday: i % 7 }, 'refill'],
    ];
    if (i % 3 === 2) continue;
    if (i >= 90) run((p) => setTarget(p, ctx, { categoryId: cat(i), amount: minor(amount * 30), cadence: { kind: 'custom' }, behavior: 'haveBalance' }));
    else {
      const [cadence, behavior] = cadences[i % 3] ?? [{ kind: 'monthly', day: 'last' }, 'refill'];
      run((p) => setTarget(p, ctx, { categoryId: cat(i), amount, cadence, behavior }));
    }
  }

  // ---- payees: one first purchase each, so later transactions can name them by id --------------
  const payeeIds: Id[] = [];
  for (const name of PAYEES) {
    const cmd = run((p) => addTransaction(p, ctx, { accountId: checking, date: day(first, 2), payeeName: name, categoryId: cat(10), amount: cents(-40, -5) }));
    const t = plan.transactions.find((x) => x.id === cmd.transactionId);
    if (t?.payeeId !== undefined) payeeIds.push(t.payeeId);
  }
  const employer = run((p) => addTransaction(p, ctx, { accountId: checking, date: day(first, 1), payeeName: 'Acme Logistics', categoryId: 'ready-to-assign', amount: minor(560_000), memo: 'Paycheck' }));
  const employerId = plan.transactions.find((x) => x.id === employer.transactionId)?.payeeId;

  // ---- the bulk: commands against the structure above, applied as one change set ----------------
  // Transactions don't depend on each other, so building them all against the same plan and
  // applying once keeps generation linear. (Payee default categories don't learn from these.)
  const base = plan;
  const puts: TransactionRecord[] = [];
  const add = (input: TransactionInput): void => {
    const cmd = addTransaction(base, ctx, input);
    for (const t of cmd.changes.put?.transactions ?? []) puts.push(t);
  };
  const made = plan.transactions.length;
  for (let m = 0; m < MONTHS; m++) {
    const month = addMonths(first, m);
    const isLast = month === last;
    const dates = (d: number): ISODate | null => {
      const date = day(month, d);
      return isLast && Number(date.slice(8)) < d ? null : date;
    };
    for (const d of [1, 15]) {
      const date = dates(d);
      if (date && !(m === 0 && d === 1) && employerId !== undefined) add({ accountId: checking, date, payeeId: employerId, categoryId: 'ready-to-assign', amount: minor(560_000), memo: 'Paycheck', cleared: 'cleared' });
    }
    const transfers: [number, Id, Id, number, Id | undefined][] = [
      [1, checking, mortgage, 2_100, cat(0)],
      [5, checking, carLoan, 420, cat(50)],
      [16, checking, savings, 400, undefined],
    ];
    for (const [d, from, to, dollars, category] of transfers) {
      const date = dates(d);
      if (date) add({ accountId: from, date, transferAccountId: to, amount: minor(-dollars * 100), cleared: 'cleared', ...(category ? { categoryId: category } : {}) });
    }
    cards.forEach((card, k) => {
      const date = dates(24 + k);
      if (date) add({ accountId: checking, date, transferAccountId: card, amount: cents(-1_700, -1_000), cleared: 'cleared' });
    });
  }
  // Everyday spending fills the rest, spread over the months (one record each, splits included).
  while (made + puts.length < count) {
    const month = addMonths(first, Math.floor(rand() * MONTHS));
    const isLast = month === last;
    const date = day(month, 1 + Math.floor(rand() * 28));
    const roll = rand();
    const accountId = roll < 0.55 ? pick(cards) : roll < 0.95 ? checking : wallet;
    const i = Math.floor(rand() * 90);
    const typical = budget[i] ?? 50;
    // About 3.6 purchases per category a month, so each is about a quarter of the month's spend.
    const amount = minor(-Math.max(100, Math.round(rand() * typical * 55)));
    const extra: Partial<TransactionInput> = {
      ...(rand() < 0.08 ? { memo: pick(['Weekly shop', 'Refill', 'Birthday', 'Split with friends', 'Return later', 'Online order']) } : {}),
      ...(rand() < 0.03 ? { flag: pick(['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const) } : {}),
      ...(isLast && rand() < 0.3 ? { cleared: 'uncleared' as const, approved: rand() < 0.5 } : { cleared: 'cleared' as const }),
    };
    if (rand() < 0.04) {
      const a = minor(Math.round(amount * 0.5));
      const b = minor(Math.round(amount * 0.3));
      add({
        accountId, date, payeeId: pick(payeeIds), amount, ...extra,
        subtransactions: [
          { amount: a, categoryId: cat(i) },
          { amount: b, categoryId: cat((i + 7) % 90), memo: 'Part two' },
          { amount: minor(amount - a - b), categoryId: cat((i + 13) % 90) },
        ],
      });
    } else if (rand() < 0.02) {
      add({ accountId, date, payeeId: pick(payeeIds), amount: minor(0 - amount), categoryId: cat(i), memo: 'Refund', ...extra });
    } else {
      add({ accountId, date, payeeId: pick(payeeIds), amount, categoryId: cat(i), ...extra });
    }
  }
  plan = applyChanges(plan, { put: { transactions: puts } }).plan;

  // Everything before the last two months is reconciled; the last two are cleared or not.
  const cutoff = day(addMonths(last, -1), 1);
  const old = plan.transactions.filter((t) => t.date < cutoff && t.cleared !== 'uncleared').map((t) => t.id);
  run((p) => setCleared(p, ctx, { transactionIds: old, cleared: 'reconciled' }));

  // ---- assignments: roughly what each category spends, savings to the goals ----------------------
  const assignments: ChangeSet = { put: { assignments: [] } };
  const list = [];
  for (let m = 0; m < MONTHS; m++) {
    const month = addMonths(first, m);
    for (let i = 0; i < 100; i++) {
      const loan = i === 0 ? 2_100 : i === 50 ? 420 : 0;
      const dollars = i >= 90 ? 40 + Math.floor(rand() * 60) : loan + Math.round((budget[i] ?? 50) * (0.9 + rand() * 0.3));
      list.push(setAssigned(plan, ctx, { month, categoryId: cat(i), amount: minor(dollars * 100) }).changes.put?.assignments ?? []);
    }
  }
  assignments.put = { assignments: list.flat() };
  plan = applyChanges(plan, assignments).plan;

  // ---- scheduled: next bills, after today -------------------------------------------------------
  const { year, month } = monthParts(addMonths(last, 1));
  run((p) => addScheduled(p, ctx, { accountId: checking, date: makeDate(year, month, 1), frequency: 'twiceAMonth', payeeName: 'Acme Logistics', categoryId: 'ready-to-assign', amount: minor(560_000), memo: 'Paycheck' }));
  run((p) => addScheduled(p, ctx, { accountId: checking, date: makeDate(year, month, 1), frequency: 'monthly', transferAccountId: mortgage, categoryId: cat(0), amount: minor(-210_000) }));
  run((p) => addScheduled(p, ctx, { accountId: cards[0] ?? checking, date: makeDate(year, month, 12), frequency: 'monthly', payeeName: 'StreamBox', categoryId: cat(7), amount: minor(-1_899) }));

  return { plan, transactions: plan.transactions.filter((t) => t.deletedAt === undefined).length };
}
