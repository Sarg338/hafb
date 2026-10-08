// Tooltip (WAI-ARIA APG "tooltip"): appears after a short hover, at once on keyboard focus,
// and hides on Escape, blur or pointer leave. It never takes focus.
import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { Kbd } from './Kbd.tsx';
import { Popover } from './Popover.tsx';
import styles from './Tooltip.module.css';

/** Hover delay before a tooltip shows. */
export const TOOLTIP_DELAY_MS = 500;

export interface TooltipTriggerProps {
  ref: (el: HTMLElement | null) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
}

export interface UseTooltipOptions {
  shortcut?: string | undefined;
  /**
   * Point aria-describedby at the tooltip. Leave false when the tooltip only repeats the trigger's
   * accessible name (icon buttons), so screen readers don't hear it twice.
   */
  describe?: boolean;
  /** Keep it showing (gallery specimens and review captures). */
  forceOpen?: boolean;
}

/** Wire a tooltip to any trigger: spread `triggerProps` on it and render `tooltip` next to it. */
export function useTooltip(text: string | undefined, { shortcut, describe = true, forceOpen = false }: UseTooltipOptions = {}): {
  triggerProps: TooltipTriggerProps;
  tooltip: ReactNode;
} {
  const id = useId();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const anchor = useMemo(() => ({ current: el }), [el]);

  const clear = (): void => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const hide = (): void => {
    clear();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    // Escape hides the tooltip without stopping the event: a dialog behind it still gets Escape.
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => clear, []);

  const enabled = text !== undefined && text !== '';
  const triggerProps: TooltipTriggerProps = {
    ref: setEl,
    onPointerEnter: () => {
      if (!enabled) return;
      clear();
      timer.current = window.setTimeout(() => {
        setOpen(true);
      }, TOOLTIP_DELAY_MS);
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (e) => {
      if (enabled && e.currentTarget.matches(':focus-visible')) setOpen(true);
    },
    onBlur: hide,
    onKeyDown: (e) => {
      if (e.key === 'Escape') hide();
    },
    ...(describe && enabled ? { 'aria-describedby': id } : {}),
  };

  const tooltip = enabled ? (
    <TooltipBubble open={open || forceOpen} id={id} anchor={anchor} text={text} shortcut={shortcut} onClose={hide} />
  ) : null;
  return { triggerProps, tooltip };
}

function TooltipBubble({
  open,
  id,
  anchor,
  text,
  shortcut,
  onClose,
}: {
  open: boolean;
  id: string;
  anchor: { current: HTMLElement | null };
  text: string;
  shortcut: string | undefined;
  onClose: () => void;
}) {
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement="top" gap={6} role="tooltip" id={id} className={cx(styles.tooltip)} dismissOnOutside={false} dismissOnEscape={false}>
      <span>{text}</span>
      {shortcut !== undefined && <Kbd keys={shortcut} />}
    </Popover>
  );
}

/** Render-prop form: `<Tooltip text="Undo" shortcut="Ctrl+Z">{(p) => <button {...p}>…</button>}</Tooltip>`. */
export function Tooltip({
  text,
  shortcut,
  forceOpen = false,
  children,
}: {
  text: string;
  shortcut?: string;
  forceOpen?: boolean;
  children: (props: TooltipTriggerProps) => ReactNode;
}) {
  const { triggerProps, tooltip } = useTooltip(text, { shortcut, forceOpen });
  return (
    <>
      {children(triggerProps)}
      {tooltip}
    </>
  );
}
