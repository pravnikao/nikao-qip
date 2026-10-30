import { defineConfig } from '@playwright/test';
import { activeEnvironment, clientConfig } from './core/config/client-config';
import { loadDotEnv } from './core/config/env';
import { storageStatePath } from './core/auth/ui-auth';

loadDotEnv();
const env = activeEnvironment();
const cfg = clientConfig();
const isCI = !!process.env.CI;

/**
 * Product suite: api, ui and e2e projects against the active environment (QIP_ENV).
 * Unit tests for the framework itself live in playwright.unit.config.ts.
 */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: cfg.timeouts.uiMs },
  fullyParallel: false,
  workers: Number(process.env.QIP_WORKERS ?? 1),
  retries: Number(process.env.QIP_RETRIES ?? (isCI ? 1 : 0)),
  forbidOnly: isCI,
  globalSetup: require.resolve('./core/run/global-setup'),
  globalTeardown: require.resolve('./core/run/global-teardown'),
  reporter: [['list'], ['./core/reporter/qip-reporter.ts', { ignoreProjects: ['unit'] }], ['html', { open: 'never', outputFolder: 'reports/html' }]],
  use: {
    baseURL: env.baseUrl,
    trace: isCI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
    actionTimeout: cfg.timeouts.uiMs,
  },
  grepInvert: process.env.QIP_SCHEDULED ? /@creates-data|@post-go-live/ : undefined,
  projects: [
    { name: 'api', testDir: 'client-pack/tests/api', testMatch: /.*\.spec\.ts/ },
    { name: 'ui', testDir: 'client-pack/tests/ui', testMatch: /.*\.spec\.ts/, use: { storageState: storageStatePath(cfg.defaultRole) } },
    { name: 'e2e', testDir: 'client-pack/tests/e2e', testMatch: /.*\.(flow|spec)\.ts/, use: { storageState: storageStatePath(cfg.defaultRole) } },
  ],
  // The bundled demo platform starts itself; real environments are already running.
  webServer:
    env.name === 'demo'
      ? { command: 'node --require tsx/cjs demo-app/server.ts', url: 'http://localhost:4310/api/v1/openapi.json', reuseExistingServer: process.env.DEMO_REUSE === '1', timeout: 30_000, stdout: 'ignore' }
      : undefined,
});
