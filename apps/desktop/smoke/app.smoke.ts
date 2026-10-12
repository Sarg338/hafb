// Smoke suite (S3.5, ADR 0005): the real release app, the real store, a real plan file.
// Run: pnpm smoke (after pnpm build) or pnpm smoke:build.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import type { Page } from 'playwright-core';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, join } from 'node:path';
import { netWorth, spendingBreakdown } from '@hafb/engine';
import { addDays, addMonths, addMonthsToDate, compareMonths, formatMoney, minor, monthOf } from '@hafb/shared';
import { addScheduled, applyChanges, budgetSnapshot, postLoanCharges, readZip, ynabExport, type PlanData } from '@hafb/store';
import { buildSamplePlan } from '../src/design/sample.ts';
import { EXE, launch, makeSandbox, type App, type Sandbox } from './harness.ts';
import { buildLargePlan, LARGE_PLAN_TRANSACTIONS } from './largePlan.ts';
import { expectedReadyToAssign, expectedRows, importExport, norm, readGrid, todayLocal } from './planCheck.ts';

const MONEY = /^-?\$[\d,]+\.\d\d$/;

declare global {
  interface Window {
    /** axe-core, injected by the accessibility smoke test (S7.4). */
    axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> };
  }
}

declare global {
  interface Window {
    hafbLaunchTiming?: { processToMainMs: number | null; processToFirstPaintMs: number | null };
    /** Set once an opened plan has painted (Shell.tsx, S8.1). */
    hafbOpenTiming?: { transactions: number; readyMs: number; processToReadyMs: number | null };
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
    for (const name of [/Import YNAB export/, /Open plan/, /new plan/i]) {
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

// ---- S8.3: nothing leaves the PC -------------------------------------------------------------------
// HAFB has no network code; its WebView2 runs behind a closed proxy (src-tauri/src/webview_env.rs).
// The one known exception is WebView2's own Microsoft-account library (OneAuth) in the WebView2
// browser process, on PCs signed into a Microsoft account (docs/privacy.md). Anything else fails:
// a connection from hafb.exe itself, from WebView2's network service (the proxy no longer
// applied), or from the browser process to anything but HTTPS.
void describe('privacy', () => {
  let box: Sandbox;
  before(() => {
    box = makeSandbox();
  });
  after(() => {
    box.cleanup();
  });

  void test('using the app makes no outside connection except WebView2’s documented account lookup', { timeout: 180_000 }, async () => {
    const out = join(box.root, 'net.jsonl');
    const stop = join(box.root, 'net.stop');
    const app = await launch(box, ['--open', box.planPath]);
    const watcher = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, 'netwatch.ps1'), '-RootPid', String(app.process.pid), '-Out', out, '-Stop', stop], { stdio: 'ignore' });
    try {
      const { page } = app;
      const nav = page.getByRole('navigation', { name: 'Plan navigation' });
      await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
      await nav.getByRole('link', { name: 'All Accounts' }).click();
      await page.waitForTimeout(1000);
      await nav.getByRole('link', { name: 'Reflect', exact: true }).click();
      await page.waitForTimeout(1000);
      await nav.getByRole('link', { name: 'Plan', exact: true }).click();
      // WebView2 asks for its experiment config at start and component updates about a minute in.
      await page.waitForTimeout(75_000);
    } finally {
      writeFileSync(stop, 'stop');
      await new Promise((r) => setTimeout(r, 1500));
      watcher.kill();
      await app.close();
    }
    interface Seen { process: string; type: string; remote: string; port: number }
    const isSeen = (v: unknown): v is Seen => typeof v === 'object' && v !== null && 'process' in v && 'type' in v && 'port' in v;
    const seen = readFileSync(out, 'utf8')
      .split('\n')
      .map((l) => l.trim()) // trim also drops '\r' and PowerShell's byte-order mark
      .filter(Boolean)
      .map((l): unknown => JSON.parse(l))
      .filter(isSeen);
    console.log(`outside connections: ${JSON.stringify(seen)}`);
    const unexpected = seen.filter((c) => !(c.process === 'msedgewebview2.exe' && c.type === 'browser' && c.port === 443));
    assert.deepEqual(unexpected, [], 'only WebView2’s account lookup may leave the PC');
    assert.ok(seen.length <= 2, `at most one account lookup per launch (one per address family): ${JSON.stringify(seen)}`);
  });
});

// ---- S8.2: a damaged plan is refused and recovered from its newest good backup ------------------
void describe('a damaged plan', () => {
  let box: Sandbox;
  before(() => {
    box = makeSandbox();
  });
  after(() => {
    box.cleanup();
  });

  /** Break the root page of `transactions` (an invalid page type), as a bad sector would. */
  function damage(path: string): void {
    const db = new DatabaseSync(path);
    const pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size);
    const root = Number(db.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'transactions'").get()?.rootpage);
    db.close();
    const bytes = readFileSync(path);
    const at = (root - 1) * pageSize + (root === 1 ? 100 : 0);
    bytes[at] = 0;
    bytes.fill(0xff, at + 1, at + 8);
    writeFileSync(path, bytes);
  }

  void test('opening it offers the newest good backup; restoring opens the plan and keeps the damaged file', { timeout: 300_000 }, async () => {
    // A first open makes the backup on open.
    const first = await launch(box, ['--open', box.planPath]);
    await first.page.waitForFunction(() => window.hafbOpenTiming ?? null, null, { timeout: 30_000 });
    await first.page.waitForTimeout(2000);
    await first.close();
    damage(box.planPath);

    const app = await launch(box, ['--open', box.planPath]);
    try {
      const { page } = app;
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'is damaged' });
      await dialog.waitFor();
      assert.match(norm(await dialog.innerText()), /Restore its newest good backup, from /);
      await dialog.getByRole('button', { name: 'Restore backup' }).click();
      await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
      await page.locator('[role=status]', { hasText: /Restored “Sample Household” from its backup/ }).first().waitFor();
      const kept = readdirSync(join(box.dataDir, 'backups'), { recursive: true }).map(String).filter((f) => /damaged-.*\.hafb$/.test(f));
      assert.equal(kept.length, 1, `the damaged file is kept: ${JSON.stringify(kept)}`);
    } finally {
      await app.close();
    }
    // The restored file opens cleanly on its own.
    const again = await launch(box, ['--open', box.planPath]);
    try {
      await again.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    } finally {
      await again.close();
    }
  });
});

