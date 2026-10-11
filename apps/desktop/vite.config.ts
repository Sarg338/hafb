import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const pkg: unknown = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : 'dev';
const NOTICES = new URL('../../THIRD-PARTY-NOTICES.txt', import.meta.url);

/**
 * Fails the build if the UI bundles a package THIRD-PARTY-NOTICES.txt doesn't list (S8.4), so a
 * new dependency can't ship without its license. `node scripts/notices.mjs` updates the file.
 */
function noticesCoverBundle(): Plugin {
  return {
    name: 'hafb-notices-cover-bundle',
    apply: 'build',
    generateBundle(_options, bundle) {
      const notices = readFileSync(NOTICES, 'utf8');
      const missing = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const name = /.*node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1]?.replace('\\', '/');
          if (name && !name.startsWith('@hafb/') && !notices.includes(`\n  ${name} `)) missing.add(name);
        }
      }
      if (missing.size > 0) this.error(`THIRD-PARTY-NOTICES.txt doesn't list ${[...missing].join(', ')}. Run node scripts/notices.mjs.`);
    },
  };
}

// Tauri expects a fixed dev port; the dev server only exists during `pnpm dev`.
export default defineConfig({
  plugins: [react(), noticesCoverBundle()],
  define: { __HAFB_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
