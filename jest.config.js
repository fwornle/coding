import { nodeTestFilesRelative } from './scripts/lib/test-inventory.mjs';

// Suites that register their tests with node:test. jest collects them (they end
// in .test.js) but cannot see a single one of their registrations, so each was
// reported as "Your test suite must contain at least one test". They are run by
// `npm run test:node` instead. Derived from the same inventory that runner uses,
// so a file can never be claimed by both runners or dropped by both.
const NODE_TEST_SUITES = nodeTestFilesRelative().map(
  (f) => `/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
);

// Copies of this repo that live INSIDE it. Each carries a full lib/km-core, and
// jest-haste-map indexes every package.json it can reach — so 19 stale snapshots
// under .data/run-restores/ made `@fwornle/km-core` ambiguous and took out 57 of
// 115 suites with a duplicate-module error that named none of the real cause.
//
// testPathIgnorePatterns below does NOT prevent this: it stops these paths being
// collected as TESTS, but the module map is a separate scan governed by
// modulePathIgnorePatterns. The exclusion has to be stated twice to hold.
const REPO_COPIES = [
  '/\\.data/run-restores/',
  '/\\.data/kgbench/trees/',
  '/\\.claude/worktrees/'
];

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'ts', 'json'],
  testMatch: [
    '**/test/**/*.test.js',
    '**/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    'lib/**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      // Use a jest-only tsconfig with rootDir='.' so pure TS modules under
      // integrations/system-health-dashboard/src/components/performance/ (imported by
      // root tests) transpile without the root build's rootDir='./src' constraint.
      // Does NOT alter the root tsconfig used by `npm run build`.
      tsconfig: 'tsconfig.jest.json'
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  // Keeps these paths from being COLLECTED as tests.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/integrations/',
    // Leftover experiment sandbox worktrees carry a FULL repo snapshot (incl. tests
    // + an old health-coordinator.js). Without this, jest matches N stale copies of
    // every test and reports failures against frozen code we never edit.
    // kgbench builds a per-run worktree under .data/kgbench/trees/ for the same
    // reason. .gitignore does not help — jest walks the filesystem, not git.
    ...REPO_COPIES,
    ...NODE_TEST_SUITES
  ],
  // Keeps the same paths out of the MODULE MAP. Separate setting, separate scan:
  // without this, jest still indexes their package.json files and errors out on
  // duplicate @fwornle/km-core before running anything.
  modulePathIgnorePatterns: REPO_COPIES,
  extensionsToTreatAsEsm: ['.ts']
};