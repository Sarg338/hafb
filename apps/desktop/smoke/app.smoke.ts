// Smoke suite (S3.5, ADR 0005): the real release app, the real store, a real plan file.
// Run: pnpm smoke (after pnpm build) or pnpm smoke:build.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Page } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { addMonths, compareMonths, monthOf } from '@hafb/shared';
import { launch, makeSandbox, type App, type Sandbox } from './harness.ts';
import { expectedReadyToAssign, expectedRows, importExport, norm, readGrid, todayLocal } from './planCheck.ts';

const MONEY = /^-?\$[\d,]+\.\d\d$/;

declare global {
  interface Window {
    hafbLaunchTiming?: { processToMainMs: number | null; processToFirstPaintMs: number | null };
  }
}

async function rta(page: Page): Promise<string> {
  const text = (await page.locator('[data-part=rta-amount]').textContent()) ?? '';
  return norm(text);
}

/** Click a category's Assigned cell (it opens the editor, as in YNAB), type, and press Enter. */
async function assignVia(page: Page, category: string, text: string): Promise<void> {
  const row = page.locator('[role=row]', { has: page.locator('[data-col=category]', { hasText: new RegExp(`^${category}`) }) });
  await row.locator('[data-col=assigned]').click();
  const input = page.getByRole('textbox', { name: new RegExp(`^Assigned in .* for ${category}$`) });
  await input.fill(text);
  await input.press('Enter');
}

async function assignedText(page: Page, category: string): Promise<string> {
  const row = page.locator('[role=row]', { has: page.locator('[data-col=category]', { hasText: new RegExp(`^${category}`) }) });
  return ((await row.locator('[data-col=assigned]').textContent()) ?? '').trim();
}

/** Wait for the animated Ready to Assign figure to settle on a new value. */
async function rtaSettled(page: Page, previous: string): Promise<string> {
  await page.waitForFunction((prev) => document.querySelector('[data-part=rta-amount]')?.textContent.trim() !== prev, previous, { timeout: 5000 });
  await page.waitForTimeout(300);
  return rta(page);
}

void describe('welcome', () => {
  let box: Sandbox;
  let app: App;
  before(async () => {
    box = makeSandbox();
    app = await launch(box);
  });
  after(async () => {
    await app.close();
    box.cleanup();
  });

  void test('shows the welcome screen when no plan is open', async () => {
    const { page } = app;
    await page.getByRole('heading', { name: 'Welcome to HAFB' }).waitFor();
    for (const name of [/Import YNAB export/, /Open plan/, /New plan|Create/]) {
      assert.ok(await page.getByRole('button', { name }).first().isVisible(), `button ${String(name)}`);
    }
    assert.equal(await page.title(), 'HAFB');
  });

  void test('records launch timing within the 1.5 s budget', async () => {
    const t = await app.page.waitForFunction(() => window.hafbLaunchTiming ?? null, null, { timeout: 5000 }).then((h) => h.jsonValue());
    const paint = t?.processToFirstPaintMs ?? null;
    console.log(`launch timing: ${JSON.stringify(t)}`);
    assert.ok(paint !== null && paint < 1500, `process start → first paint ${String(paint)} ms`);
  });
});

