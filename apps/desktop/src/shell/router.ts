// Hash routes for the app shell (S3.3). Pure parse/format plus a tiny subscription hook.
//   #/plan[?month=YYYY-MM]   #/reflect[?tab=…]   #/accounts   #/accounts/<accountId>
//   #/design…, #/gallery…    dev pages, rendered outside the shell (they read their own params)
import { useSyncExternalStore } from 'react';
import { isMonth, type Month } from '@hafb/shared';

export type Route =
  | { kind: 'plan'; month?: Month }
  | { kind: 'reflect'; tab?: string }
  | { kind: 'accounts'; accountId: string | null }
  | { kind: 'dev'; page: 'design' | 'gallery' };

export function parseRoute(hash: string): Route {
  const body = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = body.split('?');
  const params = new URLSearchParams(query);
  const [head = '', ...rest] = path.split('/');
  switch (head) {
    case 'design':
    case 'gallery':
      return { kind: 'dev', page: head };
    case 'reflect': {
      const tab = params.get('tab');
      return tab ? { kind: 'reflect', tab } : { kind: 'reflect' };
    }
    case 'accounts': {
      const id = rest.join('/');
      return { kind: 'accounts', accountId: id === '' ? null : decodeURIComponent(id) };
    }
    default: {
      const month = params.get('month');
      return month !== null && isMonth(month) ? { kind: 'plan', month } : { kind: 'plan' };
    }
  }
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'plan':
      return route.month === undefined ? '#/plan' : `#/plan?month=${route.month}`;
    case 'reflect':
      return route.tab === undefined ? '#/reflect' : `#/reflect?tab=${encodeURIComponent(route.tab)}`;
    case 'accounts':
      return route.accountId === null ? '#/accounts' : `#/accounts/${encodeURIComponent(route.accountId)}`;
    case 'dev':
      return `#/${route.page}`;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

const readHash = (): string => window.location.hash;

/** The current route; re-renders on hash changes (back/forward included). */
export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, readHash));
}

export function navigate(route: Route): void {
  const hash = formatRoute(route);
  if (window.location.hash !== hash) window.location.hash = hash;
}
