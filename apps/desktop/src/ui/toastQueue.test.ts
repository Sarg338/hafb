import { describe, expect, it } from 'vitest';
import { emptyToasts, toastReducer, type ToastItem } from './toastQueue.ts';

const t = (id: number, text = `t${String(id)}`, tone: ToastItem['tone'] = 'info'): ToastItem => ({ id, text, tone });

describe('toast queue', () => {
  it('shows the first toast and queues the rest', () => {
    let s = toastReducer(emptyToasts, { type: 'push', toast: t(1) });
    s = toastReducer(s, { type: 'push', toast: t(2) });
    expect(s.current?.id).toBe(1);
    expect(s.queue.map((x) => x.id)).toEqual([2]);
  });

  it('dismissing shows the next one', () => {
    let s = toastReducer(emptyToasts, { type: 'push', toast: t(1) });
    s = toastReducer(s, { type: 'push', toast: t(2) });
    s = toastReducer(s, { type: 'dismiss', id: 1 });
    expect(s.current?.id).toBe(2);
    expect(s.queue).toEqual([]);
    s = toastReducer(s, { type: 'dismiss', id: 2 });
    expect(s.current).toBeNull();
  });

  it('dismissing a queued toast removes it without touching the current one', () => {
    let s = toastReducer(emptyToasts, { type: 'push', toast: t(1) });
    s = toastReducer(s, { type: 'push', toast: t(2) });
    s = toastReducer(s, { type: 'dismiss', id: 2 });
    expect(s.current?.id).toBe(1);
    expect(s.queue).toEqual([]);
  });

  it('a stale dismiss (an old timer) is ignored', () => {
    const s = toastReducer(emptyToasts, { type: 'push', toast: t(1) });
    expect(toastReducer(s, { type: 'dismiss', id: 99 })).toBe(s);
  });

  it('a newer info toast replaces a current info toast that has no action (undo feedback stays fresh)', () => {
    let s = toastReducer(emptyToasts, { type: 'push', toast: t(1, 'Undid: Assign') });
    s = toastReducer(s, { type: 'push', toast: t(2, 'Redid: Assign') });
    expect(s.current?.id).toBe(1);
    s = toastReducer(s, { type: 'replace', toast: t(3, 'Undid: Move') });
    expect(s.current?.id).toBe(3);
    expect(s.queue.map((x) => x.id)).toEqual([2]);
  });

  it('a newer change replaces an older Undo toast (Undo always applies to the latest change)', () => {
    let s = toastReducer(emptyToasts, { type: 'replace', toast: { ...t(1, 'Hid “Groceries”.'), action: { label: 'Undo', onAction: () => undefined } } });
    s = toastReducer(s, { type: 'replace', toast: { ...t(2, 'Deleted “Pets”.'), action: { label: 'Undo', onAction: () => undefined } } });
    expect(s.current?.id).toBe(2);
    expect(s.queue).toEqual([]);
  });

  it('errors jump the queue but never replace a visible error', () => {
    let s = toastReducer(emptyToasts, { type: 'push', toast: t(1) });
    s = toastReducer(s, { type: 'push', toast: t(2) });
    s = toastReducer(s, { type: 'push', toast: t(3, 'Could not save', 'error') });
    expect(s.queue.map((x) => x.id)).toEqual([3, 2]);
    s = toastReducer(emptyToasts, { type: 'push', toast: t(4, 'e1', 'error') });
    s = toastReducer(s, { type: 'replace', toast: t(5) });
    expect(s.current?.id).toBe(4);
    expect(s.queue.map((x) => x.id)).toEqual([5]);
  });
});