void describe('a plan opened with --open', () => {
  let box: Sandbox;
  let app: App;
  before(async () => {
    box = makeSandbox();
    app = await launch(box, ['--open', box.planPath]);
  });
  after(async () => {
    await app.close();
    box.cleanup();
  });

  void test('opens the plan: sidebar, title, Ready to Assign', async () => {
    const { page } = app;
    await page.getByRole('navigation', { name: 'Plan navigation' }).waitFor();
    await page.locator('[data-part=rta-amount]').waitFor();
    assert.match(await rta(page), MONEY);
    assert.equal(await page.title(), 'Sample Household – HAFB');
    assert.ok(await page.getByText('Everyday Checking').first().isVisible());
  });

  void test('navigates Plan → Reflect → All Accounts → an account', async () => {
    const { page } = app;
    const nav = page.getByRole('navigation', { name: 'Plan navigation' });
    await nav.getByRole('link', { name: 'Reflect' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/reflect'));
    await page.getByRole('tab', { name: 'Spending Breakdown' }).waitFor();
    await nav.getByRole('link', { name: 'All Accounts' }).click();
    await page.waitForFunction(() => location.hash === '#/accounts');
    await page.getByRole('heading', { name: 'All Accounts' }).waitFor();
    await nav.getByRole('link', { name: /Visa Rewards/ }).first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/accounts/'));
    await page.getByRole('heading', { name: 'Visa Rewards' }).waitFor();
    await nav.getByRole('link', { name: 'Plan', exact: true }).click();
    await page.locator('[data-part=rta-amount]').waitFor();
  });

  void test('assign, undo and redo go through the store', async () => {
    const { page } = app;
    const before = await rta(page);
    await assignVia(page, 'Electric', '140');
    const assigned = await rtaSettled(page, before);
    assert.notEqual(assigned, before);
    await page.locator('body').click({ position: { x: 5, y: 600 } }).catch(() => undefined);
    await page.keyboard.press('Control+z');
    assert.equal(await rtaSettled(page, assigned), before);
    await page.getByText(/^Undid/).first().waitFor();
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await rtaSettled(page, before), assigned);
  });

  void test('keyboard: ? lists shortcuts; G then R navigates; Ctrl+B collapses the sidebar', async () => {
    const { page } = app;
    await page.locator('#main').focus();
    await page.keyboard.press('Shift+?');
    const overlay = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await overlay.waitFor();
    assert.ok(await overlay.getByText('Undo').first().isVisible());
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached' });
    await page.locator('#main').focus();
    await page.keyboard.press('g');
    await page.keyboard.press('r');
    await page.waitForFunction(() => location.hash.startsWith('#/reflect'));
    await page.keyboard.press('Control+b');
    await page.getByRole('button', { name: 'Expand sidebar' }).waitFor();
    await page.keyboard.press('Control+b');
    await page.getByRole('link', { name: 'Reflect' }).waitFor();
  });

  void test('View options switch the theme', async () => {
    const { page } = app;
    await page.getByRole('button', { name: /View options/ }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).or(page.getByRole('menuitemcheckbox', { name: 'Dark' })).or(page.getByRole('menuitem', { name: 'Dark' })).first().click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.getByRole('button', { name: /View options/ }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).or(page.getByRole('menuitemcheckbox', { name: 'Light' })).or(page.getByRole('menuitem', { name: 'Light' })).first().click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  });
});

void describe('persistence across a relaunch', () => {
  let box: Sandbox;
  before(() => {
    box = makeSandbox();
  });
  after(() => {
    box.cleanup();
  });

  void test('an assignment survives quitting and reopening', async () => {
    const first = await launch(box, ['--open', box.planPath]);
    await first.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    await assignVia(first.page, 'Electric', '155.55');
    await first.page.waitForTimeout(800);
    await first.close();

    const second = await launch(box, ['--open', box.planPath]);
    await second.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    assert.equal(await assignedText(second.page, 'Electric'), '$155.55');
    await second.close();
  });
});

void describe('performance in the real webview', () => {
  let box: Sandbox;
  let app: App;
  before(async () => {
    box = makeSandbox();
    app = await launch(box);
  });
  after(async () => {
    await app.close();
    box.cleanup();
  });

  void test('the 50k-row grid benchmark scrolls with no missed frames', { timeout: 120_000 }, async () => {
    const { page } = app;
    await page.evaluate(() => {
      location.hash = '#/gallery?section=grid-benchmark&bench=run';
    });
    const result = await page.waitForFunction(
      () => {
        const el = document.getElementById('bench-result');
        return el?.getAttribute('data-state') === 'done' ? (el.getAttribute('data-result') ?? '') : null;
      },
      null,
      { timeout: 110_000, polling: 500 },
    );
    const text = (await result.jsonValue()) ?? '';
    console.log(`grid benchmark: ${text}`);
    const parsed: unknown = JSON.parse(text);
    const runs: unknown[] = Array.isArray(parsed) ? parsed : [];
    assert.ok(runs.length > 0, 'benchmark produced results');
    for (const run of runs) {
      assert.ok(typeof run === 'object' && run !== null && 'missedFrames' in run, 'result shape');
      assert.equal(run.missedFrames, 0, `missed frames in ${JSON.stringify(run)}`);
    }
  });
});

// ---- S4.1 exit: the Plan screen matches the engine for real YNAB data, month by month ----------
// Sources are local-only fixtures (git-ignored): the public sample export and Sarg's YNAB trial
// export. Missing fixtures skip the check.
const LOCAL = join(import.meta.dirname, '..', '..', '..', 'packages', 'engine', 'test', 'fixtures', 'local');
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function realExports(): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  const pub = join(LOCAL, 'ynab-public-sample');
  if (existsSync(join(pub, 'Plan.csv'))) out.push({ label: 'public sample', path: pub });
  const trial = join(LOCAL, 'ynab-trial');
  const zip = existsSync(trial) ? readdirSync(trial).find((f) => f.endsWith('.zip')) : undefined;
  if (zip !== undefined) out.push({ label: 'trial plan', path: join(trial, zip) });
  return out;
}

