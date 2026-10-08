import { useState } from 'react';
import { DATE_KEYS, type ISODate } from '@hafb/shared';
import { DateInput } from '../../ui/DateInput.tsx';
import { Kbd } from '../../ui/Kbd.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';

const TODAY: ISODate = '2026-10-14';

function Picker({ format, label, size }: { format: string; label: string; size?: 'medium' | 'compact' }) {
  const [value, setValue] = useState<ISODate>('2026-10-05');
  return (
    <div style={{ width: 180 }}>
      <DateInput value={value} format={format} today={TODAY} onCommit={setValue} label={label} size={size ?? 'medium'} />
    </div>
  );
}

function Dates() {
  return (
    <>
      <Specimen label="Plan date formats">
        <Picker format="MM/DD/YYYY" label="MM/DD/YYYY" />
        <Picker format="DD/MM/YYYY" label="DD/MM/YYYY" />
        <Picker format="YYYY-MM-DD" label="YYYY-MM-DD" />
        <Picker format="DD.MM.YYYY" label="DD.MM.YYYY" />
      </Specimen>
      <Specimen label="Register size">
        <Picker format="MM/DD/YYYY" label="Date" size="compact" />
        <div style={{ width: 180 }}>
          <DateInput value="2026-10-05" format="MM/DD/YYYY" today={TODAY} onCommit={() => undefined} label="Date (disabled)" disabled />
        </div>
      </Specimen>
      <Specimen label="Date keys">
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '6px 18px' }}>
          {DATE_KEYS.filter((k) => k.key !== '=').map((k) => (
            <li key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Kbd keys={k.key.length === 1 ? k.key.toUpperCase() : k.key} /> {k.description}
            </li>
          ))}
        </ul>
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'dates', title: 'Dates', order: 30, Component: Dates };
