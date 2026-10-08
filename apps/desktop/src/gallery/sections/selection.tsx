import { useState } from 'react';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Chip } from '../../ui/Chip.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { Toggle } from '../../ui/Toggle.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';

function Selection() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  const [bars, setBars] = useState(true);
  const [hide, setHide] = useState(false);
  const [range, setRange] = useState<'month' | 'quarter' | 'year'>('quarter');
  const [view, setView] = useState('all');
  return (
    <>
      <Specimen label="Checkbox">
        <Checkbox checked={a} onChange={setA} label="Show progress bars" />
        <Checkbox checked={b} onChange={setB} label="Hide reconciled" />
        <Checkbox checked={false} indeterminate onChange={() => undefined} aria-label="Select all categories" />
        <Checkbox checked onChange={() => undefined} label="Locked option" disabled />
        <Checkbox checked={false} onChange={() => undefined} label="Unavailable" disabled />
      </Specimen>
      <Specimen label="Toggle">
        <Toggle checked={bars} onChange={setBars} label="Progress bars" />
        <Toggle checked={hide} onChange={setHide} label="Hide amounts" />
        <Toggle checked onChange={() => undefined} label="Managed by Windows" disabled />
      </Specimen>
      <Specimen label="Segmented">
        <SegmentedControl
          label="Report period"
          value={range}
          onChange={setRange}
          options={[
            { value: 'month', label: 'This month' },
            { value: 'quarter', label: 'Last 3 months' },
            { value: 'year', label: 'This year' },
          ]}
        />
      </Specimen>
      <Specimen label="Chips">
        <Chip variant="alert" icon="warning" count={2} pressed={view === 'overspent'} onClick={() => {
          setView(view === 'overspent' ? 'all' : 'overspent');
        }}>
          Overspent
        </Chip>
        {[
          ['all', 'All'],
          ['underfunded', 'Underfunded'],
          ['available', 'Money Available'],
          ['snoozed', 'Snoozed'],
        ].map(([id = '', text]) => (
          <Chip key={id} pressed={view === id} onClick={() => {
            setView(id);
          }}>
            {text}
          </Chip>
        ))}
        <Chip icon="calendar">Aug 2026 – Oct 2026</Chip>
        <Chip disabled>Unavailable</Chip>
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'selection', title: 'Selection controls', order: 40, Component: Selection };
