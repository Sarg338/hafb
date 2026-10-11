// Plan passwords (S8.3b, ADR 0010): the Password section of Plan Settings, the dialog that sets,
// changes or removes the password, and the prompt for a locked plan or backup. Built from the
// component library; no new look.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import { backupTime } from '../../shell/format.ts';
import { errorKind, errorMessage, type BackupInfo, type PasswordStatus, type RelockReport } from '../../shell/ipc.ts';
import { backupsChoiceLabel, doneTitle, MAX_PASSWORD_CHARS, newPasswordProblem, relockSummary, type PasswordMode } from './passwordModel.ts';
import styles from './Settings.module.css';

/** Plan Settings' Password section: the state, and the buttons that open the password dialog. */
export function PasswordSection({ locked, onPick }: { locked: boolean; onPick: (mode: PasswordMode) => void }) {
  return (
    <section className={styles.section} aria-labelledby="plan-password">
      <h3 id="plan-password">Password</h3>
      <p className={styles.help}>
        {locked
          ? 'This plan is locked with a password. Other programs can’t read the file without it.'
          : 'Lock the plan file with a password so other programs can’t read it. It stays a standard file: DB Browser for SQLite (SQLCipher) opens it with the password.'}
      </p>
      <div className={styles.folderRow}>
        {locked ? (
          <>
            <Button
              size="small"
              onClick={() => {
                onPick('change');
              }}
            >
              Change password…
            </Button>
            <Button
              size="small"
              onClick={() => {
                onPick('remove');
              }}
            >
              Remove password…
            </Button>
          </>
        ) : (
          <Button
            size="small"
            onClick={() => {
              onPick('set');
            }}
          >
            Set a password…
          </Button>
        )}
      </div>
    </section>
  );
}

/** What the password dialog's controls call: the session, in the app. */
export interface PasswordControls {
  status: () => Promise<PasswordStatus>;
  setPassword: (current: string | null, next: string | null, remember: boolean, relock: boolean) => Promise<{ backups: RelockReport | null }>;
  relockBackups: (password: string) => Promise<RelockReport>;
}

const TITLES: Record<PasswordMode, string> = { set: 'Set a password', change: 'Change password', remove: 'Remove password' };
const ACTIONS: Record<PasswordMode, string> = { set: 'Lock Plan', change: 'Change Password', remove: 'Remove Password' };

