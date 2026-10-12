// Dialogs the shell opens from its menus: backups and the import report.
import { useCallback, useEffect, useState } from 'react';
import type { AccountType, InferredAccount } from '@hafb/engine';
import type { ImportReport } from '@hafb/store';
import { typeInfo } from '../screens/accounts/accountsModel.ts';
import { Button } from '../ui/Button.tsx';
import { Combobox } from '../ui/Combobox.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { backupTime } from './format.ts';
import { errorMessage, type BackupInfo, type BackupSettingsInfo } from './ipc.ts';
import { changedTypes, typeChoices } from './importTypes.ts';
import styles from './Shell.module.css';

const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  open: 'When opened',
  manual: 'Backed up by you',
  restore: 'Before a restore',
  beforeMigration: 'Before a file update',
};

const KEEP_CHOICES = [3, 5, 10, 20, 30, 50, 100];

/** Backup settings and actions (S6.6), from the Rust side. */
export interface BackupControls {
  settings: () => Promise<BackupSettingsInfo>;
  saveSettings: (keep: number, folder: string | null) => Promise<BackupSettingsInfo>;
  pickFolder: () => Promise<string | null>;
  backupNow: () => Promise<string>;
}

export function BackupsDialog({
  open,
  onClose,
  load,
  onRestore,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  load: () => Promise<BackupInfo[]>;
  onRestore: (backup: BackupInfo) => void;
  controls: BackupControls;
}) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<BackupSettingsInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const confirm = useConfirm();
  const refresh = useCallback((live: () => boolean) => {
    load().then(
      (list) => {
        if (live()) setBackups(list);
      },
      (e: unknown) => {
        if (live()) setError(errorMessage(e));
      },
    );
  }, [load]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    refresh(() => live);
    controls.settings().then(
      (s) => {
        if (live) setSettings(s);
      },
      () => undefined,
    );
    return () => {
      live = false;
      setBackups(null);
      setError(null);
      setSettings(null);
      setNote(null);
    };
  }, [open, refresh, controls]);
  const save = (keep: number, folder: string | null): void => {
    controls.saveSettings(keep, folder).then(
      (s) => {
        setSettings(s);
        refresh(() => true);
      },
      (e: unknown) => {
        setNote(`Couldn’t save that: ${errorMessage(e)}`);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="wide"
      title="Backups"
      description="A copy of this plan is made every time you open it, plus one before any file update. Restore puts the plan back as it was; the plan as it is now is backed up first."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {settings && (
        <div className={styles.backupSettings}>
          <div className={styles.backupKeep}>
            <span>Keep the newest</span>
            <Combobox
              label="Backups to keep"
              groups={[{ id: 'keep', label: 'Backups to keep', options: KEEP_CHOICES.map((n) => ({ id: String(n), label: String(n) })) }]}
              value={String(settings.keep)}
              onChange={(id) => {
                save(Number(id), settings.folder);
              }}
            />
            <span>backups made when you open it</span>
          </div>
          <div className={styles.backupFolder}>
            <span className={styles.muted}>Saved in</span>
            <code title={settings.planFolder ?? settings.defaultFolder}>{settings.folder ?? settings.defaultFolder}</code>
            <Button
              size="small"
              onClick={() => {
                controls.pickFolder().then(
                  (f) => {
                    if (f !== null) save(settings.keep, f);
                  },
                  () => undefined,
                );
              }}
            >
              Change folder…
            </Button>
            {settings.folder !== null && (
              <Button
                size="small"
                onClick={() => {
                  save(settings.keep, null);
                }}
              >
                Use the default
              </Button>
            )}
            <span className={styles.spacer} />
            <Button
              size="small"
              variant="primary"
              icon="history"
              onClick={() => {
                controls.backupNow().then(
                  () => {
                    setNote('Backed up just now.');
                    refresh(() => true);
                  },
                  (e: unknown) => {
                    setNote(`Couldn’t back up: ${errorMessage(e)}`);
                  },
                );
              }}
            >
              Back up now
            </Button>
          </div>
          {settings.folder !== null && <p className={styles.muted}>Backups made before a folder change stay where they were.</p>}
          {note !== null && (
            <p className={styles.muted} role="status">
              {note}
            </p>
          )}
        </div>
      )}
      {error !== null && <p className={styles.error}>Couldn’t list backups: {error}</p>}
      {backups === null && error === null && <p className={styles.muted}>Looking for backups…</p>}
      {backups?.length === 0 && <p className={styles.muted}>No backups yet. One is made the next time you open this plan.</p>}
      {backups !== null && backups.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Saved</th>
              <th>Why</th>
              <th className={styles.num}>Size</th>
              <th>
                <span className="visually-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.path}>
                <td>{backupTime(b.stamp)}</td>
                <td>{KIND_LABEL[b.kind]}</td>
                <td className={styles.num}>{Math.max(1, Math.round(b.sizeBytes / 1024))} KB</td>
                <td className={styles.num}>
                  <Button
                    size="small"
                    onClick={() => {
                      void confirm({
                        title: 'Restore this backup?',
                        body: `Your plan goes back to how it was on ${backupTime(b.stamp)}. The plan as it is now is backed up first, so you can come back to it.`,
                        confirmLabel: 'Restore',
                        danger: true,
                      }).then((ok) => {
                        if (!ok) return;
                        onClose();
                        onRestore(b);
                      });
                    }}
                  >
                    Restore
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

/**
 * The YNAB import's account-type step (S8.5): the export has no types, so HAFB's guesses are
 * shown for checking. Only types of the same kind are offered (importTypes.ts), so nothing the
 * user picks changes a number; a loan picked here gets HAFB's loan tools.
 */
export function ImportTypesDialog({ planName, accounts, onContinue, onCancel }: { planName: string; accounts: readonly InferredAccount[]; onContinue: (types: Record<string, AccountType>) => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState<Record<string, AccountType>>(() => Object.fromEntries(accounts.map((a) => [a.name, a.type])));
  return (
    <Dialog
      open
      onClose={onCancel}
      size="wide"
      title="Check your account types"
      description={`YNAB’s export of “${planName}” doesn’t say what type each account is, so HAFB worked them out. Change any that are wrong; you can’t change a type later.`}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => { onContinue(changedTypes(accounts, chosen)); }}>
            Continue
          </Button>
        </>
      }
    >
      <div className={styles.importTypes}>
        {accounts.map((a) => {
          const choices = typeChoices(a);
          return (
            <div key={a.name} className={styles.importType}>
              <span className={styles.importTypeName}>{a.name}</span>
              <Combobox
                label={`${a.name} account type`}
                size="medium"
                groups={[{ id: 'types', label: a.onBudget ? 'On your plan' : 'Loans and tracking', options: choices.map((t) => ({ id: t, label: typeInfo(t).label })) }]}
                value={chosen[a.name] ?? a.type}
                onChange={(id) => {
                  const t = choices.find((c) => c === id);
                  if (t !== undefined) setChosen({ ...chosen, [a.name]: t });
                }}
              />
            </div>
          );
        })}
        <p className={styles.muted}>Cash and credit accounts keep their kind, and so do loans and tracking accounts, so every number stays exactly as it was in YNAB. A loan’s interest rate and payment can be added afterwards in the account.</p>
      </div>
    </Dialog>
  );
}

export function ImportReportDialog({ report, onClose, onAddTargets }: { report: ImportReport | undefined; onClose: () => void; onAddTargets?: () => void }) {
  if (!report) return null;
  const c = report.counts;
  return (
    <Dialog
      open
      onClose={onClose}
      size="wide"
      title="Your YNAB plan is in"
      description={`${String(c.accounts)} accounts, ${String(c.categories)} categories and ${c.transactions.toLocaleString()} transactions came across, with ${String(c.months)} months of assigned money.`}
      footer={
        <>
          {onAddTargets && report.targetsToReenter.length > 0 && <Button onClick={onAddTargets}>Add targets…</Button>}
          <Button variant="primary" onClick={onClose}>
            Start planning
          </Button>
        </>
      }
    >
      <div className={styles.report}>
        <p>Your accounts came in as:</p>
        <ul>
          {report.accounts.map((a) => (
            <li key={a.name}>
              <strong>{a.name}</strong>: {typeInfo(a.type).label} <span className={styles.muted}>({a.reason})</span>
            </li>
          ))}
        </ul>
        {report.targetsToReenter.length > 0 && (
          <p>Targets aren’t in the export. Add them again for any of your {report.targetsToReenter.length} categories with Add targets, or later from each category.</p>
        )}
        {report.scheduledWithoutRepeat > 0 && <p>{report.scheduledWithoutRepeat} upcoming transactions came across as one-offs; set their repeat when you see them.</p>}
        {report.warnings.length > 0 && (
          <ul className={styles.warnings}>
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
