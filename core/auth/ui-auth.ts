import type { Browser, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { activeEnvironment, clientConfig } from '../config/client-config';
import { env } from '../config/env';

/**
 * UI sign-in. Each role signs in once in global setup and the session is saved;
 * tests reuse it. Only tests about logging in use a fresh login (freshLoginRoles).
 *
 * Never reuse a saved session from a second browser context while a run is going:
 * refresh-token rotation can sign the suite's session out mid-run.
 */

export function storageStatePath(role: string): string {
  return path.resolve(process.cwd(), '.auth', activeEnvironment().name, `${role}.json`);
}

export function isOnLoginPage(url: string): boolean {
  return new RegExp(activeEnvironment().loginUrlPattern).test(url);
}

/** Throws AUTH-EXPIRED (classified as infrastructure) if the page was bounced to the identity provider. */
export function assertNotOnLogin(page: Page): void {
  if (isOnLoginPage(page.url())) {
    throw new Error(`AUTH-EXPIRED — redirected to the identity provider (${page.url()}); the saved session is stale`);
  }
}

/** Fills the identity provider's form for a role. Works for Keycloak-style and most OIDC hosted pages. */
export async function signIn(page: Page, role: string): Promise<void> {
  const cfg = clientConfig();
  const ui = cfg.auth.ui;
  const r = cfg.roles[role];
  if (!r) throw new Error(`Unknown role "${role}"`);
  await page.goto(activeEnvironment().baseUrl);
  if (ui.kind !== 'form') return;
  if (isOnLoginPage(page.url()) || (await page.locator(ui.selectors.username).count()) > 0) {
    await page.locator(ui.selectors.username).fill(env(r.usernameEnv));
    await page.locator(ui.selectors.password).fill(env(r.passwordEnv, { secret: true }));
    await page.locator(ui.selectors.submit).first().click();
  }
  await page.waitForURL(new RegExp(ui.successUrlPattern), { timeout: cfg.timeouts.uiMs });
  if (ui.readySelector) await page.locator(ui.readySelector).first().waitFor({ timeout: cfg.timeouts.uiMs });
}

/** Signs a role in and saves its session for the run. */
export async function saveRoleSession(browser: Browser, role: string): Promise<string> {
  const file = storageStatePath(role);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ctx = await browser.newContext({ baseURL: activeEnvironment().baseUrl, httpCredentials: basicCredentials(role) });
  const page = await ctx.newPage();
  try {
    await signIn(page, role);
    await ctx.storageState({ path: file });
  } finally {
    await ctx.close();
  }
  return file;
}

/** HTTP basic credentials for apps behind basic auth (auth.ui.kind = basic). */
export function basicCredentials(role: string): { username: string; password: string } | undefined {
  const cfg = clientConfig();
  if (cfg.auth.ui.kind !== 'basic') return undefined;
  const r = cfg.roles[role];
  return { username: env(r.usernameEnv), password: env(r.passwordEnv, { secret: true }) };
}
