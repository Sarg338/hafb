// A loan account's page above its register (S6.4), as YNAB lays it out (trial, 2026-10-08):
// Remaining Balance, Interest Rate, Minimum Payment, Escrow and Payoff Date; "Your Loan's
// Progress" (balance remaining and its share of the original, the current track, Share Your
// Progress, Open Payoff Simulator, "The minimum payment of $X will pay off this loan in N
// years"); "Pair your loan and get more out of your plan"; a gear for missing details; and a
// celebration when the balance reaches zero (X-05). Figures come from the engine (loanModel).
import { useMemo, useState, type Ref } from 'react';
import type { Id } from '@hafb/engine';
import { minor, monthOf, sub, type ISODate, type Minor } from '@hafb/shared';
import { applyChanges, createCategory, mergeChangeSets, pairLoanCategory, recordLoanPayment, type AccountRecord, type PlanData } from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { usePrefs, prefs } from '../../shell/prefs.ts';
import { Button } from '../../ui/Button.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { DateInput } from '../../ui/DateInput.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import { cx } from '../../ui/cx.ts';
import { linear, niceTicks } from '../reflect/charts/scale.ts';
import { monthLabel, monthLong } from '../reflect/reflectModel.ts';
import { ShareDialog } from '../reflect/ShareProgress.tsx';
import { moneyFormat, planModel } from '../plan/planModel.ts';
import { moneyText, type MoneyText } from '../shared/money.ts';
import { currentTrack, durationShort, durationText, loanProgress, owed, loanTerms, missingLoanDetails, paymentForPayoff, payoffMonths, simulate, trackSentence, type LoanProgress, type Projection } from '../shared/loanModel.ts';
import { formatRate } from './accountsModel.ts';
import reflect from '../reflect/Reflect.module.css';
import styles from './LoanPanel.module.css';

const COLLAPSE_ID = 'loanProgress';

export interface LoanPanelProps {
  plan: PlanData;
  account: AccountRecord;
  today: ISODate;
  money: MoneyText;
  actions: Actions;
}

