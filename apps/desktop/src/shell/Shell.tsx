// The app shell (S3.3): welcome screen when no plan is open; otherwise sidebar + the screen for the
// current route, showing the real plan through the approved S3.1 screens.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Month } from '@hafb/shared';
import { canRedo, canUndo, redoLabel, undoLabel } from '@hafb/store';
import type { Actions, Screen } from '../design/DesignApp.tsx';
import { PlanScreen } from '../design/PlanScreen.tsx';
import { ReflectScreen } from '../design/ReflectScreen.tsx';
import { RegisterScreen } from '../design/RegisterScreen.tsx';
import '../design/design.css';
import { cx } from '../ui/cx.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { useRouteFocus } from '../ui/focusRoute.ts';
import { useShortcut } from '../ui/shortcuts/ShortcutProvider.tsx';
import { SkipLink } from '../ui/SkipLink.tsx';
import type { MenuItem } from '../ui/Menu.tsx';
import { Splitter } from '../ui/Splitter.tsx';
import { useToast } from '../ui/Toast.tsx';
import { AddAccountDialog, BackupsDialog, ImportReportDialog, NewPlanDialog } from './dialogs.tsx';
import { appIpc, type TitlebarMode } from './ipc.ts';
import { INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN, prefs, usePrefs, type ThemePref } from './prefs.ts';
import { navigate, useRoute, type Route } from './router.ts';
import { session, todayLocal, type OpenPlan } from './session.ts';
import styles from './Shell.module.css';
import { Sidebar } from './Sidebar.tsx';
import { useAppliedTheme } from './theme.ts';
import { Welcome } from './Welcome.tsx';

const INSPECTOR_RANGE = { min: INSPECTOR_MIN, max: INSPECTOR_MAX, step: 16, initial: INSPECTOR_DEFAULT };

/** Show the plan's name in the custom title bar and as the window's title (taskbar, Alt+Tab). */
function useWindowTitle(planName: string | null): void {
  useEffect(() => {
    const title = planName === null ? 'HAFB' : `${planName} – HAFB`;
    const el = document.querySelector('.titlebar-title');
    if (el) el.textContent = title;
    document.title = title;
    if (isTauri()) void getCurrentWindow().setTitle(title).catch(() => undefined);
  }, [planName]);
}

/** Session notices become toasts; undo/redo notices carry the opposite action. */
function SessionToasts() {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { toast } = useToast();
  const note = state.toast;
  useEffect(() => {
    if (!note) return;
    const action =
      note.action === 'redo'
        ? { label: 'Redo', onAction: () => { session.redo(); } }
        : note.action === 'undo'
          ? { label: 'Undo', onAction: () => { session.undo(); } }
          : undefined;
    toast({ text: note.text, tone: note.tone, ...(action ? { action, replace: true } : {}) });
    session.dismissToast(note.id);
  }, [note, toast]);
  return null;
}

export function Shell() {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const p = usePrefs();
  const theme = useAppliedTheme(p.theme);
  const system = theme.system === true;
  useWindowTitle(state.open?.plan.settings.name ?? null);

  return (
    <div className={cx('hafb-root', styles.shell)} data-nocolor={String(p.noColor || system)} data-theme-system={String(system)}>
      <SessionToasts />
      {state.open ? <PlanFrame open={state.open} system={system} /> : <Welcome recent={state.recent} busy={state.busy} />}
    </div>
  );
}

function themeLabel(t: ThemePref): string {
  return t === 'system' ? 'Match Windows' : t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'High contrast';
}

