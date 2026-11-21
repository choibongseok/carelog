import { defineConfig } from '@playwright/test';

// 로컬에 설치된 Chrome 을 쓴다. 없으면 PW_CHANNEL= (빈 값)으로 Playwright 의 Chromium 을 쓴다.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? '../.pw-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173/carelog/',
    channel: process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL || undefined,
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/carelog/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
