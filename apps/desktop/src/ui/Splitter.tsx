import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Rect } from './position.ts';
import { CLICK_SLOP, ResizeMenu } from './ResizeMenu.tsx';
import { dragWidth, keyWidth, type SplitRange, type SplitSide } from './splitterModel.ts';
import styles from './Splitter.module.css';

export interface SplitterProps {
  /** Current width of the panel this splitter resizes, px. */
  value: number;
  onChange: (width: number) => void;
  range: SplitRange;
  /** The panel's edge the splitter sits on (an inspector on the right: 'end'). */
  side?: SplitSide;
  /** Accessible name, e.g. "Resize inspector". */
  label: string;
  /** The id of the panel it resizes (aria-controls). */
  controls?: string;
  className?: string;
}

/**
 * A vertical resize handle (WAI-ARIA window splitter): drag with the pointer, or focus it and use
 * Left/Right (one step), Home/End (min/max), Enter or double-click (reset). A click without
 * dragging offers Narrower / Wider / Reset width (WCAG 2.5.7). It only reports widths; the owner
 * stores them and applies them (e.g. as a CSS custom property).
 */
export function Splitter({ value, onChange, range, side = 'end', label, controls, className }: SplitterProps) {
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const [menu, setMenu] = useState<Rect | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // preventDefault stops text selection while dragging, but also the focus a click would give:
    // focus explicitly so the arrow keys work after clicking the handle.
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: value, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) >= CLICK_SLOP) d.moved = true;
    if (d.moved) onChange(dragWidth(d.width, d.x, e.clientX, range, side));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const clicked = drag.current !== null && !drag.current.moved && e.type === 'pointerup';
    drag.current = null;
    if (clicked) setMenu({ top: e.clientY, left: e.clientX, width: 0, height: 0 });
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyWidth(value, e.key, range, side);
    if (next === null) return;
    e.preventDefault();
    onChange(next);
  };

  return (
    <>
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      className={[styles.splitter, className].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        onChange(range.initial);
      }}
      onKeyDown={onKeyDown}
    />
    {menu && (
      <ResizeMenu
        at={menu}
        label={label}
        onClose={() => {
          setMenu(null);
        }}
        onNarrower={() => {
          const next = keyWidth(value, side === 'end' ? 'ArrowRight' : 'ArrowLeft', range, side);
          if (next !== null) onChange(next);
        }}
        onWider={() => {
          const next = keyWidth(value, side === 'end' ? 'ArrowLeft' : 'ArrowRight', range, side);
          if (next !== null) onChange(next);
        }}
        onReset={() => {
          onChange(range.initial);
        }}
      />
    )}
    </>
  );
}