for (const source of realExports()) {
  void describe(`the Plan screen matches the engine month by month (${source.label})`, () => {
    let box: Sandbox;
    let app: App;
    let plan: Awaited<ReturnType<typeof importExport>>;
    before(async () => {
      plan = await importExport(source.path);
      box = makeSandbox(plan);
      app = await launch(box, ['--open', box.planPath]);
    });
    after(async () => {
      await app.close();
      box.cleanup();
    });

    void test('every category, group and Ready to Assign, in every month', { timeout: 900_000 }, async () => {
      const { page } = app;
      await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
      await page.getByRole('button', { name: 'Display options' }).click();
      await page.getByRole('menuitem', { name: /Expand all groups/ }).click();
      const today = todayLocal();
      const last = monthOf(today);
      const mismatches: string[] = [];
      let months = 0;
      let rows = 0;
      for (let m = plan.settings.firstMonth ?? last; compareMonths(m, last) <= 0; m = addMonths(m, 1)) {
        const [y, mo] = m.split('-');
        const title = `${MONTH_NAMES[Number(mo) - 1] ?? ''} ${y ?? ''}. Choose a month`;
        await page.evaluate((mm) => {
          location.hash = `#/plan?month=${mm}`;
        }, m);
        await page.locator(`[aria-label="${title}"]`).waitFor();
        const rtaWanted = expectedReadyToAssign(plan, m, today);
        await page
          .waitForFunction((want) => (document.querySelector('[data-part=rta-amount]')?.textContent ?? '').replace(/\s+/g, ' ').trim() === want, rtaWanted, { timeout: 5000 })
          .catch(() => undefined);
        await page.waitForTimeout(350); // Available pills tween to the new month's values.
        const rtaShown = await rta(page);
        if (rtaShown !== rtaWanted) mismatches.push(`${m} Ready to Assign: shown ${rtaShown}, engine ${rtaWanted}`);
        const shown = new Map((await readGrid(page)).map((r) => [r.id, r]));
        for (const want of expectedRows(plan, m, today)) {
          const got = shown.get(want.id);
          if (!got) {
            mismatches.push(`${m} ${want.name}: not shown`);
            continue;
          }
          for (const k of ['name', 'assigned', 'activity', 'available'] as const) {
            if (got[k] !== want[k]) mismatches.push(`${m} ${want.name} ${k}: shown ${got[k]}, engine ${want[k]}`);
          }
          shown.delete(want.id);
          rows += 1;
        }
        for (const extra of shown.values()) mismatches.push(`${m} ${extra.name}: shown but not in the engine's rows`);
        months += 1;
      }
      console.log(`${source.label}: ${String(months)} months, ${String(rows)} rows compared, ${String(mismatches.length)} mismatches`);
      assert.deepEqual(mismatches.slice(0, 20), []);
    });
  });
}

