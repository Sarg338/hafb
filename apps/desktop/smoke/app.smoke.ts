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
