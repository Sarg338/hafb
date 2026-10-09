// New Plan (S7.2): YNAB's New Plan fields (S7.1), then how to start: a blank plan or one of the
// bundled category templates, or an import of a YNAB export instead.
import { useState } from 'react';
import { TEMPLATES, type CategoryTemplate } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { PlanSettingsDialog } from '../settings/PlanSettingsDialog.tsx';
import { newPlanDraft, newPlanSettings } from '../settings/settingsModel.ts';
import { templateSummary } from './lifecycleModel.ts';
import styles from './Lifecycle.module.css';

export function NewPlanDialog({
  year,
  onClose,
  onCreate,
  onImportYnab,
}: {
  year: number;
  onClose: () => void;
  onCreate: (settings: ReturnType<typeof newPlanSettings>, template: CategoryTemplate | null) => void;
  onImportYnab: () => void;
}) {
  const [start, setStart] = useState<'blank' | 'template'>('blank');
  const [templateId, setTemplateId] = useState(TEMPLATES[0]?.id ?? '');
  const template = TEMPLATES.find((t) => t.id === templateId) ?? null;
  return (
    <PlanSettingsDialog
      mode="new"
      initial={newPlanDraft('My Plan')}
      year={year}
      onClose={onClose}
      onSubmit={(draft) => {
        onCreate(newPlanSettings(draft), start === 'template' ? template : null);
      }}
      extra={
        <section className={styles.startWith} aria-labelledby="new-plan-start">
          <h3 id="new-plan-start">Start with</h3>
          <SegmentedControl
            label="Start with"
            options={[
              { value: 'blank', label: 'A blank plan' },
              { value: 'template', label: 'A template' },
            ]}
            value={start}
            onChange={setStart}
          />
          {start === 'template' && (
            <>
              <Combobox
                label="Template"
                size="medium"
                groups={[{ id: 'templates', label: 'Templates', options: TEMPLATES.map((t) => ({ id: t.id, label: t.name })) }]}
                value={templateId}
                onChange={setTemplateId}
              />
              {template && (
                <p className={styles.muted}>
                  {templateSummary(template)}. {template.description}
                </p>
              )}
            </>
          )}
          <p className={styles.muted}>
            Coming from YNAB?{' '}
            <Button variant="toolbar" size="small" onClick={onImportYnab}>
              Import your YNAB export instead
            </Button>
          </p>
        </section>
      }
    />
  );
}
