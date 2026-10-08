// Toast queue: one toast visible at a time (the approved S3.1 toast sits bottom-centre), the rest
// wait in order. Errors jump the queue and are never replaced; `replace` lets fast repeated feedback
// (undo, undo, undo; delete then hide) show the latest message instead of a backlog. Pure reducer.

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastItem {
  id: number;
  text: string;
  tone: 'info' | 'error';
  action?: ToastAction;
  /** Auto-dismiss after this long (info only). */
  durationMs?: number;
}

export interface ToastState {
  current: ToastItem | null;
  queue: readonly ToastItem[];
}

export type ToastEvent = { type: 'push'; toast: ToastItem } | { type: 'replace'; toast: ToastItem } | { type: 'dismiss'; id: number };

export const emptyToasts: ToastState = { current: null, queue: [] };

function enqueue(queue: readonly ToastItem[], toast: ToastItem): ToastItem[] {
  if (toast.tone !== 'error') return [...queue, toast];
  const firstInfo = queue.findIndex((q) => q.tone !== 'error');
  if (firstInfo < 0) return [...queue, toast];
  return [...queue.slice(0, firstInfo), toast, ...queue.slice(firstInfo)];
}

export function toastReducer(state: ToastState, event: ToastEvent): ToastState {
  switch (event.type) {
    case 'push':
      if (!state.current) return { current: event.toast, queue: state.queue };
      return { current: state.current, queue: enqueue(state.queue, event.toast) };
    case 'replace':
      if (!state.current) return { current: event.toast, queue: state.queue };
      // An older Undo/Redo toast is stale once there's a newer change: its action always applies to the
      // latest step, so the newest message replaces it. Errors stay until dismissed.
      if (state.current.tone === 'error') return { current: state.current, queue: enqueue(state.queue, event.toast) };
      return { current: event.toast, queue: state.queue };
    case 'dismiss': {
      if (state.current?.id === event.id) {
        const [next, ...rest] = state.queue;
        return { current: next ?? null, queue: rest };
      }
      if (!state.queue.some((q) => q.id === event.id)) return state;
      return { current: state.current, queue: state.queue.filter((q) => q.id !== event.id) };
    }
  }
}
