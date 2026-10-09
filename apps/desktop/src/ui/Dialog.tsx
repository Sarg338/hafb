// Modal dialog (WAI-ARIA APG "dialog (modal)"): focus moves in and is trapped, Escape closes,
// focus returns to whatever opened it, the page behind doesn't scroll. Plus useConfirm(), the
// in-app replacement for window.confirm().
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, IconButton } from './Button.tsx';
import { cx } from './cx.ts';
import styles from './Dialog.module.css';
import { rememberFocus, tabbables, trapTab } from './focus.ts';
import { Portal } from './Portal.tsx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, primary last (it sits on the right). */
  footer?: ReactNode;
  /** Element to focus when the dialog opens; otherwise the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Escape and the close button dismiss it. Default true. */
  dismissible?: boolean | undefined;
  /** 'large': a two-pane manager (Manage Payees). */
  size?: 'normal' | 'wide' | 'large' | undefined;
}

export function Dialog({ open, ...panel }: DialogProps) {
  return open ? <DialogPanel {...panel} /> : null;
}

/** Mounted only while open, so focus handling runs once per opening. */
function DialogPanel({ onClose, title, description, children, footer, initialFocus, dismissible, size }: Omit<DialogProps, 'open'>) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const restore = rememberFocus();
    const el = panel.current;
    const target = initialFocus?.current ?? (el ? tabbables(el)[0] : undefined) ?? el;
    target?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      restore();
    };
  }, [initialFocus]);

  return (
    <Portal>
      <div className={styles.scrim}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description === undefined ? undefined : descId}
          tabIndex={-1}
          className={cx(styles.panel, size === 'wide' && styles.wide, size === 'large' && styles.large)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && dismissible !== false) {
              e.stopPropagation();
              onClose();
            } else if (panel.current) {
              trapTab(e, panel.current);
            }
          }}
        >
          <div className={styles.head}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {dismissible !== false && <IconButton icon="dismiss" label="Close" size="small" onClick={onClose} />}
          </div>
          {description !== undefined && (
            <p id={descId} className={styles.description}>
              {description}
            </p>
          )}
          {children !== undefined && <div className={styles.body}>{children}</div>}
          {footer !== undefined && <div className={styles.footer}>{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

// ---- confirm -----------------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive: the confirm button is red and Cancel takes the initial focus. */
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

interface Pending {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/** Hosts confirm dialogs for everything below it. Put it once near the app root. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );

  const finish = (ok: boolean): void => {
    pending?.resolve(ok);
    setPending(null);
  };

  const o = pending?.options;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => {
          finish(false);
        }}
        title={o?.title ?? ''}
        description={o?.body}
        initialFocus={o?.danger === true ? cancelRef : confirmRef}
        footer={
          <>
            <Button ref={cancelRef} onClick={() => {
              finish(false);
            }}>
              {o?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button ref={confirmRef} variant={o?.danger === true ? 'danger' : 'primary'} onClick={() => {
              finish(true);
            }}>
              {o?.confirmLabel ?? 'OK'}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (await confirm({ title: 'Restore?' })) …` */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  return useMemo(() => {
    if (confirm) return confirm;
    return () => Promise.reject(new Error('useConfirm needs a <ConfirmProvider> above it'));
  }, [confirm]);
}
