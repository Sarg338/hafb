import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';
import { Icon, type IconName } from './Icon.tsx';

/**
 * A designed empty state (S7.5): an icon, what's missing, what to do, and the actions that do it.
 * First used by Reflect's reports (S6.1); the look is theirs.
 */
export function EmptyState({ title, body, icon = 'trending', actions }: { title: string; body: string; icon?: IconName; actions?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} size={20} />
      <h2>{title}</h2>
      <p>{body}</p>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
