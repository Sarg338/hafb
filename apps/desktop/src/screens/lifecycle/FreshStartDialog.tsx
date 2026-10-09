// Make a Fresh Start (S7.2, §5.14), worded after YNAB's dialog (trial 2026-10-09). HAFB never links
// banks, so every account restarts at $0 for the user to update, and there is no "stop importing"
// option. The new plan is a new file; this one is kept, renamed "(Archived on …)".
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import styles from './Lifecycle.module.css';

export function FreshStartDialog({ onClose, onContinue }: { onClose: () => void; onContinue: (name: string) => void }) {
  const [name, setName] = useState('');
  const valid = name.trim() !== '';
  return (
    <Dialog
      open
      onClose={onClose}
      title="Make a Fresh Start"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              onContinue(name.trim());
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <form
        className={styles.fresh}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onContinue(name.trim());
        }}
      >
        <p>Starting fresh lets you plan from today without setting up a brand new plan. A copy of this plan is archived in case you’re not happy with the changes.</p>
        <TextInput
          label="New Plan Name"
          value={name}
          autoFocus
          help="Don’t worry, you can always change it later."
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <div>
          <h3>Here’s what you’ll see in your Fresh Start:</h3>
          <ul>
            <li>All your open accounts, each starting with a $0 balance for you to update with today’s balance</li>
            <li>Scheduled transactions</li>
            <li>Your category groups, categories and targets</li>
            <li>Your payees and expected income</li>
          </ul>
        </div>
        <div>
          <h3>Your archived plan will keep:</h3>
          <ul>
            <li>Transaction histories for your accounts</li>
            <li>Category amounts</li>
          </ul>
        </div>
        <p className={styles.muted}>Next you choose where to save the new plan. This plan stays where it is, renamed “(Archived on today’s date)”.</p>
      </form>
    </Dialog>
  );
}
