import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx.ts';
import styles from './Field.module.css';
import { Icon, type IconName } from './Icon.tsx';

export interface FieldChromeProps {
  /** Always required: the accessible name. Hide it visually with `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  help?: string;
  /** Shown below the field; marks it invalid. */
  error?: string | null;
}

/** Label, help and error around a control; wires up ids for aria-describedby. */
export function useFieldIds(id: string | undefined, help: string | undefined, error: string | null | undefined) {
  const auto = useId();
  const inputId = id ?? auto;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
  return { inputId, helpId, errorId, describedBy };
}

export function FieldFrame({
  inputId,
  label,
  hideLabel,
  help,
  helpId,
  error,
  errorId,
  className,
  children,
}: {
  inputId: string;
  label: string;
  hideLabel?: boolean | undefined;
  help?: string | undefined;
  helpId?: string | undefined;
  error?: string | null | undefined;
  errorId?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={inputId} className={hideLabel === true ? styles.hiddenLabel : styles.label}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      {help ? (
        <span id={helpId} className={styles.help}>
          {help}
        </span>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'>, FieldChromeProps {
  size?: 'medium' | 'compact';
  /** Leading icon (e.g. search). */
  prefix?: IconName;
  /** Trailing content (an icon button, a unit). */
  suffix?: ReactNode;
  className?: string;
}

/** A labelled single-line text field (the approved register input look). */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hideLabel, help, error, size = 'medium', prefix, suffix, id, className, disabled, ...rest },
  ref,
) {
  const { inputId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  return (
    <FieldFrame inputId={inputId} label={label} hideLabel={hideLabel} help={help} helpId={helpId} error={error} errorId={errorId} className={className}>
      <div className={cx(styles.box, size === 'compact' && styles.compact, error && styles.invalid, disabled && styles.disabled)}>
        {prefix && (
          <span className={styles.affix}>
            <Icon name={prefix} />
          </span>
        )}
        <input ref={ref} id={inputId} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} disabled={disabled} {...rest} />
        {suffix && <span className={styles.affix}>{suffix}</span>}
      </div>
    </FieldFrame>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChromeProps {
  className?: string;
}

/** A labelled multi-line field (category and month notes; the approved .hd-textarea). */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, hideLabel, help, error, id, className, ...rest }, ref) {
  const { inputId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  return (
    <FieldFrame inputId={inputId} label={label} hideLabel={hideLabel} help={help} helpId={helpId} error={error} errorId={errorId} className={className}>
      <textarea ref={ref} id={inputId} className={styles.textarea} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
    </FieldFrame>
  );
});
