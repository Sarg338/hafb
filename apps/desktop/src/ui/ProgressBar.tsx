import type { MoneyState } from './Pill.tsx';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** One segment per week for weekly targets, otherwise 1. */
  segments: number;
  /** 0–100: how much of the target the category holds. */
  fillPercent: number;
  /** 0–100: the part of the fill already spent (drawn lighter). */
  spentPercent: number;
  state: MoneyState;
  /** Accessible summary, e.g. "54% funded". When absent the bar is decorative. */
  label?: string;
}

const unit = (v: number): number => Math.max(0, Math.min(1, v));

/** The segmented target progress bar (DESIGN.md). Animates by transform, never width. */
export function ProgressBar({ segments, fillPercent, spentPercent, state, label }: ProgressBarProps) {
  const count = Math.max(1, Math.round(segments));
  const per = 100 / count;
  return (
    <div
      className={styles.bar}
      data-state={state}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {Array.from({ length: count }, (_, i) => (
        <span className={styles.seg} key={i}>
          <span className={styles.fill} style={{ transform: `scaleX(${String(unit((fillPercent - i * per) / per))})` }} />
          <span className={styles.spent} style={{ transform: `scaleX(${String(unit((spentPercent - i * per) / per))})` }} />
        </span>
      ))}
    </div>
  );
}

export interface ProgressRingProps {
  /** 0–100. */
  percent: number;
  state: MoneyState;
  size?: number;
  stroke?: number;
  /** Accessible summary; the visible label is the rounded percentage. */
  label: string;
}

/** Target progress ring (CLAUDE.md §5.4 "progress-ring percentage"), for the target detail card. */
export function ProgressRing({ percent, state, size = 44, stroke = 4, label }: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span className={styles.ring} data-state={state} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden="true">
        <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className={styles.ringArc}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <span className={styles.ringLabel} aria-hidden="true">
        {Math.floor(clamped)}%
      </span>
    </span>
  );
}
