import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx.ts';
import styles from './Selection.module.css';

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label (the switch's accessible name). */
  label: string;
  hideLabel?: boolean;
}

/** An on/off switch for settings that apply immediately (role="switch"). */
export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle({ checked, onChange, label, hideLabel = false, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      className={cx(styles.toggle, className)}
      onClick={() => {
        onChange(!checked);
      }}
      {...rest}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      {!hideLabel && <span>{label}</span>}
    </button>
  );
});
