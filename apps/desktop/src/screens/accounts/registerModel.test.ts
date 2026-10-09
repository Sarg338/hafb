import { describe, expect, it } from 'vitest';
import { READY_TO_ASSIGN } from '@hafb/engine';
import { minor } from '@hafb/shared';
import { addScheduled, addTransaction, applyChanges, editScheduled, editTransaction, planBudget, type CommandContext, type PlanData } from '@hafb/store';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { addSplitLine, dateOrderOf, draftFor, draftForScheduled, frequencyLabel, FREQUENCIES, newRowKind, scheduledIdOf, scheduledRows, toScheduledInput, nextSort, parseRegisterSearch, patchSplitLine, presetRange, registerCounts, registerRows, removeSplitLine, selectedTotal, splitRemaining, startSplit, toInput, toPatch, transferLabel, transferNeedsCategory } from './registerModel.ts';

let n = 0;
const ctx: CommandContext = { now: '2026-10-14T16:00:00.000Z', today: SAMPLE_TODAY, newId: () => `reg-${String((n += 1))}` };
const sample = buildSamplePlan().plan;
const acct = (name: string): string => sample.accounts.find((a) => a.name === name)?.id ?? '';
const cat = (name: string): string => sample.categories.find((c) => c.name === name)?.id ?? '';

describe('registerRows', () => {
  it('lists every live transaction newest first (All Accounts has no running balance)', () => {
    const rows = registerRows(sample, { accountId: null });
    expect(rows).toHaveLength(sample.transactions.filter((t) => t.deletedAt === undefined).length);
    for (let i = 1; i < rows.length; i++) expect((rows[i - 1]?.date ?? '') >= (rows[i]?.date ?? '')).toBe(true);
    expect(rows.every((r) => r.balance === undefined)).toBe(true);
  });

  it("a single account's running balance ends at its working balance", () => {
    const id = acct('Everyday Checking');
    const rows = registerRows(sample, { accountId: id });
    expect(rows[0]?.balance).toBe(planBudget(sample, { today: SAMPLE_TODAY }).accountBalances[id]?.working);
    const oldest = rows.at(-1);
    expect(oldest?.balance).toBe(oldest?.amount);
  });

  it('labels transfers, payments and starting balances like YNAB', () => {
    const checking = registerRows(sample, { accountId: acct('Everyday Checking') });
    const toLoan = checking.find((r) => r.payee === 'Transfer : Car Loan');
    expect(toLoan?.category).toEqual({ text: 'Car Payment', tone: 'plain' });
    expect(toLoan?.transfer).toBe(true);
    const loan = registerRows(sample, { accountId: acct('Car Loan') }).find((r) => r.payee === 'Transfer : Everyday Checking');
    expect(loan?.category.text).toBe('Category not needed');
    const visaStart = registerRows(sample, { accountId: acct('Visa Rewards') }).find((r) => r.payee === 'Starting Balance');
    expect(visaStart?.category).toEqual({ text: 'Category not needed', tone: 'muted' });
    expect(checking.find((r) => r.payee === 'Starting Balance')?.category.text).toBe('Inflow: Ready to Assign');
    expect(transferLabel(sample.accounts.find((a) => a.name === 'Everyday Checking'), sample.accounts.find((a) => a.name === 'Visa Rewards'))).toBe('Payment: Visa Rewards');
    expect(transferLabel(sample.accounts.find((a) => a.name === 'Visa Rewards'), sample.accounts.find((a) => a.name === 'Everyday Checking'))).toBe('Payment: Everyday Checking');
  });

  it('shows split lines and locks the amount and category of a split', () => {
    const split = registerRows(sample, { accountId: null }).find((r) => r.splits.length === 3);
    expect(split?.category.text).toBe('Split (3)');
    expect(split?.splits.reduce((s, l) => s + l.amount, 0)).toBe(split?.amount);
    expect(split?.locks).toMatchObject({ amount: true, category: true });
  });

  const search = (text: string) => parseRegisterSearch(sample, text).query;

  it('filters by text and to unapproved transactions', () => {
    expect(registerRows(sample, { accountId: null, search: search('taco') }).every((r) => r.payee === 'Taco Stand')).toBe(true);
    expect(registerRows(sample, { accountId: null, onlyUnapproved: true }).every((r) => !r.approved)).toBe(true);
    expect(registerRows(sample, { accountId: null, search: search('school socks') })).toHaveLength(1); // a split line's memo
  });
});

