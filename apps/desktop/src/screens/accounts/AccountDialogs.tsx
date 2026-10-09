// Add Account and Edit Account (S4.4), shaped like YNAB's (observed in the YNAB trial, 2026-10-08):
// - Add: nickname, type (a list grouped Cash / Credit / Mortgages and Loans / Tracking), balance;
//   loans also ask for the interest rate and the monthly payment the lender requires.
// - Edit: nickname, notes, working balance (a change adds a Manual Balance Adjustment), loan details,
//   and Close Account (a balance is zeroed with an adjustment, after a warning) or Reopen.
import { useState } from 'react';
import type { AccountType } from '@hafb/engine';
import { minor, type Minor, type MoneyFormat } from '@hafb/shared';
import type { AccountRecord, CreateAccountArgs, LoanDetails } from '@hafb/store';
import { Button } from '../../ui/Button.tsx';
import { Dialog, useConfirm } from '../../ui/Dialog.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { TextArea, TextInput } from '../../ui/TextInput.tsx';
import type { MoneyText } from '../shared/money.ts';
import styles from './AccountDialogs.module.css';
import { ACCOUNT_TYPES, formatRate, isDebtType, isLoanType, parseRate, SECTION_INFO, signedBalance, typeInfo, type AccountSection } from './accountsModel.ts';

const SECTIONS: AccountSection[] = ['cash', 'credit', 'loans', 'tracking'];

