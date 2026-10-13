// Preferences → Bank sync (S8.6, ADR 0006): link SimpleFIN Bridge on this PC with a setup token, or
// unlink. Which account syncs from which bank account is chosen in Edit Account. The access link
// SimpleFIN returns stays in Rust (Credential Manager or memory); this only sees whether it exists.
import { useState } from 'react';
import type { BankStatus } from '../../shell/ipc.ts';
import { Button } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import styles from './Settings.module.css';

export interface BankSyncControls {
  /** Null until asked (and in the browser preview). */
  status: BankStatus | null;
  link: (token: string, remember: boolean) => Promise<void>;
  unlink: () => Promise<void>;
}

const message = (e: unknown): string => (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : String(e));

export function BankSyncSection({ bank }: { bank?: BankSyncControls | undefined }) {
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const status = bank?.status ?? null;

  const act = (work: () => Promise<void>, done: string): void => {
    setWorking(true);
    setNote(null);
    work().then(
      () => {
        setToken('');
        setNote(done);
      },
      (e: unknown) => {
        setNote(message(e));
      },
    ).finally(() => {
      setWorking(false);
    });
  };

  return (
    <section className={styles.section} aria-labelledby="pref-bank">
      <h3 id="pref-bank">Bank sync</h3>
      {!bank || status === null ? (
        <p className={styles.help}>Available in the installed app.</p>
      ) : status.linked ? (
        <>
          <div className={styles.folderRow}>
            <code>{status.host ?? 'SimpleFIN'}</code>
            <Button
              size="small"
              disabled={working}
              onClick={() => {
                act(bank.unlink,'Unlinked. Linked accounts keep their transactions and stop syncing on this PC.');
              }}
            >
              Unlink
            </Button>
          </div>
          <p className={styles.help}>{status.remembered ? 'Linked to SimpleFIN and remembered on this PC.' : 'Linked to SimpleFIN until HAFB closes.'}</p>
          <p className={styles.help}>Choose the bank account each account syncs from in Edit Account. New transactions come in when a plan opens, about every 6 hours while it’s open, and on Sync Now. You can also turn this link off on SimpleFIN’s site.</p>
        </>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim() !== '' && !working) act(() => bank.link(token.trim(), remember), 'Linked. Now open Edit Account on each account to choose its bank account.');
          }}
        >
          <p className={styles.help}>
            Optional. HAFB can bring in your bank’s transactions through SimpleFIN Bridge, a service you sign up for at bridge.simplefin.org (about $15 a year, paid to SimpleFIN). You log in to your bank on SimpleFIN’s site, so HAFB never sees your bank password.
          </p>
          <TextInput
            label="SimpleFIN setup token"
            value={token}
            autoComplete="off"
            spellCheck={false}
            help="On SimpleFIN’s site, create a setup token for a new app, then paste it here. A token works once."
            onChange={(e) => {
              setToken(e.target.value);
            }}
          />
          <Checkbox label="Remember on this PC" checked={remember} onChange={setRemember} />
          <div className={styles.folderRow}>
            <Button size="small" variant="primary" type="submit" disabled={working || token.trim() === ''}>
              {working ? 'Linking…' : 'Link'}
            </Button>
          </div>
        </form>
      )}
      {note !== null && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
    </section>
  );
}
