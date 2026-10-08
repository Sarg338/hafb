// Focus management across screens (S3.5): after a route change, focus moves to the new screen's
// heading so keyboard and screen-reader users land at the top of what changed; overlays put focus
// back where it was when they close.
import { useEffect, useRef, type RefObject } from 'react';
import { rememberFocus } from './focus.ts';

/**
 * Move focus to the new screen only on a real change, and never steal it from a field the user is
 * typing in (a route can change programmatically while focus sits in an input elsewhere).
 */
export function shouldMoveFocus(previous: string | null, next: string, activeIsEditable: boolean): boolean {
  return previous !== null && previous !== next && !activeIsEditable;
}

const EDITABLE = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"], [role="combobox"]';

/**
 * Focus `target` (a heading with tabIndex={-1}) whenever `routeKey` changes, without scrolling.
 * The first render doesn't move focus: the window opening already starts at the top.
 */
export function useRouteFocus(routeKey: string, target: RefObject<HTMLElement | null>): void {
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const active = document.activeElement;
    const editable = active instanceof Element && active.matches(EDITABLE);
    if (shouldMoveFocus(previous.current, routeKey, editable)) target.current?.focus({ preventScroll: true });
    previous.current = routeKey;
  }, [routeKey, target]);
}

/**
 * While `active` is true (a panel or popover is showing), remember what had focus before it; put
 * focus back when it turns false. Modal dialogs already do this (Dialog.tsx).
 */
export function useRestoreFocus(active: boolean): void {
  const restore = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (active) {
      restore.current = rememberFocus();
      return;
    }
    restore.current?.();
    restore.current = null;
  }, [active]);
}
