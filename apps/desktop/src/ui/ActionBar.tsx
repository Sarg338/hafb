// Floating action bar for a multi-row selection (YNAB's register: "× 2 Transactions · Categorize ·
// Flag · Clear · More"). Drawn like the approved toast (inverted, bottom centre); while it shows,
// toasts sit above it. A toolbar: Tab reaches it, arrow keys move between its buttons.
import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon, type IconName } from './Icon.tsx';
import styles from './ActionBar.module.css';

export interface ActionBarProps {
  /** What is selected, e.g. "2 Transactions". */
  label: string;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}

export function ActionBar({ label, onClear, children, className }: ActionBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = buttons.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };
  return (
    <div ref={ref} role="toolbar" aria-label={`Selection: ${label}`} data-action-bar="" className={cx(styles.bar, className)} onKeyDown={onKeyDown}>
      <button type="button" className={styles.item} aria-label={`Clear selection (${label})`} title="Clear selection (Esc)" onClick={onClear}>
        <Icon name="dismiss" />
        <span className={styles.count}>{label}</span>
      </button>
      <span className={styles.rule} aria-hidden="true" />
      {children}
    </div>
  );
}

export interface ActionBarButtonProps {
  icon: IconName;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox';
}

export function ActionBarButton({ icon, label, onClick, title, ...aria }: ActionBarButtonProps) {
  return (
    <button type="button" className={styles.item} title={title} onClick={onClick} {...aria}>
      <Icon name={icon} />
      {label}
    </button>
  );
}

export const ActionBarRule = () => <span className={styles.rule} aria-hidden="true" />;
