// Writes THIRD-PARTY-NOTICES.txt (S8.4): every third-party component built into the app, with its
// license text. Run by `pnpm build` (and `pnpm notices`); the file is committed, so a dependency
// change shows up in review. Reads Cargo's metadata and node_modules only. On a fresh machine Cargo
// downloads the locked sources of crates only the other target uses (crates.io, checksums from
// Cargo.lock); nothing else goes over the network.
//
// - Rust: crates the app links (normal dependencies of `hafb`, for x64 and ARM64 Windows).
// - C code those crates compile in: SQLCipher/SQLite, OpenSSL's crypto, Microsoft's WebView2 loader.
// - JavaScript: packages the UI bundles. vite.config.ts fails the build if the bundle holds a
//   package this file doesn't list.
// A license outside ALLOWED fails the run, so nothing lands in the app unreviewed.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
const out = join(root, 'THIRD-PARTY-NOTICES.txt');
const TARGETS = ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'];

// Permissive licenses, plus MPL-2.0 (file-level copyleft: it asks only that the source of those
// files stays available, which crates.io does; the notices say so), and CDLA-Permissive-2.0 (a
// permissive data license: Mozilla's root certificates in webpki-roots, for bank sync, S8.6; it
// asks only that its text goes with the data). In order of preference when a component offers a choice.
const ALLOWED = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'Zlib', '0BSD', 'Unicode-3.0', 'Unicode-DFS-2016', 'BSL-1.0', 'CC0-1.0', 'Unlicense', 'MPL-2.0', 'CDLA-Permissive-2.0'];
const ALLOWED_EXCEPTIONS = ['LLVM-exception'];

// ---- SPDX expressions: pick the preferred allowed choice ----

function tokens(expr) {
  // Old crates write "MIT/Apache-2.0" for "MIT OR Apache-2.0".
  return expr.replace(/\//g, ' OR ').replace(/([()])/g, ' $1 ').trim().split(/\s+/);
}

/** The licenses a component is used under, or null if no choice is allowed. */
export function chooseLicenses(expr) {
  const t = tokens(expr);
  let i = 0;
  const rank = (set) => (set ? Math.max(...set.map((id) => ALLOWED.indexOf(id.split(' WITH ')[0]))) : Infinity);
  function primary() {
    if (t[i] === '(') {
      i++;
      const v = or();
      i++; // ')'
      return v;
    }
    let id = t[i++];
    if (t[i] === 'WITH') {
      const exception = t[i + 1];
      i += 2;
      return ALLOWED.includes(id) && ALLOWED_EXCEPTIONS.includes(exception) ? [`${id} WITH ${exception}`] : null;
    }
    id = id.replace(/\+$/, '');
    return ALLOWED.includes(id) ? [id] : null;
  }
  function and() {
    let v = primary();
    while (t[i] === 'AND') {
      i++;
      const w = primary();
      v = v && w ? [...new Set([...v, ...w])] : null;
    }
    return v;
  }
  function or() {
    let best = and();
    while (t[i] === 'OR') {
      i++;
      const w = and();
      if (rank(w) < rank(best)) best = w;
    }
    return best;
  }
  return or();
}

// ---- License texts ----

/** What a license file's text is, from its wording. */
function classify(text) {
  // Unicode's license reuses MIT's opening words, so it is checked first.
  if (/UNICODE LICENSE|Unicode, Inc\./i.test(text)) return /LICENSE V3/i.test(text) ? 'Unicode-3.0' : 'Unicode-DFS-2016';
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/Apache License,?\s+Version 2\.0/i.test(text) && /TERMS AND CONDITIONS/.test(text)) return 'Apache-2.0';
  if (/Boost Software License/i.test(text)) return 'BSL-1.0';
  if (/Mozilla Public License,? Version 2\.0/i.test(text)) return 'MPL-2.0';
  if (/This is free and unencumbered software released into the public domain/i.test(text)) return 'Unlicense';
  if (/Permission to use, copy, modify, and\/or distribute this software for any/i.test(text)) return /copyright notice and this permission notice appear/i.test(text) ? 'ISC' : '0BSD';
  if (/This software is provided 'as-is'/i.test(text)) return 'Zlib';
  if (/Redistribution and use in source and binary forms/i.test(text)) return /Neither the name|names of its contributors/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/CC0|Creative Commons Zero/i.test(text)) return 'CC0-1.0';
  if (/Community Data License Agreement - Permissive - Version 2\.0/i.test(text)) return 'CDLA-Permissive-2.0';
  return null;
}

function licenseFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|copyright|notice)/i.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim();
      return { file: f, text, kind: /^notice/i.test(f) ? 'NOTICE' : classify(text) };
    });
}

const MIT_TEMPLATE = (holder) => `Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const BSD3_TEMPLATE = (holder) => `Copyright (c) ${holder}. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

