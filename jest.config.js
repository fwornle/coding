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
  testPathIgnorePatterns: [
    '/node_modules/',
    '/integrations/'
  ],
  extensionsToTreatAsEsm: ['.ts']
};