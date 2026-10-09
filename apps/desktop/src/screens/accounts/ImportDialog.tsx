// Import Transactions (S6.5), as YNAB's pop-up (file import guide, 2026): the account, the files,
// CSV column mapping with "No header row", "Swap Inflow and Outflow" and "Remember setting for
// this account"; QFX/OFX/QIF's "Import Memos", "Swap Payee and Memo", "Swap Inflow and Outflow";
// the option to include transactions before the account's start; then a preview of every row:
// new, matched to one you entered or scheduled, or skipped and why. One undo step.
import { useMemo, useState } from 'react';
import type { CsvColumn, CsvMapping, Id, SkipReason } from '@hafb/engine';
import { formatDate, type ISODate } from '@hafb/shared';
import { applyChanges, importBankRows, mergeChangeSets, previewImport, saveImportProfile, type PlanData } from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import type { PickedFile } from '../../shell/bankFiles.ts';
import { Button } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { moneyFormat } from '../plan/planModel.ts';
import { moneyText } from '../shared/money.ts';
import { COLUMN_OPTIONS, DATE_ORDERS, DEFAULT_OPTIONS, initialMapping, loadFile, profileOf, rowsFor, type ImportOptions } from './importModel.ts';
import styles from './ImportDialog.module.css';

export const SKIP_TEXT: Record<SkipReason, string> = {
  duplicate: 'Already imported',
  deleted: 'Deleted before; won’t import again',
  rejected: 'Rejected before; won’t import again',
  reconciled: 'More than 3 days before the last reconciliation',
  beforeStart: 'Before the account’s start',
};

export interface ImportDialogProps {
  plan: PlanData;
  /** The register's account, or null on All Accounts. */
  accountId: Id | null;
  files: readonly PickedFile[];
  today: ISODate;
  actions: Actions;
  onClose: () => void;
}

