// The target editor (S5.2), inline in the inspector's Target card as YNAB has it (trial, 2026-10-08):
// Weekly | Monthly | Yearly | Custom; "I need" (Custom: "Amount") with a suggestion from history;
// "Every" (weekday) / "By" (day or date) / "Due on"; the behavior chooser with YNAB's explanations;
// Custom's Repeat every N months or years; Delete, Cancel, Save Target.
// A category paired with a loan gets YNAB's Monthly Debt Payment target instead (S6.4): a monthly
// payment with its payoff calculator (enter a payment → payoff date and interest saved; pick a
// payoff date → the payment) and the day payments are due.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LoanTerms, Target } from '@hafb/engine';
import { asMonth, compareMonths, formatMoney, monthOf, monthParts, ZERO as ZERO_MINOR, type ISODate, type Minor, type MoneyFormat } from '@hafb/shared';
import { Button } from '../../ui/Button.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { DateInput } from '../../ui/DateInput.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { Popover } from '../../ui/Popover.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { Toggle } from '../../ui/Toggle.tsx';
import { durationText, paymentForPayoff, payoffMonths, simulate } from '../shared/loanModel.ts';
import { monthLong } from '../reflect/reflectModel.ts';
import { behaviorOptions, behaviorPrompt, CADENCES, CARD_TARGETS, cardDraftFor, cardTargetArgs, draftFor, toTargetArgs, WEEKDAYS, withCadence, type CadenceKind, type CardTargetDraft, type DraftResult, type TargetDraft } from './targetModel.ts';
import styles from './Inspector.module.css';

export interface TargetEditorProps {
  target: Target | undefined;
  today: ISODate;
  fmt: MoneyFormat;
  dateFormat: string;
  /** Average recent spending, offered under "I need". */
  suggestion: Minor | null;
  onSave: (args: Extract<DraftResult, { ok: true }>['args']) => void;
  onDelete?: () => void;
  onCancel: () => void;
  /** The paired loan: the editor becomes a Monthly Debt Payment with its payoff calculator. */
  debt?: LoanTerms | undefined;
}

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${String(n)}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
};
const DAY_OPTIONS = [{ id: 'last', label: 'Last Day of Month' }, ...Array.from({ length: 31 }, (_, i) => ({ id: String(i + 1), label: `${ordinal(i + 1)} of the month` }))];
const WEEKDAY_OPTIONS = WEEKDAYS.map((w, i) => ({ id: String(i), label: w }));
const EVERY_OPTIONS = Array.from({ length: 24 }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }));

