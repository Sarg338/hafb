// Plan Reset (CLAUDE.md §5.6; YNAB, Sep 2026): every unspent dollar goes back to Ready to Assign,
// including money assigned in future months; credit card payment categories keep theirs, and no
// category is left overspent. Nothing changes until Reset Plan; it is one undo step.
import { compareMonths, minor } from '@hafb/shared';
import { planReset, type PlanChange } from '@hafb/engine';
import { applyPlanChange } from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import type { MoneyText } from '../shared/money.ts';
import { monthName } from './PlanHeader.tsx';
import type { PlanModel } from './planModel.ts';
import styles from './PlanScreen.module.css';

/** What the reset does: money back from this month and from future months, and overspending covered. */
export function planResetPreview(model: PlanModel): { change: PlanChange; returned: number; fromFuture: number; covered: number } {
  const ids = Object.keys(model.ms.categories).filter((id) => model.plan.categories.some((c) => c.id === id));
  const change = planReset(model.state, model.month, ids, model.paymentIds);
  let returned = 0;
  let fromFuture = 0;
  let covered = 0;
  for (const d of change.deltas) {
    if (d.delta > 0) covered += d.delta;
    else if (compareMonths(d.month, model.month) > 0) fromFuture -= d.delta;
    else returned -= d.delta;
  }
  return { change, returned, fromFuture, covered };
}

export function PlanResetDialog({ model, money, actions, onClose }: { model: PlanModel; money: MoneyText; actions: Actions; onClose: () => void }) {
  const p = planResetPreview(model);
  const net = minor(p.returned + p.fromFuture - p.covered);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Plan Reset"
      description={`Start ${monthName(model.month)} over: every unspent dollar goes back to Ready to Assign so you can assign it again. Your transactions don’t change.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={p.change.deltas.length === 0}
            onClick={() => {
              onClose();
              actions.run((pl, ctx) => applyPlanChange(pl, ctx, { change: p.change, kind: 'planReset', label: 'Plan Reset' }), { announce: `Plan reset: ${money(net)} is back in Ready to Assign.` });
            }}
          >
            Reset Plan
          </Button>
        </>
      }
    >
      <dl className={styles.resetLines}>
        <div>
          <dt>From {monthName(model.month)}’s categories</dt>
          <dd>{money(minor(p.returned))}</dd>
        </div>
        <div>
          <dt>Assigned in future months</dt>
          <dd>{money(minor(p.fromFuture))}</dd>
        </div>
        {p.covered > 0 && (
          <div>
            <dt>Covering overspent categories</dt>
            <dd>{money(minor(0 - p.covered))}</dd>
          </div>
        )}
        <div className={styles.resetTotal}>
          <dt>Back to Ready to Assign</dt>
          <dd>{money(net)}</dd>
        </div>
      </dl>
      <p className={styles.dialogNote}>Credit card payment categories keep their money, so your card payments stay covered. You can undo this.</p>
    </Dialog>
  );
}
