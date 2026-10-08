import { useState } from 'react';
import { minor, type Minor, type MoneyFormat } from '@hafb/shared';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { TextArea } from '../../ui/TextArea.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import { IconButton } from '../../ui/Button.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';

const usd: MoneyFormat = { decimals: 2, symbol: '$', placement: 'before', numberFormat: '123,456.78' };
const eur: MoneyFormat = { decimals: 2, symbol: '€', placement: 'after', numberFormat: '123.456,78' };

function Money({ initial, format, ...rest }: { initial: number; format: MoneyFormat } & Omit<Parameters<typeof MoneyInput>[0], 'value' | 'format' | 'onCommit'>) {
  const [value, setValue] = useState<Minor>(minor(initial));
  return <MoneyInput value={value} format={format} onCommit={setValue} {...rest} />;
}

function Text() {
  const [payee, setPayee] = useState('Fresh Market');
  return (
    <>
      <Specimen label="Text field">
        <div style={{ width: 240 }}>
          <TextInput label="Payee" value={payee} onChange={(e) => {
            setPayee(e.target.value);
          }} />
        </div>
        <div style={{ width: 240 }}>
          <TextInput label="Memo" placeholder="Add a memo" help="Shown in the register." />
        </div>
        <div style={{ width: 240 }}>
          <TextInput label="Account name" defaultValue="" error="Give the account a name." />
        </div>
        <div style={{ width: 240 }}>
          <TextInput label="Account type" defaultValue="Checking" disabled />
        </div>
      </Specimen>
      <Specimen label="Compact, with icons">
        <div style={{ width: 260 }}>
          <TextInput label="Search transactions" hideLabel size="compact" prefix="search" placeholder="Search transactions" />
        </div>
        <div style={{ width: 200 }}>
          <TextInput label="Memo" hideLabel size="compact" defaultValue="Pantry restock" suffix={<IconButton icon="dismiss" label="Clear memo" size="small" />} />
        </div>
      </Specimen>
      <Specimen label="Text area">
        <div style={{ width: 300 }}>
          <TextArea label="Note for Groceries" placeholder="Enter a note…" />
        </div>
      </Specimen>
      <Specimen label="Money: plan cell">
        <div style={{ width: 120 }}>
          <Money initial={6000} format={usd} label="Assigned for Electric" />
        </div>
        <div style={{ width: 120 }}>
          <Money initial={0} format={usd} label="Assigned for Gifts" hot />
        </div>
        <div style={{ width: 120 }}>
          <Money initial={-2500} format={usd} label="Assigned for Clothing" />
        </div>
        <div style={{ width: 120 }}>
          <Money initial={6000} format={usd} label="Assigned (disabled)" disabled />
        </div>
      </Specimen>
      <Specimen label="Money: editing">
        <div style={{ width: 120, marginRight: 200, paddingBottom: 24 }}>
          <Money initial={6000} format={usd} label="Assigned with a sum" defaultDraft="60+80.06" />
        </div>
        <div style={{ width: 120, paddingBottom: 24 }}>
          <Money initial={6000} format={usd} label="Assigned with a typo" defaultDraft="60..5" />
        </div>
      </Specimen>
      <Specimen label="Money: field">
        <div style={{ width: 200 }}>
          <Money initial={150000} format={usd} label="Statement balance" variant="field" help="Accepts math: 1200+45.50" />
        </div>
        <div style={{ width: 200 }}>
          <Money initial={123456} format={eur} label="Betrag (EUR format)" variant="field" />
        </div>
        <div style={{ width: 200 }}>
          <Money initial={0} format={usd} label="Starting balance" variant="field" defaultDraft="1,250.40 - 30" />
        </div>
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'text', title: 'Text and money', order: 20, Component: Text };
