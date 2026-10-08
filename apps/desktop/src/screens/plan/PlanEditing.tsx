// Plan editing (S4.2): the row menu, the add/rename popovers and the delete dialog, wired to store
// commands. Every change is one undo step; hides, deletes and moves also toast with Undo.
import { useState, type ReactNode } from 'react';
import type { Id } from '@hafb/engine';
import type { ISODate, Month } from '@hafb/shared';
import {
  arrangeCategories,
  createCategory,
  createGroup,
  deleteCategory,
  deleteGroup,
  renameCategory,
  renameGroup,
  reorderGroups,
  setCategoryHidden,
  setGroupHidden,
  type PlanData,
} from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { rememberFocus } from '../../ui/focus.ts';
import { MenuList, type MenuItem } from '../../ui/Menu.tsx';
import { Popover } from '../../ui/Popover.tsx';
import type { Rect } from '../../ui/position.ts';
import { DeleteCategoryDialog, type DeleteTarget } from './DeleteCategoryDialog.tsx';
import { NamePopover } from './NamePopover.tsx';
import { dropCategory, dropGroup, stepCategory, stepGroup, type ArrangeArgs, type CategoryDrop } from './planEdit.ts';
import { HIDDEN_SECTION_ID } from './planRows.ts';

type Editor =
  | { kind: 'addGroup'; anchor: Rect }
  | { kind: 'addCategory'; groupId: Id; anchor: Rect }
  | { kind: 'renameCategory'; id: Id; anchor: Rect }
  | { kind: 'renameGroup'; id: Id; anchor: Rect }
  | { kind: 'delete'; target: DeleteTarget }
  | { kind: 'menu'; rowId: string; at: Rect; restore: () => void };

export const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const quoted = (name: string): string => `“${name}”`;

