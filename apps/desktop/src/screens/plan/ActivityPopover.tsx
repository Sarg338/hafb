// The Activity popover (YNAB, observed 2026-10-08): a click on a category's Activity lists its
// transactions this month. A credit card payment category adds YNAB's summary first: Spending,
// Returns, Total Spending | Funded Spending, Payments & Returns, Total Activity (§5.3).
import type { RefObject } from 'react';
import { formatDate, minor, type Minor } from '@hafb/shared';
import { Button } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { Popover } from '../../ui/Popover.tsx';
import type { ActivityLine, PaymentActivity } from '../shared/cardModel.ts';
import type { MoneyText } from '../shared/money.ts';
import styles from './ActivityPopover.module.css';

export interface ActivityPopoverProps {
  anchor: RefObject<HTMLElement | null>;
  category: string;
  lines: readonly ActivityLine[];
  /** Present for a credit card payment category. */
  summary: PaymentActivity | null;
  dateFormat: string;
  money: MoneyText;
  onClose: () => void;
}

/** "+$40.00" / "-$0.00": YNAB writes the summary's signs out. */
const signed = (m: Minor, money: MoneyText, negative: boolean): string => `${negative ? '-' : '+'}${money(minor(Math.abs(m))).replace(/^-/, '')}`;

export function ActivityPopover({ anchor, category, lines, summary, dateFormat, money, onClose }: ActivityPopoverProps) {
  return (
    <Popover open onClose={onClose} anchor={anchor} placement="bottom-end" role="dialog" label={`Activity: ${category}`} className={styles.popover}>
      <h2 className={styles.title}>Activity</h2>
      <p className={styles.subtitle}>{category}</p>
      {summary && (
        <dl className={styles.summary}>
          <div className={styles.column}>
            <div>
              <dt>Spending</dt>
              <dd>{signed(summary.spending, money, true)}</dd>
            </div>
            <div>
              <dt>Returns</dt>
              <dd>{signed(summary.returns, money, summary.returns <= 0)}</dd>
            </div>
            {summary.interest !== 0 && (
              <div>
                <dt>Credit Card Interest</dt>
                <dd>{signed(summary.interest, money, summary.interest < 0)}</dd>
              </div>
            )}
            <div className={styles.total}>
              <dt>Total Spending</dt>
              <dd>{signed(summary.totalSpending, money, summary.totalSpending <= 0)}</dd>
            </div>
          </div>
          <div className={styles.column}>
            <div>
              <dt>Funded Spending</dt>
              <dd>{signed(summary.funded, money, summary.funded < 0)}</dd>
            </div>
            <div>
              <dt>Payments &amp; Returns</dt>
              <dd>{signed(summary.paymentsAndReturns, money, summary.paymentsAndReturns <= 0)}</dd>
            </div>
            <div className={styles.total}>
              <dt>Total Activity</dt>
              <dd>{signed(summary.total, money, summary.total < 0)}</dd>
            </div>
          </div>
        </dl>
      )}
      {lines.length === 0 ? (
        <p className={styles.empty}>No transactions this month.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{summary ? 'Date' : 'Account'}</th>
                <th>{summary ? 'Payee' : 'Date'}</th>
                <th>{summary ? 'Category' : 'Payee'}</th>
                <th>Memo</th>
                <th className={styles.end}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{summary ? formatDate(l.date, dateFormat) : l.account}</td>
                  <td>{summary ? l.payee : formatDate(l.date, dateFormat)}</td>
                  <td>{summary ? l.category : l.payee}</td>
                  <td className={styles.muted}>{l.memo}</td>
                  <td className={cx(styles.end, styles.amount)}>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.actions}>
        <Button variant="primary" autoFocus onClick={onClose}>
          Close
        </Button>
      </div>
    </Popover>
  );
}
