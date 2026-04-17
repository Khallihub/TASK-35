module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '@harborstone/shared': '<rootDir>/../../packages/shared/src/index.ts',
  },
  testTimeout: 30000,
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  // Coverage configuration. Run with `npm test -- --coverage` to enforce.
  // Thresholds are set below the current measured coverage so a regression
  // fails the build; raise them as the suite grows.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/server.ts',
    '!src/db/migrations/**',
    '!src/db/seeds/**',
    // Scheduler entrypoint is infrastructure (60-second setInterval loop).
    // Its exported helpers (runJob, startScheduler/stopScheduler, JOBS map)
    // are covered by tests/jobs/runner.test.ts; the wall-clock tick body is
    // exercised end-to-end through the docker compose stack and the
    // retention / audit-verify / export jobs it dispatches are individually
    // covered by their own service tests.
    '!src/jobs/runner.ts',
    // InMemoryRepository / list helpers in storage/repository.ts are unused
    // in production (prod wraps LocalFileSystemRepository with encryption)
    // and only referenced by mocked test suites. Writes/reads through the
    // real EncryptedStorageRepository are covered by coverage.attachments
    // and coverage.analytics.
    '!src/storage/repository.ts',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      lines: 90,
      statements: 85,
      functions: 90,
      branches: 65,
    },
  },
};
