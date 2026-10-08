// Menu button, menu list and context menu (WAI-ARIA APG "menu button" and "menu" patterns).
// Keyboard: Enter/Space/ArrowDown open on the first item, ArrowUp on the last; arrows, Home/End and
// typeahead move; Enter/Space activate; Escape or Tab close and return focus to the trigger.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button, type ButtonVariant } from './Button.tsx';
import { cx } from './cx.ts';
import { rememberFocus } from './focus.ts';
import { Icon, type IconName } from './Icon.tsx';
import styles from './Menu.module.css';
import { nextIndex, typeahead } from './menuModel.ts';
import { Popover } from './Popover.tsx';
import type { Placement, Rect } from './position.ts';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Shown right-aligned, e.g. "Ctrl+Z". */
  shortcut?: string;
  disabled?: boolean;
  /** Destructive action (Delete). */
  danger?: boolean;
  /** Makes the item a menuitemcheckbox. */
  checked?: boolean;
  separator?: boolean;
}

export interface MenuListProps {
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  id?: string;
  label?: string;
  labelledBy?: string;
  /** Which item is active when the list mounts. */
  initialFocus?: 'first' | 'last';
  /** Move focus into the list. Default true; false for static specimens. */
  autoFocus?: boolean;
}

/** The list inside a menu: roving focus, keyboard model, typeahead. */
export function MenuList({ items, onSelect, onClose, id, label, labelledBy, initialFocus = 'first', autoFocus = true }: MenuListProps) {
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(() => nextIndex(items, -1, initialFocus === 'first' ? 'ArrowDown' : 'ArrowUp'));
  const buffer = useRef({ text: '', at: 0 });

  const focusOnChange = useRef(autoFocus);
  useEffect(() => {
    if (active >= 0 && focusOnChange.current) refs.current[active]?.focus();
  }, [active]);

  const activate = (item: MenuItem | undefined): void => {
    if (!item || item.disabled === true || item.separator === true) return;
    onClose();
    onSelect(item.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      focusOnChange.current = true;
      setActive((i) => nextIndex(items, i, e.key));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(items[active]);
    } else if (e.key === 'Tab') {
      onClose();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const now = e.timeStamp;
      const text = now - buffer.current.at > 500 ? e.key : buffer.current.text + e.key;
      buffer.current = { text, at: now };
      setActive((i) => typeahead(items, text, i));
    }
  };

  return (
    <ul role="menu" id={id} aria-label={label} aria-labelledby={labelledBy} className={styles.menu} onKeyDown={onKeyDown}>
      {items.map((item, i) => {
        if (item.separator === true) return <li key={item.id} role="separator" className={styles.separator} />;
        const checkable = item.checked !== undefined;
        return (
          <li
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? item.checked : undefined}
            aria-disabled={item.disabled === true ? true : undefined}
            aria-keyshortcuts={item.shortcut}
            tabIndex={-1}
            data-active={i === active ? true : undefined}
            className={cx(styles.item, item.danger === true && styles.danger)}
            onClick={() => {
              activate(item);
            }}
            onPointerMove={() => {
              if (item.disabled !== true && active !== i) setActive(i);
            }}
          >
            <span className={styles.lead} aria-hidden="true">
              {checkable ? item.checked === true && <Icon name="checkmark" /> : item.icon && <Icon name={item.icon} />}
            </span>
            <span className={styles.label}>{item.label}</span>
            {item.shortcut !== undefined && <span className={styles.shortcut}>{item.shortcut}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Props a custom trigger must spread onto its button. */
export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  id: string;
}

export interface MenuButtonProps {
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
  /** Visible label of the default trigger, and the menu's accessible name. */
  label: string;
  /** Render your own trigger (e.g. an IconButton); spread the props onto it. */
  trigger?: (props: MenuTriggerProps) => ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
  placement?: Placement;
}

/** A button that opens a menu. */
export function MenuButton({ items, onSelect, label, trigger, variant = 'secondary', icon, placement = 'bottom-start' }: MenuButtonProps) {
  // State, not refs: the trigger props go through a render prop, and React must not read refs there.
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const anchor = useMemo(() => ({ current: triggerEl }), [triggerEl]);
  const [open, setOpen] = useState<false | 'first' | 'last'>(false);
  const menuId = useId();
  const buttonId = useId();

  const show = (focus: 'first' | 'last'): void => {
    setOpen(focus);
  };
  const close = (): void => {
    setOpen(false);
    triggerEl?.focus();
  };

  const props: MenuTriggerProps = {
    ref: setTriggerEl,
    id: buttonId,
    'aria-haspopup': 'menu',
    'aria-expanded': open !== false,
    'aria-controls': open !== false ? menuId : undefined,
    onClick: () => {
      if (open !== false) close();
      else show('first');
    },
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show('first');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        show('last');
      }
    },
  };

  return (
    <>
      {trigger ? (
        trigger(props)
      ) : (
        <Button {...props} variant={variant} {...(icon ? { icon } : {})} iconEnd="chevronDown">
          {label}
        </Button>
      )}
      <Popover open={open !== false} onClose={close} anchor={anchor} placement={placement} role="presentation" className={cx(styles.popover)}>
        <MenuList items={items} onSelect={onSelect} onClose={close} id={menuId} labelledBy={buttonId} initialFocus={open === false ? 'first' : open} />
      </Popover>
    </>
  );
}

export interface ContextMenuProps {
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Right-click menu for a region (a row, a card). Opens at the pointer on right-click, and at the
 * focused element on Shift+F10 or the Menu key.
 */
export function ContextMenu({ items, onSelect, label, children, className }: ContextMenuProps) {
  const [point, setPoint] = useState<Rect | null>(null);
  const restore = useRef<(() => void) | null>(null);

  const openAt = (rect: Rect): void => {
    restore.current = rememberFocus();
    setPoint(rect);
  };
  const close = (): void => {
    setPoint(null);
    restore.current?.();
  };

  return (
    <div
      className={className}
      onContextMenu={(e) => {
        e.preventDefault();
        openAt({ top: e.clientY, left: e.clientX, width: 0, height: 0 });
      }}
      onKeyDown={(e) => {
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          const target = e.target instanceof HTMLElement ? e.target : e.currentTarget;
          const r = target.getBoundingClientRect();
          openAt({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      }}
    >
      {children}
      {point && (
        <Popover open onClose={close} anchor={point} placement="bottom-start" gap={0} role="presentation" className={cx(styles.popover)}>
          <MenuList items={items} onSelect={onSelect} onClose={close} label={label} />
        </Popover>
      )}
    </div>
  );
}
