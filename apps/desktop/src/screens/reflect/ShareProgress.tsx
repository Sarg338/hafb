// Share Your Progress (S6.3, RF-09). YNAB (trial, 2026-10-09): "Download and Share" with a Format
// (Portrait 4:5, Vertical Story 9:16, Landscape 16:9, Square 1:1), Show Tagline and Show Amounts
// switches, a live preview, and Download Image. With amounts off, money reads as masked and the
// axis loses its labels; percentages stay. The image uses this app's own look and copy, with no
// branding. It's saved through the native Save dialog; nothing is uploaded anywhere.
import { useMemo, useRef, useState, type Ref } from 'react';
import { netWorth, type ReportFilters } from '@hafb/engine';
import type { ISODate } from '@hafb/shared';
import { budgetSnapshot, exportFileName, type PlanData } from '@hafb/store';
import { errorMessage } from '../../shell/ipc.ts';
import { saveFile } from '../../shell/files.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Toggle } from '../../ui/Toggle.tsx';
import { moneyFormat } from '../plan/planModel.ts';
import { moneyText } from '../shared/money.ts';
import { svgPng } from './chartImage.ts';
import { NetWorthChart, NW_CHART, previousNet } from './NetWorth.tsx';
import { rangeLabel } from './reflectModel.ts';
import { changePct } from './reportKit.tsx';
import styles from './Reflect.module.css';

export type ShareFormat = 'portrait' | 'story' | 'landscape' | 'square';

export const SHARE_FORMATS: readonly { id: ShareFormat; label: string; width: number; height: number }[] = [
  { id: 'portrait', label: 'Portrait (4:5)', width: 1080, height: 1350 },
  { id: 'story', label: 'Vertical Story (9:16)', width: 1080, height: 1920 },
  { id: 'landscape', label: 'Landscape (16:9)', width: 1920, height: 1080 },
  { id: 'square', label: 'Square (1:1)', width: 1080, height: 1080 },
];

export const SHARE_TAGLINE = 'Every month, a little further.';

export interface ShareProgressProps {
  plan: PlanData;
  filters: Pick<ReportFilters, 'from' | 'to' | 'accountIds'>;
  today: ISODate;
  open: boolean;
  onOpen: (open: boolean) => void;
  notify: (text: string) => void;
}

