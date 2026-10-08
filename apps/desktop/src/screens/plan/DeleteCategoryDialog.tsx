// Delete a category or a whole group (S4.2). YNAB asks where the history goes only when there is
// some: transactions, scheduled transactions or assigned money move to the category picked here, so
// Ready to Assign doesn't change. With no history it's a plain confirmation.
import { useMemo, useState } from 'react';
import type { Id } from '@hafb/engine';
import type { ISODate, Month } from '@hafb/shared';
import { categoryInUse, type CategoryUse, type PlanData } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { CategoryPicker } from '../../ui/CategoryPicker.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { categoryPickerData } from '../../ui/pickerData.ts';
import { moneyFormat } from './planModel.ts';
import styles from './PlanEditors.module.css';

export type DeleteTarget = { kind: 'category'; id: Id } | { kind: 'group'; id: Id };

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function describeUse(u: CategoryUse): string[] {
  const out: string[] = [];
  if (u.transactions > 0) out.push(plural(u.transactions, 'transaction', 'transactions'));
  if (u.scheduled > 0) out.push(plural(u.scheduled, 'scheduled transaction', 'scheduled transactions'));
  if (u.months > 0) out.push(`money assigned in ${plural(u.months, 'month', 'months')}`);
  return out;
}

export function DeleteCategoryDialog({
  plan,
  month,
  today,
  target,
  onClose,
  onDelete,
}: {
  plan: PlanData;
  month: Month;
  today: ISODate;
  target: DeleteTarget;
  onClose: () => void;
  onDelete: (reassignTo: Id | undefined) => void;
}) {
  const live = plan.categories.filter((c) => c.deletedAt === undefined);
  const members = target.kind === 'category' ? live.filter((c) => c.id === target.id) : live.filter((c) => c.groupId === target.id);
  const name = target.kind === 'category' ? (members[0]?.name ?? 'this category') : (plan.categoryGroups.find((g) => g.id === target.id)?.name ?? 'this group');
  const use = useMemo(() => {
    const total: CategoryUse = { transactions: 0, scheduled: 0, months: 0 };
    for (const c of members) {
      const u = categoryInUse(plan, c.id);
      total.transactions += u.transactions;
      total.scheduled += u.scheduled;
      total.months += u.months;
    }
    return total;
  }, [plan, members]);
  const facts = describeUse(use);
  const needsTarget = facts.length > 0;
  const excluded = new Set(members.map((c) => c.id));
  const picker = useMemo(() => {
    const data = categoryPickerData(plan, month, today);
    return { ...data, groups: data.groups.filter((g) => g.id !== 'inflow').map((g) => ({ ...g, options: g.options.filter((o) => !excluded.has(o.id)) })).filter((g) => g.options.length > 0) };
    // `excluded` follows `members`, which follows plan and target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, month, today, target]);
  const [to, setTo] = useState<Id | null>(null);
  const what = target.kind === 'category' ? `“${name}”` : `the “${name}” group and its ${plural(members.length, 'category', 'categories')}`;

  return (
    <Dialog
      open
      onClose={onClose}
      title={target.kind === 'category' ? `Delete ${name}?` : `Delete ${name}?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={needsTarget && to === null}
            onClick={() => {
              onClose();
              onDelete(needsTarget ? (to ?? undefined) : undefined);
            }}
          >
            {needsTarget ? 'Reassign and delete' : 'Delete'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {needsTarget ? (
          <>
            <p className={styles.lead}>Before deleting {what}, choose where its history goes:</p>
            <ul className={styles.facts}>
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <CategoryPicker groups={picker.groups} available={picker.available} format={moneyFormat(plan)} value={to} onChange={setTo} autoFocus />
            <p className={styles.lead}>Everything moves to that category, so Ready to Assign stays the same. Hiding keeps the history where it is.</p>
          </>
        ) : (
          <p className={styles.lead}>Nothing has been spent from or assigned to {what}, so nothing needs to move.</p>
        )}
      </div>
    </Dialog>
  );
}