// Standard texts found in some component, for components that name a license but ship no file.
// Only for licenses whose text names no copyright holder.
const standard = new Map();
const STANDARD_IDS = ['Apache-2.0', 'MPL-2.0', 'BSL-1.0'];

/** The texts to print for one component: one per chosen license, plus any NOTICE file. */
function textsFor(component) {
  const files = licenseFiles(component.dir);
  const texts = [];
  for (const id of component.chosen) {
    const base = id.split(' WITH ')[0];
    const match = files.find((f) => f.kind === base) ?? (files.filter((f) => f.kind !== 'NOTICE').length === 1 && component.chosen.length === 1 ? files.find((f) => f.kind !== 'NOTICE') : undefined);
    if (match) texts.push(match.text);
    else if (base === 'MIT') texts.push(MIT_TEMPLATE(component.authors || `the ${component.name} authors`));
    else if (base === 'BSD-3-Clause') texts.push(BSD3_TEMPLATE(component.authors || `the ${component.name} authors`));
    else if (STANDARD_IDS.includes(base) && standard.has(base)) texts.push(standard.get(base));
    else throw new Error(`notices: no ${base} text for ${component.name} ${component.version} (${component.dir})`);
  }
  for (const f of files) if (f.kind === 'NOTICE') texts.push(f.text);
  return texts;
}

// ---- Rust ----

/** Crates the app links, plus every package in the tree by name (build dependencies included). */
function cargoComponents() {
  const byId = new Map();
  const everything = new Map();
  for (const target of TARGETS) {
    const meta = JSON.parse(
      execFileSync('cargo', ['metadata', '--format-version', '1', '--manifest-path', manifest, '--filter-platform', target, '--locked'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
    );
    const packages = new Map(meta.packages.map((p) => [p.id, p]));
    for (const p of meta.packages) everything.set(p.name, { name: p.name, version: p.version, dir: dirname(p.manifest_path) });
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    const members = new Set(meta.workspace_members);
    const start = meta.packages.find((p) => p.name === 'hafb' && members.has(p.id)).id;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const dep of nodes.get(queue.shift()).deps) {
        if (!dep.dep_kinds.some((k) => k.kind === null) || seen.has(dep.pkg)) continue;
        seen.add(dep.pkg);
        queue.push(dep.pkg);
      }
    }
    for (const id of seen) {
      if (members.has(id)) continue;
      const p = packages.get(id);
      byId.set(id, { name: p.name, version: p.version, license: p.license ?? '', dir: dirname(p.manifest_path), authors: p.authors.join(', ').replace(/\s*<[^>]*>/g, '') });
    }
  }
  return { crates: [...byId.values()], everything };
}

// ---- C code compiled into the app ----

function bundledC(everything) {
  const crate = (name) => {
    const c = everything.get(name);
    if (!c) throw new Error(`notices: ${name} is no longer in the tree; update bundledC()`);
    return c;
  };
  const sqlite = crate('libsqlite3-sys');
  const amalgamation = readFileSync(join(sqlite.dir, 'sqlcipher', 'sqlite3.c'), 'utf8');
  const sqlcipherVersion = /#define CIPHER_VERSION_NUMBER (\S+)/.exec(amalgamation)?.[1];
  const sqliteVersion = /#define SQLITE_VERSION\s+"([^"]+)"/.exec(amalgamation)?.[1];
  const openssl = crate('openssl-src');
  const webview2 = crate('webview2-com-sys');
  return [
    { name: 'SQLCipher', version: sqlcipherVersion, license: 'BSD-3-Clause', chosen: ['BSD-3-Clause'], dir: join(sqlite.dir, 'sqlcipher'), note: `Zetetic LLC; compiled in by libsqlite3-sys ${sqlite.version}` },
    {
      name: 'SQLite',
      version: sqliteVersion,
      license: 'blessing (public domain)',
      chosen: [],
      dir: '',
      note: 'included in SQLCipher',
      extra: 'The author disclaims copyright to this source code. In place of a legal notice, here is a blessing:\n\n    May you do good and not evil.\n    May you find forgiveness for yourself and forgive others.\n    May you share freely, never taking more than you give.',
    },
    { name: 'OpenSSL (libcrypto)', version: openssl.version.split('+')[1], license: 'Apache-2.0', chosen: ['Apache-2.0'], dir: join(openssl.dir, 'openssl'), note: `compiled in by openssl-src ${openssl.version}` },
    {
      name: 'Microsoft WebView2 loader',
      version: '',
      license: 'BSD-3-Clause',
      chosen: ['BSD-3-Clause'],
      dir: join(root, 'scripts', 'notices'),
      files: ['webview2-sdk-LICENSE.txt'],
      note: `WebView2LoaderStatic.lib from the WebView2 SDK, linked in by webview2-com-sys ${webview2.version}`,
    },
  ];
}

// ---- JavaScript ----

