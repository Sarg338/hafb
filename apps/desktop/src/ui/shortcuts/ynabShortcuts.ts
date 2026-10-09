// YNAB's keyboard shortcuts that HAFB supports (CLAUDE.md §6.15: "every published YNAB shortcut").
// Source: support.ynab.com "Keyboard Shortcuts" (fetched 2026-10-08) and YNAB's in-app Keyboard
// Shortcuts dialog (2026-10-09), so every entry is verified; `extra` marks HAFB additions and the
// Windows conventions YNAB doesn't publish. docs/shortcuts.md is this list (a test keeps it so),
// and every entry is either registered (a test scans the source) or covered by a component test.

export interface PlannedShortcut {
  /** Matches a registered ShortcutDef id once it is implemented. */
  id: string;
  keys: string;
  description: string;
  group: 'General' | 'Navigation' | 'Plan' | 'Register' | 'Date fields';
  /** Where it lands. */
  sprint: string;
  /** Handled inside a component (fields, menus, the editable grid) rather than the registry. */
  inComponent?: boolean;
  /** For in-component keys: the test file that covers them (repo-relative). */
  coveredBy?: string;
  /** Confirmed against YNAB's published list. */
  verified: boolean;
  /** An HAFB addition, not in YNAB's list. */
  extra?: boolean;
}

const Y = true;

