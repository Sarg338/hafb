import { useRef, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { ConfirmProvider, Dialog, useConfirm } from '../../ui/Dialog.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';
import styles from './overlays.module.css';

/** `#/gallery?section=dialogs&open=dialog` opens the dialog for review captures. */
const openFromHash = (): boolean => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('open') === 'dialog';

function Examples() {
  const [open, setOpen] = useState(openFromHash);
  const [result, setResult] = useState('—');
  const nameRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  return (
    <>
      <Specimen label="Dialog">
        <Button onClick={() => {
          setOpen(true);
        }}>
          Rename category…
        </Button>
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Rename category"
          description="Groceries keeps its money, targets and history."
          initialFocus={nameRef}
          footer={
            <>
              <Button onClick={() => {
                setOpen(false);
              }}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => {
                setOpen(false);
              }}>
                Save
              </Button>
            </>
          }
        >
          <label className={styles.note} htmlFor="gallery-rename">
            Name
          </label>
          <input id="gallery-rename" ref={nameRef} defaultValue="Groceries" className={styles.row} style={{ width: '100%' }} />
        </Dialog>
      </Specimen>
      <Specimen label="Confirm">
        <Button
          onClick={() => {
            void confirm({
              title: 'Restore this backup?',
              body: 'This replaces the plan with the backup from 10/8/2026, 12:39 PM. The current plan is backed up first, so you can go back.',
              confirmLabel: 'Restore',
            }).then((ok) => {
              setResult(ok ? 'Restored' : 'Cancelled');
            });
          }}
        >
          Restore backup…
        </Button>
        <Button
          variant="danger"
          icon="dismiss"
          onClick={() => {
            void confirm({
              title: 'Delete 3 transactions?',
              body: 'You can undo this with Ctrl+Z.',
              confirmLabel: 'Delete',
              danger: true,
            }).then((ok) => {
              setResult(ok ? 'Deleted' : 'Cancelled');
            });
          }}
        >
          Delete…
        </Button>
        <span className={styles.note}>Result: {result}</span>
      </Specimen>
    </>
  );
}

function Dialogs() {
  return (
    <ConfirmProvider>
      <Examples />
    </ConfirmProvider>
  );
}

export const section: GallerySection = { id: 'dialogs', title: 'Dialogs', order: 60, Component: Dialogs };