function PlanFrame({ open, system }: { open: OpenPlan; /** A Windows-colour (contrast) theme is active. */ system: boolean }) {
  const route = useRoute();
  const p = usePrefs();
  const today = todayLocal();
  const [dialog, setDialog] = useState<null | 'new' | 'backups' | 'addAccount'>(null);
  const [showReport, setShowReport] = useState(open.importReport !== undefined);
  const [titlebarMode, setTitlebarMode] = useState<TitlebarMode>('custom');
  const content = useRef<HTMLDivElement>(null);
  const path = open.info.path;

  // Reopen where the user left off in this plan, then remember every move.
  useEffect(() => {
    const saved = prefs.get().lastRoute[path];
    if (saved !== undefined && saved !== window.location.hash) window.location.hash = saved;
    const remember = (): void => {
      prefs.update({ lastRoute: { ...prefs.get().lastRoute, [path]: window.location.hash } });
    };
    window.addEventListener('hashchange', remember);
    return () => {
      window.removeEventListener('hashchange', remember);
    };
  }, [path]);

  useEffect(() => {
    if (!isTauri()) return;
    appIpc.getTitlebarMode().then(setTitlebarMode, () => undefined);
  }, []);

  // The inspector width is a token the S3.1 screens read (--d-inspector-width).
  useEffect(() => {
    content.current?.style.setProperty('--d-inspector-width', `${String(p.inspectorWidth)}px`);
  }, [p.inspectorWidth]);

  // Shortcuts (S3.5 registry). Undo/redo are "system": they work even with shortcuts turned off.
  useShortcut({ id: 'general.undo', keys: 'Ctrl+Z', description: 'Undo', group: 'General', scope: 'global', system: true, run: () => { session.undo(); } });
  useShortcut({ id: 'general.redo', keys: 'Ctrl+Shift+Z', description: 'Redo', group: 'General', scope: 'global', system: true, run: () => { session.redo(); } });
  useShortcut({ id: 'general.redoAlt', keys: 'Ctrl+Y', description: 'Redo', group: 'General', scope: 'global', system: true, run: () => { session.redo(); } });
  useShortcut({ id: 'nav.plan', keys: 'G then P', description: 'Go to Plan', group: 'Navigation', scope: 'global', run: () => { navigate({ kind: 'plan' }); } });
  useShortcut({ id: 'nav.reflect', keys: 'G then R', description: 'Go to Reflect', group: 'Navigation', scope: 'global', run: () => { navigate({ kind: 'reflect' }); } });
  useShortcut({ id: 'nav.accounts', keys: 'G then A', description: 'Go to All Accounts', group: 'Navigation', scope: 'global', run: () => { navigate({ kind: 'accounts', accountId: null }); } });
  useShortcut({ id: 'nav.toggleSidebar', keys: 'Ctrl+B', description: 'Collapse or expand the sidebar', group: 'Navigation', scope: 'global', run: () => { prefs.update({ sidebarCollapsed: !prefs.get().sidebarCollapsed }); } });

  // Moving between screens puts keyboard focus at the start of the new screen.
  const routeKey = route.kind === 'accounts' ? `accounts:${route.accountId ?? 'all'}` : route.kind;
  useRouteFocus(routeKey, content);

  const actions: Actions = useMemo(
    () => ({
      run: (build) => {
        session.run(build);
      },
      undo: () => {
        session.undo();
      },
      redo: () => {
        session.redo();
      },
      navigate: (screen: Screen) => {
        const to: Route =
          screen.kind === 'plan' ? { kind: 'plan' } : screen.kind === 'reflect' ? { kind: 'reflect' } : { kind: 'accounts', accountId: screen.accountId };
        navigate(to);
      },
      notify: (text: string) => {
        session.notify(text);
      },
    }),
    [],
  );

  const planMenu: MenuItem[] = [
    { id: 'open', label: 'Open plan…' },
    { id: 'new', label: 'New plan…', icon: 'add' },
    { id: 'import', label: 'Import YNAB export…', icon: 'import' },
    { id: 'sep1', label: '', separator: true },
    { id: 'copy', label: 'Save a copy…', icon: 'export' },
    { id: 'backups', label: 'Backups…', icon: 'history', disabled: open.inMemory === true },
    { id: 'sep2', label: '', separator: true },
    { id: 'close', label: 'Close plan', icon: 'dismiss' },
  ];
  const onPlanMenu = (id: string): void => {
    if (id === 'open') void session.openDialog();
    else if (id === 'new') setDialog('new');
    else if (id === 'import') void session.importExport();
    else if (id === 'copy') void session.saveCopy();
    else if (id === 'backups') setDialog('backups');
    else if (id === 'close') void session.close();
  };

  const THEMES: ThemePref[] = ['system', 'light', 'dark', 'high-contrast'];
  const viewMenu: MenuItem[] = [
    ...THEMES.map((t) => ({ id: `theme:${t}`, label: themeLabel(t), checked: p.theme === t })),
    { id: 'sep1', label: '', separator: true },
    { id: 'nocolor', label: 'Differentiate without color', checked: p.noColor },
    { id: 'sep2', label: '', separator: true },
    { id: 'titlebar', label: 'Use Windows title bar (restarts)', checked: titlebarMode === 'native', disabled: !isTauri() },
  ];
  const onViewMenu = (id: string): void => {
    const t = THEMES.find((x) => id === `theme:${x}`);
    if (t) prefs.update({ theme: t });
    else if (id === 'nocolor') prefs.update({ noColor: !p.noColor });
    else if (id === 'titlebar') void appIpc.setTitlebarMode(titlebarMode === 'native' ? 'custom' : 'native');
  };

  const setMonth = useCallback((m: Month) => {
    navigate({ kind: 'plan', month: m });
  }, []);

  const history = {
    canUndo: canUndo(open.history),
    canRedo: canRedo(open.history),
    undoLabel: undoLabel(open.history),
    redoLabel: redoLabel(open.history),
  };
  const month = route.kind === 'plan' && route.month !== undefined ? route.month : open.month;

  return (
    <>
      <Sidebar
        plan={open.plan}
        subtitle={open.inMemory === true ? 'Sample data (browser preview)' : 'Local file'}
        today={today}
        route={route}
        planMenu={planMenu}
        onPlanMenu={onPlanMenu}
        viewMenu={viewMenu}
        onViewMenu={onViewMenu}
        onAddAccount={() => {
          setDialog('addAccount');
        }}
      />
      <SkipLink targetId="main" />
      <div
        ref={content}
        id="main"
        tabIndex={-1}
        role="main"
        aria-label={route.kind === 'reflect' ? 'Reflect' : route.kind === 'accounts' ? 'Accounts' : 'Plan'}
        className={cx('hd', 'hd-embedded', styles.content)}
        data-nocolor={String(p.noColor || system)}
        data-theme-system={String(system)}
        key={path}
      >
        <ErrorBoundary area={route.kind === 'reflect' ? 'Reflect' : route.kind === 'accounts' ? 'This account' : 'The plan'} resetKey={routeKey}>
        {route.kind === 'reflect' ? (
          <ReflectScreen plan={open.plan} today={today} sampleLabel={false} />
        ) : route.kind === 'accounts' ? (
          <RegisterScreen key={route.accountId ?? 'all'} plan={open.plan} today={today} accountId={route.accountId} actions={actions} />
        ) : (
          <PlanScreen
            plan={open.plan}
            today={today}
            month={month}
            setMonth={setMonth}
            actions={actions}
            history={history}
            inspectorEdge={
              <Splitter
                value={p.inspectorWidth}
                range={INSPECTOR_RANGE}
                side="end"
                label="Resize inspector"
                onChange={(w) => {
                  prefs.update({ inspectorWidth: w });
                }}
              />
            }
          />
        )}
        </ErrorBoundary>
      </div>
      <NewPlanDialog
        open={dialog === 'new'}
        onClose={() => {
          setDialog(null);
        }}
        onCreate={(name) => void session.createNew(name)}
      />
      <BackupsDialog
        open={dialog === 'backups'}
        onClose={() => {
          setDialog(null);
        }}
        load={loadBackups}
        onRestore={(b) => void session.restore(b)}
      />
      <AddAccountDialog
        open={dialog === 'addAccount'}
        onClose={() => {
          setDialog(null);
        }}
      />
      {showReport && (
        <ImportReportDialog
          report={open.importReport}
          onClose={() => {
            setShowReport(false);
          }}
        />
      )}
    </>
  );
}

const loadBackups = () => session.listBackups();