describe('search, view options and sort (S4.6)', () => {
  const search = (text: string) => parseRegisterSearch(sample, text).query;
  const all = registerRows(sample, { accountId: null });

  it("YNAB's criteria syntax end to end: every documented criterion filters the register", () => {
    const cases: [string, (r: (typeof all)[number]) => boolean][] = [
      ['Payee: Taco', (r) => r.payee.includes('Taco')],
      ['Category: Dining Out', (r) => r.category.text === 'Dining Out'],
      ['Memo: Brakes', (r) => r.memo === 'Brakes'],
      ['Account: Wallet', (r) => r.accountName === 'Wallet'],
      ['Outflow: >=100', (r) => r.amount <= -10000],
      ['Inflow: >0', (r) => r.amount > 0],
      ['Before: 09/01/2026', (r) => r.date <= '2026-09-01'],
      ['After: 10/10/2026', (r) => r.date >= '2026-10-10'],
      ['On: 10/12/2026', (r) => r.date === '2026-10-12'],
      ['Flag: Orange', (r) => r.flag === 'orange'],
      ['Unapproved', (r) => !r.approved],
      ['is:unapproved', (r) => !r.approved],
      ['Uncleared', (r) => r.cleared === 'uncleared'],
      ['Split', (r) => r.category.text.startsWith('Split')],
      ['Category: Dining Out, Outflow: >=90', (r) => r.category.text === 'Dining Out' && r.amount <= -9000],
    ];
    for (const [text, expected] of cases) {
      const parsed = parseRegisterSearch(sample, text);
      expect(parsed.error, text).toBeNull();
      const got = registerRows(sample, { accountId: null, search: parsed.query });
      expect(got.length, text).toBeGreaterThan(0);
      expect(got.map((r) => r.id), text).toEqual(all.filter(expected).map((r) => r.id));
    }
  });

  it('a bad criterion is an error, not an empty register', () => {
    expect(parseRegisterSearch(sample, 'Outflow: >=abc').error).toMatch(/amount/);
    expect(parseRegisterSearch(sample, 'Colour: red').error).toMatch(/Unknown/);
    expect(parseRegisterSearch(sample, '  ')).toEqual({ query: null, error: null });
    expect(dateOrderOf('DD.MM.YYYY')).toBe('DMY');
    expect(dateOrderOf('YYYY-MM-DD')).toBe('YMD');
  });

  it('a search shows only the split lines it matched', () => {
    const split = registerRows(sample, { accountId: null, search: search('Category: Clothing') }).find((r) => r.category.text.startsWith('Split'));
    expect(split?.splits.map((l) => l.category.text)).toEqual(['Clothing']);
    const whole = registerRows(sample, { accountId: null, search: search('Payee: Big Box') }).find((r) => r.category.text.startsWith('Split'));
    expect(whole?.splits).toHaveLength(3);
  });

  it('date presets, the range filter and Show Reconciled', () => {
    expect(presetRange('thisMonth', '2026-10-14')).toEqual({ from: '2026-10', to: '2026-10' });
    expect(presetRange('lastMonth', '2026-01-14')).toEqual({ from: '2025-12', to: '2025-12' });
    expect(presetRange('latest3', '2026-10-14')).toEqual({ from: '2026-08', to: '2026-10' });
    expect(presetRange('thisYear', '2026-10-14')).toEqual({ from: '2026-01', to: '2026-12' });
    expect(presetRange('lastYear', '2026-10-14')).toEqual({ from: '2025-01', to: '2025-12' });
    expect(presetRange('all', '2026-10-14')).toBeNull();
    const sept = registerRows(sample, { accountId: null, range: { from: '2026-09', to: '2026-09' } });
    expect(sept.length).toBeGreaterThan(0);
    expect(sept.every((r) => r.date.startsWith('2026-09'))).toBe(true);
    const reconciled = all.filter((r) => r.cleared === 'reconciled').length;
    expect(registerRows(sample, { accountId: null, showReconciled: false })).toHaveLength(all.length - reconciled);
  });

  it('sort: a new column starts descending, the same column flips; ties keep date order', () => {
    expect(nextSort({ column: 'date', dir: 'desc' }, 'date')).toEqual({ column: 'date', dir: 'asc' });
    expect(nextSort({ column: 'date', dir: 'asc' }, 'payee')).toEqual({ column: 'payee', dir: 'desc' });
    const byPayee = registerRows(sample, { accountId: null, sort: { column: 'payee', dir: 'desc' } });
    for (let i = 1; i < byPayee.length; i++) expect((byPayee[i - 1]?.payee ?? '').toLowerCase().localeCompare((byPayee[i]?.payee ?? '').toLowerCase())).toBeGreaterThanOrEqual(0);
    const byOutflow = registerRows(sample, { accountId: null, sort: { column: 'outflow', dir: 'desc' } });
    expect(byOutflow[0]?.amount).toBe(Math.min(...all.map((r) => r.amount)));
    const oldest = registerRows(sample, { accountId: null, sort: { column: 'date', dir: 'asc' } });
    expect(oldest.map((r) => r.id)).toEqual(all.map((r) => r.id).reverse());
  });

  it('banner counts and the selected total', () => {
    const counts = registerCounts(sample, null);
    expect(counts.unapproved).toBe(all.filter((r) => !r.approved).length);
    expect(counts.uncategorized).toBe(all.filter((r) => r.category.tone === 'warn').length);
    expect(registerRows(sample, { accountId: null, onlyUncategorized: true })).toHaveLength(counts.uncategorized);
    const two = new Set(all.slice(0, 2).map((r) => r.id));
    expect(selectedTotal(all, two)).toBe((all[0]?.amount ?? 0) + (all[1]?.amount ?? 0));
  });
});

