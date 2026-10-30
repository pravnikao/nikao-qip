import { defineConfig } from '@playwright/test';

/** Unit tests for the framework itself: no browser, no environment, no lock. */
export default defineConfig({
  testDir: 'tests/unit',
  testMatch: /.*\.spec\.ts/,
  reporter: [['list']],
  workers: 4,
  projects: [{ name: 'unit' }],
});
