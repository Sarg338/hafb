// Display Options (S7.1), as YNAB's dialog (checked 2026-10-09): Theme (Default, Dark, Match System;
// HAFB adds High contrast), Progress Bars (On, Off) and Balance Style (Default, Differentiate
// Without Color). Changes apply on "Apply"; Cancel leaves everything as it was.
import { useState } from 'react';
import { prefs, type ThemePref } from '../../shell/prefs.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import styles from './Settings.module.css';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Default' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match System' },
  { value: 'high-contrast', label: 'High contrast' },
];

export function DisplayOptionsDialog({ onClose }: { onClose: () => void }) {
  const start = prefs.get();
  const [theme, setTheme] = useState<ThemePref>(start.theme);
  const [bars, setBars] = useState<'on' | 'off'>(start.showProgressBars ? 'on' : 'off');
  const [style, setStyle] = useState<'default' | 'nocolor'>(start.noColor ? 'nocolor' : 'default');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Display Options"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              prefs.update({ theme, showProgressBars: bars === 'on', noColor: style === 'nocolor' });
              onClose();
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <section className={styles.section} aria-labelledby="display-theme">
          <h3 id="display-theme">Theme</h3>
          <SegmentedControl label="Theme" options={THEMES} value={theme} onChange={setTheme} />
        </section>
        <section className={styles.section} aria-labelledby="display-bars">
          <h3 id="display-bars">Progress Bars</h3>
          <SegmentedControl
            label="Progress Bars"
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={bars}
            onChange={setBars}
          />
        </section>
        <section className={styles.section} aria-labelledby="display-balance">
          <h3 id="display-balance">Balance Style</h3>
          <SegmentedControl
            label="Balance Style"
            options={[
              { value: 'default', label: 'Default' },
              { value: 'nocolor', label: 'Differentiate Without Color' },
            ]}
            value={style}
            onChange={setStyle}
          />
        </section>
      </div>
    </Dialog>
  );
}
