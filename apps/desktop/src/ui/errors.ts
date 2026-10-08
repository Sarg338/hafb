// Error surfacing (S3.5): every error the UI can meet becomes clear, factual copy (PRODUCT.md: the
// app is warm, but errors stay factual), and nothing is swallowed silently (CLAUDE.md §9).
import { InvariantViolation, ValidationError } from '@hafb/engine';

export type ErrorKind = 'validation' | 'invariant' | 'store' | 'unexpected';

export interface DescribedError {
  title: string;
  message: string;
  kind: ErrorKind;
  /** The user can carry on (fix the input, try again); false means something is wrong underneath. */
  recoverable: boolean;
}

interface StoreErrorLike {
  kind: string;
  message: string;
}

function isStoreError(e: unknown): e is StoreErrorLike {
  return typeof e === 'object' && e !== null && !(e instanceof Error) && 'kind' in e && 'message' in e && typeof e.kind === 'string' && typeof e.message === 'string';
}

const STORE: Record<string, { title: string; message: (detail: string) => string; recoverable: boolean }> = {
  AlreadyOpen: {
    title: 'This plan is open in another window',
    message: () => 'Switch to that window, or close it there first. Nothing was changed.',
    recoverable: true,
  },
  NewerVersion: {
    title: 'This plan was saved by a newer version of HAFB',
    message: () => 'Update HAFB to open it. The file was not changed.',
    recoverable: true,
  },
  NotAPlan: {
    title: "That file isn't a plan",
    message: () => 'Choose a .hafb plan file. Nothing was changed.',
    recoverable: true,
  },
  NotOpen: {
    title: 'No plan is open',
    message: () => 'Open or create a plan first.',
    recoverable: true,
  },
  Invalid: {
    title: "That change couldn't be saved",
    message: (d) => `The plan file refused it, so nothing was saved. ${d}`,
    recoverable: true,
  },
  Io: {
    title: "Couldn't read or write the plan file",
    message: (d) => `Check the file is still there and not read-only. Your last saved changes are safe. ${d}`,
    recoverable: true,
  },
  Sqlite: {
    title: 'The plan file reported an error',
    message: (d) => `The change was rolled back, so the file is as it was. ${d}`,
    recoverable: false,
  },
};

export function describeError(e: unknown): DescribedError {
  if (e instanceof ValidationError) {
    return { title: "That didn't work", message: e.message, kind: 'validation', recoverable: true };
  }
  if (e instanceof InvariantViolation) {
    return {
      title: "Something in the plan doesn't add up",
      message: `HAFB stopped the change to protect your plan. Details: ${e.message}`,
      kind: 'invariant',
      recoverable: false,
    };
  }
  if (isStoreError(e)) {
    const known = STORE[e.kind];
    if (known) return { title: known.title, message: known.message(e.message).trim(), kind: 'store', recoverable: known.recoverable };
    return { title: 'The plan file reported a problem', message: e.message, kind: 'store', recoverable: false };
  }
  const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return {
    title: 'Something went wrong',
    message: detail === '' ? 'An unexpected error happened. Your saved plan is unaffected.' : detail,
    kind: 'unexpected',
    recoverable: true,
  };
}

/** Text for "Copy details": enough to report a bug, nothing private beyond the error itself. */
export function errorDetails(e: unknown): string {
  if (e instanceof Error) return [`${e.name}: ${e.message}`, e.stack ?? ''].filter((s) => s !== '').join('\n');
  try {
    return JSON.stringify(e, null, 2);
  } catch {
    return String(e);
  }
}

/** True the first time a key is seen within `windowMs`; repeats inside the window are dropped. */
export function createDeduper(windowMs: number): (key: string, now: number) => boolean {
  const last = new Map<string, number>();
  return (key, now) => {
    const at = last.get(key);
    if (at !== undefined && now - at < windowMs) return false;
    last.set(key, now);
    return true;
  };
}

/** Route uncaught errors and rejected promises to `report`. Returns an uninstaller. */
export function installGlobalErrorHandlers(report: (error: DescribedError, raw: unknown) => void, target: Window = window): () => void {
  const fresh = createDeduper(5000);
  const handle = (raw: unknown): void => {
    const d = describeError(raw);
    if (fresh(`${d.title}|${d.message}`, Date.now())) report(d, raw);
  };
  const onError = (ev: ErrorEvent): void => {
    handle(ev.error ?? ev.message);
  };
  const onRejection = (ev: PromiseRejectionEvent): void => {
    handle(ev.reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
