// Focused Views dialogs (S5.3), as YNAB has them (trial, 2026-10-08):
// - "New Custom View": "Choose a set of categories to include in this custom view." View Name
//   ("Keep 'em short & sweet!") and the categories by group; Cancel / Save.
// - "Manage Views": the views in order (move up/down; YNAB drags), custom ones editable and
//   deletable; New View / Done.
import { useState } from 'react';
import type { Id } from '@hafb/engine';
import { createFocusedView, deleteFocusedView, editFocusedView, focusedViews, MAX_CUSTOM_VIEWS, reorderFocusedViews, type FocusedViewRecord, type PlanData } from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import styles from './PlanScreen.module.css';

export function ViewDialog({ plan, view, actions, onClose, onSaved }: { plan: PlanData; view?: FocusedViewRecord; actions: Actions; onClose: () => void; onSaved?: (viewId: Id) => void }) {
  const [name, setName] = useState(view?.name ?? '');
  const [picked, setPicked] = useState<ReadonlySet<Id>>(() => new Set(view?.categoryIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const groups = plan.categoryGroups
    .filter((g) => g.deletedAt === undefined && g.systemKind !== 'hidden')
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({ group: g, categories: plan.categories.filter((c) => c.groupId === g.id && c.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder) }))
    .filter((g) => g.categories.length > 0);
  const save = (): void => {
    if (name.trim() === '') {
      setError('Give the view a name.');
      return;
    }
    let created: Id | null = null;
    actions.run((p, ctx) => {
      if (view) return editFocusedView(p, ctx, { viewId: view.id, name, categoryIds: [...picked] });
      const cmd = createFocusedView(p, ctx, { name, categoryIds: [...picked] });
      created = cmd.viewId;
      return cmd;
    });
    onClose();
    const id = view?.id ?? created;
    if (id !== null) onSaved?.(id);
  };
  const toggle = (id: Id, on: boolean): void => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={view ? 'Edit Custom View' : 'New Custom View'}
      description="Choose a set of categories to include in this custom view."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <TextInput
        label="View Name"
        placeholder="Keep ’em short & sweet!"
        value={name}
        autoFocus
        error={error}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      <p className={styles.dialogNote}>Select the categories below to include.</p>
      <div className={styles.viewPicker} role="group" aria-label="Categories in this view">
        {groups.map(({ group, categories }) => (
          <div key={group.id}>
            <p className={styles.viewGroup}>{group.name}</p>
            {categories.map((c) => (
              <Checkbox key={c.id} label={c.name} checked={picked.has(c.id)} onChange={(on) => { toggle(c.id, on); }} />
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function ManageViewsDialog({ plan, actions, onClose, onNew, onEdit }: { plan: PlanData; actions: Actions; onClose: () => void; onNew: () => void; onEdit: (view: FocusedViewRecord) => void }) {
  const views = focusedViews(plan).filter((v) => v.builtin !== 'overspent');
  const custom = views.filter((v) => v.builtin === undefined).length;
  const move = (i: number, by: number): void => {
    const order = views.map((v) => v.id);
    const [moved] = order.splice(i, 1);
    if (moved === undefined) return;
    order.splice(i + by, 0, moved);
    actions.run((p, ctx) => reorderFocusedViews(p, ctx, { order }));
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Manage Views"
      footer={
        <>
          <Button disabled={custom >= MAX_CUSTOM_VIEWS} title={custom >= MAX_CUSTOM_VIEWS ? `Up to ${String(MAX_CUSTOM_VIEWS)} custom views` : undefined} onClick={onNew}>
            New View
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <ol className={styles.viewList}>
        {views.map((v, i) => (
          <li key={v.id} className={styles.viewItem}>
            <span className={styles.viewName}>{v.name}</span>
            <IconButton icon="chevronUp" size="small" label={`Move ${v.name} up`} disabled={i === 0} onClick={() => { move(i, -1); }} />
            <IconButton icon="chevronDown" size="small" label={`Move ${v.name} down`} disabled={i === views.length - 1} onClick={() => { move(i, 1); }} />
            {v.builtin === undefined && (
              <>
                <IconButton icon="edit" size="small" label={`Edit ${v.name}`} onClick={() => { onEdit(v); }} />
                <IconButton
                  icon="dismiss"
                  size="small"
                  label={`Delete ${v.name}`}
                  onClick={() => {
                    actions.run((p, ctx) => deleteFocusedView(p, ctx, { viewId: v.id }), { announce: `Deleted the view “${v.name}”.` });
                  }}
                />
              </>
            )}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
