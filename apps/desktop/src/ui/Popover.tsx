import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { cx } from './cx.ts';
import { Portal } from './Portal.tsx';
import styles from './Popover.module.css';
import { computePosition, type Placement, type Rect } from './position.ts';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The element the popover hangs off, or a point (context menus). */
  anchor: RefObject<HTMLElement | null> | Rect;
  placement?: Placement;
  gap?: number;
  /** Match the anchor's width (comboboxes). */
  matchWidth?: boolean;
  role?: 'dialog' | 'menu' | 'listbox' | 'tooltip' | 'presentation';
  label?: string | undefined;
  id?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Close when a pointer goes down outside the popover and its anchor. Default true. */
  dismissOnOutside?: boolean;
  /** Close on Escape. Default true. */
  dismissOnEscape?: boolean;
  children: ReactNode;
}

function anchorRect(anchor: PopoverProps['anchor']): Rect | null {
  if ('current' in anchor) {
    const el = anchor.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }
  return anchor;
}

/**
 * A floating surface anchored to an element or point: positioned in the viewport (flips and
 * shifts to stay visible), rendered in the overlay layer, dismissed by Escape or an outside click.
 * Focus management belongs to the component using it (menus, comboboxes, dialogs differ).
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = 'bottom-start',
  gap = 4,
  matchWidth = false,
  role = 'dialog',
  label,
  id,
  className,
  style,
  dismissOnOutside = true,
  dismissOnEscape = true,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    if (!open) return;
    let retry = 0;
    const update = (): void => {
      const el = ref.current;
      const a = anchorRect(anchor);
      if (!el || !a) {
        // Not attached yet (mounted open, or React's dev double-run of effects): try next frame.
        retry = requestAnimationFrame(update);
        return;
      }
      const width = matchWidth ? Math.max(a.width, 160) : undefined;
      const size = { width: width ?? el.offsetWidth, height: el.offsetHeight };
      const p = computePosition(a, size, { width: window.innerWidth, height: window.innerHeight }, placement, gap);
      setPos({ top: p.top, left: p.left, ...(width === undefined ? {} : { width }) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(retry);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      // Re-measure from scratch next time it opens.
      setPos(null);
    };
  }, [open, anchor, placement, gap, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!dismissOnOutside) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if ('current' in anchor && anchor.current?.contains(target)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (dismissOnEscape && e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, dismissOnOutside, dismissOnEscape]);

  if (!open) return null;
  return (
    <Portal>
      <div
        ref={ref}
        id={id}
        role={role === 'presentation' ? undefined : role}
        aria-label={label}
        className={cx(styles.popover, pos === null && styles.measuring, className)}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, ...(pos?.width === undefined ? {} : { width: pos.width }), ...style }}
      >
        {children}
      </div>
    </Portal>
  );
}
