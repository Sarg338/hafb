// Import Category Template (S7.2), worded as YNAB's dialog (trial 2026-10-09): pick a template, then
// "Deselect any categories you do not want to include." Importing adds new groups and categories
// at the bottom and never overwrites anything.
import { useState } from 'react';
import { templateKey, type CategoryTemplate } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { cx } from '../../ui/cx.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { templateKeys, templateSummary } from './lifecycleModel.ts';
import styles from './Lifecycle.module.css';

export function TemplateDialog({
  templates,
  planName,
  onClose,
  onImport,
}: {
  templates: readonly CategoryTemplate[];
  planName: string;
  onClose: () => void;
  onImport: (template: CategoryTemplate, exclude: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string>(templates[0]?.id ?? '');
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const template = templates.find((t) => t.id === chosen);
  const picked = template ? templateKeys(template).filter((k) => !excluded.has(k)).length : 0;
  const toggle = (keys: readonly string[], on: boolean): void => {
    const next = new Set(excluded);
    for (const k of keys) {
      if (on) next.delete(k);
      else next.add(k);
    }
    setExcluded(next);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="large"
      title="Import Category Template"
      description={
        <>
          Would you like to add these categories into your plan <strong>{planName}</strong>? Deselect any categories you do not want to include. You can also always delete extra categories later!
        </>
      }
      footer={
        <>
          <span className={styles.footNote}>Adding this template will not overwrite anything in your plan, it will just add these new groups and categories at the bottom.</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!template || picked === 0}
            onClick={() => {
              if (template) onImport(template, [...excluded]);
            }}
          >
            Import Categories
          </Button>
        </>
      }
    >
      <div className={styles.templateLayout}>
        <ul className={styles.templateList} aria-label="Templates">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={cx(styles.templateButton, t.id === chosen && styles.templateButtonOn)}
                aria-pressed={t.id === chosen}
                onClick={() => {
                  setChosen(t.id);
                  setExcluded(new Set());
                }}
              >
                <strong>{t.name}</strong>
                <span>{templateSummary(t)}</span>
              </button>
            </li>
          ))}
        </ul>
        {template && (
          <div className={styles.templateBody}>
            <p className={styles.blurb}>{template.description}</p>
            <div className={styles.checklist} role="group" aria-label={`${template.name} categories`}>
              {template.groups.map((g) => {
                const keys = g.categories.map((c) => templateKey(g.name, c.name));
                const on = keys.filter((k) => !excluded.has(k)).length;
                return (
                  <div key={g.name} className={styles.checkGroup}>
                    <Checkbox
                      label={g.name}
                      checked={on === keys.length}
                      indeterminate={on > 0 && on < keys.length}
                      onChange={(v) => {
                        toggle(keys, v);
                      }}
                    />
                    <div className={styles.checkItems}>
                      {g.categories.map((c) => {
                        const k = templateKey(g.name, c.name);
                        return (
                          <Checkbox
                            key={k}
                            label={c.name}
                            checked={!excluded.has(k)}
                            onChange={(v) => {
                              toggle([k], v);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
