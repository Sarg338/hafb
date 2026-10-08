import { forwardRef, useRef, useState, type KeyboardEvent } from 'react';
import { dateKey, formatDate, parseDateInput, type ISODate } from '@hafb/shared';
import { IconButton } from './Button.tsx';
import { Calendar } from './Calendar.tsx';
import { cx } from './cx.ts';
import styles from './Field.module.css';
import { Popover } from './Popover.tsx';
import { FieldFrame, useFieldIds } from './TextInput.tsx';

export interface DateInputProps {
  value: ISODate;
  /** The plan's date format, e.g. 'MM/DD/YYYY'. */
  format: string;
  /** The plan's today (for T and partial dates). */
  today: ISODate;
  onCommit: (date: ISODate) => void;
  label: string;
  hideLabel?: boolean;
  help?: string;
  size?: 'medium' | 'compact';
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Letters are always shortcuts; + - = and paging only while the text hasn't been typed over. */
const LETTER_KEYS = new Set(['t', 'm', 'y']);

/**
 * A date field in the plan's format. Type a full or partial date (Enter or leaving commits), use
 * the date keys (YNAB's: +/- day, T today, M/Shift+M month start/end, Y/Shift+Y year start/end;
 * PageUp/PageDown a month),
 * or pick from the calendar.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, format, today, onCommit, label, hideLabel, help, size = 'medium', disabled, id, className },
  ref,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<ISODate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);
  const { inputId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  const shown = pending ?? value;

  const reset = (): void => {
    setDraft(null);
    setPending(null);
    setError(null);
  };

  const commit = (): boolean => {
    if (draft !== null) {
      const parsed = parseDateInput(draft, format, today);
      if (!parsed) {
        setError(`"${draft}" isn't a date. Try ${formatDate(today, format)}.`);
        return false;
      }
      reset();
      if (parsed !== value) onCommit(parsed);
      return true;
    }
    if (pending !== null) {
      reset();
      if (pending !== value) onCommit(pending);
    }
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (commit()) {
        done.current = true;
        e.currentTarget.blur();
      }
      return;
    }
    if (e.key === 'Escape' && (draft !== null || pending !== null)) {
      e.preventDefault();
      e.stopPropagation();
      reset();
      return;
    }
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const letter = e.key.length === 1 && LETTER_KEYS.has(e.key.toLowerCase());
    if (!letter && draft !== null) return; // mid-typing: "-" and "." are separators
    const next = dateKey(shown, e.key, today);
    if (next) {
      e.preventDefault();
      setDraft(null);
      setError(null);
      setPending(next);
    }
  };

  return (
    <FieldFrame inputId={inputId} label={label} hideLabel={hideLabel} help={help} helpId={helpId} error={error} errorId={errorId} className={className}>
      <div ref={boxRef} className={cx(styles.box, size === 'compact' && styles.compact, error && styles.invalid, disabled && styles.disabled)}>
        <input
          ref={(el) => {
            inputRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          id={inputId}
          className={styles.input}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-keyshortcuts="+ - PageUp PageDown T M H Y R"
          disabled={disabled}
          value={draft ?? formatDate(shown, format)}
          onFocus={(e) => {
            done.current = false;
            const el = e.currentTarget;
            requestAnimationFrame(() => {
              el.select();
            });
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            setPending(null);
            if (error) setError(null);
          }}
          onBlur={() => {
            if (!done.current && !open) commit();
          }}
          onKeyDown={onKeyDown}
        />
        <IconButton
          icon="calendar"
          label="Choose a date"
          size="small"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setOpen(!open);
          }}
        />
      </div>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
          // Esc returns focus to the field; a click elsewhere keeps focus where it landed.
          requestAnimationFrame(() => {
            if (document.activeElement === document.body) inputRef.current?.focus();
          });
        }}
        anchor={boxRef}
        placement="bottom-start"
        role="dialog"
        label="Choose a date"
      >
        <Calendar
          value={shown}
          today={today}
          onSelect={(d) => {
            setOpen(false);
            reset();
            if (d !== value) onCommit(d);
            inputRef.current?.focus();
          }}
        />
      </Popover>
    </FieldFrame>
  );
});
