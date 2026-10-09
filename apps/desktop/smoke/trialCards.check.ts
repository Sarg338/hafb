// One-off check (not part of the suite): the card screens' numbers on the YNAB trial plan export,
// against what YNAB itself showed on 2026-10-08. Run: node --experimental-strip-types smoke/trialCards.check.ts
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { planBudget } from '@hafb/store';
import { activityLines, cardHeader, paymentActivity, recordPaymentAmount } from '../src/screens/shared/cardModel.ts';
import { importExport } from './planCheck.ts';

const dir = join(import.meta.dirname, '..', '..', '..', 'packages', 'engine', 'test', 'fixtures', 'local', 'ynab-trial');
const zip = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.zip')) : undefined;
if (zip === undefined) throw new Error('no trial export');
const plan = await importExport(join(dir, zip));
const state = planBudget(plan, { today: '2026-10-08' });
for (const name of ['amex', 'visa']) {
  const card = plan.accounts.find((a) => a.name === name);
  const pay = plan.categories.find((c) => c.creditCardAccountId === card?.id);
  const cm = state.byMonth['2026-10']?.categories[pay?.id ?? ''];
  if (!card || !cm) throw new Error(`no ${name}`);
  console.log(name, JSON.stringify({ activity: paymentActivity(cm), header: cardHeader(plan, state, card.id), record: recordPaymentAmount(plan, state, card.id), lines: activityLines(plan, pay?.id ?? '', '2026-10').map((l) => `${l.date} ${l.payee} ${l.category} ${String(l.amount)}`) }));
}
