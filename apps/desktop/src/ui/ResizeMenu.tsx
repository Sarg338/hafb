// A single-pointer alternative to dragging a resize handle (WCAG 2.2 SC 2.5.7 Dragging Movements):
// clicking a handle without dragging opens Narrower / Wider / Reset width at the pointer.
import menuStyles from './Menu.module.css';
import { MenuList } from './Menu.tsx';
import { Popover } from './Popover.tsx';
import type { Rect } from './position.ts';

/** Pointer travel (px) under which a press on a handle counts as a click, not a drag. */
export const CLICK_SLOP = 3;

export function ResizeMenu({ at, label, onNarrower, onWider, onReset, onClose }: { at: Rect; label: string; onNarrower: () => void; onWider: () => void; onReset: () => void; onClose: () => void }) {
  return (
    <Popover open onClose={onClose} anchor={at} placement="bottom-start" gap={0} role="presentation" className={menuStyles.popover}>
      <MenuList
        label={label}
        items={[
          { id: 'narrower', label: 'Narrower', icon: 'chevronLeft' },
          { id: 'wider', label: 'Wider', icon: 'chevronRight' },
          { id: 'reset', label: 'Reset width' },
        ]}
        onClose={onClose}
        onSelect={(id) => {
          if (id === 'narrower') onNarrower();
          else if (id === 'wider') onWider();
          else onReset();
        }}
      />
    </Popover>
  );
}