/** Set, change or remove the plan's password; then say what happened to its backups. */
export function PlanPasswordDialog({ mode, controls, onClose }: { mode: PasswordMode; controls: PasswordControls; onClose: () => void }) {
  const [status, setStatus] = useState<PasswordStatus | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [remember, setRemember] = useState(false);
  const [relock, setRelock] = useState(true);
  const [tried, setTried] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<RelockReport | null | undefined>(undefined);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    controls.status().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        setRemember(s.remembered);
      },
      (e: unknown) => {
        if (live) setFailure(errorMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, [controls]);

  const needsCurrent = mode !== 'set';
  const needsNew = mode !== 'remove';
  const problem = needsNew ? newPasswordProblem(next, again) : null;
  const ready = status !== null && !working && (!needsCurrent || current !== '') && problem === null;

  const submit = (): void => {
    setTried(true);
    if (!ready) return;
    setWorking(true);
    setWrong(false);
    setFailure(null);
    controls.setPassword(needsCurrent ? current : null, needsNew ? next : null, needsNew && remember, relock && status.backups > 0).then(
      (r) => {
        setWorking(false);
        setResult(r.backups);
      },
      (e: unknown) => {
        setWorking(false);
        if (errorKind(e) === 'WrongPassword') {
          setWrong(true);
          first.current?.focus();
        } else setFailure(errorMessage(e));
      },
    );
  };

  if (result !== undefined) return <PasswordDone mode={mode} report={result} controls={controls} onClose={onClose} />;

  return (
    <Dialog
      open
      onClose={onClose}
      title={TITLES[mode]}
      description={
        mode === 'remove'
          ? 'Without a password, any program that opens SQLite files can read this plan.'
          : 'Write the password down somewhere safe. If it’s forgotten, the plan can’t be opened by HAFB or anyone else. There is no way to recover it.'
      }
      initialFocus={first}
      dismissible={!working}
      footer={
        <>
          <Button onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button variant={mode === 'remove' ? 'danger' : 'primary'} disabled={!ready} onClick={submit}>
            {working ? 'Working…' : ACTIONS[mode]}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {needsCurrent && (
          <TextInput
            ref={first}
            label="Current password"
            type="password"
            autoComplete="off"
            value={current}
            maxLength={MAX_PASSWORD_CHARS}
            onChange={(e) => {
              setCurrent(e.target.value);
              setWrong(false);
            }}
            {...(wrong ? { error: 'That password isn’t right.' } : {})}
          />
        )}
        {needsNew && (
          <>
            <TextInput
              {...(needsCurrent ? {} : { ref: first })}
              label={mode === 'set' ? 'Password' : 'New password'}
              type="password"
              autoComplete="off"
              value={next}
              maxLength={MAX_PASSWORD_CHARS}
              onChange={(e) => {
                setNext(e.target.value);
              }}
            />
            <TextInput
              label="Type it again"
              type="password"
              autoComplete="off"
              value={again}
              maxLength={MAX_PASSWORD_CHARS}
              onChange={(e) => {
                setAgain(e.target.value);
              }}
              {...((tried || again !== '') && problem !== null ? { error: problem } : {})}
            />
            <Checkbox label="Remember on this PC" checked={remember} onChange={setRemember} />
            <p className={styles.note}>Windows keeps it for your Windows account on this PC only. A copy of the plan anywhere else still asks for it.</p>
          </>
        )}
        {status !== null && status.backups > 0 && <Checkbox label={backupsChoiceLabel(mode, status.backups)} checked={relock} onChange={setRelock} />}
        {mode !== 'set' && <p className={styles.note}>Copies saved with “Save a copy…” keep the password they had.</p>}
        {failure !== null && (
          <p className={styles.note} role="alert">
            {failure}
          </p>
        )}
        {/* Enter submits from any field. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** After the change: what happened to the backups, and a way to bring along any under an earlier password. */
function PasswordDone({ mode, report, controls, onClose }: { mode: PasswordMode; report: RelockReport | null; controls: PasswordControls; onClose: () => void }) {
  const [r, setR] = useState(report);
  const [earlier, setEarlier] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const summary = r ? relockSummary(mode, r) : null;
  const left = r?.left ?? [];
  const retry = (): void => {
    if (earlier === '' || working) return;
    setWorking(true);
    setNote(null);
    controls.relockBackups(earlier).then(
      (more) => {
        setWorking(false);
        setEarlier('');
        const fixed = more.relocked;
        setR({ relocked: (r?.relocked ?? 0) + fixed, unchanged: r?.unchanged ?? 0, left: more.left });
        setNote(fixed === 0 ? 'That password didn’t open any of them.' : null);
      },
      (e: unknown) => {
        setWorking(false);
        setNote(errorMessage(e));
      },
    );
  };
  return (
    <Dialog open onClose={onClose} title={doneTitle(mode)} dismissible={!working} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className={styles.form}>
        {summary !== null && (
          <p className={styles.help} role="status">
            {summary}
          </p>
        )}
        {left.length > 0 && (
          <section className={styles.section} aria-labelledby="pw-left">
            <h3 id="pw-left">{left.length === 1 ? 'One backup was left as it was' : `${String(left.length)} backups were left as they were`}</h3>
            <p className={styles.help}>They didn’t open with the old password: they were probably made under an earlier one. Enter it to bring them along, or leave them.</p>
            <ul className={styles.note}>
              {left.map((b: BackupInfo) => (
                <li key={b.path}>{backupTime(b.stamp)}</li>
              ))}
            </ul>
            <form
              className={styles.folderRow}
              onSubmit={(e) => {
                e.preventDefault();
                retry();
              }}
            >
              <TextInput
                label="Earlier password"
                type="password"
                autoComplete="off"
                value={earlier}
                maxLength={MAX_PASSWORD_CHARS}
                onChange={(e) => {
                  setEarlier(e.target.value);
                }}
              />
              <Button type="submit" size="small" disabled={earlier === '' || working}>
                {working ? 'Working…' : 'Bring them along'}
              </Button>
            </form>
            {note !== null && (
              <p className={styles.note} role="alert">
                {note}
              </p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

/** The password for a locked plan being opened, or for a backup made under another password. */
export function PasswordPrompt({
  title,
  description,
  wrong,
  offerRemember,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  wrong: boolean;
  offerRemember: boolean;
  submitLabel: string;
  onSubmit: (password: string, remember: boolean) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const submit = (): void => {
    if (password !== '') onSubmit(password, remember);
  };
  return (
    <Dialog
      open
      onClose={onCancel}
      title={title}
      description={description}
      initialFocus={field}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={password === ''} onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextInput
          ref={field}
          label="Password"
          type="password"
          autoComplete="off"
          value={password}
          maxLength={MAX_PASSWORD_CHARS}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          {...(wrong ? { error: 'That password isn’t right.' } : {})}
        />
        {offerRemember && <Checkbox label="Remember on this PC" checked={remember} onChange={setRemember} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
