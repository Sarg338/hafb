import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const LAYER_ID = 'hafb-layer';

function layer(): HTMLElement {
  let el = document.getElementById(LAYER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = LAYER_ID;
    // The layer inherits the app's typography and focus styles (ui/base.css).
    el.className = 'hafb-root';
    el.style.background = 'transparent';
    document.body.append(el);
  }
  return el;
}

/** Render children into the shared overlay layer (popovers, menus, dialogs, toasts). */
export function Portal({ children }: { children: ReactNode }) {
  // The layer is created once and shared; creating it on first use is idempotent.
  const [target] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : layer()));
  return target ? createPortal(children, target) : null;
}
