// A synthetic household for the S3.1 mockups (labelled "sample data" on screen). Built with the
// real Phase 2 commands and computed by the real engine, so every number on the mockups is one
// the app would show. Deterministic: fixed clock, seeded ids and amounts.
import type { Id, Target } from '@hafb/engine';
import { makeDate, minor, monthOf, monthParts, uuidv7Generator, type ISODate, type Minor, type Month } from '@hafb/shared';
import {
  applyChanges,
  createAccount,
  createCategory,
  createGroup,
  addScheduled,
  addTransaction,
  editAccount,
  newPlan,
  setAssigned,
  setCleared,
  setTarget,
  snoozeTarget,
  type Command,
  type CommandContext,
  type PlanData,
  type TransactionInput,
} from '@hafb/store';

export const SAMPLE_TODAY: ISODate = '2026-10-14';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const $ = (dollars: number): Minor => minor(Math.round(dollars * 100));

export interface SamplePlan {
  plan: PlanData;
  today: ISODate;
  ids: { accounts: Record<string, Id>; categories: Record<string, Id> };
}

export function buildSamplePlan(): SamplePlan {
  const rand = seeded(20261014);
  let clock = Date.UTC(2026, 9, 14, 15, 0, 0);
  const newId = uuidv7Generator(
    () => (clock += 1),
    (n) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256)),
  );
  const ctx: CommandContext = { now: '2026-10-14T15:00:00.000Z', today: SAMPLE_TODAY, newId };
  let plan = newPlan(
    {
      name: 'Sample Household',
      currencyCode: 'USD',
      currencyDecimals: 2,
      currencySymbol: '$',
      symbolPlacement: 'before',
      numberFormat: '123,456.78',
      dateFormat: 'MM/DD/YYYY',
      firstMonth: '2026-08',
      expectedIncome: $(5280),
      createdAt: ctx.now,
    },
    ctx,
  );
  const run = <C extends Command>(build: (p: PlanData) => C): C => {
    const cmd = build(plan);
    plan = applyChanges(plan, cmd.changes).plan;
    return cmd;
  };

  // ---- accounts -------------------------------------------------------------------------------
  const acct: Record<string, Id> = {};
  const account = (key: string, name: string, type: Parameters<typeof createAccount>[2]['type'], start: number): void => {
    acct[key] = run((p) => createAccount(p, ctx, { name, type, startingBalance: $(start), date: '2026-08-01' })).accountId;
  };
  account('checking', 'Everyday Checking', 'checking', 3200);
  account('savings', 'Rainy Day Savings', 'savings', 6500);
  account('cash', 'Wallet', 'cash', 120);
  account('visa', 'Visa Rewards', 'creditCard', -640);
  account('mortgage', 'Home Mortgage', 'mortgage', -248300);
  account('car', 'Car Loan', 'autoLoan', -11420);
  account('retirement', 'Retirement 401(k)', 'asset', 58900);
  const id = (key: string): Id => {
    const v = acct[key];
    if (v === undefined) throw new Error(key);
    return v;
  };
  run((p) => editAccount(p, ctx, { accountId: id('checking'), starred: true }));
  run((p) => editAccount(p, ctx, { accountId: id('mortgage'), loan: { interestRateBps: 575, minimumPayment: $(1780), escrow: $(410) } }));

  // ---- categories -----------------------------------------------------------------------------
  const cat: Record<string, Id> = {};
  const group = (name: string, names: string[]): void => {
    const groupId = run((p) => createGroup(p, ctx, { name })).groupId;
    for (const n of names) cat[n] = run((p) => createCategory(p, ctx, { groupId, name: n })).categoryId;
  };
  group('Bills', ['Mortgage', 'Car Payment', 'Electric', 'Water & Sewer', 'Internet', 'Phone', 'Car Insurance', 'Streaming']);
  group('Everyday', ['Groceries', 'Dining Out', 'Gas & Transit', 'Household', 'Pets']);
  group('True Expenses', ['Car Maintenance', 'Medical', 'Gifts', 'Home Repairs', 'Clothing']);
  group('Goals', ['Emergency Fund', 'Vacation', 'New Laptop']);
  group('Fun', ['Entertainment', 'Hobbies']);
  const c = (name: string): Id => {
    const v = cat[name];
    if (v === undefined) throw new Error(name);
    return v;
  };

  // ---- targets --------------------------------------------------------------------------------
  const target = (name: string, amount: number, cadence: Target['cadence'], behavior: Target['behavior']): void => {
    run((p) => setTarget(p, ctx, { categoryId: c(name), amount: $(amount), cadence, behavior }));
  };
  target('Mortgage', 1780, { kind: 'monthly', day: 1 }, 'refill');
  target('Car Payment', 385, { kind: 'monthly', day: 5 }, 'refill');
  target('Electric', 140, { kind: 'monthly', day: 20 }, 'refill');
  target('Water & Sewer', 65, { kind: 'monthly', day: 15 }, 'refill');
  target('Internet', 70, { kind: 'monthly', day: 8 }, 'refill');
  target('Phone', 85, { kind: 'monthly', day: 22 }, 'refill');
  target('Car Insurance', 1260, { kind: 'yearly', due: '2027-03-01' }, 'setAside');
  target('Streaming', 38, { kind: 'monthly', day: 12 }, 'refill');
  target('Groceries', 720, { kind: 'monthly', day: 'last' }, 'refill');
  target('Dining Out', 220, { kind: 'monthly', day: 'last' }, 'refill');
  target('Gas & Transit', 55, { kind: 'weekly', weekday: 5 }, 'refill');
  target('Household', 120, { kind: 'monthly', day: 'last' }, 'refill');
  target('Pets', 90, { kind: 'monthly', day: 'last' }, 'refill');
  target('Car Maintenance', 900, { kind: 'custom', due: '2027-04-01' }, 'setAside');
  target('Medical', 75, { kind: 'monthly', day: 'last' }, 'setAside');
  target('Gifts', 800, { kind: 'yearly', due: '2026-12-15' }, 'setAside');
  target('Home Repairs', 100, { kind: 'monthly', day: 'last' }, 'setAside');
  target('Clothing', 60, { kind: 'monthly', day: 'last' }, 'setAside');
  target('Emergency Fund', 15000, { kind: 'custom' }, 'haveBalance');
  target('Vacation', 3600, { kind: 'custom', due: '2027-06-30' }, 'haveBalance');
  target('New Laptop', 1500, { kind: 'custom', due: '2027-01-31' }, 'haveBalance');
  target('Entertainment', 80, { kind: 'monthly', day: 'last' }, 'refill');
  run((p) => snoozeTarget(p, ctx, { categoryId: c('New Laptop'), month: '2026-10', snoozed: true }));

  // ---- transactions ---------------------------------------------------------------------------
  const tx = (input: TransactionInput): void => {
    run((p) => addTransaction(p, ctx, input));
  };
  const spend = (account: string, date: ISODate, payee: string, category: string, amount: number, extra: Partial<TransactionInput> = {}): void => {
    tx({ accountId: id(account), date, payeeName: payee, categoryId: c(category), amount: $(-amount), cleared: 'cleared', ...extra });
  };
  const between = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  const day = (m: Month, d: number): ISODate => makeDate(monthParts(m).year, monthParts(m).month, d);

  for (const m of ['2026-08', '2026-09', '2026-10'] as const) {
    const october = m === '2026-10';
    const until = (d: number): boolean => !october || d <= 14;
    for (const d of [1, 15]) {
      if (until(d)) tx({ accountId: id('checking'), date: day(m, d), payeeName: 'Acme Logistics', categoryId: 'ready-to-assign', amount: $(2640), cleared: 'cleared', memo: 'Paycheck' });
    }
    tx({ accountId: id('checking'), date: day(m, 1), transferAccountId: id('mortgage'), categoryId: c('Mortgage'), amount: $(-1780), cleared: 'cleared' });
    tx({ accountId: id('checking'), date: day(m, 5), transferAccountId: id('car'), categoryId: c('Car Payment'), amount: $(-385), cleared: 'cleared' });
    if (until(8)) spend('checking', day(m, 8), 'FiberNet', 'Internet', 70);
    if (until(12)) spend('visa', day(m, 12), 'StreamBox', 'Streaming', 38);
    if (until(15)) spend('checking', day(m, 15), 'Metro Water', 'Water & Sewer', between(58, 66));
    if (until(20)) spend('checking', day(m, 20), 'City Power', 'Electric', between(118, 151));
    if (until(22)) spend('visa', day(m, 22), 'Northwind Mobile', 'Phone', 85);
    for (const d of [3, 10, 17, 24]) {
      if (until(d)) spend('visa', day(m, d), 'Fresh Market', 'Groceries', between(118, 176));
      if (until(d + 1)) spend('checking', day(m, d + 1), 'QuickFuel', 'Gas & Transit', october ? between(58, 66) : between(44, 55));
    }
    if (until(6)) spend('cash', day(m, 6), 'Corner Grocery', 'Groceries', between(14, 26));
    for (const d of october ? [2, 4, 9, 11, 13] : [7, 19, 27]) {
      if (until(d)) spend('visa', day(m, d), ['Luigi’s Trattoria', 'Taco Stand', 'Blue Door Café', 'Pho 99'][d % 4] ?? 'Café', 'Dining Out', october ? between(84, 98) : between(31, 68));
    }
    if (until(9)) spend('visa', day(m, 9), 'Pet Pantry', 'Pets', between(52, 78));
    if (until(14)) spend('checking', day(m, 14), 'Cinema 8', 'Entertainment', between(24, 42));
    if (!october) {
      spend('visa', day(m, 18), 'HomeGoods Depot', 'Household', between(44, 96));
      spend('checking', day(m, 21), 'Valley Clinic', 'Medical', between(25, 60));
      tx({ accountId: id('checking'), date: day(m, 26), transferAccountId: id('visa'), amount: $(m === '2026-08' ? -1640 : -980), cleared: 'cleared' });
      tx({ accountId: id('checking'), date: day(m, 16), transferAccountId: id('savings'), amount: $(-300), cleared: 'cleared', memo: 'Emergency fund' });
    }
  }
  // October extras: a split, a flagged and an unapproved transaction, an uncleared one.
  tx({
    accountId: id('visa'),
    date: '2026-10-12',
    payeeName: 'Big Box Store',
    amount: $(-186.4),
    cleared: 'uncleared',
    subtransactions: [
      { amount: $(-92.15), categoryId: c('Groceries'), memo: 'Pantry restock' },
      { amount: $(-64.25), categoryId: c('Household') },
      { amount: $(-30), categoryId: c('Clothing'), memo: 'School socks' },
    ],
  });
  spend('checking', '2026-10-13', 'AutoCare Plus', 'Car Maintenance', 249.99, { flag: 'orange', memo: 'Brakes' });
  spend('visa', '2026-10-14', 'Book Nook', 'Hobbies', 32.5, { approved: false, cleared: 'uncleared' });

  // Scheduled: the rest of October's bills and paychecks, and next month's loan payment (S5.4).
  run((p) => addScheduled(p, ctx, { accountId: id('checking'), date: '2026-10-15', frequency: 'twiceAMonth', payeeName: 'Acme Logistics', categoryId: 'ready-to-assign', amount: $(2640), memo: 'Paycheck' }));
  run((p) => addScheduled(p, ctx, { accountId: id('checking'), date: '2026-10-20', frequency: 'monthly', payeeName: 'City Power', categoryId: c('Electric'), amount: $(-135) }));
  run((p) => addScheduled(p, ctx, { accountId: id('visa'), date: '2026-10-22', frequency: 'monthly', payeeName: 'Northwind Mobile', categoryId: c('Phone'), amount: $(-85) }));
  run((p) => addScheduled(p, ctx, { accountId: id('checking'), date: '2026-11-01', frequency: 'monthly', transferAccountId: id('mortgage'), categoryId: c('Mortgage'), amount: $(-1780) }));

  // Bank-side legs of transfers arrive uncleared; clear them, and reconcile August (shows the lock).
  const keepUncleared = new Set(plan.transactions.filter((t) => t.date >= '2026-10-12' && t.cleared === 'uncleared').map((t) => t.id));
  const toClear = plan.transactions.filter((t) => t.cleared === 'uncleared' && !keepUncleared.has(t.id)).map((t) => t.id);
  run((p) => setCleared(p, ctx, { transactionIds: toClear, cleared: 'cleared' }));
  const august = plan.transactions.filter((t) => t.date < '2026-09-01').map((t) => t.id);
  run((p) => setCleared(p, ctx, { transactionIds: august, cleared: 'reconciled' }));

  // ---- assignments ----------------------------------------------------------------------------
  const assign = (m: Month, amounts: Record<string, number>): void => {
    for (const [name, amount] of Object.entries(amounts)) run((p) => setAssigned(p, ctx, { month: m, categoryId: c(name), amount: $(amount) }));
  };
  const monthly = {
    Mortgage: 1780, 'Car Payment': 385, Electric: 140, 'Water & Sewer': 65, Internet: 70, Phone: 85, 'Car Insurance': 105,
    Streaming: 38, Groceries: 720, 'Dining Out': 220, 'Gas & Transit': 220, Household: 120, Pets: 90, 'Car Maintenance': 75,
    Medical: 75, Gifts: 160, 'Home Repairs': 100, Clothing: 60, Vacation: 400, Entertainment: 80, Hobbies: 40,
  };
  assign('2026-08', { ...monthly, 'Emergency Fund': 6300, 'New Laptop': 500 });
  const visaPayment = plan.categories.find((x) => x.creditCardAccountId === id('visa'));
  if (visaPayment) run((p) => setAssigned(p, ctx, { month: '2026-08', categoryId: visaPayment.id, amount: $(640) }));
  assign('2026-09', { ...monthly, 'Emergency Fund': 300 });
  assign('2026-10', {
    Mortgage: 1780, 'Car Payment': 385, Electric: 60, 'Water & Sewer': 65, Internet: 70, Phone: 85, 'Car Insurance': 105,
    Streaming: 38, Groceries: 600, 'Dining Out': 220, 'Gas & Transit': 165, Household: 120, Pets: 90, 'Car Maintenance': 75,
    Medical: 75, Gifts: 160, 'Home Repairs': 100, Clothing: 60, Entertainment: 80,
  });

  return { plan, today: SAMPLE_TODAY, ids: { accounts: acct, categories: cat } };
}

/** A brand-new, empty plan (the browser preview's `?blank`): what a first-time user starts with. */
export function buildBlankPlan(): PlanData {
  let clock = Date.UTC(2026, 9, 14, 15, 0, 0);
  const newId = uuidv7Generator(
    () => (clock += 1),
    (n) => new Uint8Array(n).fill(7),
  );
  const ctx: CommandContext = { now: '2026-10-14T15:00:00.000Z', today: SAMPLE_TODAY, newId };
  return newPlan(
    { name: 'My Plan', currencyCode: 'USD', currencyDecimals: 2, currencySymbol: '$', symbolPlacement: 'before', numberFormat: '123,456.78', dateFormat: 'MM/DD/YYYY', firstMonth: monthOf(SAMPLE_TODAY), createdAt: ctx.now },
    ctx,
  );
}
