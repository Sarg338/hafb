// Smoke-test harness (S3.5): drives the real release build through WebView2's DevTools port.
// Playwright (playwright-core, no bundled browsers) connects over CDP. This replaces the
// tauri-driver/WebDriver route CLAUDE.md §2 anticipated (ADR 0005).
//
// Isolation: every run uses its own app data folder (HAFB_DATA_DIR) and WebView2 profile
// (WEBVIEW2_USER_DATA_FOLDER), so Sarg's recent list, backups, prefs and window state are untouched.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { encodePlan, type PlanData } from '@hafb/store';
import { buildSamplePlan } from '../src/design/sample.ts';

export const DESKTOP = resolve(import.meta.dirname, '..');
export const EXE = join(DESKTOP, 'src-tauri', 'target', 'release', 'hafb.exe');
const MANIFEST = join(DESKTOP, 'src-tauri', 'Cargo.toml');

export interface Sandbox {
  root: string;
  dataDir: string;
  webviewDir: string;
  planPath: string;
  cleanup: () => void;
}

/**
 * A temp folder with a real .hafb plan file: the sample household unless another plan is given.
 * The sample's schedules are left out by default: they come due by the real calendar (and would
 * enter themselves on open), so tests that want schedules add their own relative to today.
 */
export function makeSandbox(plan: PlanData = { ...buildSamplePlan().plan, scheduled: [] }): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'hafb-smoke-'));
  const planPath = join(root, `${plan.settings.name.replace(/[^\w -]/g, '')}.hafb`);
  const changes = join(root, 'plan.json');
  writeFileSync(changes, JSON.stringify(encodePlan(plan)));
  const r = spawnSync('cargo', ['run', '-q', '--manifest-path', MANIFEST, '-p', 'hafb-store', '--', 'create', planPath], {
    input: readFileSync(changes, 'utf8'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`hafb-store create failed: ${r.stderr}`);
  return {
    root,
    dataDir: join(root, 'appdata'),
    webviewDir: join(root, 'webview'),
    planPath,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

export interface App {
  page: Page;
  browser: Browser;
  process: ChildProcess;
  close: () => Promise<void>;
}

let nextPort = 9400 + Math.floor(Math.random() * 300);

/** Launch the release app (optionally opening a plan) and connect Playwright to its webview. */
export async function launch(sandbox: Sandbox, args: string[] = []): Promise<App> {
  if (!existsSync(EXE)) throw new Error(`Build the app first (pnpm build): ${EXE} is missing`);
  const port = nextPort++;
  const child = spawn(EXE, args, {
    env: {
      ...process.env,
      HAFB_DATA_DIR: sandbox.dataDir,
      WEBVIEW2_USER_DATA_FOLDER: sandbox.webviewDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${String(port)}`,
    },
    stdio: 'ignore',
  });
  let browser: Browser | undefined;
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!browser) {
    child.kill();
    throw new Error('Could not connect to the app webview');
  }
  const page = await firstPage(browser);
  await page.waitForLoadState('domcontentloaded');
  return {
    page,
    browser,
    process: child,
    close: async () => {
      await browser.close().catch(() => undefined);
      child.kill();
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

/** The app's page (WebView2 starts on about:blank, then navigates to tauri.localhost). */
async function firstPage(browser: Browser): Promise<Page> {
  for (let i = 0; i < 80; i++) {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().startsWith('http://tauri.localhost'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('The app page never loaded');
}
