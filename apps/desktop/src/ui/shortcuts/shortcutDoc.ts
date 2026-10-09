// The shortcut reference (docs/shortcuts.md, S7.3), generated from the shortcut list so the two
// never drift apart. A test compares the file with this output.
import { formatKeys, parseKeys } from './registry.ts';
import { YNAB_SHORTCUTS, type PlannedShortcut } from './ynabShortcuts.ts';

const GROUPS: PlannedShortcut['group'][] = ['General', 'Navigation', 'Plan', 'Register', 'Date fields'];

const cell = (text: string): string => text.replace(/\|/g, '\\|');

export function shortcutsMarkdown(list: readonly PlannedShortcut[] = YNAB_SHORTCUTS): string {
  const lines = [
    '# Keyboard shortcuts',
    '',
    'Every shortcut YNAB publishes (its help page and in-app Keyboard Shortcuts dialog, checked 2026-10-09), plus Windows conventions and HAFB extras. Press `?` or F1 in the app for the same list. Turning shortcuts off in Preferences leaves Undo, Redo, text size and the shortcut list working.',
    '',
    '_Generated from `apps/desktop/src/ui/shortcuts/ynabShortcuts.ts`; a test keeps this file in step (`HAFB_WRITE_DOCS=1` rewrites it)._',
  ];
  for (const g of GROUPS) {
    const rows = list.filter((s) => s.group === g);
    if (rows.length === 0) continue;
    lines.push('', `## ${g}`, '', '| Keys | Action | Source |', '|---|---|---|');
    for (const s of rows) {
      const source = s.extra === true ? 'HAFB / Windows' : 'YNAB';
      lines.push(`| ${cell(formatKeys(parseKeys(s.keys)))} | ${cell(s.description)} | ${source} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}
