// YNAB's keyboard shortcuts that HAFB intends to support (CLAUDE.md §6.15: "every published YNAB
// shortcut"). The shortcut overlay lists these alongside what is registered today, so the gap is
// visible and honest. `verified: false` entries come from memory of YNAB's help pages and must be
// checked against YNAB before their sprint (tracked in docs/ynab-parity.md).

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
  /** Confirmed against YNAB (trial, help pages, or CLAUDE.md's parity research). */
  verified: boolean;
}

export const YNAB_SHORTCUTS: readonly PlannedShortcut[] = [
  // General
  { id: 'general.undo', keys: 'Ctrl+Z', description: 'Undo', group: 'General', sprint: 'S3.5', verified: true },
  { id: 'general.redo', keys: 'Ctrl+Shift+Z', description: 'Redo (Ctrl+Y works too)', group: 'General', sprint: 'S3.5', verified: true },
  { id: 'general.shortcuts', keys: '?', description: 'Show keyboard shortcuts', group: 'General', sprint: 'S3.5', verified: false },

  // Register (CLAUDE.md §6.4)
  { id: 'register.save', keys: 'Enter', description: 'Save the transaction being edited', group: 'Register', sprint: 'S3.4', inComponent: true, verified: true },
  { id: 'register.cancel', keys: 'Esc', description: 'Cancel editing', group: 'Register', sprint: 'S3.4', inComponent: true, verified: true },
  { id: 'register.nextField', keys: 'Tab', description: 'Next field', group: 'Register', sprint: 'S3.4', inComponent: true, verified: true },
  { id: 'register.saveAndAdd', keys: 'Ctrl+Enter', description: 'Save and add another', group: 'Register', sprint: 'S3.4', inComponent: true, verified: true },
  { id: 'register.duplicate', keys: 'Shift+D', description: 'Duplicate the selected transactions', group: 'Register', sprint: 'Phase 4', verified: true },
  { id: 'register.reconcile', keys: 'Shift+E', description: 'Reconcile the account', group: 'Register', sprint: 'Phase 5', verified: true },
  { id: 'register.makeRepeating', keys: 'Shift+T', description: 'Make the transaction repeat', group: 'Register', sprint: 'Phase 5', verified: true },
  { id: 'register.search', keys: 'Ctrl+F', description: 'Search transactions', group: 'Register', sprint: 'Phase 4', verified: false },
  { id: 'register.contextMenu', keys: 'Shift+F10', description: 'Open the actions menu for the selection', group: 'Register', sprint: 'S3.2', inComponent: true, verified: false },

  // Plan
  { id: 'plan.moveDown', keys: 'ArrowDown', description: 'Next category', group: 'Plan', sprint: 'Phase 4', inComponent: true, verified: false },
  { id: 'plan.moveUp', keys: 'ArrowUp', description: 'Previous category', group: 'Plan', sprint: 'Phase 4', inComponent: true, verified: false },
  { id: 'plan.editAssigned', keys: 'Enter', description: 'Edit the Assigned amount', group: 'Plan', sprint: 'Phase 4', inComponent: true, verified: false },

  // Date fields (implemented in DateInput, S3.2; Quicken-style set until YNAB's is verified)
  { id: 'date.nextDay', keys: '+', description: 'Next day', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.previousDay', keys: '-', description: 'Previous day', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.today', keys: 'T', description: 'Today', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.monthStart', keys: 'M', description: 'First day of the month', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.monthEnd', keys: 'H', description: 'Last day of the month', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.yearStart', keys: 'Y', description: 'First day of the year', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.yearEnd', keys: 'R', description: 'Last day of the year', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.nextMonth', keys: 'PageDown', description: 'Same day next month', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
  { id: 'date.previousMonth', keys: 'PageUp', description: 'Same day last month', group: 'Date fields', sprint: 'S3.2', inComponent: true, verified: false },
];

/** Sprints already delivered: in-component keys from these are live today. */
const DELIVERED = new Set(['S3.2', 'S3.4', 'S3.5']);

export function isDelivered(p: PlannedShortcut): boolean {
  return DELIVERED.has(p.sprint);
}
