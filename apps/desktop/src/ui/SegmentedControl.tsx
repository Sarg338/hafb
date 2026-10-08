import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx.ts';
import styles from './Selection.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * One choice from a few (theme, report period): a radio group. Arrow keys move and select;
 * only the selected segment is in the Tab order.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => ({ o, i })).filter((x) => x.o.disabled !== true);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[e.key];
    const at = enabled.findIndex((x) => x.o.value === value);
    let target: (typeof enabled)[number] | undefined;
    if (step !== undefined) target = enabled[(at + step + enabled.length) % enabled.length];
    else if (e.key === 'Home') target = enabled[0];
    else if (e.key === 'End') target = enabled[enabled.length - 1];
    if (!target) return;
    e.preventDefault();
    onChange(target.o.value);
    refs.current[target.i]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx(styles.seg, className)} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            className={styles.segItem}
            onClick={() => {
              onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