export function usePlanEditing({
  plan,
  month,
  today,
  actions,
  onCreated,
}: {
  plan: PlanData;
  month: Month;
  today: ISODate;
  actions: Actions;
  /** A new group or category was added: the screen scrolls to it (it may land out of view). */
  onCreated: (rowId: Id, groupId: Id) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const close = (): void => {
    setEditor(null);
  };
  const category = (id: Id) => plan.categories.find((c) => c.id === id && c.deletedAt === undefined);
  const group = (id: Id) => plan.categoryGroups.find((g) => g.id === id && g.deletedAt === undefined);

  const arrange = (args: ArrangeArgs | null, name: string): void => {
    if (!args) return;
    actions.run((p, ctx) => arrangeCategories(p, ctx, args), { announce: `Moved ${quoted(name)}.` });
  };
  const reorder = (ids: Id[] | null, name: string): void => {
    if (!ids) return;
    actions.run((p, ctx) => reorderGroups(p, ctx, { groupIds: ids }), { announce: `Moved ${quoted(name)}.` });
  };

  const hideCategory = (id: Id, hidden: boolean): void => {
    const c = category(id);
    if (!c) return;
    actions.run((p, ctx) => setCategoryHidden(p, ctx, { categoryId: id, hidden }), {
      announce: hidden ? `Hid ${quoted(c.name)}. It's in Hidden Categories at the bottom.` : `${quoted(c.name)} is back in its group.`,
    });
  };
  const hideGroup = (id: Id, hidden: boolean): void => {
    const g = group(id);
    if (!g) return;
    actions.run((p, ctx) => setGroupHidden(p, ctx, { groupId: id, hidden }), {
      announce: hidden ? `Hid the ${quoted(g.name)} group. It's in Hidden Categories at the bottom.` : `The ${quoted(g.name)} group is back.`,
    });
  };

  // ---- the row menu ------------------------------------------------------------------------------

  /** Menu items for a row (category or group id), or [] when the row has no actions. */
  const menuItems = (rowId: string): MenuItem[] => {
    if (rowId === HIDDEN_SECTION_ID) return [];
    const c = category(rowId);
    if (c) {
      const g = group(c.groupId);
      const payment = c.creditCardAccountId !== undefined;
      const inHiddenGroup = g?.hidden === true && g.systemKind === undefined;
      if (c.hidden === true || inHiddenGroup) {
        return [
          ...(c.hidden === true ? [{ id: 'unhide', label: 'Unhide', icon: 'eye' as const }] : []),
          ...(inHiddenGroup ? [{ id: 'unhideGroup', label: `Unhide ${g.name}`, icon: 'eye' as const }] : []),
          { id: 'sep', label: '', separator: true },
          { id: 'delete', label: 'Delete…', icon: 'dismiss', danger: true },
        ];
      }
      return [
        { id: 'rename', label: 'Rename…', icon: 'edit', disabled: payment },
        ...(payment ? [] : [{ id: 'addSibling', label: `Add a category to ${g?.name ?? 'this group'}…`, icon: 'add' as const }]),
        { id: 'sep1', label: '', separator: true },
        { id: 'up', label: 'Move up', icon: 'chevronUp', disabled: stepCategory(plan, c.id, -1) === null },
        { id: 'down', label: 'Move down', icon: 'chevronDown', disabled: stepCategory(plan, c.id, 1) === null },
        { id: 'sep2', label: '', separator: true },
        { id: 'hide', label: 'Hide', icon: 'eyeOff', disabled: payment },
        { id: 'delete', label: 'Delete…', icon: 'dismiss', danger: true, disabled: payment },
      ];
    }
    const g = group(rowId);
    if (!g || g.systemKind !== undefined) return [];
    return [
      { id: 'renameGroup', label: 'Rename…', icon: 'edit' },
      { id: 'addCategory', label: 'Add a category…', icon: 'add' },
      { id: 'sep1', label: '', separator: true },
      { id: 'groupUp', label: 'Move group up', icon: 'chevronUp', disabled: stepGroup(plan, g.id, -1) === null },
      { id: 'groupDown', label: 'Move group down', icon: 'chevronDown', disabled: stepGroup(plan, g.id, 1) === null },
      { id: 'sep2', label: '', separator: true },
      { id: 'hideGroup', label: 'Hide group', icon: 'eyeOff' },
      { id: 'deleteGroup', label: 'Delete group…', icon: 'dismiss', danger: true },
    ];
  };

  const onMenu = (rowId: string, item: string, anchor: Rect): void => {
    const c = category(rowId);
    const g = c ? group(c.groupId) : group(rowId);
    switch (item) {
      case 'rename':
        if (c) setEditor({ kind: 'renameCategory', id: c.id, anchor });
        break;
      case 'addSibling':
        if (c) setEditor({ kind: 'addCategory', groupId: c.groupId, anchor });
        break;
      case 'up':
      case 'down':
        if (c) arrange(stepCategory(plan, c.id, item === 'up' ? -1 : 1), c.name);
        break;
      case 'hide':
      case 'unhide':
        if (c) hideCategory(c.id, item === 'hide');
        break;
      case 'unhideGroup':
        if (g) hideGroup(g.id, false);
        break;
      case 'delete':
        if (c) setEditor({ kind: 'delete', target: { kind: 'category', id: c.id } });
        break;
      case 'renameGroup':
        if (g) setEditor({ kind: 'renameGroup', id: g.id, anchor });
        break;
      case 'addCategory':
        if (g) setEditor({ kind: 'addCategory', groupId: g.id, anchor });
        break;
      case 'groupUp':
      case 'groupDown':
        if (g) reorder(stepGroup(plan, g.id, item === 'groupUp' ? -1 : 1), g.name);
        break;
      case 'hideGroup':
        if (g) hideGroup(g.id, true);
        break;
      case 'deleteGroup':
        if (g) setEditor({ kind: 'delete', target: { kind: 'group', id: g.id } });
        break;
    }
  };

  // ---- entry points --------------------------------------------------------------------------------

  const openMenu = (rowId: string, point: { x: number; y: number }): void => {
    if (menuItems(rowId).length === 0) return;
    setEditor({ kind: 'menu', rowId, at: { top: point.y, left: point.x, width: 0, height: 0 }, restore: rememberFocus() });
  };
  /** Clicking a name: rename (categories and user groups). */
  const openRename = (rowId: string, anchor: Rect): void => {
    const c = category(rowId);
    if (c) {
      if (c.creditCardAccountId === undefined) setEditor({ kind: 'renameCategory', id: c.id, anchor });
      return;
    }
    const g = group(rowId);
    if (g?.systemKind === undefined && g) setEditor({ kind: 'renameGroup', id: g.id, anchor });
  };
  const openAddGroup = (anchor: Rect): void => {
    setEditor({ kind: 'addGroup', anchor });
  };
  const openAddCategory = (groupId: Id, anchor: Rect): void => {
    setEditor({ kind: 'addCategory', groupId, anchor });
  };
  const moveCategory = (id: Id, drop: CategoryDrop): void => {
    arrange(dropCategory(plan, id, drop), category(id)?.name ?? 'category');
  };
  const moveGroup = (id: Id, target: Id, position: 'before' | 'after'): void => {
    reorder(dropGroup(plan, id, target, position), group(id)?.name ?? 'group');
  };

  // ---- rendering -----------------------------------------------------------------------------------

  let element: ReactNode = null;
  if (editor?.kind === 'menu') {
    const items = menuItems(editor.rowId);
    const done = (): void => {
      editor.restore();
      close();
    };
    element = (
      <Popover open onClose={done} anchor={editor.at} role="presentation">
        <MenuList
          items={items}
          label={category(editor.rowId)?.name ?? group(editor.rowId)?.name ?? 'Row'}
          onClose={done}
          onSelect={(id) => {
            onMenu(editor.rowId, id, editor.at);
          }}
        />
      </Popover>
    );
  } else if (editor?.kind === 'addGroup') {
    element = (
      <NamePopover
        anchor={editor.anchor}
        title="Add a category group"
        label="New group name"
        initial=""
        submitLabel="OK"
        onClose={close}
        onSubmit={(name) => {
          const created: { id: Id | null } = { id: null };
          actions.run((p, ctx) => {
            const cmd = createGroup(p, ctx, { name });
            created.id = cmd.groupId;
            return cmd;
          });
          if (created.id !== null) onCreated(created.id, created.id);
        }}
      />
    );
  } else if (editor?.kind === 'addCategory') {
    const gid = editor.groupId;
    element = (
      <NamePopover
        anchor={editor.anchor}
        title={`Add a category to ${group(gid)?.name ?? 'the group'}`}
        label="New category name"
        initial=""
        submitLabel="OK"
        onClose={close}
        onSubmit={(name) => {
          const created: { id: Id | null } = { id: null };
          actions.run((p, ctx) => {
            const cmd = createCategory(p, ctx, { groupId: gid, name });
            created.id = cmd.categoryId;
            return cmd;
          });
          if (created.id !== null) onCreated(created.id, gid);
        }}
      />
    );
  } else if (editor?.kind === 'renameCategory') {
    const c = category(editor.id);
    if (c) {
      element = (
        <NamePopover
          anchor={editor.anchor}
          title={`Rename ${c.name}`}
          label="Category name"
          initial={c.name}
          submitLabel="OK"
          onClose={close}
          onSubmit={(name) => {
            actions.run((p, ctx) => renameCategory(p, ctx, { categoryId: c.id, name }));
          }}
          actions={[
            { id: 'hide', label: 'Hide', icon: 'eyeOff' },
            { id: 'delete', label: 'Delete', icon: 'dismiss', danger: true },
          ]}
          onAction={(id) => {
            if (id === 'hide') hideCategory(c.id, true);
            else setEditor({ kind: 'delete', target: { kind: 'category', id: c.id } });
          }}
        />
      );
    }
  } else if (editor?.kind === 'renameGroup') {
    const g = group(editor.id);
    if (g) {
      element = (
        <NamePopover
          anchor={editor.anchor}
          title={`Rename ${g.name}`}
          label="Group name"
          initial={g.name}
          submitLabel="OK"
          onClose={close}
          onSubmit={(name) => {
            actions.run((p, ctx) => renameGroup(p, ctx, { groupId: g.id, name }));
          }}
          actions={[
            { id: 'hide', label: 'Hide', icon: 'eyeOff' },
            { id: 'delete', label: 'Delete', icon: 'dismiss', danger: true },
          ]}
          onAction={(id) => {
            if (id === 'hide') hideGroup(g.id, true);
            else setEditor({ kind: 'delete', target: { kind: 'group', id: g.id } });
          }}
        />
      );
    }
  } else if (editor?.kind === 'delete') {
    const target = editor.target;
    const name = target.kind === 'category' ? (category(target.id)?.name ?? '') : (group(target.id)?.name ?? '');
    element = (
      <DeleteCategoryDialog
        plan={plan}
        month={month}
        today={today}
        target={target}
        onClose={close}
        onDelete={(reassignTo) => {
          const to = reassignTo === undefined ? {} : { reassignTo };
          const moved = reassignTo === undefined ? '' : ` Its history moved to ${quoted(category(reassignTo)?.name ?? '')}.`;
          if (target.kind === 'category') actions.run((p, ctx) => deleteCategory(p, ctx, { categoryId: target.id, ...to }), { announce: `Deleted ${quoted(name)}.${moved}` });
          else actions.run((p, ctx) => deleteGroup(p, ctx, { groupId: target.id, ...to }), { announce: `Deleted the ${quoted(name)} group.${moved}` });
        }}
      />
    );
  }

  return { element, openMenu, openRename, openAddGroup, openAddCategory, moveCategory, moveGroup, hasMenu: (rowId: string) => menuItems(rowId).length > 0 };
}
