// Runs after `tauri build` (see root `pnpm build`): copies the raw release exe out as the
// portable build and prints bundle sizes for the Phase 0 report. No network access.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = join(root, 'apps', 'desktop', 'src-tauri', 'target', 'release');
const bundle = join(release, 'bundle');

const exe = join(release, 'hafb.exe');
if (!existsSync(exe)) {
  console.error(`build-report: ${exe} not found. Did \`tauri build\` succeed?`);
  process.exit(1);
}

const portableDir = join(bundle, 'portable');
mkdirSync(portableDir, { recursive: true });
const portable = join(portableDir, 'HAFB-portable.exe');
copyFileSync(exe, portable);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
}

const msiDir = join(bundle, 'msi');
const msis = existsSync(msiDir) ? readdirSync(msiDir).filter((f) => f.endsWith('.msi')) : [];
const dist = join(root, 'apps', 'desktop', 'dist');

const lines = [
  ['Portable exe', portable, statSync(portable).size],
  ...msis.map((f) => ['MSI installer', join(msiDir, f), statSync(join(msiDir, f)).size]),
  ['Frontend (embedded in exe)', dist, existsSync(dist) ? dirSize(dist) : 0],
];

console.log('\nHAFB build artifacts');
for (const [label, path, size] of lines) {
  console.log(`  ${label.padEnd(28)} ${mb(size).padStart(10)}  ${relative(root, path)}`);
}
if (msis.length === 0) {
  console.error('build-report: no .msi found in bundle/msi.');
  process.exit(1);
}
