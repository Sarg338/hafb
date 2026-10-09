// Recent Moves and a category's Moves popovers (S5.7), as YNAB shows them (trial, 2026-10-08).
// The words and grouping come from movesModel; this file only lays them out.
import { useState, type RefObject } from 'react';
import type { Id } from '@hafb/engine';
import { makeDate, type ISODate, type Month } from '@hafb/shared';
import type { PlanData } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Popover } from '../../ui/Popover.tsx';
import type { Rect } from '../../ui/position.ts';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import type { MoneyText } from '../shared/money.ts';
import { categoryMoves, HISTORY_MONTHS, monthTag, RECENT_DAYS, recentMoves, type MoveEnd, type MovesFilter } from './movesModel.ts';
import styles from './RecentMoves.module.css';

/** A move's timestamp as the machine's local calendar date. */
export function localDate(timestamp: string): ISODate {
  const d = new Date(timestamp);
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 08, 2026" (YNAB's day heading). */
const dayTitle = (date: ISODate): string => `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''} ${date.slice(8, 10)}, ${date.slice(0, 4)}`;

function End({ end }: { end: MoveEnd }) {
  return (
    <span className={styles.chip}>
      {end.name} <span className={styles.tag}>{monthTag(end.month)}</span>
    </span>
  );
}

export function RecentMovesPopover({ plan, today, money, anchor, onClose }: { plan: PlanData; today: ISODate; money: MoneyText; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const [filter, setFilter] = useState<MovesFilter>('all');
  const days = recentMoves(plan, today, filter, localDate);
  return (
    <Popover open onClose={onClose} anchor={anchor} placement="bottom-start" role="dialog" label="Recent Moves" className={styles.popover}>
      <div className={styles.head}>
        <h2 className={styles.title}>Recent Moves</h2>
        <SegmentedControl<MovesFilter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'moved', label: 'Moved' },
            { value: 'assigned', label: 'Assigned' },
          ]}
        />
      </div>
      <div className={styles.list}>
        {days.length === 0 ? (
          <div className={styles.empty}>
            <strong>No Money Moves</strong>
            <span>{filter === 'assigned' ? `You haven’t assigned any money in the last ${String(RECENT_DAYS)} days.` : `You haven’t moved any money in the last ${String(RECENT_DAYS)} days.`}</span>
          </div>
        ) : (
          days.map((day) => (
            <section key={day.date} aria-label={dayTitle(day.date)}>
              <h3 className={styles.day}>
                <span>{dayTitle(day.date)}</span>
                {day.date === today && <span className={styles.muted}>Today</span>}
              </h3>
              <ol className={styles.moves}>
                {day.moves.map((m) => (
                  <li key={m.id} className={styles.move}>
                    <Icon name={m.verb === 'Assigned' ? 'add' : m.verb === 'Removed' ? 'subtract' : 'transfer'} className={styles.icon} />
                    <span className={styles.text}>
                      <span>
                        {m.verb} <strong>{money(m.amount)}</strong>
                      </span>
                      {m.from && (
                        <span>
                          from <End end={m.from} />
                        </span>
                      )}
                      {m.to && (
                        <span>
                          to <End end={m.to} />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </Popover>
  );
}

export function CategoryMovesPopover({ plan, categoryId, month, money, dateFormat, at, onClose }: { plan: PlanData; categoryId: Id; month: Month; money: MoneyText; dateFormat: (d: ISODate) => string; at: Rect; onClose: () => void }) {
  const rows = categoryMoves(plan, categoryId, month, localDate);
  const name = plan.categories.find((c) => c.id === categoryId)?.name ?? '';
  return (
    <Popover open onClose={onClose} anchor={at} placement="top" role="dialog" label={`Moves for ${name}`} className={styles.history}>
      <h2 className={styles.title}>Moves</h2>
      <p className={styles.muted}>{name}</p>
      {rows.length === 0 ? (
        <p className={styles.muted}>No changes to its assigned amount in the last {HISTORY_MONTHS} months.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Move</th>
              <th scope="col" className={styles.num}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{dateFormat(r.date)}</td>
                <td>{r.move}</td>
                <td className={styles.num}>{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={styles.foot}>
        <Button variant="primary" autoFocus onClick={onClose}>
          Close
        </Button>
      </div>
    </Popover>
  );
}
