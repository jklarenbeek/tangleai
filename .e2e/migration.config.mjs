import { defineConfig, devices } from './migration/playwright.mjs';
export default defineConfig({ testDir: './migration', testMatch: '**/*.spec.mjs', fullyParallel: true, workers: 2,
  retries: 0, reporter: 'list', timeout: 45000, outputDir: './migration-results',
  use: { baseURL: process.env.PAGES_URL ?? 'http://127.0.0.1:4715', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
