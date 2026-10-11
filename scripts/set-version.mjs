// `pnpm version:set 0.9.1` (S8.4): sets the app's version everywhere it's written. Cargo.toml is
// the source the installer and Tauri use (tauri.conf.json has no version of its own);
// apps/desktop/package.json is what About HAFB shows. A Rust test fails if they disagree.
//
// MSI versions are major.minor.patch with major and minor at most 255 and patch at most 65535, and
// no pre-release tag ("-beta.1"), so betas are numbered 0.9.x.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] ?? '';
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m || Number(m[1]) > 255 || Number(m[2]) > 255 || Number(m[3]) > 65535) {
  console.error('Usage: pnpm version:set <major.minor.patch>  (major and minor up to 255, patch up to 65535, no pre-release tag)');
  process.exit(1);
}

function edit(rel, pattern, replacement) {
  const file = join(root, rel);
  const text = readFileSync(file, 'utf8');
  if (!pattern.test(text)) throw new Error(`set-version: no version found in ${rel}`);
  writeFileSync(file, text.replace(pattern, replacement));
  console.log(`  ${rel}`);
}

console.log(`Setting version ${version}:`);
// The first `version = "…"` in a Cargo.toml is the [package] one.
edit('apps/desktop/src-tauri/Cargo.toml', /^version = "[^"]*"/m, `version = "${version}"`);
edit('apps/desktop/src-tauri/store/Cargo.toml', /^version = "[^"]*"/m, `version = "${version}"`);
edit('apps/desktop/package.json', /"version": "[^"]*"/, `"version": "${version}"`);
// Updates only the workspace's own entries in Cargo.lock; no download.
execFileSync('cargo', ['update', '--workspace', '--offline', '--manifest-path', join(root, 'apps/desktop/src-tauri/Cargo.toml')], { stdio: 'inherit' });
console.log('  Cargo.lock');
