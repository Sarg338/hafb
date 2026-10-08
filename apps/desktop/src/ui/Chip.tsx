import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon, type IconName } from './Icon.tsx';
import styles from './Selection.module.css';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Toggle chips (Focused Views, filters) report their state; plain action chips leave it out. */
  pressed?: boolean;
  /** `alert`: the overspent chip ("2 Overspent"). */
  variant?: 'filter' | 'alert';
  icon?: IconName;
  /** Shown before the label, e.g. the overspent count. */
  count?: number;
  children: ReactNode;
}

/** A rounded filter chip (the approved Focused View chips). */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip({ pressed, variant = 'filter', icon, count, className, children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-pressed={pressed} className={cx(styles.chip, variant === 'alert' && styles.alert, className)} {...rest}>
      {icon && <Icon name={icon} />}
      {count !== undefined && <span className={styles.count}>{count}</span>}
      {children}
    </button>
  );
});