export function TargetEditor({ target, today, fmt, dateFormat, suggestion, onSave, onDelete, onCancel, debt }: TargetEditorProps) {
  const [d, setD] = useState<TargetDraft>(() => {
    const base = draftFor(target, today);
    return debt && !target ? { ...base, kind: 'monthly', behavior: 'setAside', amount: debt.monthlyPayment } : base;
  });
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const chooser = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    amountRef.current?.focus();
  }, []);
  const options = behaviorOptions(d.kind, d.amount, fmt);
  const current = options.find((o) => o.id === d.behavior) ?? options[0];
  const patch = (p: Partial<TargetDraft>): void => {
    setD({ ...d, ...p });
    setError(null);
  };
  const save = (draft: TargetDraft = d): void => {
    const r = toTargetArgs(draft);
    if (r.ok) onSave(r.args);
    else setError(r.error);
  };

  return (
    <div className={styles.targetEditor} role="group" aria-label="Target">
      {debt ? (
        <p className={styles.targetHeading}>Monthly Debt Payment</p>
      ) : (
        <SegmentedControl<CadenceKind>
          label="How often"
          options={CADENCES.map((c) => ({ value: c.id, label: c.label }))}
          value={d.kind}
          onChange={(kind) => {
            setD(withCadence(d, kind));
          }}
        />
      )}
      <MoneyInput
        ref={amountRef}
        label={debt ? 'Monthly payment' : d.kind === 'custom' ? 'Amount' : 'I need'}
        variant="field"
        value={d.amount}
        format={fmt}
        onCommit={(v) => {
          patch({ amount: v });
        }}
        onEnter={(amount) => {
          save({ ...d, amount });
        }}
      />
      {debt && <DebtCalculator terms={debt} today={today} payment={d.amount} fmt={fmt} onPick={(amount) => { patch({ amount }); }} />}
      {!debt && suggestion !== null && d.amount !== suggestion && (
        <button
          type="button"
          className={styles.suggestion}
          onClick={() => {
            patch({ amount: suggestion });
          }}
        >
          <Icon name="history" /> Use {formatMoney(suggestion, fmt)}, your average spending over the last 3 months
        </button>
      )}
      {d.kind === 'weekly' && (
        <Labelled text="Every">
          <Combobox label="Every" groups={[{ id: 'days', label: 'Days', options: WEEKDAY_OPTIONS }]} value={String(d.weekday)} onChange={(id) => { patch({ weekday: Number(id) }); }} />
        </Labelled>
      )}
      {d.kind === 'monthly' && (
        <Labelled text={debt ? 'Due on' : 'By'}>
          <Combobox label={debt ? 'Due on' : 'By'} groups={[{ id: 'days', label: 'Days', options: DAY_OPTIONS }]} value={String(d.day)} onChange={(id) => { patch({ day: id === 'last' ? 'last' : Number(id) }); }} />
        </Labelled>
      )}
      {d.kind === 'yearly' && d.due !== null && <DateInput label="By" value={d.due} format={dateFormat} today={today} onCommit={(due) => { patch({ due }); }} />}

      {!debt && (
        <div className={styles.field}>
          <span className={styles.fieldLabel} id="target-behavior">
            {behaviorPrompt(d.kind)}
          </span>
          <button
            ref={chooser}
            type="button"
            className={styles.chooser}
            aria-haspopup="listbox"
            aria-expanded={choosing}
            aria-labelledby="target-behavior"
            onClick={() => {
              setChoosing(!choosing);
            }}
          >
            <span>{current?.label}</span>
            <Icon name="chevronDown" />
          </button>
        </div>
      )}
      {choosing && (
        <Popover open onClose={() => { setChoosing(false); }} anchor={chooser} placement="bottom-start" matchWidth role="listbox" label={behaviorPrompt(d.kind)} className={styles.behaviors}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === d.behavior}
              className={styles.behavior}
              onClick={() => {
                patch({ behavior: o.id, ...(o.id === 'haveBalance' ? { repeat: false } : {}) });
                setChoosing(false);
                chooser.current?.focus();
              }}
            >
              <span className={styles.behaviorTitle}>
                {o.id === d.behavior && <Icon name="checkmark" />}
                {o.label}
                {o.hint && <span className={styles.hint}>{o.hint}</span>}
              </span>
              <span className={styles.note}>Use for: {o.useFor}</span>
              <span className={styles.note}>{o.explain}</span>
            </button>
          ))}
        </Popover>
      )}

      {d.kind === 'custom' && (
        <>
          {d.due !== null ? (
            <DateInput label="Due on" value={d.due} format={dateFormat} today={today} onCommit={(due) => { patch({ due }); }} />
          ) : (
            <p className={styles.note}>No date: it fills over time (“Eventually”).</p>
          )}
          {d.behavior === 'haveBalance' && (
            <Toggle
              label="Set a due date"
              checked={d.due !== null}
              onChange={(on) => {
                patch({ due: on ? draftFor(undefined, today).due : null });
              }}
            />
          )}
          {d.behavior !== 'haveBalance' && (
            <Toggle
              label="Repeat"
              checked={d.repeat}
              onChange={(repeat) => {
                patch({ repeat });
              }}
            />
          )}
          {d.repeat && d.behavior !== 'haveBalance' && (
            <Labelled text="Every">
            <div className={styles.every}>
              <Combobox label="Every" groups={[{ id: 'n', label: 'Count', options: EVERY_OPTIONS }]} value={String(d.every)} onChange={(id) => { patch({ every: Number(id) }); }} />
              <Combobox
                label="Unit"
                groups={[{ id: 'u', label: 'Unit', options: [{ id: 'month', label: d.every === 1 ? 'Month' : 'Months' }, { id: 'year', label: d.every === 1 ? 'Year' : 'Years' }] }]}
                value={d.unit}
                onChange={(id) => {
                  patch({ unit: id === 'year' ? 'year' : 'month' });
                }}
              />
            </div>
            </Labelled>
          )}
        </>
      )}

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.editorActions}>
        {onDelete && (
          <Button variant="danger" icon="dismiss" onClick={onDelete}>
            Delete
          </Button>
        )}
        <span className={styles.grow} />
        <Button variant="toolbar" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            save();
          }}
        >
          Save Target
        </Button>
      </div>
    </div>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A credit card payment category's target (T-12), as YNAB's (trial, 2026-10-12): "Pay Off Balance
 * by Date" with a month and a year, or "Pay Specific Amount Monthly" with an amount.
 */
