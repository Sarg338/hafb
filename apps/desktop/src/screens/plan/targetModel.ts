// Targets on screen (S5.2), as YNAB's trial plan shows them (2026-10-08). Pure: plan records and engine
// output in; editor drafts and card text out. The money math is the engine's (§5.4).
// Editor: Weekly | Monthly | Yearly | Custom; "I need" (Custom: "Amount"); "By" / "Every" / "Due on";
// "Next month I want to" (Custom: "I want to") with each behavior explained; Custom can repeat every N
// months or years. Card: "Set Aside Another $300.00 Every 6 Months / By Feb 1 2027", a progress ring,
// a box ("Assign $10.00 more this month to stay on track"), and lines that depend on the behavior.
import { suggestTargetAmount, type CategoryMonth, type Id, type Target, type TargetBehavior, type TargetCadence, type TargetMonth, type TargetStatus } from '@hafb/engine';
import { addMonths, dateParts, firstDayOfMonth, formatMoney, monthOf, ZERO, type ISODate, type Minor, type MoneyFormat } from '@hafb/shared';
import type { PlanModel } from './planModel.ts';

export type CadenceKind = TargetCadence['kind'];
export const CADENCES: readonly { id: CadenceKind; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'custom', label: 'Custom' },
];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TargetDraft {
  kind: CadenceKind;
  amount: Minor;
  weekday: number;
  day: number | 'last';
  /** Yearly and custom; null on a custom "Have a balance of" means no date ("Eventually"). */
  due: ISODate | null;
  behavior: TargetBehavior;
  repeat: boolean;
  every: number;
  unit: 'month' | 'year';
}

/** The editor's starting point: the target, or YNAB's defaults (Monthly, last day, set aside, due the 1st of next month). */
export function draftFor(target: Target | undefined, today: ISODate): TargetDraft {
  const nextFirst = firstDayOfMonth(addMonths(monthOf(today), 1));
  const base: TargetDraft = { kind: 'monthly', amount: ZERO, weekday: 6, day: 'last', due: nextFirst, behavior: 'setAside', repeat: false, every: 1, unit: 'month' };
  if (!target) return base;
  const c = target.cadence;
  const d: TargetDraft = { ...base, kind: c.kind, amount: target.amount, behavior: target.behavior };
  if (c.kind === 'weekly') d.weekday = c.weekday;
  if (c.kind === 'monthly') d.day = c.day;
  if (c.kind === 'yearly') d.due = c.due;
  if (c.kind === 'custom') {
    d.due = c.due ?? null;
    if (c.repeatEveryMonths !== undefined) {
      d.repeat = true;
      d.unit = c.repeatEveryMonths % 12 === 0 ? 'year' : 'month';
      d.every = d.unit === 'year' ? c.repeatEveryMonths / 12 : c.repeatEveryMonths;
    }
  }
  return d;
}

/** Switching cadence keeps the amount; a behavior the new cadence can't have falls back to "set aside". */
export function withCadence(d: TargetDraft, kind: CadenceKind): TargetDraft {
  return { ...d, kind, behavior: d.behavior === 'haveBalance' && kind !== 'custom' ? 'setAside' : d.behavior, ...(kind !== 'custom' ? { repeat: false } : {}) };
}

export type DraftResult = { ok: true; args: { amount: Minor; cadence: TargetCadence; behavior: TargetBehavior } } | { ok: false; error: string };

export function toTargetArgs(d: TargetDraft): DraftResult {
  if (d.amount <= 0) return { ok: false, error: 'Enter how much you need.' };
  let cadence: TargetCadence;
  switch (d.kind) {
    case 'weekly':
      cadence = { kind: 'weekly', weekday: d.weekday };
      break;
    case 'monthly':
      cadence = { kind: 'monthly', day: d.day };
      break;
    case 'yearly':
      if (d.due === null) return { ok: false, error: 'Choose the date it’s due.' };
      cadence = { kind: 'yearly', due: d.due };
      break;
    case 'custom': {
      if (d.due === null && d.behavior !== 'haveBalance') return { ok: false, error: 'Choose the date it’s due.' };
      const repeat = d.repeat && d.behavior !== 'haveBalance' ? Math.max(1, Math.round(d.every)) * (d.unit === 'year' ? 12 : 1) : undefined;
      cadence = { kind: 'custom', ...(d.due === null ? {} : { due: d.due }), ...(repeat === undefined ? {} : { repeatEveryMonths: repeat }) };
      break;
    }
  }
  if (d.behavior === 'haveBalance' && d.kind !== 'custom') return { ok: false, error: '“Have a balance of” is a Custom target.' };
  return { ok: true, args: { amount: d.amount, cadence, behavior: d.behavior } };
}

/** "Next month I want to" (Weekly: next week, Yearly: next year; Custom: "I want to"). */
export const behaviorPrompt = (kind: CadenceKind): string => (kind === 'weekly' ? 'Next week I want to' : kind === 'yearly' ? 'Next year I want to' : kind === 'monthly' ? 'Next month I want to' : 'I want to');

export interface BehaviorOption {
  id: TargetBehavior;
  label: string;
  useFor: string;
  explain: string;
  hint?: string;
}

