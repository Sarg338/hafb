import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute, type Route } from './router.ts';

describe('parseRoute', () => {
  it.each<[string, Route]>([
    ['', { kind: 'plan' }],
    ['#/', { kind: 'plan' }],
    ['#/plan', { kind: 'plan' }],
    ['#/plan?month=2026-10', { kind: 'plan', month: '2026-10' }],
    ['#/plan?month=October', { kind: 'plan' }],
    ['#/reflect', { kind: 'reflect' }],
    ['#/reflect?tab=trends', { kind: 'reflect', tab: 'trends' }],
    ['#/accounts', { kind: 'accounts', accountId: null }],
    ['#/accounts/0192a3b4-acct', { kind: 'accounts', accountId: '0192a3b4-acct' }],
    ['#/accounts/a%20b', { kind: 'accounts', accountId: 'a b' }],
    ['#/accounts/acc1?tx=t%201', { kind: 'accounts', accountId: 'acc1', tx: 't 1' }],
    ['#/design', { kind: 'dev', page: 'design' }],
    ['#/design/register?theme=dark', { kind: 'dev', page: 'design' }],
    ['#/gallery?section=menus', { kind: 'dev', page: 'gallery' }],
    ['#/nonsense', { kind: 'plan' }],
    ['#/spike', { kind: 'plan' }],
  ])('%s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
});

describe('formatRoute', () => {
  it.each<[Route, string]>([
    [{ kind: 'plan' }, '#/plan'],
    [{ kind: 'plan', month: '2026-11' }, '#/plan?month=2026-11'],
    [{ kind: 'reflect' }, '#/reflect'],
    [{ kind: 'reflect', tab: 'networth' }, '#/reflect?tab=networth'],
    [{ kind: 'accounts', accountId: null }, '#/accounts'],
    [{ kind: 'accounts', accountId: 'a b' }, '#/accounts/a%20b'],
    [{ kind: 'accounts', accountId: 'a', tx: 't/1' }, '#/accounts/a?tx=t%2F1'],
    [{ kind: 'dev', page: 'gallery' }, '#/gallery'],
  ])('%j', (route, hash) => {
    expect(formatRoute(route)).toBe(hash);
  });

  it('round-trips', () => {
    const routes: Route[] = [{ kind: 'plan', month: '2027-01' }, { kind: 'reflect', tab: 'income' }, { kind: 'accounts', accountId: 'x/y' }];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});
