// ESLint flat config.
//
// `npm run lint` (eslint lib/) has existed since the first commit of this repo
// (810fe382b, 2025-06-15) and has NEVER run: no root config was ever committed, so
// every invocation died with "ESLint couldn't find a configuration file". This is
// that file.
//
// Flat config rather than .eslintrc: ESLint 8.57 already picks up eslint.config.js
// from the working directory with no ESLINT_USE_FLAT_CONFIG needed (verified
// against the pinned 8.57.1), and eslintrc is removed in ESLint 10 — so the modern
// format costs nothing today and survives the upgrade.

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Directories with their own toolchain, or that are not ours to lint.
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.data/**',
      '.claude/**',
      'docs/**',
      'docs-content/**',
      // Git submodules. Each carries its own config and its own review; linting
      // them here would report other repositories' code as this one's problems.
      'lib/km-core/**',
      'integrations/**',
      // Build outputs and vendored bundles that happen to live under lib/.
      'lib/**/dist/**',
      'lib/**/vendor/**',
    ],
  },

  js.configs.recommended,

  {
    // .cjs is included so the rule options below apply to it too; the block that
    // follows re-declares its sourceType as commonjs (later blocks win).
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',        // package.json declares "type": "module"
      globals: { ...globals.node },
    },
    rules: {
      // Unused function arguments are frequently part of a callback contract
      // (express `next`, node's `(err, res)`), so only flag them when they trail
      // the last used one. Leading underscore opts out explicitly.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },

  {
    // .cjs is CommonJS regardless of the package-level "type": "module".
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    // A deliberate browser shim — window/document are its whole point.
    files: ['lib/fallbacks/browser-fallback.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    // Test files add the jest globals on top of node's.
    files: ['tests/**', 'test/**', '**/*.test.js', '**/*.test.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
];
