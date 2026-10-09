// The app shell (S3.3): welcome screen when no plan is open; otherwise sidebar + the screen for the
// current route, showing the real plan through the approved S3.1 screens.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Month } from '@hafb/shared';
import { minor } from '@hafb/shared';
import {
  adjustBalance,
  applyChanges,
  canRedo,
  canUndo,
  closeAccount,
  createAccount,
  editAccount,
  editPlanSettings,
  importTemplate,
  setTargets,
  TEMPLATES,
  mergeChangeSets,
  planBudget,
  redoLabel,
  reopenAccount,
  reorderAccounts,
  undoLabel,
  ynabExport,
} from '@hafb/store';
import type { Actions, Screen } from '../design/DesignApp.tsx';
import { ReflectScreen } from '../screens/reflect/ReflectScreen.tsx';
import { reportTab } from '../screens/reflect/reflectModel.ts';
import { AddAccountDialog, EditAccountDialog, type AccountEdits } from '../screens/accounts/AccountDialogs.tsx';
import { RegisterScreen } from '../screens/accounts/RegisterScreen.tsx';
import { ManagePayeesDialog } from '../screens/payees/ManagePayees.tsx';
import { stepAccount } from '../screens/accounts/accountsModel.ts';
import { moneyFormat } from '../screens/plan/planModel.ts';
import { shownMonth } from '../screens/plan/planMonths.ts';
import { moneyText } from '../screens/shared/money.ts';
import { PlanScreen } from '../screens/plan/PlanScreen.tsx';
import { FreshStartDialog } from '../screens/lifecycle/FreshStartDialog.tsx';
import { NewPlanDialog } from '../screens/lifecycle/NewPlanDialog.tsx';
import { TargetsEntryDialog } from '../screens/lifecycle/TargetsEntryDialog.tsx';
import { TemplateDialog } from '../screens/lifecycle/TemplateDialog.tsx';
import { DisplayOptionsDialog } from '../screens/settings/DisplayOptionsDialog.tsx';
import { PlanSettingsDialog } from '../screens/settings/PlanSettingsDialog.tsx';
import { PreferencesDialog, type PlanFolderControls } from '../screens/settings/PreferencesDialog.tsx';
import { draftFrom, settingsEdit } from '../screens/settings/settingsModel.ts';
import { cx } from '../ui/cx.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { useRouteFocus } from '../ui/focusRoute.ts';
import { useShortcut } from '../ui/shortcuts/ShortcutProvider.tsx';
import { SkipLink } from '../ui/SkipLink.tsx';
import type { MenuItem } from '../ui/Menu.tsx';
import { Splitter } from '../ui/Splitter.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { BackupsDialog, ImportReportDialog, type BackupControls } from './dialogs.tsx';
import { saveFile } from './files.ts';
import { fileName } from './format.ts';
import { appIpc, errorMessage, planIpc, type RecentPlan, type TitlebarMode } from './ipc.ts';
import { INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN, prefs, TEXT_SCALES, usePrefs, type ThemePref } from './prefs.ts';
import { navigate, useRoute, type Route } from './router.ts';
import { localStamp, session, todayLocal, type OpenPlan } from './session.ts';
import styles from './Shell.module.css';
import { Sidebar, type AccountAction } from './Sidebar.tsx';
import { useAppliedTheme } from './theme.ts';
import { Welcome } from './Welcome.tsx';

const INSPECTOR_RANGE = { min: INSPECTOR_MIN, max: INSPECTOR_MAX, step: 16, initial: INSPECTOR_DEFAULT };

const BACKUP_CONTROLS: BackupControls = {
  settings: planIpc.backupSettings,
  saveSettings: planIpc.setBackupSettings,
  pickFolder: planIpc.pickBackupFolder,
  backupNow: planIpc.backupNow,
};

/** The plans folder (S7.1) lives on the Rust side; the browser preview has none. */
const FOLDER_CONTROLS: PlanFolderControls | undefined = isTauri()
  ? {
      get: () => planIpc.appSettings().then((s) => s.planFolder),
      set: (folder) => planIpc.setAppSettings(folder).then((s) => s.planFolder),
      pick: planIpc.pickPlanFolder,
    }
  : undefined;

