// The register's View Options (YNAB, observed 2026-10-08): date presets (This Month, Last Month,
// Latest 3 Months, This Year, Last Year, All Dates), a From/To month range, and Show Reconciled
// Transactions / Show Flags; single-account registers also offer Show Running Balance (YNAB keeps it
// per register). Nothing applies until Apply.
import { useMemo, useState, type RefObject } from 'react';
import { addMonths, compareMonths, monthOf, monthParts, type ISODate, type Month } from '@hafb/shared';
import type { RegisterViewPref } from '../../shell/prefs.ts';
import { Button } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { Popover } from '../../ui/Popover.tsx';
import { DATE_PRESETS, presetRange, type DatePreset } from './registerModel.ts';
import styles from './RegisterScreen.module.css';

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: Month): string => `${LONG[monthParts(m).month - 1] ?? ''} ${String(monthParts(m).year)}`;

export interface ViewOptionsProps {
  anchor: RefObject<HTMLElement | null>;
  view: RegisterViewPref;
  /** First month with a transaction (the From list starts there). */
  firstMonth: Month;
  today: ISODate;
  singleAccount: boolean;
  onApply: (view: RegisterViewPref) => void;
  onClose: () => void;
}

const isPreset = (id: string): id is DatePreset => DATE_PRESETS.some((p) => p.id === id);

export function ViewOptions({ anchor, view, firstMonth, today, singleAccount, onApply, onClose }: ViewOptionsProps) {
  const [draft, setDraft] = useState<RegisterViewPref>(view);
  const now = monthOf(today);
  const months = useMemo(() => {
    const out: Month[] = [];
    const end = addMonths(now, 120);
    for (let m = compareMonths(firstMonth, now) < 0 ? firstMonth : now; compareMonths(m, end) <= 0; m = addMonths(m, 1)) out.push(m);
    return out;
  }, [firstMonth, now]);
  const options = [{ id: 'months', label: 'Months', options: months.map((m) => ({ id: m, label: monthLabel(m) })) }];
  // The range the From/To fields show: a preset's months, or the custom ones.
  const range = isPreset(draft.preset) ? presetRange(draft.preset, today) : draft.from !== undefined && draft.to !== undefined ? { from: draft.from, to: draft.to } : null;
  const from = range?.from ?? months[0] ?? now;
  const to = range?.to ?? months.at(-1) ?? now;
  const pickMonth = (which: 'from' | 'to', id: string): void => {
    const m = months.find((x) => x === id);
    if (m === undefined) return;
    let f = which === 'from' ? m : from;
    let t = which === 'to' ? m : to;
    if (compareMonths(f, t) > 0) [f, t] = which === 'from' ? [f, f] : [t, t];
    setDraft({ ...draft, preset: 'custom', from: f, to: t });
  };

  return (
    <Popover open onClose={onClose} anchor={anchor} placement="bottom-end" role="dialog" label="View Options" className={styles.viewOptions}>
      <h2 className={styles.viewTitle}>View Options</h2>
      <div className={styles.presets} role="group" aria-label="Dates">
        {DATE_PRESETS.map((p) => (
          <Button key={p.id} size="small" variant={draft.preset === p.id ? 'primary' : 'toolbar'} aria-pressed={draft.preset === p.id} onClick={() => { setDraft({ ...draft, preset: p.id }); }}>
            {p.label}
          </Button>
        ))}
      </div>
      <div className={styles.range}>
        <span>From:</span>
        <Combobox label="From month" size="compact" groups={options} value={from} onChange={(id) => { pickMonth('from', id); }} />
        <span>To:</span>
        <Combobox label="To month" size="compact" groups={options} value={to} onChange={(id) => { pickMonth('to', id); }} />
      </div>
      <div className={styles.viewChecks}>
        <Checkbox label="Show Reconciled Transactions" checked={draft.showReconciled} onChange={(v) => { setDraft({ ...draft, showReconciled: v }); }} />
        <Checkbox label="Show Flags" checked={draft.showFlags} onChange={(v) => { setDraft({ ...draft, showFlags: v }); }} />
        {singleAccount && <Checkbox label="Show Running Balance" checked={draft.runningBalance} onChange={(v) => { setDraft({ ...draft, runningBalance: v }); }} />}
      </div>
      <div className={styles.viewActions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply
        </Button>
      </div>
    </Popover>
  );
}