function TypeList({ value, onPick }: { value: AccountType | null; onPick: (t: AccountType) => void }) {
  return (
    <div className={styles.types} role="listbox" aria-label="Account type">
      {SECTIONS.map((s) => (
        <div key={s} className={styles.typeSection} role="group" aria-label={SECTION_INFO[s].title}>
          <div className={styles.typeHead}>{SECTION_INFO[s].title}</div>
          <p className={styles.blurb}>{SECTION_INFO[s].blurb}</p>
          {ACCOUNT_TYPES.filter((t) => t.section === s).map((t) => (
            <button
              key={t.type}
              type="button"
              role="option"
              aria-selected={value === t.type}
              className={styles.typeOption}
              autoFocus={value === t.type || (value === null && t.type === 'checking')}
              onClick={() => {
                onPick(t.type);
              }}
            >
              {t.label}
              {value === t.type && <Icon name="checkmark" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The loan details a form edits (S6.4: rate, minimum payment, escrow for mortgages, fees, original amount). */
interface LoanDraft {
  rate: string;
  payment: Minor;
  escrow: Minor;
  fees: Minor;
  original: Minor;
}

function loanDraftOf(l: LoanDetails | undefined): LoanDraft {
  return {
    rate: l?.interestRateBps === undefined ? '' : formatRate(l.interestRateBps),
    payment: l?.minimumPayment ?? minor(0),
    escrow: l?.escrow ?? minor(0),
    fees: l?.fees ?? minor(0),
    original: l?.originalPrincipal ?? minor(0),
  };
}

/** The draft as loan details, keeping fields the form doesn't edit (the paired category). */
function loanFromDraft(d: LoanDraft, keep: LoanDetails | undefined, mortgage: boolean): LoanDetails {
  const rateBps = parseRate(d.rate);
  return {
    ...(keep?.pairedCategoryId === undefined ? {} : { pairedCategoryId: keep.pairedCategoryId }),
    ...(rateBps === null ? {} : { interestRateBps: rateBps }),
    ...(d.payment > 0 ? { minimumPayment: d.payment } : {}),
    ...(mortgage && d.escrow > 0 ? { escrow: d.escrow } : {}),
    ...(d.fees > 0 ? { fees: d.fees } : {}),
    ...(d.original > 0 ? { originalPrincipal: d.original } : {}),
  };
}

const loanDraftValid = (d: LoanDraft): boolean => d.rate.trim() === '' || parseRate(d.rate) !== null;

/** Loan details fields. YNAB asks for the rate (not the APR), the lender's minimum, and escrow on a mortgage. */
function LoanFields({ draft, setDraft, mortgage, format }: { draft: LoanDraft; setDraft: (d: LoanDraft) => void; mortgage: boolean; format: MoneyFormat }) {
  const bad = !loanDraftValid(draft);
  return (
    <>
      <TextInput
        label="Interest rate"
        inputMode="decimal"
        suffix="%"
        value={draft.rate}
        onChange={(e) => {
          setDraft({ ...draft, rate: e.target.value });
        }}
        {...(bad ? { error: 'Enter a percentage, like 6.25.' } : {})}
      />
      <MoneyInput
        label="Monthly payment required by your lender"
        variant="field"
        value={draft.payment}
        format={format}
        onCommit={(payment) => {
          setDraft({ ...draft, payment });
        }}
        help="The total you must pay each month, including principal, interest, escrow and fees."
      />
      {mortgage && (
        <MoneyInput
          label="Monthly escrow"
          variant="field"
          value={draft.escrow}
          format={format}
          onCommit={(escrow) => {
            setDraft({ ...draft, escrow });
          }}
          help="Taxes and insurance paid through your mortgage. Covered first each month; it never lowers what you owe."
        />
      )}
      <MoneyInput
        label="Monthly fees"
        variant="field"
        value={draft.fees}
        format={format}
        onCommit={(fees) => {
          setDraft({ ...draft, fees });
        }}
        help="Any fee your lender charges every month. Covered before principal."
      />
      <MoneyInput
        label="Original loan amount"
        variant="field"
        value={draft.original}
        format={format}
        onCommit={(original) => {
          setDraft({ ...draft, original });
        }}
        help="Optional. Shows how much of the loan you’ve paid off."
      />
    </>
  );
}

export function AddAccountDialog({ format, onClose, onCreate }: { format: MoneyFormat; onClose: () => void; onCreate: (args: CreateAccountArgs) => void }) {
  const [step, setStep] = useState<'form' | 'type'>('form');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType | null>(null);
  const [balance, setBalance] = useState<Minor>(minor(0));
  const [loanDraft, setLoanDraft] = useState<LoanDraft>(() => loanDraftOf(undefined));
  const valid = name.trim() !== '' && type !== null && loanDraftValid(loanDraft);
  const submit = (): void => {
    if (!valid) return;
    const loan: LoanDetails = isLoanType(type) ? loanFromDraft(loanDraft, undefined, type === 'mortgage') : {};
    onClose();
    onCreate({ name: name.trim(), type, startingBalance: signedBalance(type, balance), ...(Object.keys(loan).length > 0 ? { loan } : {}) });
  };

  if (step === 'type') {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Select Account Type"
        footer={
          <Button icon="chevronLeft" onClick={() => {
            setStep('form');
          }}>
            Back
          </Button>
        }
      >
        <TypeList
          value={type}
          onPick={(t) => {
            setType(t);
            setStep('form');
          }}
        />
      </Dialog>
    );
  }

  const debt = type !== null && isDebtType(type);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add an account"
      description="An account you keep up to date yourself. Its balance starts your plan's history today."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Add Account
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextInput
          label="Give it a nickname"
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <div className={styles.field}>
          <span className={styles.fieldLabel} id="account-type-label">
            What type of account are you adding?
          </span>
          <button
            type="button"
            className={styles.typeButton}
            aria-labelledby="account-type-label account-type-value"
            onClick={() => {
              setStep('type');
            }}
          >
            <span id="account-type-value">{type === null ? 'Select account type…' : typeInfo(type).label}</span>
            <Icon name="chevronRight" />
          </button>
        </div>
        <MoneyInput
          label={debt ? 'How much do you owe on it today?' : 'What is your current account balance?'}
          variant="field"
          value={balance}
          format={format}
          onCommit={setBalance}
          {...(debt ? { help: 'Enter what you owe as a positive amount. HAFB shows debt as a negative balance, like YNAB.' } : {})}
        />
        {type !== null && isLoanType(type) && <LoanFields draft={loanDraft} setDraft={setLoanDraft} mortgage={type === 'mortgage'} format={format} />}
      </form>
    </Dialog>
  );
}

export interface AccountEdits {
  name: string;
  note: string;
  workingBalance: Minor;
  loan?: LoanDetails | null;
}

export function EditAccountDialog({
  account,
  workingBalance,
  format,
  money,
  onClose,
  onSave,
  onCloseAccount,
  onReopen,
}: {
  account: AccountRecord;
  workingBalance: Minor;
  format: MoneyFormat;
  money: MoneyText;
  onClose: () => void;
  onSave: (edits: AccountEdits) => void;
  onCloseAccount: (zeroOut: boolean) => void;
  onReopen: () => void;
}) {
  const confirm = useConfirm();
  const [name, setName] = useState(account.name);
  const [note, setNote] = useState(account.note ?? '');
  const [balance, setBalance] = useState<Minor>(workingBalance);
  const [loanDraft, setLoanDraft] = useState<LoanDraft>(() => loanDraftOf(account.loan));
  const loanType = isLoanType(account.type);
  const valid = name.trim() !== '' && loanDraftValid(loanDraft);
  const closed = account.closed === true;

  const save = (): void => {
    if (!valid) return;
    // The pairing isn't on this form: keep it.
    const loan: LoanDetails | null = loanType ? loanFromDraft(loanDraft, account.loan, account.type === 'mortgage') : null;
    onClose();
    onSave({ name: name.trim(), note, workingBalance: balance, ...(loanType ? { loan } : {}) });
  };

  const close = async (): Promise<void> => {
    if (workingBalance === 0) {
      onClose();
      onCloseAccount(false);
      return;
    }
    const ok = await confirm({
      title: `Close ${account.name}?`,
      body: `Its balance of ${money(workingBalance)} will be set to ${money(minor(0))} with an adjustment transaction${account.onBudget ? ', which also changes Ready to Assign by the same amount' : ''}. To move the money somewhere instead, cancel and record a transfer first.`,
      confirmLabel: 'Zero it and close',
      danger: true,
    });
    if (!ok) return;
    onClose();
    onCloseAccount(true);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit Account"
      footer={
        <>
          {closed ? (
            <Button onClick={() => {
              onClose();
              onReopen();
            }}>
              Reopen Account
            </Button>
          ) : (
            <Button variant="danger" onClick={() => void close()}>
              Close Account
            </Button>
          )}
          <span className={styles.spacer} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextInput
          label="Account nickname"
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <TextArea
          label="Account notes"
          value={note}
          rows={2}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <MoneyInput
          label="Working balance"
          variant="field"
          value={balance}
          format={format}
          onCommit={setBalance}
          disabled={closed}
          help="Changing it adds a Manual Balance Adjustment transaction for the difference."
        />
        {loanType && <LoanFields draft={loanDraft} setDraft={setLoanDraft} mortgage={account.type === 'mortgage'} format={format} />}
      </form>
    </Dialog>
  );
}
