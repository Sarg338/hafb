import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { compareMonths, makeMonth, monthParts, type Month } from '@hafb/shared';
import { IconButton } from './Button.tsx';
import { cx } from './cx.ts';
import styles from './MonthPicker.module.css';
import { clampMonth, monthPickerKey } from './monthPickerModel.ts';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A year of months (the Plan's month picker). Arrow keys move by month and row, PageUp/PageDown by
 * year; Enter or Space picks. Months outside [min, max] are disabled. Focus lands on the value.
 */
export function MonthPicker({ value, current, min, max, onSelect }: { value: Month; current: Month; min: Month; max: Month; onSelect: (m: Month) => void }) {
  const [active, setActive] = useState<Month>(value);
  const year = monthParts(active).year;
  const gridRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(true);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-month="${active}"]`)?.focus();
  }, [active]);

  const move = (to: Month): void => {
    focusPending.current = true;
    setActive(to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = monthPickerKey(active, e.key, min, max);
    if (next) {
      e.preventDefault();
      move(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(active);
    }
  };

  const outside = (m: Month): boolean => compareMonths(m, min) < 0 || compareMonths(m, max) > 0;
  const stepYear = (n: number): void => {
    move(clampMonth(makeMonth(year + n, monthParts(active).month), min, max));
  };

  return (
    <div className={styles.picker}>
      <div className={styles.head}>
        <IconButton icon="chevronLeft" label="Previous year" size="small" disabled={year <= monthParts(min).year} onClick={() => {
          stepYear(-1);
        }} />
        <span className={styles.title} aria-live="polite">
          {year}
        </span>
        <IconButton icon="chevronRight" label="Next year" size="small" disabled={year >= monthParts(max).year} onClick={() => {
          stepYear(1);
        }} />
      </div>
      <div ref={gridRef} className={styles.grid} role="grid" aria-label={`Months of ${String(year)}`} onKeyDown={onKeyDown}>
        {[0, 1, 2, 3].map((row) => (
          <div role="row" className={styles.row} key={row}>
            {[0, 1, 2].map((col) => {
              const n = row * 3 + col + 1;
              const m = makeMonth(year, n);
              const disabled = outside(m);
              return (
                <button
                  key={m}
                  type="button"
                  role="gridcell"
                  className={cx(styles.month, m === value && styles.selected, m === current && styles.current)}
                  data-month={m}
                  tabIndex={m === active ? 0 : -1}
                  aria-selected={m === value}
                  aria-current={m === current ? 'date' : undefined}
                  aria-label={`${LONG[n - 1] ?? ''} ${String(year)}`}
                  disabled={disabled}
                  onClick={() => {
                    onSelect(m);
                  }}
                >
                  {SHORT[n - 1]}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