describe('drafts', () => {
  const apply = (p: PlanData, c: { changes: Parameters<typeof applyChanges>[1] }): PlanData => applyChanges(p, c.changes).plan;

  it('a new outflow becomes an addTransaction input', () => {
    const d = { ...draftFor(null, { accountId: acct('Everyday Checking'), date: SAMPLE_TODAY }), payeeName: 'Corner Bakery', categoryId: cat('Groceries'), outflow: minor(1234) };
    const input = toInput(sample, d);
    expect(input).toMatchObject({ amount: -1234, payeeName: 'Corner Bakery', categoryId: cat('Groceries') });
    const p = apply(sample, addTransaction(sample, ctx, input));
    expect(registerRows(p, { accountId: acct('Everyday Checking'), search: parseRegisterSearch(p, 'corner bakery').query })[0]?.amount).toBe(-1234);
  });

  it('a transfer between two budget accounts drops the category; budget → tracking keeps it', () => {
    expect(transferNeedsCategory(sample, acct('Everyday Checking'), acct('Rainy Day Savings'))).toBe(false);
    expect(transferNeedsCategory(sample, acct('Everyday Checking'), acct('Car Loan'))).toBe(true);
    const d = { ...draftFor(null, { accountId: acct('Everyday Checking'), date: SAMPLE_TODAY }), transferAccountId: acct('Rainy Day Savings'), categoryId: cat('Groceries'), outflow: minor(5000) };
    expect(toInput(sample, d)).toMatchObject({ transferAccountId: acct('Rainy Day Savings'), categoryId: null, amount: -5000 });
  });

  it('an edit patches only what changed, and saving approves', () => {
    const t = sample.transactions.find((x) => x.approved === false);
    if (!t) throw new Error('sample has an unapproved transaction');
    const d = { ...draftFor(t, { accountId: t.accountId, date: t.date }), memo: 'Birthday gift' };
    const patch = toPatch(sample, t, d);
    expect(patch).toEqual({ memo: 'Birthday gift', approved: true });
    const p = apply(sample, editTransaction(sample, ctx, { transactionId: t.id, patch }));
    expect(p.transactions.find((x) => x.id === t.id)).toMatchObject({ memo: 'Birthday gift' });
    expect(toPatch(sample, t, draftFor(t, { accountId: t.accountId, date: t.date }))).toEqual({ approved: true });
  });

  it('splitting: two empty lines, amount remaining, add and remove lines; saves as subtransactions', () => {
    const base = { ...draftFor(null, { accountId: acct('Everyday Checking'), date: SAMPLE_TODAY }), payeeName: 'Corner Store', outflow: minor(5000), categoryId: cat('Groceries') };
    let d = startSplit(base);
    expect(d.categoryId).toBeNull();
    expect(d.splits).toHaveLength(2);
    expect(splitRemaining(d)).toBe(-5000);
    const [a, b] = d.splits ?? [];
    d = patchSplitLine(d, a?.key ?? '', { categoryId: cat('Groceries'), outflow: minor(3000), memo: 'food' });
    d = patchSplitLine(d, b?.key ?? '', { categoryId: cat('Household'), outflow: minor(1500) });
    expect(splitRemaining(d)).toBe(-500);
    d = addSplitLine(d);
    const c = d.splits?.[2];
    expect(c?.key).not.toBe(a?.key);
    d = patchSplitLine(d, c?.key ?? '', { transferAccountId: acct('Rainy Day Savings'), outflow: minor(500), categoryId: cat('Groceries') });
    expect(splitRemaining(d)).toBe(0);
    const input = toInput(sample, d);
    expect(input).toMatchObject({ amount: -5000, categoryId: null, subtransactions: [{ amount: -3000, categoryId: cat('Groceries'), memo: 'food' }, { amount: -1500, categoryId: cat('Household') }, { amount: -500, categoryId: null, transferAccountId: acct('Rainy Day Savings') }] });
    const p = apply(sample, addTransaction(sample, ctx, input));
    const saved = p.transactions.find((t) => t.memo === undefined && t.subtransactions?.length === 3 && t.amount === -5000);
    expect(saved?.subtransactions?.[2]?.transferTransactionId).toBeDefined();
    // Removing every line ends the split.
    expect(removeSplitLine(removeSplitLine(startSplit(base), 'line-1'), 'line-2').splits).toBeNull();
  });

  it('editing a split: unchanged lines patch nothing; a changed line or un-splitting patches the lines', () => {
    const t = sample.transactions.find((x) => (x.subtransactions?.length ?? 0) === 3);
    if (!t) throw new Error('sample has a split');
    const d = draftFor(t, { accountId: t.accountId, date: t.date });
    expect(d.splits?.map((l) => l.key)).toEqual(t.subtransactions?.map((s) => s.id));
    expect(Object.keys(toPatch(sample, t, d)).filter((k) => k !== 'approved')).toEqual([]);
    const first = d.splits?.[0];
    const changed = patchSplitLine(d, first?.key ?? '', { memo: 'Pantry' });
    expect(toPatch(sample, t, changed).subtransactions?.[0]).toMatchObject({ id: first?.id, memo: 'Pantry' });
    const unsplit = { ...d, splits: null, categoryId: cat('Groceries') };
    expect(toPatch(sample, t, unsplit)).toMatchObject({ subtransactions: null, categoryId: cat('Groceries') });
  });

  it('a Ready to Assign inflow keeps its category', () => {
    const t = sample.transactions.find((x) => x.categoryId === READY_TO_ASSIGN && x.isStartingBalance !== true);
    if (!t) throw new Error('sample has income');
    const d = draftFor(t, { accountId: t.accountId, date: t.date });
    expect(toPatch(sample, t, { ...d, inflow: minor(d.inflow + 100) })).toEqual({ amount: t.amount + 100 });
  });
});