// ---- S4.2 exit: every Plan edit is undoable, with a toast ----------------------------------------
void describe('plan editing', () => {
  let box: Sandbox;
  let app: App;
  before(async () => {
    box = makeSandbox();
    app = await launch(box, ['--open', box.planPath]);
    await app.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
  });
  after(async () => {
    await app.close();
    box.cleanup();
  });

  const nameButton = (page: Page, name: string) => page.locator('[data-drag-id]', { hasText: new RegExp(`^${name}$`) });
  const rowNames = (page: Page) => page.$$eval('[role=row][data-row-id] [data-drag-id]', (els) => els.map((e) => e.textContent.trim()));
  const toast = (page: Page, text: RegExp) => page.locator('[role=status]', { hasText: text }).first();
  const undo = async (page: Page): Promise<void> => {
    await page.locator('#main').focus();
    await page.keyboard.press('Control+z');
  };

  void test('rename a category, then undo', async () => {
    const { page } = app;
    await nameButton(page, 'Electric').click();
    await page.getByRole('textbox', { name: 'Category name' }).fill('Electricity');
    await page.keyboard.press('Enter');
    await nameButton(page, 'Electricity').waitFor();
    await undo(page);
    await toast(page, /Undid: Rename category: Electric/).waitFor();
    await nameButton(page, 'Electric').waitFor();
  });

  void test('add a group and a category, then undo both', async () => {
    const { page } = app;
    await page.getByRole('button', { name: 'Category Group' }).click();
    await page.getByRole('textbox', { name: 'New group name' }).fill('Someday');
    await page.keyboard.press('Enter');
    const group = page.locator('[role=row]', { has: page.locator('[data-drag=group]', { hasText: 'Someday' }) });
    await group.waitFor();
    await group.hover();
    await group.getByRole('button', { name: 'Add a category to Someday' }).click();
    await page.getByRole('textbox', { name: 'New category name' }).fill('Sailboat');
    await page.keyboard.press('Enter');
    await nameButton(page, 'Sailboat').waitFor();
    await undo(page);
    await nameButton(page, 'Sailboat').waitFor({ state: 'detached' });
    await undo(page);
    await group.waitFor({ state: 'detached' });
  });

  void test('hide from the row menu; the toast offers Undo', async () => {
    const { page } = app;
    const before = await rta(page);
    const row = page.locator('[role=row]', { has: nameButton(page, 'Groceries') });
    await row.locator('[data-col=activity]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Hide' }).click();
    const note = toast(page, /Hid “Groceries”/);
    await note.waitFor();
    assert.ok((await rowNames(page)).every((n) => n !== 'Groceries'), 'Groceries left its group (Hidden Categories is collapsed)');
    assert.equal(await rta(page), before);
    await note.getByRole('button', { name: 'Undo' }).click();
    await nameButton(page, 'Groceries').waitFor();
  });

  void test('delete with reassignment keeps Ready to Assign; undo restores it', async () => {
    const { page } = app;
    const before = await rta(page);
    await nameButton(page, 'Pets').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: /Delete Pets/ });
    await dialog.getByRole('combobox').fill('Household');
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Reassign and delete' }).click();
    await toast(page, /Deleted “Pets”/).waitFor();
    await nameButton(page, 'Pets').waitFor({ state: 'detached' });
    assert.equal(await rta(page), before);
    await undo(page);
    await nameButton(page, 'Pets').waitFor();
    assert.equal(await rta(page), before);
  });

  void test('drag a category to a new place, undo, and the order survives a relaunch', async () => {
    const { page } = app;
    const order = async (): Promise<string[]> => (await rowNames(page)).filter((n) => ['Mortgage', 'Car Payment', 'Streaming'].includes(n));
    assert.deepEqual(await order(), ['Mortgage', 'Car Payment', 'Streaming']);
    const src = await nameButton(page, 'Streaming').boundingBox();
    const dst = await nameButton(page, 'Mortgage').boundingBox();
    assert.ok(src && dst);
    await page.mouse.move(src.x + 8, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 8, src.y - 20, { steps: 4 });
    await page.mouse.move(dst.x + 8, dst.y + 2, { steps: 8 });
    await page.mouse.up();
    await toast(page, /Moved “Streaming”/).waitFor();
    assert.deepEqual(await order(), ['Streaming', 'Mortgage', 'Car Payment']);
    await undo(page);
    await page.waitForTimeout(200);
    assert.deepEqual(await order(), ['Mortgage', 'Car Payment', 'Streaming']);
    // Redo, quit, reopen: the new order is in the file.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(800);
    await app.close();
    app = await launch(box, ['--open', box.planPath]);
    await app.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    const reopened = (await rowNames(app.page)).filter((n) => ['Mortgage', 'Car Payment', 'Streaming'].includes(n));
    assert.deepEqual(reopened, ['Streaming', 'Mortgage', 'Car Payment']);
  });
});

