// Toasts: short feedback with an optional action, chiefly Undo/Redo ("Undid: Assign: Car Fund").
// One shows at a time (toastQueue.ts). Info toasts leave after 5 s, paused while hovered or
// focused; errors stay until dismissed.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Portal } from './Portal.tsx';
import styles from './Toast.module.css';
import { emptyToasts, toastReducer, type ToastAction, type ToastItem } from './toastQueue.ts';

export const TOAST_DURATION_MS = 5000;

export interface ToastOptions {
  text: string;
  tone?: 'info' | 'error';
  action?: ToastAction;
  durationMs?: number;
  /** Replace the current info toast instead of queueing (rapid undo/redo feedback). */
  replace?: boolean;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, emptyToasts);
  const nextId = useRef(1);

  const toast = useCallback((options: ToastOptions): number => {
    const id = nextId.current;
    nextId.current += 1;
    const item: ToastItem = {
      id,
      text: options.text,
      tone: options.tone ?? 'info',
      ...(options.action ? { action: options.action } : {}),
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    };
    dispatch({ type: options.replace === true ? 'replace' : 'push', toast: item });
    return id;
  }, []);
  const dismiss = useCallback((id: number) => {
    dispatch({ type: 'dismiss', id });
  }, []);
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {state.current && (
        <Portal>
          <ToastView key={state.current.id} item={state.current} onDismiss={dismiss} />
        </Portal>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs a <ToastProvider> above it');
  return api;
}

/** One toast. `inline` draws it in the page flow (gallery specimens). */
export function ToastView({ item, onDismiss, inline = false }: { item: ToastItem; onDismiss: (id: number) => void; inline?: boolean }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (inline || item.tone === 'error' || paused) return;
    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, item.durationMs ?? TOAST_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [inline, item, paused, onDismiss]);

  const error = item.tone === 'error';
  return (
    <div
      className={cx(styles.toast, inline && styles.inline)}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      onPointerEnter={() => {
        setPaused(true);
      }}
      onPointerLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
    >
      <span className={styles.text}>
        {error && <Icon name="warning" />}
        {item.text}
      </span>
      {item.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            item.action?.onAction();
            onDismiss(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={() => {
        onDismiss(item.id);
      }}>
        <Icon name="dismiss" />
      </button>
    </div>
  );
}
