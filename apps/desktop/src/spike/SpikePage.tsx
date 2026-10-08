import { useState } from 'react';
import { GridSpike } from './GridSpike.tsx';
import { LaunchSpike } from './LaunchSpike.tsx';
import { SqliteSpike } from './SqliteSpike.tsx';
import { TitlebarSpike } from './TitlebarSpike.tsx';

// Phase 0 spike screens: ugly on purpose, measured not shipped. Delete when Phase 0 closes.
const TABS = [
  { id: 'launch', label: 'Launch & build', Component: LaunchSpike },
  { id: 'sqlite', label: '(a) SQLite', Component: SqliteSpike },
  { id: 'grid', label: '(b) 50k grid', Component: GridSpike },
  { id: 'titlebar', label: '(c) Title bar', Component: TitlebarSpike },
];

export function SpikePage() {
  const [active, setActive] = useState('launch');
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <div className="spike">
      <nav aria-label="Spike checks">
        <a href="#/">← Home</a>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === active}
            onClick={() => {
              setActive(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab && <tab.Component />}
    </div>
  );
}