describe('scheduled rows (S5.4)', () => {
  const apply = (p: PlanData, c: { changes: Parameters<typeof applyChanges>[1] }): PlanData => applyChanges(p, c.changes).plan;
  it('lists next occurrences earliest first, labelled like transactions', () => {
    const rows = scheduledRows(sample, null);
    expect(rows.map((r) => r.payee)).toEqual(['Acme Logistics', 'City Power', 'Northwind Mobile', 'Transfer : Home Mortgage']);
    expect(rows[0]).toMatchObject({ frequency: 'twiceAMonth', category: { text: 'Inflow: Ready to Assign' }, amount: 264_000, date: '2026-10-15' });
    expect(rows[3]?.category.text).toBe('Mortgage');
    expect(scheduledIdOf(rows[1]?.id ?? '')).toBe(rows[1]?.scheduledId);
    expect(scheduledIdOf('not-scheduled')).toBeNull();
    expect(scheduledRows(sample, acct('Visa Rewards')).map((r) => r.payee)).toEqual(['Northwind Mobile']);
    expect(FREQUENCIES).toHaveLength(13);
    expect(frequencyLabel('every4Weeks')).toBe('Every 4 weeks');
  });

  it('a schedule round-trips through the row editor unchanged', () => {
    for (const s of sample.scheduled) {
      const input = toScheduledInput(sample, draftForScheduled(s));
      const after = apply(sample, editScheduled(sample, ctx, { scheduledId: s.id, input }));
      expect(after.scheduled.find((x) => x.id === s.id)).toEqual(s);
    }
  });

  it('a new row dated after today is scheduled; today with a repeat enters it and repeats', () => {
    const d = draftFor(null, { accountId: acct('Everyday Checking'), date: SAMPLE_TODAY });
    expect(newRowKind(d, SAMPLE_TODAY)).toBe('transaction');
    expect(newRowKind({ ...d, frequency: 'never' }, SAMPLE_TODAY)).toBe('transaction');
    expect(newRowKind({ ...d, frequency: 'monthly' }, SAMPLE_TODAY)).toBe('transactionAndRepeat');
    expect(newRowKind({ ...d, date: '2026-10-15' }, SAMPLE_TODAY)).toBe('scheduled');
    const p = apply(sample, addScheduled(sample, ctx, toScheduledInput(sample, { ...d, date: '2026-10-30', outflow: minor(1000), payeeName: 'Gym', categoryId: cat('Hobbies'), frequency: 'monthly' })));
    expect(p.scheduled.at(-1)).toMatchObject({ date: '2026-10-30', frequency: 'monthly', amount: -1000, categoryId: cat('Hobbies') });
  });
});