/** Packages bundled into the UI that are build-time dependencies (their code is inlined). */
const BUNDLED_DEV_DEPENDENCIES = ['@fluentui/svg-icons'];

function packageDir(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error(`notices: can't find ${name} from ${from}`);
  }
}

export function jsComponents() {
  const desktop = join(root, 'apps', 'desktop');
  const result = new Map();
  const visit = (name, from) => {
    const dir = packageDir(name, from);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (result.has(key) || name.startsWith('@hafb/')) {
      if (name.startsWith('@hafb/') && !result.has(key)) {
        result.set(key, null); // ours: follow its dependencies, don't list it
        for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
      }
      return;
    }
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? '');
    const authorOf = (a) => (typeof a === 'string' ? a.replace(/\s*[<(][^>)]*[>)]/g, '') : (a?.name ?? ''));
    result.set(key, { name: pkg.name, version: pkg.version, license, dir, authors: authorOf(pkg.author) || (pkg.contributors ?? []).map(authorOf).join(', ') });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
  };
  const app = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
  for (const dep of [...Object.keys(app.dependencies), ...BUNDLED_DEV_DEPENDENCIES]) visit(dep, desktop);
  return [...result.values()].filter(Boolean);
}

// ---- Output ----

function choose(components) {
  const bad = [];
  for (const c of components) {
    if (c.chosen) continue;
    c.chosen = chooseLicenses(c.license);
    if (!c.chosen) bad.push(`${c.name} ${c.version}: ${c.license || '(none)'}`);
  }
  if (bad.length) throw new Error(`notices: licenses not on the allowed list:\n  ${bad.join('\n  ')}`);
}

function main() {
  const { crates, everything } = cargoComponents();
  const c = bundledC(everything);
  const js = jsComponents();
  const all = [...c, ...crates, ...js];
  choose(all);
  // Standard texts for components that name a license without shipping its file.
  for (const comp of [...c, ...crates]) {
    for (const f of licenseFiles(comp.dir)) if (f.kind && f.kind !== 'MIT' && f.kind !== 'NOTICE' && !standard.has(f.kind)) standard.set(f.kind, f.text);
  }

  const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true });
  crates.sort(byName);
  js.sort(byName);

  // Group identical texts so each is printed once.
  const groups = new Map();
  const label = (comp) => `${comp.name}${comp.version ? ` ${comp.version}` : ''}`;
  for (const comp of all) {
    const texts = comp.extra ? [comp.extra] : comp.files ? comp.files.map((f) => readFileSync(join(comp.dir, f), 'utf8').replace(/\r\n/g, '\n').trim()) : textsFor(comp);
    for (const text of texts) {
      const key = text.replace(/\s+/g, ' ');
      if (!groups.has(key)) groups.set(key, { text, users: [] });
      groups.get(key).users.push(label(comp));
    }
  }

  const line = (comp) => {
    const used = comp.chosen.length ? comp.chosen.join(' AND ') : comp.license;
    const offered = comp.chosen.length && comp.license && comp.license !== used ? ` (offered as ${comp.license})` : '';
    return `  ${label(comp)} - ${used}${offered}${comp.note ? `; ${comp.note}` : ''}`;
  };
  const rule = '='.repeat(78);
  const parts = [
    'THIRD-PARTY SOFTWARE NOTICES',
    '',
    'HAFB is free software under the MIT License (see LICENSE.txt). It is built with the',
    'open-source components below, each under its own license. The license texts follow the list.',
    'Where a component offers a choice of licenses, HAFB uses it under the one shown.',
    'HAFB uses the MPL-2.0 components unmodified; their source code is available from',
    'https://crates.io under the name and version shown.',
    '',
    'Generated by scripts/notices.mjs from the Rust and JavaScript dependency trees.',
    '',
    rule,
    `C LIBRARIES COMPILED INTO THE APP (${c.length})`,
    ...c.map(line),
    '',
    `RUST CRATES (${crates.length})`,
    ...crates.map(line),
    '',
    `JAVASCRIPT PACKAGES (${js.length})`,
    ...js.map(line),
    '',
    rule,
    'LICENSE TEXTS',
  ];
  const wrap = (text) => {
    const lines = [''];
    for (const word of text.split(' ')) {
      if (lines[lines.length - 1].length + word.length + 1 > 78 && lines[lines.length - 1]) lines.push('  ');
      lines[lines.length - 1] += (lines[lines.length - 1].trim() ? ' ' : '') + word;
    }
    return lines.join('\n');
  };
  for (const g of groups.values()) {
    parts.push('', rule, wrap(`Used by: ${g.users.join(', ')}`), '-'.repeat(78), g.text);
  }
  writeFileSync(out, `${parts.join('\n')}\n`);
  console.log(`notices: ${c.length} C libraries, ${crates.length} crates, ${js.length} JS packages, ${groups.size} distinct texts -> ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
