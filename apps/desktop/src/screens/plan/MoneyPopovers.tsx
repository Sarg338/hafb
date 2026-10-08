// Moving money on the Plan (S4.3), in the shapes YNAB uses (observed in the YNAB trial, 2026-10-08):
// - Move: "Move [amount, default the full Available] To [category]", Cancel / OK.
// - Cover overspending from [source], Cancel / OK (the whole overspending, or what the source has).
// - Fix This (negative Ready to Assign): "Un-assign money from [category]", Cancel / OK.
// - Assign: tabs Auto (the auto-assign options with amounts) and Manually ("Assign [amount] To").
// - Ready to Assign Breakdown: the non-zero lines and the total.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Id } from '@hafb/engine';
import { minor, type Minor, type MoneyFormat } from '@hafb/shared';
import { Button } from '../../ui/Button.tsx';
import { CategoryPicker } from '../../ui/CategoryPicker.tsx';
import { cx } from '../../ui/cx.ts';
import { Icon } from '../../ui/Icon.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { Popover } from '../../ui/Popover.tsx';
import type { Rect } from '../../ui/position.ts';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import type { MoneyText } from '../shared/money.ts';
import type { AssignChoice } from './assignOptions.ts';
import styles from './MoneyPopovers.module.css';
import type { Breakdown, PickerOptions } from './moneyMoves.ts';

type Anchor = RefObject<HTMLElement | null> | Rect;

function Shell({ anchor, label, onClose, children, placement = 'bottom-end' }: { anchor: Anchor; label: string; onClose: () => void; children: ReactNode; placement?: 'bottom-end' | 'bottom-start' | 'bottom' }) {
  return (
    <Popover open onClose={onClose} anchor={anchor} placement={placement} role="dialog" label={label} className={styles.popover}>
      {children}
    </Popover>
  );
}

function Actions({ onClose, submitLabel, disabled }: { onClose: () => void; submitLabel: string; disabled: boolean }) {
  return (
    <div className={styles.actions}>
      <Button size="small" onClick={onClose}>
        Cancel
      </Button>
      <Button size="small" variant="primary" type="submit" disabled={disabled}>
        {submitLabel}
      </Button>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className={styles.label}>{children}</div>;
}

/** The amount field: focused with its text selected, like YNAB's. */
function AmountField({ value, format, label, onChange }: { value: Minor; format: MoneyFormat; label: string; onChange: (m: Minor) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <MoneyInput ref={ref} value={value} format={format} label={label} hideLabel variant="field" size="compact" onCommit={onChange} />;
}

// ---- move ------------------------------------------------------------------------------------------

export function MovePopover({
  anchor,
  available,
  format,
  targets,
  onSubmit,
  onClose,
}: {
  anchor: Anchor;
  available: Minor;
  format: MoneyFormat;
  targets: PickerOptions;
  onSubmit: (to: Id, amount: Minor) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<Minor>(available > 0 ? available : minor(0));
  const [to, setTo] = useState<Id | null>(null);
  const form = useRef<HTMLFormElement>(null);
  return (
    <Shell anchor={anchor} label="Move money" onClose={onClose}>
      <form
        ref={form}
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (to === null || amount <= 0) return;
          onSubmit(to, amount);
        }}
      >
        <Label>Move</Label>
        <AmountField value={amount} format={format} label="Amount to move" onChange={setAmount} />
        <Label>To</Label>
        <CategoryPicker groups={targets.groups} available={targets.amounts} format={format} value={to} onChange={setTo} size="compact" />
        <Actions onClose={onClose} submitLabel="OK" disabled={to === null || amount <= 0} />
      </form>
    </Shell>
  );
}

// ---- cover / un-assign ----------------------------------------------------------------------------

export function SourcePopover({
  anchor,
  title,
  format,
  sources,
  onSubmit,
  onClose,
  empty,
}: {
  anchor: Anchor;
  /** "Cover overspending from" or "Un-assign money from". */
  title: string;
  format: MoneyFormat;
  sources: PickerOptions;
  onSubmit: (sourceId: string) => void;
  onClose: () => void;
  empty: string;
}) {
  const [from, setFrom] = useState<string | null>(null);
  const none = sources.groups.length === 0;
  return (
    <Shell anchor={anchor} label={title} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (from !== null) onSubmit(from);
        }}
      >
        <Label>{title}</Label>
        {none ? (
          <p className={styles.note}>{empty}</p>
        ) : (
          <CategoryPicker groups={sources.groups} available={sources.amounts} format={format} value={from} onChange={setFrom} size="compact" autoFocus />
        )}
        <Actions onClose={onClose} submitLabel="OK" disabled={from === null} />
      </form>
    </Shell>
  );
}

