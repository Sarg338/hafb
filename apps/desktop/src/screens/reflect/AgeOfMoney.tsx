// Age of Money (S6.3, RF-07): YNAB's page (trial 2026-10-09) shows "Current" and the number of
// days, a line over the months, and "Understanding Age of Money". CLAUDE.md §5.7: ranges of
// 6 months, 1 year and 2 years; empty until there are 10 cash outflows. It has no category or
// account filters in YNAB, so it ignores them here too.
import { useMemo, useState } from 'react';
import { ageOfMoneySeries } from '@hafb/engine';
import { addMonths, compareMonths, monthOf, type ISODate, type Month } from '@hafb/shared';
import { budgetSnapshot, type PlanData } from '@hafb/store';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { linear, niceTicks } from './charts/scale.ts';
import { monthLabel, monthTick } from './reflectModel.ts';
import { Empty } from './reportKit.tsx';
import { cx as cls } from '../../ui/cx.ts';
import styles from './Reflect.module.css';

export type AgeSpan = '6m' | '1y' | '2y';
const SPAN_MONTHS: Record<AgeSpan, number> = { '6m': 6, '1y': 12, '2y': 24 };

export function AgeOfMoney({ plan, today, first }: { plan: PlanData; today: ISODate; first: Month }) {
  const [span, setSpan] = useState<AgeSpan>('6m');
  const to = monthOf(today);
  const wanted = addMonths(to, -(SPAN_MONTHS[span] - 1));
  const from = compareMonths(wanted, first) < 0 ? first : wanted;
  const series = useMemo(() => ageOfMoneySeries(budgetSnapshot(plan), from, to), [plan, from, to]);
  const points = series.filter((p): p is typeof p & { ageOfMoney: number } => p.ageOfMoney !== null);
  const latest = points[points.length - 1];

  const control = (
    <div className={styles.toolbar}>
      <SegmentedControl
        label="Age of Money range"
        options={[
          { value: '6m', label: '6 Months' },
          { value: '1y', label: '1 Year' },
          { value: '2y', label: '2 Years' },
        ]}
        value={span}
        onChange={setSpan}
      />
    </div>
  );
  const explain = (
    <div className={styles.card}>
      <h2>Understanding Age of Money</h2>
      <p>Age of Money is how long, on average, a dollar sits in your accounts between earning it and spending it. It looks at the last 10 outflows from your cash accounts.</p>
      <p>Older money means more time to decide and less shifting money around at the last minute.</p>
    </div>
  );
  if (!latest) {
    return (
      <div className={styles.report}>
        {control}
        <Empty
          title="Your Age of Money is on its way"
          body="It shows how long a dollar sits in your plan before you spend it. It needs 10 outflows from your cash accounts first; keep going and it’ll appear here."
        />
        {explain}
      </div>
    );
  }

  const W = 820;
  const H = 300;
  const pad = { l: 64, r: 16, t: 24, b: 34 };
  const ticks = niceTicks(0, Math.max(...points.map((p) => p.ageOfMoney)) * 1.15);
  const y = linear(0, ticks[ticks.length - 1] ?? 1, H - pad.b, pad.t);
  const band = (W - pad.l - pad.r) / series.length;
  const cx = (i: number): number => pad.l + band * i + band / 2;
  const index = new Map(series.map((p, i) => [p.month, i]));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${cx(index.get(p.month) ?? 0).toFixed(1)} ${y(p.ageOfMoney).toFixed(1)}`).join(' ');
  const days = (n: number) => `${String(n)} ${n === 1 ? 'day' : 'days'}`;

  return (
    <div className={styles.report}>
      {control}
      <div className={styles.reportHead}>
        <div className={styles.stat}>
          <span>Current</span>
          <strong>{days(latest.ageOfMoney)}</strong>
        </div>
      </div>
      <div className={styles.chartBox}>
        <svg
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          className={styles.chart}
          role="img"
          data-chart=""
          aria-label={`Age of Money: ${points.map((p) => `${monthLabel(p.month)} ${days(p.ageOfMoney)}`).join(', ')}`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={styles.grid} />
              <text x={pad.l - 10} y={y(t) + 4} className={styles.axis} textAnchor="end">
                {days(t)}
              </text>
            </g>
          ))}
          {series.map((p, i) => (
            <text key={p.month} x={cx(i)} y={H - 10} className={styles.axis} textAnchor="middle">
              {series.length > 6 ? monthTick(p.month) : monthLabel(p.month)}
            </text>
          ))}
          <path d={path} className={styles.ageLine} />
          {points.map((p) => (
            <g key={p.month}>
              <circle cx={cx(index.get(p.month) ?? 0)} cy={y(p.ageOfMoney)} r="4.5" className={styles.agePoint} />
              <text x={cx(index.get(p.month) ?? 0)} y={y(p.ageOfMoney) - 12} className={cls(styles.axis, styles.pointLabel)} textAnchor="middle">
                {p.ageOfMoney}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {explain}
    </div>
  );
}
