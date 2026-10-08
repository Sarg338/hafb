// pnpm import:ynab <export.zip> <out.hafb> [--today YYYY-MM-DD] [--name "Plan name"]
//                  [--account-type "Name=mortgage"]... [--currency USD] [--force]
//
// YNAB export → a new plan file (ADR 0002 §8). The import itself is the pure @hafb/store importer;
// the file is written by the desktop crate's `hafb-store` CLI, so the migration runner and writer
// exist only once, in Rust. Runs offline: reads one local zip, writes one local file.
//
// Run by Node directly (--experimental-strip-types). Imports are relative paths into the
// workspace sources: the repo root doesn't depend on its own packages, and Node's type stripping
// handles these .ts files without a build step.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError, type AccountType } from '../packages/engine/src/index.ts';
import { isISODate, uuidv7Generator, type ISODate } from '../packages/shared/src/index.ts';
import { encodePlan } from '../packages/store/src/codec.ts';
import { exportDateFromName, findExportFiles, importYnabExport } from '../packages/store/src/import/ynab.ts';
import { readZip } from '../packages/store/src/import/zip.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
const ACCOUNT_TYPES: readonly AccountType[] = [
  'checking', 'savings', 'cash', 'creditCard', 'lineOfCredit', 'mortgage', 'autoLoan', 'studentLoan',
  'personalLoan', 'medicalDebt', 'otherDebt', 'asset', 'liability',
];

const USAGE = `usage: pnpm import:ynab <export.zip> <out.hafb> [options]

  --today YYYY-MM-DD           the export's date (default: from the file names, else today)
  --name "Plan name"           default: the plan name in the export
  --account-type "Name=type"   set an account's type (repeatable); types: ${ACCOUNT_TYPES.join(', ')}
  --currency CODE              ISO 4217 code (default USD)
  --force                      overwrite <out.hafb> if it exists`;

interface Args {
  zip: string;
  out: string;
  today?: ISODate;
  name?: string;
  accountTypes: Record<string, AccountType>;
  currency?: string;
  force: boolean;
}

function fail(message: string): never {
  console.error(`import:ynab: ${message}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const accountTypes: Record<string, AccountType> = {};
  let today: ISODate | undefined;
  let name: string | undefined;
  let currency: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const value = (): string => {
      const v = argv[i + 1];
      if (v === undefined) fail(`${arg} needs a value\n\n${USAGE}`);
      i += 1;
      return v;
    };
    if (arg === '--') continue;
    else if (arg === '--force') force = true;
    else if (arg === '--today') {
      const v = value();
      if (!isISODate(v)) fail(`--today must be YYYY-MM-DD, got "${v}"`);
      today = v;
    } else if (arg === '--name') name = value();
    else if (arg === '--currency') currency = value().toUpperCase();
    else if (arg === '--account-type') {
      const v = value();
      const eq = v.lastIndexOf('=');
      const type = ACCOUNT_TYPES.find((t) => t === v.slice(eq + 1));
      if (eq <= 0 || type === undefined) fail(`--account-type must be "Account name=type", got "${v}"\n\n${USAGE}`);
      accountTypes[v.slice(0, eq)] = type;
    } else if (arg === '--help' || arg === '-h') {
      console.info(USAGE);
      process.exit(0);
    } else if (arg.startsWith('--')) fail(`unknown option ${arg}\n\n${USAGE}`);
    else positional.push(arg);
  }
  const [zip, out] = positional;
  if (zip === undefined || out === undefined || positional.length > 2) fail(USAGE);
  return {
    zip: resolve(zip),
    out: resolve(out),
    accountTypes,
    force,
    ...(today === undefined ? {} : { today }),
    ...(name === undefined ? {} : { name }),
    ...(currency === undefined ? {} : { currency }),
  };
}

function localToday(): ISODate {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!isISODate(iso)) throw new Error(`bad local date ${iso}`);
  return iso;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.zip)) fail(`${args.zip} not found`);
  if (existsSync(args.out) && !args.force) fail(`${args.out} already exists (use --force to replace it)`);

  const entries = await readZip(new Uint8Array(readFileSync(args.zip)));
  const files = findExportFiles(entries.keys());
  const text = (entry: string): string => new TextDecoder('utf-8').decode(entries.get(entry));
  const today = args.today ?? exportDateFromName(files.planFile) ?? localToday();
  const planName = args.name ?? (files.planName || basename(args.out, '.hafb'));

  const { plan, report } = importYnabExport(
    { planCsv: text(files.planFile), registerCsv: text(files.registerFile) },
    {
      today,
      now: new Date().toISOString(),
      // Ordered ids: key order is entry order, which breaks engine ties (ADR 0002 §5).
      newId: uuidv7Generator(() => Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n))),
      planName,
      accountTypes: args.accountTypes,
      ...(args.currency === undefined ? {} : { currencyCode: args.currency }),
    },
  );

  const cargoArgs = ['run', '--quiet', '--manifest-path', MANIFEST, '-p', 'hafb-store', '--bin', 'hafb-store', '--', 'create', args.out];
  if (args.force) cargoArgs.push('--force');
  const result = spawnSync('cargo', cargoArgs, {
    input: JSON.stringify(encodePlan(plan)),
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) fail(`could not run cargo (${result.error.message}); is the Rust toolchain installed?`);
  if (result.status !== 0) fail(`hafb-store create failed (exit ${String(result.status)})`);

  const c = report.counts;
  console.info(`Imported "${planName}" (as of ${today}) → ${args.out}`);
  console.info(
    `  ${String(c.accounts)} accounts, ${String(c.categoryGroups)} groups, ${String(c.categories)} categories, ${String(c.payees)} payees`,
  );
  console.info(
    `  ${String(c.transactions)} transactions (${String(c.splits)} splits, ${String(c.transferPairs)} transfer pairs), ` +
      `${String(c.assignments)} assignments over ${String(c.months)} months, ${String(c.scheduled)} upcoming`,
  );
  console.info('\nAccount types (the export doesn\'t include them; fix with --account-type "Name=type"):');
  for (const a of report.accounts) console.info(`  ${a.name}: ${a.type}${a.onBudget ? '' : ' (off-budget)'} (${a.reason})`);
  if (report.loanAccountsWithoutDetails.length > 0) {
    console.info(`\nLoan details aren't exported; enter the interest rate and payment for: ${report.loanAccountsWithoutDetails.join(', ')}`);
  }
  if (report.scheduledWithoutRepeat > 0) {
    console.info(`\n${String(report.scheduledWithoutRepeat)} upcoming transaction(s) imported as one-offs; set their repeat in the app.`);
  }
  if (report.targetsToReenter.length > 0) {
    console.info(`\nTargets aren't exported. Categories to re-enter targets for (${String(report.targetsToReenter.length)}):`);
    for (const t of report.targetsToReenter) console.info(`  ${t.group}: ${t.name}`);
  }
  if (report.warnings.length > 0) {
    console.info(`\nWarnings (${String(report.warnings.length)}):`);
    for (const w of report.warnings) console.info(`  ${w}`);
  }
}

main().catch((e: unknown) => {
  if (e instanceof ValidationError) fail(e.message);
  throw e;
});
