import { describe, expect, it } from 'vitest';
import { evaluateTarget, type CategoryMonth, type Target, type TargetBehavior, type TargetCadence } from '@hafb/engine';
import { minor, type Month } from '@hafb/shared';
import { behaviorOptions, behaviorPrompt, cardDraftFor, cardTargetArgs, cardTargetCard, draftFor, targetCard, toTargetArgs, withCadence } from './targetModel.ts';

const fmt = { decimals: 2, symbol: '$', placement: 'before' as const, numberFormat: '1,234.56' as const };
const cm = (assigned: number, carriedIn = 0): CategoryMonth => ({
  categoryId: 'c',
  assigned: minor(assigned),
  carriedIn: minor(carriedIn),
  activity: minor(0),
  available: minor(carriedIn + assigned),
  cashActivity: minor(0),
  creditActivity: minor(0),
  overspending: { cash: minor(0), credit: minor(0) },
});
const target = (amount: number, cadence: TargetCadence, behavior: TargetBehavior, startMonth: Month = '2026-10'): Target => ({ categoryId: 'c', amount: minor(amount), cadence, behavior, startMonth, createdOn: '2026-10-01' });
const card = (t: Target, c: CategoryMonth) => targetCard(t, evaluateTarget(t, '2026-10', c, (m) => (m === '2026-10' ? c.assigned : minor(0)), { today: '2026-10-08' }), c, fmt);

describe('the target editor draft', () => {
  const combos: [TargetCadence, TargetBehavior][] = [
    [{ kind: 'weekly', weekday: 6 }, 'setAside'],
    [{ kind: 'weekly', weekday: 2 }, 'refill'],
    [{ kind: 'monthly', day: 'last' }, 'setAside'],
    [{ kind: 'monthly', day: 15 }, 'refill'],
    [{ kind: 'yearly', due: '2026-12-10' }, 'refill'],
    [{ kind: 'yearly', due: '2027-03-01' }, 'setAside'],
    [{ kind: 'custom', due: '2027-02-01', repeatEveryMonths: 6 }, 'setAside'],
    [{ kind: 'custom', due: '2027-02-01', repeatEveryMonths: 24 }, 'refill'],
    [{ kind: 'custom', due: '2027-06-01' }, 'haveBalance'],
    [{ kind: 'custom' }, 'haveBalance'],
  ];
  it('every cadence × behavior survives a round trip through the editor', () => {
    for (const [cadence, behavior] of combos) {
      const t = target(30_000, cadence, behavior);
      const r = toTargetArgs(draftFor(t, '2026-10-08'));
      expect(r, JSON.stringify(cadence)).toEqual({ ok: true, args: { amount: 30_000, cadence, behavior } });
    }
  });

  it("YNAB's defaults and rules: monthly, last day, set aside; due the 1st of next month", () => {
    const d = draftFor(undefined, '2026-10-08');
    expect(d).toMatchObject({ kind: 'monthly', day: 'last', behavior: 'setAside', due: '2026-11-01', amount: 0 });
    expect(toTargetArgs(d)).toEqual({ ok: false, error: 'Enter how much you need.' });
    const custom = { ...withCadence(d, 'custom'), amount: minor(500), due: null };
    expect(toTargetArgs(custom)).toMatchObject({ ok: false });
    expect(toTargetArgs({ ...custom, behavior: 'haveBalance' })).toEqual({ ok: true, args: { amount: 500, cadence: { kind: 'custom' }, behavior: 'haveBalance' } });
    // Leaving Custom drops "Have a balance of"; it can't repeat either.
    expect(withCadence({ ...custom, behavior: 'haveBalance' }, 'monthly').behavior).toBe('setAside');
    expect(toTargetArgs({ ...custom, behavior: 'haveBalance', due: '2027-01-01', repeat: true, every: 3 })).toMatchObject({ ok: true, args: { cadence: { kind: 'custom', due: '2027-01-01' } } });
  });

  it('behavior options read as YNAB words them, with "Most people choose this"', () => {
    expect(behaviorOptions('monthly', minor(0), fmt).map((o) => o.label)).toEqual(['Set aside another $0.00', 'Refill up to $0.00']);
    expect(behaviorOptions('weekly', minor(2500), fmt)[0]?.label).toBe('Set aside another $25.00/week');
    expect(behaviorOptions('custom', minor(0), fmt).map((o) => o.label)).toEqual(['Set aside $0.00', 'Fill up to $0.00', 'Have a balance of $0.00']);
    expect(behaviorOptions('custom', minor(0), fmt)[0]?.hint).toBe('Most people choose this');
    expect([behaviorPrompt('monthly'), behaviorPrompt('weekly'), behaviorPrompt('yearly'), behaviorPrompt('custom')]).toEqual(['Next month I want to', 'Next week I want to', 'Next year I want to', 'I want to']);
  });
});

