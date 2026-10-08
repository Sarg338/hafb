import { useMemo, useState } from 'react';
import { buildSamplePlan } from '../../design/sample.ts';
import { moneyFormat } from '../../design/planModel.ts';
import { CategoryPicker } from '../../ui/CategoryPicker.tsx';
import { PayeePicker } from '../../ui/PayeePicker.tsx';
import { categoryPickerData, payeeGroups } from '../../ui/pickerData.ts';
import { Specimen, type GallerySection } from '../Gallery.tsx';

/** `?open=category|payee` opens that picker with a query typed (review screenshots). */
function openParam(): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('open');
}

function Pickers() {
  const sample = useMemo(() => buildSamplePlan(), []);
  const open = useMemo(() => openParam(), []);
  const payees = useMemo(() => payeeGroups(sample.plan), [sample]);
  const [createdPayees, setCreatedPayees] = useState<string[]>([]);
  const payeeOptions = useMemo(
    () =>
      createdPayees.length === 0
        ? payees
        : payees.map((g) => (g.id === 'saved' ? { ...g, options: [...g.options, ...createdPayees.map((n) => ({ id: `new:${n}`, label: n }))].sort((a, b) => a.label.localeCompare(b.label)) } : g)),
    [payees, createdPayees],
  );
  const categories = useMemo(() => categoryPickerData(sample.plan, '2026-10', sample.today, { allowSplit: true }), [sample]);
  const fmt = moneyFormat(sample.plan);
  const [payee, setPayee] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [formCategory, setFormCategory] = useState<string | null>(null);
  const name = (groups: typeof payees, id: string | null): string => groups.flatMap((g) => g.options).find((o) => o.id === id)?.label ?? '—';

  return (
    <>
      <Specimen label="Payee (register, compact)">
        <div style={{ width: 240 }}>
          <PayeePicker
            groups={payeeOptions}
            value={payee}
            onChange={setPayee}
            onCreate={(n) => {
              setCreatedPayees((p) => [...p, n]);
              setPayee(`new:${n}`);
            }}
            {...(open === 'payee' ? { initialQuery: 'tr' } : {})}
          />
        </div>
        <span>Selected: {name(payeeOptions, payee)}</span>
      </Specimen>
      <Specimen label="Category (register, compact)">
        <div style={{ width: 280 }}>
          <CategoryPicker
            groups={categories.groups}
            available={categories.available}
            format={fmt}
            value={category}
            onChange={setCategory}
            {...(open === 'category' ? { initialQuery: 'gr' } : {})}
          />
        </div>
        <span>Selected: {name(categories.groups, category)}</span>
      </Specimen>
      <Specimen label="Category (form field)">
        <div style={{ width: 320 }}>
          <CategoryPicker groups={categories.groups} available={categories.available} format={fmt} value={formCategory} onChange={setFormCategory} size="medium" />
        </div>
      </Specimen>
      <Specimen label="Disabled">
        <div style={{ width: 240 }}>
          <PayeePicker groups={payeeOptions} value={null} onChange={() => undefined} disabled />
        </div>
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'pickers', title: 'Payee and category pickers', order: 45, Component: Pickers };
