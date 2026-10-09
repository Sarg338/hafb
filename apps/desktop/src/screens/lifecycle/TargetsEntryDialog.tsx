// Quick target re-entry after a YNAB import (S7.2, CLAUDE.md §6.13): YNAB's export has no targets,
// so each category gets a target choice and an amount, prefilled with its average assigned over the
// last three months. Everything is saved as one undo step; the full editor is in the inspector.
import { useMemo, useState } from 'react';
import { ZERO, type ISODate, type Minor, type MoneyFormat } from '@hafb/shared';
import type { PlanData, TargetEntry } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { suggestedAmount, TARGET_CHOICES, targetFor, type TargetChoice } from './lifecycleModel.ts';
import styles from './Lifecycle.module.css';

interface Row {
  categoryId: string;
  group: string;
  name: string;
}

const CHOICE_GROUPS = [{ id: 'targets', label: 'Target', options: TARGET_CHOICES.map((c) => ({ id: c.id, label: c.label })) }];

export function TargetsEntryDialog({
  plan,
  rows,
  today,
  format,
  onClose,
  onSave,
}: {
  plan: PlanData;
  rows: readonly Row[];
  today: ISODate;
  format: MoneyFormat;
  onClose: () => void;
  onSave: (targets: TargetEntry[]) => void;
}) {
  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.categoryId, suggestedAmount(plan, r.categoryId, today)])), [plan, rows, today]);
  const [amounts, setAmounts] = useState<Record<string, Minor>>(initial);
  const [choices, setChoices] = useState<Record<string, TargetChoice>>({});
  const targets = rows.flatMap((r) => {
    const t = targetFor(r.categoryId, choices[r.categoryId] ?? 'none', amounts[r.categoryId] ?? ZERO, today);
    return t ? [t] : [];
  });
  return (
    <Dialog
      open
      onClose={onClose}
      size="large"
      title="Add your targets"
      description="YNAB’s export doesn’t include targets. Pick a target for the categories that had one; amounts start at what you assigned on average over the last three months."
      footer={
        <>
          <Button onClick={onClose}>Skip for now</Button>
          <Button
            variant="primary"
            disabled={targets.length === 0}
            onClick={() => {
              onSave(targets);
            }}
          >
            {targets.length === 0 ? 'Save targets' : `Save ${String(targets.length)} ${targets.length === 1 ? 'target' : 'targets'}`}
          </Button>
        </>
      }
    >
      <div className={styles.targetTable} role="table" aria-label="Targets to add">
        <div role="row" className={styles.targetHead}>
          <span role="columnheader">Category</span>
          <span role="columnheader">Target</span>
          <span role="columnheader">Amount</span>
        </div>
        {rows.map((r, i) => {
          const header = i === 0 || rows[i - 1]?.group !== r.group ? r.group : null;
          return (
            <div key={r.categoryId} role="rowgroup">
              {header !== null && (
                <div role="row" className={styles.targetGroup}>
                  <span role="cell">{header}</span>
                </div>
              )}
              <div role="row" className={styles.targetRow}>
                <span role="cell">{r.name}</span>
                <span role="cell">
                  <Combobox
                    label={`Target for ${r.name}`}
                    groups={CHOICE_GROUPS}
                    value={choices[r.categoryId] ?? 'none'}
                    onChange={(id) => {
                      const choice = TARGET_CHOICES.find((c) => c.id === id)?.id;
                      if (choice) setChoices({ ...choices, [r.categoryId]: choice });
                    }}
                  />
                </span>
                <span role="cell">
                  <MoneyInput
                    label={`Amount for ${r.name}`}
                    hideLabel
                    value={amounts[r.categoryId] ?? ZERO}
                    format={format}
                    onCommit={(v) => {
                      setAmounts({ ...amounts, [r.categoryId]: v });
                    }}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
