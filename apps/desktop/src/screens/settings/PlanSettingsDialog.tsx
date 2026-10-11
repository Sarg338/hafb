// Plan Settings and New Plan (S7.1, S7.2), laid out as YNAB's dialog (checked 2026-10-09): Plan
// Name; Currency and Currency Placement side by side; Number Format; Date Format; Cancel and
// "Apply Settings" (or "Create Plan").
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import { CURRENCY_GROUPS, dateFormatOptions, numberFormatOptions, placementOptions, withCurrency, type SettingsDraft } from './settingsModel.ts';
import styles from './Settings.module.css';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel} aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

const group = (id: string, label: string, options: { id: string; label: string }[]) => [{ id, label, options }];

export function PlanSettingsDialog({
  mode,
  initial,
  year,
  onClose,
  onSubmit,
  extra,
}: {
  mode: 'edit' | 'new';
  initial: SettingsDraft;
  /** The year the date-format samples show (YNAB: December 30 of this year). */
  year: number;
  onClose: () => void;
  onSubmit: (draft: SettingsDraft) => void;
  /** More fields under the formats (New Plan's "Start with"; Plan Settings' Password section). */
  extra?: React.ReactNode;
}) {
  const [draft, setDraft] = useState(initial);
  const valid = draft.name.trim() !== '';
  const submit = (): void => {
    if (!valid) return;
    onSubmit({ ...draft, name: draft.name.trim() });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'edit' ? 'Plan Settings' : 'New Plan'}
      {...(mode === 'new' ? { description: 'A plan is one file on your PC. After this you choose where to save it.' } : {})}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {mode === 'edit' ? 'Apply Settings' : 'Create Plan'}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextInput
          label="Plan Name"
          value={draft.name}
          autoFocus
          onChange={(e) => {
            setDraft({ ...draft, name: e.target.value });
          }}
          {...(valid ? {} : { error: 'Give your plan a name.' })}
        />
        <div className={styles.pair}>
          <Field label="Currency">
            <Combobox
              label="Currency"
              size="medium"
              groups={CURRENCY_GROUPS}
              value={draft.currencyCode}
              onChange={(code) => {
                setDraft(withCurrency(draft, code));
              }}
            />
          </Field>
          <Field label="Currency Placement">
            <Combobox
              label="Currency Placement"
              size="medium"
              groups={group('placement', 'Currency Placement', placementOptions(draft))}
              value={draft.placement}
              onChange={(id) => {
                const p = placementOptions(draft).find((o) => o.id === id);
                if (p) setDraft({ ...draft, placement: p.id });
              }}
            />
          </Field>
        </div>
        <Field label="Number Format">
          <Combobox
            label="Number Format"
            size="medium"
            groups={group('numbers', 'Number Format', numberFormatOptions(draft.decimals))}
            value={draft.numberFormat}
            onChange={(id) => {
              setDraft({ ...draft, numberFormat: id });
            }}
          />
        </Field>
        <Field label="Date Format">
          <Combobox
            label="Date Format"
            size="medium"
            groups={group('dates', 'Date Format', dateFormatOptions(year))}
            value={draft.dateFormat}
            onChange={(id) => {
              setDraft({ ...draft, dateFormat: id });
            }}
          />
        </Field>
        {mode === 'edit' && draft.decimals !== initial.decimals && (
          <p className={styles.note} role="note">
            Amounts keep every digit you entered; {draft.decimals === 0 ? 'they show without decimals' : `they show with ${String(draft.decimals)} decimals`} in this currency.
          </p>
        )}
        {extra}
      </form>
    </Dialog>
  );
}
