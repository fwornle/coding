// ESLint flat config for the dashboard.
//
// ── What was here before ────────────────────────────────────────────────────
// A Next.js config: `compat.extends("next/core-web-vitals", "next/typescript")`
// with ignores for `.next/**`, `out/**` and `next-env.d.ts`. This is a Vite +
// React project and `next` has never been a dependency, so every invocation —
// `npm run lint`, or eslint on a single file — died at config load with
// "ESLint couldn't find the config next/core-web-vitals to extend from".
// Nothing was ever linted. The paired `--ext ts,tsx` in the lint script was
// the second half of the same mismatch: flat config replaced `--ext` with the
// `files` globs below, and passing it aborts before any config is read.
//
// So this is not a tightening of an existing gate — it is the first config
// that loads. Expect it to report pre-existing violations.
//
// ── Why the rules are what they are ────────────────────────────────────────
// Built from the plugins the project already installs (@typescript-eslint 7,
// react-hooks, react-refresh) rather than a shared preset, because adding a
// preset means adding a dependency, and the point here is to make the
// existing toolchain work. Flat config matches the repo root's own
// eslint.config.js, which documents the same 8.57-picks-it-up reasoning.
//
// Deliberately NOT type-aware (no parserOptions.project): the type-checked
// rule set needs a full TS program per lint run, and `tsc --noEmit` already
// gates the build via `npm run build`. This config covers what types cannot —
// unused code, hook rules, hazards tsc is happy with.

import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    // Build outputs, vendored assets and dependencies. `dist/**` matters most:
    // it holds the minified bundle, which is both enormous and not ours.
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'public/**',
      'assets/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  // Plain JS/MJS: the API servers (server.js, static-server.js) and the two
  // .mjs helpers the root test suite imports. Node globals, not browser.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // The React app.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // TS's own checker owns undefined identifiers and redeclaration; the
      // base rules duplicate it and misfire on type-only syntax.
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },

  // Playwright specs run in Node and talk to a browser; they legitimately use
  // both global sets and the config-object export pattern react-refresh flags.
  {
    files: ['tests/**/*.{ts,tsx}', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
];
