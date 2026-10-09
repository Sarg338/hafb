// Manage Payees (S5.5), laid out as YNAB has it (trial, 2026-10-08):
// - Left: Search Payees, then Payees (n), Hidden Payees and Transfer Payees, each with a select-all
//   box and collapsible.
// - Right, nothing selected: "Select a payee to edit."
// - One payee: Payee Name, Categorization (auto from history with the current default / always use
//   my choice / don't auto-categorize), Renaming rules ("Imported payees that match these rules
//   will be renamed."), Hide and Delete. Deleting a payee that has transactions asks for a New
//   Payee; without one they keep no payee (YNAB help).
// - Several: "N Payees Selected", Combine and Rename, Hide All, Delete All.
// - A transfer payee: renaming rules only; YNAB creates these, so they can't be edited or deleted.
// - Footer: Undo / Redo, Done.
import { useMemo, useState } from 'react';
import type { Id, RenameMatch } from '@hafb/engine';
import {
  addRenameRule,
  applyChanges,
  combinePayees,
  deletePayees,
  deleteRenameRule,
  editRenameRule,
  mergeChangeSets,
  renamePayee,
  setPayeeDefaults,
  setPayeesHidden,
  type PayeeRecord,
  type PlanData,
} from '@hafb/store';
import { monthOf, type ISODate } from '@hafb/shared';
import type { Actions } from '../../design/DesignApp.tsx';
import { Button, IconButton } from '../../ui/Button.tsx';
import { CategoryPicker } from '../../ui/CategoryPicker.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { cx } from '../../ui/cx.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { categoryPickerData } from '../../ui/pickerData.ts';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import { moneyFormat } from '../plan/planModel.ts';
import { categorizeMode, combinePlan, defaultCategoryName, modeArgs, payeeLists, RENAME_MATCHES, rulesFor, type CategorizeMode, type PayeeItem } from './payeesModel.ts';
import styles from './ManagePayees.module.css';

export interface ManagePayeesProps {
  plan: PlanData;
  today: ISODate;
  actions: Actions;
  history: { canUndo: boolean; canRedo: boolean };
  onClose: () => void;
}

type GroupId = 'payees' | 'hidden' | 'transfers';
const GROUP_LABEL: Record<GroupId, string> = { payees: 'Payees', hidden: 'Hidden Payees', transfers: 'Transfer Payees' };

