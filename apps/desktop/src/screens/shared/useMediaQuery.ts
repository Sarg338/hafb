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