export function ImportDialog({ plan, accountId, files, actions, onClose }: ImportDialogProps) {
  const fmt = moneyFormat(plan);
  const money = moneyText(fmt, false);
  const decimals = plan.settings.currencyDecimals;
  const accounts = plan.accounts.filter((a) => a.deletedAt === undefined && a.closed !== true).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const [account, setAccount] = useState<Id>(accountId ?? accounts.find((a) => a.onBudget)?.id ?? accounts[0]?.id ?? '');
  const loaded = useMemo(() => files.map((f) => loadFile(f.name, f.text, decimals)), [files, decimals]);
  const profileFor = (id: Id) => plan.importProfiles.find((p) => p.accountId === id)?.profile;
  const [options, setOptions] = useState<ImportOptions>(() => ({ ...DEFAULT_OPTIONS, csv: initialMapping(loaded, profileFor(account)) }));
  const csvFile = loaded.find((f) => f.csv)?.csv;
  const hasOther = loaded.some((f) => f.rows !== undefined);
  const { rows, errors } = useMemo(() => rowsFor(loaded, options, decimals), [loaded, options, decimals]);
  const preview = useMemo(() => (account === '' ? [] : previewImport(plan, { accountId: account, rows, includeBeforeStart: options.includeBeforeStart })), [plan, account, rows, options.includeBeforeStart]);
  const anyBeforeStart = useMemo(() => (account === '' ? false : previewImport(plan, { accountId: account, rows, includeBeforeStart: false }).some((p) => p.decision.kind === 'skip' && p.decision.reason === 'beforeStart')), [plan, account, rows]);
  const counts = { new: 0, match: 0, skip: 0 };
  for (const p of preview) counts[p.decision.kind === 'matchScheduled' ? 'match' : p.decision.kind] += 1;
  const accountName = accounts.find((a) => a.id === account)?.name ?? '';
  const nameOf = (id: Id) => plan.payees.find((p) => p.id === id)?.name ?? '';
  const txById = useMemo(() => new Map(plan.transactions.map((t) => [t.id, t])), [plan.transactions]);

  const setCsv = (patch: Partial<CsvMapping>): void => {
    if (options.csv) setOptions({ ...options, csv: { ...options.csv, ...patch } });
  };
  const setColumn = (i: number, role: CsvColumn): void => {
    if (!options.csv) return;
    // A role (other than "don't import") belongs to one column; "Amount" replaces Outflow/Inflow.
    const columns = options.csv.columns.map((c, j) => {
      if (j === i) return role;
      if (role !== 'skip' && c === role) return 'skip';
      if (role === 'amount' && (c === 'outflow' || c === 'inflow')) return 'skip';
      if ((role === 'outflow' || role === 'inflow') && c === 'amount') return 'skip';
      return c;
    });
    setCsv({ columns });
  };
  const chooseAccount = (id: Id): void => {
    setAccount(id);
    setOptions({ ...options, csv: initialMapping(loaded, profileFor(id)) ?? options.csv });
  };
  const submit = (): void => {
    const csv = options.csv;
    onClose();
    actions.run((p, ctx) => {
      const cmd = importBankRows(p, ctx, { accountId: account, rows, includeBeforeStart: options.includeBeforeStart });
      if (!csv || !csvFile || !options.rememberCsv) return cmd;
      const next = applyChanges(p, cmd.changes).plan;
      const save = saveImportProfile(next, ctx, { accountId: account, profile: profileOf(csv) });
      return { label: cmd.label, changes: mergeChangeSets(cmd.changes, save.changes) };
    });
    const parts = [`${String(counts.new)} new`, counts.match > 0 ? `${String(counts.match)} matched` : '', counts.skip > 0 ? `${String(counts.skip)} skipped` : ''].filter(Boolean);
    actions.notify(`Imported into ${accountName}: ${parts.join(', ')}.`);
  };

  const sample = csvFile ? csvFile.rows.slice(0, options.csv?.header === true ? 5 : 4) : [];
  return (
    <Dialog
      open
      size="large"
      title="Import Transactions"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={account === '' || counts.new + counts.match === 0} onClick={submit}>
            {counts.new + counts.match === 0 ? 'Nothing to Import' : `Import ${String(counts.new + counts.match)}`}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.top}>
          <div className={styles.field}>
            <span className={styles.label}>Import into</span>
            <Combobox label="Account" groups={[{ id: 'accounts', label: 'Accounts', options: accounts.map((a) => ({ id: a.id, label: a.name })) }]} value={account} onChange={chooseAccount} />
          </div>
          <ul className={styles.files} aria-label="Files">
            {loaded.map((f) => (
              <li key={f.name}>
                <strong>{f.name}</strong>
                <span className={f.error === undefined ? styles.muted : styles.error}>
                  {f.error ?? (f.csv ? `CSV, ${String(Math.max(0, f.csv.rows.length - (options.csv?.header === true ? 1 : 0)))} rows` : `${f.kind.toUpperCase()}, ${String(f.rows?.length ?? 0)} transactions${f.bankAccount ? ` · account …${f.bankAccount.slice(-4)}` : ''}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {csvFile && options.csv && (
          <section className={styles.section} aria-label="CSV columns">
            <div className={styles.tableWrap}>
              <table className={styles.mapTable}>
                <thead>
                  <tr>
                    {options.csv.columns.map((c, i) => (
                      <th key={i}>
                        <Combobox
                          label={`Column ${String(i + 1)}`}
                          groups={[{ id: 'roles', label: 'Columns', options: COLUMN_OPTIONS.map((o) => ({ id: o.id, label: o.label })) }]}
                          value={c}
                          onChange={(id) => {
                            const role = COLUMN_OPTIONS.find((o) => o.id === id)?.id;
                            if (role) setColumn(i, role);
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sample.map((r, ri) => (
                    <tr key={ri} className={options.csv?.header === true && ri === 0 ? styles.headerRow : undefined}>
                      {options.csv?.columns.map((_, ci) => (
                        <td key={ci}>{r[ci] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.options}>
              <Checkbox label="No header row" checked={!options.csv.header} onChange={(v) => { setCsv({ header: !v }); }} />
              <Checkbox label="Swap Inflow and Outflow" checked={options.csv.swap} onChange={(v) => { setCsv({ swap: v }); }} />
              <Checkbox label="Remember setting for this account" checked={options.rememberCsv} onChange={(v) => { setOptions({ ...options, rememberCsv: v }); }} />
              <div className={styles.inline}>
                <span className={styles.label}>Dates</span>
                <Combobox label="Date format" groups={[{ id: 'd', label: 'Date format', options: DATE_ORDERS.map((o) => ({ id: o.id, label: o.label })) }]} value={options.csv.dateOrder} onChange={(id) => { const o = DATE_ORDERS.find((x) => x.id === id)?.id; if (o) setCsv({ dateOrder: o }); }} />
              </div>
              <div className={styles.inline}>
                <span className={styles.label}>Decimal mark</span>
                <Combobox
                  label="Decimal mark"
                  groups={[{ id: 'n', label: 'Decimal mark', options: [{ id: '.', label: 'Point (1,234.56)' }, { id: ',', label: 'Comma (1.234,56)' }] }]}
                  value={options.csv.decimalSeparator}
                  onChange={(id) => { setCsv({ decimalSeparator: id === ',' ? ',' : '.' }); }}
                />
              </div>
            </div>
          </section>
        )}

        {hasOther && (
          <section className={styles.options} aria-label="File options">
            <Checkbox label="Import Memos" checked={options.importMemos} onChange={(v) => { setOptions({ ...options, importMemos: v }); }} />
            <Checkbox label="Swap Payee and Memo" checked={options.swapPayeeMemo} onChange={(v) => { setOptions({ ...options, swapPayeeMemo: v }); }} />
            <Checkbox label="Swap Inflow and Outflow" checked={options.swapAmounts} onChange={(v) => { setOptions({ ...options, swapAmounts: v }); }} />
          </section>
        )}
        {anyBeforeStart && (
          <Checkbox label="Import transactions dated before this account’s start" checked={options.includeBeforeStart} onChange={(v) => { setOptions({ ...options, includeBeforeStart: v }); }} />
        )}

        {errors.length > 0 && (
          <p className={styles.error} role="status">
            {errors.length === 1 ? 'One row couldn’t be read' : `${String(errors.length)} rows couldn’t be read`}: {errors.slice(0, 3).map((e) => `line ${String(e.line)} (${e.message})`).join(', ')}
            {errors.length > 3 ? '…' : '.'}
          </p>
        )}

        <section className={styles.section} aria-label="Preview">
          <p className={styles.summary}>
            <strong>{counts.new}</strong> new · <strong>{counts.match}</strong> matched to transactions you entered · <strong>{counts.skip}</strong> skipped
          </p>
          <div className={styles.previewWrap}>
            <table className={styles.preview}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Memo</th>
                  <th className={styles.num}>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => {
                  const d = p.decision;
                  const matched = d.kind === 'match' ? txById.get(d.transactionId) : undefined;
                  return (
                    <tr key={`${p.importId}:${String(i)}`} data-status={d.kind}>
                      <td>{formatDate(p.row.date, plan.settings.dateFormat)}</td>
                      <td title={p.row.payee === p.payee ? undefined : `From the bank: ${p.row.payee}`}>{p.payee}</td>
                      <td>{p.row.memo}</td>
                      <td className={styles.num}>{money(p.row.amount)}</td>
                      <td>
                        {d.kind === 'new' && 'New'}
                        {d.kind === 'match' && `Matches ${matched?.payeeId ? nameOf(matched.payeeId) : 'a transaction'} on ${matched ? formatDate(matched.date, plan.settings.dateFormat) : ''}`}
                        {d.kind === 'matchScheduled' && `Matches the scheduled transaction on ${formatDate(d.date, plan.settings.dateFormat)}`}
                        {d.kind === 'skip' && SKIP_TEXT[d.reason]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
