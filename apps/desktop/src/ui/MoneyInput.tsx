import { forwardRef, useId, useRef, useState, type KeyboardEvent } from 'react';
import { evaluateAmount, formatMoney, hasArithmetic, inputSeparators, ZERO, type Minor, type MoneyFormat } from '@hafb/shared';
import { cx } from './cx.ts';
import fieldStyles from './Field.module.css';
import styles from './MoneyInput.module.css';
import { FieldFrame, useFieldIds } from './TextInput.tsx';

export interface MoneyInputProps {
  value: Minor;
  format: MoneyFormat;
  /** Called with the new amount when an edit is committed (Enter or leaving the field) and changed. */
  onCommit: (value: Minor) => void;
  /** Accessible name (always required); visible only for `field`. */
  label: string;
  hideLabel?: boolean;
  /** `cell`: the plan grid's Assigned cell. `field`: a bordered form field. */
  variant?: 'cell' | 'field';
  size?: 'medium' | 'compact';
  help?: string;
  disabled?: boolean;
  /** Show the hover look without the pointer (a hovered grid row). */
  hot?: boolean;
  id?: string;
  className?: string;
  /** After Enter commits: e.g. move to the next row. Defaults to leaving the field. */
  onEnter?: () => void;
  /** Start in editing state with this text (restoring an unsaved edit); an invalid one shows its error. */
  defaultDraft?: string;
}

/** The number a person edits: digits with the plan's decimal separator, no symbol or grouping. */
export function plainAmount(value: Minor, format: MoneyFormat): string {
  const { decimal } = inputSeparators(format.numberFormat);
  const digits = String(Math.abs(value)).padStart(format.decimals + 1, '0');
  const text = format.decimals > 0 ? `${digits.slice(0, -format.decimals)}${decimal}${digits.slice(-format.decimals)}` : digits;
  return value < 0 ? `-${text}` : text;
}

/**
 * Money entry with arithmetic ("12.50+3"): formatted when idle, an editable number while focused.
 * Exact maths (evaluateAmount); nothing commits unless the text is a valid amount.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, format, onCommit, label, hideLabel, variant = 'cell', size = 'medium', help, disabled, hot, id, className, onEnter, defaultDraft },
  ref,
) {
  const { decimal, group } = inputSeparators(format.numberFormat);
  const options = { decimals: format.decimals, decimalSeparator: decimal, groupSeparator: group };
  const [draft, setDraft] = useState<string | null>(defaultDraft ?? null);
  const [error, setError] = useState<string | null>(() => {
    if (defaultDraft === undefined || defaultDraft.trim() === '') return null;
    const r = evaluateAmount(defaultDraft, options);
    return r.ok ? null : r.error;
  });
  const done = useRef(false);
  const typed = useRef(false);
  const previewId = useId();
  const { inputId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  const preview = draft !== null && hasArithmetic(draft) ? evaluateAmount(draft, options) : null;

  const commit = (): boolean => {
    if (draft === null) return true;
    if (draft.trim() === '') {
      setDraft(null);
      setError(null);
      if (value !== 0) onCommit(ZERO);
      return true;
    }
    const result = evaluateAmount(draft, options);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setDraft(null);
    setError(null);
    if (result.value !== value) onCommit(result.value);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (commit()) {
        done.current = true;
        if (onEnter) onEnter();
        else e.currentTarget.blur();
      }
    } else if (e.key === 'Escape' && draft !== null) {
      e.preventDefault();
      e.stopPropagation();
      done.current = true;
      setDraft(null);
      setError(null);
      e.currentTarget.blur();
    }
  };

  const input = (
    <input
      ref={ref}
      id={inputId}
      className={cx(styles.input, variant === 'cell' ? styles.cell : styles.fieldInput, variant === 'cell' && (hot === true || draft !== null) && styles.hot, variant === 'cell' && error && styles.invalid, className)}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={variant === 'cell' ? label : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={[describedBy, preview ? previewId : undefined].filter(Boolean).join(' ') || undefined}
      disabled={disabled}
      value={draft ?? formatMoney(value, format)}
      onFocus={(e) => {
        done.current = false;
        if (draft === null) setDraft(value === 0 ? '' : plainAmount(value, format));
        const el = e.currentTarget;
        typed.current = false;
        // Select a frame later (a click would undo it now), unless a fast keystroke already landed or focus
        // moved on: select() pulls focus back, which sent fast typing into the previous field.
        requestAnimationFrame(() => {
          if (!typed.current && document.activeElement === el) el.select();
        });
      }}
      onChange={(e) => {
        typed.current = true;
        setDraft(e.target.value);
        if (error) setError(null);
      }}
      onBlur={() => {
        if (!done.current) commit();
      }}
      onKeyDown={onKeyDown}
    />
  );

  const previewNode =
    preview !== null ? (
      <span id={previewId} className={styles.preview} aria-live="polite">
        {preview.ok ? `= ${formatMoney(preview.value, format)}` : '…'}
      </span>
    ) : null;

  if (variant === 'cell') {
    return (
      <span className={styles.wrap}>
        {input}
        {error ? (
          <span id={errorId} role="alert" className={cx(styles.error, styles.cellError)}>
            {error}
          </span>
        ) : (
          previewNode
        )}
      </span>
    );
  }

  return (
    <FieldFrame inputId={inputId} label={label} hideLabel={hideLabel} help={help} helpId={helpId} error={error} errorId={errorId}>
      <div className={cx(fieldStyles.box, size === 'compact' && fieldStyles.compact, error && fieldStyles.invalid, disabled && fieldStyles.disabled)}>
        {input}
        {previewNode}
      </div>
    </FieldFrame>
  );
});
