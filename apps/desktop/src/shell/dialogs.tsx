// Dialogs the shell opens from its menus: new plan, backups, add account (Phase 4), import report.
import { useEffect, useState } from 'react';
import type { ImportReport } from '@hafb/store';
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { backupTime } from './format.ts';
import type { BackupInfo } from './ipc.ts';
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
  restore: 'Before a restore',
  beforeMigration: 'Before a file update',
};

export function BackupsDialog({
  open,
  onClose,
  load,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  load: () => Promise<BackupInfo[]>;
  onRestore: (backup: BackupInfo) => void;
}) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  useEffect(() => {
    if (!open) return;
    let live = true;
    load().then(
      (list) => {
        if (live) setBackups(list);
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
      setBackups(null);
      setError(null);
    };
  }, [open, load]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="wide"
      title="Backups"
      description="HAFB keeps a copy of this plan every time you open it (the newest 10), plus one before any file update."
      footer={<Button onClick={onClose}>Close</Button>}
    >
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

export function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an account"
      description="Adding accounts arrives in Phase 4, together with the register. Until then, accounts come from a YNAB import."
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    />
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