// ---- S4.3 exit: moving money, and fixing overspending with the keyboard only ------------------------
void describe('moving money', () => {
  let box: Sandbox;
  let app: App;
  before(async () => {
    box = makeSandbox();
    app = await launch(box, ['--open', box.planPath]);
    await app.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
  });
  after(async () => {
    await app.close();
    box.cleanup();
  });

  const cell = (page: Page, name: string, col: string) =>
    page.locator('[role=row]', { has: page.locator('[data-drag-id]', { hasText: new RegExp(`^${name}$`) }) }).locator(`[data-col=${col}]`);
  // The pill's text without its screen-reader prefix ("overspent: ").
  const shown = async (page: Page, name: string): Promise<string> => norm(await cell(page, name, 'available').innerText()).replace(/^[a-z ]+: /, '');
  const focusInfo = (page: Page) =>
    page.evaluate(() => {
      const a = document.activeElement;
      return { col: a?.getAttribute('data-col') ?? null, row: a?.closest('[role=row]')?.querySelector('[data-drag-id]')?.textContent ?? null };
    });

  void test('cover overspending with the keyboard only (YNAB workflow)', async () => {
    const { page } = app;
    // Into the grid by Tab from the toolbar, then arrows to the overspent category's Available.
    // The grid moves focus on the next frame: give each key a moment before reading where it went.
    const press = async (key: string): Promise<void> => {
      await page.keyboard.press(key);
      await page.waitForTimeout(60);
    };
    await page.getByRole('button', { name: 'Category Group' }).focus();
    for (let i = 0; i < 15 && !(await page.evaluate(() => document.activeElement?.hasAttribute('data-cell') ?? false)); i++) await press('Tab');
    for (let i = 0; i < 60 && (await focusInfo(page)).row !== 'Car Maintenance'; i++) await press('ArrowDown');
    await press('End');
    assert.deepEqual(await focusInfo(page), { col: 'available', row: 'Car Maintenance' });
    assert.match(await shown(page, 'Car Maintenance'), /^-\$/);
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Cover overspending from' }).waitFor();
    await page.keyboard.type('Groceries');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Cover overspending from' }).waitFor({ state: 'detached' });
    await page.waitForTimeout(400);
    assert.equal(await shown(page, 'Car Maintenance'), '$0.00');
    assert.deepEqual(await focusInfo(page), { col: 'available', row: 'Car Maintenance' });
    // One undo puts it back.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    assert.match(await shown(page, 'Car Maintenance'), /^-\$/);
  });

  void test('move money keeps Ready to Assign; the breakdown adds up', async () => {
    const { page } = app;
    const before = await rta(page);
    await cell(page, 'Groceries', 'available').click();
    const dialog = page.getByRole('dialog', { name: 'Move money' });
    await dialog.waitFor();
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('20');
    await dialog.getByRole('combobox').fill('Ready to Assign');
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'OK' }).click();
    const after = await rtaSettled(page, before);
    const cents = (s: string): number => Math.round(Number(s.replace(/[^\d.-]/g, '')) * 100);
    assert.equal(cents(after) - cents(before), 2000);
    await page.locator('button:has([data-part=rta-amount])').click();
    const bd = page.getByRole('dialog', { name: 'Ready to Assign Breakdown' });
    await bd.waitFor();
    assert.ok((await bd.innerText()).includes(after), 'the breakdown total is the banner amount');
    await page.keyboard.press('Escape');
  });

  void test('over-assigning shows Fix This; future-month shortfalls warn without taking this month below zero', async () => {
    const { page } = app;
    const assignManually = async (amount: string, to: string): Promise<void> => {
      await page.getByRole('button', { name: 'Assign', exact: true }).click();
      const pop = page.getByRole('dialog', { name: 'Assign' });
      await pop.getByRole('radio', { name: 'Manually' }).click();
      await page.waitForTimeout(150);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(amount);
      await pop.getByRole('combobox').fill(to);
      await page.keyboard.press('Enter');
      await pop.getByRole('button', { name: 'Assign', exact: true }).click();
      await pop.waitFor({ state: 'detached' });
      await page.waitForTimeout(400);
    };
    await assignManually('5000', 'Gifts');
    assert.match(await rta(page), /^-\$/);
    await page.getByRole('button', { name: 'Fix This' }).click();
    const fix = page.getByRole('dialog', { name: 'Un-assign money from' });
    await fix.getByRole('combobox').fill('Gifts');
    await page.keyboard.press('Enter');
    await fix.getByRole('button', { name: 'OK' }).click();
    await page.waitForTimeout(400);
    assert.equal(await rta(page), '$0.00');
    // November: assign more than there is; October stays at $0.00, with a warning in the inspector.
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: 'Today' }).waitFor();
    // November already starts short (October's cash overspending comes off it), so it shows Fix
    // This rather than Assign; assign in the grid instead.
    await assignVia(page, 'Groceries', '9000');
    await page.waitForTimeout(400);
    assert.match(await rta(page), /^-\$/);
    await page.getByRole('button', { name: 'Today' }).click();
    await page.waitForTimeout(500);
    assert.equal(await rta(page), '$0.00');
    // Esc deselects (the inspector then shows the month), as in YNAB.
    await cell(page, 'Groceries', 'activity').click();
    await page.keyboard.press('Escape');
    await page.locator('section', { hasText: 'Assigned in Future Months' }).getByText(/November is .* short/).waitFor();
  });
});

