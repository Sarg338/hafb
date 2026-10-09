// The `?` overlay: every shortcut that works right now, grouped, searchable, plus the "Keyboard
// shortcuts on" switch. YNAB shortcuts not built yet are listed honestly as coming later.
import { useMemo, useRef, useState } from 'react';
import { Dialog } from '../Dialog.tsx';
import { Kbd } from '../Kbd.tsx';
import { TextInput } from '../TextInput.tsx';
import { Toggle } from '../Toggle.tsx';
import { formatKeys, parseKeys } from './registry.ts';
import styles from './ShortcutOverlay.module.css';
import { useShortcuts } from './ShortcutProvider.tsx';
import { YNAB_SHORTCUTS } from './ynabShortcuts.ts';

const GROUP_ORDER = ['General', 'Navigation', 'Plan', 'Register', 'Date fields'];

interface Row {
  id: string;
  keys: string;
  description: string;
  group: string;
  status: 'active' | 'planned' | 'off';
  note?: string;
}

function KeyChips({ keys }: { keys: string }) {
  const steps = formatKeys(parseKeys(keys)).split(' then ');
  return (
    <span className={styles.keys}>
      {steps.map((step, i) => (
        <span key={`${step}-${String(i)}`} className={styles.step}>
          {i > 0 && <span className={styles.then}>then</span>}
          <Kbd keys={step} />
        </span>
      ))}
    </span>
  );
}

export function ShortcutOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { list, conflicts, enabled, setEnabled } = useShortcuts();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const s of list) {
      if (s.enabled === false || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, keys: s.keys, description: s.description, group: s.group, status: !enabled && s.system !== true ? 'off' : 'active' });
    }
    for (const p of YNAB_SHORTCUTS) {
      if (seen.has(p.id)) continue;
      // In-component keys work wherever that component is; other keys simply aren't registered on
      // the current screen.
      const live = p.inComponent === true;
      const where = live ? null : 'Not available on this screen';
      const verify = p.extra === true ? 'HAFB extra' : p.verified ? null : 'to verify against YNAB';
      const note = [where, verify].filter((x): x is string => x !== null).join(' · ');
      out.push({
        id: p.id,
        keys: p.keys,
        description: p.description,
        group: p.group,
        status: live ? 'active' : 'planned',
        ...(note === '' ? {} : { note: note.charAt(0).toUpperCase() + note.slice(1) }),
      });
    }
    const q = query.trim().toLowerCase();
    return q === '' ? out : out.filter((r) => r.description.toLowerCase().includes(q) || formatKeys(parseKeys(r.keys)).toLowerCase().includes(q));
  }, [list, enabled, query]);

  const groups = useMemo(() => {
    const names = [...new Set([...GROUP_ORDER, ...rows.map((r) => r.group)])];
    return names.map((g) => ({ name: g, rows: rows.filter((r) => r.group === g) })).filter((g) => g.rows.length > 0);
  }, [rows]);

  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="wide" initialFocus={searchRef}>
      <div className={styles.controls}>
        <TextInput
          ref={searchRef}
          label="Search shortcuts"
          hideLabel
          placeholder="Search shortcuts"
          size="compact"
          prefix="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <Toggle label="Keyboard shortcuts on" checked={enabled} onChange={setEnabled} />
      </div>
      {!enabled && <p className={styles.offNote}>Shortcuts are off. Press ? to open this list and turn them back on.</p>}
      <div className={styles.groups}>
        {groups.map((g) => (
          <section key={g.name} aria-labelledby={`sc-${g.name}`}>
            <h3 id={`sc-${g.name}`} className={styles.group}>
              {g.name}
            </h3>
            <ul className={styles.list}>
              {g.rows.map((r) => (
                <li key={r.id} className={styles.row} data-status={r.status}>
                  <span className={styles.description}>
                    {r.description}
                    {r.note !== undefined && <span className={styles.note}>{r.note}</span>}
                  </span>
                  <KeyChips keys={r.keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className={styles.offNote}>No shortcuts match “{query.trim()}”.</p>}
      </div>
      {import.meta.env.DEV && conflicts.length > 0 && (
        <div className={styles.conflicts} role="note">
          <strong>Conflicts (dev builds only)</strong>
          <ul>
            {conflicts.map((c) => (
              <li key={`${c.scope}-${c.keys}`}>
                {c.keys} ({c.scope}): {c.ids.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