/** The behaviors this cadence allows, worded as YNAB's dropdown words them. */
export function behaviorOptions(kind: CadenceKind, amount: Minor, fmt: MoneyFormat): BehaviorOption[] {
  const m = formatMoney(amount, fmt);
  const per = kind === 'weekly' ? '/week' : '';
  const custom = kind === 'custom';
  const out: BehaviorOption[] = [
    { id: 'setAside', label: custom ? `Set aside ${m}` : `Set aside another ${m}${per}`, useFor: 'bills, subscriptions, saving over time', explain: `Add ${m} to this category, regardless of its current balance.`, hint: 'Most people choose this' },
    { id: 'refill', label: custom ? `Fill up to ${m}` : `Refill up to ${m}${per}`, useFor: 'gasoline, fun money, dining out', explain: `Use what is already in this category and fill it up to ${m}.` },
  ];
  if (custom) out.push({ id: 'haveBalance', label: `Have a balance of ${m}`, useFor: 'long-term savings', explain: 'Reach this amount by a specific time and refrain from spending until you reach it.' });
  return out;
}

/** "Feb 1 2027": YNAB's date style on the target card. */
export function shortDate(date: ISODate): string {
  const p = dateParts(date);
  return `${MONTHS[p.month - 1] ?? ''} ${String(p.day)} ${String(p.year)}`;
}

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${String(n)}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
};

export interface TargetCard {
  heading: string;
  subline: string;
  percent: number;
  status: TargetStatus;
  box: { tone: 'warn' | 'good' | 'plain'; text: string; assign?: Minor } | null;
  lines: { label: string; value: Minor }[];
}

function every(c: TargetCadence): string {
  if (c.kind === 'weekly') return ' Each Week';
  if (c.kind === 'monthly') return ' Each Month';
  if (c.kind === 'yearly') return ' Each Year';
  const r = c.repeatEveryMonths;
  if (r === undefined) return '';
  if (r % 12 === 0) return r === 12 ? ' Each Year' : ` Every ${String(r / 12)} Years`;
  return r === 1 ? ' Each Month' : ` Every ${String(r)} Months`;
}

/** The target card's text for a month. */
export function targetCard(target: Target, tm: TargetMonth, cm: CategoryMonth, fmt: MoneyFormat): TargetCard {
  const money = (m: Minor): string => formatMoney(m, fmt);
  const c = target.cadence;
  const lead =
    target.behavior === 'haveBalance' ? 'Have a Balance of' : target.behavior === 'refill' ? 'Refill Up to' : c.kind === 'custom' && c.repeatEveryMonths === undefined ? 'Set Aside' : 'Set Aside Another';
  const heading = `${lead} ${money(target.amount)}${target.behavior === 'haveBalance' ? '' : every(c)}`;
  const due = tm.dueDate;
  const subline =
    c.kind === 'weekly'
      ? `Every ${WEEKDAYS[c.weekday] ?? ''}`
      : c.kind === 'monthly'
        ? c.day === 'last'
          ? 'By the last day of the month'
          : `By the ${ordinal(c.day)}`
        : due !== undefined
          ? `By ${shortDate(due)}`
          : 'Eventually';

  let box: TargetCard['box'];
  if (tm.status === 'snoozed') box = { tone: 'plain', text: 'Snoozed for this month: it asks for nothing until next month.' };
  else if (tm.status === 'inactive') box = { tone: 'plain', text: 'This target’s date has passed.' };
  else if (tm.underfunded > 0) box = { tone: 'warn', text: `Assign ${money(tm.underfunded)} more this month to stay on track`, assign: tm.underfunded };
  else if (target.behavior === 'haveBalance' && c.kind === 'custom' && c.due === undefined && tm.toGo > 0) {
    // YNAB, no date: "If you assign $200.00 each month, you will meet your target in 24 months."
    box = cm.assigned > 0 ? { tone: 'good', text: `If you assign ${money(cm.assigned)} each month, you will meet your target in ${String(Math.ceil(tm.toGo / cm.assigned))} months.` } : { tone: 'plain', text: 'Assign any amount each month to work toward it.' };
  } else if (tm.toGo === 0) box = { tone: 'good', text: 'You’ve met your target!' };
  else box = { tone: 'good', text: 'On track.' };

  const dueText = due === undefined ? null : shortDate(due);
  let lines: TargetCard['lines'];
  if (target.behavior === 'haveBalance') lines = [{ label: 'Balance Needed', value: target.amount }, { label: 'Current Balance', value: tm.funded }];
  else if (target.behavior === 'refill') lines = [{ label: dueText !== null && c.kind !== 'monthly' && c.kind !== 'weekly' ? `Needed by ${dueText}` : 'Needed This Month', value: tm.needed }, { label: 'Funded', value: tm.funded }];
  else lines = [{ label: dueText !== null && c.kind !== 'monthly' && c.kind !== 'weekly' ? `Total to Assign by ${dueText}` : 'Needed This Month', value: tm.needed }, { label: 'Assigned So Far', value: tm.funded }];
  lines.push({ label: 'To Go', value: tm.toGo });
  return { heading, subline, percent: tm.progressPercent, status: tm.status, box, lines };
}

/** The suggestion under "I need": average spending over the last three months, when there is any. */
export function suggestion(model: PlanModel, categoryId: Id): Minor | null {
  return suggestTargetAmount(model.state, categoryId, model.month);
}