export function LoanPanel({ plan, account, today, money, actions }: LoanPanelProps) {
  const p = usePrefs();
  const progress = useMemo(() => loanProgress(plan, account, today), [plan, account, today]);
  const terms = loanTerms(account, progress.balance);
  const track = useMemo(() => (terms ? currentTrack(terms, today) : null), [terms, today]);
  const missing = missingLoanDetails(account);
  const paired = account.loan?.pairedCategoryId === undefined ? undefined : plan.categories.find((c) => c.id === account.loan?.pairedCategoryId && c.deletedAt === undefined);
  const collapsed = p.inspectorCollapsed.includes(COLLAPSE_ID);
  const [dialog, setDialog] = useState<'simulator' | 'pair' | 'share' | null>(null);
  // Paying the loan off while it's on screen celebrates once (X-05).
  const [seen, setSeen] = useState(progress.balance);
  const [celebrate, setCelebrate] = useState(false);
  if (progress.balance !== seen) {
    setSeen(progress.balance);
    if (seen < 0 && progress.balance >= 0) setCelebrate(true);
  }
  const loan = account.loan;
  const paidOff = progress.balance >= 0;

  return (
    <section className={styles.panel} aria-label="Loan details">
      <div className={styles.stats}>
        <Stat label="Remaining Balance" value={money(owed(progress.balance))} />
        <Stat label="Interest Rate" value={loan?.interestRateBps === undefined ? '—' : `${formatRate(loan.interestRateBps)}%`} />
        <Stat label="Minimum Payment" value={loan?.minimumPayment === undefined ? '—' : money(loan.minimumPayment)} />
        {loan?.escrow !== undefined && <Stat label="Escrow" value={money(loan.escrow)} />}
        <Stat label="Payoff Date" value={paidOff ? 'Paid off' : track?.ok === true ? monthLabel(track.value.summary.payoffMonth) : '—'} />
        {missing.length > 0 && (
          <Button
            variant="toolbar"
            icon="settings"
            className={styles.missing}
            title={`Missing: ${missing.join(', ')}`}
            onClick={() => {
              actions.accountAction?.(account.id, 'edit');
            }}
          >
            Add loan details
          </Button>
        )}
      </div>

      <div className={styles.card}>
        <button
          type="button"
          className={styles.cardHead}
          aria-expanded={!collapsed}
          onClick={() => {
            const list = prefs.get().inspectorCollapsed;
            prefs.update({ inspectorCollapsed: collapsed ? list.filter((x) => x !== COLLAPSE_ID) : [...list, COLLAPSE_ID] });
          }}
        >
          Your Loan’s Progress
          <Icon name={collapsed ? 'chevronDown' : 'chevronUp'} />
        </button>
        {!collapsed && (
          <div className={styles.cardBody}>
            <div className={styles.progressHead}>
              <div className={styles.remaining}>
                <span>Balance Remaining</span>
                <strong>
                  {money(owed(progress.balance))}
                  {progress.remainingShare !== null && <span className={styles.share}> ({(Math.round(progress.remainingShare * 1000) / 10).toFixed(1)}%)</span>}
                </strong>
              </div>
              <div className={styles.links}>
                <Button variant="toolbar" icon="barChart" onClick={() => { setDialog('share'); }}>
                  Share Your Progress
                </Button>
                <Button variant="toolbar" icon="trending" disabled={!terms} title={terms ? undefined : 'Add the interest rate and minimum payment first'} onClick={() => { setDialog('simulator'); }}>
                  Open Payoff Simulator
                </Button>
              </div>
            </div>
            <LoanChart progress={progress} track={track?.ok === true ? track.value : null} money={money} hidden={p.hideAmounts} label={`${account.name} balance`} />
            {loan?.minimumPayment !== undefined && !paidOff && track && <p className={styles.sentence}>{trackSentence(money(loan.minimumPayment), track)}</p>}
            {paidOff && <p className={styles.sentence}>This loan is paid off. Close it from Edit Account whenever you’re ready; it won’t close on its own.</p>}
          </div>
        )}
      </div>

      {paired ? (
        <p className={styles.paired}>
          <Icon name="link" /> Paired with <strong>{paired.name}</strong>: payments to {account.name} come from that category.
          <Button variant="toolbar" size="small" onClick={() => { setDialog('pair'); }}>
            Change
          </Button>
        </p>
      ) : (
        <div className={styles.pairCard}>
          <div>
            <strong>Pair your loan and get more out of your plan</strong>
            <p>Pairing your loan with a plan category helps you keep track of your payments in your plan, and turns on Record Payment and the Monthly Debt Payment target.</p>
          </div>
          <Button variant="primary" onClick={() => { setDialog('pair'); }}>
            Get Started
          </Button>
        </div>
      )}

      {dialog === 'simulator' && terms && <PayoffSimulator account={account} terms={terms} today={today} money={money} plan={plan} onClose={() => { setDialog(null); }} />}
      {dialog === 'pair' && <PairLoanDialog plan={plan} account={account} actions={actions} onClose={() => { setDialog(null); }} />}
      {dialog === 'share' && (
        <ShareDialog
          fileParts={[plan.settings.name, account.name, today]}
          canDownload
          onClose={() => {
            setDialog(null);
          }}
          notify={actions.notify}
          Image={(o) => <LoanShareImage {...o} plan={plan} account={account} progress={progress} track={track?.ok === true ? track.value : null} />}
        />
      )}
      {celebrate && (
        <Dialog
          open
          title={`You paid off ${account.name}!`}
          onClose={() => {
            setCelebrate(false);
          }}
          footer={
            <>
              <Button onClick={() => { setCelebrate(false); }}>Close</Button>
              <Button
                variant="primary"
                icon="barChart"
                onClick={() => {
                  setCelebrate(false);
                  setDialog('share');
                }}
              >
                Share Your Progress
              </Button>
            </>
          }
        >
          <div className={styles.celebrate}>
            <span className={styles.celebrateIcon} aria-hidden="true">
              <Icon name="checkmark" size={20} />
            </span>
            <p>Every payment got you here. The balance is {money(minor(0))}, and the money you were sending to {account.name} is yours to plan again.</p>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

// ---- chart ---------------------------------------------------------------------------------

interface ChartProps {
  progress: LoanProgress;
  track: Projection | null;
  money: MoneyText;
  hidden: boolean;
  label: string;
  /** Placement when nested in the share image. */
  frame?: { x: number; y: number; width: number; height: number };
}

const W = 820;
const H = 200;

/** What's owed over time: the past month ends (solid) and the current track (dashed). */
export function LoanChart({ progress, track, money, hidden, label, frame }: ChartProps) {
  const past = progress.history.map((h) => ({ month: h.month, owed: owed(h.balance) }));
  const future = (track?.rows ?? []).map((r) => ({ month: r.month, owed: r.balance }));
  const points = [...past, ...future];
  if (points.length === 0) return null;
  const pad = { l: hidden ? 16 : 72, r: 16, t: 12, b: 28 };
  const top = Math.max(1, ...points.map((p) => p.owed));
  const ticks = niceTicks(0, top, 3);
  const y = linear(0, ticks[ticks.length - 1] ?? top, H - pad.b, pad.t);
  const x = linear(0, Math.max(1, points.length - 1), pad.l, W - pad.r);
  const path = (from: number, to: number) =>
    points
      .slice(from, to)
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(from + i).toFixed(1)} ${y(p.owed).toFixed(1)}`)
      .join(' ');
  const years = points.length > 24;
  const tickEvery = years ? Math.max(12, Math.ceil(points.length / 6 / 12) * 12) : Math.max(1, Math.ceil(points.length / 6));
  const unit = (v: number) => money(minor(Math.round(v / 100) * 100)).replace(/\.\d+$/, '');
  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      className={frame ? undefined : styles.chart}
      {...(frame ? { x: frame.x, y: frame.y, width: frame.width, height: frame.height } : { 'data-chart': '' })}
      role="img"
      aria-label={`${label}: ${money(minor(past.at(-1)?.owed ?? 0))} owed now${track ? `, paid off in ${monthLong(track.summary.payoffMonth)}` : ''}`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={reflect.grid} />
          {!hidden && (
            <text x={pad.l - 8} y={y(t) + 4} className={reflect.axis} textAnchor="end">
              {unit(t)}
            </text>
          )}
        </g>
      ))}
      {points.map((p, i) =>
        i % tickEvery === 0 ? (
          <text key={p.month} x={x(i)} y={H - 8} className={reflect.axis} textAnchor="middle">
            {years ? p.month.slice(0, 4) : monthLabel(p.month)}
          </text>
        ) : null,
      )}
      {past.length > 0 && <path d={path(0, past.length)} className={styles.pastLine} />}
      {future.length > 0 && <path d={path(Math.max(0, past.length - 1), points.length)} className={styles.trackLine} />}
      {past.length > 0 && <circle cx={x(past.length - 1)} cy={y(past.at(-1)?.owed ?? 0)} r="4.5" className={styles.nowPoint} />}
    </svg>
  );
}

// ---- share image ---------------------------------------------------------------------------

function LoanShareImage({ ref, width, height, tagline, amounts, plan, account, progress, track }: { ref: Ref<SVGSVGElement>; width: number; height: number; tagline: boolean; amounts: boolean; plan: PlanData; account: AccountRecord; progress: LoanProgress; track: Projection | null }) {
  const fmt = moneyFormat(plan);
  const money = moneyText(fmt, !amounts);
  const lastMonth = progress.history.at(-1)?.month;
  const unit = Math.min(width, height) / 1080;
  const pad = 64 * unit;
  const top = tagline ? 190 * unit : pad;
  const cardW = width - pad * 2;
  const cardH = height - top - pad - 70 * unit;
  const paidShare = progress.remainingShare === null ? null : Math.round((1 - progress.remainingShare) * 100);
  const chartH = Math.max(0, cardH - 260 * unit);
  const chartW = Math.min(cardW - 48 * unit, (chartH * W) / H);
  return (
    <svg ref={ref} viewBox={`0 0 ${String(width)} ${String(height)}`} className={reflect.shareSvg} role="img" aria-label={`${account.name} progress image`}>
      <rect width={width} height={height} className={reflect.shareBg} />
      <circle cx={width * 0.92} cy={height * 0.06} r={width * 0.32} className={reflect.shareDeco} />
      <circle cx={width * 0.05} cy={height * 0.98} r={width * 0.4} className={reflect.shareDeco} />
      {tagline && (
        <text x={width / 2} y={118 * unit} textAnchor="middle" className={reflect.shareTagline} fontSize={56 * unit}>
          {progress.balance >= 0 ? 'Paid off. Every payment counted.' : 'Every month, a little further.'}
        </text>
      )}
      <rect x={pad} y={top} width={cardW} height={cardH} rx={28 * unit} className={reflect.shareCard} />
      <text x={pad + 40 * unit} y={top + 64 * unit} className={reflect.shareLabel} fontSize={26 * unit}>
        {account.name} · Balance Remaining
      </text>
      <text x={pad + 40 * unit} y={top + 132 * unit} className={reflect.shareValue} fontSize={64 * unit}>
        {money(owed(progress.balance))}
      </text>
      {paidShare !== null && (
        <text x={pad + 40 * unit} y={top + 190 * unit} className={reflect.shareLabel} fontSize={30 * unit}>
          {`${String(paidShare)}% paid off`}
        </text>
      )}
      <LoanChart progress={progress} track={track} money={money} hidden={!amounts} label={account.name} frame={{ x: pad + (cardW - chartW) / 2, y: top + 230 * unit, width: chartW, height: chartH }} />
      <text x={width / 2} y={height - pad * 0.7} textAnchor="middle" className={reflect.shareFoot} fontSize={28 * unit}>
        {lastMonth === undefined ? '' : monthLong(lastMonth)}
      </text>
    </svg>
  );
}

// ---- Loan Payoff Simulator -----------------------------------------------------------------

function PayoffSimulator({ account, terms, today, money, plan, onClose }: { account: AccountRecord; terms: NonNullable<ReturnType<typeof loanTerms>>; today: ISODate; money: MoneyText; plan: PlanData; onClose: () => void }) {
  const fmt = moneyFormat(plan);
  const [payment, setPayment] = useState<Minor>(terms.monthlyPayment);
  const [extra, setExtra] = useState<Minor>(minor(0));
  const months = useMemo(() => payoffMonths(terms, today), [terms, today]);
  const result = simulate(terms, today, payment < terms.monthlyPayment ? terms.monthlyPayment : payment, extra);
  const plan2 = result.ok ? result.value.plan : null;
  const base = result.ok ? result.value.base : null;
  const minimum = payment <= terms.monthlyPayment && extra === 0;
  const progress = useMemo(() => loanProgress(plan, account, today), [plan, account, today]);
  return (
    <Dialog
      open
      size="large"
      title="Loan Payoff Simulator"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className={styles.sim}>
        <div className={styles.simInputs}>
          <div className={styles.required}>
            <strong>{money(terms.monthlyPayment)}</strong>
            <span>Required Minimum Payment</span>
          </div>
          <MoneyInput
            label="Monthly Payment"
            variant="field"
            value={payment}
            format={fmt}
            onCommit={(v) => {
              setPayment(v < terms.monthlyPayment ? terms.monthlyPayment : v);
            }}
            help={`${money(terms.monthlyPayment)} is your minimum monthly payment.`}
          />
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Payoff Date</span>
            <Combobox
              label="Payoff Date"
              groups={[{ id: 'months', label: 'Months', options: months.map((m) => ({ id: m, label: monthLabel(m) })) }]}
              value={plan2 && months.includes(plan2.summary.payoffMonth) ? plan2.summary.payoffMonth : (months.at(-1) ?? '')}
              onChange={(id) => {
                const m = months.find((x) => x === id);
                if (m !== undefined) setPayment(paymentForPayoff(terms, today, m));
              }}
            />
            {plan2 && base && (
              <span className={styles.help}>
                {minimum ? `You have ${String(plan2.summary.months)} payments remaining on your loan.` : `Your original payoff date is ${monthLabel(base.summary.payoffMonth)}`}
              </span>
            )}
          </div>
          <MoneyInput
            label={`One time extra in ${monthLabel(monthOf(today)).slice(0, 3)}`}
            variant="field"
            value={extra}
            format={fmt}
            onCommit={(v) => {
              setExtra(v < 0 ? minor(0) : v);
            }}
            help="Extra one-off payments can have a large impact on your loan."
          />
          {!minimum && (
            <Button
              variant="toolbar"
              icon="dismiss"
              onClick={() => {
                setPayment(terms.monthlyPayment);
                setExtra(minor(0));
              }}
            >
              Reset all changes
            </Button>
          )}
        </div>
        <div className={styles.simResult}>
          {result.ok && plan2 && base ? (
            <>
              <LoanChart progress={progress} track={plan2} money={money} hidden={false} label={`${account.name} with this plan`} />
              <div className={styles.compare}>
                {/* YNAB (trial 2026-10-09): the minimum shows what's left; a plan shows what it saves. */}
                <p className={styles.compareHead}>{minimum ? 'Paying the minimum every month' : simHeading(money, sub(payment, terms.monthlyPayment), extra)}</p>
                <div className={styles.compareCells}>
                  <div>
                    <strong>{money(minimum ? plan2.interest : result.value.interestSaved)}</strong>
                    <span>{minimum ? 'Interest Remaining' : 'Interest Savings'}</span>
                  </div>
                  <div>
                    <strong>{minimum ? (plan2.summary.months === 0 ? 'Paid off' : durationText(plan2.summary.months)) : durationShort(Math.max(0, result.value.monthsSaved))}</strong>
                    <span>{minimum ? 'Time Remaining' : 'Time Savings'}</span>
                  </div>
                </div>
              </div>
              <div className={styles.totals}>
                <div className={cx(styles.totalLine, styles.totalStrong)}>
                  <span>Remaining to Pay</span>
                  <span>{money(plan2.remainingToPay)}</span>
                </div>
                <div className={styles.totalLine}>
                  <span>Principal</span>
                  <span>{money(sub(terms.principal, extra))}</span>
                </div>
                <div className={styles.totalLine}>
                  <span>Interest</span>
                  <span>{money(plan2.interest)}</span>
                </div>
              </div>
              <p className={styles.help}>Note: Escrow amounts are not included.</p>
            </>
          ) : (
            <p className={styles.help}>{result.ok ? '' : result.reason}</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** "Paying +$500.00 extra every month" (YNAB), with a one-time extra when there is one. */
function simHeading(money: MoneyText, more: Minor, once: Minor): string {
  const monthly = more > 0 ? `+${money(more)} extra every month` : '';
  const now = once > 0 ? `${money(once)} extra now` : '';
  return `Paying ${[monthly, now].filter(Boolean).join(' and ')}`;
}

// ---- pairing ---------------------------------------------------------------------------------

function PairLoanDialog({ plan, account, actions, onClose }: { plan: PlanData; account: AccountRecord; actions: Actions; onClose: () => void }) {
  const groups = plan.categoryGroups.filter((g) => g.deletedAt === undefined && g.systemKind === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const categories = plan.categories.filter((c) => c.deletedAt === undefined && c.creditCardAccountId === undefined && groups.some((g) => g.id === c.groupId));
  const [mode, setMode] = useState<'existing' | 'new'>(account.loan?.pairedCategoryId !== undefined || categories.length > 0 ? 'existing' : 'new');
  const [categoryId, setCategoryId] = useState<Id | null>(account.loan?.pairedCategoryId ?? null);
  const [name, setName] = useState(account.name);
  const [groupId, setGroupId] = useState<Id | null>(groups[0]?.id ?? null);
  const pairedElsewhere = (id: Id) => plan.accounts.find((a) => a.id !== account.id && a.deletedAt === undefined && a.loan?.pairedCategoryId === id);
  const elsewhere = categoryId === null ? undefined : pairedElsewhere(categoryId);
  const valid = mode === 'existing' ? categoryId !== null : name.trim() !== '' && groupId !== null;
  const save = (): void => {
    if (!valid) return;
    onClose();
    if (mode === 'existing' && categoryId !== null) {
      actions.run((p, ctx) => pairLoanCategory(p, ctx, { accountId: account.id, categoryId }));
      return;
    }
    if (groupId === null) return;
    actions.run((p, ctx) => {
      const made = createCategory(p, ctx, { groupId, name: name.trim() });
      const next = applyChanges(p, made.changes).plan;
      const pair = pairLoanCategory(next, ctx, { accountId: account.id, categoryId: made.categoryId });
      return { label: pair.label, changes: mergeChangeSets(made.changes, pair.changes) };
    });
  };
  const options: { id: string; label: string; options: { id: string; label: string }[] }[] = groups.map((g) => ({
    id: g.id,
    label: g.name,
    options: categories.filter((c) => c.groupId === g.id).map((c) => ({ id: c.id, label: c.name })),
  }));
  return (
    <Dialog
      open
      title={`Pair ${account.name} with a category`}
      onClose={onClose}
      description="Payments to this loan will come from the paired category, and only from it. Record Payment and the Monthly Debt Payment target come with it."
      footer={
        <>
          {account.loan?.pairedCategoryId !== undefined && (
            <Button
              variant="danger"
              onClick={() => {
                onClose();
                actions.run((p, ctx) => pairLoanCategory(p, ctx, { accountId: account.id, categoryId: null }));
              }}
            >
              Unpair
            </Button>
          )}
          <span className={styles.spacer} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Pair
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <SegmentedControl
          label="Category"
          options={[
            { value: 'existing', label: 'An existing category' },
            { value: 'new', label: 'A new category' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'existing' ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Category</span>
            <Combobox label="Category" groups={options} value={categoryId ?? ''} onChange={(id) => { setCategoryId(id); }} />
            {elsewhere && <span className={styles.help}>It’s paired with {elsewhere.name} now; pairing moves it to {account.name}.</span>}
          </div>
        ) : (
          <>
            <TextInput label="Category name" value={name} onChange={(e) => { setName(e.target.value); }} />
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Group</span>
              <Combobox label="Group" groups={[{ id: 'groups', label: 'Groups', options: groups.map((g) => ({ id: g.id, label: g.name })) }]} value={groupId ?? ''} onChange={(id) => { setGroupId(id); }} />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---- Record Payment ----------------------------------------------------------------------------

export function RecordLoanPaymentDialog({ plan, account, today, actions, onClose }: { plan: PlanData; account: AccountRecord; today: ISODate; actions: Actions; onClose: () => void }) {
  const fmt = moneyFormat(plan);
  const pairedId = account.loan?.pairedCategoryId;
  // A paired loan pre-fills the category's Available (YNAB, Loan Accounts guide); else the minimum.
  const available = useMemo(() => {
    if (pairedId === undefined) return null;
    return planModel(plan, monthOf(today), today).ms.categories[pairedId]?.available ?? null;
  }, [plan, pairedId, today]);
  const [amount, setAmount] = useState<Minor>(available !== null && available > 0 ? available : (account.loan?.minimumPayment ?? minor(0)));
  const fromAccounts = plan.accounts.filter((a) => a.deletedAt === undefined && a.closed !== true && a.onBudget).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const [from, setFrom] = useState<Id | null>(fromAccounts[0]?.id ?? null);
  const [date, setDate] = useState<ISODate>(today);
  const [memo, setMemo] = useState('');
  const groups = plan.categoryGroups.filter((g) => g.deletedAt === undefined && g.systemKind === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const [categoryId, setCategoryId] = useState<Id | null>(pairedId ?? null);
  const valid = amount > 0 && from !== null && categoryId !== null;
  const save = (): void => {
    if (amount <= 0 || from === null || categoryId === null) return;
    onClose();
    actions.run((p, ctx) => recordLoanPayment(p, ctx, { loanAccountId: account.id, fromAccountId: from, amount, date, ...(memo.trim() === '' ? {} : { memo: memo.trim() }), ...(pairedId === undefined ? { categoryId } : {}) }), {
      announce: `Recorded a ${moneyText(fmt, false)(amount)} payment to ${account.name}.`,
    });
  };
  return (
    <Dialog
      open
      title="Add Payment"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Record Payment
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <MoneyInput label="Payment Amount" variant="field" value={amount} format={fmt} onCommit={setAmount} {...(available !== null ? { help: `${moneyText(fmt, false)(available)} is available in the paired category.` } : {})} />
        <div className={styles.field}>
          <span className={styles.fieldLabel}>From Account</span>
          <Combobox label="From Account" groups={[{ id: 'accounts', label: 'Accounts', options: fromAccounts.map((a) => ({ id: a.id, label: a.name })) }]} value={from ?? ''} onChange={(id) => { setFrom(id); }} />
        </div>
        {pairedId === undefined && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Category</span>
            <Combobox
              label="Category"
              groups={groups.map((g) => ({ id: g.id, label: g.name, options: plan.categories.filter((c) => c.groupId === g.id && c.deletedAt === undefined).map((c) => ({ id: c.id, label: c.name })) }))}
              value={categoryId ?? ''}
              onChange={(id) => {
                setCategoryId(id);
              }}
            />
          </div>
        )}
        <DateInput label="Date" value={date} format={plan.settings.dateFormat} today={today} onCommit={setDate} />
        <TextInput label="Memo (optional)" value={memo} onChange={(e) => { setMemo(e.target.value); }} />
      </div>
    </Dialog>
  );
}

