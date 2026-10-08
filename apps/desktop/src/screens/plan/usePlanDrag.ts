// Drag to reorder on the Plan grid (S4.2): grab a category or group by its name and drop it
// between rows. Pointer events only; the keyboard equivalents are Move up / Move down in the row
// menu. Where things land is decided by planEdit.ts; this hook only tracks the pointer.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Id } from '@hafb/engine';
import type { CategoryDrop } from './planEdit.ts';
import { HIDDEN_SECTION_ID, type PlanRow } from './planRows.ts';

export type DragKind = 'category' | 'group';

export type DropTarget =
  | { kind: 'category'; drop: CategoryDrop; line: number }
  | { kind: 'group'; targetGroupId: Id; position: 'before' | 'after'; line: number };

interface Pending {
  kind: DragKind;
  id: Id;
  x: number;
  y: number;
  pointerId: number;
  dragging: boolean;
}

const THRESHOLD = 5;
const EDGE = 36;

export interface PlanDragOptions {
  wrap: RefObject<HTMLDivElement | null>;
  rows: ReadonlyMap<string, { row: PlanRow; groupId: string | undefined }>;
  onDropCategory: (categoryId: Id, drop: CategoryDrop) => void;
  onDropGroup: (groupId: Id, targetGroupId: Id, position: 'before' | 'after') => void;
}

export function usePlanDrag({ wrap, rows, onDropCategory, onDropGroup }: PlanDragOptions) {
  const pending = useRef<Pending | null>(null);
  const [indicator, setIndicator] = useState<{ top: number; label: string } | null>(null);
  const target = useRef<DropTarget | null>(null);
  /** Set right after a drag so the click that ends it doesn't also open the name popover. */
  const justDragged = useRef(false);
  const optsRef = useRef({ rows, onDropCategory, onDropGroup });
  useEffect(() => {
    optsRef.current = { rows, onDropCategory, onDropGroup };
  });

  const rowEl = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y);
    const row = el instanceof Element ? el.closest<HTMLElement>('[role=row][data-row-id]') : null;
    return row && wrap.current?.contains(row) === true ? row : null;
  };

  /** The bottom edge of a group's last rendered row (where "after this group" draws). */
  const groupBottom = (groupId: string): number | null => {
    const host = wrap.current;
    if (!host) return null;
    let bottom: number | null = null;
    for (const el of host.querySelectorAll<HTMLElement>('[role=row][data-row-id]')) {
      const id = el.dataset.rowId ?? '';
      const info = optsRef.current.rows.get(id);
      if (id === groupId || info?.groupId === groupId) bottom = Math.max(bottom ?? 0, el.getBoundingClientRect().bottom);
    }
    return bottom;
  };

  const compute = (p: Pending, x: number, y: number): DropTarget | null => {
    const row = rowEl(x, y);
    if (!row) return null;
    const id = row.dataset.rowId ?? '';
    const info = optsRef.current.rows.get(id);
    if (!info) return null;
    const rect = row.getBoundingClientRect();
    const upper = y < rect.top + rect.height / 2;
    if (p.kind === 'category') {
      if (info.row.kind === 'group') {
        if (id === HIDDEN_SECTION_ID || info.row.system === 'hidden') return null;
        return { kind: 'category', drop: { kind: 'group', id }, line: rect.bottom };
      }
      if (info.row.hidden || info.groupId === HIDDEN_SECTION_ID || id === p.id) return null;
      return { kind: 'category', drop: { kind: 'category', id, position: upper ? 'before' : 'after' }, line: upper ? rect.top : rect.bottom };
    }
    const groupId = info.row.kind === 'group' ? id : info.groupId;
    if (groupId === undefined || groupId === HIDDEN_SECTION_ID || groupId === p.id) return null;
    const position = info.row.kind === 'group' && upper ? 'before' : 'after';
    const line = position === 'before' ? rect.top : (groupBottom(groupId) ?? rect.bottom);
    return { kind: 'group', targetGroupId: groupId, position, line };
  };

  const stop = useCallback(() => {
    pending.current = null;
    target.current = null;
    setIndicator(null);
    document.documentElement.style.removeProperty('cursor');
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const p = pending.current;
      if (p?.pointerId !== e.pointerId) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return;
        p.dragging = true;
        document.documentElement.style.setProperty('cursor', 'grabbing');
      }
      e.preventDefault();
      // Scroll the grid when the pointer nears its top or bottom edge.
      const scroller = wrap.current?.querySelector<HTMLElement>('[role=treegrid], [role=grid]');
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (e.clientY < r.top + EDGE) scroller.scrollTop -= 14;
        else if (e.clientY > r.bottom - EDGE) scroller.scrollTop += 14;
      }
      const t = compute(p, e.clientX, e.clientY);
      target.current = t;
      const host = wrap.current?.getBoundingClientRect();
      setIndicator(t && host ? { top: t.line - host.top, label: t.kind === 'group' ? 'group' : 'category' } : null);
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
      if (t.kind === 'category' && p.kind === 'category') optsRef.current.onDropCategory(p.id, t.drop);
      else if (t.kind === 'group' && p.kind === 'group') optsRef.current.onDropGroup(p.id, t.targetGroupId, t.position);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && pending.current?.dragging === true) {
        e.preventDefault();
        e.stopPropagation();
        justDragged.current = true;
        stop();
        window.setTimeout(() => {
          justDragged.current = false;
        }, 0);
      }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', onKey, true);
    };
    // compute reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop, wrap]);

  /** Attach to the grid wrapper: starts a possible drag from an element marked data-drag. */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
    const handle = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-drag]') : null;
    const kind = handle?.dataset.drag;
    const id = handle?.dataset.dragId;
    if ((kind !== 'category' && kind !== 'group') || id === undefined) return;
    pending.current = { kind, id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
  };

  return { onPointerDown, indicator, justDragged };
}
