// Dev-only component gallery (#/gallery, S3.2). Every component in every state, under every theme.
// Sections live in ./sections/*.tsx and register themselves: each exports `section`.
// Deep links for review captures: #/gallery?theme=dark&nocolor=1&section=buttons
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { BUILT_IN_THEMES, lightTheme } from '../theme/themes.ts';
import { applyTheme } from '../theme/tokens.ts';
import { cx } from '../ui/cx.ts';
import '../ui/base.css';
import styles from './Gallery.module.css';

export interface GallerySection {
  id: string;
  title: string;
  /** Sort order in the index. */
  order: number;
  Component: ComponentType;
}

const modules = import.meta.glob<{ section: GallerySection }>('./sections/*.tsx', { eager: true });
const SECTIONS = Object.values(modules)
  .map((m) => m.section)
  .toSorted((a, b) => a.order - b.order);

function readHash(): { theme: string | null; noColor: boolean; section: string | null } {
  const query = window.location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  return { theme: params.get('theme'), noColor: params.get('nocolor') === '1', section: params.get('section') };
}

export function Gallery() {
  const initial = useMemo(() => readHash(), []);
  const [themeId, setThemeId] = useState(initial.theme ?? lightTheme.id);
  const [noColor, setNoColor] = useState(initial.noColor);
  const theme = BUILT_IN_THEMES.find((t) => t.id === themeId) ?? lightTheme;
  const shown = initial.section === null ? SECTIONS : SECTIONS.filter((s) => s.id === initial.section);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className={cx('hafb-root', styles.gallery)} data-nocolor={String(noColor || theme.system === true)} data-theme-system={String(theme.system === true)}>
      <header className={styles.header}>
        <h1>Components</h1>
        <span className={styles.muted}>S3.2 gallery · dev only</span>
        <div className={styles.controls} role="group" aria-label="Gallery display">
          <div className={styles.seg}>
            {BUILT_IN_THEMES.map((t) => (
              <button key={t.id} type="button" aria-pressed={t.id === themeId} onClick={() => {
                setThemeId(t.id);
              }}>
                {t.name}
              </button>
            ))}
          </div>
          <label className={styles.toggle}>
            <input type="checkbox" checked={noColor || theme.system === true} disabled={theme.system === true} onChange={(e) => {
              setNoColor(e.target.checked);
            }} />
            Differentiate without color
          </label>
        </div>
      </header>
      <nav className={styles.index} aria-label="Sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/gallery?section=${s.id}`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(`section-${s.id}`)?.scrollIntoView({ block: 'start' });
          }}>
            {s.title}
          </a>
        ))}
      </nav>
      <main className={styles.main}>
        {shown.map((s) => (
          <section key={s.id} id={`section-${s.id}`} className={styles.section} aria-labelledby={`title-${s.id}`}>
            <h2 id={`title-${s.id}`}>{s.title}</h2>
            <s.Component />
          </section>
        ))}
      </main>
    </div>
  );
}

/** A labelled specimen row inside a section. */
export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.specimen}>
      <div className={styles.label}>{label}</div>
      <div className={styles.items}>{children}</div>
    </div>
  );
}
