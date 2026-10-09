import { useEffect, useState } from 'react';
import { Button, IconButton } from '../ui/Button.tsx';
import { PlanSettingsDialog } from '../screens/settings/PlanSettingsDialog.tsx';
import { newPlanDraft, newPlanSettings } from '../screens/settings/settingsModel.ts';
import { fileName } from './format.ts';
import type { RecentPlan } from './ipc.ts';
import { session, todayLocal } from './session.ts';
import styles from './Shell.module.css';

/** No plan open: start a plan, open one, import from YNAB, or pick a recent file. */
export function Welcome({ recent, busy }: { recent: readonly RecentPlan[]; busy: string | null }) {
  const [creating, setCreating] = useState(false);
  const working = busy !== null;

  useEffect(() => {
    void session.refreshRecent();
  }, []);

  return (
    <main className={styles.welcome} aria-labelledby="welcome-title">
      <div className={styles.welcomeInner}>
        <div className={styles.brand}>
          <span className={styles.bigMark} aria-hidden="true">
            HAFB
          </span>
          <div>
            <h1 id="welcome-title">Welcome to HAFB</h1>
            <p>Here’s A Free Budget. Every dollar gets a job, and your plan stays on your PC.</p>
          </div>
        </div>

        <section className={styles.card} aria-labelledby="start-title">
          <h2 id="start-title">Bring your plan</h2>
          <p className={styles.lede}>Coming from YNAB? Import its export and your plan comes across to the cent.</p>
          <div className={styles.actions}>
            <Button variant="primary" icon="import" disabled={working} onClick={() => void session.importExport()}>
              Import YNAB export (.zip)…
            </Button>
            <Button disabled={working} onClick={() => void session.openDialog()}>
              Open plan…
            </Button>
          </div>
          <div className={styles.actions}>
            <Button
              icon="add"
              disabled={working}
              onClick={() => {
                setCreating(true);
              }}
            >
              Start a new plan…
            </Button>
          </div>
          {creating && (
            <PlanSettingsDialog
              mode="new"
              initial={newPlanDraft('My Plan')}
              year={Number(todayLocal().slice(0, 4))}
              onClose={() => {
                setCreating(false);
              }}
              onSubmit={(draft) => {
                setCreating(false);
                                void session.createNew(newPlanSettings(draft));
              }}
            />
          )}
          {working && (
            <p className={styles.lede} role="status">
              {busy}
            </p>
          )}
        </section>

        <section className={styles.card} aria-labelledby="recent-title">
          <h2 id="recent-title">Recent plans</h2>
          {recent.length === 0 ? (
            <p className={styles.lede}>Plans you open show up here, so getting back to them is one click.</p>
          ) : (
            <ul className={styles.recent}>
              {recent.map((r) => (
                <li key={r.path} className={r.exists ? undefined : styles.missing}>
                  <button type="button" className={styles.recentOpen} disabled={working || !r.exists} onClick={() => void session.openPath(r.path)}>
                    <strong>{fileName(r.path)}</strong>
                    <span>{r.exists ? r.path : `File not found · ${r.path}`}</span>
                  </button>
                  <IconButton
                    icon="dismiss"
                    label={`Remove ${fileName(r.path)} from recent plans`}
                    onClick={() => void session.removeRecent(r.path)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className={styles.devLinks}>
          <span>For development:</span>
          <a href="#/design">Design mockups</a>
          <a href="#/gallery">Component gallery</a>
        </p>
      </div>
    </main>
  );
}
