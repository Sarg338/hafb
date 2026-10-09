// Net Worth (S6.3, RF-05): month-end assets and debts as bars with the net worth line, YNAB's
// headline (Net Worth, Assets, Debts, Change in Net Worth with its percentage) and a month table
// with the monthly change (YNAB trial 2026-10-09). Hover a month for its figures.
import { useMemo, useState } from 'react';
import { netWorth, type NetWorthRow } from '@hafb/engine';
import type { Minor, MoneyFormat } from '@hafb/shared';
import { budgetSnapshot } from '@hafb/store';
import { linear, niceTicks } from './charts/scale.ts';
import { monthLabel, monthLong, monthTick } from './reflectModel.ts';
import { axisLabel, changePct, Empty, type ReportProps } from './reportKit.tsx';
import { cx as cls } from '../../ui/cx.ts';
import styles from './Reflect.module.css';

/** The change's base: the previous month end's net worth (or the opening balance for the first row). */
export function previousNet(rows: readonly NetWorthRow[], i: number): number {
  const r = rows[i];
  if (!r) return 0;
  return rows[i - 1]?.netWorth ?? r.netWorth - r.change;
}

export const NW_CHART = { W: 820, H: 340 } as const;

export interface NetWorthChartProps {
  rows: readonly NetWorthRow[];
  fmt: MoneyFormat;
  money: (m: Minor) => string;
  hidden: boolean;
  hover?: number | null;
  onHover?: (i: number | null) => void;
  /** Placement when nested inside another SVG (the share image). */
  frame?: { x: number; y: number; width: number; height: number };
}

/** The bars-and-line chart, on screen or nested in Share Your Progress. */
export function NetWorthChart({ rows, fmt, money, hidden, hover = null, onHover, frame }: NetWorthChartProps) {
  const { W, H } = NW_CHART;
  const pad = { l: hidden ? 24 : 84, r: 16, t: 16, b: 34 };
  const lo = Math.min(...rows.map((r) => Math.min(r.debts, r.netWorth)));
  const hi = Math.max(...rows.map((r) => Math.max(r.assets, r.netWorth)));
  const ticks = niceTicks(lo, hi);
  const y = linear(ticks[0] ?? lo, ticks[ticks.length - 1] ?? hi, H - pad.b, pad.t);
  const band = (W - pad.l - pad.r) / rows.length;
  const barW = Math.min(36, band * 0.22);
  const cx = (i: number): number => pad.l + band * i + band / 2;
  const line = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(1)} ${y(r.netWorth).toFixed(1)}`).join(' ');
  const dim = (i: number) => hover !== null && hover !== i && styles.dim;
  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      className={frame ? undefined : styles.chart}
      {...(frame ? { x: frame.x, y: frame.y, width: frame.width, height: frame.height } : { 'data-chart': '' })}
      role="img"
      aria-label={`Net worth by month: ${rows.map((r) => `${monthLabel(r.month)} ${money(r.netWorth)}`).join(', ')}`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? styles.zero : styles.grid} />
          <text x={pad.l - 10} y={y(t) + 4} className={styles.axis} textAnchor="end">
            {axisLabel(t, fmt, hidden)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => (
        <g
          key={r.month}
          onMouseEnter={() => onHover?.(i)}
          onMouseLeave={() => onHover?.(null)}
        >
          <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} className={styles.hit} />
          <rect x={cx(i) - barW - 2} y={y(r.assets)} width={barW} height={Math.max(0, y(0) - y(r.assets))} className={cls(styles.assets, dim(i))} />
          <rect x={cx(i) + 2} y={y(0)} width={barW} height={Math.max(0, y(r.debts) - y(0))} className={cls(styles.debts, dim(i))} />
          <text x={cx(i)} y={H - 10} className={styles.axis} textAnchor="middle">
            {rows.length > 6 ? monthTick(r.month) : monthLabel(r.month)}
          </text>
        </g>
      ))}
      <path d={line} className={styles.netLine} />
      {rows.map((r, i) => (
        <circle key={r.month} cx={cx(i)} cy={y(r.netWorth)} r="4.5" className={styles.netPoint} />
      ))}
    </svg>
  );
}

export function NetWorth({ plan, filters, fmt, money, hidden }: ReportProps) {
  const rows = useMemo(() => netWorth(budgetSnapshot(plan), filters), [plan, filters]);
  const [hover, setHover] = useState<number | null>(null);
  const last = rows[rows.length - 1];
  if (!last) return <Empty title="Nothing to chart yet" body="Add an account and your net worth shows up here." />;
  const lastBase = previousNet(rows, rows.length - 1);
  const hovered = hover === null ? undefined : rows[hover];
  const tone = (v: number) => (v > 0 ? styles.up : v < 0 ? styles.down : '');
  const tipLeft = hover === null ? 0 : ((84 + ((NW_CHART.W - 100) / rows.length) * (hover + 0.5)) / NW_CHART.W) * 100;

  return (
    <div className={styles.report}>
      <div className={styles.reportHead}>
        <div className={styles.stat}>
          <span>Net Worth</span>
          <strong>{money(last.netWorth)}</strong>
        </div>
        <div className={styles.stat}>
          <span>Assets</span>
          <strong>{money(last.assets)}</strong>
        </div>
        <div className={styles.stat}>
          <span>Debts</span>
          <strong>{money(last.debts)}</strong>
        </div>
        <div className={styles.stat}>
          <span>Change in Net Worth</span>
          <strong className={tone(last.change)}>
            {last.change > 0 ? '+' : ''}
            {money(last.change)}
            <span className={styles.pctNote}>{changePct(last.change, lastBase)}</span>
          </strong>
        </div>
      </div>
      <div className={styles.chartBox}>
        <NetWorthChart rows={rows} fmt={fmt} money={money} hidden={hidden} hover={hover} onHover={setHover} />
        {hovered && (
          <div className={styles.tooltip} style={{ left: `${String(tipLeft)}%` }} role="status">
            <h2>{monthLong(hovered.month)}</h2>
            <div className={styles.tipLine}>
              <span>Assets</span>
              <span>{money(hovered.assets)}</span>
            </div>
            <div className={styles.tipLine}>
              <span>Debts</span>
              <span>{money(hovered.debts)}</span>
            </div>
            <div className={cls(styles.tipLine, styles.tipTotal)}>
              <span>Net Worth</span>
              <span>{money(hovered.netWorth)}</span>
            </div>
          </div>
        )}
      </div>
      <ul className={styles.legend}>
        <li>
          <span className={cls(styles.key, styles.keyAssets)} /> Assets
        </li>
        <li>
          <span className={cls(styles.key, styles.keyDebts)} /> Debts
        </li>
        <li>
          <span className={cls(styles.key, styles.keyNet)} /> Net worth
        </li>
      </ul>
      <table className={cls(styles.table, styles.compact)}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className={styles.num}>
              Assets
            </th>
            <th scope="col" className={styles.num}>
              Debts
            </th>
            <th scope="col" className={styles.num}>
              Net Worth
            </th>
            <th scope="col" className={styles.num}>
              Monthly Change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.month}>
              <th scope="row">{monthLong(r.month)}</th>
              <td className={styles.num}>{money(r.assets)}</td>
              <td className={styles.num}>{money(r.debts)}</td>
              <td className={styles.num}>{money(r.netWorth)}</td>
              <td className={styles.num}>
                {money(r.change)}
                <span className={styles.pctNote}>({changePct(r.change, previousNet(rows, i))})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