export function ShareProgress({ plan, filters, today, open, onOpen, notify }: ShareProgressProps) {
  return (
    <>
      <Button
        variant="primary"
        icon="barChart"
        onClick={() => {
          onOpen(true);
        }}
      >
        Share Your Progress
      </Button>
      {open && (
        <ShareDialog
          plan={plan}
          filters={filters}
          today={today}
          onClose={() => {
            onOpen(false);
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function ShareDialog({ plan, filters, today, onClose, notify }: { plan: PlanData; filters: ShareProgressProps['filters']; today: ISODate; onClose: () => void; notify: (t: string) => void }) {
  const [format, setFormat] = useState<ShareFormat>('portrait');
  const [tagline, setTagline] = useState(true);
  const [amounts, setAmounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const preview = useRef<SVGSVGElement>(null);
  const spec = SHARE_FORMATS.find((f) => f.id === format) ?? SHARE_FORMATS[0];
  const rows = useMemo(() => netWorth(budgetSnapshot(plan), filters), [plan, filters]);

  const download = async (): Promise<void> => {
    if (!preview.current || !spec) return;
    setBusy(true);
    try {
      const bytes = await svgPng(preview.current, { width: spec.width, height: spec.height });
      const saved = await saveFile(exportFileName([plan.settings.name, 'Net Worth', today], 'png'), bytes);
      if (saved !== null) {
        notify(`Saved your progress image to ${saved}.`);
        onClose();
      }
    } catch (e: unknown) {
      notify(`Couldn’t save the image: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Download and Share"
      size="large"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || rows.length === 0} onClick={() => void download()}>
            Download Image
          </Button>
        </>
      }
    >
      <div className={styles.share}>
        <div className={styles.shareOptions}>
          <h3>Format</h3>
          <div role="radiogroup" aria-label="Format" className={styles.formats}>
            {SHARE_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                className={styles.format}
                onClick={() => {
                  setFormat(f.id);
                }}
              >
                <span className={styles.formatIcon} style={{ aspectRatio: `${String(f.width)} / ${String(f.height)}` }} aria-hidden="true" />
                {f.label}
              </button>
            ))}
          </div>
          <hr className={styles.rule} />
          <Toggle label="Show Tagline" checked={tagline} onChange={setTagline} />
          <Toggle label="Show Amounts" checked={amounts} onChange={setAmounts} />
        </div>
        <div className={styles.sharePreview}>
          <h3>Preview</h3>
          <div className={styles.previewStage}>
            {spec && <ShareImage ref={preview} plan={plan} rows={rows} width={spec.width} height={spec.height} tagline={tagline} amounts={amounts} />}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

interface ShareImageProps {
  ref: Ref<SVGSVGElement>;
  plan: PlanData;
  rows: ReturnType<typeof netWorth>;
  width: number;
  height: number;
  tagline: boolean;
  amounts: boolean;
}

/** The image itself: a composed SVG in the app's accent, drawn to PNG at full size on download. */
export function ShareImage({ ref, plan, rows, width, height, tagline, amounts }: ShareImageProps) {
  const fmt = moneyFormat(plan);
  const money = moneyText(fmt, !amounts);
  const last = rows[rows.length - 1];
  const unit = Math.min(width, height) / 1080;
  const pad = 64 * unit;
  const top = tagline ? 190 * unit : pad;
  const cardW = width - pad * 2;
  const cardH = height - top - pad - 70 * unit;
  const statsH = 250 * unit;
  const chartH = Math.max(0, cardH - statsH - 40 * unit);
  const chartW = Math.min(cardW - 48 * unit, (chartH * NW_CHART.W) / NW_CHART.H);
  const change = last ? changePct(last.change, previousNet(rows, rows.length - 1)) : '0.0%';
  const label = (x: number, y: number, text: string) => (
    <text x={x} y={y} className={styles.shareLabel} fontSize={26 * unit}>
      {text}
    </text>
  );
  const value = (x: number, y: number, text: string, size: number) => (
    <text x={x} y={y} className={styles.shareValue} fontSize={size * unit}>
      {text}
    </text>
  );
  const range = last ? rangeLabel(rows[0]?.month ?? last.month, last.month) : '';
  return (
    <svg ref={ref} viewBox={`0 0 ${String(width)} ${String(height)}`} className={styles.shareSvg} role="img" aria-label={`Net worth image, ${range}`}>
      <rect width={width} height={height} className={styles.shareBg} />
      <circle cx={width * 0.92} cy={height * 0.06} r={width * 0.32} className={styles.shareDeco} />
      <circle cx={width * 0.05} cy={height * 0.98} r={width * 0.4} className={styles.shareDeco} />
      {tagline && (
        <text x={width / 2} y={118 * unit} textAnchor="middle" className={styles.shareTagline} fontSize={56 * unit}>
          {SHARE_TAGLINE}
        </text>
      )}
      <rect x={pad} y={top} width={cardW} height={cardH} rx={28 * unit} className={styles.shareCard} />
      {last && (
        <>
          {label(pad + 40 * unit, top + 64 * unit, 'Net Worth')}
          {value(pad + 40 * unit, top + 128 * unit, money(last.netWorth), 64)}
          {label(pad + 40 * unit, top + 188 * unit, 'Assets')}
          {value(pad + 40 * unit, top + 226 * unit, money(last.assets), 32)}
          {label(pad + 40 * unit + cardW * 0.32, top + 188 * unit, 'Debts')}
          {value(pad + 40 * unit + cardW * 0.32, top + 226 * unit, money(last.debts), 32)}
          {label(pad + 40 * unit + cardW * 0.64, top + 188 * unit, 'Change in Net Worth')}
          {value(pad + 40 * unit + cardW * 0.64, top + 226 * unit, `${money(last.change)}  ${change}`, 32)}
          <NetWorthChart rows={rows} fmt={fmt} money={money} hidden={!amounts} frame={{ x: pad + (cardW - chartW) / 2, y: top + statsH + 16 * unit, width: chartW, height: chartH }} />
        </>
      )}
      <text x={width / 2} y={height - pad * 0.7} textAnchor="middle" className={styles.shareFoot} fontSize={28 * unit}>
        {range}
      </text>
    </svg>
  );
}
