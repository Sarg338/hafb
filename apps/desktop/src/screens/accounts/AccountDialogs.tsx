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

/** Loan details fields (interest rate and the lender's required monthly payment). */
function LoanFields({ rate, setRate, payment, setPayment, format }: { rate: string; setRate: (s: string) => void; payment: Minor; setPayment: (m: Minor) => void; format: MoneyFormat }) {
  const bad = rate.trim() !== '' && parseRate(rate) === null;
  return (
    <>
      <TextInput
        label="Interest rate"
        inputMode="decimal"
        suffix="%"
        value={rate}
        onChange={(e) => {
          setRate(e.target.value);
        }}
        {...(bad ? { error: 'Enter a percentage, like 6.25.' } : {})}
      />
      <MoneyInput
        label="Monthly payment required by your lender"
        variant="field"
        value={payment}
        format={format}
        onCommit={setPayment}
        help="The total you must pay each month, including principal, interest, escrow and fees."
      />
    </>
  );
}

export function AddAccountDialog({ format, onClose, onCreate }: { format: MoneyFormat; onClose: () => void; onCreate: (args: CreateAccountArgs) => void }) {
  const [step, setStep] = useState<'form' | 'type'>('form');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType | null>(null);
  const [balance, setBalance] = useState<Minor>(minor(0));
  const [rate, setRate] = useState('');
  const [payment, setPayment] = useState<Minor>(minor(0));
  const rateBps = parseRate(rate);
  const valid = name.trim() !== '' && type !== null && (rate.trim() === '' || rateBps !== null);
  const submit = (): void => {
    if (!valid) return;
    const loan: LoanDetails = isLoanType(type) ? { ...(rateBps === null ? {} : { interestRateBps: rateBps }), ...(payment > 0 ? { minimumPayment: payment } : {}) } : {};
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
        {type !== null && isLoanType(type) && <LoanFields rate={rate} setRate={setRate} payment={payment} setPayment={setPayment} format={format} />}
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
  const [rate, setRate] = useState(account.loan?.interestRateBps === undefined ? '' : formatRate(account.loan.interestRateBps));
  const [payment, setPayment] = useState<Minor>(account.loan?.minimumPayment ?? minor(0));
  const loanType = isLoanType(account.type);
  const rateBps = parseRate(rate);
  const valid = name.trim() !== '' && (rate.trim() === '' || rateBps !== null);
  const closed = account.closed === true;

  const save = (): void => {
    if (!valid) return;
    // Keep the loan's other details (escrow, fees, pairing); replace the two the form edits.
    const rest: LoanDetails = Object.fromEntries(Object.entries(account.loan ?? {}).filter(([k]) => k !== 'interestRateBps' && k !== 'minimumPayment'));
    const loan: LoanDetails | null = loanType ? { ...rest, ...(rateBps === null ? {} : { interestRateBps: rateBps }), ...(payment > 0 ? { minimumPayment: payment } : {}) } : null;
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
        {loanType && <LoanFields rate={rate} setRate={setRate} payment={payment} setPayment={setPayment} format={format} />}
      </form>
    </Dialog>
  );
}