export const YNAB_SHORTCUTS: readonly PlannedShortcut[] = [
  // Universal actions
  { id: 'general.shortcuts', keys: '?', description: 'Show keyboard shortcuts', group: 'General', sprint: 'S3.5', verified: Y },
  { id: 'nav.toggleSidebarYnab', keys: '>', description: 'Expand or collapse the sidebar (Shift+.)', group: 'Navigation', sprint: 'S4.1', verified: Y },
  { id: 'general.selectAll', keys: 'Ctrl+A', description: 'Select all', group: 'General', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'general.deselectAll', keys: 'Esc', description: 'Deselect all', group: 'General', sprint: 'S4.1', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/selection.test.ts', verified: Y },
  { id: 'general.undo', keys: 'Ctrl+Z', description: 'Undo', group: 'General', sprint: 'S3.5', verified: Y },
  { id: 'general.redo', keys: 'Ctrl+Shift+Z', description: 'Redo (Ctrl+Y works too)', group: 'General', sprint: 'S3.5', verified: Y },
  { id: 'general.commit', keys: 'Enter', description: 'Commit', group: 'General', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'general.cancel', keys: 'Esc', description: 'Cancel', group: 'General', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'general.nextField', keys: 'Tab', description: 'Move to the next field or button', group: 'General', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'general.nextRow', keys: 'ArrowDown', description: 'Move to the next row', group: 'General', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'general.math', keys: '+', description: 'Math in amounts: + − × ÷ after the digits', group: 'General', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/amountMath.test.ts', verified: Y },

  // Plan
  { id: 'plan.snooze', keys: 'Shift+Z', description: 'Snooze or unsnooze the target', group: 'Plan', sprint: 'S5.2', verified: Y },
  { id: 'plan.collapseAll', keys: 'Ctrl+ArrowUp', description: 'Collapse all category groups', group: 'Plan', sprint: 'S4.1', verified: Y },
  { id: 'plan.expandAll', keys: 'Ctrl+ArrowDown', description: 'Expand all category groups', group: 'Plan', sprint: 'S4.1', verified: Y },
  { id: 'plan.moveRows', keys: 'ArrowUp', description: 'Move between plan rows (Up/Down)', group: 'Plan', sprint: 'S4.1', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'plan.selectMany', keys: 'Shift+ArrowDown', description: 'Select multiple categories (Shift+Up/Down)', group: 'Plan', sprint: 'S4.1', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'plan.commit', keys: 'Enter', description: 'Commit the Assigned amount', group: 'Plan', sprint: 'S4.1', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },

  // Account (register)
  { id: 'register.add', keys: 'Shift+N', description: 'Add a new transaction', group: 'Register', sprint: 'S4.5', verified: Y },
  { id: 'register.approve', keys: 'A', description: 'Approve', group: 'Register', sprint: 'S4.6', verified: Y },
  { id: 'register.approveAll', keys: 'Shift+L', description: 'Approve all transactions', group: 'Register', sprint: 'S4.6', verified: Y },
  { id: 'register.reject', keys: 'Shift+R', description: 'Reject', group: 'Register', sprint: 'S6.5', verified: Y },
  { id: 'register.categorize', keys: 'K', description: 'Categorize', group: 'Register', sprint: 'S4.6', verified: Y },
  { id: 'register.split', keys: 'S', description: 'Split', group: 'Register', sprint: 'S4.6', verified: Y },
  { id: 'register.enterNow', keys: 'E', description: 'Enter a scheduled transaction now', group: 'Register', sprint: 'S5.4', verified: Y },
  { id: 'register.match', keys: 'M', description: 'Match', group: 'Register', sprint: 'S6.5', verified: Y },
  { id: 'register.unmatch', keys: 'Shift+U', description: 'Unmatch', group: 'Register', sprint: 'S6.5', verified: Y },
  { id: 'register.toggleCleared', keys: 'C', description: 'Toggle cleared for the selection', group: 'Register', sprint: 'S4.5', verified: Y },
  { id: 'register.duplicate', keys: 'Shift+D', description: 'Duplicate', group: 'Register', sprint: 'S4.6', verified: Y },
  { id: 'register.flag', keys: 'Shift+F', description: 'Flag (then 0–6)', group: 'Register', sprint: 'S4.5', verified: Y },
  { id: 'register.repeat', keys: 'Shift+T', description: 'Make repeating', group: 'Register', sprint: 'S5.4', verified: Y },
  { id: 'register.delete', keys: 'Delete', description: 'Delete', group: 'Register', sprint: 'S4.6', verified: Y },
  { id: 'register.reconcile', keys: 'Shift+E', description: 'Reconcile', group: 'Register', sprint: 'S5.6', verified: Y },
  { id: 'register.search', keys: 'Ctrl+Shift+F', description: 'Focus the search bar', group: 'Register', sprint: 'S4.6', verified: Y },
  { id: 'register.prevField', keys: 'Shift+Tab', description: 'Previous transaction field', group: 'Register', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: Y },
  { id: 'register.saveAndAdd', keys: 'Ctrl+Enter', description: 'Save and add another', group: 'Register', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: false, extra: true },
  { id: 'register.contextMenu', keys: 'Shift+F10', description: 'Actions for the selection', group: 'Register', sprint: 'S3.4', inComponent: true, coveredBy: 'apps/desktop/src/ui/grid/keys.test.ts', verified: false, extra: true },

  // Date picker
  { id: 'date.nextDay', keys: '+', description: 'One day forward', group: 'Date fields', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: Y },
  { id: 'date.previousDay', keys: '-', description: 'One day back', group: 'Date fields', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: Y },
  { id: 'date.today', keys: 'T', description: 'Today', group: 'Date fields', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: Y },
  { id: 'date.monthStart', keys: 'M', description: 'First day of the month', group: 'Date fields', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: Y },
  { id: 'date.monthEnd', keys: 'Shift+M', description: 'Last day of the month', group: 'Date fields', sprint: 'S4.1', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: Y },
  { id: 'date.yearStart', keys: 'Y', description: 'First day of the year', group: 'Date fields', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: Y },
  { id: 'date.yearEnd', keys: 'Shift+Y', description: 'Last day of the year', group: 'Date fields', sprint: 'S4.1', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: Y },
  { id: 'date.nextMonth', keys: 'PageDown', description: 'Same day next month', group: 'Date fields', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: false, extra: true },
  { id: 'date.previousMonth', keys: 'PageUp', description: 'Same day last month', group: 'Date fields', sprint: 'S3.2', inComponent: true, coveredBy: 'packages/shared/test/dateInput.test.ts', verified: false, extra: true },

  // Windows conventions and HAFB extras (S7.3)
  { id: 'general.help', keys: 'F1', description: 'Show keyboard shortcuts', group: 'General', sprint: 'S7.3', verified: false, extra: true },
  { id: 'file.new', keys: 'Ctrl+N', description: 'New plan', group: 'General', sprint: 'S7.3', verified: false, extra: true },
  { id: 'file.open', keys: 'Ctrl+O', description: 'Open plan', group: 'General', sprint: 'S7.3', verified: false, extra: true },
  { id: 'app.preferences', keys: 'Ctrl+,', description: 'Preferences', group: 'General', sprint: 'S7.3', verified: false, extra: true },
  { id: 'view.textLarger', keys: 'Ctrl+=', description: 'Larger text', group: 'General', sprint: 'S7.1', verified: false, extra: true },
  { id: 'view.textSmaller', keys: 'Ctrl+-', description: 'Smaller text', group: 'General', sprint: 'S7.1', verified: false, extra: true },
  { id: 'view.textReset', keys: 'Ctrl+0', description: 'Text at 100%', group: 'General', sprint: 'S7.1', verified: false, extra: true },
  { id: 'nav.plan', keys: 'G then P', description: 'Go to Plan', group: 'Navigation', sprint: 'S3.5', verified: false, extra: true },
  { id: 'nav.reflect', keys: 'G then R', description: 'Go to Reflect', group: 'Navigation', sprint: 'S3.5', verified: false, extra: true },
  { id: 'nav.accounts', keys: 'G then A', description: 'Go to All Accounts', group: 'Navigation', sprint: 'S3.5', verified: false, extra: true },
  { id: 'nav.toggleSidebar', keys: 'Ctrl+B', description: 'Collapse or expand the sidebar', group: 'Navigation', sprint: 'S3.5', verified: false, extra: true },
];