// ---- S4.4 exit: every account type creates correctly; totals tie to the engine ---------------------
void describe('accounts', () => {
  let box: Sandbox;
  let app: App;
  before(async () => {
    box = makeSandbox();
    app = await launch(box, ['--open', box.planPath]);
    await app.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
  });
  after(async () => {
    await app.close();
    box.cleanup();
  });

  const TYPES: { label: string; section: string; debt: boolean; onBudget: boolean }[] = [
    { label: 'Checking', section: 'cash', debt: false, onBudget: true },
    { label: 'Savings', section: 'cash', debt: false, onBudget: true },
    { label: 'Cash', section: 'cash', debt: false, onBudget: true },
    { label: 'Credit Card', section: 'credit', debt: true, onBudget: true },
    { label: 'Line of Credit', section: 'credit', debt: true, onBudget: true },
    { label: 'Mortgage', section: 'loans', debt: true, onBudget: false },
    { label: 'Auto Loan', section: 'loans', debt: true, onBudget: false },
    { label: 'Student Loan', section: 'loans', debt: true, onBudget: false },
    { label: 'Personal Loan', section: 'loans', debt: true, onBudget: false },
    { label: 'Medical Debt', section: 'loans', debt: true, onBudget: false },
    { label: 'Other Debt', section: 'loans', debt: true, onBudget: false },
    { label: 'Asset (e.g. Investment)', section: 'tracking', debt: false, onBudget: false },
    { label: 'Liability', section: 'tracking', debt: true, onBudget: false },
  ];
  /** The money in a sidebar row or heading ("Test 1 Checking $100.00" → 10000), not digits in names. */
  const cents = (s: string): number => {
    const m = /(-?)\$([\d,]+)\.(\d\d)/.exec(s);
    return m ? (m[1] === '-' ? -1 : 1) * (Number((m[2] ?? '0').replace(/,/g, '')) * 100 + Number(m[3])) : 0;
  };

  void test('one of each type: balances, section totals and Ready to Assign tie out', { timeout: 300_000 }, async () => {
    const { page } = app;
    const sidebar = page.getByRole('navigation', { name: 'Plan navigation' });
    const sectionTotal = async (id: string): Promise<number> => {
      const head = sidebar.getByRole('button', { name: new RegExp(id, 'i') }).first();
      return (await head.count()) === 0 ? 0 : cents(await head.innerText());
    };
    const totalsBefore = new Map<string, number>();
    for (const s of ['cash', 'credit', 'loans', 'tracking']) totalsBefore.set(s, await sectionTotal(s));
    const rtaBefore = cents(await rta(page));
    let rtaChange = 0;
    for (const [i, t] of TYPES.entries()) {
      const name = `Test ${String(i + 1)} ${t.label.split(' ')[0] ?? ''}`;
      await sidebar.getByRole('button', { name: 'Add Account' }).click();
      const dlg = page.getByRole('dialog', { name: 'Add an account' });
      await dlg.getByRole('textbox', { name: 'Give it a nickname' }).fill(name);
      await dlg.getByRole('button', { name: /What type of account/ }).click();
      await page.getByRole('option', { name: t.label, exact: true }).click();
      const amount = dlg.getByRole('textbox', { name: t.debt ? 'How much do you owe on it today?' : 'What is your current account balance?' });
      await amount.click();
      await page.waitForTimeout(100);
      await page.keyboard.press('Control+a');
      await page.keyboard.type('100');
      await page.keyboard.press('Tab');
      await dlg.getByRole('button', { name: 'Add Account' }).click();
      await page.getByRole('heading', { name, level: 1 }).waitFor();
      const link = sidebar.locator(`[data-section=${t.section}]`, { hasText: name });
      assert.equal(cents(await link.innerText()), t.debt ? -10000 : 10000, `${name} balance`);
      // Cash starting balances are inflows; a card's starting debt stays off Ready to Assign (YNAB).
      if (t.onBudget && !t.debt) rtaChange += 10000;
    }
    for (const s of ['cash', 'credit', 'loans', 'tracking']) {
      const added = TYPES.filter((t) => t.section === s).reduce((sum, t) => sum + (t.debt ? -10000 : 10000), 0);
      assert.equal(await sectionTotal(s), (totalsBefore.get(s) ?? 0) + added, `${s} total`);
    }
    await sidebar.getByRole('link', { name: 'Plan', exact: true }).click();
    await page.locator('[data-part=rta-amount]').waitFor();
    await page.waitForTimeout(400);
    assert.equal(cents(await rta(page)) - rtaBefore, rtaChange, 'starting balances of on-budget accounts are inflows to Ready to Assign');
  });

  void test('edit balance adds an adjustment; close with a balance zeroes it; reopen; star', async () => {
    const { page } = app;
    const sidebar = page.getByRole('navigation', { name: 'Plan navigation' });
    const link = (name: string) => sidebar.locator('[data-section=cash]', { hasText: name });
    await link('Test 1 Checking').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit account…' }).click();
    const ed = page.getByRole('dialog', { name: 'Edit Account' });
    const bal = ed.getByRole('textbox', { name: 'Working balance' });
    await bal.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('150');
    await page.keyboard.press('Tab');
    await ed.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(400);
    assert.equal(cents(await link('Test 1 Checking').innerText()), 15000);
    await link('Test 1 Checking').click();
    await page.getByRole('heading', { name: 'Test 1 Checking', level: 1 }).waitFor();
    await page.getByText('Manual Balance Adjustment').first().waitFor();
    // Star from the register header.
    await page.getByRole('button', { name: 'Star Test 1 Checking' }).click();
    await sidebar.locator('[data-section=starred]', { hasText: 'Test 1 Checking' }).waitFor();
    // Close with a balance: confirm, zeroed, listed under Closed; then reopen.
    await link('Test 1 Checking').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close account…' }).click();
    await page.getByRole('dialog', { name: /Close Test 1 Checking/ }).getByRole('button', { name: 'Zero it and close' }).click();
    await sidebar.getByRole('button', { name: /closed/i }).click();
    const closed = sidebar.locator('[data-section=closed]', { hasText: 'Test 1 Checking' });
    await closed.waitFor();
    assert.equal(cents(await closed.innerText()), 0);
    await closed.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reopen account' }).click();
    await link('Test 1 Checking').waitFor();
  });
});

