import { useEffect } from 'react';
import { session, type Toast } from './session.ts';

/** One toast at a time (undo/redo confirmations, errors). Errors stay until dismissed. */
export function ToastHost({ toast }: { toast: Toast | null }) {
  useEffect(() => {
    if (!toast || toast.tone === 'error') return;
    const timer = window.setTimeout(() => {
      session.dismissToast(toast.id);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span>{toast.text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => {
        session.dismissToast(toast.id);
      }}>
        ×
      </button>
    </div>
  );
}
