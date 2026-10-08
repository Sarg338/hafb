import { useState } from 'react';
import { IconButton } from '../../ui/Button.tsx';
import { ContextMenu, MenuButton, MenuList, type MenuItem } from '../../ui/Menu.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';
import styles from './overlays.module.css';

const ASSIGN_ITEMS: MenuItem[] = [
  { id: 'underfunded', label: 'Assign Underfunded' },
  { id: 'last', label: 'Assign Last Month' },
  { id: 'avg', label: 'Assign Average Spent' },
  { id: 'sep', label: '', separator: true },
  { id: 'move', label: 'Move money…', icon: 'transfer' },
];

const ROW_ITEMS: MenuItem[] = [
  { id: 'edit', label: 'Edit', icon: 'edit', shortcut: 'Enter' },
  { id: 'dup', label: 'Duplicate', shortcut: 'Shift+D' },
  { id: 'flag', label: 'Flag', icon: 'flag' },
  { id: 'approve', label: 'Approve', icon: 'checkmark', disabled: true },
  { id: 'sep', label: '', separator: true },
  { id: 'delete', label: 'Delete', icon: 'dismiss', shortcut: 'Del', danger: true },
];

function Menus() {
  const [last, setLast] = useState('none yet');
  const [view, setView] = useState({ bars: true, hide: false });
  const viewItems: MenuItem[] = [
    { id: 'bars', label: 'Show progress bars', checked: view.bars },
    { id: 'hide', label: 'Hide amounts', checked: view.hide },
    { id: 'sep', label: '', separator: true },
    { id: 'reset', label: 'Plan Reset…' },
  ];
  const pick = (id: string): void => {
    setLast(id);
  };

  return (
    <>
      <Specimen label="Menu button">
        <MenuButton label="Assign" variant="primary" items={ASSIGN_ITEMS} onSelect={pick} />
        <MenuButton label="View" variant="toolbar" icon="eye" items={viewItems} onSelect={(id) => {
          if (id === 'bars' || id === 'hide') setView((v) => ({ ...v, [id]: !v[id] }));
          pick(id);
        }} />
        <MenuButton
          label="Plan options"
          items={viewItems}
          onSelect={pick}
          placement="bottom-end"
          trigger={(props) => <IconButton {...props} icon="more" iconSize={20} label="Plan options" />}
        />
        <span className={styles.note}>Last chosen: {last}</span>
      </Specimen>
      <Specimen label="Context menu">
        <ContextMenu items={ROW_ITEMS} onSelect={pick} label="Transaction actions">
          <div className={styles.row} tabIndex={0} aria-label="Fresh Market, Groceries, 162.58 outflow. Right-click or Shift+F10 for actions.">
            <span>10/10/2026</span>
            <span>Fresh Market</span>
            <span className={styles.note}>Groceries</span>
            <span className={styles.money}>$162.58</span>
          </div>
        </ContextMenu>
        <span className={styles.note}>Right-click the row, or focus it and press Shift+F10.</span>
      </Specimen>
      <Specimen label="Menu list (static)">
        <div className={styles.surface}>
          <MenuList items={ROW_ITEMS} onSelect={pick} onClose={() => undefined} label="Transaction actions (specimen)" initialFocus="first" autoFocus={false} />
        </div>
        <div className={styles.surface}>
          <MenuList items={viewItems} onSelect={pick} onClose={() => undefined} label="View options (specimen)" initialFocus="last" autoFocus={false} />
        </div>
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'menus', title: 'Menus', order: 50, Component: Menus };
