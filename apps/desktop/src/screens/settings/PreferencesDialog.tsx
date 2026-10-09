// Preferences (S7.1): settings of this PC rather than of the plan. Text size, keyboard shortcuts,
// Hide Amounts, the account new transactions start in (for this plan) and the plans folder.
import { useEffect, useState } from 'react';
import type { AccountRecord } from '@hafb/store';
import { prefs, TEXT_SCALES, usePrefs, type TextScale } from '../../shell/prefs.ts';
import { Button } from '../../ui/Button.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { Toggle } from '../../ui/Toggle.tsx';
import styles from './Settings.module.css';

/** The plans folder, from the Rust side (absent in the browser preview). */
export interface PlanFolderControls {
  get: () => Promise<string | null>;
  set: (folder: string | null) => Promise<string | null>;
  pick: () => Promise<string | null>;
}

const AUTO = '';

export function PreferencesDialog({
  onClose,
  planPath,
  accounts,
  folders,
}: {
  onClose: () => void;
  planPath: string;
  accounts: readonly AccountRecord[];
  folders?: PlanFolderControls;
}) {
  const p = usePrefs();
  const [folder, setFolder] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!folders) return;
    let live = true;
    folders.get().then(
      (f) => {
        if (live) setFolder(f);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [folders]);
  const open = accounts.filter((a) => a.deletedAt === undefined && a.closed !== true);
  const chosen = p.defaultAccounts[planPath];
  const saveFolder = (f: string | null): void => {
    folders?.set(f).then(setFolder, (e: unknown) => {
      setNote(`Couldn’t use that folder: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  return (
    <Dialog open onClose={onClose} title="Preferences" description="These settings belong to this PC. Plan Settings travel with the plan file." footer={<Button onClick={onClose}>Done</Button>}>
      <div className={styles.form}>
        <section className={styles.section} aria-labelledby="pref-text">
          <h3 id="pref-text">Text size</h3>
          <SegmentedControl<string>
            label="Text size"
            options={TEXT_SCALES.map((s) => ({ value: String(s), label: `${String(Math.round(s * 100))}%` }))}
            value={String(p.textScale)}
            onChange={(v) => {
              const scale = TEXT_SCALES.find((s) => String(s) === v);
              if (scale !== undefined) prefs.update({ textScale: scale satisfies TextScale });
            }}
          />
          <p className={styles.help}>Ctrl+Plus and Ctrl+Minus change it too; Ctrl+0 goes back to 100%.</p>
        </section>
        <section className={styles.section} aria-labelledby="pref-general">
          <h3 id="pref-general">General</h3>
          <Toggle
            label="Keyboard shortcuts"
            checked={p.shortcutsOn}
            onChange={(v) => {
              prefs.update({ shortcutsOn: v });
            }}
          />
          <Toggle
            label="Hide amounts"
            checked={p.hideAmounts}
            onChange={(v) => {
              prefs.update({ hideAmounts: v });
            }}
          />
        </section>
        <section className={styles.section} aria-labelledby="pref-account">
          <h3 id="pref-account">Default account</h3>
          <Combobox
            label="Default account for new transactions in All Accounts"
            size="medium"
            groups={[
              {
                id: 'accounts',
                label: 'Accounts',
                options: [{ id: AUTO, label: 'First cash or credit account' }, ...open.map((a) => ({ id: a.id, label: a.name }))],
              },
            ]}
            value={chosen !== undefined && open.some((a) => a.id === chosen) ? chosen : AUTO}
            onChange={(id) => {
              const others = Object.fromEntries(Object.entries(p.defaultAccounts).filter(([k]) => k !== planPath));
              prefs.update({ defaultAccounts: id === AUTO ? others : { ...others, [planPath]: id } });
            }}
          />
          <p className={styles.help}>New transactions in All Accounts and bank files imported from there start in this account.</p>
        </section>
        <section className={styles.section} aria-labelledby="pref-folder">
          <h3 id="pref-folder">Plans folder</h3>
          {folders ? (
            <div className={styles.folderRow}>
              <code>{folder === undefined ? '…' : (folder ?? 'Windows’ default (Documents)')}</code>
              <Button
                size="small"
                onClick={() => {
                  folders.pick().then(
                    (f) => {
                      if (f !== null) saveFolder(f);
                    },
                    () => undefined,
                  );
                }}
              >
                Change folder…
              </Button>
              {folder !== null && folder !== undefined && (
                <Button
                  size="small"
                  onClick={() => {
                    saveFolder(null);
                  }}
                >
                  Use the default
                </Button>
              )}
            </div>
          ) : (
            <p className={styles.help}>Available in the installed app.</p>
          )}
          <p className={styles.help}>New plans are saved here, and Open plan starts here.</p>
          {note !== null && (
            <p className={styles.note} role="status">
              {note}
            </p>
          )}
        </section>
      </div>
    </Dialog>
  );
}
