/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/api', '<rootDir>/tests/database'],
  testMatch: ['**/*.test.ts'],
  // The API suites share one live backend and its data (they create users/teams and pick
  // teams by recency), so they run one file at a time.
  maxWorkers: 1,
  collectCoverageFrom: [
    'server/**/*.ts',
    'src/lib/**/*.ts',
    '!**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
      },
    },
  },
};
