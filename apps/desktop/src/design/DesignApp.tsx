// S3.1 clickable mockups (#/design): the real engine and commands on a sample household, in
// HAFB's chosen look. Plain React state; the production store arrives in S3.3.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Id } from '@hafb/engine';
import { formatMoney, uuidv7Generator, type Month } from '@hafb/shared';
import { canRedo, canUndo, emptyHistory, historyDo, historyRedo, historyUndo, redoLabel, undoLabel, type Command, type CommandContext, type History, type PlanData } from '@hafb/store';
import { BUILT_IN_THEMES, lightTheme } from '../theme/themes.ts';
import { applyTheme } from '../theme/tokens.ts';
import { Icon } from '../ui/Icon.tsx';
import { PlanScreen } from './PlanScreen.tsx';
import { ReflectScreen } from './ReflectScreen.tsx';
import { RegisterScreen } from './RegisterScreen.tsx';
import { buildSamplePlan } from './sample.ts';
import { Sidebar } from './Sidebar.tsx';
import { moneyFormat } from '../screens/plan/planModel.ts';
import './design.css';

export type Screen = { kind: 'plan' } | { kind: 'reflect' } | { kind: 'register'; accountId: Id | null };

export interface Actions {
  /** `announce`: toast text offering Undo (deletes, hides, moves). */
  run: (build: (plan: PlanData, ctx: CommandContext) => Command, options?: { announce?: string }) => void;
  undo: () => void;
  redo: () => void;
  navigate: (screen: Screen) => void;
  notify: (text: string) => void;
  /** Account menu actions (S4.4): the shell opens Edit Account, stars, closes and reopens. */
  accountAction?: (accountId: Id, action: 'edit' | 'star' | 'unstar' | 'up' | 'down' | 'close' | 'reopen') => void;
  /** Open Manage Payees (S5.5; the shell's dialog). */
  managePayees?: () => void;
  /** Open Add Account (S7.5: empty states and Get started). */
  addAccount?: () => void;
  /** Open Add categories from a template (S7.5). */
  openTemplates?: () => void;
}

const newId = uuidv7Generator(
  () => Date.now(),
  (n) => crypto.getRandomValues(new Uint8Array(n)),
);

/** `#/design/<plan|register|reflect>?theme=dark&nocolor=1`: deep links for review screenshots. */
function readHash(): { screen: Screen; theme: string | null; noColor: boolean; select: string | null; assign: string | null } {
  const [path = '', query = ''] = window.location.hash.replace(/^#\/design\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const screen: Screen = path === 'register' ? { kind: 'register', accountId: null } : path === 'reflect' ? { kind: 'reflect' } : { kind: 'plan' };
  return { screen, theme: params.get('theme'), noColor: params.get('nocolor') === '1', select: params.get('select'), assign: params.get('assign') };
}

/** Mockup-only display options: one line in the sidebar, the panel opens upward. */
function DisplayOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hd-display">
      {open && (
        <div className="hd-designbar" role="group" aria-label="Mockup display options">
          {children}
        </div>
      )}
      <button type="button" className="hd-navitem" aria-expanded={open} onClick={() => {
        setOpen(!open);
      }}>
        <Icon name="settings" size={20} /> Display options
        <Icon name={open ? 'chevronDown' : 'chevronUp'} style={{ marginLeft: 'auto' }} />
      </button>
    </div>
  );
}

export function DesignApp() {
  const initial = useMemo(() => readHash(), []);
  const sample = useMemo(() => buildSamplePlan(), []);
  const [plan, setPlan] = useState<PlanData>(sample.plan);
  const [history, setHistory] = useState<History>(emptyHistory());
  const [themeId, setThemeId] = useState(initial.theme ?? lightTheme.id);
  const [noColor, setNoColor] = useState(initial.noColor);
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [month, setMonth] = useState<Month>('2026-10');
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const theme = BUILT_IN_THEMES.find((t) => t.id === themeId) ?? lightTheme;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast((t) => (t?.id === toast.id ? null : t));
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const notify = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  const actions: Actions = useMemo(
    () => ({
      run: (build) => {
        try {
          const cmd = build(plan, { now: new Date().toISOString(), today: sample.today, newId });
          const step = historyDo(history, plan, cmd.changes, cmd.label);
          if (!step) return;
          setPlan(step.plan);
          setHistory(step.history);
        } catch (e) {
          notify(e instanceof Error ? e.message : String(e));
        }
      },
      undo: () => {
        const label = undoLabel(history);
        const step = historyUndo(history, plan);
        if (!step) return;
        setPlan(step.plan);
        setHistory(step.history);
        notify(`Undid: ${label ?? ''}`);
      },
      redo: () => {
        const label = redoLabel(history);
        const step = historyRedo(history, plan);
        if (!step) return;
        setPlan(step.plan);
        setHistory(step.history);
        notify(`Redid: ${label ?? ''}`);
      },
      navigate: setScreen,
      notify,
    }),
    [plan, history, sample.today, notify],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
      } else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        actions.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [actions]);

  const fmt = moneyFormat(plan);
  const system = theme.system === true;

  return (
    <div className="hd" data-nocolor={String(noColor || system)} data-theme-system={String(system)}>
      <Sidebar
        plan={plan}
        today={sample.today}
        screen={screen}
        navigate={setScreen}
        money={(m) => formatMoney(m, fmt)}
        footer={
        <DisplayOptions>
        <span className="muted">Theme</span>
        <div className="hd-seg">
          {BUILT_IN_THEMES.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === themeId} onClick={() => {
              setThemeId(t.id);
            }}>
              {t.name}
            </button>
          ))}
        </div>
        <label className="hd-toggle">
          <input type="checkbox" className="hd-checkbox" checked={noColor || system} disabled={system} onChange={(e) => {
            setNoColor(e.target.checked);
          }} />
          Differentiate without color
        </label>
        </DisplayOptions>
        }
      />
      {screen.kind === 'plan' && (
        <PlanScreen
          plan={plan}
          today={sample.today}
          month={month}
          setMonth={setMonth}
          initialSelect={initial.select}
          demoAssign={initial.assign}
          actions={actions}
          history={{ canUndo: canUndo(history), canRedo: canRedo(history), undoLabel: undoLabel(history), redoLabel: redoLabel(history) }}
        />
      )}
      {screen.kind === 'register' && <RegisterScreen plan={plan} today={sample.today} accountId={screen.accountId} actions={actions} />}
      {screen.kind === 'reflect' && <ReflectScreen plan={plan} today={sample.today} />}


      {toast && (
        <div className="hd-toast" role="status">
          <span>{toast.text}</span>
          {toast.text.startsWith('Undid') && canRedo(history) && (
            <button type="button" onClick={actions.redo}>
              Redo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
