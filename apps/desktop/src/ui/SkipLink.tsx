import styles from './SkipLink.module.css';

/**
 * "Skip to content": the first stop for keyboard users, invisible until focused. Moves focus to the
 * element with `targetId` (give it tabIndex={-1}) without scrolling the window.
 */
export function SkipLink({ targetId, label = 'Skip to content' }: { targetId: string; label?: string }) {
  return (
    <a
      className={styles.skip}
      href={`#${targetId}`}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(targetId)?.focus({ preventScroll: true });
      }}
    >
      {label}
    </a>
  );
}
