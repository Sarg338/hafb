import styles from './Kbd.module.css';

/** A keyboard shortcut as key chips: "Ctrl+Shift+Z" → Ctrl · Shift · Z. */
export function Kbd({ keys }: { keys: string }) {
  const parts = keys.split('+').map((k) => k.trim());
  return (
    <span className={styles.kbd} aria-label={keys}>
      {parts.map((k, i) => (
        <kbd key={`${k}-${String(i)}`}>{k}</kbd>
      ))}
    </span>
  );
}
