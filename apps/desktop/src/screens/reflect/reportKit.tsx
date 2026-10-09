// Pieces every Reflect report shares: the drill-down request, axis labels, percentages and the
// empty state. Figures come from the engine; these only lay them out.
import type { LineSelector, ReportFilters } from '@hafb/engine';
import { formatMoney, minor, type Minor, type MoneyFormat } from '@hafb/shared';
import type { PlanData } from '@hafb/store';
import { Icon } from '../../ui/Icon.tsx';
import type { Rect } from '../../ui/position.ts';
import styles from './Reflect.module.css';

/** Which lines a click wants to see, and where the popover goes. */
export interface DrillRequest {
  kind: 'spending' | 'income';
  select: LineSelector;
  title: string;
  /** Overrides the range label (one month of a multi-month report). */
  subtitle?: string;
  at: Rect;
}

export interface ReportProps {
  plan: PlanData;
  filters: ReportFilters;
  fmt: MoneyFormat;
  money: (m: Minor) => string;
  hidden: boolean;
  onDrill: (request: DrillRequest) => void;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Whole-unit axis label from a tick in minor units ("$1,500"); masked under Hide Amounts. */
export function axisLabel(v: number, fmt: MoneyFormat, hidden: boolean): string {
  if (hidden) return '';
  const unit = 10 ** fmt.decimals;
  return formatMoney(minor(Math.round(v / unit)), { ...fmt, decimals: 0 });
}

/** Share of a whole, one decimal: "65.6%"; YNAB writes "<1%" for slivers in lists. */
export function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  const tenths = Math.round((part / whole) * 1000);
  if (tenths === 0 && part > 0) return '<0.1%';
  return `${(tenths / 10).toFixed(1)}%`;
}

/** Signed percentage change: "+12.5%", "−3.0%", "0.0%". */
export function changePct(change: number, base: number): string {
  if (base === 0) return '0.0%';
  const tenths = Math.round((change / Math.abs(base)) * 1000);
  const text = `${(Math.abs(tenths) / 10).toFixed(1)}%`;
  return tenths > 0 ? `+${text}` : tenths < 0 ? `−${text}` : text;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.empty}>
      <Icon name="trending" size={20} />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
