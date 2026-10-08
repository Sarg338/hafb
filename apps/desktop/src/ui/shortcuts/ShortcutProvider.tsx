// Keyboard shortcuts for the whole app (S3.5): one document listener, scoped registrations, the
// `?` overlay, and the user's "keyboard shortcuts on" setting (CLAUDE.md §6.14).
//
// Listener phase: BUBBLE on document. Components that own keys (menus, dialogs, comboboxes, the
// editable grid, date fields) handle them on their own elements first and call preventDefault or
// stopPropagation; the registry ignores any event already handled, so their keys always win.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createMatcher, findConflicts, isEditableTarget, type ShortcutConflict, type ShortcutDef } from './registry.ts';
import { ShortcutOverlay } from './ShortcutOverlay.tsx';
import { ShortcutStore, type RegisteredShortcut } from './store.ts';

interface ShortcutApi {
  store: ShortcutStore;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
}

const ShortcutContext = createContext<ShortcutApi | null>(null);

export const OVERLAY_SHORTCUT_ID = 'general.shortcuts';

export interface ShortcutProviderProps {
  children: ReactNode;
  /** The user's setting. The provider stores nothing: persist it via onEnabledChange. */
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  /** Start with the overlay open (gallery review captures). */
  initialOverlayOpen?: boolean;
}

function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

export function ShortcutProvider({ children, enabled: enabledProp, onEnabledChange, initialOverlayOpen = false }: ShortcutProviderProps) {
  const [store] = useState(() => new ShortcutStore());
  const [ownEnabled, setOwnEnabled] = useState(true);
  const enabled = enabledProp ?? ownEnabled;
  const [overlayOpen, setOverlayOpen] = useState(initialOverlayOpen);
  const [matcher] = useState(() => createMatcher());

  const setEnabled = useCallback(
    (on: boolean) => {
      setOwnEnabled(on);
      onEnabledChange?.(on);
    },
    [onEnabledChange],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      const target = e.target instanceof Element ? e.target : null;
      const hit = matcher.match(
        store.getSnapshot(),
        e,
        { editable: isEditableTarget(target instanceof HTMLElement ? target : null), modal: modalOpen(), enabled },
        performance.now(),
      );
      if (!hit) return;
      const entry = store.getSnapshot().find((s) => s === hit);
      e.preventDefault();
      entry?.run(e);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [store, matcher, enabled]);

  const api = useMemo(() => ({ store, enabled, setEnabled, overlayOpen, setOverlayOpen }), [store, enabled, setEnabled, overlayOpen]);

  return (
    <ShortcutContext.Provider value={api}>
      <OverlayShortcut />
      {children}
      <ShortcutOverlay
        open={overlayOpen}
        onClose={() => {
          setOverlayOpen(false);
        }}
      />
    </ShortcutContext.Provider>
  );
}

/** `?` toggles the overlay. System: works with shortcuts off, so the user can turn them back on. */
function OverlayShortcut() {
  const { overlayOpen, setOverlayOpen } = useShortcuts();
  useShortcut({
    id: OVERLAY_SHORTCUT_ID,
    keys: '?',
    description: 'Show keyboard shortcuts',
    group: 'General',
    scope: 'global',
    system: true,
    run: () => {
      setOverlayOpen(!overlayOpen);
    },
  });
  return null;
}

function useApi(): ShortcutApi {
  const api = useContext(ShortcutContext);
  if (!api) throw new Error('Keyboard shortcuts need a <ShortcutProvider> above them');
  return api;
}

export interface UseShortcutOptions extends ShortcutDef {
  run: (event: KeyboardEvent) => void;
}

/**
 * Register a shortcut for as long as the calling component is mounted. `run` may change every
 * render without re-registering.
 */
export function useShortcut(options: UseShortcutOptions): void {
  const { store } = useApi();
  const runRef = useRef(options.run);
  useLayoutEffect(() => {
    runRef.current = options.run;
  });
  const { id, keys, description, group, scope, enabled, allowInInputs, system } = options;
  useEffect(() => {
    const def: RegisteredShortcut = {
      id,
      keys,
      description,
      group,
      scope,
      ...(enabled === undefined ? {} : { enabled }),
      ...(allowInInputs === undefined ? {} : { allowInInputs }),
      ...(system === undefined ? {} : { system }),
      run: (e) => {
        runRef.current(e);
      },
    };
    return store.register(def);
  }, [store, id, keys, description, group, scope, enabled, allowInInputs, system]);
}

export interface ShortcutsState {
  list: readonly RegisteredShortcut[];
  conflicts: ShortcutConflict[];
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
}

/** Everything registered right now, plus the on/off setting and the overlay state. */
export function useShortcuts(): ShortcutsState {
  const { store, enabled, setEnabled, overlayOpen, setOverlayOpen } = useApi();
  const list = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const conflicts = useMemo(() => findConflicts(list), [list]);
  return { list, conflicts, enabled, setEnabled, overlayOpen, setOverlayOpen };
}