describe('the target card (YNAB trial, 2026-10-08)', () => {
  it('Car Fund: set aside $300 every 6 months by Feb 1 2027, $50 assigned', () => {
    const c = card(target(30_000, { kind: 'custom', due: '2027-02-01', repeatEveryMonths: 6 }, 'setAside', '2026-09'), cm(5_000));
    expect(c.heading).toBe('Set Aside Another $300.00 Every 6 Months');
    expect(c.subline).toBe('By Feb 1 2027');
    expect(c.box?.tone).toBe('warn');
    expect(c.box?.text).toMatch(/^Assign \$[\d.]+ more this month to stay on track$/);
    expect(c.lines.map((l) => l.label)).toEqual(['Total to Assign by Feb 1 2027', 'Assigned So Far', 'To Go']);
  });

  it('House Down Payment: have a balance of $5,000, eventually; $200 assigned → 24 months', () => {
    const c = card(target(500_000, { kind: 'custom' }, 'haveBalance'), cm(20_000));
    expect(c.heading).toBe('Have a Balance of $5,000.00');
    expect(c.subline).toBe('Eventually');
    expect(c.box).toEqual({ tone: 'good', text: 'If you assign $200.00 each month, you will meet your target in 24 months.' });
    expect(c.lines).toEqual([
      { label: 'Balance Needed', value: 500_000 },
      { label: 'Current Balance', value: 20_000 },
      { label: 'To Go', value: 480_000 },
    ]);
    expect(c.percent).toBe(4);
  });

  it('Gifts: refill up to $600 each year by Dec 10 2026', () => {
    const c = card(target(60_000, { kind: 'yearly', due: '2026-12-10' }, 'refill'), cm(5_000));
    expect(c.heading).toBe('Refill Up to $600.00 Each Year');
    expect(c.subline).toBe('By Dec 10 2026');
    expect(c.lines.map((l) => l.label)).toEqual(['Needed by Dec 10 2026', 'Funded', 'To Go']);
    expect(c.lines[1]?.value).toBe(5_000);
  });

  it('weekly and monthly headings, and a funded target', () => {
    expect(card(target(2_500, { kind: 'weekly', weekday: 6 }, 'setAside'), cm(0)).subline).toBe('Every Saturday');
    const funded = card(target(6_000, { kind: 'monthly', day: 20 }, 'refill'), cm(6_000));
    expect(funded.heading).toBe('Refill Up to $60.00 Each Month');
    expect(funded.subline).toBe('By the 20th');
    expect(funded.box?.tone).toBe('good');
  });
});

describe('credit card payment targets (T-12, YNAB trial 2026-10-12)', () => {
  const amex = (owed: number, available: number): CategoryMonth => ({ ...cm(0), available: minor(available), creditCard: { accountId: 'amex', fundedSpending: minor(available), payments: minor(0), balance: minor(-owed), unfundedSpending: minor(0), spending: minor(-owed), returns: minor(0), interest: minor(0) } });
  const evalCard = (t: Target, c: CategoryMonth) => cardTargetCard(t, evaluateTarget(t, '2026-10', c, () => minor(0), { today: '2026-10-12' }), fmt);

  it('Pay Off Balance by Date: YNAB’s defaults, text and lines', () => {
    const d = cardDraftFor(undefined, '2026-10-12');
    expect(d).toEqual({ kind: 'payOff', month: '2026-11', amount: 0 });
    const r = cardTargetArgs(d);
    if (!r.ok) throw new Error(r.error);
    expect(r.args).toEqual({ amount: 0, cadence: { kind: 'custom', due: '2026-11-30' }, behavior: 'haveBalance', payOff: true });
    const t: Target = { categoryId: 'c', startMonth: '2026-10', createdOn: '2026-10-12', ...r.args, payOff: true };
    const c = evalCard(t, amex(5_000, 4_000));
    expect([c.heading, c.subline, c.box?.text]).toEqual(['Pay Off Balance by Date', 'Pay off $10.00 by Nov 2026', 'Assign $5.00 this month to stay on track']);
    expect(c.lines).toEqual([{ label: 'Needed for Payoff', value: 5_000 }, { label: 'Available for Payment', value: 4_000 }, { label: 'To Go', value: 1_000 }]);
    expect(cardDraftFor(t, '2026-10-12')).toEqual({ kind: 'payOff', month: '2026-11', amount: 0 });
  });

  it('Pay Specific Amount Monthly: a monthly Set aside with YNAB’s card text', () => {
    expect(cardTargetArgs({ kind: 'monthly', month: '2026-11', amount: minor(0) }).ok).toBe(false);
    const r = cardTargetArgs({ kind: 'monthly', month: '2026-11', amount: minor(2_000) });
    if (!r.ok) throw new Error(r.error);
    const t: Target = { categoryId: 'c', startMonth: '2026-10', createdOn: '2026-10-12', amount: r.args.amount, cadence: r.args.cadence, behavior: r.args.behavior };
    const c = evalCard(t, amex(5_000, 4_000));
    expect([c.heading, c.subline, c.box?.text]).toEqual(['Pay Specific Amount Monthly', '$20.00 Each Month', 'Assign $20.00 to meet your target']);
    expect(c.lines).toEqual([{ label: 'Amount to Assign This Month', value: 2_000 }, { label: 'Assigned So Far', value: 0 }, { label: 'To Go', value: 2_000 }]);
    expect(cardDraftFor(t, '2026-10-12').kind).toBe('monthly');
  });
});
