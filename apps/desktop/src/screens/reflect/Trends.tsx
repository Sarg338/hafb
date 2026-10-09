// Spending Trends (S6.2, RF-04): stacked bars per month by category group with an average line,
// and a month table (Total Spending, Compared to Average), as in YNAB (trial 2026-10-09). Per
// YNAB's help, clicking a group's bar shows only that group, by category; clicking a category
// lists its transactions.
import { useMemo, useState } from 'react';
import { spendingTrends, type Id } from '@hafb/engine';
import { minor, type Minor, type Month } from '@hafb/shared';
import { budgetSnapshot } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { linear, niceTicks } from './charts/scale.ts';
import { seriesFill, Swatch } from './charts/Patterns.tsx';
import { monthLabel, monthLong, monthTick } from './reflectModel.ts';
import { axisLabel, changePct, Empty, rectOf, type ReportProps } from './reportKit.tsx';
import { cx as cls } from '../../ui/cx.ts';
import styles from './Reflect.module.css';

interface Series {
  id: Id;
  name: string;
  byMonth: readonly Minor[];
  kind: 'group' | 'category';
}

export function Trends({ plan, filters, fmt, money, hidden, onDrill }: ReportProps) {
  const data = useMemo(() => spendingTrends(budgetSnapshot(plan), filters), [plan, filters]);
  const [drill, setDrill] = useState<Id | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const group = drill === null ? undefined : data.groups.find((g) => g.groupId === drill);
  const series: Series[] = group
    ? data.categories.filter((c) => c.groupId === group.groupId).map((c) => ({ id: c.categoryId, name: c.name, byMonth: c.byMonth, kind: 'category' }))
    : data.groups.map((g) => ({ id: g.groupId, name: g.name, byMonth: g.byMonth, kind: 'group' }));
  const totals = group ? group.byMonth : data.totalsByMonth;
  const total = group ? group.total : data.total;
  const average = group ? group.average : data.averagePerMonth;

  if (data.groups.length === 0) return <Empty title="No spending yet" body="Spending Trends fills in as months go by." />;

  const W = 820;
  const H = 320;
  const pad = { l: 64, r: 16, t: 16, b: 34 };
  const stackTop = Math.max(0, ...data.months.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.byMonth[i] ?? 0), 0)));
  const ticks = niceTicks(0, stackTop);
  const top = ticks[ticks.length - 1] ?? 1;
  const y = linear(0, top, H - pad.b, pad.t);
  const band = (W - pad.l - pad.r) / data.months.length;
  const barW = Math.min(88, band * 0.56);
  const hoveredMonth = hover === null ? undefined : data.months[hover];
  const pickSeries = (s: Series, month: Month, el: Element): void => {
    if (s.kind === 'group') {
      setDrill(s.id);
      setHover(null);
      return;
    }
    onDrill({ kind: 'spending', select: { categoryId: s.id, month }, title: s.name, subtitle: monthLabel(month), at: rectOf(el) });
  };

  return (
    <div className={styles.report}>
      {group && (
        <div className={styles.toolbar}>
          <span className={styles.crumb}>
            <Button
              size="small"
              icon="chevronLeft"
              onClick={() => {
                setDrill(null);
                setHover(null);
              }}
            >
              All groups
            </Button>
            {group.name}
          </span>
        </div>
      )}
      <div className={styles.reportHead}>
        <div className={styles.stat}>
          <span>Average monthly spending</span>
          <strong>{money(average)}</strong>
        </div>
        <div className={styles.stat}>
          <span>Total spending</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
      <div className={styles.chartBox}>
        <svg
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          className={styles.chart}
          role="img"
          data-chart=""
          aria-label={`Spending by month: ${data.months.map((m, i) => `${monthLabel(m)} ${money(totals[i] ?? minor(0))}`).join(', ')}`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={styles.grid} />
              <text x={pad.l - 10} y={y(t) + 4} className={styles.axis} textAnchor="end">
                {axisLabel(t, fmt, hidden)}
              </text>
            </g>
          ))}
          {data.months.map((m, mi) => {
            const x = pad.l + band * mi + (band - barW) / 2;
            let base = 0;
            return (
              <g
                key={m}
                onMouseEnter={() => {
                  setHover(mi);
                }}
                onMouseLeave={() => {
                  setHover(null);
                }}
              >
                <rect x={pad.l + band * mi} y={pad.t} width={band} height={H - pad.t - pad.b} className={styles.hit} />
                {series.map((s, si) => {
                  const v = Math.max(0, s.byMonth[mi] ?? 0);
                  if (v === 0) return null;
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  return (
                    <rect
                      key={s.id}
                      x={x}
                      y={y1}
                      width={barW}
                      height={Math.max(0, y0 - y1 - 1)}
                      fill={seriesFill(si)}
                      className={cls(styles.clickable, hover !== null && hover !== mi && styles.dim)}
                      onClick={(e) => {
                        pickSeries(s, m, e.currentTarget);
                      }}
                    >
                      <title>{`${s.name}, ${monthLabel(m)}: ${money(minor(v))}`}</title>
                    </rect>
                  );
                })}
                <text x={pad.l + band * mi + band / 2} y={H - 10} className={styles.axis} textAnchor="middle">
                  {data.months.length > 6 ? monthTick(m) : monthLabel(m)}
                </text>
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={y(Math.max(0, average))} y2={y(Math.max(0, average))} className={styles.avg} />
        </svg>
        {hoveredMonth !== undefined && hover !== null && (
          <div className={styles.tooltip} style={{ left: `${String(((pad.l + band * hover + band / 2) / W) * 100)}%` }} role="status">
            <h2>{monthLong(hoveredMonth)}</h2>
            {series.map((s, si) => {
              const v = s.byMonth[hover] ?? 0;
              return v === 0 ? null : (
                <div key={s.id} className={styles.tipLine}>
                  <span>
                    <Swatch index={si} className={styles.swatch} /> {s.name}
                  </span>
                  <span>{money(minor(v))}</span>
                </div>
              );
            })}
            <div className={cls(styles.tipLine, styles.tipTotal)}>
              <span>Total</span>
              <span>{money(totals[hover] ?? minor(0))}</span>
            </div>
          </div>
        )}
      </div>
      <ul className={styles.legend}>
        {series.map((s, si) => (
          <li key={s.id}>
            <Swatch index={si} className={styles.swatch} />
            <button
              type="button"
              className={styles.linkish}
              onClick={(e) => {
                if (s.kind === 'group') {
                  setDrill(s.id);
                  setHover(null);
                } else {
                  onDrill({ kind: 'spending', select: { categoryId: s.id }, title: s.name, at: rectOf(e.currentTarget) });
                }
              }}
            >
              {s.name}
            </button>
          </li>
        ))}
        <li>
          <span className={styles.avgKey} aria-hidden="true" /> Average {money(average)}
        </li>
      </ul>
      <table className={cls(styles.table, styles.compact)}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className={styles.num}>
              Total Spending
            </th>
            <th scope="col" className={styles.num}>
              Compared to Average
            </th>
          </tr>
        </thead>
        <tbody>
          {data.months.map((m, i) => {
            const v = totals[i] ?? minor(0);
            const diff = v - average;
            return (
              <tr key={m}>
                <th scope="row">{monthLong(m)}</th>
                <td className={styles.num}>{money(v)}</td>
                <td className={styles.num}>
                  {money(minor(diff))}
                  <span className={styles.pctNote}>({changePct(diff, average)})</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