export function ManagePayeesDialog({ plan, today, actions, history, onClose }: ManagePayeesProps) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<Id>>(() => new Set());
  // YNAB starts with Transfer Payees collapsed.
  const [collapsed, setCollapsed] = useState<ReadonlySet<GroupId>>(() => new Set<GroupId>(['transfers']));
  const lists = useMemo(() => payeeLists(plan, search), [plan, search]);
  const live = useMemo(() => new Map(plan.payees.filter((p) => p.deletedAt === undefined).map((p) => [p.id, p])), [plan.payees]);
  // A payee that was combined or deleted drops out of the selection.
  const selected = [...picked].filter((id) => live.has(id));

  const setGroup = (items: readonly PayeeItem[], on: boolean): void => {
    const next = new Set(picked);
    for (const p of items) {
      if (on) next.add(p.id);
      else next.delete(p.id);
    }
    setPicked(next);
  };
  const toggle = (id: Id, on: boolean): void => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const group = (id: GroupId, items: readonly PayeeItem[]) => {
    if (items.length === 0 && id !== 'payees') return null;
    const n = items.filter((p) => picked.has(p.id)).length;
    const open = !collapsed.has(id);
    return (
      <div key={id} className={styles.group} role="group" aria-label={GROUP_LABEL[id]}>
        <div className={styles.groupHead}>
          <IconButton
            icon={open ? 'chevronDown' : 'chevronRight'}
            size="small"
            label={open ? `Collapse ${GROUP_LABEL[id]}` : `Expand ${GROUP_LABEL[id]}`}
            aria-expanded={open}
            onClick={() => {
              const next = new Set(collapsed);
              if (open) next.add(id);
              else next.delete(id);
              setCollapsed(next);
            }}
          />
          <Checkbox
            label={n > 0 ? `${GROUP_LABEL[id]} (${String(n)})` : GROUP_LABEL[id]}
            checked={items.length > 0 && n === items.length}
            indeterminate={n > 0 && n < items.length}
            disabled={items.length === 0}
            onChange={(on) => {
              setGroup(items, on);
            }}
          />
        </div>
        {open && (
          <div className={styles.items}>
            {items.map((p) => (
              <div key={p.id} className={cx(styles.item, picked.has(p.id) && styles.itemOn)}>
                <Checkbox label={p.name} checked={picked.has(p.id)} onChange={(on) => { toggle(p.id, on); }} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const first = selected.length === 1 ? live.get(selected[0] ?? '') : undefined;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Manage Payees"
      size="large"
      footer={
        <>
          <Button variant="toolbar" icon="undo" disabled={!history.canUndo} onClick={actions.undo}>
            Undo
          </Button>
          <Button variant="toolbar" icon="redo" disabled={!history.canRedo} onClick={actions.redo}>
            Redo
          </Button>
          <span className={styles.spacer} />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.list}>
          <TextInput
            label="Search Payees"
            hideLabel
            size="compact"
            prefix="search"
            placeholder="Search Payees"
            value={search}
            autoFocus
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
          <div className={styles.groups}>
            {group('payees', lists.payees)}
            {group('hidden', lists.hidden)}
            {group('transfers', lists.transfers)}
          </div>
        </div>
        <div className={styles.detail} aria-live="polite">
          {selected.length === 0 && <p className={styles.empty}>Select a payee to edit.</p>}
          {first?.transferAccountId !== undefined && <TransferPayee key={first.id} plan={plan} payee={first} actions={actions} />}
          {first && first.transferAccountId === undefined && <OnePayee key={first.id} plan={plan} today={today} payee={first} actions={actions} />}
          {selected.length > 1 && (
            <SeveralPayees
              key={selected.join(',')}
              plan={plan}
              payees={selected.map((id) => live.get(id)).filter((p) => p !== undefined)}
              actions={actions}
              onCombined={(id) => {
                setPicked(new Set([id]));
              }}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

function OnePayee({ plan, today, payee, actions }: { plan: PlanData; today: ISODate; payee: PayeeRecord; actions: Actions }) {
  const [name, setName] = useState(payee.name);
  const [deleting, setDeleting] = useState(false);
  const uses = useMemo(() => plan.transactions.filter((t) => t.deletedAt === undefined && (t.payeeId === payee.id || t.subtransactions?.some((s) => s.payeeId === payee.id) === true)).length, [plan.transactions, payee.id]);
  const mode = categorizeMode(payee);
  const current = defaultCategoryName(plan, payee);
  const fmt = moneyFormat(plan);
  const categories = useMemo(() => categoryPickerData(plan, monthOf(today), today), [plan, today]);

  const commitName = (): void => {
    const clean = name.trim();
    if (clean === '' || clean === payee.name) {
      setName(payee.name);
      return;
    }
    actions.run((p, ctx) => renamePayee(p, ctx, { payeeId: payee.id, name: clean }));
  };
  const setMode = (m: CategorizeMode): void => {
    if (m !== mode) actions.run((p, ctx) => setPayeeDefaults(p, ctx, { payeeId: payee.id, ...modeArgs(payee, m) }));
  };

  return (
    <>
      <section className={styles.card} aria-label="Payee Name">
        <h3 className={styles.cardTitle}>Payee Name</h3>
        <TextInput
          label="Payee Name"
          hideLabel
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitName();
            }
          }}
        />
        <p className={styles.note}>{uses === 1 ? '1 transaction' : `${String(uses)} transactions`}</p>
      </section>

      <section className={styles.card} aria-label="Categorization">
        <h3 className={styles.cardTitle}>Categorization</h3>
        <SegmentedControl<CategorizeMode>
          label="Categorization"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'auto', label: 'Auto-categorize' },
            { value: 'fixed', label: 'Always use my choice' },
            { value: 'off', label: `Do not auto-categorize` },
          ]}
        />
        {mode === 'auto' && (
          <>
            <p className={styles.note}>New {payee.name} transactions get the category that 2 of its last 3 transactions used. This is updated when you add or edit a transaction.</p>
            <p className={styles.note}>
              Current default category: <strong className={styles.strong}>{current ?? 'None yet'}</strong>
            </p>
          </>
        )}
        {mode === 'fixed' && (
          <CategoryPicker
            groups={categories.groups}
            available={categories.available}
            format={fmt}
            size="medium"
            value={payee.defaultCategoryId ?? null}
            onChange={(id) => {
              actions.run((p, ctx) => setPayeeDefaults(p, ctx, { payeeId: payee.id, defaultCategoryId: id, fixed: true }));
            }}
          />
        )}
        {mode === 'off' && <p className={styles.note}>New {payee.name} transactions start with no category.</p>}
      </section>

      <RenameRules plan={plan} payee={payee} actions={actions} />

      {deleting ? (
        <DeletePrompt plan={plan} payees={[payee]} uses={uses} actions={actions} onCancel={() => { setDeleting(false); }} />
      ) : (
        <div className={styles.actions}>
          <Button
            onClick={() => {
              actions.run((p, ctx) => setPayeesHidden(p, ctx, { payeeIds: [payee.id], hidden: payee.hidden !== true }));
            }}
          >
            {payee.hidden === true ? 'Show' : 'Hide'}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (uses > 0) setDeleting(true);
              else actions.run((p, ctx) => deletePayees(p, ctx, { payeeIds: [payee.id] }), { announce: `Deleted the payee “${payee.name}”.` });
            }}
          >
            Delete
          </Button>
        </div>
      )}
      <p className={styles.fine}>Hidden payees aren’t suggested as you type or listed when you add a transaction: useful for payees you don’t expect to use again, like from a trip.</p>
    </>
  );
}

function RenameRules({ plan, payee, actions }: { plan: PlanData; payee: PayeeRecord; actions: Actions }) {
  const rules = rulesFor(plan, payee.id);
  const [match, setMatch] = useState<RenameMatch>('contains');
  const [pattern, setPattern] = useState('');
  const matchGroups = [{ id: 'match', label: 'Match', options: RENAME_MATCHES.map((m) => ({ id: m.id, label: m.label })) }];
  const asMatch = (id: string): RenameMatch | undefined => RENAME_MATCHES.find((m) => m.id === id)?.id;
  const add = (): void => {
    if (pattern.trim() === '') return;
    actions.run((p, ctx) => addRenameRule(p, ctx, { payeeId: payee.id, match, pattern }));
    setPattern('');
  };
  return (
    <section className={styles.card} aria-label="Renaming">
      <h3 className={styles.cardTitle}>Renaming</h3>
      <p className={styles.note}>Imported payees that match these rules will be renamed to {payee.name}.</p>
      {rules.map((r) => (
        <div key={r.id} className={styles.rule}>
          <Combobox
            label="Rule match"
            size="medium"
            className={cx(styles.ruleMatch)}
            groups={matchGroups}
            value={r.match}
            onChange={(id) => {
              const m = asMatch(id);
              if (m) actions.run((p, ctx) => editRenameRule(p, ctx, { ruleId: r.id, match: m, pattern: r.pattern }));
            }}
          />
          <RulePattern
            initial={r.pattern}
            onCommit={(text) => {
              actions.run((p, ctx) => editRenameRule(p, ctx, { ruleId: r.id, match: r.match, pattern: text }));
            }}
          />
          <IconButton
            icon="subtract"
            label={`Delete the rule “${r.pattern}”`}
            onClick={() => {
              actions.run((p, ctx) => deleteRenameRule(p, ctx, { ruleId: r.id }));
            }}
          />
        </div>
      ))}
      <div className={styles.rule}>
        <Combobox
          label="New rule match"
          size="medium"
          className={cx(styles.ruleMatch)}
          groups={matchGroups}
          value={match}
          onChange={(id) => {
            const m = asMatch(id);
            if (m) setMatch(m);
          }}
        />
        <TextInput
          label="New rule text"
          hideLabel
          value={pattern}
          placeholder="Text in the imported payee"
          onChange={(e) => {
            setPattern(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <IconButton icon="add" label="Add the renaming rule" disabled={pattern.trim() === ''} onClick={add} />
      </div>
    </section>
  );
}

function RulePattern({ initial, onCommit }: { initial: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const commit = (): void => {
    if (text.trim() === '' || text.trim() === initial) setText(initial);
    else onCommit(text.trim());
  };
  return (
    <TextInput
      label="Rule text"
      hideLabel
      value={text}
      onChange={(e) => {
        setText(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function TransferPayee({ plan, payee, actions }: { plan: PlanData; payee: PayeeRecord; actions: Actions }) {
  return (
    <>
      <h3 className={styles.heading}>{payee.name}</h3>
      <RenameRules plan={plan} payee={payee} actions={actions} />
      <p className={styles.info}>
        <Icon name="info" className={styles.inline} />
        Transfer payees move money between accounts, including credit card payments. They’re created with each account, so they can’t be edited or deleted.
      </p>
    </>
  );
}

function SeveralPayees({ plan, payees, actions, onCombined }: { plan: PlanData; payees: PayeeRecord[]; actions: Actions; onCombined: (id: Id) => void }) {
  const users = payees.filter((p) => p.transferAccountId === undefined);
  const [name, setName] = useState(users[0]?.name ?? '');
  const [deleting, setDeleting] = useState(false);
  const ids = new Set(users.map((p) => p.id));
  const uses = plan.transactions.filter((t) => t.deletedAt === undefined && ((t.payeeId !== undefined && ids.has(t.payeeId)) || t.subtransactions?.some((s) => s.payeeId !== undefined && ids.has(s.payeeId)) === true)).length;
  const allHidden = users.length > 0 && users.every((p) => p.hidden === true);
  const combine = (): void => {
    const step = combinePlan(plan, users.map((p) => p.id), name);
    if (!step) return;
    actions.run(
      (p, ctx) => {
        const merged = combinePayees(p, ctx, { sourceIds: step.sourceIds, targetId: step.targetId });
        if (step.rename === null) return merged;
        const renamed = renamePayee(applyChanges(p, merged.changes).plan, ctx, { payeeId: step.targetId, name: step.rename });
        return { label: merged.label, changes: mergeChangeSets(merged.changes, renamed.changes) };
      },
      { announce: `Combined ${String(users.length)} payees into “${name.trim()}”.` },
    );
    onCombined(step.targetId);
  };
  return (
    <>
      <div className={styles.summary}>
        <h3 className={styles.heading}>{payees.length} Payees Selected</h3>
        <p className={styles.note}>{uses === 1 ? '1 transaction' : `${String(uses)} transactions`}</p>
        <p className={styles.names}>{payees.map((p) => p.name).join(', ')}</p>
      </div>
      {users.length !== payees.length && <p className={styles.info}>Transfer payees can’t be combined, hidden or deleted; they’re left out.</p>}
      {users.length > 1 && (
        <section className={styles.card} aria-label="Combine and Rename">
          <h3 className={styles.cardTitle}>Combine and Rename</h3>
          <p className={styles.note}>Combining these payees also combines their renaming rules. All their transactions move to the combined payee.</p>
          <div className={styles.rule}>
            <TextInput
              label="Combined payee name"
              hideLabel
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  combine();
                }
              }}
            />
            <Button variant="primary" disabled={name.trim() === ''} onClick={combine}>
              Combine
            </Button>
          </div>
        </section>
      )}
      {users.length > 0 &&
        (deleting ? (
          <DeletePrompt plan={plan} payees={users} uses={uses} actions={actions} onCancel={() => { setDeleting(false); }} />
        ) : (
          <div className={styles.actions}>
            <Button
              onClick={() => {
                actions.run((p, ctx) => setPayeesHidden(p, ctx, { payeeIds: users.map((x) => x.id), hidden: !allHidden }));
              }}
            >
              {allHidden ? 'Show All' : 'Hide All'}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (uses > 0) setDeleting(true);
                else actions.run((p, ctx) => deletePayees(p, ctx, { payeeIds: users.map((x) => x.id) }), { announce: `Deleted ${String(users.length)} payees.` });
              }}
            >
              Delete All
            </Button>
          </div>
        ))}
    </>
  );
}

/** YNAB: deleting payees that have transactions asks for a New Payee for them (or none). */
function DeletePrompt({ plan, payees, uses, actions, onCancel }: { plan: PlanData; payees: PayeeRecord[]; uses: number; actions: Actions; onCancel: () => void }) {
  const gone = new Set(payees.map((p) => p.id));
  const [replacement, setReplacement] = useState<Id | null>(null);
  const options = plan.payees
    .filter((p) => p.deletedAt === undefined && p.transferAccountId === undefined && !gone.has(p.id))
    .map((p) => ({ id: p.id, label: p.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const names = payees.length === 1 ? `“${payees[0]?.name ?? ''}”` : `${String(payees.length)} payees`;
  return (
    <section className={styles.card} aria-label="New Payee">
      <h3 className={styles.cardTitle}>New Payee</h3>
      <p className={styles.note}>
        {uses === 1 ? '1 transaction uses' : `${String(uses)} transactions use`} {names}. Choose the payee they should have instead; with none, their payee is left blank.
      </p>
      <Combobox label="New payee" size="medium" placeholder="No payee" groups={[{ id: 'payees', label: 'Payees', options }]} value={replacement} onChange={setReplacement} />
      <div className={styles.actions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="danger"
          onClick={() => {
            actions.run((p, ctx) => deletePayees(p, ctx, { payeeIds: payees.map((x) => x.id), ...(replacement === null ? {} : { replacementId: replacement }) }), { announce: `Deleted ${names}.` });
          }}
        >
          Delete
        </Button>
      </div>
    </section>
  );
}