export function CardTargetEditor({ target, today, fmt, onSave, onDelete, onCancel }: Omit<TargetEditorProps, 'suggestion' | 'debt' | 'dateFormat'>) {
  const [d, setD] = useState<CardTargetDraft>(() => cardDraftFor(target, today));
  const [error, setError] = useState<string | null>(null);
  const first = monthOf(today);
  const { year: thisYear } = monthParts(first);
  const { year, month } = monthParts(d.month);
  const years = Array.from({ length: 31 }, (_, i) => thisYear + i);
  const setMonth = (y: number, m: number): void => {
    const picked = asMonth(`${String(y)}-${String(m).padStart(2, '0')}`);
    setD({ ...d, month: compareMonths(picked, first) < 0 ? first : picked });
    setError(null);
  };
  const save = (draft: CardTargetDraft = d): void => {
    const r = cardTargetArgs(draft);
    if (r.ok) onSave(r.args);
    else setError(r.error);
  };
  return (
    <div className={styles.targetEditor} role="group" aria-label="Target">
      <Combobox
        label="Target"
        size="medium"
        groups={[{ id: 'kinds', label: 'Credit card targets', options: CARD_TARGETS.map((k) => ({ id: k.id, label: k.label })) }]}
        value={d.kind}
        onChange={(id) => {
          setD({ ...d, kind: id === 'monthly' ? 'monthly' : 'payOff' });
          setError(null);
        }}
      />
      {d.kind === 'payOff' ? (
        <div className={styles.every}>
          <Combobox label="Pay off by month" size="medium" groups={[{ id: 'm', label: 'Month', options: MONTH_NAMES.map((name, i) => ({ id: String(i + 1), label: name })) }]} value={String(month)} onChange={(id) => { setMonth(year, Number(id)); }} />
          <Combobox label="Pay off by year" size="medium" groups={[{ id: 'y', label: 'Year', options: years.map((y) => ({ id: String(y), label: String(y) })) }]} value={String(year)} onChange={(id) => { setMonth(Number(id), month); }} />
        </div>
      ) : (
        <MoneyInput label="Amount each month" variant="field" value={d.amount} format={fmt} onCommit={(amount) => { setD({ ...d, amount }); setError(null); }} onEnter={(amount) => { save({ ...d, amount }); }} />
      )}
      <p className={styles.note}>
        <Icon name="info" /> Making minimum payments? Choose Pay Specific Amount Monthly and enter your minimum payment.
      </p>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.editorActions}>
        {onDelete && (
          <Button variant="danger" icon="dismiss" onClick={onDelete}>
            Delete
          </Button>
        )}
        <span className={styles.grow} />
        <Button variant="toolbar" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            save();
          }}
        >
          Save Target
        </Button>
      </div>
    </div>
  );
}

/** YNAB's payoff calculator inside the Monthly Debt Payment target. */
function DebtCalculator({ terms, today, payment, fmt, onPick }: { terms: LoanTerms; today: ISODate; payment: Minor; fmt: MoneyFormat; onPick: (amount: Minor) => void }) {
  const result = simulate(terms, today, payment, ZERO_MINOR);
  const months = payoffMonths(terms, today);
  const payoff = result.ok ? result.value.plan.summary.payoffMonth : null;
  return (
    <div className={styles.debtCalc}>
      {result.ok ? (
        <p className={styles.note}>
          Pays off in <strong>{monthLong(result.value.plan.summary.payoffMonth)}</strong> ({durationText(result.value.plan.summary.months)})
          {result.value.interestSaved > 0 && (
            <>
              {' '}
              and saves <strong>{formatMoney(result.value.interestSaved, fmt)}</strong> in interest
            </>
          )}
          .
        </p>
      ) : (
        <p className={styles.note}>This payment doesn’t cover the interest and charges, so the loan never pays off.</p>
      )}
      <Labelled text="Or pick a payoff date">
        <Combobox
          label="Payoff date"
          groups={[{ id: 'months', label: 'Months', options: months.map((m) => ({ id: m, label: monthLong(m) })) }]}
          value={payoff !== null && months.includes(payoff) ? payoff : (months.at(-1) ?? '')}
          onChange={(id) => {
            const m = months.find((x) => x === id);
            if (m !== undefined) onPick(paymentForPayoff(terms, today, m));
          }}
        />
      </Labelled>
    </div>
  );
}

function Labelled({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel} aria-hidden="true">
        {text}
      </span>
      {children}
    </div>
  );
}
