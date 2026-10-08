import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Purity rules for packages that must stay platform-free (CLAUDE.md §3, §8, §9).
const pureRules = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['@tauri-apps/*', 'react', 'react-dom', 'react/*', 'react-dom/*'], message: 'Engine/shared must not depend on UI or Tauri.' },
        { group: ['**/apps/**', '@hafb/desktop'], message: 'packages/* must never import from apps/.' },
        { group: ['node:*', 'fs', 'path', 'os'], message: 'No I/O in pure packages.' },
      ],
    },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: 'Pass `today` in; the engine is pure.' },
    { object: 'Math', property: 'random', message: 'The engine is deterministic.' },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'process', message: 'No I/O or environment access in pure packages.' },
    { name: 'Buffer', message: 'No I/O in pure packages.' },
    { name: 'setTimeout', message: 'The engine is synchronous and deterministic.' },
    { name: 'setInterval', message: 'The engine is synchronous and deterministic.' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "NewExpression[callee.name='Date']", message: 'Use ISODate/Month strings and helpers in @hafb/shared, never Date objects.' },
  ],
};

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    'apps/desktop/src-tauri/',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md §9: no `as` casts outside test fixtures and the DB boundary.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  {
    files: ['packages/engine/src/**/*.ts', 'packages/shared/src/**/*.ts', 'packages/store/src/**/*.ts'],
    rules: pureRules,
  },

  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },

  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },

  // Plain JS (this file, build scripts): no type information.
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
