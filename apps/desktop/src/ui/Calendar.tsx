import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addMonthsToDate, dateParts, monthOf, monthParts, type ISODate, type Month } from '@hafb/shared';
import { Button, IconButton } from './Button.tsx';
import styles from './Calendar.module.css';
import { calendarKey, monthGrid } from './calendarModel.ts';
import { cx } from './cx.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = [
  ['Su', 'Sunday'],
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
] as const;

const monthTitle = (m: Month): string => `${MONTHS[monthParts(m).month - 1] ?? ''} ${String(monthParts(m).year)}`;
const longDate = (d: ISODate): string => {
  const p = dateParts(d);
  return `${MONTHS[p.month - 1] ?? ''} ${String(p.day)}, ${String(p.year)}`;
};

/**
 * A month grid (WAI-ARIA date picker grid). Arrow keys move by day and week, PageUp/PageDown by
 * month, Home/End to the week's ends; Enter or Space picks. Focus lands on the selected day.
 */
export function Calendar({ value, today, onSelect }: { value: ISODate; today: ISODate; onSelect: (date: ISODate) => void }) {
  const [active, setActive] = useState<ISODate>(value);
  const [month, setMonth] = useState<Month>(monthOf(value));
  const gridRef = useRef<HTMLTableElement>(null);
  const focusPending = useRef(true);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${active}"]`)?.focus();
  }, [active, month]);

  const move = (to: ISODate): void => {
    focusPending.current = true;
    setActive(to);
    setMonth(monthOf(to));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>): void => {
    const next = calendarKey(active, e.key);
    if (next) {
      e.preventDefault();
      move(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(active);
    }
  };

  /** Header buttons: change month, keeping the same day (clamped) as the roving focus target. */
  const step = (n: number): void => {
    const next = addMonthsToDate(active, n);
    setActive(next);
    setMonth(monthOf(next));
  };

  return (
    <div className={styles.calendar}>
      <div className={styles.head}>
        <IconButton icon="chevronLeft" label="Previous month" size="small" onClick={() => {
          step(-1);
        }} />
        <span className={styles.title} aria-live="polite">
          {monthTitle(month)}
        </span>
        <IconButton icon="chevronRight" label="Next month" size="small" onClick={() => {
          step(1);
        }} />
      </div>
      <table ref={gridRef} role="grid" aria-label={monthTitle(month)} className={styles.grid} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long]) => (
              <th key={short} scope="col" abbr={long}>
                {short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const inMonth = monthOf(d) === month;
                const selected = d === value;
                return (
                  <td key={d} role="gridcell" aria-selected={selected}>
                    <span
                      role="button"
                      data-date={d}
                      tabIndex={d === active ? 0 : -1}
                      aria-label={`${longDate(d)}${d === today ? ', today' : ''}`}
                      aria-current={d === today ? 'date' : undefined}
                      className={cx(styles.day, !inMonth && styles.outside, d === today && styles.today, selected && styles.selected)}
                      onClick={() => {
                        onSelect(d);
                      }}
                      onFocus={() => {
                        if (d !== active) setActive(d);
                      }}
                    >
                      {dateParts(d).day}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.foot}>
        <Button variant="toolbar" size="small" onClick={() => {
          onSelect(today);
        }}>
          Today
        </Button>
      </div>
    </div>
  );
}