/** Text size (S7.1): the whole window zooms, as WebView2's own zoom does; the preview zooms the page. */
function useTextScale(scale: number): void {
  useEffect(() => {
    if (isTauri()) void getCurrentWebview().setZoom(scale).catch(() => undefined);
    else document.documentElement.style.setProperty('zoom', String(scale));
  }, [scale]);
}

/** One step bigger or smaller (Ctrl+= / Ctrl+-), or back to 100% (Ctrl+0). */
function stepTextScale(step: 1 | -1 | 0): void {
  const sizes = [...TEXT_SCALES];
  const at = sizes.indexOf(prefs.get().textScale);
  const next = step === 0 ? 1 : sizes[Math.min(sizes.length - 1, Math.max(0, at + step))];
  if (next !== undefined) prefs.update({ textScale: next });
}

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
  useTextScale(p.textScale);

  return (
    <div className={cx('hafb-root', styles.shell)} data-nocolor={String(p.noColor || system)} data-theme-system={String(system)}>
      <SessionToasts />
      {state.open ? <PlanFrame open={state.open} system={system} recent={state.recent} /> : <Welcome recent={state.recent} busy={state.busy} />}
    </div>
  );
}

function themeLabel(t: ThemePref): string {
  return t === 'system' ? 'Match Windows' : t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'High contrast';
}

