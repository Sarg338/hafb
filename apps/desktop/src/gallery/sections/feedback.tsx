import { Button, IconButton } from '../../ui/Button.tsx';
import { ToastProvider, ToastView, useToast } from '../../ui/Toast.tsx';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';
import styles from './overlays.module.css';

/** `#/gallery?section=feedback&open=tooltip` keeps a tooltip showing for review captures. */
const forceTooltip = (): boolean => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('open') === 'tooltip';

function Examples() {
  const { toast } = useToast();
  return (
    <>
      <Specimen label="Tooltips">
        <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" />
        <IconButton icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" />
        <IconButton icon="eyeOff" iconSize={20} label="Hide amounts" />
        <span className={styles.note}>Hover for half a second, or Tab to a button.</span>
      </Specimen>
      <Specimen label="Tooltip (shown)">
        <div className={styles.tall} style={{ display: 'flex' }}>
          <Tooltip text="Assign money to every underfunded category" shortcut="Ctrl+U" forceOpen={forceTooltip()}>
            {(props) => (
              <Button {...props} variant="toolbar" icon="target">
                Underfunded
              </Button>
            )}
          </Tooltip>
        </div>
      </Specimen>
      <Specimen label="Toasts">
        <Button
          onClick={() => {
            toast({ text: 'Undid: Assign: Car Fund', action: { label: 'Redo', onAction: () => undefined }, replace: true });
          }}
        >
          Undo feedback
        </Button>
        <Button
          onClick={() => {
            toast({ text: 'Deleted 3 transactions', action: { label: 'Undo', onAction: () => undefined } });
          }}
        >
          Delete with Undo
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            toast({ text: "Couldn't save that change: the file is read-only.", tone: 'error' });
          }}
        >
          Error
        </Button>
      </Specimen>
      <Specimen label="Toast (static)">
        <ToastView inline item={{ id: 1, text: 'Undid: Assign: Car Fund', tone: 'info', action: { label: 'Redo', onAction: () => undefined } }} onDismiss={() => undefined} />
        <ToastView inline item={{ id: 2, text: "Couldn't save that change: the file is read-only.", tone: 'error' }} onDismiss={() => undefined} />
      </Specimen>
    </>
  );
}

function Feedback() {
  return (
    <ToastProvider>
      <Examples />
    </ToastProvider>
  );
}

export const section: GallerySection = { id: 'feedback', title: 'Tooltips & toasts', order: 70, Component: Feedback };
