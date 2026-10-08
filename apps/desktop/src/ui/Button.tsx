import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';
import { cx } from './cx.ts';
import { Icon, type IconName } from './Icon.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'toolbar' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: 'medium' | 'small';
  icon?: IconName;
  /** Trailing icon, e.g. a chevron on a menu button. */
  iconEnd?: IconName;
  full?: boolean;
  type?: 'button' | 'submit';
  children?: ReactNode;
}

/** A text button. Variants are the approved S3.1 controls (DESIGN.md). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'medium', icon, iconEnd, full = false, type = 'button', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.button, styles[variant], size === 'small' && styles.small, full && styles.full, className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconEnd && <Icon name={iconEnd} />}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  icon: IconName;
  /** Accessible name; also the tooltip text. Required: an icon alone has no name. */
  label: string;
  /** Keyboard shortcut shown with the tooltip, e.g. "Ctrl+Z". */
  shortcut?: string;
  size?: 'medium' | 'small';
  iconSize?: 16 | 20;
}

/** A square icon-only button with a required accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, size = 'medium', iconSize = 16, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx(styles.icon, size === 'small' && styles.smallIcon, className)}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
});