// ---- assign (Auto / Manually) ---------------------------------------------------------------------

export function AssignPopover({
  anchor,
  readyToAssign,
  format,
  money,
  choices,
  targets,
  onAuto,
  onManual,
  onClose,
}: {
  anchor: Anchor;
  readyToAssign: Minor;
  format: MoneyFormat;
  money: MoneyText;
  choices: readonly AssignChoice[];
  targets: PickerOptions;
  onAuto: (choice: AssignChoice) => void;
  onManual: (to: Id, amount: Minor) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'auto' | 'manual'>('auto');
  const [amount, setAmount] = useState<Minor>(readyToAssign > 0 ? readyToAssign : minor(0));
  const [to, setTo] = useState<Id | null>(null);
  return (
    <Shell anchor={anchor} label="Assign" onClose={onClose} placement="bottom">
      <div className={styles.tabs}>
        <SegmentedControl
          label="How to assign"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'manual', label: 'Manually' },
          ]}
        />
      </div>
      {tab === 'auto' ? (
        <div className={styles.choices} role="list">
          {choices.map((c, i) => (
            <div key={c.id} role="listitem" className={cx(i > 0 && choices[i - 1]?.group !== c.group && styles.gap)}>
              <button
                type="button"
                className={styles.choice}
                disabled={c.commit.deltas.length === 0}
                autoFocus={i === 0}
                onClick={() => {
                  onAuto(c);
                }}
              >
                <span>{c.label}</span>
                <span className={styles.amount}>{money(c.change.total)}</span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (to !== null && amount > 0) onManual(to, amount);
          }}
        >
          <Label>Assign</Label>
          <AmountField value={amount} format={format} label="Amount to assign" onChange={setAmount} />
          <Label>To</Label>
          <CategoryPicker groups={targets.groups} available={targets.amounts} format={format} value={to} onChange={setTo} size="compact" />
          <Actions onClose={onClose} submitLabel="Assign" disabled={to === null || amount <= 0} />
        </form>
      )}
    </Shell>
  );
}

// ---- breakdown -------------------------------------------------------------------------------------

export function BreakdownPopover({ anchor, breakdown, money, onClose }: { anchor: Anchor; breakdown: Breakdown; money: MoneyText; onClose: () => void }) {
  const signed = (m: Minor): string => (m > 0 ? `+${money(m)}` : money(m));
  const block = (lines: Breakdown['plus'], sign: 'plus' | 'minus') =>
    lines.length === 0 ? null : (
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <Icon name={sign === 'plus' ? 'add' : 'subtract'} className={cx(styles.sign, sign === 'minus' && styles.minus)} />
          <span className={styles.amount}>{signed(minor(lines.reduce((s, l) => s + l.amount, 0)))}</span>
        </div>
        {lines.map((l) => (
          <div key={l.label} className={styles.line}>
            <span>{l.label}</span>
            <span className={styles.amount}>{signed(l.amount)}</span>
          </div>
        ))}
      </div>
    );
  return (
    <Shell anchor={anchor} label="Ready to Assign Breakdown" onClose={onClose} placement="bottom">
      <div className={styles.breakdown}>
        <h2 className={styles.title}>Ready to Assign Breakdown</h2>
        <div className={styles.card}>
          {block(breakdown.plus, 'plus')}
          {block(breakdown.minus, 'minus')}
          <div className={cx(styles.line, styles.total)}>
            <span>Total Ready to Assign</span>
            <span className={cx(styles.amount, breakdown.total < 0 && styles.negative)}>= {signed(breakdown.total)}</span>
          </div>
          <p className={styles.note}>{breakdown.note}</p>
        </div>
      </div>
    </Shell>
  );
}
