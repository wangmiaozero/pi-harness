import { defineConfig } from '@playwright/test'

/**
 * Electron smoke E2E. Requires a prior `pnpm compile` so `out/main/index.js` exists.
 * Launch uses the local electron binary + built main entry.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry'
  }
})
