import type { ReactNode } from 'react';
import styles from './Banner.module.css';
import { Icon, type IconName } from './Icon.tsx';

export type RtaState = 'positive' | 'zero' | 'negative';

/** The Ready to Assign banner (DESIGN.md): amount, caption, and the Assign action. */
export function RtaBanner({ state, amount, action }: { state: RtaState; amount: string; action?: ReactNode }) {
  const caption = state === 'zero' ? 'All Money Assigned' : state === 'negative' ? 'You assigned more than you have' : 'Ready to Assign';
  return (
    <div className={styles.rta} data-state={state} role="status" aria-live="polite">
      <div>
        <div className={styles.amount}>{amount}</div>
        <div className={styles.caption}>{caption}</div>
      </div>
      {action}
    </div>
  );
}

/** An in-page notice (approval needed, uncategorized transactions, errors) with optional actions. */
export function Notice({
  tone = 'info',
  icon,
  children,
  actions,
}: {
  tone?: 'info' | 'warning' | 'error';
  icon?: IconName;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const fallback: IconName = tone === 'info' ? 'info' : 'warning';
  return (
    <div className={styles.notice} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon ?? fallback} className={styles.noticeIcon} />
      <div className={styles.noticeText}>{children}</div>
      {actions && <div className={styles.noticeActions}>{actions}</div>}
    </div>
  );
}
