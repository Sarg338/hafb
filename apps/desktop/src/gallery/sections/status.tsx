import { Button } from '../../ui/Button.tsx';
import { Notice, RtaBanner } from '../../ui/Banner.tsx';
import { Pill } from '../../ui/Pill.tsx';
import { ProgressBar, ProgressRing } from '../../ui/ProgressBar.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';

function Status() {
  return (
    <>
      <Specimen label="Available pills">
        <Pill state="funded">$185.00</Pill>
        <Pill state="underfunded" title="$64.06 more needed by the 20th">
          $75.94
        </Pill>
        <Pill state="overspent" credit title="Overspent $86.21 on credit">
          -$86.21
        </Pill>
        <Pill state="overspent">-$24.99</Pill>
        <Pill state="zero">$0.00</Pill>
        <Pill state="snoozed">$300.00</Pill>
      </Specimen>
      <Specimen label="Progress bars">
        <div style={{ display: 'grid', gap: 14, width: 320 }}>
          <ProgressBar segments={1} fillPercent={100} spentPercent={46} state="funded" label="Funded, 46% spent" />
          <ProgressBar segments={1} fillPercent={54} spentPercent={0} state="underfunded" label="54% funded" />
          <ProgressBar segments={5} fillPercent={100} spentPercent={58} state="funded" label="Weekly target, 5 weeks" />
          <ProgressBar segments={1} fillPercent={100} spentPercent={100} state="overspent" label="Overspent" />
          <ProgressBar segments={1} fillPercent={30} spentPercent={0} state="snoozed" label="Snoozed" />
        </div>
      </Specimen>
      <Specimen label="Progress rings">
        <ProgressRing percent={100} state="funded" label="Target 100% funded" />
        <ProgressRing percent={54} state="underfunded" label="Target 54% funded" />
        <ProgressRing percent={8} state="underfunded" label="Target 8% funded" />
        <ProgressRing percent={30} state="snoozed" label="Snoozed, 30% funded" />
      </Specimen>
      <Specimen label="Ready to Assign">
        <RtaBanner
          state="positive"
          amount="$238.01"
          action={
            <Button variant="primary" iconEnd="chevronDown">
              Assign
            </Button>
          }
        />
        <RtaBanner state="zero" amount="$0.00" />
        <RtaBanner state="negative" amount="-$42.10" />
      </Specimen>
      <Specimen label="Notices">
        <div style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 760 }}>
          <Notice
            actions={
              <>
                <Button size="small">Review</Button>
                <Button size="small" variant="primary">
                  Approve all
                </Button>
              </>
            }
          >
            <strong>1 transaction needs approval.</strong> It already counts in your plan; approve it once it looks right.
          </Notice>
          <Notice tone="warning">2 transactions need a category.</Notice>
          <Notice tone="error">Couldn’t save that change: the plan file is read-only.</Notice>
        </div>
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'status', title: 'Status & progress', order: 80, Component: Status };
