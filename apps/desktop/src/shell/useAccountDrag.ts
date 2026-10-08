// Drag accounts to reorder them in the sidebar (S4.4), within their section. The keyboard
// equivalents are Move up / Move down in the account's menu (Shift+F10).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PlanData } from '@hafb/store';
import { moveAccount } from '../screens/accounts/accountsModel.ts';

const THRESHOLD = 5;

export function useAccountDrag(plan: PlanData, onReorder: (ids: string[]) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ id: string; section: string; x: number; y: number; pointerId: number; dragging: boolean } | null>(null);
  const target = useRef<{ id: string; position: 'before' | 'after' } | null>(null);
  const justDragged = useRef(false);
  const [line, setLine] = useState<number | null>(null);
  const latest = useRef({ plan, onReorder });
  useEffect(() => {
    latest.current = { plan, onReorder };
  });

  useEffect(() => {
    const stop = (): void => {
      pending.current = null;
      target.current = null;
      setLine(null);
      document.documentElement.style.removeProperty('cursor');
    };
    const onMove = (e: PointerEvent): void => {
      const p = pending.current;
      if (p?.pointerId !== e.pointerId) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return;
        p.dragging = true;
        document.documentElement.style.setProperty('cursor', 'grabbing');
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el instanceof Element ? el.closest<HTMLElement>('[data-account-id]') : null;
      const host = containerRef.current;
      if (!row || !host || row.dataset.section !== p.section || row.dataset.accountId === p.id) {
        target.current = null;
        setLine(null);
        return;
      }
      const r = row.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      target.current = { id: row.dataset.accountId ?? '', position: before ? 'before' : 'after' };
      const h = host.getBoundingClientRect();
      setLine((before ? r.top : r.bottom) - h.top + host.scrollTop);
    };
    const onUp = (e: PointerEvent): void => {
      const p = pending.current;
      if (p?.pointerId !== e.pointerId) return;
      const t = target.current;
      const dragged = p.dragging;
      stop();
      if (!dragged) return;
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (!t) return;
      const ids = moveAccount(latest.current.plan, p.id, t.id, t.position);
      if (ids) latest.current.onReorder(ids);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const id = e.currentTarget.dataset.accountId;
    const section = e.currentTarget.dataset.section;
    // The Starred section mirrors other sections; order is changed where an account really lives.
    if (id === undefined || section === undefined || section === 'starred') return;
    pending.current = { id, section, x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
  };

  return { containerRef, onPointerDown, justDragged, line };
}
