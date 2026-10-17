import { useEffect, useId, useState } from 'react';
import { formatMoney, minor, type MoneyFormat } from '@hafb/shared';
import { Button, IconButton } from '../ui/Button.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { RtaBanner } from '../ui/Banner.tsx';
import { Pill, type MoneyState } from '../ui/Pill.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { NewPlanDialog } from '../screens/lifecycle/NewPlanDialog.tsx';
import { fileName } from './format.ts';
import type { RecentPlan } from './ipc.ts';
import { session, todayLocal } from './session.ts';
import { cx } from '../ui/cx.ts';
import styles from './Welcome.module.css';

/**
 * No plan open: start a plan, open one, import from YNAB, or pick a recent file. The right half is a
 * still picture of the Plan screen, so a newcomer sees what the colours mean before importing.
 */
export function Welcome({ recent, busy }: { recent: readonly RecentPlan[]; busy: string | null }) {
  const [creating, setCreating] = useState(false);
  const working = busy !== null;

  useEffect(() => {
    void session.refreshRecent();
  }, []);

  return (
    <main className={styles.welcome} aria-labelledby="welcome-title">
      <div className={styles.side}>
        <div className={styles.brand}>
          <span className={styles.bigMark} aria-hidden="true">
            HAFB
          </span>
          <div>
            <h1 id="welcome-title">Welcome to HAFB</h1>
            <p>Here’s A Free Budget. Every dollar gets a job, and your plan stays on your PC.</p>
          </div>
        </div>

        <section className={styles.group} aria-labelledby="start-title">
          <h2 id="start-title">Get started</h2>
          <ul className={styles.commands}>
            <Command lead icon="import" title="Import YNAB export (.zip)…" note="Coming from YNAB? Your plan comes across to the cent." disabled={working} onClick={() => void session.importExport()} />
            <Command
              icon="add"
              title="Start a new plan…"
              note="Start blank, or from a set of starter categories."
              disabled={working}
              onClick={() => {
                setCreating(true);
              }}
            />
            <Command icon="folderOpen" title="Open plan…" note="A .hafb file on this PC or in a synced folder." disabled={working} onClick={() => void session.openDialog()} />
          </ul>
          {working && (
            <p className={styles.lede} role="status">
              {busy}
            </p>
          )}
          {creating && (
            <NewPlanDialog
              year={Number(todayLocal().slice(0, 4))}
              onClose={() => {
                setCreating(false);
              }}
              onCreate={(settings, template) => {
                setCreating(false);
                void session.createNew(settings, template);
              }}
              onImportYnab={() => {
                setCreating(false);
                void session.importExport();
              }}
            />
          )}
        </section>

        <section className={styles.group} aria-labelledby="recent-title">
          <h2 id="recent-title">Recent plans</h2>
          {recent.length === 0 ? (
            <p className={styles.lede}>Plans you open show up here, so getting back to them is one click.</p>
          ) : (
            <ul className={styles.recent}>
              {recent.map((r) => (
                <li key={r.path} className={r.exists ? undefined : styles.missing}>
                  <button type="button" className={styles.recentOpen} disabled={working || !r.exists} onClick={() => void session.openPath(r.path)}>
                    <Icon name="document" size={20} className={styles.recentIcon} />
                    <strong>{fileName(r.path)}</strong>
                    <span className={styles.recentPath}>{r.exists ? r.path : `File not found · ${r.path}`}</span>
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

        <ul className={styles.facts}>
          <li>
            <Icon name="cleared" />
            Free, with no account
          </li>
          <li>
            <Icon name="document" />
            Your plan is one file you own
          </li>
          <li>
            <Icon name="lock" />
            No tracking, no ads
          </li>
        </ul>

        {import.meta.env.DEV && (
          <p className={styles.devLinks}>
            <span>For development:</span>
            <a href="#/design">Design mockups</a>
            <a href="#/gallery">Component gallery</a>
          </p>
        )}
      </div>

      <PlanGlimpse />
    </main>
  );
}

/** One of the ways in, as a Windows command link: a title, with a line under it saying what it does. */
function Command({ icon, title, note, lead = false, disabled, onClick }: { icon: IconName; title: string; note: string; lead?: boolean; disabled: boolean; onClick: () => void }) {
  const id = useId();
  return (
    <li>
      <button type="button" className={styles.command} data-lead={lead} disabled={disabled} aria-labelledby={`${id}-t`} aria-describedby={`${id}-n`} onClick={onClick}>
        <span className={styles.commandIcon}>
          <Icon name={icon} size={20} />
        </span>
        <strong id={`${id}-t`}>{title}</strong>
        <span id={`${id}-n`}>{note}</span>
      </button>
    </li>
  );
}

const USD: MoneyFormat = { decimals: 2, symbol: '$', placement: 'before', numberFormat: '123,456.78' };
const usd = (cents: number): string => formatMoney(minor(cents), USD);

interface GlimpseRow {
  name: string;
  message: string;
  tone?: 'warn' | 'bad';
  assigned: number;
  activity: number;
  available: number;
  pill: MoneyState;
  bar: MoneyState;
  fill: number;
  spent: number;
}

/** An example month (made-up categories and amounts) in the Plan screen's own components. */
const GLIMPSE: readonly { group: string; rows: readonly GlimpseRow[] }[] = [
  {
    group: 'Bills',
    rows: [
      { name: 'Rent', message: 'Fully spent', assigned: 140000, activity: -140000, available: 0, pill: 'zero', bar: 'funded', fill: 100, spent: 100 },
      { name: 'Electric', message: '$35.00 more needed by the 20th', tone: 'warn', assigned: 9000, activity: -6500, available: 2500, pill: 'underfunded', bar: 'underfunded', fill: 72, spent: 52 },
      { name: 'Internet', message: 'Funded', assigned: 22000, activity: 0, available: 22000, pill: 'funded', bar: 'funded', fill: 100, spent: 0 },
    ],
  },
  {
    group: 'Everyday',
    rows: [
      { name: 'Groceries', message: 'Overspent $36.40', tone: 'bad', assigned: 60000, activity: -63640, available: -3640, pill: 'overspent', bar: 'overspent', fill: 100, spent: 0 },
      { name: 'Dining out', message: 'Fully spent', assigned: 15000, activity: -15000, available: 0, pill: 'zero', bar: 'funded', fill: 100, spent: 100 },
    ],
  },
];

function PlanGlimpse() {
  return (
    // inert: a picture, not controls. Nothing in it can be focused, clicked or read out.
    <div className={styles.glimpse} inert aria-hidden="true">
      <div className={styles.glimpseInner}>
        <div className={styles.sheet}>
          <div className={styles.sheetHead}>
            <span className={styles.month}>Oct 2026</span>
            <RtaBanner
              state="positive"
              amount={usd(41250)}
              action={
                <Button variant="primary" iconEnd="chevronDown">
                  Assign
                </Button>
              }
            />
          </div>
          <div className={cx(styles.row, styles.header)}>
            <span>Category</span>
            <span>Assigned</span>
            <span>Activity</span>
            <span>Available</span>
          </div>
          {GLIMPSE.map((g) => {
            const total = (pick: (r: GlimpseRow) => number): number => g.rows.reduce((a, r) => a + pick(r), 0);
            const available = total((r) => r.available);
            return (
              <div key={g.group}>
                <div className={cx(styles.row, styles.groupRow)}>
                  <span>{g.group}</span>
                  <span>{usd(total((r) => r.assigned))}</span>
                  <span>{usd(total((r) => r.activity))}</span>
                  <span className={available < 0 ? styles.bad : undefined}>{usd(available)}</span>
                </div>
                {g.rows.map((r) => (
                  <div key={r.name} className={cx(styles.row, styles.catRow)}>
                    <div className={styles.cat}>
                      <span>{r.name}</span>
                      <span className={cx(styles.message, r.tone && styles[r.tone])}>{r.message}</span>
                      <div className={styles.catBar}>
                        <ProgressBar segments={1} fillPercent={r.fill} spentPercent={r.spent} state={r.bar} />
                      </div>
                    </div>
                    <span>{usd(r.assigned)}</span>
                    <span>{usd(r.activity)}</span>
                    <span>
                      <Pill state={r.pill}>{usd(r.available)}</Pill>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className={styles.caption}>
          <h2>Your plan at a glance</h2>
          <p>Give each dollar a category. Green means it’s covered, amber means a target needs more, and red means you spent more than you set aside.</p>
        </div>
      </div>
    </div>
  );
}
