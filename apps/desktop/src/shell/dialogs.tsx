// Dialogs the shell opens from its menus: new plan, backups, import report.
import { useCallback, useEffect, useState } from 'react';
import type { ImportReport } from '@hafb/store';
import { Button } from '../ui/Button.tsx';
import { Combobox } from '../ui/Combobox.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { backupTime } from './format.ts';
import { errorMessage, type BackupInfo, type BackupSettingsInfo } from './ipc.ts';
import styles from './Shell.module.css';

export function NewPlanDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('My Plan');
  const valid = name.trim() !== '';
  const submit = (): void => {
    if (!valid) return;
    onClose();
    onCreate(name.trim());
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New plan"
      description="A plan is one file on your PC. Next you'll choose where to save it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Choose where to save…
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextInput
          label="Plan name"
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
          }}
          {...(valid ? {} : { error: 'Give your plan a name.' })}
        />
      </form>
    </Dialog>
  );
}

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

export function ImportReportDialog({ report, onClose }: { report: ImportReport | undefined; onClose: () => void }) {
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
        <Button variant="primary" onClick={onClose}>
          Start planning
        </Button>
      }
    >
      <div className={styles.report}>
        <p>YNAB’s export doesn’t say what type each account is, so HAFB worked it out:</p>
        <ul>
          {report.accounts.map((a) => (
            <li key={a.name}>
              <strong>{a.name}</strong>: {a.type} <span className={styles.muted}>({a.reason})</span>
            </li>
          ))}
        </ul>
        {report.targetsToReenter.length > 0 && (
          <p>Targets aren’t in the export. {report.targetsToReenter.length} categories need their targets added again.</p>
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
