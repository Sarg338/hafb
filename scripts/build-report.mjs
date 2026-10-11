// Runs after `tauri build` (see root `pnpm build`): packs the portable build and prints bundle
// sizes. No network access.
//
// Portable build (S8.4): a zip holding an `HAFB` folder with HAFB.exe, the licenses and an
// `HAFB Data` folder. That folder beside the exe puts HAFB in portable mode (src-tauri/src/paths.rs):
// settings, backups and the WebView2 profile stay in it instead of the PC's AppData.
//
// `node scripts/build-report.mjs aarch64-pc-windows-msvc` reports a cross-compiled ARM64 build.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const arch = target?.startsWith('aarch64') ? 'arm64' : 'x64';
const release = join(root, 'apps', 'desktop', 'src-tauri', 'target', ...(target ? [target] : []), 'release');
const bundle = join(release, 'bundle');
const version = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version;

const exe = join(release, 'hafb.exe');
if (!existsSync(exe)) {
  console.error(`build-report: ${exe} not found. Did \`tauri build\` succeed?`);
  process.exit(1);
}

const portableDir = join(bundle, 'portable');
rmSync(portableDir, { recursive: true, force: true });
const folder = join(portableDir, 'HAFB');
mkdirSync(join(folder, 'HAFB Data'), { recursive: true });
copyFileSync(exe, join(folder, 'HAFB.exe'));
copyFileSync(join(root, 'LICENSE'), join(folder, 'LICENSE.txt'));
copyFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), join(folder, 'THIRD-PARTY-NOTICES.txt'));
writeFileSync(
  join(folder, 'HAFB Data', 'README.txt'),
  [
    'HAFB keeps its settings, recent plans list and backups in this folder, because the folder is',
    'beside HAFB.exe (portable mode). Your plans are wherever you save them.',
    '',
    'Delete or rename this folder and HAFB uses this PC\'s AppData folder instead, like the',
    'installed version.',
    '',
  ].join('\r\n'),
);
const zip = join(portableDir, `HAFB_${version}_${arch}_portable.zip`);
// Windows' own tar (bsdtar) writes zip files; Git's GNU tar earlier on PATH doesn't.
execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', portableDir, 'HAFB']);

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
const msis = existsSync(msiDir) ? readdirSync(msiDir).filter((f) => f.endsWith('.msi') && f.includes(`_${version}_`)) : [];
const dist = join(root, 'apps', 'desktop', 'dist');

const lines = [
  ['App exe', exe, statSync(exe).size],
  ['Portable zip', zip, statSync(zip).size],
  ...msis.map((f) => ['MSI installer', join(msiDir, f), statSync(join(msiDir, f)).size]),
  ['Frontend (embedded in exe)', dist, existsSync(dist) ? dirSize(dist) : 0],
];

console.log(`\nHAFB ${version} (${arch}) build artifacts`);
for (const [label, path, size] of lines) {
  console.log(`  ${label.padEnd(28)} ${mb(size).padStart(10)}  ${relative(root, path)}`);
}
if (msis.length === 0) {
  console.error(`build-report: no ${version} .msi found in bundle/msi.`);
  process.exit(1);
}