function PlanFrame({ open, system, recent }: { open: OpenPlan; /** A Windows-colour (contrast) theme is active. */ system: boolean; recent: readonly RecentPlan[] }) {
  const route = useRoute();
  const p = usePrefs();
  const today = todayLocal();
  const [dialog, setDialog] = useState<null | 'new' | 'backups' | 'addAccount' | 'payees' | 'planSettings' | 'display' | 'prefs' | 'template' | 'freshStart' | 'targets'>(null);
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const confirm = useConfirm();
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

  // A plan left open past midnight enters the new day's scheduled transactions (§5.11).
  useEffect(() => {
    const check = (): void => {
      session.checkDay();
    };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
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
  useShortcut({ id: 'nav.toggleSidebarYnab', keys: '>', description: 'Expand or collapse the sidebar (Shift+.)', group: 'Navigation', scope: 'global', run: () => { prefs.update({ sidebarCollapsed: !prefs.get().sidebarCollapsed }); } });
  useShortcut({ id: 'view.textLarger', keys: 'Ctrl+=', description: 'Larger text', group: 'General', scope: 'global', system: true, run: () => { stepTextScale(1); } });
  useShortcut({ id: 'view.textLargerPad', keys: 'Ctrl++', description: 'Larger text (numeric keypad)', group: 'General', scope: 'global', system: true, run: () => { stepTextScale(1); } });
  useShortcut({ id: 'view.textSmaller', keys: 'Ctrl+-', description: 'Smaller text', group: 'General', scope: 'global', system: true, run: () => { stepTextScale(-1); } });
  useShortcut({ id: 'view.textReset', keys: 'Ctrl+0', description: 'Text at 100%', group: 'General', scope: 'global', system: true, run: () => { stepTextScale(0); } });
  useShortcut({ id: 'file.new', keys: 'Ctrl+N', description: 'New plan', group: 'General', scope: 'global', run: () => { setDialog('new'); } });
  useShortcut({ id: 'file.open', keys: 'Ctrl+O', description: 'Open plan', group: 'General', scope: 'global', run: () => { void session.openDialog(); } });
  useShortcut({ id: 'app.preferences', keys: 'Ctrl+,', description: 'Preferences', group: 'General', scope: 'global', run: () => { setDialog('prefs'); } });
  useShortcut({ id: 'nav.toggleSidebar', keys: 'Ctrl+B', description: 'Collapse or expand the sidebar', group: 'Navigation', scope: 'global', run: () => { prefs.update({ sidebarCollapsed: !prefs.get().sidebarCollapsed }); } });

  // Moving between screens puts keyboard focus at the start of the new screen.
  const routeKey = route.kind === 'accounts' ? `accounts:${route.accountId ?? 'all'}` : route.kind;
  useRouteFocus(routeKey, content);

  // ---- accounts (S4.4) ----------------------------------------------------------------------------
  const fmt = moneyFormat(open.plan);
  const money = moneyText(fmt, p.hideAmounts);
  const workingBalance = (id: string) => planBudget(open.plan, { today }).accountBalances[id]?.working ?? minor(0);
  const accountName = (id: string): string => open.plan.accounts.find((a) => a.id === id)?.name ?? 'account';
  const closeWithCare = async (id: string): Promise<void> => {
    const balance = workingBalance(id);
    const name = accountName(id);
    if (balance !== 0) {
      const ok = await confirm({
        title: `Close ${name}?`,
        body: `Its balance of ${money(balance)} will be set to ${money(minor(0))} with an adjustment transaction. To move the money somewhere instead, cancel and record a transfer first.`,
        confirmLabel: 'Zero it and close',
        danger: true,
      });
      if (!ok) return;
    }
    session.run((pl, ctx) => closeAccount(pl, ctx, { accountId: id, zeroOut: balance !== 0 }), { announce: `Closed “${name}”. It's under Closed in the sidebar.` });
  };
  const onAccountAction = (id: string, action: AccountAction): void => {
    switch (action) {
      case 'edit':
        setEditingAccount(id);
        break;
      case 'star':
      case 'unstar':
        session.run((pl, ctx) => editAccount(pl, ctx, { accountId: id, starred: action === 'star' }));
        break;
      case 'up':
      case 'down': {
        const ids = stepAccount(open.plan, id, action === 'up' ? -1 : 1);
        if (ids) session.run((pl, ctx) => reorderAccounts(pl, ctx, { accountIds: ids }));
        break;
      }
      case 'close':
        void closeWithCare(id);
        break;
      case 'reopen':
        session.run((pl, ctx) => reopenAccount(pl, ctx, { accountId: id }), { announce: `Reopened “${accountName(id)}”.` });
        break;
    }
  };
  const saveAccount = (id: string, edits: AccountEdits): void => {
    session.run((pl, ctx) => {
      const e = editAccount(pl, ctx, { accountId: id, name: edits.name, note: edits.note.trim() === '' ? null : edits.note, ...(edits.loan === undefined ? {} : { loan: edits.loan }) });
      const next = applyChanges(pl, e.changes).plan;
      const b = adjustBalance(next, ctx, { accountId: id, workingBalance: edits.workingBalance });
      return { label: `Edit account: ${accountName(id)}`, changes: mergeChangeSets(e.changes, b.changes) };
    });
  };
  const accountActionRef = useRef(onAccountAction);
  useEffect(() => {
    accountActionRef.current = onAccountAction;
  });

  const actions: Actions = useMemo(
    () => ({
      run: (build, options) => {
        session.run(build, options);
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
      accountAction: (id: string, action: AccountAction) => {
        accountActionRef.current(id, action);
      },
      managePayees: () => {
        setDialog('payees');
      },
    }),
    [],
  );

  // YNAB's plan menu order (2026-10-09): New Plan, Open Plan, then the current plan's settings,
  // payees, display options, export and Fresh Start; HAFB adds its file actions and Preferences.
  const recentItems: MenuItem[] = recent
    .filter((r) => r.path !== path)
    .slice(0, 5)
    .map((r) => ({ id: `recent:${r.path}`, label: fileName(r.path), icon: 'history' as const, disabled: !r.exists }));
  const planMenu: MenuItem[] = [
    { id: 'new', label: 'New plan…', icon: 'add', shortcut: 'Ctrl+N' },
    { id: 'open', label: 'Open plan…', shortcut: 'Ctrl+O' },
    ...recentItems,
    { id: 'import', label: 'Import YNAB export…', icon: 'import' },
    { id: 'sep1', label: '', separator: true },
    { id: 'planSettings', label: 'Plan Settings…', icon: 'settings' },
    { id: 'payees', label: 'Manage Payees…', icon: 'settings' },
    { id: 'template', label: 'Add categories from a template…', icon: 'add' },
    { id: 'display', label: 'Display Options…', icon: 'eye' },
    { id: 'exportYnab', label: 'Export for YNAB (CSV)…', icon: 'export' },
    { id: 'copy', label: 'Save a copy…', icon: 'export' },
    { id: 'backups', label: 'Backups…', icon: 'history', disabled: open.inMemory === true },
    { id: 'freshStart', label: 'Make a Fresh Start…', icon: 'history', disabled: open.inMemory === true },
    { id: 'sep2', label: '', separator: true },
    { id: 'prefs', label: 'Preferences…', icon: 'settings', shortcut: 'Ctrl+,' },
    { id: 'sep3', label: '', separator: true },
    { id: 'close', label: 'Close plan', icon: 'dismiss' },
  ];
  const onPlanMenu = (id: string): void => {
    if (id === 'open') void session.openDialog();
    else if (id.startsWith('recent:')) void session.openPath(id.slice('recent:'.length));
    else if (id === 'new') setDialog('new');
    else if (id === 'planSettings' || id === 'display' || id === 'prefs' || id === 'template' || id === 'freshStart') setDialog(id);
    else if (id === 'import') void session.importExport();
    else if (id === 'copy') void session.saveCopy();
    else if (id === 'exportYnab') {
      // YNAB's own export layout (S6.6): Plan.csv and Register.csv in a zip.
      const file = ynabExport(open.plan, today, localStamp());
      saveFile(file.name, file.bytes).then(
        (saved) => {
          if (saved !== null) session.notify(`Exported for YNAB to ${saved}.`);
        },
        (e: unknown) => {
          session.notify(`Couldn’t export: ${errorMessage(e)}`, 'error');
        },
      );
    }
    else if (id === 'backups') setDialog('backups');
    else if (id === 'payees') setDialog('payees');
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
  const month = shownMonth(open.plan, today, route.kind === 'plan' && route.month !== undefined ? route.month : open.month);

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
        onAccountAction={onAccountAction}
        onReorder={(ids) => {
          session.run((pl, ctx) => reorderAccounts(pl, ctx, { accountIds: ids }), { announce: 'Moved the account.' });
        }}
      />
      <SkipLink targetId="main" />
      <div
        ref={content}
        id="main"
        tabIndex={-1}
        role="main"
        aria-label={route.kind === 'reflect' ? 'Reflect' : route.kind === 'accounts' ? 'Accounts' : 'Plan'}
        className={styles.content}
        data-nocolor={String(p.noColor || system)}
        data-theme-system={String(system)}
        key={path}
      >
        <ErrorBoundary area={route.kind === 'reflect' ? 'Reflect' : route.kind === 'accounts' ? 'This account' : 'The plan'} resetKey={routeKey}>
        {route.kind === 'reflect' ? (
          <ReflectScreen
            plan={open.plan}
            planPath={path}
            today={today}
            tab={reportTab(route.tab)}
            onTab={(tab) => {
              navigate({ kind: 'reflect', tab });
            }}
            onOpenTransaction={(accountId, tx) => {
              navigate({ kind: 'accounts', accountId, tx });
            }}
            notify={(text) => {
              session.notify(text);
            }}
          />
        ) : route.kind === 'accounts' ? (
          <RegisterScreen
            key={route.accountId ?? 'all'}
            plan={open.plan}
            today={today}
            accountId={route.accountId}
            {...(p.defaultAccounts[path] === undefined ? {} : { defaultAccountId: p.defaultAccounts[path] })}
            actions={actions}
            history={history}
            {...(route.tx === undefined ? {} : { focusTransactionId: route.tx })}
          />
        ) : (
          <PlanScreen
            plan={open.plan}
            planPath={path}
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
      {dialog === 'new' && (
        <NewPlanDialog
          year={Number(today.slice(0, 4))}
          onClose={() => {
            setDialog(null);
          }}
          onCreate={(settings, template) => {
            setDialog(null);
            void session.createNew(settings, template);
          }}
          onImportYnab={() => {
            setDialog(null);
            void session.importExport();
          }}
        />
      )}
      {dialog === 'planSettings' && (
        <PlanSettingsDialog
          mode="edit"
          initial={draftFrom(open.plan.settings)}
          year={Number(today.slice(0, 4))}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(draft) => {
            setDialog(null);
            session.run((pl, ctx) => editPlanSettings(pl, ctx, settingsEdit(draft)), { announce: 'Plan settings applied.' });
          }}
        />
      )}
      {dialog === 'template' && (
        <TemplateDialog
          templates={TEMPLATES}
          planName={open.plan.settings.name}
          onClose={() => {
            setDialog(null);
          }}
          onImport={(template, exclude) => {
            setDialog(null);
            session.run((pl, ctx) => importTemplate(pl, ctx, { template, exclude }), { announce: `Added the ${template.name} categories at the bottom of your plan.` });
            navigate({ kind: 'plan' });
          }}
        />
      )}
      {dialog === 'freshStart' && (
        <FreshStartDialog
          onClose={() => {
            setDialog(null);
          }}
          onContinue={(name) => {
            setDialog(null);
            void session.freshStart(name);
          }}
        />
      )}
      {dialog === 'targets' && open.importReport && (
        <TargetsEntryDialog
          plan={open.plan}
          rows={open.importReport.targetsToReenter.filter((r) => open.plan.categories.some((c) => c.id === r.categoryId && c.deletedAt === undefined))}
          today={today}
          format={fmt}
          onClose={() => {
            setDialog(null);
          }}
          onSave={(targets) => {
            setDialog(null);
            session.run((pl, ctx) => setTargets(pl, ctx, { targets }), { announce: targets.length === 1 ? 'Added 1 target.' : `Added ${String(targets.length)} targets.` });
          }}
        />
      )}
      {dialog === 'display' && (
        <DisplayOptionsDialog
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog === 'prefs' && (
        <PreferencesDialog
          planPath={path}
          accounts={open.plan.accounts}
          {...(FOLDER_CONTROLS ? { folders: FOLDER_CONTROLS } : {})}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog === 'payees' && (
        <ManagePayeesDialog
          plan={open.plan}
          today={today}
          actions={actions}
          history={history}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      <BackupsDialog
        open={dialog === 'backups'}
        onClose={() => {
          setDialog(null);
        }}
        load={loadBackups}
        onRestore={(b) => void session.restore(b)}
        controls={BACKUP_CONTROLS}
      />
      {dialog === 'addAccount' && (
        <AddAccountDialog
          format={fmt}
          onClose={() => {
            setDialog(null);
          }}
          onCreate={(args) => {
            const made: { id: string | null } = { id: null };
            session.run((pl, ctx) => {
              const cmd = createAccount(pl, ctx, args);
              made.id = cmd.accountId;
              return cmd;
            });
            if (made.id !== null) navigate({ kind: 'accounts', accountId: made.id });
          }}
        />
      )}
      {editingAccount !== null &&
        (() => {
          const account = open.plan.accounts.find((a) => a.id === editingAccount && a.deletedAt === undefined);
          if (!account) return null;
          const close = (): void => {
            setEditingAccount(null);
          };
          return (
            <EditAccountDialog
              account={account}
              workingBalance={workingBalance(account.id)}
              format={fmt}
              money={money}
              onClose={close}
              onSave={(edits) => {
                saveAccount(account.id, edits);
              }}
              onCloseAccount={(zeroOut) => {
                session.run((pl, ctx) => closeAccount(pl, ctx, { accountId: account.id, zeroOut }), { announce: `Closed “${account.name}”. It's under Closed in the sidebar.` });
              }}
              onReopen={() => {
                session.run((pl, ctx) => reopenAccount(pl, ctx, { accountId: account.id }), { announce: `Reopened “${account.name}”.` });
              }}
            />
          );
        })()}
      {showReport && (
        <ImportReportDialog
          report={open.importReport}
          onClose={() => {
            setShowReport(false);
          }}
          onAddTargets={() => {
            setShowReport(false);
            setDialog('targets');
          }}
        />
      )}
    </>
  );
}

const loadBackups = () => session.listBackups();
