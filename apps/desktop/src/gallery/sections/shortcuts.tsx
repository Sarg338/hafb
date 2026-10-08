import { useEffect, useState } from 'react';
import { InvariantViolation, ValidationError } from '@hafb/engine';
import { Button } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { ErrorBoundary } from '../../ui/ErrorBoundary.tsx';
import { describeError, installGlobalErrorHandlers } from '../../ui/errors.ts';
import { Kbd } from '../../ui/Kbd.tsx';
import { ShortcutProvider, useShortcut, useShortcuts } from '../../ui/shortcuts/ShortcutProvider.tsx';
import { ToastProvider, useToast } from '../../ui/Toast.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';

/** `#/gallery?section=shortcuts&open=shortcuts` opens the overlay for review captures. */
const openOverlay = (): boolean => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('open') === 'shortcuts';

function ComponentScoped() {
  const { toast } = useToast();
  useShortcut({
    id: 'demo.panel',
    keys: 'Ctrl+K',
    description: 'Panel action (component scope wins over the global Ctrl+K)',
    group: 'Gallery demo',
    scope: 'component',
    run: () => toast({ text: 'Component-scoped Ctrl+K ran', replace: true }),
  });
  return <span style={{ color: 'var(--c-text-muted)' }}>Panel mounted: Ctrl+K now runs the panel action.</span>;
}

function Thrower() {
  const [boom, setBoom] = useState(false);
  if (boom) throw new InvariantViolation('Split lines add up to $186.39, not $186.40');
  return (
    <Button
      onClick={() => {
        setBoom(true);
      }}
    >
      Break this panel
    </Button>
  );
}

function Demo() {
  const { toast } = useToast();
  const { setOverlayOpen, enabled } = useShortcuts();
  const [panel, setPanel] = useState(false);
  const [boundaryKey, setBoundaryKey] = useState(0);
  const errorToast = (e: unknown): void => {
    const d = describeError(e);
    toast({ text: `${d.title}. ${d.message}`, tone: 'error' });
  };

  useEffect(
    () =>
      installGlobalErrorHandlers((d) => {
        toast({ text: `${d.title}. ${d.message}`, tone: 'error' });
      }),
    [toast],
  );

  useShortcut({
    id: 'demo.global',
    keys: 'Ctrl+K',
    description: 'Global demo action',
    group: 'Gallery demo',
    scope: 'global',
    run: () => toast({ text: 'Global Ctrl+K ran', replace: true }),
  });
  useShortcut({
    id: 'demo.sequence',
    keys: 'G then S',
    description: 'Two-key sequence demo',
    group: 'Gallery demo',
    scope: 'screen',
    run: () => toast({ text: 'G then S ran', replace: true }),
  });

  return (
    <>
      <Specimen label="Overlay">
        <Button icon="list" onClick={() => {
          setOverlayOpen(true);
        }}>
          Keyboard shortcuts
        </Button>
        <span>
          or press <Kbd keys="?" />
        </span>
        <span style={{ color: 'var(--c-text-muted)' }}>Shortcuts are {enabled ? 'on' : 'off'}.</span>
      </Specimen>
      <Specimen label="Scopes">
        <span>
          <Kbd keys="Ctrl+K" /> global
        </span>
        <span>
          <Kbd keys="G" /> then <Kbd keys="S" /> sequence
        </span>
        <Checkbox label="Mount a panel with its own Ctrl+K" checked={panel} onChange={setPanel} />
        {panel && <ComponentScoped />}
      </Specimen>
      <Specimen label="Error toasts">
        <Button onClick={() => {
          errorToast(new ValidationError('Move amount must be positive'));
        }}>
          Validation error
        </Button>
        <Button onClick={() => {
          errorToast({ kind: 'AlreadyOpen', message: 'locked' });
        }}>
          Store error
        </Button>
        <Button onClick={() => {
          void Promise.reject(new Error('Unexpected thing in a background task'));
        }}>
          Unhandled rejection
        </Button>
      </Specimen>
      <Specimen label="Error boundary">
        <ErrorBoundary area="demo panel" resetKey={String(boundaryKey)}>
          <Thrower />
        </ErrorBoundary>
        <Button size="small" onClick={() => {
          setBoundaryKey((k) => k + 1);
        }}>
          Reset demo
        </Button>
      </Specimen>
    </>
  );
}

function Shortcuts() {
  return (
    <ToastProvider>
      <ShortcutProvider initialOverlayOpen={openOverlay()}>
        <Demo />
      </ShortcutProvider>
    </ToastProvider>
  );
}

export const section: GallerySection = { id: 'shortcuts', title: 'Shortcuts & errors', order: 100, Component: Shortcuts };
