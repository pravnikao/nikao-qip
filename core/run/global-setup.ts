import { chromium, FullConfig } from '@playwright/test';
import { activeEnvironment, clientConfig } from '../config/client-config';
import { envOptional, loadDotEnv } from '../config/env';
import { saveRoleSession } from '../auth/ui-auth';
import { acquireLock } from './session-lock';
import { checkHealth } from './health';

/**
 * Before any product test:
 *  1. take the session lock (one run per checkout)
 *  2. check the environment is up and API auth works (fail fast, one clear message)
 *  3. sign in each needed role once and save the sessions
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  loadDotEnv();
  const projects = config.projects.map((p) => p.name);
  const productRun = projects.some((p) => p !== 'unit');
  if (!productRun) return;

  const holder = envOptional('QIP_INSTANCE', 'local')!;
  if (envOptional('QIP_NO_LOCK') !== '1') acquireLock(holder, `playwright ${projects.join(',')} on ${activeEnvironment().name}`);

  await checkHealth();

  const cfg = clientConfig();
  if (cfg.auth.ui.kind === 'none') return;
  const roles = new Set([cfg.defaultRole, ...(envOptional('QIP_ROLES')?.split(',').map((r) => r.trim()).filter(Boolean) ?? [])]);
  const browser = await chromium.launch();
  try {
    for (const role of roles) await saveRoleSession(browser, role);
  } finally {
    await browser.close();
  }
}
