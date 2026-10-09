// The transactions behind a report figure (S6.1, RF-02). YNAB (trial, 2026-10-09) shows a popover
// titled with the category, columns Account / Date / Payee / Memo / Amount, newest first, and a
// Close button; a transaction opens in its register for editing (YNAB help: Spending Trends,
// Income v Expense).
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { ReportLine } from '@hafb/engine';
import { formatDate, minor, type Minor } from '@hafb/shared';
import type { PlanData } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { Popover } from '../../ui/Popover.tsx';
import type { Rect } from '../../ui/position.ts';
import styles from './Reflect.module.css';

export interface DrillDownProps {
  anchor: Rect | RefObject<HTMLElement | null>;
  title: string;
  subtitle: string;
  lines: readonly ReportLine[];
  plan: PlanData;
  money: (m: Minor) => string;
  onOpen: (accountId: string, transactionId: string) => void;
  onClose: () => void;
}

export function DrillDown({ anchor, title, subtitle, lines, plan, money, onOpen, onClose }: DrillDownProps) {
  const accounts = new Map(plan.accounts.map((a) => [a.id, a.name]));
  const payees = new Map(plan.payees.map((p) => [p.id, p.name]));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const signed = (m: Minor): string => (m > 0 ? `+${money(m)}` : money(m));
  const open = (l: ReportLine) => {
    onOpen(l.accountId, l.transactionId);
  };
  return (
    <Popover open onClose={onClose} anchor={anchor} placement="bottom-start" role="dialog" label={`${title} transactions`} className={styles.drill}>
      <div className={styles.drillHead}>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      <div className={styles.drillBody}>
        <table className={styles.drillTable}>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Date</th>
              <th scope="col">Payee</th>
              <th scope="col">Memo</th>
              <th scope="col" className={styles.num}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr
                key={`${l.transactionId}:${l.subtransactionId ?? ''}`}
                tabIndex={0}
                title="Open in the register"
                onClick={() => {
                  open(l);
                }}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter') open(l);
                }}
              >
                <td>{accounts.get(l.accountId) ?? ''}</td>
                <td>{formatDate(l.date, plan.settings.dateFormat)}</td>
                <td>{l.payeeId === undefined ? '' : (payees.get(l.payeeId) ?? '')}</td>
                <td>{l.memo ?? ''}</td>
                <td className={styles.num}>{signed(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.drillFoot}>
        <span>
          {lines.length} {lines.length === 1 ? 'transaction' : 'transactions'} · {signed(minor(total))}
        </span>
        <Button ref={closeRef} variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Popover>
  );
}
