import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from 'react';
import { cx } from './cx.ts';
import styles from './Selection.module.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked'> {
  checked: boolean;
  /** "Some selected" (a select-all box over a partial selection). */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label; without one, pass aria-label. */
  label?: string;
}

/** The approved square checkbox (grid row selection, options). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, indeterminate = false, onChange, label, disabled, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const box = (
    <input
      ref={(el) => {
        inner.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      type="checkbox"
      className={cx(styles.box, label === undefined && className)}
      checked={checked}
      aria-checked={indeterminate ? 'mixed' : checked}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.checked);
      }}
      {...rest}
    />
  );
  if (label === undefined) return box;
  return (
    <label className={cx(styles.check, disabled && styles.disabled, className)}>
      {box}
      {label}
    </label>
  );
});
