import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against a dedicated SQLite file and storage dir so it never touches
 * your real local data. No AI key is provided: the core loop must pass without
 * one, and the degraded paths are asserted explicitly.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --hostname 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      LLA_DB_PATH: './.e2e-data/e2e.db',
      LLA_STORAGE_DIR: './.e2e-data/objects',
      LLA_LLM_API_KEY: '',
      LLA_LLM_BASE_URL: '',
    },
  },
});
