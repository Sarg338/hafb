import styles from './Kbd.module.css';

/** Split "Ctrl+Shift+Z" → [Ctrl, Shift, Z]; the plus key itself survives ("+", "Ctrl++"). */
export function shortcutKeys(keys: string): string[] {
  const parts = keys
    .split('+')
    .map((k) => k.trim())
    .filter((k) => k !== '');
  if (keys.trim().endsWith('+') && (keys.trim() === '+' || keys.trim().endsWith('++'))) parts.push('+');
  return parts;
}

/** A keyboard shortcut as key chips: "Ctrl+Shift+Z" → Ctrl · Shift · Z. */
export function Kbd({ keys }: { keys: string }) {
  const parts = shortcutKeys(keys);
  return (
    <span className={styles.kbd} aria-label={keys}>
      {parts.map((k, i) => (
        <kbd key={`${k}-${String(i)}`}>{k}</kbd>
      ))}
    </span>
  );
}
