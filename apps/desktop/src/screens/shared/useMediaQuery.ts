import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query (e.g. the approved mockups' "smaller laptop" breakpoint). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => {
        list.removeEventListener('change', notify);
      };
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below 1366 px the approved layout narrows its money columns (DESIGN.md, S3.1 breakpoint). */
export const NARROW_WINDOW = '(max-width: 1365px)';

/**
 * Reflow (WCAG 1.4.10, S7.4): at large text sizes the window is only a few hundred CSS px wide.
 * Below 1024 px the sidebar becomes its rail; below 900 px the inspector opens over the plan.
 */
export const TIGHT_WINDOW = '(max-width: 1023px)';
export const COMPACT_WINDOW = '(max-width: 899px)';