// ---- S8.3b: plan passwords -------------------------------------------------------------------------
void describe('plan passwords', () => {
  let box: Sandbox;
  const running: App[] = [];
  const PLAIN = 'SQLite format 3\0';
  const header = (file: string): string => readFileSync(file).subarray(0, 16).toString('latin1');
  const readable = (file: string): boolean => readFileSync(file).includes('Sample Household');
  const backups = (): string[] =>
    readdirSync(join(box.dataDir, 'backups'), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.hafb'))
      .map((f) => join(box.dataDir, 'backups', f));
  const launchPlan = async (): Promise<App> => {
    const a = await launch(box, ['--open', box.planPath]);
    running.push(a);
    return a;
  };
  const planSettings = async (page: Page) => {
    await page.getByRole('navigation', { name: 'Plan navigation' }).locator('button').first().click();
    await page.getByRole('menuitem', { name: 'Plan Settings…' }).click();
    return page.getByRole('dialog', { name: 'Plan Settings' });
  };
  /** Credential Manager entries this sandbox made ("Remember on this PC"). cmdkey can't delete them. */
  const forgetSandboxCredentials = (): void => {
    const script = join(import.meta.dirname, 'forget-credentials.ps1');
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Match', basename(box.root)]);
  };
  before(() => {
    box = makeSandbox();
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    forgetSandboxCredentials();
    box.cleanup();
  });

  void test('lock, reopen with the password, remember it, change it with the backups, and remove it', { timeout: 600_000 }, async () => {
    // Lock it from Plan Settings. The first open makes a backup, which is locked along with it.
    const first = await launchPlan();
    await first.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    await first.page.waitForTimeout(1500);
    let settings = await planSettings(first.page);
    await settings.getByRole('button', { name: 'Set a password…' }).click();
    const set = first.page.getByRole('dialog', { name: 'Set a password' });
    await set.getByLabel('Password', { exact: true }).fill('smoke pass one');
    await set.getByLabel('Type it again', { exact: true }).fill('smoke pass on');
    await set.getByText('The two passwords don’t match.').waitFor();
    assert.ok(await set.getByRole('button', { name: 'Lock Plan' }).isDisabled(), 'can’t lock with a mismatch');
    await set.getByLabel('Type it again', { exact: true }).fill('smoke pass one');
    assert.ok(await set.getByRole('checkbox', { name: /Also lock its/ }).isChecked(), 'backups follow by default');
    await set.getByRole('button', { name: 'Lock Plan' }).click();
    const locked = first.page.getByRole('dialog', { name: 'The plan is locked' });
    await locked.getByText(/backup is now locked|backups are now locked/).waitFor({ timeout: 60_000 });
    await locked.getByRole('button', { name: 'Done' }).click();
    assert.notEqual(header(box.planPath), PLAIN);
    assert.ok(!readable(box.planPath), 'nothing readable in the locked file');
    assert.ok(backups().length >= 1);
    for (const b of backups()) assert.ok(header(b) !== PLAIN && !readable(b), `${b} is locked`);
    settings = await planSettings(first.page);
    await settings.getByRole('button', { name: 'Change password…' }).waitFor();
    await settings.getByRole('button', { name: 'Cancel' }).click();
    await first.close();

    // Reopening asks; a wrong password says so; the right one opens it and is remembered.
    const second = await launchPlan();
    const prompt = second.page.getByRole('dialog', { name: '“Sample Household” is locked' });
    await prompt.waitFor();
    await prompt.getByLabel('Password', { exact: true }).fill('not it');
    await prompt.getByRole('button', { name: 'Open' }).click();
    await prompt.getByText('That password isn’t right.').waitFor();
    await prompt.getByLabel('Password', { exact: true }).fill('smoke pass one');
    await prompt.getByRole('checkbox', { name: 'Remember on this PC' }).check();
    await prompt.getByRole('button', { name: 'Open' }).click();
    await second.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    await assignVia(second.page, 'Electric', '123.45');
    await second.page.waitForTimeout(800);
    await second.close();

    // Remembered: it opens straight away, with the change in it.
    const third = await launchPlan();
    await third.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    assert.equal(await assignedText(third.page, 'Electric'), '$123.45');
    await third.page.waitForTimeout(1500);

    // Change it: the current password is checked, and the backups move to the new one.
    settings = await planSettings(third.page);
    await settings.getByRole('button', { name: 'Change password…' }).click();
    const change = third.page.getByRole('dialog', { name: 'Change password' });
    await change.getByLabel('Current password', { exact: true }).fill('wrong one');
    await change.getByLabel('New password', { exact: true }).fill('smoke pass two');
    await change.getByLabel('Type it again', { exact: true }).fill('smoke pass two');
    assert.ok(await change.getByRole('checkbox', { name: 'Remember on this PC' }).isChecked(), 'still remembered');
    await change.getByRole('button', { name: 'Change Password' }).click();
    await change.getByText('That password isn’t right.').waitFor();
    await change.getByLabel('Current password', { exact: true }).fill('smoke pass one');
    await change.getByRole('button', { name: 'Change Password' }).click();
    const changed = third.page.getByRole('dialog', { name: 'Password changed' });
    await changed.getByText(/now changed to the new password/).waitFor({ timeout: 60_000 });
    await changed.getByRole('button', { name: 'Done' }).click();
    await third.close();

    // The new password is the remembered one now: straight in again.
    const fourth = await launchPlan();
    await fourth.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    assert.equal(await assignedText(fourth.page, 'Electric'), '$123.45');

    // Remove it: the plan and its backups are plain SQLite files again.
    settings = await planSettings(fourth.page);
    await settings.getByRole('button', { name: 'Remove password…' }).click();
    const remove = fourth.page.getByRole('dialog', { name: 'Remove password' });
    await remove.getByLabel('Current password', { exact: true }).fill('smoke pass two');
    await remove.getByRole('button', { name: 'Remove Password' }).click();
    const removed = fourth.page.getByRole('dialog', { name: 'Password removed' });
    await removed.getByText(/now unlocked/).waitFor({ timeout: 60_000 });
    await removed.getByRole('button', { name: 'Done' }).click();
    await fourth.close();
    assert.equal(header(box.planPath), PLAIN);
    for (const b of backups()) assert.equal(header(b), PLAIN, `${b} is unlocked`);

    const fifth = await launchPlan();
    await fifth.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    assert.equal(await assignedText(fifth.page, 'Electric'), '$123.45');
    await fifth.close();
  });
});

// ---- S8.1: the CLAUDE.md §8 budget on a 20,000-transaction plan --------------------------------
void describe('performance at scale', () => {
  let box: Sandbox;
  before(() => {
    box = makeSandbox(buildLargePlan(todayLocal()).plan);
  });
  after(() => {
    box.cleanup();
  });

  void test('a 20k-transaction plan opens at launch, ready to use, within 1.5 s; the register scrolls smoothly', { timeout: 300_000 }, async () => {
    // The first launch builds the WebView2 profile (a one-time cost) and posts the loan charges.
    const warm = await launch(box, ['--open', box.planPath]);
    await warm.page.waitForFunction(() => window.hafbOpenTiming ?? null, null, { timeout: 30_000 });
    await warm.page.waitForTimeout(3000); // the backup on open and the first writes
    await warm.close();

    const app = await launch(box, ['--open', box.planPath]);
    try {
      const { page } = app;
      const t = await page.waitForFunction(() => window.hafbOpenTiming ?? null, null, { timeout: 30_000 }).then((h) => h.jsonValue());
      console.log(`20k plan: ${JSON.stringify(t)}`);
      assert.ok(t !== null && t.transactions >= LARGE_PLAN_TRANSACTIONS, `plan size ${String(t?.transactions)}`);
      assert.ok(t.processToReadyMs !== null && t.processToReadyMs < 1500, `process start → usable plan ${String(t.processToReadyMs)} ms`);
      await page.getByRole('treegrid', { name: 'Categories' }).waitFor();

      await page.getByRole('navigation', { name: 'Plan navigation' }).getByRole('link', { name: 'All Accounts' }).click();
      await page.locator('[aria-label="All transactions"]').waitFor();
      const scroll = await page.evaluate(async () => {
        const el = document.querySelector<HTMLElement>('[aria-label="All transactions"]');
        if (!el) return null;
        const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
        const idle: number[] = [];
        let prev = await frame();
        for (let i = 0; i < 60; i++) {
          const now = await frame();
          idle.push(now - prev);
          prev = now;
        }
        idle.sort((a, b) => a - b);
        const refresh = idle[30] ?? 16.7;
        const max = el.scrollHeight - el.clientHeight;
        const deltas: number[] = [];
        const start = await frame();
        prev = start;
        while (prev - start < 4000) {
          el.scrollTop = Math.min(max, (prev - start) * 3); // 3000 px/s, about 100 rows a second
          const now = await frame();
          deltas.push(now - prev);
          prev = now;
        }
        return { refreshHz: Math.round(1000 / refresh), frames: deltas.length, missed: deltas.filter((d) => d > refresh * 1.5).length };
      });
      console.log(`20k register scroll: ${JSON.stringify(scroll)}`);
      assert.ok(scroll !== null && scroll.missed <= 2, `missed frames ${JSON.stringify(scroll)}`);
    } finally {
      await app.close();
    }
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
    // Esc deselects (the inspector then shows the month), as in YNAB. A click on Activity opens its
    // popover (S4.7): the first Esc closes it, the second deselects.
    await cell(page, 'Groceries', 'activity').click();
    await page.getByRole('dialog', { name: /Activity: Groceries/ }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
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
    // The edited row stays selected, and a click on the selected row edits it (YNAB): Esc deselects first.
    // The save lands asynchronously, so press Esc until the row really is deselected.
    for (let i = 0; i < 10 && (await cake.getAttribute('aria-selected')) === 'true'; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    assert.notEqual(await cake.getAttribute('aria-selected'), 'true', 'Esc deselects the saved row');
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
    const view = page.getByRole('dialog', { name: 'View Options' });
    await view.getByRole('checkbox', { name: 'Show Running Balance' }).check();
    await view.getByRole('button', { name: 'Apply' }).click();
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

// ---- S4.6 exit: multi-select, bulk edit, splits, search syntax, sort, View Options ----------------
void describe('register power', () => {
  let box: Sandbox;
  const running: App[] = [];
  const open = async (): Promise<App> => {
    // A failed test can leave its app running; one plan file opens in one window only.
    for (const a of running.splice(0)) await a.close().catch(() => undefined);
    const a = await launch(box, ['--open', box.planPath]);
    running.push(a);
    return a;
  };
  before(() => {
    box = makeSandbox();
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });
  const cents = (s: string): number => {
    const m = /(-?)\$([\d,]+)\.(\d\d)/.exec(s);
    return m ? (m[1] === '-' ? -1 : 1) * (Number((m[2] ?? '0').replace(/,/g, '')) * 100 + Number(m[3])) : 0;
  };

  void test('select, bulk categorize and duplicate with undo; split by keyboard survives a relaunch', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    await page.getByRole('navigation', { name: 'Plan navigation' }).getByRole('link', { name: 'All Accounts' }).click();
    // A treegrid while the Scheduled section shows; a plain grid while searching.
    const grid = page.locator('[aria-label="All transactions"]');
    await grid.waitFor();
    // The grid is virtualized: count what the store did (Undo's label), not rendered rows.
    const txRows = grid.locator('[role=row][data-row-id]:not([data-row-id="__scheduled__"])');
    const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
    const row = (id: string | null) => grid.locator(`[role=row][data-row-id="${id ?? ''}"]`);
    const categoryOf = async (id: string | null): Promise<string> => norm(await row(id).locator('[data-col=category]').innerText());

    // Two checkboxes: the floating bar and the selected total.
    const first = await txRows.nth(1).getAttribute('data-row-id');
    const second = await txRows.nth(2).getAttribute('data-row-id');
    const before = [await categoryOf(first), await categoryOf(second)];
    await row(first).locator('[data-select]').click();
    await row(second).locator('[data-select]').click();
    const bar = page.getByRole('toolbar', { name: /Selection/ });
    assert.match(norm(await bar.innerText()), /^2 Transactions Categorize Flag/);
    await page.getByText(/Selected Total \(2\)/).waitFor();

    await bar.getByRole('button', { name: 'Categorize' }).click();
    await page.keyboard.type('Dining Out');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.deepEqual([await categoryOf(first), await categoryOf(second)], ['Dining Out', 'Dining Out']);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    assert.deepEqual([await categoryOf(first), await categoryOf(second)], before, 'one undo restores both rows');

    // Shift+D duplicates the selection and selects the copies; undo removes them.
    await bar.getByRole('button', { name: 'More' }).focus();
    await page.keyboard.press('Shift+D');
    await page.waitForTimeout(300);
    assert.match((await undoButton.getAttribute('title')) ?? '', /Undo Duplicate 2 transactions/);
    assert.match(norm(await bar.innerText()), /^2 Transactions/);
    assert.equal(await row(first).getAttribute('aria-selected'), 'false', 'the copies are selected, not the originals');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    // Opening posts the sample mortgage's monthly charges (S6.4), the step before the user's own.
    assert.match((await undoButton.getAttribute('title')) ?? '', /Undo Categorize|Undo Post loan interest and charges|Nothing to undo/);
    // The selected copies are gone, so the bar goes too.
    await bar.waitFor({ state: 'detached' });

    // S splits the focused row; two lines by keyboard; the remaining amount reaches $0.00.
    const fuel = grid.locator('[role=row][data-row-id]', { hasText: 'QuickFuel' }).first();
    const fuelId = await fuel.getAttribute('data-row-id');
    const amount = cents(await fuel.locator('[data-col=outflow]').innerText());
    await fuel.locator('[data-col=date]').click();
    await page.keyboard.press('s');
    await grid.locator('[data-split-line="2"]').waitFor();
    await page.keyboard.type('QuickFuel');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Gas & Transit');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('fuel');
    await page.keyboard.press('Tab');
    await page.keyboard.type('40');
    await page.keyboard.press('Tab');
    const line2 = grid.locator('[data-split-line="2"]');
    await line2.getByRole('combobox', { name: /Category/ }).click();
    await page.keyboard.type('Groceries');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await line2.getByRole('textbox', { name: /Outflow, split line 2/ }).click();
    const rest = amount - 4000;
    await page.keyboard.type(`${String(Math.floor(rest / 100))}.${String(rest % 100).padStart(2, '0')}`);
    await page.keyboard.press('Tab');
    assert.equal(norm(await grid.locator('[data-part=split-remaining-outflow]').innerText()), '$0.00');
    await page.keyboard.press('Enter');
    await grid.locator('[data-split-line]').first().waitFor({ state: 'detached' });
    assert.match(norm(await row(fuelId).innerText()), /Split \(2\)/);
    await page.waitForTimeout(800);
    await app.close();

    const again = await open();
    const grid2 = again.page.locator('[aria-label="All transactions"]');
    await grid2.waitFor();
    assert.match(norm(await grid2.locator(`[role=row][data-row-id="${fuelId ?? ''}"]`).innerText()), /Split \(2\)/);
    await again.page.getByText('fuel', { exact: true }).first().waitFor();
    await again.close();
  });

  void test('search syntax, sort and View Options in the real app', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    const grid = page.locator('[aria-label="All transactions"]');
    await grid.waitFor();
    const search = page.getByRole('combobox', { name: 'Search transactions' });
    const cells = async (col: string): Promise<string[]> => (await grid.locator(`[role=row][data-row-id]:not([data-row-id="__scheduled__"]) [data-col=${col}]`).allInnerTexts()).map(norm);
    const table: [string, string, (v: string) => boolean][] = [
      ['Payee: Taco', 'payee', (v) => v.includes('Taco')],
      ['Category: Dining Out', 'category', (v) => v === 'Dining Out'],
      ['Account: Wallet', 'account', (v) => v === 'Wallet'],
      ['Outflow: >=100', 'outflow', (v) => cents(v) >= 10000],
      ['Inflow: >0', 'inflow', (v) => cents(v) > 0],
      ['After: 10/10/2026', 'date', (v) => v >= '10/10/2026' && v.endsWith('2026')],
      ['Category: Dining Out, Outflow: >=90', 'outflow', (v) => cents(v) >= 9000],
    ];
    for (const [text, col, ok] of table) {
      await search.fill(text);
      await page.waitForTimeout(250);
      const values = await cells(col);
      assert.ok(values.length > 0, `${text}: some rows`);
      assert.ok(values.every(ok), `${text}: ${values.join(', ')}`);
      await page.getByText(/Some transactions are hidden by your search/).waitFor();
    }
    await search.fill('Outflow: >=abc');
    await page.getByText(/Not an amount in search/).waitFor();
    await search.fill('');

    // A header click sorts descending first (YNAB).
    await grid.getByRole('columnheader', { name: /Payee/ }).click();
    await page.waitForTimeout(250);
    const payees = (await cells('payee')).map((v) => v.toLowerCase());
    for (let i = 1; i < payees.length; i++) assert.ok((payees[i - 1] ?? '').localeCompare(payees[i] ?? '') >= 0, `${payees[i - 1] ?? ''} before ${payees[i] ?? ''}`);
    await grid.getByRole('columnheader', { name: /Date/ }).click();

    // View Options: Last Month shows only last month.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'View Options' });
    await dlg.getByRole('button', { name: 'Last Month' }).click();
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(250);
    const last = addMonths(monthOf(todayLocal()), -1);
    const dates = await cells('date');
    assert.ok(dates.length > 0 && dates.every((d) => d.startsWith(`${last.slice(5, 7)}/`) && d.endsWith(last.slice(0, 4))), dates.join(', '));
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await dlg.getByRole('button', { name: 'All Dates' }).click();
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await app.close();
  });
});

// ---- S4.7 exit: credit cards on screen tie out to the engine; Record Payment moves the money -------
void describe('credit cards', () => {
  let box: Sandbox;
  const running: App[] = [];
  before(() => {
    box = makeSandbox();
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });
  const cents = (s: string): number => {
    const m = /([-+]?)\$([\d,]+)\.(\d\d)/.exec(s);
    return m ? (m[1] === '-' ? -1 : 1) * (Number((m[2] ?? '0').replace(/,/g, '')) * 100 + Number(m[3])) : 0;
  };

  void test('payment row, Activity popover, card header pills and Record Payment', { timeout: 300_000 }, async () => {
    const app = await launch(box, ['--open', box.planPath]);
    running.push(app);
    const { page } = app;
    const plan = page.getByRole('treegrid', { name: 'Categories' });
    await plan.waitFor();
    const group = plan.locator('[role=row]', { hasText: 'Credit Card Payments' }).first();
    assert.match(norm(await group.innerText()), /PAYMENT/i);
    const visaRow = plan.locator('[role=row]', { has: page.locator('[data-col=category]', { hasText: /^Visa Rewards/ }) });
    const available = cents(await visaRow.locator('[data-col=available]').innerText());
    const activity = cents(await visaRow.locator('[data-col=activity]').innerText());

    // The payment category's Activity popover: Funded Spending + Payments & Returns = Total Activity.
    await visaRow.locator('[data-col=activity]').click();
    const pop = page.getByRole('dialog', { name: /Activity: Visa Rewards/ });
    const text = norm(await pop.innerText());
    const pick = (label: string): number => cents(new RegExp(`${label} ([-+]\\$[\\d,]+\\.\\d\\d)`).exec(text)?.[1] ?? '');
    assert.equal(pick('Total Activity'), activity, 'the popover total is the Activity column');
    assert.equal(pick('Funded Spending') + pick('Payments & Returns'), activity);
    assert.equal(pick('Spending') + pick('Returns'), pick('Total Spending'));
    await pop.getByRole('button', { name: 'Close' }).click();

    // The card register: the Payment pill is the payment category's Available.
    await page.getByRole('navigation', { name: 'Plan navigation' }).locator('[data-section=credit]', { hasText: 'Visa Rewards' }).click();
    await page.getByRole('treegrid', { name: /Visa Rewards transactions/ }).waitFor();
    const pills = norm(await page.getByLabel('Credit card').innerText());
    assert.equal(cents(/([-+]?\$[\d,]+\.\d\d) Payment/.exec(pills)?.[1] ?? ''), available);
    const cleared = cents(norm(await page.getByLabel('Balances').innerText()));

    // Record Payment pre-fills min(Available, cleared debt); pay it from checking.
    await page.getByRole('button', { name: 'Record Payment' }).click();
    const inflow = page.getByRole('textbox', { name: 'Inflow' });
    const amount = cents(await inflow.inputValue());
    assert.equal(amount, Math.max(0, Math.min(available, 0 - cleared)));
    await page.getByRole('combobox', { name: 'Payee' }).click();
    await page.keyboard.type('Everyday Checking');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(400);
    assert.equal(cents(/([-+]?\$[\d,]+\.\d\d) Payment/.exec(norm(await page.getByLabel('Credit card').innerText()))?.[1] ?? ''), available - amount, 'a payment takes its amount out of the payment category');
    await app.close();
  });
});

void describe('planning power (Phase 5)', () => {
  let box: Sandbox;
  const running: App[] = [];
  const open = async (sandbox: Sandbox = box): Promise<App> => {
    const a = await launch(sandbox, ['--open', sandbox.planPath]);
    running.push(a);
    // A relaunch reopens where the plan was left (the last route), so wait for the sidebar.
    await a.page.getByRole('navigation', { name: 'Plan navigation' }).waitFor();
    return a;
  };
  before(() => {
    box = makeSandbox();
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });
  const planRow = (page: Page, name: string) => page.getByRole('treegrid', { name: 'Categories' }).locator('[role=row]', { has: page.locator('[data-col=category]', { hasText: new RegExp(`^${name}`) }) });
  const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Plan navigation' });
  const mdy = (d: string): string => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

  void test('inspector, target snooze, a custom Focused View, Recent Moves and a category’s Moves', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
    // Select Gifts: the inspector shows it and its target; Shift+Z snoozes, undo restores.
    const gifts = planRow(page, 'Gifts');
    await gifts.locator('[data-select]').click();
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await insp.getByRole('heading', { name: 'Gifts' }).waitFor();
    assert.match(norm(await insp.innerText()), /Target/);
    const message = async (): Promise<string> => norm(await gifts.locator('[data-col=category]').innerText());
    const before = await message();
    await insp.getByRole('switch', { name: /Snooze/ }).click();
    await page.waitForTimeout(300);
    assert.match(await message(), /Snoozed/i);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    assert.equal(await message(), before);

    // A custom view shows only its categories.
    await page.getByRole('button', { name: 'Focused views' }).click();
    await page.getByRole('menuitem', { name: 'New View' }).click();
    const dlg = page.getByRole('dialog', { name: 'New Custom View' });
    await dlg.getByRole('textbox', { name: 'View Name' }).fill('Food');
    await dlg.getByRole('checkbox', { name: 'Groceries' }).check();
    await dlg.getByRole('checkbox', { name: 'Dining Out' }).check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(300);
    const shown = (await page.getByRole('treegrid', { name: 'Categories' }).locator('[role=row] [data-col=category]').allInnerTexts()).map(norm).filter((t) => t !== '');
    assert.ok(shown.some((t) => t.startsWith('Groceries')) && shown.some((t) => t.startsWith('Dining Out')), shown.join(' | '));
    assert.ok(!shown.some((t) => t.startsWith('Gifts')), 'Gifts is outside the view');
    await page.getByRole('button', { name: 'Focused views' }).click();
    await page.getByRole('menuitem', { name: 'Manage Views' }).click();
    const manage = page.getByRole('dialog', { name: 'Manage Views' });
    await manage.getByRole('button', { name: 'Delete Food' }).click();
    await manage.getByRole('button', { name: 'Done' }).click();

    // Recent Moves lists a new assignment; the category's Moves too.
    await page.getByRole('radio', { name: 'All' }).first().click().catch(() => undefined);
    await assignVia(page, 'Hobbies', '55');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Recent Moves' }).click();
    const recent = page.getByRole('dialog', { name: 'Recent Moves' });
    assert.match(norm(await recent.innerText()), /Today Assigned \$55\.00 to Hobbies/);
    await page.keyboard.press('Escape');
    const hobbies = planRow(page, 'Hobbies');
    if ((await hobbies.getAttribute('aria-selected')) !== 'true') await hobbies.locator('[data-select]').click();
    await hobbies.getByRole('button', { name: 'Moves for Hobbies' }).click();
    const moves = page.getByRole('dialog', { name: 'Moves for Hobbies' });
    assert.match(norm(await moves.innerText()), /Assigned \$55\.00/);
    await moves.getByRole('button', { name: 'Close' }).click();
    await app.close();
  });

  void test('scheduled: a future-dated row schedules, Enter Now (E) enters it, due ones enter on open', { timeout: 300_000 }, async () => {
    const today = todayLocal();
    // A plan with a monthly bill that came due yesterday.
    const sample = buildSamplePlan();
    const base: PlanData = { ...sample.plan, scheduled: [] };
    const ctx = { now: new Date().toISOString(), today, newId: () => crypto.randomUUID() };
    const due = addScheduled(base, ctx, { accountId: sample.ids.accounts.cash ?? '', date: addDays(today, -1), frequency: 'monthly', amount: minor(-1234), payeeName: 'Due Club', categoryId: sample.ids.categories.Hobbies ?? null });
    const dueBox = makeSandbox(applyChanges(base, due.changes).plan);
    try {
      const app = await open(dueBox);
      const { page } = app;
      await sidebar(page).locator('[data-section=cash]', { hasText: 'Wallet' }).click();
      const grid = page.getByRole('treegrid', { name: /Wallet transactions/ });
      await grid.waitFor();
      const entered = grid.locator('[role=row]:not([data-row-id^="sched:"])', { hasText: 'Due Club' });
      assert.equal(await entered.count(), 1, 'the due occurrence was entered on open');
      assert.ok((await entered.locator('[title="Needs approval"]').count()) === 1, 'and needs approval');
      const next = grid.locator('[role=row][data-row-id^="sched:"]', { hasText: 'Due Club' });
      assert.match(norm(await next.innerText()), new RegExp(mdy(addMonthsToDate(addDays(today, -1), 1)).replace(/\//g, '\\/')));

      // A new row dated after today becomes a schedule.
      await page.locator('#main').focus();
      await page.keyboard.press('Shift+N');
      const editor = grid.locator('[data-row-editor]').first();
      await editor.waitFor();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(mdy(addDays(today, 10)));
      await page.keyboard.press('Tab');
      await page.keyboard.type('Future Gym');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.getByRole('textbox', { name: 'Outflow' }).fill('45');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForTimeout(400);
      const gym = grid.locator('[role=row][data-row-id^="sched:"]', { hasText: 'Future Gym' });
      assert.equal(await gym.count(), 1, 'scheduled, not entered');

      // Enter Now (E): entered today, and a one-time schedule is used up.
      await gym.locator('[data-select]').click();
      await page.keyboard.press('e');
      await page.waitForTimeout(400);
      assert.equal(await gym.count(), 0);
      const now = grid.locator('[role=row]:not([data-row-id^="sched:"])', { hasText: 'Future Gym' });
      assert.match(norm(await now.innerText()), new RegExp(mdy(today).replace(/\//g, '\\/')));
      await page.waitForTimeout(500);
      await app.close();

      // Both survive a relaunch, and nothing is entered twice.
      const again = await open(dueBox);
      await sidebar(again.page).locator('[data-section=cash]', { hasText: 'Wallet' }).click();
      const g2 = again.page.getByRole('treegrid', { name: /Wallet transactions/ });
      await g2.waitFor();
      assert.equal(await g2.locator('[role=row]:not([data-row-id^="sched:"])', { hasText: 'Due Club' }).count(), 1);
      assert.equal(await g2.locator('[role=row]:not([data-row-id^="sched:"])', { hasText: 'Future Gym' }).count(), 1);
      await again.close();
    } finally {
      // A failed assertion leaves the app holding the file; close it before deleting the folder.
      for (const a of running.splice(0)) await a.close().catch(() => undefined);
      dueBox.cleanup();
    }
  });

  void test('Manage Payees renames and hides; Reconcile locks the cleared transactions and survives a relaunch', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await sidebar(page).locator('button').first().click();
    await page.getByRole('menuitem', { name: 'Manage Payees…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Manage Payees' });
    await dlg.getByRole('checkbox', { name: 'Corner Grocery' }).check();
    const name = dlg.getByRole('textbox', { name: 'Payee Name' });
    await name.fill('Corner Market');
    await name.press('Enter');
    await page.waitForTimeout(300);
    await dlg.getByRole('button', { name: 'Hide', exact: true }).click();
    await page.waitForTimeout(200);
    assert.match(norm(await dlg.locator('[role=group][aria-label="Hidden Payees"]').innerText()), /Corner Market/);
    await dlg.getByRole('button', { name: 'Done' }).click();

    await sidebar(page).locator('[data-section=cash]', { hasText: 'Wallet' }).click();
    const grid = page.getByRole('treegrid', { name: /Wallet transactions/ });
    await grid.waitFor();
    assert.ok((await grid.locator('[role=row]', { hasText: 'Corner Market' }).count()) > 0, 'the register shows the new name');

    // Reconcile: "Is your current balance …?" Yes.
    await page.keyboard.press('Shift+E');
    const pop = page.getByRole('dialog', { name: 'Reconcile' });
    await pop.getByRole('button', { name: 'Yes' }).click();
    await page.waitForTimeout(500);
    assert.match(norm(await page.getByRole('main').innerText()), /Reconciled today/);
    const locks = await grid.getByRole('button', { name: 'Reconciled. Unlock' }).count();
    assert.ok(locks >= 3, `locked ${String(locks)}`);
    await page.waitForTimeout(500);
    await app.close();

    const again = await open();
    await sidebar(again.page).locator('[data-section=cash]', { hasText: 'Wallet' }).click();
    const g2 = again.page.getByRole('treegrid', { name: /Wallet transactions/ });
    await g2.waitFor();
    assert.equal(await g2.getByRole('button', { name: 'Reconciled. Unlock' }).count(), locks);
    assert.match(norm(await again.page.getByRole('main').innerText()), /Reconciled today/);
    await again.close();
  });
});

void describe('reflect (Phase 6)', () => {
  let box: Sandbox;
  const running: App[] = [];
  const plan: PlanData = { ...buildSamplePlan().plan, scheduled: [] };
  const open = async (): Promise<App> => {
    const a = await launch(box, ['--open', box.planPath]);
    running.push(a);
    await a.page.getByRole('navigation', { name: 'Plan navigation' }).waitFor();
    return a;
  };
  before(() => {
    box = makeSandbox(plan);
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });
  const usd = (m: number): string => formatMoney(minor(m), { decimals: 2, symbol: '$', placement: 'before', numberFormat: '123,456.78' });

  void test('reports tie to the engine; filters survive a relaunch; a drill-down opens the register; exports land as files', { timeout: 300_000 }, async () => {
    const today = todayLocal();
    const month = monthOf(today);
    const from = compareMonths(addMonths(month, -2), plan.settings.firstMonth ?? month) < 0 ? (plan.settings.firstMonth ?? month) : addMonths(month, -2);
    // Opening posts the sample mortgage's monthly interest and escrow (S6.4): expect them too.
    let seq = 0;
    const charges = postLoanCharges(plan, { now: '2026-10-09T00:00:00.000Z', today, newId: () => `smoke-${String((seq += 1))}` });
    const snapshot = budgetSnapshot(charges ? applyChanges(plan, charges.changes).plan : plan);
    const app = await open();
    const { page } = app;
    await page.getByRole('link', { name: 'Reflect' }).click();
    await page.getByRole('tablist', { name: 'Reports' }).waitFor();
    await page.getByRole('button', { name: /^Date range:/ }).click();
    await page.getByRole('radio', { name: 'Last 3 Months' }).click();
    const breakdown = spendingBreakdown(snapshot, { from, to: month });
    const main = (): Promise<string> => page.getByRole('main').innerText().then(norm);
    assert.match(await main(), new RegExp(`Total spending ${usd(breakdown.total).replace(/[$.]/g, '\\$&')}`));

    // Net Worth's headline is the engine's last month end.
    await page.getByRole('tab', { name: 'Net Worth' }).click();
    await page.getByText('Change in Net Worth').waitFor();
    const nw = netWorth(snapshot, { from, to: month }).at(-1);
    assert.ok(nw);
    assert.match(await main(), new RegExp(`Net Worth ${usd(nw.netWorth).replace(/[$.]/g, '\\$&')}`));

    // Leave out one category; the filter and the range come back after a relaunch.
    await page.getByRole('tab', { name: 'Spending Breakdown' }).click();
    await page.getByRole('radio', { name: 'Categories' }).waitFor();
    await page.getByRole('button', { name: /All Categories/ }).click();
    await page.getByRole('checkbox', { name: 'Groceries' }).uncheck();
    await page.getByRole('button', { name: 'Done' }).click();
    const groceries = plan.categories.find((c) => c.name === 'Groceries')?.id ?? '';
    const without = spendingBreakdown(snapshot, { from, to: month, categoryIds: plan.categories.filter((c) => c.id !== groceries).map((c) => c.id).concat('uncategorized') });
    assert.match(await main(), new RegExp(`Total spending ${usd(without.total).replace(/[$.]/g, '\\$&')}`));
    await app.close();
    const again = await open();
    await again.page.getByRole('link', { name: 'Reflect' }).click();
    await again.page.getByRole('tablist', { name: 'Reports' }).waitFor();
    assert.match(norm(await again.page.getByRole('toolbar', { name: 'Report filters' }).innerText()), /Selected Categories/);
    await again.page.getByRole('button', { name: /Selected Categories/ }).click();
    await again.page.getByRole('button', { name: 'Select All' }).click();
    await again.page.getByRole('button', { name: 'Done' }).click();

    // Exports: the Spending zip (summary + transactions), the chart PNG, Net Worth CSV, the share image.
    await again.page.getByRole('button', { name: 'Export' }).click();
    await again.page.getByRole('menuitem', { name: /Export data/ }).click();
    await again.page.getByRole('button', { name: 'Export' }).click();
    await again.page.getByRole('menuitem', { name: /Save chart/ }).click();
    await again.page.getByRole('tab', { name: 'Net Worth' }).click();
    await again.page.getByText('Change in Net Worth').waitFor();
    await again.page.getByRole('button', { name: 'Export' }).click();
    await again.page.getByRole('menuitem', { name: /Export data/ }).click();
    await again.page.getByRole('button', { name: 'Share Your Progress' }).click();
    await again.page.getByRole('button', { name: 'Download Image' }).click();
    await again.page.waitForTimeout(1500);
    const files = readdirSync(box.exportDir).toSorted();
    const name = plan.settings.name;
    for (const want of [`${name} - Spending Breakdown - ${today}.zip`, `${name} - Spending Breakdown - ${today}.png`, `${name} - Net Worth - ${today}.csv`, `${name} - Net Worth - ${today}.png`]) {
      assert.ok(files.includes(want), `missing ${want}: ${files.join(', ')}`);
    }
    const zip = await readZip(new Uint8Array(readFileSync(join(box.exportDir, `${name} - Spending Breakdown - ${today}.zip`))));
    assert.equal(zip.size, 2);
    const csv = readFileSync(join(box.exportDir, `${name} - Net Worth - ${today}.csv`), 'utf8');
    assert.ok(csv.startsWith('﻿"Account",'), csv.slice(0, 40));
    assert.equal(readFileSync(join(box.exportDir, `${name} - Net Worth - ${today}.png`)).readUInt32BE(16), 1080);

    // A drill-down row opens its transaction in the register.
    await again.page.getByRole('tab', { name: 'Spending Breakdown' }).click();
    await again.page.getByRole('list', { name: 'Spending by category' }).waitFor();
    await again.page.getByRole('list', { name: 'Spending by category' }).getByRole('button').first().click();
    const row = again.page.getByRole('dialog', { name: /transactions/ }).locator('tbody tr').first();
    const [, date, payee] = /(\d\d\/\d\d\/\d{4}) (.+?) [-+]\$/.exec(norm(await row.innerText())) ?? [];
    await row.click();
    const selected = again.page.locator('[role=row][aria-selected=true]');
    await selected.first().waitFor();
    const picked = norm(await selected.first().innerText());
    assert.ok(picked.includes(date ?? '?') && picked.includes(payee ?? '?'), `${picked} vs ${String(date)} ${String(payee)}`);
    await again.close();
  });
});

const CHECKING_CSV = `Date,Description,Debit,Credit,Balance
10/09/2026,"FIBERNET INTERNET 0042",70.00,,5000.00
10/10/2026,SQ *BLUE BOTTLE COFFEE,4.50,,4995.50
10/12/2026,PAYPAL *STREAMBOX,12.99,,4982.51
10/13/2026,ACME LOGISTICS PAYROLL,,250.00,5232.51
10/13/2026,PAYMENT TO VISA REWARDS,300.00,,4932.51
`;
const VISA_QFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD
<CCACCTFROM><ACCTID>4111000011112222</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261014<TRNAMT>300.00<FITID>V-1001<NAME>PAYMENT THANK YOU</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261013<TRNAMT>-18.25<FITID>V-1002<NAME>TST* TACO STAND 0042<MEMO>Lunch</STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>
`;

void describe('loans, bank import, export and backups (Phase 6)', () => {
  let box: Sandbox;
  const running: App[] = [];
  const plan: PlanData = { ...buildSamplePlan().plan, scheduled: [] };
  const open = async (env: Record<string, string> = {}): Promise<App> => {
    const a = await launch(box, ['--open', box.planPath], env);
    running.push(a);
    await a.page.getByRole('navigation', { name: 'Plan navigation' }).waitFor();
    return a;
  };
  before(() => {
    box = makeSandbox(plan);
    writeFileSync(join(box.root, 'checking.csv'), CHECKING_CSV);
    writeFileSync(join(box.root, 'visa.qfx'), VISA_QFX);
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });
  const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Plan navigation' });
  const grid = (page: Page) => page.locator('[role=treegrid], [role=grid]').first();
  const rowTexts = async (page: Page): Promise<string[]> => (await grid(page).locator('[role=row]').allInnerTexts()).map(norm);
  const mdy = (d: string): string => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

  void test('a loan: charges post monthly, the simulator, pairing and Record Payment survive a relaunch', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await sidebar(page).getByText('Home Mortgage').click();
    const loan = page.getByRole('region', { name: 'Loan details' });
    await loan.waitFor();
    assert.match(norm(await loan.innerText()), /Remaining Balance .*Interest Rate .*Minimum Payment .*Escrow .*Payoff Date/);
    const interest = (await rowTexts(page)).filter((t) => ` ${t} `.includes(' Interest '));
    assert.ok(interest.length >= 1, 'monthly interest is posted');
    await loan.getByRole('button', { name: 'Open Payoff Simulator' }).click();
    const sim = page.getByRole('dialog', { name: 'Loan Payoff Simulator' });
    const pay = sim.getByLabel('Monthly Payment');
    await pay.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('2500');
    await page.keyboard.press('Tab');
    assert.match(norm(await sim.innerText()), /Paying \+\$[\d,]+\.\d\d extra every month .*\$[\d,]+\.\d\d Interest Savings .*\d+ yrs?(, \d+ mos?)? Time Savings/);
    await sim.getByRole('button', { name: 'Reset all changes' }).click();
    assert.match(norm(await sim.innerText()), /Paying the minimum every month/);
    await sim.getByRole('button', { name: 'Done' }).click();
    await loan.getByRole('button', { name: 'Get Started' }).click();
    const pair = page.getByRole('dialog', { name: /^Pair Home Mortgage/ });
    await pair.getByRole('combobox', { name: 'Category' }).click();
    await page.getByRole('option', { name: 'Mortgage', exact: true }).click();
    await pair.getByRole('button', { name: 'Pair', exact: true }).click();
    await loan.getByText(/Paired with/).waitFor();
    await page.getByRole('button', { name: 'Record Payment' }).click();
    const rp = page.getByRole('dialog', { name: 'Add Payment' });
    await rp.getByRole('button', { name: 'Record Payment' }).click();
    await page.waitForTimeout(400);
    const today = todayLocal();
    assert.ok((await rowTexts(page)).some((t) => t.startsWith(mdy(today)) && t.includes('Transfer : Everyday Checking')), 'the payment is in the register');
    await app.close();

    const again = await open();
    await sidebar(again.page).getByText('Home Mortgage').click();
    const loan2 = again.page.getByRole('region', { name: 'Loan details' });
    await loan2.waitFor();
    assert.match(norm(await loan2.innerText()), /Paired with Mortgage/);
    const interest2 = (await rowTexts(again.page)).filter((t) => ` ${t} `.includes(' Interest '));
    assert.equal(interest2.length, interest.length, 'charges are posted once');
    await again.close();
  });

  void test('bank files import once (CSV and QFX), match, pair the card payment, and skip on re-import', { timeout: 300_000 }, async () => {
    const csv = { HAFB_PICK_FILES: join(box.root, 'checking.csv') };
    const app = await open(csv);
    const { page } = app;
    await sidebar(page).getByText('Everyday Checking').first().click();
    await page.getByRole('button', { name: 'File Import' }).click();
    const dlg = page.getByRole('dialog', { name: 'Import Transactions' });
    await dlg.waitFor();
    const preview = norm(await dlg.getByRole('region', { name: 'Preview' }).innerText());
    assert.match(preview, /4 new · 1 matched to transactions you entered · 0 skipped/);
    await dlg.getByRole('button', { name: 'Import 5' }).click();
    await page.waitForTimeout(400);
    const rows = await rowTexts(page);
    assert.ok(rows.some((t) => t.includes('Blue Bottle Coffee')), 'cleaned payee');
    assert.ok(rows.some((t) => t.includes('Acme Logistics Payroll') && t.includes('Ready to Assign')), 'inflow to Ready to Assign');
    await app.close();

    const again = await open(csv);
    await sidebar(again.page).getByText('Everyday Checking').first().click();
    await again.page.getByRole('button', { name: 'File Import' }).click();
    const dlg2 = again.page.getByRole('dialog', { name: 'Import Transactions' });
    assert.match(norm(await dlg2.getByRole('region', { name: 'Preview' }).innerText()), /0 new · 0 matched to transactions you entered · 5 skipped/);
    assert.equal(await dlg2.getByRole('button', { name: 'Nothing to Import' }).isDisabled(), true);
    await dlg2.getByRole('button', { name: 'Cancel' }).click();
    await again.close();

    const card = await open({ HAFB_PICK_FILES: join(box.root, 'visa.qfx') });
    await sidebar(card.page).getByText('Visa Rewards').first().click();
    await card.page.getByRole('button', { name: 'File Import' }).click();
    const dlg3 = card.page.getByRole('dialog', { name: 'Import Transactions' });
    await dlg3.getByRole('button', { name: 'Import 2' }).click();
    await card.page.waitForTimeout(400);
    const visa = await rowTexts(card.page);
    assert.ok(visa.some((t) => t.includes('Everyday Checking') && t.includes('$300.00')), `the payment pairs into a transfer: ${visa.slice(0, 6).join(' | ')}`);
    await card.close();
  });

  void test('Export for YNAB writes Plan.csv and Register.csv; Back up now and the keep setting survive a relaunch', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await sidebar(page).locator('button').first().click();
    await page.getByRole('menuitem', { name: 'Export for YNAB (CSV)…' }).click();
    await page.waitForTimeout(800);
    const zipName = readdirSync(box.exportDir).find((f) => f.endsWith(' - YNAB format.zip'));
    assert.ok(zipName, readdirSync(box.exportDir).join(', '));
    const zip = await readZip(new Uint8Array(readFileSync(join(box.exportDir, zipName))));
    const names = [...zip.keys()];
    assert.ok(names.some((n) => n.endsWith(' - Plan.csv')) && names.some((n) => n.endsWith(' - Register.csv')), names.join(', '));

    await sidebar(page).locator('button').first().click();
    await page.getByRole('menuitem', { name: 'Backups…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Backups' });
    await dlg.getByRole('button', { name: 'Back up now' }).click();
    await dlg.getByText('Backed up by you').first().waitFor();
    await dlg.getByRole('combobox', { name: 'Backups to keep' }).click();
    await page.getByRole('option', { name: '3', exact: true }).click();
    await page.waitForTimeout(300);
    await dlg.getByRole('button', { name: 'Close' }).last().click();
    await app.close();

    const again = await open();
    await sidebar(again.page).locator('button').first().click();
    await again.page.getByRole('menuitem', { name: 'Backups…' }).click();
    const dlg2 = again.page.getByRole('dialog', { name: 'Backups' });
    await dlg2.getByText('Backed up by you').first().waitFor();
    assert.equal(await dlg2.getByRole('combobox', { name: 'Backups to keep' }).inputValue(), '3');
    await again.close();
  });
});

void describe('settings, templates and Fresh Start (Phase 7)', () => {
  let box: Sandbox;
  const running: App[] = [];
  const plan: PlanData = { ...buildSamplePlan().plan, scheduled: [] };
  const open = async (env: Record<string, string> = {}, path?: string): Promise<App> => {
    const a = await launch(box, ['--open', path ?? box.planPath], { HAFB_SAVE_DIR: box.root, ...env });
    running.push(a);
    await a.page.getByRole('navigation', { name: 'Plan navigation' }).waitFor();
    return a;
  };
  const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Plan navigation' });
  const planMenu = async (page: Page, item: string) => {
    await sidebar(page).locator('button').first().click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  /** The plan grid is virtualized: scroll to its end so the last rows render. */
  const toBottom = async (page: Page) => {
    const grid = page.getByRole('main').locator('[role=treegrid], [role=grid]').first();
    await grid.hover();
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(300);
  };
  before(() => {
    box = makeSandbox(plan);
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });

  void test('Plan Settings: yen shows without decimals and survives a relaunch; text size too', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await planMenu(page, 'Plan Settings…');
    const dlg = page.getByRole('dialog', { name: 'Plan Settings' });
    await dlg.getByRole('combobox', { name: 'Currency', exact: true }).click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Japanese Yen');
    await page.keyboard.press('Enter');
    await dlg.getByRole('button', { name: 'Apply Settings' }).click();
    await page.getByText(/^¥[\d,]+$/).first().waitFor();
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    await planMenu(page, 'Preferences…');
    const prefsDlg = page.getByRole('dialog', { name: 'Preferences' });
    await prefsDlg.getByRole('radio', { name: '125%' }).click();
    await prefsDlg.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500);
    const zoomed = await page.evaluate(() => window.devicePixelRatio);
    assert.ok(Math.abs(zoomed / ratio - 1.25) < 0.02, `zoom ${String(ratio)} → ${String(zoomed)}`);
    await app.close();

    const again = await open();
    await again.page.getByText(/^¥[\d,]+$/).first().waitFor();
    assert.ok(!(await again.page.getByRole('main').innerText()).includes('$'), 'no dollar amounts after the switch');
    await again.page.waitForTimeout(500);
    const after = await again.page.evaluate(() => window.devicePixelRatio);
    assert.ok(Math.abs(after / ratio - 1.25) < 0.02, `zoom after relaunch ${String(after)}`);
    // Back to dollars: the cents are all still there.
    await planMenu(again.page, 'Plan Settings…');
    const d2 = again.page.getByRole('dialog', { name: 'Plan Settings' });
    await d2.getByRole('combobox', { name: 'Currency', exact: true }).click();
    await again.page.keyboard.press('Control+a');
    await again.page.keyboard.type('US Dollar');
    await again.page.keyboard.press('Enter');
    await d2.getByRole('button', { name: 'Apply Settings' }).click();
    await again.page.getByText(/^\$[\d,]+\.\d\d$/).first().waitFor();
    await again.page.keyboard.press('Control+0');
    await again.close();
  });

  void test('Windows keys: F1, Ctrl+comma, Ctrl+N and Ctrl+= / Ctrl+0 do HAFB things, not browser things', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    try {
      await page.getByRole('main').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('F1');
      await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+,');
      await page.getByRole('dialog', { name: 'Preferences' }).waitFor();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+n');
      await page.getByRole('dialog', { name: 'New Plan' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(app.browser.contexts().flatMap((c) => c.pages()).length, 1, 'Ctrl+N opened no browser window');
      const base = await page.evaluate(() => window.devicePixelRatio);
      await page.keyboard.press('Control+=');
      await page.waitForTimeout(500);
      const bigger = await page.evaluate(() => window.devicePixelRatio);
      assert.ok(Math.abs(bigger / base - 1.1) < 0.02, `one step: ${String(base)} → ${String(bigger)}`);
      await page.keyboard.press('Control+0');
      await page.waitForTimeout(500);
      assert.ok(Math.abs((await page.evaluate(() => window.devicePixelRatio)) - base) < 0.01);
    } finally {
      await app.close();
    }
  });

  void test('WCAG 2.2 AA: axe finds nothing on any screen, in light, dark and high contrast (S7.4)', { timeout: 600_000 }, async () => {
    const app = await open();
    const { page } = app;
    const AXE = join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js');
    const found: string[] = [];
    const audit = async (where: string): Promise<void> => {
      await page.waitForTimeout(400);
      // The app's CSP blocks injected script tags (good); DevTools evaluation isn't subject to it.
      await page.evaluate(readFileSync(AXE, 'utf8'));
      const v = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      });
      for (const x of v) found.push(`${where} → ${x}`);
    };
    try {
      for (const theme of ['Default', 'Dark', 'High contrast']) {
        await planMenu(page, 'Display Options…');
        await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: theme }).click();
        await page.getByRole('button', { name: 'Apply' }).click();
        await sidebar(page).getByText('Plan', { exact: true }).click();
        await audit(`${theme} plan`);
        await sidebar(page).getByText('Everyday Checking').first().click();
        await page.getByRole('main').locator('[role=grid], [role=treegrid]').first().waitFor();
        await audit(`${theme} register`);
        await page.keyboard.press('Shift+N');
        await audit(`${theme} register editing`);
        await page.keyboard.press('Escape');
        await sidebar(page).getByText('Reflect', { exact: true }).click();
        await page.getByRole('tablist', { name: 'Reports' }).waitFor();
        await audit(`${theme} reflect`);
        for (const item of ['Plan Settings…', 'Preferences…', 'New plan…']) {
          await planMenu(page, item);
          await page.getByRole('dialog').first().waitFor();
          await audit(`${theme} ${item}`);
          await page.keyboard.press('Escape');
        }
      }
      assert.deepEqual(found, []);
    } finally {
      await planMenu(page, 'Display Options…').catch(() => undefined);
      await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Match System' }).click().catch(() => undefined);
      await page.getByRole('button', { name: 'Apply' }).click().catch(() => undefined);
      await app.close();
    }
  });

  void test('keyboard only: the plan menu, Plan Settings and Reflect (S7.4)', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    try {
      // The plan menu button is the sidebar's first control: Tab there, open it with Enter.
      await sidebar(page).locator('button').first().focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menu').waitFor();
      for (let i = 0; i < 12 && (await page.evaluate(() => document.activeElement?.textContent ?? '')) !== 'Plan Settings…'; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const dlg = page.getByRole('dialog', { name: 'Plan Settings' });
      await dlg.waitFor();
      // Tab to Date Format and pick 2026-12-30 (ISO) by typing; Enter to choose.
      for (let i = 0; i < 8 && !(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Date Format')); i++) await page.keyboard.press('Tab');
      await page.keyboard.press('Control+a');
      await page.keyboard.type('-12-30');
      await page.keyboard.press('Enter');
      for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement?.textContent === 'Apply Settings')); i++) await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await dlg.waitFor({ state: 'detached' });
      // Reflect by its shortcut; tabs by arrow keys.
      await page.locator('#main').focus();
      await page.keyboard.press('g');
      await page.keyboard.press('r');
      const tabs = page.getByRole('tablist', { name: 'Reports' });
      await tabs.waitFor();
      await tabs.getByRole('tab', { name: 'Spending Breakdown' }).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      assert.equal(await tabs.getByRole('tab', { selected: true }).innerText(), 'Net Worth');
      // The date format took: the plan shows ISO dates in the register.
      await page.keyboard.press('g');
      await page.keyboard.press('a');
      await page.getByRole('main').getByText(/^\d{4}-\d{2}-\d{2}$/).first().waitFor();
    } finally {
      await app.close();
    }
  });

  void test('first run: from the welcome screen to a working plan, with Get started ticking off (S7.5)', { timeout: 300_000 }, async () => {
    const started = Date.now();
    // No plan given and a fresh data folder: the welcome screen.
    const app = await launch(box, [], { HAFB_SAVE_DIR: box.root });
    running.push(app);
    const { page } = app;
    try {
      await page.getByRole('heading', { name: 'Welcome to HAFB' }).waitFor();
      await page.getByRole('button', { name: 'Start a new plan…' }).click();
      const np = page.getByRole('dialog', { name: 'New Plan' });
      await np.getByLabel('Plan Name').fill('First Plan');
      await np.getByRole('radio', { name: 'A template' }).click();
      await np.getByRole('button', { name: 'Create Plan' }).click();
      const card = page.locator('[data-section=setup]');
      await card.getByText('2 of 5 done').waitFor();
      // Step 1 from the card: Add account.
      await card.getByRole('button', { name: 'Add account' }).click();
      const dlg = page.getByRole('dialog', { name: 'Add an account' });
      await dlg.getByRole('textbox', { name: 'Give it a nickname' }).fill('Checking');
      await dlg.getByRole('button', { name: /What type of account/ }).click();
      await page.getByRole('option', { name: 'Checking', exact: true }).click();
      await dlg.getByRole('textbox', { name: 'What is your current account balance?' }).click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('2500');
      await page.keyboard.press('Tab');
      await dlg.getByRole('button', { name: 'Add Account' }).click();
      await page.getByRole('heading', { name: 'Checking', level: 1 }).waitFor();
      // A transaction in the new account.
      await page.locator('#main').focus();
      await page.keyboard.press('Shift+N');
      const editor = page.locator('[data-row-editor]').first();
      await editor.waitFor();
      await page.keyboard.press('Tab');
      await page.keyboard.type('Corner Grocery');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      await page.keyboard.type('Groceries');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.type('45.20');
      await page.keyboard.press('Enter');
      await editor.waitFor({ state: 'detached' });
      // Assign money on the Plan.
      await sidebar(page).getByRole('link', { name: 'Plan', exact: true }).click();
      const groceries = page.locator('[role=row]', { has: page.locator('[data-drag-id]', { hasText: /^Groceries$/ }) }).locator('[data-col=assigned]');
      await groceries.click();
      await page.keyboard.type('600');
      await page.keyboard.press('Enter');
      // Assigning selected Groceries; Escape deselects so the inspector shows the plan again (YNAB).
      // An Escape that lands before the commit has rendered closes the editor instead: repeat it.
      for (let i = 0; i < 5 && (await page.locator('[role=row][aria-selected=true]').count()) > 0; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
      await card.getByText('You’re all set: your plan is up and running.').waitFor();
      await card.getByRole('button', { name: 'Hide this card' }).click();
      await card.waitFor({ state: 'detached' });
      const minutes = (Date.now() - started) / 60_000;
      assert.ok(minutes < 10, `first run took ${minutes.toFixed(1)} min`);
    } finally {
      await app.close();
    }
  });

  void test('the plan grid fits its column without scrolling sideways (S7.7)', { timeout: 120_000 }, async () => {
    const app = await open();
    try {
      await sidebar(app.page).getByRole('link', { name: 'Plan', exact: true }).click();
      const grid = app.page.getByRole('treegrid', { name: 'Categories' });
      await grid.waitFor();
      // The last column's resize handle used to overhang the grid by 3 px.
      const overflow = await grid.evaluate((g) => {
        const scroller = [g, ...g.querySelectorAll('*')].find((c) => /(auto|scroll)/.test(getComputedStyle(c).overflowX) && c.clientWidth > 0);
        return scroller ? scroller.scrollWidth - scroller.clientWidth : 0;
      });
      assert.equal(overflow, 0);
    } finally {
      await app.close();
    }
  });

  void test('Credit Card Interest behind its preference: off the plan, in the card activity (S7.6)', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    try {
      // A relaunch reopens the last route; start from the Plan.
      await sidebar(page).getByRole('link', { name: 'Plan', exact: true }).click();
      await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
      const before = await rta(page);
      await planMenu(page, 'Preferences…');
      const prefsDlg = page.getByRole('dialog', { name: 'Preferences' });
      const flag = prefsDlg.getByRole('switch', { name: 'Credit Card Interest category (early)' });
      assert.equal(await flag.getAttribute('aria-checked'), 'false', 'off by default');
      await flag.click();
      await prefsDlg.getByRole('button', { name: 'Done' }).click();

      await sidebar(page).locator('[data-section=credit]', { hasText: 'Visa Rewards' }).click();
      const grid = page.getByRole('treegrid', { name: /Visa Rewards transactions/ });
      await grid.waitFor();
      const editor = grid.locator('[data-row-editor]').first();
      await page.locator('#main').focus();
      await page.keyboard.press('Shift+N');
      await editor.waitFor();
      await page.keyboard.press('Tab');
      await page.keyboard.type('Card Interest');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      await page.keyboard.type('Credit Card Interest');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await grid.getByRole('textbox', { name: 'Outflow' }).click();
      await page.keyboard.type('12.34');
      await page.keyboard.press('Enter');
      await editor.waitFor({ state: 'detached' });
      const row = grid.locator('[role=row][data-row-id]', { hasText: 'Card Interest' }).first();
      assert.match(norm(await row.innerText()), /Card Interest.*Credit Card Interest.*\$12\.34/);

      // Off the plan: Ready to Assign is unchanged; the payment category's Activity shows the interest.
      await sidebar(page).getByRole('link', { name: 'Plan', exact: true }).click();
      const planGrid = page.getByRole('treegrid', { name: 'Categories' });
      await planGrid.waitFor();
      assert.equal(await rta(page), before, 'interest leaves Ready to Assign alone');
      const visaRow = planGrid.locator('[role=row]', { has: page.locator('[data-col=category]', { hasText: /^Visa Rewards/ }) });
      await visaRow.locator('[data-col=activity]').click();
      const pop = page.getByRole('dialog', { name: /Activity: Visa Rewards/ });
      assert.match(norm(await pop.innerText()), /Credit Card Interest -\$12\.34/);
      await pop.getByRole('button', { name: 'Close' }).click();
    } finally {
      await app.close();
    }
  });

  void test('a transaction photo: attach, thumbnail, view, download, survives a relaunch, delete (S7.6)', { timeout: 300_000 }, async () => {
    // A real 16x16 PNG, written for the picker (HAFB_PICK_FILES stands in for the Open dialog).
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGMUqYhiIAUwkaSaYVQDcYCJSHVwMKqBGEByKAEA8nwBBu6ofKsAAAAASUVORK5CYII=', 'base64');
    const photoPath = join(box.root, 'receipt.png');
    writeFileSync(photoPath, png);
    const env = { HAFB_PICK_FILES: photoPath };
    const app = await open(env);
    const { page } = app;
    let rowId: string;
    try {
      await sidebar(page).getByText('Wallet').first().click();
      // The first transaction row (the Scheduled Transactions header has no photo cell).
      const attach = page.getByRole('main').getByRole('button', { name: 'Attach a photo' }).first();
      rowId = (await attach.evaluate((el) => el.closest('[role=row]')?.getAttribute('data-row-id'))) ?? '';
      await attach.click();
      const thumb = page.locator(`[role=row][data-row-id="${rowId}"]`).getByRole('button', { name: 'Photo attached: receipt.png. Open' });
      await thumb.waitFor();
      await thumb.locator('img').waitFor();
      await thumb.click();
      const viewer = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Download Image' }) });
      await viewer.locator('img').waitFor();
      // Decoded, not just present: a CSP without blob: left both images broken.
      await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] img, [role=row] button img')].every((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0), undefined, { timeout: 5000 });
      await viewer.getByRole('button', { name: 'Download Image' }).click();
      await page.waitForTimeout(500);
      assert.ok(existsSync(join(box.exportDir, 'receipt.png')), 'downloaded');
      await viewer.getByRole('button', { name: 'Close' }).last().click();
    } finally {
      await app.close();
    }
    const again = await open(env);
    try {
      await sidebar(again.page).getByText('Wallet').first().click();
      const row = again.page.locator(`[role=row][data-row-id="${rowId}"]`);
      await row.getByRole('button', { name: 'Photo attached: receipt.png. Open' }).click();
      const viewer = again.page.getByRole('dialog').filter({ has: again.page.getByRole('button', { name: 'Download Image' }) });
      await viewer.getByRole('button', { name: 'Delete Image' }).click();
      await again.page.getByRole('dialog', { name: 'Delete Image' }).getByRole('button', { name: 'Delete' }).click();
      await row.getByRole('button', { name: 'Attach a photo' }).waitFor();
    } finally {
      await again.close();
    }
  });

  void test('a category template adds its groups at the bottom', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await planMenu(page, 'Add categories from a template…');
    const dlg = page.getByRole('dialog', { name: 'Import Category Template' });
    await dlg.getByRole('button', { name: /^Travel/ }).click();
    await dlg.getByRole('checkbox', { name: 'Souvenirs' }).uncheck();
    try {
      await dlg.getByRole('button', { name: 'Import Categories' }).click();
      await page.getByText('Added the Travel categories at the bottom of your plan.').waitFor();
      await toBottom(page);
      await page.getByRole('main').getByText('Travel Insurance').first().waitFor();
      assert.ok(!(await page.getByRole('main').innerText()).includes('Souvenirs'));
    } finally {
      await app.close();
    }
  });

  void test('New Plan from a template creates and opens the file', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await planMenu(page, 'New plan…');
    const dlg = page.getByRole('dialog', { name: 'New Plan' });
    await dlg.getByLabel('Plan Name').fill('Template Plan');
    await dlg.getByRole('radio', { name: 'A template' }).click();
    try {
      await dlg.getByRole('button', { name: 'Create Plan' }).click();
      await sidebar(page).getByText('Template Plan').first().waitFor();
      await page.getByRole('main').getByText('Rent or Mortgage').first().waitFor();
      assert.ok(existsSync(join(box.root, 'Template Plan.hafb')));
    } finally {
      await app.close();
    }
  });

  void test('Fresh Start keeps this plan as archived and opens the new one with $0 accounts', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await planMenu(page, 'Make a Fresh Start…');
    const dlg = page.getByRole('dialog', { name: 'Make a Fresh Start' });
    await dlg.getByLabel('New Plan Name').fill('Fresh Household');
    try {
      await dlg.getByRole('button', { name: 'Continue' }).click();
      await sidebar(page).getByText('Fresh Household').first().waitFor();
      assert.ok(existsSync(join(box.root, 'Fresh Household.hafb')));
      const side = norm(await sidebar(page).innerText());
      assert.match(side, /Everyday Checking \$0\.00/);
      // The categories came across.
      await page.getByRole('main').getByText('Groceries').first().waitFor();
    } finally {
      await app.close();
    }
    // The original file is kept, renamed "(Archived on …)", with its history.
    const old = await open({}, box.planPath);
    const today = todayLocal();
    await sidebar(old.page).getByText(`(Archived on ${today})`).first().waitFor();
    assert.doesNotMatch(norm(await sidebar(old.page).innerText()), /Everyday Checking \$0\.00/);
    await old.close();
  });
});

// S8.4 packaging: portable mode and About HAFB. Installing, upgrading and uninstalling the MSI need
// an administrator, so they're checked by hand (roadmap S8.4 notes), not here.
void describe('packaging', () => {
  let box: Sandbox;
  before(() => {
    box = makeSandbox();
  });
  after(() => {
    box.cleanup();
  });

  void test('portable mode keeps settings, backups and the WebView2 profile beside the exe and leaves AppData alone', { timeout: 120_000 }, async () => {
    const folder = join(box.root, 'portable');
    const data = join(folder, 'HAFB Data');
    mkdirSync(data, { recursive: true });
    const exe = join(folder, 'HAFB.exe');
    copyFileSync(EXE, exe);
    const appData = join(process.env.LOCALAPPDATA ?? '', 'app.hafb.desktop');
    const snapshot = (): string =>
      existsSync(appData)
        ? readdirSync(appData, { recursive: true })
            .map(String)
            .sort()
            .map((f) => {
              const s = statSync(join(appData, f));
              return `${f} ${String(s.size)} ${String(s.mtimeMs)}`;
            })
            .join('\n')
        : '(none)';
    const before = snapshot();
    // No test overrides: the app finds its data folder on its own.
    const app = await launch(box, ['--open', box.planPath], { HAFB_DATA_DIR: undefined, WEBVIEW2_USER_DATA_FOLDER: undefined }, exe);
    try {
      await app.page.getByRole('treegrid', { name: 'Categories' }).waitFor();
      await app.page.waitForTimeout(1500);
    } finally {
      await app.close();
    }
    assert.ok(existsSync(join(data, 'recent.json')), 'the recent list is in HAFB Data');
    assert.ok(readdirSync(join(data, 'backups'), { recursive: true }).map(String).some((f) => f.endsWith('.hafb')), 'the open backup is in HAFB Data');
    assert.ok(existsSync(join(data, 'EBWebView')), 'the WebView2 profile is in HAFB Data');
    assert.equal(snapshot(), before, 'nothing in %LOCALAPPDATA%\\app.hafb.desktop changed');
  });

  void test('About HAFB shows the version and the third-party licenses', { timeout: 120_000 }, async () => {
    const version = /"version": "([^"]+)"/.exec(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))?.[1] ?? '?';
    const app = await launch(box, ['--open', box.planPath]);
    try {
      const { page } = app;
      await page.getByRole('treegrid', { name: 'Categories' }).waitFor();
      await page.getByRole('navigation', { name: 'Plan navigation' }).locator('button').first().click();
      await page.getByRole('menuitem', { name: 'Help…' }).click();
      const help = page.getByRole('dialog', { name: 'Help' });
      await help.getByRole('button', { name: 'About HAFB' }).click();
      await help.getByText(`Version ${version}`).waitFor();
      await help.getByRole('button', { name: 'Show third-party licenses' }).click();
      const notices = help.getByLabel('Third-party licenses');
      await notices.waitFor();
      const text = await notices.innerText();
      for (const name of ['SQLCipher', 'OpenSSL', 'Microsoft WebView2 loader', 'tauri 2.', 'react 19.', 'Permission is hereby granted']) assert.ok(text.includes(name), `the notices mention ${name}`);
    } finally {
      await app.close();
    }
  });
});

// S8.5 parity audit: the gaps it closed and the UI it found untested, in the release app.
const RENAME_CSV = (rows: string[]): string => `Date,Description,Debit,Credit\n${rows.join('\n')}\n`;

void describe('parity audit (S8.5)', () => {
  let box: Sandbox;
  const running: App[] = [];
  const plan: PlanData = { ...buildSamplePlan().plan, scheduled: [] };
  const open = async (env: Record<string, string> = {}, args: string[] = ['--open']): Promise<App> => {
    const a = await launch(box, args[0] === '--open' ? ['--open', box.planPath] : args, env);
    running.push(a);
    return a;
  };
  before(() => {
    box = makeSandbox(plan);
    writeFileSync(join(box.root, 'fuel1.csv'), RENAME_CSV(['10/09/2026,QUICKFUEL 4471 NASHVILLE TN,41.00,']));
    writeFileSync(join(box.root, 'fuel2.csv'), RENAME_CSV(['10/10/2026,QUICKFUEL 4471 NASHVILLE TN,38.50,']));
    writeFileSync(join(box.root, 'fuel3.csv'), RENAME_CSV(['10/11/2026,QUICKFUEL 4471 NASHVILLE TN,36.25,']));
    const zip = ynabExport(plan, todayLocal(), '2026-10-12 08-00');
    writeFileSync(join(box.root, 'export.zip'), zip.bytes);
  });
  after(async () => {
    for (const a of running) await a.close().catch(() => undefined);
    box.cleanup();
  });
  const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Plan navigation' });

  void test('YNAB import from the welcome screen: account types are checked first; a loan lands in Loans; the numbers match', { timeout: 300_000 }, async () => {
    const zip = join(box.root, 'export.zip');
    mkdirSync(join(box.root, 'imported'), { recursive: true });
    const app = await open({ HAFB_PICK_FILES: zip, HAFB_SAVE_DIR: join(box.root, 'imported') }, []);
    const { page } = app;
    try {
      await page.getByRole('heading', { name: 'Welcome to HAFB' }).waitFor();
      await page.getByRole('button', { name: /Import YNAB export/ }).click();
      const types = page.getByRole('dialog', { name: 'Check your account types' });
      await types.waitFor();
      // HAFB's guesses: the mortgage is off-budget with a debt, so a Liability; it can become a Mortgage.
      const mortgage = types.getByRole('combobox', { name: 'Home Mortgage account type' });
      assert.equal(await mortgage.inputValue(), 'Liability');
      await mortgage.click();
      await page.getByRole('option', { name: 'Mortgage', exact: true }).click();
      // Only same-kind types are offered: a cash account can't become a loan.
      await types.getByRole('combobox', { name: 'Rainy Day Savings account type' }).click();
      assert.deepEqual((await page.getByRole('option').allInnerTexts()).map(norm), ['Checking', 'Savings', 'Cash']);
      await page.getByRole('option', { name: 'Savings', exact: true }).click();
      await types.getByRole('button', { name: 'Continue' }).click();
      const report = page.getByRole('dialog', { name: 'Your YNAB plan is in' });
      await report.waitFor();
      assert.match(norm(await report.innerText()), /Home Mortgage: Mortgage \(as you chose\).*Rainy Day Savings: Savings \(as you chose\)/);
      await report.getByRole('button', { name: 'Start planning' }).click();
      assert.match(norm(await sidebar(page).locator('[data-section=loans]').innerText()), /Home Mortgage/);
      // Ready to Assign is what the same export gives through the store: types never change a number.
      const imported = await importExport(zip);
      const month = monthOf(todayLocal());
      assert.equal(await rta(page), expectedReadyToAssign(imported, month, todayLocal()));
    } finally {
      await app.close();
    }
  });

  void test('a card’s payment category: Pay Off Balance by Date, the pill follows it, and it survives a relaunch', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    const grid = page.getByRole('treegrid', { name: 'Categories' });
    await grid.waitFor();
    const visa = grid.locator('[role=row]', { has: page.locator('[data-col=category]', { hasText: /^Visa Rewards/ }) });
    await visa.locator('[data-col=category]').click({ position: { x: 200, y: 10 } });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await inspector.getByRole('button', { name: 'Create a Debt Payoff Target' }).click();
    await inspector.getByRole('button', { name: 'Save Target' }).click();
    await inspector.getByText('Pay Off Balance by Date').waitFor();
    assert.match(norm(await inspector.innerText()), /Needed for Payoff \$[\d,]+\.\d\d Available for Payment \$[\d,]+\.\d\d To Go \$[\d,]+\.\d\d/);
    assert.match(norm(await visa.innerText()), /more needed by/);
    await app.close();
    const again = await open();
    const g2 = again.page.getByRole('treegrid', { name: 'Categories' });
    await g2.waitFor();
    const v2 = g2.locator('[role=row]', { has: again.page.locator('[data-col=category]', { hasText: /^Visa Rewards/ }) });
    await v2.locator('[data-col=category]').click({ position: { x: 200, y: 10 } });
    await again.page.getByRole('complementary', { name: 'Inspector' }).getByText('Pay Off Balance by Date').waitFor();
    await again.close();
  });

  // Found setting up a plan from a bills spreadsheet: Enter saved the amount from before the typing.
  void test('Enter in a money field saves what was just typed: target, card target and expected income', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    const grid = page.getByRole('treegrid', { name: 'Categories' });
    await grid.waitFor();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const pick = async (name: RegExp): Promise<void> => {
      await grid.locator('[data-col=category]', { hasText: name }).first().click({ position: { x: 200, y: 10 } });
    };
    await pick(/^Streaming/);
    await inspector.getByRole('button', { name: 'Edit Target' }).click();
    await inspector.getByRole('textbox', { name: 'I need' }).fill('45');
    await page.keyboard.press('Enter');
    await inspector.getByRole('button', { name: 'Edit Target' }).waitFor();
    // It was $38.00; before the fix, Enter saved that again.
    assert.match(norm(await inspector.innerText()), /Refill Up to \$45\.00 Each Month/);

    await pick(/^Visa Rewards/);
    const card = inspector.getByRole('button', { name: 'Edit Target' });
    await (await card.isVisible() ? card : inspector.getByRole('button', { name: 'Create a Debt Payoff Target' })).click();
    await inspector.getByRole('combobox', { name: 'Target' }).click();
    await page.getByRole('option', { name: 'Pay Specific Amount Monthly' }).click();
    await inspector.getByLabel('Amount each month').fill('210');
    await page.keyboard.press('Enter');
    await inspector.getByRole('button', { name: 'Edit Target' }).waitFor();
    assert.match(norm(await inspector.innerText()), /Pay Specific Amount Monthly.*\$210\.00/);

    await page.keyboard.press('Escape');
    const all = grid.getByRole('checkbox', { name: 'Select all rows' });
    while ((await grid.getByRole('row', { selected: true }).count()) > 0) await all.click();
    await inspector.getByRole('button', { name: 'Edit expected income' }).click();
    await inspector.getByRole('textbox', { name: 'Expected Income' }).fill('6000');
    await page.keyboard.press('Enter');
    await inspector.getByRole('button', { name: 'Edit expected income' }).waitFor();
    assert.match(norm(await inspector.innerText()), /Expected Income \$6,000\.00/);
    await app.close();
  });

  void test('search suggests criteria as you type; Show Images hides the photo column', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await sidebar(page).getByRole('link', { name: 'All Accounts' }).click();
    const search = page.getByRole('combobox', { name: 'Search transactions' });
    await search.click();
    await page.keyboard.type('gro');
    const list = page.getByRole('listbox', { name: 'Search suggestions' });
    assert.deepEqual((await list.getByRole('option').allInnerTexts()).map(norm), ['Category: Groceries', 'Find “gro” in any field', 'Payee: Find “gro” in the Payee', 'Category: Find “gro” in the Category', 'Memo: Find “gro” in the Memo']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await search.inputValue(), 'Category: Groceries, ');
    const grid = page.locator('[aria-label="All transactions"]');
    const cats = (await grid.locator('[role=row][data-row-id] [data-col=category]').allInnerTexts()).map(norm).filter((c) => c !== '');
    assert.ok(cats.length > 0 && cats.every((c) => c.includes('Groceries') || c.startsWith('Split')), cats.join(' | '));
    await search.fill('');
    const photoHeaders = async (): Promise<number> => grid.locator('[data-col=photo]').count();
    assert.ok((await photoHeaders()) > 0, 'the photo column shows by default');
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'View Options' });
    await view.getByRole('checkbox', { name: 'Show Images' }).uncheck();
    await view.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);
    assert.equal(await photoHeaders(), 0, 'Show Images off hides it');
    await app.close();
  });

  void test('renaming an imported payee learns it for the next import; Don’t rename as keeps the bank’s name', { timeout: 300_000 }, async () => {
    const importFile = async (file: string): Promise<App> => {
      const a = await open({ HAFB_PICK_FILES: join(box.root, file) });
      await sidebar(a.page).getByText('Everyday Checking').first().click();
      await a.page.getByRole('button', { name: 'File Import' }).click();
      const dlg = a.page.getByRole('dialog', { name: 'Import Transactions' });
      await dlg.getByRole('button', { name: 'Import 1' }).click();
      await a.page.waitForTimeout(400);
      return a;
    };
    const grid = (page: Page) => page.getByRole('treegrid', { name: /Everyday Checking transactions/ });
    const row = (page: Page, amount: string) => grid(page).locator('[role=row][data-row-id]', { hasText: amount }).first();

    const first = await importFile('fuel1.csv');
    // Rename the imported payee in the register: the rule is learned in the same step.
    await row(first.page, '$41.00').locator('[data-col=date]').click();
    await first.page.keyboard.press('Enter');
    const payee = grid(first.page).getByRole('combobox', { name: 'Payee' });
    await payee.fill('QuickFuel');
    await first.page.waitForTimeout(150);
    await first.page.keyboard.press('Enter');
    await first.page.keyboard.press('Enter');
    await first.page.getByText(/Future imports of .*QUICKFUEL 4471 NASHVILLE TN.* get this payee too/).waitFor();
    await first.close();

    const second = await importFile('fuel2.csv');
    assert.match(norm(await row(second.page, '$38.50').innerText()), /QuickFuel/);
    // Bank Import Details: Don't rename as QuickFuel.
    await row(second.page, '$38.50').click({ button: 'right' });
    await second.page.getByRole('menuitem', { name: 'Bank Import Details' }).click();
    const details = second.page.getByRole('dialog', { name: 'Bank Import Details' });
    await details.getByRole('button', { name: 'Don’t rename as QuickFuel' }).click();
    await second.page.waitForTimeout(300);
    assert.doesNotMatch(norm(await row(second.page, '$38.50').innerText()), /QuickFuel/);
    await second.close();

    const third = await importFile('fuel3.csv');
    assert.doesNotMatch(norm(await row(third.page, '$36.25').innerText()), /QuickFuel/, 'the bank’s name stays');
    await third.close();
  });

  void test('reconcile with a difference: No, the bank’s balance, Create Adjustment & Finish; a lock unlocks one transaction', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await sidebar(page).locator('[data-section=cash]', { hasText: 'Wallet' }).click();
    const grid = page.getByRole('treegrid', { name: /Wallet transactions/ });
    await grid.waitFor();
    await page.keyboard.press('Shift+E');
    const pop = page.getByRole('dialog', { name: 'Reconcile' });
    await pop.getByRole('button', { name: 'No' }).click();
    await pop.getByLabel('Current balance at your bank').fill('50.00');
    await pop.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Create Adjustment & Finish' }).click();
    await page.waitForTimeout(500);
    assert.ok((await grid.locator('[role=row]', { hasText: 'Reconciliation Balance Adjustment' }).count()) > 0, 'the adjustment');
    assert.match(norm(await page.getByRole('main').innerText()), /\$50\.00 Cleared Balance/);
    const locks = grid.getByRole('button', { name: 'Reconciled. Unlock' });
    const before = await locks.count();
    await locks.first().click();
    await page.getByRole('dialog', { name: 'Unlock this transaction?' }).getByRole('button', { name: 'Unlock' }).click();
    await page.waitForTimeout(300);
    assert.equal(await locks.count(), before - 1, 'only that one is unlocked');
    await app.close();
  });

  void test('Reflect: Spending Trends, Income v Expense and Age of Money open and show the plan', { timeout: 300_000 }, async () => {
    const app = await open();
    const { page } = app;
    await sidebar(page).getByRole('link', { name: 'Reflect' }).click();
    for (const [tab, pattern] of [
      ['Spending Trends', /Average/],
      ['Income v Expense', /Net Income/],
      ['Age of Money', /days?|Age of Money/],
    ] as const) {
      await page.getByRole('tab', { name: tab }).click();
      const panel = page.getByRole('tabpanel', { name: tab });
      await panel.waitFor();
      assert.match(norm(await panel.innerText()), pattern, tab);
    }
    await app.close();
  });
});
