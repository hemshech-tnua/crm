import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// E2E runs against the production build (vite build + preview), so the real CSP is in force.
const external = process.env.E2E_BASE_URL; // e.g. the dev server while iterating; the CSP check needs the build
const executablePath = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: external ?? 'http://127.0.0.1:4173/',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'off',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', grepInvert: /@phone/, use: { viewport: { width: 1366, height: 900 } } },
    { name: 'phone', grep: /@phone/, use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
  ],
  webServer: external ? undefined : {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
