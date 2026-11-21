/** 세 프로젝트: unit(DB 불필요) / integration(실제 PG·Mongo·Redis) / e2e(HTTP 전체 흐름) */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: true }] },
};
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/web/src/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      setupFiles: ['<rootDir>/test/env.ts'],
      testTimeout: 30000,
    },
    {
      ...base,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/env.ts'],
      testTimeout: 45000,
    },
  ],
};