// ---- S4.5 exit: a month of transactions entered with the keyboard only ---------------------------
void describe('register', () => {
  let box: Sandbox;
  const running: App[] = [];
  const open = async (): Promise<App> => {
    const a = await launch(box, ['--open', box.planPath]);
    running.push(a);
    return a;
  };
  before(() => {
    box = makeSandbox();
  });
  after(async () => {
    // A failed assertion must not leave the app holding the plan file open.
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });
  const cents = (s: string): number => {
    const m = /(-?)\$([\d,]+)\.(\d\d)/.exec(s);
    return m ? (m[1] === '-' ? -1 : 1) * (Number((m[2] ?? '0').replace(/,/g, '')) * 100 + Number(m[3])) : 0;
  };
  /** "12.3" → 1230: what was typed into an amount field. */
  const typed = (s: string | undefined): number => {
    const [whole = '0', frac = ''] = (s ?? '0').split('.');
    return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  };
  // Payee and category are typed, then Enter picks the first match (or creates the payee).
  const MONTH: { date: string; payee: string; category: string; memo: string; out?: string; in?: string }[] = [
    { date: '09/01/2026', payee: 'Acme Logistics', category: 'Ready to Assign', memo: 'Paycheck', in: '2640' },
    { date: '09/03/2026', payee: 'Corner Bakery', category: 'Groceries', memo: 'bread', out: '12.34' },
    { date: '09/07/2026', payee: 'Metro Water', category: 'Water', memo: '', out: '61.2' },
    { date: '09/12/2026', payee: 'Cinema 8', category: 'Entertainment', memo: 'matinee', out: '18' },
    { date: '09/18/2026', payee: 'QuickFuel', category: 'Gas', memo: '', out: '44.07' },
    { date: '09/22/2026', payee: 'Valley Clinic', category: 'Medical', memo: 'co-pay', out: '25' },
    { date: '09/28/2026', payee: 'Corner Bakery', category: 'Groceries', memo: 'cake', out: '31.99' },
  ];

  void test('a month by keyboard, a transfer, clear/flag/delete/undo; balances tie out and survive a relaunch', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    const sidebar = page.getByRole('navigation', { name: 'Plan navigation' });
    const link = (name: string) => sidebar.locator('[data-section=cash]', { hasText: name });
    await link('Wallet').click();
    const grid = page.getByRole('treegrid', { name: /Wallet transactions/ });
    await grid.waitFor();
    const editor = grid.locator('[data-row-editor]').first();
    const pick = async (text: string) => {
      await page.keyboard.type(text);
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
    };
    const newRow = async () => {
      await page.locator('#main').focus();
      await page.keyboard.press('Shift+N');
      await editor.waitFor();
    };
    let expected = cents(await link('Wallet').innerText());
    for (const t of MONTH) {
      await newRow();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(t.date);
      await page.keyboard.press('Tab');
      await pick(t.payee);
      await page.keyboard.press('Tab');
      await pick(t.category);
      await page.keyboard.press('Tab');
      await page.keyboard.type(t.memo);
      await page.keyboard.press('Tab');
      if (t.out !== undefined) await page.keyboard.type(t.out);
      await page.keyboard.press('Tab');
      if (t.in !== undefined) await page.keyboard.type(t.in);
      await page.keyboard.press('Enter');
      await editor.waitFor({ state: 'detached' });
      expected += typed(t.in) - typed(t.out);
    }
    assert.equal(cents(await link('Wallet').innerText()), expected, 'the sidebar balance adds up the month');
    const bakery = grid.locator('[role=row][data-row-id]', { hasText: 'cake' });
    assert.match(norm(await bakery.innerText()), /09\/28\/2026.*Corner Bakery.*Groceries.*cake.*\$31\.99/);

    // A transfer to savings: no category needed; both balances move.
    const savingsBefore = cents(await link('Rainy Day Savings').innerText());
    await newRow();
    await page.keyboard.press('Tab');
    await pick('Rainy');
    await grid.getByRole('textbox', { name: 'Outflow' }).click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await editor.waitFor({ state: 'detached' });
    expected -= 2000;
    assert.equal(cents(await link('Rainy Day Savings').innerText()), savingsBefore + 2000);
    const xfer = grid.locator('[role=row][data-row-id]', { hasText: 'Transfer : Rainy Day Savings' }).first();
    assert.match(norm(await xfer.innerText()), /Category not needed/);

    // Edit a memo; C toggles cleared (cash rows start cleared); Shift+F 2 flags orange; Delete, then Ctrl+Z restores.
    await bakery.locator('[data-col=date]').click();
    await page.keyboard.press('Enter');
    await grid.getByRole('textbox', { name: 'Memo' }).fill('birthday cake');
    await page.keyboard.press('Enter');
    const cake = grid.locator('[role=row][data-row-id]', { hasText: 'birthday cake' });
    await cake.waitFor();
    await cake.locator('[data-col=date]').click();
    await page.keyboard.press('c');
    await page.keyboard.press('Shift+F');
    await page.keyboard.press('2');
    await page.waitForTimeout(200);
    assert.match((await cake.locator('[data-col=flag] button').getAttribute('aria-label')) ?? '', /Orange/);
    await page.keyboard.press('Delete');
    await cake.waitFor({ state: 'detached' });
    assert.equal(cents(await link('Wallet').innerText()), expected + 3199);
    await page.keyboard.press('Control+z');
    await cake.waitFor();
    assert.equal(cents(await link('Wallet').innerText()), expected);

    // The newest row's running balance is the working balance.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show running balance' }).click();
    const top = grid.locator('[role=row][data-row-id]').nth(1).locator('[data-col=balance]'); // under the Scheduled header
    await top.waitFor();
    assert.equal(cents(await top.innerText()), expected);
    await page.waitForTimeout(800);
    await app.close();

    const again = await open();
    // It reopens where it was left: the Wallet register.
    await again.page.getByRole('treegrid', { name: /Wallet transactions/ }).waitFor();
    const wallet = again.page.getByRole('navigation', { name: 'Plan navigation' }).locator('[data-section=cash]', { hasText: 'Wallet' });
    assert.equal(cents(await wallet.innerText()), expected, 'the month survives a relaunch');
    await wallet.click();
    const cake2 = again.page.locator('[role=row][data-row-id]', { hasText: 'birthday cake' });
    await cake2.waitFor();
    assert.match((await cake2.locator('[data-col=cleared] button').getAttribute('aria-label')) ?? '', /^Uncleared/);
    await again.close();
  });
});
